import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { q,withinTransaction } from './db.mjs';
import { id,amount,nonnegative,dateString,requireField,shortText,enumValue,HttpError,canSeeProject,canApproveProject,audit } from './helpers.mjs';
import { sha } from './auth.mjs';
import { stageNames,serviceTemplates } from './project-templates.mjs';
const wrap=handler=>(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next);
const isInternal=u=>u?.role!=='client';
const projectGuard=async(req)=>{if(!await canSeeProject(req.user,req.params.id)) throw new HttpError(403,'Project access denied');};
export function registerCoreRoutes(app,{staffOnly,managerOnly}) {
  app.get('/api/dashboard',wrap(async(req,res)=>{
    if(req.user.role==='client') return res.json({portal:true});
    const [clients,leads,projects,tasks,pending]=await Promise.all([
      q('SELECT COUNT(*) n FROM clients'),q("SELECT COUNT(*) n FROM leads WHERE stage NOT IN ('Won','Lost')"),
      q('SELECT COUNT(*) n FROM projects WHERE status=\'active\''),
      req.user.role==='member'?q("SELECT COUNT(*) n FROM tasks WHERE assignee_id=? AND status<>'done'",[req.user.id]):q("SELECT COUNT(*) n FROM tasks WHERE status<>'done'"),
      q("SELECT COUNT(*) n FROM deliverables WHERE status='client_review'")
    ]);
    res.json({clients:Number(clients[0].n),leads:Number(leads[0].n),activeProjects:Number(projects[0].n),openTasks:Number(tasks[0].n),pendingApprovals:Number(pending[0].n)});
  }));
  app.get('/api/leads',staffOnly,wrap(async(_req,res)=>res.json({items:await q('SELECT * FROM leads ORDER BY created_at DESC LIMIT 200')})));
  app.post('/api/leads',staffOnly,wrap(async(req,res)=>{
    const x=req.body; const newId=id();
    await q('INSERT INTO leads(id,company_name,contact_name,email,source,service,stage,budget,notes) VALUES (?,?,?,?,?,?,?,?,?)',[
      newId,requireField(x.company_name,'Company'),shortText(x.contact_name,150),shortText(x.email),shortText(x.source,80)||'Manual',
      enumValue(x.service||'Strategic Diagnosis',Object.keys(serviceTemplates),'service'), 'New Lead', nonnegative(x.budget||0), shortText(x.notes,2000)]);
    await audit(req.user.id,'lead.created','lead',newId);res.status(201).json({id:newId});
  }));
  app.patch('/api/leads/:id',staffOnly,wrap(async(req,res)=>{
    const stage=enumValue(req.body.stage,['New Lead','Under Review','Qualified','Consultation Scheduled','Discovery Completed','Proposal Sent','Negotiation','Won','Lost','Nurturing'],'stage');
    await q('UPDATE leads SET stage=? WHERE id=?',[stage,req.params.id]);await audit(req.user.id,'lead.updated','lead',req.params.id,{stage});res.json({ok:true});
  }));
  app.get('/api/tasks',staffOnly,wrap(async(req,res)=>{
    let sql="SELECT t.*,p.title project_title,p.service FROM tasks t JOIN projects p ON p.id=t.project_id";
    const args=[];
    if(req.user.role==='member'){sql+=' WHERE t.assignee_id=?';args.push(req.user.id);}
    sql+=' ORDER BY (t.status=\'done\'),t.due_date IS NULL,t.due_date ASC,t.created_at DESC LIMIT 300';
    res.json({items:await q(sql,args)});
  }));
  app.get('/api/clients',staffOnly,wrap(async(_req,res)=>res.json({items:await q('SELECT * FROM clients ORDER BY created_at DESC LIMIT 200')})));
  app.post('/api/clients',staffOnly,wrap(async(req,res)=>{
    const x=req.body,newId=id();await q('INSERT INTO clients(id,name,industry,contact_name,contact_email) VALUES(?,?,?,?,?)',[
      newId,requireField(x.name,'Client'),shortText(x.industry,120),shortText(x.contact_name,150),shortText(x.contact_email,190)]);
    await audit(req.user.id,'client.created','client',newId);res.status(201).json({id:newId});
  }));
  app.post('/api/clients/:id/invitations',managerOnly,wrap(async(req,res)=>{
    const email=requireField(req.body.email,'Email').toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400,'Invalid email');
    const permission=enumValue(req.body.permission||'viewer',['viewer','approver']);
    const [cl]=await q('SELECT id FROM clients WHERE id=?',[req.params.id]);if(!cl) throw new HttpError(404,'Client not found');
    const token=randomBytes(28).toString('hex'), inviteId=id();
    await q('INSERT INTO invitations(id,token_hash,client_id,email,permission,expires_at) VALUES(?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY))',[inviteId,sha(token),req.params.id,email,permission]);
    await audit(req.user.id,'client.invitation_created','client',req.params.id,{email,permission});
    res.status(201).json({invitePath:`/invite?token=${token}`,expiresInHours:48,note:'Share this single-use link securely with the intended contact; it will not be shown again.'});
  }));
  app.get('/api/projects',wrap(async(req,res)=>{
    let sql='SELECT p.*,c.name client_name FROM projects p JOIN clients c ON p.client_id=c.id';let params=[];
    if(req.user.role==='client'){sql+=' JOIN client_memberships m ON m.client_id=p.client_id AND m.user_id=?'; params=[req.user.id];}
    else if(req.user.role==='member'){sql+=' JOIN project_members m ON m.project_id=p.id AND m.user_id=?';params=[req.user.id];}
    sql+=' ORDER BY p.created_at DESC LIMIT 200';res.json({items:await q(sql,params)});
  }));
  app.post('/api/projects',managerOnly,wrap(async(req,res)=>{
    const data=req.body;const service=enumValue(data.service,Object.keys(serviceTemplates),'service');
    const clientId=requireField(data.client_id,'Client ID',36);
    const [client]=await q('SELECT id FROM clients WHERE id=?',[clientId]);if(!client) throw new HttpError(404,'Client not found');
    const title=requireField(data.title,'Project title');
    const businessStage=enumValue(data.business_stage||'existing',['launch','existing']);
    const projectId=id();
    await withinTransaction(async c=>{
      await c.execute('INSERT INTO projects(id,client_id,title,service,business_stage,owner_id,due_date) VALUES(?,?,?,?,?,?,?)',[
        projectId,clientId,title,service,businessStage,req.user.id,data.due_date?dateString(data.due_date):null]);
      await c.execute('INSERT INTO project_members(project_id,user_id) VALUES(?,?)',[projectId,req.user.id]);
      for(let i=0;i<serviceTemplates[service].length;i++){
        const stageId=id();const name=stageNames[i];
        await c.execute('INSERT INTO project_stages(id,project_id,sort_index,name,status) VALUES(?,?,?,?,?)',[stageId,projectId,i+1,name,i===0?'active':'locked']);
        for(const taskName of serviceTemplates[service][i]) await c.execute('INSERT INTO tasks(id,project_id,stage_id,title) VALUES(?,?,?,?)',[id(),projectId,stageId,taskName]);
      }
    });
    await audit(req.user.id,'project.created','project',projectId,{service,businessStage});res.status(201).json({id:projectId});
  }));
  app.get('/api/projects/:id',wrap(async(req,res)=>{
    await projectGuard(req);
    const [p]=await q('SELECT p.*,c.name client_name FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.id=?',[req.params.id]);
    if(!p) throw new HttpError(404,'Project not found');
    const isClient=req.user.role==='client';
    const [stages,tasks,deliverables,comments,files]=await Promise.all([
      q('SELECT * FROM project_stages WHERE project_id=? ORDER BY sort_index',[p.id]),
      isClient?Promise.resolve([]):q('SELECT t.*,u.full_name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? ORDER BY t.created_at',[p.id]),
      q(`SELECT d.*,f.original_name FROM deliverables d LEFT JOIN file_assets f ON f.id=d.file_id WHERE d.project_id=? ${isClient?"AND d.visible_to_client=1 AND d.status IN ('client_review','approved','changes_requested')":''} ORDER BY d.created_at DESC`,[p.id]),
      q(`SELECT pc.*,u.full_name author_name FROM project_comments pc JOIN users u ON u.id=pc.author_id WHERE pc.project_id=? ${isClient?'AND pc.visible_to_client=1':''} ORDER BY pc.created_at DESC LIMIT 150`,[p.id]),
      q(`SELECT id,original_name,mime_type,byte_size,created_at FROM file_assets WHERE project_id=? ${isClient?'AND visible_to_client=1':''} ORDER BY created_at DESC LIMIT 100`,[p.id])
    ]);
    res.json({project:p,stages,tasks,deliverables,comments,files});
  }));
  app.post('/api/projects/:id/tasks',staffOnly,wrap(async(req,res)=>{
    await projectGuard(req); const newId=id();
    const stageId=req.body.stage_id||null;
    if(stageId){const [st]=await q('SELECT id FROM project_stages WHERE id=? AND project_id=?',[stageId,req.params.id]);if(!st) throw new HttpError(400,'Stage does not belong to this project');}
    await q('INSERT INTO tasks(id,project_id,stage_id,title,due_date,assignee_id) VALUES(?,?,?,?,?,?)',[newId,req.params.id,stageId,requireField(req.body.title,'Task'),req.body.due_date?dateString(req.body.due_date):null,req.user.id]);
    await audit(req.user.id,'task.created','task',newId);res.status(201).json({id:newId});
  }));
  app.patch('/api/tasks/:id',staffOnly,wrap(async(req,res)=>{
    const [task]=await q('SELECT * FROM tasks WHERE id=?',[req.params.id]);if(!task) throw new HttpError(404,'Task not found');
    if(!await canSeeProject(req.user,task.project_id)) throw new HttpError(403,'Not assigned to this project');
    if(req.user.role==='member' && task.assignee_id!==req.user.id) throw new HttpError(403,'Cannot edit task assigned to someone else');
    const status=enumValue(req.body.status,['todo','in_progress','review','blocked','done']);
    await q('UPDATE tasks SET status=? WHERE id=?',[status,req.params.id]);await audit(req.user.id,'task.status_changed','task',req.params.id,{status});res.json({ok:true});
  }));
  app.post('/api/projects/:id/stages/:stageId/approve',managerOnly,wrap(async(req,res)=>{
    await projectGuard(req);
    const projectId=req.params.id,stageId=req.params.stageId;
    await withinTransaction(async c=>{
      const [[stage]]=await c.execute('SELECT * FROM project_stages WHERE id=? AND project_id=? FOR UPDATE',[stageId,projectId]);
      if(!stage||stage.status!=='active') throw new HttpError(409,'Stage not active');
      const [[tasks]]=await c.execute("SELECT COUNT(*) n FROM tasks WHERE stage_id=? AND status<>'done'",[stageId]);
      const [[deliverables]]=await c.execute("SELECT COUNT(*) n FROM deliverables WHERE stage_id=? AND status<>'approved'",[stageId]);
      if(Number(tasks.n)||Number(deliverables.n)) throw new HttpError(409,'Complete all tasks and obtain deliverable approvals first');
      await c.execute('UPDATE project_stages SET status=\'approved\',approved_by=?,approved_at=UTC_TIMESTAMP(),approval_note=? WHERE id=?',[req.user.id,shortText(req.body.note,2000),stageId]);
      const [[nextStage]]=await c.execute('SELECT id FROM project_stages WHERE project_id=? AND sort_index=?',[projectId,Number(stage.sort_index)+1]);
      if(nextStage) await c.execute("UPDATE project_stages SET status='active' WHERE id=?",[nextStage.id]);
      else await c.execute("UPDATE projects SET status='completed' WHERE id=?",[projectId]);
    });
    await audit(req.user.id,'stage.approved','project_stage',stageId);res.json({ok:true});
  }));
  app.post('/api/projects/:id/deliverables',staffOnly,wrap(async(req,res)=>{
    await projectGuard(req);
    const stageId=requireField(req.body.stage_id,'Stage',36);
    const [stage]=await q('SELECT id FROM project_stages WHERE id=? AND project_id=?',[stageId,req.params.id]);if(!stage) throw new HttpError(400,'Invalid project stage');
    const newId=id();
    await q("INSERT INTO deliverables(id,project_id,stage_id,title,status) VALUES(?,?,?,?,'draft')",[newId,req.params.id,stageId,requireField(req.body.title,'Deliverable')]);
    await audit(req.user.id,'deliverable.created','deliverable',newId);res.status(201).json({id:newId});
  }));
  app.patch('/api/deliverables/:id',staffOnly,wrap(async(req,res)=>{
    const [d]=await q('SELECT * FROM deliverables WHERE id=?',[req.params.id]);if(!d) throw new HttpError(404,'Deliverable not found');
    if(!await canSeeProject(req.user,d.project_id)) throw new HttpError(403,'Project access denied');
    const status=enumValue(req.body.status,['draft','internal_review','client_review']);
    const fileId=req.body.file_id||d.file_id;
    if(status==='client_review' && !fileId) throw new HttpError(400,'Attach a real file before sharing for approval');
    if(fileId){const [f]=await q('SELECT id FROM file_assets WHERE id=? AND project_id=?',[fileId,d.project_id]);if(!f) throw new HttpError(400,'File not found in this project');}
    if(['approved','changes_requested'].includes(d.status) && status==='client_review' && fileId===d.file_id) throw new HttpError(409,'A new review requires a new file version');
    const newVersion=fileId && fileId!==d.file_id ? (d.file_id?Number(d.version)+1:1) : Number(d.version);
    await withinTransaction(async c=>{
      await c.execute('UPDATE deliverables SET status=?,file_id=?,version=?,visible_to_client=? WHERE id=?',[status,fileId,newVersion,status==='client_review'?1:d.visible_to_client,d.id]);
      if(status==='client_review' && fileId){
        await c.execute('INSERT IGNORE INTO deliverable_versions(deliverable_id,version,file_id) VALUES(?,?,?)',[d.id,newVersion,fileId]);
        await c.execute('UPDATE file_assets SET visible_to_client=1 WHERE id=?',[fileId]);
      }
    });
    await audit(req.user.id,'deliverable.updated','deliverable',d.id,{status,newVersion});res.json({ok:true});
  }));
  app.post('/api/deliverables/:id/decision',wrap(async(req,res)=>{
    const [d]=await q('SELECT * FROM deliverables WHERE id=?',[req.params.id]);if(!d||!d.visible_to_client) throw new HttpError(404,'Deliverable not available');
    if(!await canApproveProject(req.user,d.project_id)) throw new HttpError(403,'Client approver permission required');
    if(d.status!=='client_review') throw new HttpError(409,'Deliverable not awaiting client approval');
    const decision=enumValue(req.body.decision,['approved','changes_requested']);
    const note=shortText(req.body.note,2000);
    if(decision==='changes_requested'&&!note) throw new HttpError(400,'Please describe the requested changes');
    await withinTransaction(async c=>{
      const [r]=await c.execute("UPDATE deliverables SET status=? WHERE id=? AND status='client_review'",[decision, d.id]);
      if(r.affectedRows!==1) throw new HttpError(409,'Decision already recorded');
      await c.execute('INSERT INTO approvals(id,deliverable_id,version,actor_id,decision,note) VALUES(?,?,?,?,?,?)',[id(),d.id,d.version,req.user.id,decision,note]);
    });
    await audit(req.user.id,'deliverable.decision','deliverable',d.id,{decision,version:d.version});res.json({ok:true});
  }));
  app.post('/api/projects/:id/comments',wrap(async(req,res)=>{
    await projectGuard(req);
    const newId=id(), body=requireField(req.body.body,'Comment',3000);
    const visible=req.user.role==='client'?1:(req.body.visible_to_client?1:0);
    await q('INSERT INTO project_comments(id,project_id,author_id,body,visible_to_client) VALUES(?,?,?,?,?)',[newId,req.params.id,req.user.id,body,visible]);
    res.status(201).json({id:newId});
  }));
  // All uploads private and authenticated; no public URL access to the upload directory.
  const uploadDir=path.resolve(process.env.PRIVATE_UPLOAD_DIR || './private-uploads');
  const store=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024},fileFilter:(_req,file,cb)=>{
    const allowed=['application/pdf','image/png','image/jpeg','image/webp','application/zip'];
    cb(null,allowed.includes(file.mimetype));
  }});
  app.post('/api/projects/:id/files',staffOnly,store.single('file'),wrap(async(req,res)=>{
    await projectGuard(req);
    if(!req.file) throw new HttpError(400,'Allowed: PDF, PNG, JPG, WEBP or ZIP (max 10MB)');
    const key=`${id()}`;await fs.mkdir(uploadDir,{recursive:true,mode:0o700});
    await fs.writeFile(path.join(uploadDir,key),req.file.buffer,{mode:0o600,flag:'wx'});
    const assetId=id();
    try{await q('INSERT INTO file_assets(id,project_id,uploader_id,original_name,storage_key,mime_type,byte_size) VALUES (?,?,?,?,?,?,?)',[
      assetId,req.params.id,req.user.id,path.basename(req.file.originalname).slice(0,255),key,req.file.mimetype,req.file.size]);}
    catch(e){await fs.rm(path.join(uploadDir,key),{force:true});throw e;}
    await audit(req.user.id,'file.uploaded','file',assetId);res.status(201).json({id:assetId,name:req.file.originalname});
  }));
  app.get('/api/files/:id/download',wrap(async(req,res)=>{
    const [file]=await q('SELECT * FROM file_assets WHERE id=?',[req.params.id]);
    if(!file || !await canSeeProject(req.user,file.project_id) || (req.user.role==='client'&&!file.visible_to_client)) throw new HttpError(404,'File not available');
    const target=path.join(uploadDir,file.storage_key);
    try{await fs.access(target);}catch{throw new HttpError(404,'File missing from storage');}
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type',file.mime_type);
    res.download(target,file.original_name);
  }));
  app.get('/api/portal',wrap(async(req,res)=>{
    if(req.user.role!=='client') throw new HttpError(403,'Client portal is only for client users');
    const projects=await q('SELECT p.id,p.title,p.service,p.status,p.due_date,c.name client_name FROM projects p JOIN clients c ON c.id=p.client_id JOIN client_memberships m ON m.client_id=p.client_id AND m.user_id=? ORDER BY p.created_at DESC',[req.user.id]);
    const pending=await q("SELECT d.id,d.title,d.project_id,p.title project_title FROM deliverables d JOIN projects p ON p.id=d.project_id JOIN client_memberships m ON m.client_id=p.client_id AND m.user_id=? WHERE d.visible_to_client=1 AND d.status='client_review'",[req.user.id]);
    res.json({projects,pending});
  }));
}

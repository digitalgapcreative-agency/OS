import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { q,withinTransaction } from './db.mjs';
import { id,HttpError,requireField,enumValue,audit } from './helpers.mjs';
export const sha = s => createHash('sha256').update(s).digest('hex');
const sessionAgeMs = 7*24*60*60*1000;
export function attachAuth(app, loginLimiter) {
  app.use(async(req,res,next)=>{
    try {
      const token=req.cookies?.dgap_session;
      if(!token) return next();
      const [u] = await q('SELECT u.id,u.full_name,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.active=1',[sha(token)]);
      if(u) req.user=u;
      next();
    } catch(e){next(e);}
  });
  app.get('/api/setup/status',async(req,res,next)=>{
    try {const [state]=await q('SELECT initialized FROM app_state WHERE id=1');res.json({needsSetup:!state||!state.initialized});}catch(e){next(e);}
  });
  app.post('/api/setup/initialize',loginLimiter,async(req,res,next)=>{
    try {
      const expected=String(process.env.SETUP_TOKEN||'');const supplied=String(req.body.setup_token||'');
      if(expected.length<32||supplied.length<32||!timingSafeEqual(Buffer.from(sha(expected)),Buffer.from(sha(supplied)))) throw new HttpError(403,'Invalid setup credentials');
      const email=requireField(req.body.email,'Email',190).toLowerCase();const fullName=requireField(req.body.full_name,'Name',150);
      const pass=String(req.body.password||'');
      if(!/^\S+@\S+\.\S+$/.test(email)||pass.length<12||pass.length>128) throw new HttpError(400,'Provide a valid email and a password of 12–128 characters');
      const hashed=await bcrypt.hash(pass,12);
      await withinTransaction(async c=>{
        const [[state]]=await c.execute('SELECT initialized FROM app_state WHERE id=1 FOR UPDATE');
        const [[count]]=await c.execute("SELECT COUNT(*) n FROM users WHERE role='admin'");
        if(!state||state.initialized||Number(count.n)>0) throw new HttpError(409,'DGAP OS is already initialized');
        await c.execute("INSERT INTO users(id,full_name,email,password_hash,role) VALUES (?,?,?,?,'admin')",[id(),fullName,email,hashed]);
        await c.execute('UPDATE app_state SET initialized=1 WHERE id=1',[ ]);
      });
      res.status(201).json({ok:true});
    } catch(e){next(e)}
  });
  app.post('/api/auth/login',loginLimiter,async(req,res,next)=>{
    try {
      const email=requireField(req.body.email,'Email',190).toLowerCase();
      const pass=String(req.body.password??'');
      const [row]=(await q('SELECT * FROM users WHERE email=? AND active=1',[email]));
      if(!row || !(await bcrypt.compare(pass,row.password_hash))) throw new HttpError(401,'Invalid credentials');
      const token=randomBytes(32).toString('hex');
      await q('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))',[sha(token),row.id]);
      res.cookie('dgap_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:sessionAgeMs,path:'/'});
      res.json({user:{id:row.id,full_name:row.full_name,email:row.email,role:row.role}});
    }catch(e){next(e);}
  });
  app.post('/api/auth/logout',async(req,res,next)=>{
    try {if(req.cookies?.dgap_session) await q('DELETE FROM sessions WHERE token_hash=?',[sha(req.cookies.dgap_session)]);
      res.clearCookie('dgap_session',{path:'/'});res.json({ok:true}); }catch(e){next(e);}
  });
  app.get('/api/me',(req,res)=>res.json({user:req.user??null}));
  app.post('/api/invitations/redeem',loginLimiter,async(req,res,next)=>{
    try {
      const token=requireField(req.body.token,'Token',190);
      const password=String(req.body.password??'');
      const fullName=requireField(req.body.full_name,'Name',150);
      if(password.length<12||password.length>128) throw new HttpError(400,'Password must have 12–128 characters');
      const passwordHash=await bcrypt.hash(password,12);
      const result=await withinTransaction(async c=>{
        const [invs]=await c.execute('SELECT * FROM invitations WHERE token_hash=? FOR UPDATE',[sha(token)]);
        const invite=invs[0];
        if(!invite||invite.redeemed_at||new Date(String(invite.expires_at).replace(' ','T')+'Z').getTime()<Date.now()) throw new HttpError(410,'Invitation expired or invalid');
        const [existing]=await c.execute('SELECT id,role FROM users WHERE email=? FOR UPDATE',[invite.email]);
        let userId=existing[0]?.id;
        if(existing.length) throw new HttpError(409,'This email already has an account. Ask Digital Gap to grant access to the existing account instead.');
        if(!userId) {userId=id();await c.execute("INSERT INTO users(id,full_name,email,password_hash,role) VALUES(?,?,?,?,'client')",[userId,fullName,invite.email,passwordHash]);}
        
        await c.execute('INSERT INTO client_memberships(user_id,client_id,permission) VALUES(?,?,?) ON DUPLICATE KEY UPDATE permission=VALUES(permission)',[userId,invite.client_id,invite.permission]);
        await c.execute('UPDATE invitations SET redeemed_at=UTC_TIMESTAMP() WHERE id=?',[invite.id]);
        return userId;
      });
      res.json({ok:true, userId:result});
    }catch(e){next(e);}
  });
}
export function requireAuth(req,res,next){ if(!req.user) return next(new HttpError(401,'Please log in')); next(); }
export function staffOnly(req,res,next){ if(!req.user||req.user.role==='client') return next(new HttpError(403,'Not authorized')); next(); }
export function managerOnly(req,res,next){ if(!req.user||!['admin','manager'].includes(req.user.role)) return next(new HttpError(403,'Manager permission required')); next(); }
export function financeOnly(req,res,next){ if(!req.user||!['admin','finance'].includes(req.user.role)) return next(new HttpError(403,'Finance permission required')); next(); }

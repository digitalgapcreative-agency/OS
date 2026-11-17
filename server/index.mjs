import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { join,resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { attachAuth,requireAuth,staffOnly,managerOnly,financeOnly } from './auth.mjs';
import { registerCoreRoutes } from './routes-core.mjs';
import { registerFinanceRoutes } from './routes-finance.mjs';
import { HttpError } from './helpers.mjs';
import { pool } from './db.mjs';
try { process.loadEnvFile?.(); } catch(e) { if(e.code!=='ENOENT') throw e; }
const app=express();
app.set('trust proxy',process.env.NODE_ENV==='production'?1:false);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'1mb'}));
app.use(cookieParser());
app.use((req,res,next)=>{
  if(req.path.startsWith('/api') && !['GET','HEAD','OPTIONS'].includes(req.method)) {
    if(req.get('X-DGAP-Request')!=='1') return next(new HttpError(403,'Request header required'));
    if(req.get('origin') && process.env.APP_ORIGIN && req.get('origin')!==process.env.APP_ORIGIN) return next(new HttpError(403,'Origin not allowed'));
  }
  next();
});
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false});
attachAuth(app,loginLimiter);
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'DGAP OS',version:'0.1.0'}));
app.use('/api', (req,res,next)=> req.path.startsWith('/auth/') || req.path==='/me' || req.path.startsWith('/invitations/redeem') || req.path.startsWith('/setup/') || req.path==='/health' ? next() : requireAuth(req,res,next));
registerCoreRoutes(app,{staffOnly,managerOnly});
registerFinanceRoutes(app,{financeOnly});
app.use('/api',(req,res)=>res.status(404).json({error:'Not found'}));
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dist=join(root,'dist');
try{await access(join(dist,'index.html'));
  app.use(express.static(dist,{index:false,etag:true,maxAge:'1h'}));
  app.get('*',(req,res)=>res.sendFile(join(dist,'index.html')));
}catch{app.get('/',(_req,res)=>res.status(503).send('DGAP OS frontend not built. Run npm run build.'));}
app.use((err,req,res,next)=>{
  if(res.headersSent) return next(err);
  const status=err.status|| (err.code==='ER_DUP_ENTRY'?409:500);
  if(status===500) console.error('Server error:',err);
  res.status(status).json({error:status===500?'Internal server error':err.message});
});
const port=Number(process.env.PORT||3000);
try {await pool.query('SELECT 1');
  app.listen(port,()=>console.log(`DGAP OS listening on ${port}`));
}catch(e){console.error('DGAP OS cannot connect to MySQL. Check DB_* variables, database and migrations.', e.message); process.exit(1);}

import {readFile} from 'node:fs/promises';
import mysql from 'mysql2/promise';
try { process.loadEnvFile?.(); } catch(e) { if(e.code!=='ENOENT') throw e; }
const connection=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'dgap_os_db',multipleStatements:true});
try {await connection.query(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));console.log('DGAP OS tables created / checked');}finally{await connection.end();}

import readline from 'node:readline/promises';
import {stdin as input,stdout as output} from 'node:process';
import bcrypt from 'bcryptjs';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
try { process.loadEnvFile?.(); } catch(e) { if(e.code!=='ENOENT') throw e; }
const cli=readline.createInterface({input,output});
const name=(await cli.question('Admin full name: ')).trim();
const email=(await cli.question('Admin email: ')).trim().toLowerCase();
const password=(await cli.question('Initial password (12+ chars; terminal input visible): '));
cli.close();
if(!name||!email.includes('@')||password.length<12) throw new Error('Name, email and a password of 12+ characters required');
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'dgap_os_db'});
try {await db.execute("INSERT INTO users(id,full_name,email,password_hash,role) VALUES (?,?,?,?,'admin')",[randomUUID(),name,email,await bcrypt.hash(password,12)]); await db.execute('UPDATE app_state SET initialized=1 WHERE id=1'); console.log('Admin created. Delete terminal history/transcript if password was captured.');}finally{await db.end();}

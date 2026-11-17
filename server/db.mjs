import mysql from 'mysql2/promise';
try { process.loadEnvFile?.(); } catch(e) { if(e.code!=='ENOENT') throw e; }

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dgap_os_db',
  waitForConnections: true,
  connectionLimit: 5,
  timezone: 'Z',
  dateStrings: true,
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: true
});
export async function q(sql, args = []) { const [rows] = await pool.execute(sql, args); return rows; }
export async function withinTransaction(callback) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const result = await callback(c); await c.commit(); return result; }
  catch (err) { await c.rollback(); throw err; }
  finally { c.release(); }
}

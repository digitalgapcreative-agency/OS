import { randomUUID } from 'node:crypto';
import { q } from './db.mjs';
export const id = () => randomUUID();
export class HttpError extends Error { constructor(status, message) { super(message); this.status=status; } }
export const requireField = (v, name, max=190) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, `${name} is required (max ${max} characters)`);
  return v.trim();
};
export const shortText = (v, max=190) => typeof v === 'string' ? v.trim().slice(0,max) : '';
export const amount = v => {
  const n=Number(v);
  if (!Number.isSafeInteger(n) || n<=0 || n>100_000_000_000_000) throw new HttpError(400,'Amount must be a positive whole IDR amount');
  return n;
};
export const nonnegative = v => {const n=Number(v); if(!Number.isSafeInteger(n)||n<0) throw new HttpError(400,'Enter a non-negative whole IDR amount'); return n;};
export const dateString = v => {if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(`${v}T12:00:00Z`))) throw new HttpError(400,'Invalid date');return v;};
export const enumValue = (v, choices, name='value') => {if(!choices.includes(v)) throw new HttpError(400,`Invalid ${name}`);return v;};
export const isStaff = u => u && u.role !== 'client';
export const isManager = u => u && ['admin','manager'].includes(u.role);
export const canFinance = u => u && ['admin','finance'].includes(u.role);
export async function canSeeProject(u, projectId) {
  if(!u) return false;
  if(u.role==='admin'||u.role==='manager'||u.role==='finance') return true;
  if(u.role==='member') return (await q('SELECT 1 FROM project_members WHERE user_id=? AND project_id=?',[u.id,projectId])).length>0;
  return (await q('SELECT 1 FROM projects p INNER JOIN client_memberships m ON m.client_id=p.client_id WHERE p.id=? AND m.user_id=?',[projectId,u.id])).length>0;
}
export async function canApproveProject(u, projectId) {
  if(!u||u.role!=='client') return false;
  return (await q("SELECT 1 FROM projects p INNER JOIN client_memberships m ON m.client_id=p.client_id WHERE p.id=? AND m.user_id=? AND m.permission='approver'",[projectId,u.id])).length>0;
}
export async function audit(actor,action,type,entityId,metadata={}) {
  await q('INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?,?)',[id(), actor,action,type,entityId,JSON.stringify(metadata)]);
}

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw Object.assign(new Error('Password must contain 12–256 characters.'), { status: 400 });
  const salt = randomBytes(16).toString('hex');
  return 'scrypt:' + salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [algorithm, salt, stored] = hash.split(':');
  if (algorithm !== 'scrypt' || !salt || stored?.length !== 128) return false;
  const candidate = await scrypt(password, salt, 64);
  return timingSafeEqual(Buffer.from(stored, 'hex'), candidate);
}
export const roles = ['admin', 'manager', 'sales', 'support', 'viewer'];
export function canWrite(role, module) {
  if (role === 'admin' || role === 'manager') return true;
  if (role === 'sales') return ['companies', 'contacts', 'leads', 'deals', 'tasks', 'quotes', 'invoices'].includes(module);
  if (role === 'support') return ['contacts', 'tasks', 'tickets'].includes(module);
  return false;
}
export function validId(value) { return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 4294967295; }
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

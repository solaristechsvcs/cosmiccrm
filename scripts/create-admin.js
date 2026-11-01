import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { audit } from '../src/app.js';
const pool=createPool(await loadConfig());
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:!!process.stdin.isTTY});
try {
  await migrate(pool);
  const [[count]]=await pool.query("SELECT COUNT(*) total FROM users WHERE role IN ('owner','admin') AND active=1");
  if(count.total)throw new Error('An administrator already exists. Use Team management to create staff or change passwords.');
  const name=(await rl.question('Administrator name: ')).trim();
  const email=(await rl.question('Administrator email: ')).trim().toLowerCase();
  process.stdout.write('Password (12+ characters; hidden): ');muted=true;
  const password=await rl.question('');process.stdout.write('\n');
  const hash=await hashPassword(password);muted=false;
  if(!name||name.length>120||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Provide a valid name and email.');
  const db=await pool.getConnection();
  try {
    // Use a database lock to prevent simultaneous bootstrap administrators.
    const [[lock]]=await db.query("SELECT GET_LOCK('cosmiccrm_admin_setup',30) acquired");
    if(lock.acquired!==1)throw new Error('Another administrator setup is running.');
    try {
      await db.beginTransaction();
      const [[existing]]=await db.query("SELECT COUNT(*) total FROM users WHERE role IN ('owner','admin') AND active=1");
      if(existing.total)throw new Error('An administrator already exists.');
      const [result]=await db.execute("INSERT INTO users (name,email,role,password_hash) VALUES (?,?,'admin',?)",[name,email,hash]);
      await audit(db,result.insertId,'created','users',result.insertId,{bootstrap:true});
      await db.commit();
    }catch(error){await db.rollback();throw error;}finally{await db.query("SELECT RELEASE_LOCK('cosmiccrm_admin_setup')");}
  }finally{db.release();}
  console.log('Administrator created. Sign in and manage staff from Team.');
} finally {rl.close();await pool.end();}

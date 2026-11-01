import {hashPassword} from './security.js';
// First-owner setup is controlled only by local, ignored config.js; there is no public bootstrap endpoint.
export async function setupOwner(pool,config) {
  const setup=config.ownerSetup;
  if(setup?.enabled!==true)return {created:false,reason:'disabled'};
  const db=await pool.getConnection();
  let locked=false;
  try {
    const [[lock]]=await db.query("SELECT GET_LOCK('cosmiccrm_owner_setup',30) acquired");
    if(lock.acquired!==1)throw new Error('Another owner setup is running.');
    locked=true;
    await db.beginTransaction();
    const [owners]=await db.query("SELECT id FROM users WHERE role='owner' FOR UPDATE");
    if(owners.length){await db.commit();return {created:false,reason:'exists'};}
    if(typeof setup.name!=='string'||!setup.name.trim()||setup.name.length>120)throw new Error('ownerSetup.name must contain 1–120 characters.');
    if(typeof setup.email!=='string'||setup.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setup.email.trim()))throw new Error('ownerSetup.email must be a valid email address.');
    const name=setup.name.trim(),email=setup.email.trim().toLowerCase(),hash=await hashPassword(setup.password);
    const [[existing]]=await db.execute('SELECT id FROM users WHERE email=? FOR UPDATE',[email]);
    let id=existing?.id;
    if(existing) {
      await db.execute("UPDATE users SET name=?,role='owner',active=1,password_hash=?,session_version=session_version+1 WHERE id=?",[name,hash,id]);
    } else {
      const [result]=await db.execute("INSERT INTO users(name,email,role,password_hash) VALUES (?,?,'owner',?)",[name,email,hash]);
      id=result.insertId;
    }
    await db.execute("INSERT INTO audit_log(actor_id,action,entity_type,entity_id,details) VALUES (?,'owner_setup','users',?,?)",[id,id,JSON.stringify({promoted:!!existing})]);
    await db.commit();
    return {created:true,id,promoted:!!existing};
  }catch(error){await db.rollback();throw error;}
  finally{
    if(locked)await db.query("SELECT RELEASE_LOCK('cosmiccrm_owner_setup')").catch(()=>{});
    db.release();
  }
}

import session from 'express-session';
import {setupOwner} from './src/owner-setup.js';
import MySQLSession from 'express-mysql-session';
import { loadConfig } from './src/config.js';
import { createPool, migrate } from './src/db.js';
import { createApp } from './src/app.js';
const config=await loadConfig();
const pool=createPool(config);
await migrate(pool);
const ownerSetup=await setupOwner(pool,config);
if(ownerSetup.created)console.log('Owner account ready. Sign in with your configured owner email and password. Remove ownerSetup credentials from config.js now.');
else if(ownerSetup.reason==='exists')console.log('An owner already exists. Setup skipped; remove ownerSetup credentials from config.js.');
const MySQLStore=MySQLSession(session);
const store=new MySQLStore({createDatabaseTable:true,expiration:8*60*60*1000},pool);
await store.onReady();
const app=createApp({pool,config,store});
const server=app.listen(config.port||3015,config.host||'0.0.0.0',()=>console.log('CosmicCRM listening on '+(config.port||3015)));
let stopping=false;
async function shutdown() {
  if(stopping) return; stopping=true;
  const timer=setTimeout(()=>process.exit(1),15000); timer.unref();
  server.close(async()=>{ await store.close(); await pool.end(); clearTimeout(timer); process.exit(0); });
}
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import session from 'express-session';
import MySQLSession from 'express-mysql-session';
import { createPool,migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword,verifyPassword } from '../src/security.js';
import {setupOwner} from '../src/owner-setup.js';
test('MySQL integration: migrations, sessions, permissions, records, quotes and conversions',{skip:process.env.CRM_TEST_MYSQL!=='1'},async t=>{
  const config={database:{host:'127.0.0.1',port:Number(process.env.CRM_TEST_DB_PORT||3306),user:'root',password:process.env.CRM_TEST_DB_PASSWORD||'test-only',database:'cosmiccrm_test'},sessionSecret:'integration-only-secret-'.repeat(4),secureCookies:false,trustProxy:false,publicUrl:'http://127.0.0.1',currency:'USD'};
  const pool=createPool(config);let server,store;
  try {
    await migrate(pool);await migrate(pool);
    // Dedicated disposable CI database ONLY.
    assert.equal(config.database.database,'cosmiccrm_test');
    for(const table of ['notes','audit_log','invoices','quotes','tasks','tickets','deals','leads','contacts','companies','products','users'])await pool.query('DELETE FROM '+table);
    const hash=await hashPassword('Integration password 123');
    const [admin]=await pool.execute("INSERT INTO users(name,email,role,password_hash) VALUES ('Admin','admin@test.example','admin',?)",[hash]);
    await pool.execute("INSERT INTO users(name,email,role,password_hash) VALUES ('Viewer','viewer@test.example','viewer',?)",[hash]);
    const Store=MySQLSession(session);store=new Store({endConnectionOnClose:false},pool);await store.onReady();
    server=createApp({pool,config,store}).listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
    config.publicUrl='http://127.0.0.1:'+server.address().port;
    function client(){
      let cookie='',csrf='';
      return async(path,{method='GET',body,origin=config.publicUrl}={})=>{
        const response=await fetch(config.publicUrl+'/api'+path,{method,headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
        const set=response.headers.getSetCookie();if(set.length)cookie=set.map(value=>value.split(';')[0]).join('; ');
        const result=await response.json();if(result.csrf)csrf=result.csrf;return {status:response.status,data:result};
      };
    }
    const request=client();
    assert.equal((await request('/records/contacts')).status,401);
    await request('/auth');
    assert.equal((await request('/login',{method:'POST',body:{email:'admin@test.example',password:'Integration password 123'},origin:'https://evil.example'})).status,403);
    assert.equal((await request('/login',{method:'POST',body:{email:'admin@test.example',password:'Integration password 123'}})).status,200);
    const company=await request('/records/companies',{method:'POST',body:{name:'Solaris',owner_id:admin.insertId}});assert.equal(company.status,201);
    const contact=await request('/records/contacts',{method:'POST',body:{name:'Customer',company_id:company.data.id}});assert.equal(contact.status,201);
    const detail=await request('/records/contacts/'+contact.data.id);assert.equal(detail.data.labels.company_id,'Solaris');
    assert.equal((await request('/records/contacts/'+contact.data.id,{method:'PUT',body:{...detail.data.record,name:'Updated'}})).status,200);
    assert.equal((await request('/records/contacts/'+contact.data.id,{method:'PUT',body:{...detail.data.record,name:'Stale'}})).status,409);
    assert.equal((await request('/records/contacts/'+contact.data.id+'/notes',{method:'POST',body:{body:'Follow up next week'}})).status,201);
    const lead=await request('/records/leads',{method:'POST',body:{name:'New lead',company:'Prospect',status:'new',value:100}});
    const converted=await request('/leads/'+lead.data.id+'/convert',{method:'POST',body:{}});
    assert.equal(converted.status,200);
    assert.equal((await request('/leads/'+lead.data.id+'/convert',{method:'POST',body:{}})).data.contactId,converted.data.contactId);
    const quote=await request('/records/quotes',{method:'POST',body:{name:'Proposal',status:'accepted',currency:'USD',tax_rate:10,items:[{description:'Service',quantity:2,price:50}],company_id:company.data.id}});
    assert.equal(quote.status,201);
    const invoice=await request('/quotes/'+quote.data.id+'/invoice',{method:'POST',body:{}});
    assert.equal(invoice.status,201);
    assert.equal((await request('/quotes/'+quote.data.id+'/invoice',{method:'POST',body:{}})).data.invoiceId,invoice.data.invoiceId);
    assert.equal((await request('/records/invoices/'+invoice.data.invoiceId)).data.record.total,110);
    assert.equal((await request('/dashboard')).status,200);
    const viewer=client();await viewer('/auth');await viewer('/login',{method:'POST',body:{email:'viewer@test.example',password:'Integration password 123'}});
    assert.equal((await viewer('/records/contacts')).status,200);
    assert.equal((await viewer('/records/contacts',{method:'POST',body:{name:'Blocked'}})).status,403);
    assert.equal((await viewer('/users')).status,403);assert.equal((await viewer('/audit')).status,403);
    const updated=await request('/records/contacts/'+contact.data.id);
    assert.equal((await request('/records/contacts/'+contact.data.id,{method:'DELETE',body:{row_version:updated.data.record.row_version,updated_at:updated.data.record.updated_at}})).status,200);
    assert.equal((await request('/records/contacts/'+contact.data.id)).status,404);
    const [[count]]=await pool.query('SELECT COUNT(*) count FROM audit_log');assert.ok(count.count>=10);
    await request('/logout',{method:'POST',body:{}});assert.equal((await request('/dashboard')).status,401);

    // Wisp-only configuration creates the first owner without a terminal or public setup URL.
    assert.equal((await setupOwner(pool,{})).reason,'disabled');
    await assert.rejects(setupOwner(pool,{ownerSetup:{enabled:true,name:'Owner',email:'owner@test.example',password:'short'}}));
    const ownerConfig={ownerSetup:{enabled:true,name:'First Owner',email:'first-owner@test.example',password:'Owner setup password 123'}};
    const bootstraps=await Promise.all([setupOwner(pool,ownerConfig),setupOwner(pool,ownerConfig)]);
    assert.equal(bootstraps.filter(result=>result.created).length,1);
    const firstOwner=bootstraps.find(result=>result.created);
    const [[firstAccount]]=await pool.execute('SELECT * FROM users WHERE id=?',[firstOwner.id]);
    assert.equal(firstAccount.role,'owner');assert.ok(await verifyPassword(ownerConfig.ownerSetup.password,firstAccount.password_hash));
    assert.equal((await setupOwner(pool,{ownerSetup:{enabled:true}})).reason,'exists');
    // Exercise promotion as a separate first-owner scenario in the disposable database.
    await pool.execute('DELETE FROM users WHERE id=?',[firstOwner.id]);
    const promotion=await setupOwner(pool,{ownerSetup:{enabled:true,name:'Workspace Owner',email:'admin@test.example',password:'New owner password 123'}});
    assert.equal(promotion.promoted,true);assert.equal(promotion.id,admin.insertId);
    await request('/auth');
    assert.equal((await request('/login',{method:'POST',body:{email:'admin@test.example',password:'New owner password 123'}})).status,200);
    assert.equal((await request('/auth')).data.user.role,'owner');
    assert.ok((await request('/meta')).data.roles.includes('owner'));
    assert.equal((await request('/users')).status,200);
    const secondOwner=await request('/users',{method:'POST',body:{name:'Second Owner',email:'second-owner@test.example',role:'owner',active:true,password:'Second owner password 123'}});
    assert.equal(secondOwner.status,201);
    const newAdmin=await request('/users',{method:'POST',body:{name:'Staff Admin',email:'staff-admin@test.example',role:'admin',active:true,password:'Staff admin password 123'}});
    assert.equal(newAdmin.status,201);
    const staff=client();await staff('/auth');await staff('/login',{method:'POST',body:{email:'staff-admin@test.example',password:'Staff admin password 123'}});
    assert.equal((await staff('/meta')).data.roles.includes('owner'),false);
    assert.equal((await staff('/users',{method:'POST',body:{name:'Escalation',email:'escalation@test.example',role:'owner',active:true,password:'Escalation password 123'}})).status,403);
    assert.equal((await staff('/users/'+promotion.id,{method:'PUT',body:{name:'Tampered',email:'admin@test.example',role:'admin',active:true}})).status,403);
    assert.equal((await request('/users/'+promotion.id,{method:'PUT',body:{name:'Owner',email:'admin@test.example',role:'admin',active:true}})).status,400);
    assert.equal((await request('/users/'+secondOwner.data.id,{method:'PUT',body:{name:'Second Owner',email:'second-owner@test.example',role:'owner',active:false}})).status,200);
    const [[preserved]]=await pool.execute('SELECT password_hash FROM users WHERE id=?',[promotion.id]);
    assert.equal((await setupOwner(pool,ownerConfig)).created,false);
    const [[afterSetup]]=await pool.execute('SELECT password_hash FROM users WHERE id=?',[promotion.id]);
    assert.equal(afterSetup.password_hash,preserved.password_hash);

  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    if(store)await store.close();
    await pool.end();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword,verifyPassword,canWrite,validId,csvCell } from '../src/security.js';
import { calculateItems,validate,modules } from '../src/modules.js';
import { restartWisp } from '../scripts/restart-wisp.js';
test('password hashes use independent salts and verify correctly',async()=>{
  const a=await hashPassword('A secure test password 123'),b=await hashPassword('A secure test password 123');
  assert.notEqual(a,b);assert.ok(await verifyPassword('A secure test password 123',a));assert.equal(await verifyPassword('wrong',a),false);
  await assert.rejects(hashPassword('short'));
});
test('role permissions are enforced by module',()=>{
  assert.ok(canWrite('admin','products'));assert.ok(canWrite('manager','tickets'));assert.ok(canWrite('sales','deals'));
  assert.equal(canWrite('sales','products'),false);assert.equal(canWrite('support','invoices'),false);assert.ok(canWrite('support','tickets'));assert.equal(canWrite('viewer','contacts'),false);
});
test('line totals round to cents and ignore submitted totals',()=>{
  assert.deepEqual(calculateItems([{description:'Service',quantity:3,price:19.99}],8.25),{items:[{description:'Service',quantity:3,price:19.99}],subtotal:59.97,total:64.92});
  const result=validate('invoices',{name:'INV-1',status:'draft',currency:'usd',tax_rate:10,items:[{description:'Hosting',quantity:2,price:5}],total:1});
  assert.equal(result.total,11);assert.equal(result.currency,'USD');
  assert.throws(()=>calculateItems([{description:'X',quantity:-1,price:2}],0));
  assert.throws(()=>calculateItems([],0));
  assert.throws(()=>calculateItems([{description:'X',quantity:1,price:2}],101));
});
test('validation rejects invalid enums, dates, relations, URLs and SQL-shaped modules',()=>{
  assert.throws(()=>validate('tasks',{name:'Task',status:'unknown',priority:'normal'}));
  assert.throws(()=>validate('tasks',{name:'Task',status:'todo',priority:'normal',due_date:'2026-02-30'}));
  assert.throws(()=>validate('contacts',{name:'Test',company_id:'1 OR 1=1'}));
  assert.throws(()=>validate('companies',{name:'Test',website:'javascript:alert(1)'}));
  assert.throws(()=>validate('users; DROP TABLE users',{}));
  assert.equal(validate('contacts',{name:' Contact ',email:'test@example.com'}).name,'Contact');
  assert.equal(validate('contacts',{name:'Contact',role:'admin'}).role,undefined);
});
test('record IDs and CSV export protect input boundaries',()=>{
  assert.ok(validId('42'));assert.equal(validId('1e3'),false);assert.equal(validId('-1'),false);assert.equal(validId('4294967296'),false);
  assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell('Normal, text'),'"Normal, text"');
});
test('restart uses Wisp client API and blocks redirects and insecure panel URLs',async()=>{
  let sent;
  await restartWisp({panelUrl:'https://panel.example.com',serverId:'abcd1234',apiKey:'test',fetchImpl:async(url,options)=>{sent={url,options};return {ok:true};}});
  assert.equal(sent.url,'https://panel.example.com/api/client/servers/abcd1234/power');
  assert.equal(sent.options.redirect,'error');assert.deepEqual(JSON.parse(sent.options.body),{signal:'restart'});
  await assert.rejects(restartWisp({panelUrl:'http://panel.example.com',serverId:'id',apiKey:'test'}));
  await assert.rejects(restartWisp({panelUrl:'https://panel.example.com',serverId:'../bad',apiKey:'test'}));
  await assert.rejects(restartWisp({panelUrl:'https://panel.example.com',serverId:'id',apiKey:'test',fetchImpl:async()=>({ok:false,status:403})}));
});
test('all CRM modules are explicitly declared',()=>assert.equal(Object.keys(modules).length,9));

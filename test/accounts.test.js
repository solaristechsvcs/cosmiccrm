import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertAccountChange,assertAssignableRole,isAccountAdmin} from '../src/accounts.js';
import {canWrite,roles} from '../src/security.js';
test('owners have full CRM access and exclusive owner-account control',()=>{
  assert.ok(roles.includes('owner'));assert.ok(isAccountAdmin('owner'));assert.ok(canWrite('owner','products'));
  assert.doesNotThrow(()=>assertAssignableRole({role:'owner'},'owner'));
  assert.throws(()=>assertAssignableRole({role:'admin'},'owner'),/Only an owner/);
  assert.throws(()=>assertAssignableRole({role:'manager'},'admin'),/access required/);
  const owner={id:1,role:'owner',active:1},admin={id:2,role:'admin',active:1};
  assert.throws(()=>assertAccountChange(admin,owner,{role:'admin',active:true},[owner,admin]),/Only an owner/);
  assert.throws(()=>assertAccountChange(owner,owner,{role:'admin',active:true},[owner,admin]),/your own account/);
  assert.throws(()=>assertAccountChange(owner,owner,{role:'owner',active:false},[owner,admin]),/your own account/);
  assert.doesNotThrow(()=>assertAccountChange(owner,admin,{role:'sales',active:true},[owner,admin]));
  assert.throws(()=>assertAccountChange({id:3,role:'owner'},owner,{role:'admin',active:true},[owner,admin]),/active owner/);
  assert.throws(()=>assertAccountChange({id:3,role:'admin'},admin,{role:'sales',active:true},[admin]),/active owner or administrator/);
});

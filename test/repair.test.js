import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const {repair}=createRequire(import.meta.url)('../scripts/repair-update.cjs');
test('one-time Wisp repair backs up deleted example and edited updater, preserving config',async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'cosmiccrm-repair-'));
  const seed=path.join(temporary,'seed'),checkout=path.join(temporary,'checkout');
  function git(cwd,...args) {
    const result=spawnSync('git',['-c','user.name=CRM Tests','-c','user.email=qa@example.test',...args],{cwd,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  }
  try {
    git(temporary,'init','-b','main',seed);
    await mkdir(path.join(seed,'scripts'));
    await writeFile(path.join(seed,'.gitignore'),'config.js\n');
    await writeFile(path.join(seed,'config.example.js'),'example');
    await writeFile(path.join(seed,'scripts/update.js'),'old updater');
    git(seed,'add','.');git(seed,'commit','-m','Initial');
    git(temporary,'clone',seed,checkout);
    const config='private local configuration';
    await writeFile(path.join(checkout,'config.js'),config);
    await rm(path.join(checkout,'config.example.js'));
    await writeFile(path.join(checkout,'scripts/update.js'),'manually replaced updater');
    await writeFile(path.join(seed,'scripts/update.js'),'new updater');
    git(seed,'add','.');git(seed,'commit','-m','Updated');
    const result=repair(checkout);
    assert.ok(result.backup);
    assert.equal(await readFile(path.join(checkout,'config.js'),'utf8'),config);
    assert.equal(await readFile(path.join(checkout,'config.example.js'),'utf8'),'example');
    assert.equal(await readFile(path.join(checkout,'scripts/update.js'),'utf8'),'new updater');
    assert.equal(git(checkout,'show',result.backup+':scripts/update.js'),'manually replaced updater');
    assert.equal(git(checkout,'status','--porcelain','--untracked-files=no'),'');
    assert.equal(repair(checkout).backup,null);
    // Never stash or replace a locally tracked secret.
    git(checkout,'add','-f','config.js');
    assert.throws(()=>repair(checkout),/secret files are tracked/);
    assert.equal(await readFile(path.join(checkout,'config.js'),'utf8'),config);
  }finally{
    const resolved=await realpath(temporary),tmpRoot=await realpath(os.tmpdir());
    assert.ok(resolved.toLowerCase().startsWith(tmpRoot.toLowerCase()+path.sep));
    assert.ok(path.basename(resolved).startsWith('cosmiccrm-repair-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

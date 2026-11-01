import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const updater=fileURLToPath(new URL('../scripts/update.js',import.meta.url));
test('startup updater fast-forwards source, preserves config and refuses unsafe changes',async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'cosmiccrm-update-'));
  const seed=path.join(temporary,'seed'),checkout=path.join(temporary,'checkout');
  function git(cwd,...args) {
    const result=spawnSync('git',['-c','user.name=CRM Tests','-c','user.email=qa@example.test',...args],{cwd,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  }
  try {
    git(temporary,'init','-b','main',seed);
    await writeFile(path.join(seed,'package.json'),'{"type":"module"}');
    await writeFile(path.join(seed,'.gitignore'),'config.js\n');
    await writeFile(path.join(seed,'release.txt'),'first');
    git(seed,'add','.');git(seed,'commit','-m','First');
    git(temporary,'clone',seed,checkout);
    const config="export default "+JSON.stringify({database:{user:'test',database:'test'},publicUrl:'https://test.example',sessionSecret:'a'.repeat(96),update:{enabled:true,branch:'main'}})+';';
    await writeFile(path.join(checkout,'config.js'),config);
    await writeFile(path.join(seed,'release.txt'),'second');git(seed,'add','.');git(seed,'commit','-m','Second');
    const update=()=>spawnSync(process.execPath,[updater],{cwd:checkout,encoding:'utf8'});
    assert.equal(update().status,0);
    assert.equal(await readFile(path.join(checkout,'release.txt'),'utf8'),'second');
    assert.equal(await readFile(path.join(checkout,'config.js'),'utf8'),config);
    await writeFile(path.join(checkout,'release.txt'),'local edit');
    const dirty=update();assert.notEqual(dirty.status,0);assert.match(dirty.stderr,/local edits/);
    git(checkout,'restore','release.txt');
    await writeFile(path.join(seed,'config.js'),'export default {};');git(seed,'add','-f','config.js');git(seed,'commit','-m','Unsafe tracked config');
    const unsafe=update();assert.notEqual(unsafe.status,0);assert.match(unsafe.stderr,/tracks local secrets/);
    assert.equal(await readFile(path.join(checkout,'config.js'),'utf8'),config);
    assert.equal(git(checkout,'log','-1','--format=%s').trim(),'Second');
  } finally {
    const resolved=await realpath(temporary),tmpRoot=await realpath(os.tmpdir());
    assert.ok(resolved.toLowerCase().startsWith(tmpRoot.toLowerCase()+path.sep));
    assert.ok(path.basename(resolved).startsWith('cosmiccrm-update-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

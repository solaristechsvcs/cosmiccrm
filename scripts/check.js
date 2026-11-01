import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(dir) {
  const paths=[];
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if(['node_modules','.git'].includes(entry.name))continue;
    const path=dir+'/'+entry.name;
    if(entry.isDirectory())paths.push(...await walk(path));
    else if(/\.(js|cjs)$/.test(path))paths.push(path);
  }
  return paths;
}
for (const file of await walk('.')) {
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
console.log('All JavaScript syntax checks passed.');

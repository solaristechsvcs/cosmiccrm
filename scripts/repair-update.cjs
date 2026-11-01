// One-time Wisp repair. Copy this file to /home/container/repair.cjs and set MAIN_FILE=repair.cjs.
// Saves tracked local changes in Git stash, preserves ignored config.js, and starts the CRM.
// After success, change MAIN_FILE back to start.cjs. Do not automatically reapply the stash.
const {spawnSync,spawn}=require('node:child_process');
const {existsSync,readFileSync}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
function repair(root) {
  function git(...args) {
    const result=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:120000});
    if(result.status!==0)throw new Error('Git '+args.join(' ')+' failed:\n'+(result.stderr||result.error?.message||''));
    return result.stdout.trim();
  }
  const config=path.join(root,'config.js');
  if(!existsSync(config))throw new Error('config.js is missing. Restore your configured file before running repair.');
  const digest=()=>createHash('sha256').update(readFileSync(config)).digest('hex');
  const before=digest();
  if(git('branch','--show-current')!=='main')throw new Error('This repair expects the main branch.');
  if(git('ls-files','--','config.js','deploy.config.js'))throw new Error('Local secret files are tracked. Repair stopped; remove them from tracking securely before continuing.');
  if(git('diff','--name-only','--diff-filter=U'))throw new Error('Unresolved Git conflicts require manual review.');
  git('fetch','--prune','origin','main');
  const remote=git('ls-tree','-r','--name-only','refs/remotes/origin/main').split('\n');
  if(remote.some(file=>['config.js','deploy.config.js'].includes(file)))throw new Error('The remote tracks secret configuration. Repair stopped.');
  git('merge-base','--is-ancestor','HEAD','refs/remotes/origin/main');
  let backup=null;
  if(git('status','--porcelain','--untracked-files=no')) {
    git('-c','user.name=CosmicCRM repair','-c','user.email=cosmiccrm@localhost',
      'stash','push','--message','CosmicCRM one-time repair backup '+new Date().toISOString());
    backup=git('rev-parse','refs/stash');
    console.log('Saved tracked local edits in Git stash: '+backup);
  }
  git('merge','--ff-only','refs/remotes/origin/main');
  if(digest()!==before)throw new Error('Configuration verification failed. Startup stopped.');
  console.log('Repair complete. config.js preserved. Source: '+git('rev-parse','--short','HEAD'));
  return {backup};
}
module.exports={repair};
if(require.main===module) {
  try {
    const root=existsSync(path.join(__dirname,'package.json'))?__dirname:path.resolve(__dirname,'..');
    repair(root);
    console.log('Starting CosmicCRM. Change Wisp MAIN_FILE back to start.cjs after this repair.');
    const child=spawn(process.execPath,[path.join(root,'start.cjs')],{cwd:root,stdio:'inherit'});
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
    child.on('error',error=>{console.error(error.message);process.exit(1);});
    child.on('exit',code=>process.exit(code??1));
  }catch(error){console.error(error.message);process.exitCode=1;}
}

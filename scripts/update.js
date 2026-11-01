import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
const config=await loadConfig();
function git(...args) {
  const result=spawnSync('git',args,{encoding:'utf8',timeout:120000});
  if(result.status!==0)throw new Error('Git command failed: '+args.join(' ')+'\n'+(result.stderr||result.error?.message||''));
  return result.stdout.trim();
}
if(config.update?.enabled!==false) {
  const branch=config.update?.branch||'main';
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)||branch.includes('..')||branch.endsWith('/'))throw new Error('Invalid update branch.');
  git('rev-parse','--is-inside-work-tree');
  if(git('branch','--show-current')!==branch)throw new Error('Checkout must be on the configured update branch: '+branch);
  if(git('status','--porcelain','--untracked-files=no'))throw new Error('Tracked files have local edits. Back up and resolve them before updating.');
  git('fetch','--prune','origin',branch);
  const target='refs/remotes/origin/'+branch;
  const tracked=git('ls-tree','-r','--name-only',target).split('\n');
  if(tracked.some(file=>['config.js','deploy.config.js'].includes(file)))throw new Error('Refusing an update that tracks local secrets.');
  git('merge','--ff-only',target);
  console.log('Source ready: '+git('rev-parse','--short','HEAD'));
} else { console.log('Automatic source updates disabled in config.js.'); }

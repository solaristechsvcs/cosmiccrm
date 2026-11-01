import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
const config=await loadConfig();
function gitRaw(...args) {
  const result=spawnSync('git',args,{encoding:'utf8',timeout:120000});
  if(result.status!==0)throw new Error('Git command failed: '+args.join(' ')+'\n'+(result.stderr||result.error?.message||''));
  return result.stdout;
}
const git=(...args)=>gitRaw(...args).trim();
if(config.update?.enabled!==false) {
  const branch=config.update?.branch||'main';
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)||branch.includes('..')||branch.endsWith('/'))throw new Error('Invalid update branch.');
  git('rev-parse','--is-inside-work-tree');
  if(git('branch','--show-current')!==branch)throw new Error('Checkout must be on the configured update branch: '+branch);
  const entries=gitRaw('status','--porcelain=v1','-z','--untracked-files=no').split('\0').filter(Boolean);
  // Only an ordinary modification of the generated lockfile may be backed up automatically.
  // Renames, deletions, conflicts and all other source edits require manual review.
  const lockfileOnly=entries.length===1 && entries[0].slice(3)==='package-lock.json' && /^( M|M |MM)$/.test(entries[0].slice(0,2));
  if(entries.length && !lockfileOnly) {
    const status=gitRaw('status','--short','--untracked-files=no').trimEnd();
    throw new Error('Tracked files have local edits:\n'+status+'\nBack up and review these edits before updating. config.js is ignored and does not need to be stashed.');
  }
  git('fetch','--prune','origin',branch);
  const target='refs/remotes/origin/'+branch;
  const tracked=git('ls-tree','-r','--name-only',target).split('\n');
  if(tracked.some(file=>['config.js','deploy.config.js'].includes(file)))throw new Error('Refusing an update that tracks local secrets.');
  if(lockfileOnly) {
    git('-c','user.name=CosmicCRM updater','-c','user.email=cosmiccrm@localhost',
      'stash','push','--message','CosmicCRM generated lockfile backup '+new Date().toISOString(),'--','package-lock.json');
    console.log('Backed up local package-lock.json changes in Git stash '+git('rev-parse','refs/stash')+'.');
    console.log('Using the repository lockfile for npm ci; config.js is preserved.');
  }
  git('merge','--ff-only',target);
  console.log('Source ready: '+git('rev-parse','--short','HEAD'));
} else { console.log('Automatic source updates disabled in config.js.'); }

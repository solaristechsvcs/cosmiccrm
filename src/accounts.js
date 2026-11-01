import {invalid} from './modules.js';
export const isAccountAdmin=role=>['owner','admin'].includes(role);
export function assertAssignableRole(actor,role) {
  if(!isAccountAdmin(actor.role))throw invalid('Owner or administrator access required.',403);
  if(role==='owner'&&actor.role!=='owner')throw invalid('Only an owner can create or assign owner accounts.',403);
}
export function assertAccountChange(actor,existing,data,privileged) {
  assertAssignableRole(actor,data.role);
  if(existing.role==='owner'&&actor.role!=='owner')throw invalid('Only an owner can change an owner account.',403);
  if(existing.id===actor.id&&(!data.active||data.role!==actor.role))throw invalid('You cannot disable or change the role of your own account.');
  const active=privileged.filter(user=>user.active);
  if(existing.role==='owner'&&existing.active&&active.filter(user=>user.role==='owner').length<=1&&(!data.active||data.role!=='owner'))throw invalid('Keep at least one active owner.');
  if(isAccountAdmin(existing.role)&&existing.active&&active.length<=1&&(!data.active||!isAccountAdmin(data.role)))throw invalid('Keep at least one active owner or administrator.');
}

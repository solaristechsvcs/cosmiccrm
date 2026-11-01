'use strict';
const $=selector=>document.querySelector(selector);
const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const title=value=>String(value).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const empty=message=>'<div class="empty"><strong>Room for your next opportunity.</strong>'+h(message)+'</div>';
const state={user:null,csrf:null,currency:'USD',meta:null,module:'dashboard',page:1,q:'',filter:'',board:false,request:0};
const nav=[['dashboard','◫','Overview'],['companies','▥','Companies'],['contacts','◎','Contacts'],['leads','↗','Leads'],['deals','◇','Deals & pipeline'],['tasks','☑','Tasks'],['tickets','▤','Support tickets'],['products','▧','Products'],['quotes','◩','Quotes'],['invoices','▣','Invoices'],['reports','◴','Reports'],['team','♙','Team'],['audit','≋','Audit trail'],['settings','⚙','Settings']];
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function money(value,currency=state.currency){try{return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(Number(value||0));}catch{return currency+' '+Number(value||0).toFixed(2);}}
function date(value){if(!value)return '—';return new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});}
function badge(value){return '<span class="pill '+h(value)+'">'+h(title(value||'—'))+'</span>';}
async function api(path,options={}){
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf,...options.headers},body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const result=await response.json().catch(()=>({error:'The server returned an unexpected response.'}));
  if(!response.ok){if(response.status===401&&path!=='/login')showLogin();throw new Error(result.error||'Unable to complete request.');}
  return result;
}
function showLogin(){$('#workspace').hidden=true;$('#login').hidden=false;state.user=null;}
async function showWorkspace(){
  $('#login').hidden=true;$('#workspace').hidden=false;
  $('#user-name').textContent=state.user.name;
  $('#avatar').textContent=state.user.name.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase();
  state.meta=await api('/meta');
  $('#nav').innerHTML=nav.filter(([key])=>key!=='team'||state.user.role==='admin').filter(([key])=>key!=='audit'||['admin','manager'].includes(state.user.role)).map(([key,icon,label])=>'<a href="#'+key+'" data-nav="'+key+'"><span class="nav-icon" aria-hidden="true">'+icon+'</span>'+label+'</a>').join('');
  await route();
}
async function route(){
  const key=location.hash.slice(1)||'dashboard';
  state.module=nav.some(([id])=>id===key)?key:'dashboard';state.page=1;state.q='';state.filter='';state.board=false;
  $('#sidebar').classList.remove('open');
  for(const link of document.querySelectorAll('[data-nav]'))link.classList.toggle('active',link.dataset.nav===state.module);
  $('#crumb').textContent=nav.find(([id])=>id===state.module)?.[2]||title(state.module);
  if(state.user)await render();
}
function head(name,description,actions=''){return '<div class="page-head"><div><p class="eyebrow">YOUR WORKSPACE, IN FOCUS</p><h1>'+h(name)+'</h1><p>'+h(description)+'</p></div><div class="head-actions">'+actions+'</div></div>';}
async function render(){
  const request=++state.request, module=state.module;
  $('#main').innerHTML='<div class="loading">Loading…</div>';
  try {
    if(module==='dashboard'||module==='reports'){
      const data=await api('/dashboard');if(request!==state.request)return;
      $('#main').innerHTML=module==='dashboard'?dashboard(data):reports(data);return;
    }
    if(module==='team'){const users=await api('/users');if(request!==state.request)return;renderTeam(users);return;}
    if(module==='audit'){const data=await api('/audit?page='+state.page);if(request!==state.request)return;renderAudit(data);return;}
    if(module==='settings'){renderSettings();return;}
    const data=await api('/records/'+module+'?'+params());if(request!==state.request)return;renderList(data);
  } catch(error){if(request===state.request)$('#main').innerHTML=head('Unable to load workspace',error.message,'<button data-action="retry">Try again</button>');}
}
function params(){const params=new URLSearchParams({q:state.q,page:state.page});const field=state.meta.modules[state.module]?.stage?'stage':'status';if(state.filter)params.set(field,state.filter);return params;}
function dashboard(data){
  const first=state.user.name.split(' ')[0], stages=state.meta.modules.deals.stage.options;
  const open=data.pipeline.filter(row=>!['won','lost'].includes(row.stage));
  const total=open.reduce((sum,row)=>sum+Number(row.value),0),weighted=open.reduce((sum,row)=>sum+Number(row.weighted),0),max=Math.max(...data.pipeline.map(row=>Number(row.value)),1);
  return head('Welcome back, '+first+'.','Here’s what’s happening across your business today.','<span class="date-tag">'+h(new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}))+'</span><button class="primary" data-action="new-lead">+ New lead</button>')+
    '<div class="stats">'+[
      ['Active pipeline',money(total),'Across '+open.reduce((sum,row)=>sum+row.count,0)+' open deals','◇'],
      ['Relationships',Number(data.counts.contacts).toLocaleString(),data.counts.companies+' companies in your workspace','◎'],
      ['Active leads',data.counts.leads,'Your next conversations','↗'],
      ['Open support tickets',data.counts.open_tickets,data.counts.overdue_tasks+' overdue tasks need attention','▤']
    ].map(([label,value,sub,icon])=>'<div class="stat"><span class="stat-icon">'+icon+'</span><div class="stat-label">'+h(label)+'</div><div class="stat-number">'+h(value)+'</div><p class="stat-sub">'+h(sub)+'</p></div>').join('')+'</div>'+
    '<div class="grid"><section class="panel"><div class="panel-head"><div><h2>Your sales pipeline</h2><p>Opportunity value by stage · '+h(state.currency)+'</p></div><a class="panel-link" href="#deals">View pipeline ↗</a></div><div class="panel-body">'+stages.map((stage,index)=>{const row=data.pipeline.find(row=>row.stage===stage)||{value:0,count:0};return '<div class="pipeline-row"><span>'+h(title(stage))+'</span><div class="pipeline-track"><progress class="pipeline-fill" max="100" value="'+Math.round(Number(row.value)/max*100)+'"></progress></div><span class="pipeline-value">'+h(money(row.value))+' <small>('+row.count+')</small></span></div>';}).join('')+'<div class="pipeline-total"><span>Weighted open forecast</span><strong>'+h(money(weighted))+'</strong></div></div></section>'+
    '<section class="panel"><div class="panel-head"><div><h2>Recent activity</h2><p>The latest movements in your workspace</p></div></div><div class="panel-body">'+(data.activity.length?data.activity.slice(0,6).map(row=>'<div class="activity-item"><span class="activity-dot"></span><div><p><strong>'+h(row.actor_name||'System')+'</strong> '+h(title(row.action).toLowerCase())+' '+h(row.entity_type)+' #'+row.entity_id+'</p><small>'+h(date(row.created_at))+'</small></div></div>').join(''):empty('Your team’s activity will appear here.'))+'</div></section></div>'+
    '<section class="panel"><div class="panel-head"><div><h2>Coming up next</h2><p>Open tasks, ordered by due date</p></div><a href="#tasks" class="panel-link">All tasks ↗</a></div>'+taskTable(data.tasks)+'</section>';
}
function taskTable(rows){return rows.length?'<div class="table-scroll"><table><thead><tr><th>Task</th><th>Priority</th><th>Due date</th><th>Status</th><th>Assigned to</th></tr></thead><tbody>'+rows.map(row=>'<tr><td><button class="link-button record-name" data-open="'+row.id+'" data-module="tasks">'+h(row.name)+'</button></td><td>'+badge(row.priority)+'</td><td>'+h(date(row.due_date))+'</td><td>'+badge(row.status)+'</td><td>'+h(row.owner_name||'Unassigned')+'</td></tr>').join('')+'</tbody></table></div>':empty('Create a task to keep the next step in sight.');}
function reports(data){
  return head('Reports','A live view of your pipeline, workload, and invoice balances.')+
    '<div class="welcome-banner"><div><strong>'+h(data.counts.overdue_tasks)+' overdue tasks</strong><p>'+h(data.counts.open_tickets)+' unresolved support tickets · '+h(data.counts.leads)+' active leads</p></div><span class="star">✦</span></div>'+
    '<section class="panel report-card"><h2>Sales performance · '+h(state.currency)+'</h2><div class="table-scroll"><table><thead><tr><th>Stage</th><th>Deals</th><th>Value</th><th>Weighted value</th></tr></thead><tbody>'+data.pipeline.map(row=>'<tr><td>'+badge(row.stage)+'</td><td>'+row.count+'</td><td>'+h(money(row.value))+'</td><td>'+h(money(row.weighted))+'</td></tr>').join('')+'</tbody></table></div></section>'+
    '<section class="panel report-card"><h2>Invoice balances by currency and status</h2><p class="muted">Balances use the recorded status. Mark invoices paid after confirming payment externally.</p>'+(data.invoices.length?'<div class="table-scroll"><table><thead><tr><th>Currency</th><th>Status</th><th>Invoices</th><th>Total</th></tr></thead><tbody>'+data.invoices.map(row=>'<tr><td>'+h(row.currency)+'</td><td>'+badge(row.status)+'</td><td>'+row.count+'</td><td>'+h(money(row.total,row.currency))+'</td></tr>').join('')+'</tbody></table></div>':empty('Invoice totals appear once you create your first invoice.'))+'</section>';
}
function renderList(data){
  const module=state.module,fields=state.meta.modules[module],writable=state.meta.writable.includes(module),status=fields.stage||fields.status;
  const columns=['name',...(['quotes','invoices'].includes(module)?['status','total','due_date']:Object.keys(fields).filter(key=>key!=='name'&&!['items','description','notes','address','website'].includes(key)&&!key.endsWith('_id')).slice(0,4)),'updated_at'];
  $('#main').innerHTML=head(nav.find(([id])=>id===module)[2],data.total+' records · Keep every relationship moving forward.',
    (module==='deals'?'<button data-action="toggle-board">'+(state.board?'Table view':'Pipeline view')+'</button>':'')+
    (['admin','manager'].includes(state.user.role)?'<button data-action="export">↓ Export CSV</button>':'')+
    (writable?'<button class="primary" data-action="new">+ Add '+h(module==='companies'?'company':module.slice(0,-1))+'</button>':''))+
    '<form id="search-form" class="toolbar"><input name="q" aria-label="Search records" placeholder="Search '+h(module)+'…" value="'+h(state.q)+'">'+(status?'<select name="filter" aria-label="Filter by status"><option value="">All '+(fields.stage?'stages':'statuses')+'</option>'+status.options.map(value=>'<option value="'+value+'" '+(state.filter===value?'selected':'')+'>'+h(title(value))+'</option>').join('')+'</select>':'')+'<button type="submit">Search</button></form>'+
    (state.board?'<p class="fine">Pipeline cards show this page of results. Use pagination below to see more.</p><div class="board">'+fields.stage.options.map(stage=>'<section class="board-column"><h3>'+h(title(stage))+'<span>'+data.rows.filter(row=>row.stage===stage).length+'</span></h3>'+data.rows.filter(row=>row.stage===stage).map(row=>'<div class="deal-card"><button class="link-button record-name" data-open="'+row.id+'" data-module="'+module+'">'+h(row.name)+'</button><strong>'+h(money(row.value))+'</strong><small>'+h(row.probability)+'% probability · '+h(date(row.close_date))+'</small></div>').join('')+'</section>').join('')+'</div>':
    '<section class="panel">'+(data.rows.length?'<div class="table-scroll"><table><thead><tr>'+columns.map(key=>'<th>'+h(title(key))+'</th>').join('')+'</tr></thead><tbody>'+data.rows.map(row=>'<tr>'+columns.map(key=>'<td>'+(key==='name'?'<button class="link-button record-name" data-open="'+row.id+'" data-module="'+module+'">'+h(row[key])+'</button>':['stage','status','priority'].includes(key)?badge(row[key]):['value','price','total'].includes(key)?h(money(row[key],row.currency||state.currency)):key.includes('date')||key.endsWith('_at')?h(date(row[key])):key==='active'?(row[key]?'Active':'Inactive'):h(row[key]||'—'))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':empty(state.q?'No records match your search.':'Add your first '+module.slice(0,-1)+' to get started.'))+'</section>')+
    '<div class="table-foot"><span>'+data.total+' records · Page '+data.page+' of '+Math.max(1,data.pages)+'</span><div><button data-action="previous" '+(data.page<=1?'disabled':'')+'>← Previous</button> <button data-action="next" '+(data.page>=data.pages?'disabled':'')+'>Next →</button></div></div>';
}
let current=null;
async function openRecord(module,id){
  const data=id?await api('/records/'+module+'/'+id):{record:{},notes:[],labels:{}};
  current={module,id,...data};
  const fields=state.meta.modules[module],record=data.record,writable=state.meta.writable.includes(module)&&!(module==='leads'&&record.status==='converted');
  const financial=['quotes','invoices'].includes(module);
  if(financial&&!record.items)record.items=[{description:'',quantity:1,price:0}];
  if(typeof record.items==='string')record.items=JSON.parse(record.items);
  $('#dialog-content').innerHTML='<div class="dialog-head"><div><p class="eyebrow">'+h(title(module))+(id?' / #'+id:' / NEW RECORD')+'</p><h2>'+h(record.name||'Create '+module.slice(0,-1))+'</h2></div><button class="icon-button" data-action="close" aria-label="Close dialog">✕</button></div><div class="dialog-body"><form id="record-form"><div class="form-grid">'+Object.entries(fields).filter(([key])=>key!=='items').map(([key,field])=>renderField(key,field,record[key],data.labels[key],writable)).join('')+'</div>'+
    (financial?'<h3 class="section-label">Line items</h3><div class="table-scroll"><table class="items-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th></th></tr></thead><tbody id="line-items">'+record.items.map(item=>itemRow(item,writable)).join('')+'</tbody></table></div>'+(writable?'<div class="head-actions no-print"><button type="button" data-action="add-item">+ Add item</button><button type="button" data-action="pick-product">Add from products</button></div>':'')+'<div id="totals" class="totals"></div>':'')+
    '<p id="record-error" class="error" role="alert"></p><div class="form-actions">'+(writable?'<button type="submit" class="primary">Save record</button>':'<span class="fine">Read-only record</span>')+'<button type="button" data-action="close">Close</button>'+
    (id&&['admin','manager'].includes(state.user.role)?'<button type="button" class="danger push" data-action="delete">Delete</button>':'')+
    (id&&module==='leads'&&record.status!=='converted'&&writable?'<button type="button" data-action="convert">Convert to contact ↗</button>':'')+
    (id&&module==='quotes'&&record.status==='accepted'&&state.meta.writable.includes('invoices')?'<button type="button" data-action="invoice">Create invoice ↗</button>':'')+
    (financial&&id?'<button type="button" data-action="print">Print / PDF</button>':'')+'</div></form>'+
    (id?'<section class="notes"><h3>Relationship notes</h3>'+(state.meta.writable.includes(module)?'<form id="note-form" class="note-form"><textarea name="body" aria-label="New note" placeholder="Log a conversation, context, or next step…" maxlength="10000" required></textarea><button type="submit">Add note</button></form>':'')+(data.notes.length?data.notes.map(note=>'<div class="note">'+h(note.body)+'<small>'+h(note.author_name||'Former team member')+' · '+h(date(note.created_at))+'</small></div>').join(''):'<p class="fine">No notes yet.</p>')+'</section>':'')+'</div>';
  if(!$('#record-dialog').open)$('#record-dialog').showModal();
  if(financial)updateTotals();
}
function renderField(key,field,value,label,writable){
  let control='',required=field.required?' required':'',disabled=writable?'':' disabled';
  value=value??(key==='currency'?state.currency:key==='owner_id'?state.user.id:field.type==='choice'?field.options[0]:['money','number'].includes(field.type)?0:field.type==='integer'?20:field.type==='boolean'?true:'');
  if(field.type==='ref'){
    const name=label||(key==='owner_id'&&Number(value)===state.user.id?state.user.name:'#'+value);
    control=(writable?'<div class="ref-search"><input type="search" placeholder="Find '+h(field.table)+'…" data-ref-input="'+key+'" aria-label="Find '+h(key)+'"><button type="button" data-ref-search="'+key+'" data-ref-table="'+field.table+'">Find</button></div>':'')+
    '<select name="'+key+'"'+disabled+'><option value="">Unassigned</option>'+(value?'<option selected value="'+h(value)+'">'+h(name)+'</option>':'')+'</select>'+
    (value&&field.table!=='users'?'<a class="field-link no-print" href="#'+h(field.table)+'" data-related="'+h(value)+'" data-module="'+field.table+'">Open linked record ↗</a>':'');
  }else if(field.type==='choice')control='<select name="'+key+'"'+required+disabled+'>'+field.options.map(option=>'<option value="'+option+'" '+(value===option?'selected':'')+'>'+h(title(option))+'</option>').join('')+'</select>';
  else if(field.type==='boolean')control='<select name="'+key+'"'+disabled+'><option value="true" '+(value?'selected':'')+'>Active</option><option value="false" '+(!value?'selected':'')+'>Inactive</option></select>';
  else if(field.max>500)control='<textarea name="'+key+'" maxlength="'+field.max+'"'+required+disabled+'>'+h(value)+'</textarea>';
  else {
    const type=field.type==='date'?'date':field.type==='email'?'email':field.type==='url'?'url':['money','integer','number'].includes(field.type)?'number':'text';
    if(type==='date'&&value)value=String(value).slice(0,10);
    control='<input name="'+key+'" type="'+type+'" value="'+h(value)+'"'+required+disabled+(type==='number'?' min="'+(field.min??0)+'" max="'+(field.max??999999999999.99)+'" step="'+(field.type==='integer'?'1':'0.01')+'"':'')+(field.max&&type!=='number'?' maxlength="'+field.max+'"':'')+'>';
  }
  return '<label class="'+(field.max>500?'full':'')+'">'+h(title(key.replace(/_id$/,'')))+(field.required?' *':'')+control+'</label>';
}
function itemRow(item,writable=true){return '<tr><td><input class="item-description" aria-label="Item description" value="'+h(item.description)+'" maxlength="500" required '+(!writable?'disabled':'')+'></td><td><input class="item-quantity" aria-label="Quantity" type="number" min=".01" max="100000" step=".01" value="'+h(item.quantity)+'" required '+(!writable?'disabled':'')+'></td><td><input class="item-price" aria-label="Unit price" type="number" min="0" max="999999999" step=".01" value="'+h(item.price)+'" required '+(!writable?'disabled':'')+'></td><td>'+(writable?'<button type="button" data-action="remove-item" aria-label="Remove item">×</button>':'')+'</td></tr>';}
function readItems(){return [...document.querySelectorAll('#line-items tr')].map(row=>({description:row.querySelector('.item-description').value,quantity:Number(row.querySelector('.item-quantity').value),price:Number(row.querySelector('.item-price').value)}));}
function updateTotals(){
  if(!$('#totals'))return;
  const subtotal=readItems().reduce((sum,item)=>sum+Math.round(item.quantity*Math.round(item.price*100)),0)/100,tax=Number($('#record-form [name=tax_rate]').value||0),currency=$('#record-form [name=currency]').value||state.currency;
  $('#totals').innerHTML='Subtotal '+h(money(subtotal,currency))+'<br>Tax '+h(tax)+'%<br><strong>'+h(money(subtotal+Math.round(subtotal*tax)/100,currency))+'</strong>';
}
function renderTeam(users){
  state.users=users;
  $('#main').innerHTML=head('Your team','Manage staff access and account security.','<button class="primary" data-action="new-user">+ Invite staff</button>')+
  '<p class="fine">Create a staff account and share its initial password through a secure channel. Staff can change it in Settings.</p><section class="panel"><div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>'+users.map(user=>'<tr><td>'+h(user.name)+'</td><td>'+h(user.email)+'</td><td>'+badge(user.role)+'</td><td>'+h(user.active?'Active':'Disabled')+'</td><td><button class="link-button" data-user="'+user.id+'">Manage</button></td></tr>').join('')+'</tbody></table></div></section>';
}
function openUser(id){
  const user=id?state.users.find(user=>user.id===Number(id)):{name:'',email:'',role:'sales',active:true};
  $('#dialog-content').innerHTML='<div class="dialog-head"><h2>'+h(id?'Manage staff':'Create staff account')+'</h2><button data-action="close" aria-label="Close">×</button></div><div class="dialog-body"><form id="user-form" data-id="'+(id||'')+'"><div class="form-grid"><label>Name<input name="name" value="'+h(user.name)+'" maxlength="120" required></label><label>Email<input type="email" name="email" value="'+h(user.email)+'" maxlength="254" required></label><label>Role<select name="role">'+state.meta.roles.map(role=>'<option '+(role===user.role?'selected':'')+'>'+role+'</option>').join('')+'</select></label><label>Account<select name="active"><option value="true">Active</option><option value="false" '+(!user.active?'selected':'')+'>Disabled</option></select></label><label class="full">Password '+(id?'(leave blank to keep current password)':'')+'<input name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" '+(!id?'required':'')+'></label></div><p class="fine">Admin: all access and staff management. Manager: all CRM records, exports and audit. Sales: companies, contacts, leads, deals, tasks, quotes and invoices. Support: contacts, tasks and tickets. Viewer: read only. All roles can read all CRM records, including financial records.</p><p id="user-error" class="error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Save account</button><button type="button" data-action="close">Cancel</button></div></form></div>';
  if(!$('#record-dialog').open)$('#record-dialog').showModal();
}
function renderAudit(data){$('#main').innerHTML=head('Audit trail','A record of logins, changes, exports, and account administration.')+'<section class="panel"><div class="table-scroll"><table><thead><tr><th>Time</th><th>Staff member</th><th>Action</th><th>Record</th></tr></thead><tbody>'+data.rows.map(row=>'<tr><td>'+h(new Date(row.created_at).toLocaleString())+'</td><td>'+h(row.actor_name||'System')+'</td><td>'+badge(row.action)+'</td><td>'+h(row.entity_type)+' #'+h(row.entity_id||'—')+'</td></tr>').join('')+'</tbody></table></div><div class="table-foot"><span>Page '+state.page+'</span><div><button data-action="previous" '+(state.page<=1?'disabled':'')+'>Previous</button> <button data-action="next" '+(data.rows.length<50?'disabled':'')+'>Next</button></div></div></section>';}
function renderSettings(){$('#main').innerHTML=head('Settings','Keep your account secure.')+'<section class="panel report-card"><h2>Change password</h2><form id="password-form"><div class="form-grid"><label>Current password<input name="current" type="password" autocomplete="current-password" required></label><label>New password<input name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label></div><div class="form-actions"><button class="primary" type="submit">Update password</button><span class="fine">Other signed-in sessions will be revoked.</span></div></form></section><section class="panel report-card"><h2>Workspace configuration</h2><p class="muted">Deployment, database, currency, and site URL are configured in your server’s config.js file.</p></section>';}
async function exportRecords(){
  const response=await fetch('/api/export/'+state.module+'?'+params());
  if(!response.ok){const error=await response.json();throw new Error(error.error);}
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=state.module+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function action(name,target){
  if(name==='close'){$('#record-dialog').close();return;}
  if(name==='retry')return render();
  if(name==='new')return openRecord(state.module);
  if(name==='new-lead')return openRecord('leads');
  if(name==='new-user')return openUser();
  if(name==='next'||name==='previous'){state.page+=name==='next'?1:-1;return render();}
  if(name==='toggle-board'){state.board=!state.board;return render();}
  if(name==='export')return exportRecords();
  if(name==='print'){window.print();return;}
  if(name==='add-item'){$('#line-items').insertAdjacentHTML('beforeend',itemRow({description:'',quantity:1,price:0}));updateTotals();return;}
  if(name==='remove-item'){if($('#line-items').children.length<=1)throw new Error('Keep at least one line item.');target.closest('tr').remove();updateTotals();return;}
  if(name==='pick-product'){
    const q=prompt('Search products by name:');if(q===null)return;
    const result=await api('/records/products?q='+encodeURIComponent(q));
    const available=result.rows.filter(product=>product.active);
    if(!available.length)throw new Error('No active products found.');
    const selection=prompt('Enter the product number:\n'+available.map(product=>product.id+': '+product.name+' — '+money(product.price)).join('\n'));
    const product=available.find(product=>String(product.id)===selection);if(!product)return;
    $('#line-items').insertAdjacentHTML('beforeend',itemRow({description:product.name,quantity:1,price:product.price}));updateTotals();return;
  }
  if(name==='delete'){
    if(!confirm('Delete this record permanently? Related records will remain, with this link removed.'))return;
    await api('/records/'+current.module+'/'+current.id,{method:'DELETE',body:{row_version:current.record.row_version}});
    $('#record-dialog').close();toast('Record deleted.');return render();
  }
  if(name==='convert'){
    const result=await api('/leads/'+current.id+'/convert',{method:'POST',body:{}});toast('Lead converted to a contact.');await openRecord('contacts',result.contactId);return render();
  }
  if(name==='invoice'){
    const result=await api('/quotes/'+current.id+'/invoice',{method:'POST',body:{}});toast('Invoice is ready for review.');await openRecord('invoices',result.invoiceId);return render();
  }
}
document.addEventListener('click',async event=>{
  const target=event.target.closest('button,a');if(!target)return;
  try{
    if(target.dataset.action){event.preventDefault();target.disabled=true;try{await action(target.dataset.action,target);}finally{target.disabled=false;}}
    else if(target.dataset.open)await openRecord(target.dataset.module,Number(target.dataset.open));
    else if(target.dataset.related){event.preventDefault();await openRecord(target.dataset.module,Number(target.dataset.related));}
    else if(target.dataset.user)openUser(target.dataset.user);
    else if(target.dataset.refSearch){
      const key=target.dataset.refSearch,q=document.querySelector('[data-ref-input="'+key+'"]').value,rows=await api('/lookups/'+target.dataset.refTable+'?q='+encodeURIComponent(q)),select=$('#record-form [name="'+key+'"]'),selected=select.value,old=select.selectedOptions[0]?.textContent;
      select.innerHTML='<option value="">Unassigned</option>'+rows.map(row=>'<option value="'+row.id+'">'+h(row.name)+'</option>').join('');
      if(selected&&!rows.some(row=>String(row.id)===selected))select.insertAdjacentHTML('beforeend','<option value="'+h(selected)+'">'+h(old)+'</option>');
      select.value=selected;toast(rows.length+' matches. Choose a record from the dropdown.');
    }
  }catch(error){toast(error.message);}
});
document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');if(button)button.disabled=true;
  try{
    if(form.id==='login-form'){
      $('#login-error').textContent='';const data=await api('/login',{method:'POST',body:Object.fromEntries(new FormData(form))});Object.assign(state,data);form.reset();await showWorkspace();
    }else if(form.id==='search-form'){state.q=form.q.value;state.filter=form.filter?.value||'';state.page=1;await render();}
    else if(form.id==='record-form'){
      $('#record-error').textContent='';const body=Object.fromEntries(new FormData(form));
      for(const [key,field]of Object.entries(state.meta.modules[current.module]))if(field.type==='boolean')body[key]=body[key]==='true';
      if(['quotes','invoices'].includes(current.module))body.items=readItems();
      if(current.id)body.row_version=current.record.row_version;
      const result=await api('/records/'+current.module+(current.id?'/'+current.id:''),{method:current.id?'PUT':'POST',body});
      toast('Record saved.');await openRecord(current.module,current.id||result.id);await render();
    }else if(form.id==='note-form'){
      await api('/records/'+current.module+'/'+current.id+'/notes',{method:'POST',body:{body:form.body.value}});await openRecord(current.module,current.id);toast('Note added.');
    }else if(form.id==='user-form'){
      $('#user-error').textContent='';const body=Object.fromEntries(new FormData(form));body.active=body.active==='true';
      await api('/users'+(form.dataset.id?'/'+form.dataset.id:''),{method:form.dataset.id?'PUT':'POST',body});$('#record-dialog').close();toast('Staff account saved.');await render();
    }else if(form.id==='password-form'){await api('/password',{method:'POST',body:Object.fromEntries(new FormData(form))});form.reset();toast('Password updated.');}
  }catch(error){const element=form.querySelector('.error');if(element)element.textContent=error.message;else toast(error.message);}
  finally{if(button)button.disabled=false;}
});
document.addEventListener('input',event=>{if(event.target.closest('#record-form'))updateTotals();});
$('#menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#logout').addEventListener('click',async()=>{try{await api('/logout',{method:'POST',body:{}});$('#record-dialog').close();showLogin();const data=await api('/auth');state.csrf=data.csrf;}catch(error){toast(error.message);}});
window.addEventListener('hashchange',()=>{if(state.user)route();});
(async()=>{try{Object.assign(state,await api('/auth'));if(state.user)await showWorkspace();else showLogin();}catch(error){showLogin();$('#login-error').textContent=error.message;}})();

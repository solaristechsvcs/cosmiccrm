import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { modules, validate, invalid, financial } from './modules.js';
import { canWrite, validId, hashPassword, verifyPassword, roles, csvCell } from './security.js';

const publicUser = user => ({id:user.id,name:user.name,email:user.email,role:user.role,active:!!user.active});
export async function transaction(pool, callback) {
  const db=await pool.getConnection();
  try { await db.beginTransaction(); const result=await callback(db); await db.commit(); return result; }
  catch(error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
export async function audit(db, actor, action, module, id, details={}) {
  await db.execute('INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',[actor,action,module,id,JSON.stringify(details)]);
}
async function references(db,module,data) {
  for (const [key,field] of Object.entries(modules[module])) {
    if (field.type!=='ref' || data[key]==null) continue;
    const [rows]=await db.execute('SELECT id FROM '+field.table+' WHERE id=?',[data[key]]);
    if (!rows.length) throw invalid(key+' no longer exists.');
  }
}
export function createApp({pool,config,store}) {
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy',config.trustProxy ?? false);
  app.use(helmet({contentSecurityPolicy:{directives:{"script-src":["'self'"],"style-src":["'self'"],"img-src":["'self'","data:"],"upgrade-insecure-requests":config.secureCookies?[]:null}}}));
  app.get('/health',async(req,res)=>{try { await pool.query('SELECT 1'); res.json({ok:true}); } catch { res.status(503).json({ok:false}); }});
  app.use(express.json({limit:'256kb'}));
  app.use(session({name:'cosmic.sid',secret:config.sessionSecret,store,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:!!config.secureCookies,sameSite:'lax',maxAge:8*60*60*1000}}));
  app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if (!req.session.csrf) req.session.csrf=randomBytes(32).toString('hex');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.get('origin')!==config.publicUrl || req.get('x-csrf-token')!==req.session.csrf) return next(invalid('Security token expired. Refresh the page and try again.',403));
    }
    next();
  });
  app.get('/api/auth',async(req,res)=>{
    let user=null;
    if (req.session.userId) {
      const [[row]]=await pool.execute('SELECT * FROM users WHERE id=?',[req.session.userId]);
      if(row?.active && row.session_version===req.session.version) user=publicUser(row);
    }
    res.json({user,csrf:req.session.csrf,appName:config.appName,currency:config.currency||'USD'});
  });
  const loginLimit=rateLimit({windowMs:15*60000,limit:15,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many login attempts. Try again in 15 minutes.'}});
  app.post('/api/login',loginLimit,async(req,res)=>{
    const email=String(req.body?.email||'').trim().toLowerCase();
    const [[user]]=await pool.execute('SELECT * FROM users WHERE email=?',[email]);
    const dummy='scrypt:00000000000000000000000000000000:'+ '0'.repeat(128);
    const valid=await verifyPassword(req.body?.password,user?.password_hash||dummy);
    if(!valid || !user?.active) throw invalid('Invalid email or password.',401);
    await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
    req.session.userId=user.id; req.session.version=user.session_version; req.session.csrf=randomBytes(32).toString('hex');
    await audit(pool,user.id,'login','users',user.id);
    res.json({user:publicUser(user),csrf:req.session.csrf});
  });
  app.post('/api/logout',async(req,res)=>{
    await new Promise((resolve,reject)=>req.session.destroy(error=>error?reject(error):resolve()));
    res.clearCookie('cosmic.sid',{path:'/'}); res.json({ok:true});
  });
  app.use('/api',async(req,res,next)=>{
    if(!req.session.userId) throw invalid('Please sign in.',401);
    const [[user]]=await pool.execute('SELECT * FROM users WHERE id=?',[req.session.userId]);
    if(!user?.active || user.session_version!==req.session.version) throw invalid('Your session has expired. Please sign in.',401);
    req.user=user; next();
  });
  app.get('/api/meta',(req,res)=>res.json({modules,roles,writable:Object.keys(modules).filter(module=>canWrite(req.user.role,module))}));
  app.post('/api/password',async(req,res)=>{
    if(!await verifyPassword(req.body.current,req.user.password_hash)) throw invalid('Current password is incorrect.');
    const hash=await hashPassword(req.body.password);
    await transaction(pool,async db=>{
      await db.execute('UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=?',[hash,req.user.id]);
      await audit(db,req.user.id,'password_changed','users',req.user.id);
    });
    // Other sessions are revoked. Keep this session after the password change.
    const [[user]]=await pool.execute('SELECT session_version FROM users WHERE id=?',[req.user.id]);
    req.session.version=user.session_version; res.json({ok:true});
  });
  app.get('/api/lookups/:module',async(req,res)=>{
    const module=req.params.module;
    if(!Object.hasOwn(modules,module) && module!=='users') throw invalid('Not found.',404);
    const q=String(req.query.q||'').slice(0,200);
    const [rows]=await pool.execute('SELECT id,name FROM '+module+' WHERE name LIKE ? '+(module==='users'?'AND active=1 ':'')+'ORDER BY name LIMIT 50',['%'+q+'%']);
    res.json(rows);
  });
  app.get('/api/dashboard',async(req,res)=>{
    const [[counts]]=await pool.query("SELECT (SELECT COUNT(*) FROM contacts) contacts,(SELECT COUNT(*) FROM companies) companies,(SELECT COUNT(*) FROM leads WHERE status NOT IN ('converted','unqualified')) leads,(SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done','cancelled') AND due_date<CURRENT_DATE()) overdue_tasks,(SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed')) open_tickets");
    const [pipeline]=await pool.query('SELECT stage,COUNT(*) count,COALESCE(SUM(value),0) value,COALESCE(SUM(value*probability/100),0) weighted FROM deals GROUP BY stage');
    const [invoices]=await pool.query('SELECT currency,status,COUNT(*) count,SUM(total) total FROM invoices GROUP BY currency,status');
    const [tasks]=await pool.query("SELECT t.*,u.name owner_name FROM tasks t LEFT JOIN users u ON u.id=t.owner_id WHERE t.status NOT IN ('done','cancelled') ORDER BY t.due_date IS NULL,t.due_date LIMIT 8");
    const [activity]=await pool.query('SELECT a.id,a.action,a.entity_type,a.entity_id,a.created_at,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 12');
    res.json({counts,pipeline,invoices,tasks,activity});
  });
  app.get('/api/audit',async(req,res)=>{
    if(!['admin','manager'].includes(req.user.role)) throw invalid('Access denied.',403);
    const page=Math.max(1,Math.min(100000,parseInt(req.query.page)||1));
    const [rows]=await pool.query('SELECT a.*,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 50 OFFSET '+((page-1)*50));
    res.json({rows,page});
  });
  app.get('/api/users',async(req,res)=>{
    if(req.user.role!=='admin') throw invalid('Administrator access required.',403);
    const [users]=await pool.query('SELECT id,name,email,role,active,created_at FROM users ORDER BY name'); res.json(users);
  });
  app.post('/api/users',async(req,res)=>{
    if(req.user.role!=='admin') throw invalid('Administrator access required.',403);
    const data=validateUser(req.body), hash=await hashPassword(req.body.password);
    const id=await transaction(pool,async db=>{
      const [result]=await db.execute('INSERT INTO users (name,email,role,active,password_hash) VALUES (?,?,?,?,?)',[data.name,data.email,data.role,data.active,hash]);
      await audit(db,req.user.id,'created','users',result.insertId,{name:data.name,role:data.role}); return result.insertId;
    }); res.status(201).json({id});
  });
  app.put('/api/users/:id',async(req,res)=>{
    if(req.user.role!=='admin') throw invalid('Administrator access required.',403);
    const id=Number(req.params.id); if(!validId(id)) throw invalid('Invalid user.');
    const data=validateUser(req.body);
    if(id===req.user.id && (!data.active || data.role!=='admin')) throw invalid('You cannot disable or demote your own account.');
    const hash=req.body.password?await hashPassword(req.body.password):null;
    await transaction(pool,async db=>{
      // Serialize administrative changes to protect the last active administrator.
      const [admins]=await db.query("SELECT id FROM users WHERE role='admin' AND active=1 FOR UPDATE");
      const [[existing]]=await db.execute('SELECT * FROM users WHERE id=? FOR UPDATE',[id]);
      if(!existing) throw invalid('User not found.',404);
      if(existing.role==='admin' && existing.active && admins.length<=1 && (!data.active||data.role!=='admin')) throw invalid('Keep at least one active administrator.');
      await db.execute('UPDATE users SET name=?,email=?,role=?,active=?,password_hash=?,session_version=session_version+1 WHERE id=?',[data.name,data.email,data.role,data.active,hash||existing.password_hash,id]);
      await audit(db,req.user.id,'updated','users',id,{role:data.role,active:data.active});
    });
    if(id===req.user.id) req.session.version++;
    res.json({ok:true});
  });
  app.param('module',(req,res,next,module)=>{
    if(!Object.hasOwn(modules,module)) return next(invalid('Not found.',404));
    req.module=module;
    if(!['GET','HEAD'].includes(req.method) && !canWrite(req.user.role,module)) return next(invalid('You do not have permission to change these records.',403));
    next();
  });
  app.param('id',(req,res,next,id)=>validId(id)?next():next(invalid('Invalid record ID.')));
  app.get('/api/records/:module',async(req,res)=>{
    const {where,params}=filter(req);
    const page=Math.max(1,Math.min(100000,parseInt(req.query.page)||1));
    const [rows]=await pool.execute('SELECT * FROM '+req.module+where+' ORDER BY id DESC LIMIT 25 OFFSET '+((page-1)*25),params);
    const [[{total}]]=await pool.execute('SELECT COUNT(*) total FROM '+req.module+where,params);
    res.json({rows,total,page,pages:Math.ceil(total/25)});
  });
  app.get('/api/export/:module',async(req,res)=>{
    if(!['admin','manager'].includes(req.user.role)) throw invalid('Only administrators and managers can export records.',403);
    const {where,params}=filter(req);
    const [[{total}]]=await pool.execute('SELECT COUNT(*) total FROM '+req.module+where,params);
    if(total>10000) throw invalid('Export is limited to 10,000 records. Narrow your search or filters.');
    const [rows]=await pool.execute('SELECT * FROM '+req.module+where+' ORDER BY id DESC LIMIT 10000',params);
    const columns=['id',...Object.keys(modules[req.module]),...(financial(req.module)?['subtotal','total']:[]),'created_at','updated_at'];
    const csv=[columns.map(csvCell).join(','),...rows.map(row=>columns.map(key=>csvCell(typeof row[key]==='object'&&row[key]!==null?JSON.stringify(row[key]):row[key])).join(','))].join('\r\n');
    await audit(pool,req.user.id,'exported',req.module,null,{count:rows.length});
    res.type('text/csv').attachment(req.module+'.csv').send('\uFEFF'+csv);
  });
  app.get('/api/records/:module/:id',async(req,res)=>{
    const [[record]]=await pool.execute('SELECT * FROM '+req.module+' WHERE id=?',[req.params.id]);
    if(!record) throw invalid('Record not found.',404);
    const [notes]=await pool.execute('SELECT n.*,u.name author_name FROM notes n LEFT JOIN users u ON u.id=n.author_id WHERE entity_type=? AND entity_id=? ORDER BY n.id DESC',[req.module,req.params.id]);
    const labels={};
    for(const [key,field] of Object.entries(modules[req.module])) {
      if(field.type==='ref'&&record[key]) {
        const [[row]]=await pool.execute('SELECT name FROM '+field.table+' WHERE id=?',[record[key]]);
        if(row) labels[key]=row.name;
      }
    }
    res.json({record,notes,labels});
  });
  app.post('/api/records/:module',async(req,res)=>{
    const data=validate(req.module,req.body);
    if(req.module==='leads'&&data.status==='converted') throw invalid('Use Convert to contact to convert a lead.');
    const id=await transaction(pool,async db=>{
      await references(db,req.module,data);
      const keys=Object.keys(data);
      const [result]=await db.execute('INSERT INTO '+req.module+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')',Object.values(data));
      await audit(db,req.user.id,'created',req.module,result.insertId,{fields:keys}); return result.insertId;
    });
    res.status(201).json({id});
  });
  app.put('/api/records/:module/:id',async(req,res)=>{
    const data=validate(req.module,req.body);
    await transaction(pool,async db=>{
      const existing=await lockedRecord(db,req);
      if(req.module==='leads'&&(existing.status==='converted'||data.status==='converted')) throw invalid('Converted leads are read-only. Use Convert to contact for new conversions.');
      await references(db,req.module,data);
      await db.execute('UPDATE '+req.module+' SET row_version=row_version+1,'+Object.keys(data).map(key=>key+'=?').join(',')+' WHERE id=?',[...Object.values(data),req.params.id]);
      await audit(db,req.user.id,'updated',req.module,Number(req.params.id),{fields:Object.keys(data)});
    }); res.json({ok:true});
  });
  app.delete('/api/records/:module/:id',async(req,res)=>{
    if(!['admin','manager'].includes(req.user.role)) throw invalid('Only administrators and managers can delete records.',403);
    await transaction(pool,async db=>{
      await lockedRecord(db,req);
      await db.execute('DELETE FROM notes WHERE entity_type=? AND entity_id=?',[req.module,req.params.id]);
      await db.execute('DELETE FROM '+req.module+' WHERE id=?',[req.params.id]);
      await audit(db,req.user.id,'deleted',req.module,Number(req.params.id));
    }); res.json({ok:true});
  });
  app.post('/api/records/:module/:id/notes',async(req,res)=>{
    const body=req.body.body;
    if(typeof body!=='string'||!body.trim()||body.length>10000) throw invalid('Note must contain 1–10,000 characters.');
    await transaction(pool,async db=>{
      const [[row]]=await db.execute('SELECT id FROM '+req.module+' WHERE id=? FOR UPDATE',[req.params.id]);
      if(!row) throw invalid('Record not found.',404);
      await db.execute('INSERT INTO notes (entity_type,entity_id,body,author_id) VALUES (?,?,?,?)',[req.module,req.params.id,body.trim(),req.user.id]);
      await audit(db,req.user.id,'note_added',req.module,Number(req.params.id));
    }); res.status(201).json({ok:true});
  });
  app.post('/api/leads/:id/convert',async(req,res)=>{
    if(!canWrite(req.user.role,'leads')) throw invalid('Access denied.',403);
    const contactId=await transaction(pool,async db=>{
      const [[lead]]=await db.execute('SELECT * FROM leads WHERE id=? FOR UPDATE',[req.params.id]);
      if(!lead) throw invalid('Lead not found.',404);
      if(lead.converted_contact_id) return lead.converted_contact_id;
      if(lead.status==='converted') throw invalid('The converted contact was removed. Create a new lead if needed.');
      let companyId=null;
      if(lead.company) {
        const [company]=await db.execute('INSERT INTO companies (name,owner_id) VALUES (?,?)',[lead.company,lead.owner_id]); companyId=company.insertId;
      }
      const [contact]=await db.execute('INSERT INTO contacts (name,email,phone,company_id,owner_id) VALUES (?,?,?,?,?)',[lead.name,lead.email,lead.phone,companyId,lead.owner_id]);
      await db.execute("UPDATE leads SET status='converted',converted_contact_id=? WHERE id=?",[contact.insertId,lead.id]);
      await audit(db,req.user.id,'converted','leads',lead.id,{contact_id:contact.insertId}); return contact.insertId;
    }); res.json({contactId});
  });
  app.post('/api/quotes/:id/invoice',async(req,res)=>{
    if(!canWrite(req.user.role,'invoices')) throw invalid('Access denied.',403);
    const invoiceId=await transaction(pool,async db=>{
      const [[quote]]=await db.execute('SELECT * FROM quotes WHERE id=? FOR UPDATE',[req.params.id]);
      if(!quote) throw invalid('Quote not found.',404);
      if(quote.status!=='accepted') throw invalid('Accept the quote before creating an invoice.');
      const [[already]]=await db.execute("SELECT a.entity_id FROM audit_log a INNER JOIN invoices i ON i.id=a.entity_id WHERE a.action='invoice_from_quote' AND a.entity_type='invoices' AND JSON_EXTRACT(a.details,'$.quote_id')=? LIMIT 1",[Number(quote.id)]);
      if(already) return already.entity_id;
      const [invoice]=await db.execute("INSERT INTO invoices (name,company_id,contact_id,status,due_date,currency,tax_rate,items,notes,owner_id,subtotal,total) VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?)",[quote.name,quote.company_id,quote.contact_id,quote.due_date,quote.currency,quote.tax_rate,typeof quote.items==='string'?quote.items:JSON.stringify(quote.items),quote.notes,quote.owner_id,quote.subtotal,quote.total]);
      await audit(db,req.user.id,'invoice_from_quote','invoices',invoice.insertId,{quote_id:quote.id}); return invoice.insertId;
    }); res.status(201).json({invoiceId});
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));
  app.use(express.static(path.resolve('public'),{index:'index.html',maxAge:0}));
  app.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    let status=error.status||500,message=error.message;
    if(error.code==='ER_DUP_ENTRY') { status=409; message='This email or unique record already exists.'; }
    else if(error.code==='ER_NO_REFERENCED_ROW_2') { status=400; message='A linked record no longer exists. Refresh and try again.'; }
    if(status>=500) { console.error(error); message='Unable to complete the request. Please try again.'; }
    res.status(status).json({error:message});
  });
  return app;
}
function filter(req) {
  const conditions=[],params=[],fields=modules[req.module];
  if(req.query.q) {
    const searchable=Object.entries(fields).filter(([,field])=>['text','email'].includes(field.type)).map(([key])=>key);
    conditions.push('('+searchable.map(key=>key+' LIKE ?').join(' OR ')+')');
    searchable.forEach(()=>params.push('%'+String(req.query.q).slice(0,200)+'%'));
  }
  for(const key of ['status','stage','owner_id','priority']) {
    if(req.query[key]&&fields[key]) { conditions.push(key+'=?'); params.push(String(req.query[key]).slice(0,100)); }
  }
  return {where:conditions.length?' WHERE '+conditions.join(' AND '):'',params};
}
async function lockedRecord(db,req) {
  const [[record]]=await db.execute('SELECT * FROM '+req.module+' WHERE id=? FOR UPDATE',[req.params.id]);
  if(!record) throw invalid('Record not found.',404);
  const incoming=Number(req.body.row_version);
  if(!Number.isSafeInteger(incoming)||incoming!==record.row_version) throw invalid('This record changed since you opened it. Close and reopen it before saving.',409);
  return record;
}
function validateUser(body) {
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120) throw invalid('Name is required (maximum 120 characters).');
  if(typeof body.email!=='string'||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) throw invalid('Valid email required.');
  if(!roles.includes(body.role)||typeof body.active!=='boolean') throw invalid('Invalid role or account status.');
  return {name:body.name.trim(),email:body.email.trim().toLowerCase(),role:body.role,active:body.active};
}

const text = (max=200, required=false) => ({type:'text',max,required});
const choice = (...options) => ({type:'choice',options,required:true});
const ref = table => ({type:'ref',table});
const money = {type:'money',required:true};
const date = {type:'date'};
const owner = {owner_id:ref('users')};
const relation = {company_id:ref('companies'),contact_id:ref('contacts')};
export const modules = {
  companies:{name:text(200,true),website:{type:'url',max:500},email:{type:'email',max:254},phone:text(60),industry:text(120),address:text(5000),...owner},
  contacts:{name:text(200,true),email:{type:'email',max:254},phone:text(60),title:text(120),company_id:ref('companies'),...owner},
  leads:{name:text(200,true),email:{type:'email',max:254},phone:text(60),company:text(),source:text(120),status:choice('new','contacted','qualified','unqualified','converted'),value:money,...owner},
  deals:{name:text(200,true),...relation,stage:choice('qualification','discovery','proposal','negotiation','won','lost'),value:money,probability:{type:'integer',min:0,max:100,required:true},close_date:date,...owner},
  tasks:{name:text(200,true),description:text(10000),status:choice('todo','in_progress','done','cancelled'),priority:choice('low','normal','high','urgent'),due_date:date,...relation,deal_id:ref('deals'),...owner},
  tickets:{name:text(200,true),description:text(10000),status:choice('open','in_progress','waiting','resolved','closed'),priority:choice('low','normal','high','urgent'),...relation,...owner},
  products:{name:text(200,true),sku:text(100),description:text(10000),price:money,active:{type:'boolean',required:true}},
  quotes:{name:text(200,true),...relation,status:choice('draft','sent','accepted','declined','expired'),due_date:date,currency:{type:'currency',required:true},tax_rate:{type:'number',min:0,max:100,required:true},items:{type:'items',required:true},notes:text(10000),...owner},
  invoices:{name:text(200,true),...relation,status:choice('draft','sent','paid','void','overdue'),due_date:date,currency:{type:'currency',required:true},tax_rate:{type:'number',min:0,max:100,required:true},items:{type:'items',required:true},notes:text(10000),...owner}
};
export const financial = module => ['quotes','invoices'].includes(module);
export function validate(module, body) {
  const fields = Object.hasOwn(modules,module)?modules[module]:null;
  if (!fields || !body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Invalid record.');
  const result = {};
  for (const [key,field] of Object.entries(fields)) {
    let value = body[key];
    if (value === '' || value == null) {
      if (field.required) throw invalid(key + ' is required.');
      result[key] = null; continue;
    }
    if (['text','url','email','currency'].includes(field.type)) {
      if (typeof value !== 'string') throw invalid(key + ' must be text.');
      value = value.trim();
      if ((field.required && !value) || value.length > (field.max || 200)) throw invalid(key + ' has an invalid length.');
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw invalid('Invalid email address.');
      if (field.type === 'url') { try { if (!['http:','https:'].includes(new URL(value).protocol)) throw 0; } catch { throw invalid('Website must use http or https.'); } }
      if (field.type === 'currency') { value=value.toUpperCase(); try { if (!/^[A-Z]{3}$/.test(value)) throw 0; new Intl.NumberFormat('en',{style:'currency',currency:value}); } catch { throw invalid('Invalid currency.'); } }
    } else if (field.type === 'choice') {
      if (!field.options.includes(value)) throw invalid('Invalid ' + key + '.');
    } else if (field.type === 'date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value || value<'1000-01-01') throw invalid('Invalid date.');
    } else if (field.type === 'ref') {
      if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1 || Number(value)>4294967295) throw invalid('Invalid ' + key + '.');
      value=Number(value);
    } else if (field.type === 'boolean') {
      if (![true,false,0,1].includes(value)) throw invalid('Invalid ' + key + '.');
      value=Boolean(value);
    } else if (field.type === 'items') {
      const calculated = calculateItems(value, Number(body.tax_rate));
      value=JSON.stringify(calculated.items);
      result.subtotal=calculated.subtotal; result.total=calculated.total;
    } else {
      if (!['number','string'].includes(typeof value) || !Number.isFinite(Number(value))) throw invalid('Invalid ' + key + '.');
      value=Number(value);
      if (value < (field.min ?? 0) || value > (field.max ?? 999999999999.99) || (field.type==='integer' && !Number.isInteger(value))) throw invalid('Invalid ' + key + '.');
      if (field.type==='money' || key==='tax_rate') value=Math.round(value*100)/100;
    }
    result[key]=value;
  }
  return result;
}
export function invalid(message,status=400) { return Object.assign(new Error(message),{status}); }
export function calculateItems(items, taxRate) {
  if (!Array.isArray(items) || !items.length || items.length>100 || !Number.isFinite(taxRate) || taxRate<0 || taxRate>100) throw invalid('Provide 1–100 line items and a valid tax rate.');
  let cents=0;
  const clean=items.map(item=>{
    if (!item || typeof item.description!=='string' || !item.description.trim() || item.description.length>500) throw invalid('Each line item requires a description.');
    const quantity=Number(item.quantity), price=Number(item.price);
    if (!Number.isFinite(quantity) || quantity<=0 || quantity>100000 || !Number.isFinite(price) || price<0 || price>999999999) throw invalid('Invalid line item quantity or price.');
    const roundedPrice=Math.round(price*100)/100;
    cents+=Math.round(quantity*Math.round(roundedPrice*100));
    return {description:item.description.trim(),quantity,price:roundedPrice};
  });
  const totalCents=cents+Math.round(cents*taxRate/100);
  if (totalCents>99999999999999) throw invalid('Total exceeds supported amount.');
  return {items:clean,subtotal:cents/100,total:totalCents/100};
}

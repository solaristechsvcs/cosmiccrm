import { modules, financial } from './modules.js';
const timestamps='created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)';
function column(key,field) {
  let type;
  if (field.type==='ref') type='INT UNSIGNED';
  else if (field.type==='choice') type='VARCHAR(30)';
  else if (field.type==='integer') type='INT';
  else if (field.type==='money') type='DECIMAL(14,2)';
  else if (field.type==='number') type='DECIMAL(5,2)';
  else if (field.type==='boolean') type='BOOLEAN';
  else if (field.type==='items') type='JSON';
  else if (field.type==='date') type='DATE';
  else if (field.type==='currency') type='CHAR(3)';
  else type=field.max>500?'TEXT':'VARCHAR('+(field.max||200)+')';
  return key+' '+type+(field.required?' NOT NULL':'');
}
export const migrations=[{version:1,statements:[
  'CREATE TABLE IF NOT EXISTS users (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(254) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, session_version INT NOT NULL DEFAULT 1, '+timestamps+') ENGINE=InnoDB',
  ...Object.entries(modules).map(([name,fields])=>{
    const columns=Object.entries(fields).map(([key,field])=>column(key,field));
    const keys=Object.entries(fields).filter(([,field])=>field.type==='ref').map(([key,field])=>'FOREIGN KEY ('+key+') REFERENCES '+field.table+'(id) ON DELETE SET NULL');
    if (financial(name)) columns.push('subtotal DECIMAL(14,2) NOT NULL','total DECIMAL(14,2) NOT NULL');
    if (name==='leads') { columns.push('converted_contact_id INT UNSIGNED'); keys.push('FOREIGN KEY (converted_contact_id) REFERENCES contacts(id) ON DELETE SET NULL'); }
    return 'CREATE TABLE IF NOT EXISTS '+name+' (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, '+[...columns,'row_version INT NOT NULL DEFAULT 1',timestamps,...keys,'INDEX(name)'].join(', ')+') ENGINE=InnoDB';
  }),
  'CREATE TABLE IF NOT EXISTS notes (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, entity_type VARCHAR(30) NOT NULL, entity_id INT UNSIGNED NOT NULL, body TEXT NOT NULL, author_id INT UNSIGNED, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL, INDEX(entity_type,entity_id)) ENGINE=InnoDB',
  'CREATE TABLE IF NOT EXISTS audit_log (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor_id INT UNSIGNED, action VARCHAR(60) NOT NULL, entity_type VARCHAR(30) NOT NULL, entity_id INT UNSIGNED, details JSON, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX(created_at), INDEX(entity_type,entity_id)) ENGINE=InnoDB'
]}];

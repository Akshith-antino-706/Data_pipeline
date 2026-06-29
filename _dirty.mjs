import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
const c=new pg.Client({host:'raynadb.cx2ygcy4akh9.eu-north-1.rds.amazonaws.com',port:5432,database:'postgres',user:'raynadb',password:'raynadevdb',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:60000,statement_timeout:0});
await c.connect();

// counts per dirty category for J242
const counts=(await c.query(`
  WITH base AS (
    SELECT lower(uc.email) email, uc.email_unsubscribe
    FROM journey_entries je JOIN unified_contacts uc ON uc.id=je.customer_id
    WHERE je.journey_id=242)
  SELECT
    COUNT(*)::int total,
    COUNT(*) FILTER (WHERE lower(coalesce(email_unsubscribe,''))='yes')::int unsub,
    COUNT(*) FILTER (WHERE email IS NULL OR email='' OR email NOT LIKE '%@%.%')::int invalid,
    COUNT(*) FILTER (WHERE email LIKE '%@raynatours.com' OR email LIKE '%@raynab2b.com')::int internal,
    (COUNT(*) - COUNT(DISTINCT email))::int dup_extra
  FROM base`)).rows[0];
console.log('=== J242 dirty breakdown (of '+counts.total+' entries) ===');
console.log('  unsubscribed   :', counts.unsub);
console.log('  invalid email  :', counts.invalid);
console.log('  internal/staff :', counts.internal);
console.log('  duplicate (extra copies):', counts.dup_extra);

// write FULL dirty list to CSV
const out='/Users/rocky/Desktop/Projects/Data_pipeline/j242_dirty_list.csv';
fs.writeFileSync(out,'email,name,contact_type,reason_unsubscribed,reason_invalid,reason_internal,times_in_journey\n');
const res=await c.query(`
  WITH base AS (
    SELECT uc.id, lower(uc.email) email, uc.name, uc.contact_type, uc.email_unsubscribe
    FROM journey_entries je JOIN unified_contacts uc ON uc.id=je.customer_id
    WHERE je.journey_id=242),
  flagged AS (
    SELECT email, name, contact_type,
      (lower(coalesce(email_unsubscribe,''))='yes') unsub,
      (email IS NULL OR email='' OR email NOT LIKE '%@%.%') invalid,
      (email LIKE '%@raynatours.com' OR email LIKE '%@raynab2b.com') internal,
      COUNT(*) OVER (PARTITION BY email) cnt
    FROM base)
  SELECT * FROM flagged WHERE unsub OR invalid OR internal OR cnt>1`);
const esc=s=>{ s=(s===null||s===undefined)?'':String(s); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
let buf='';
for(const r of res.rows){ buf+=[esc(r.email),esc(r.name),esc(r.contact_type),r.unsub?'Y':'',r.invalid?'Y':'',r.internal?'Y':'',r.cnt].join(',')+'\n'; }
fs.appendFileSync(out,buf);
console.log('\nFull dirty list written: '+out);
console.log('  rows in CSV:', res.rows.length);

// small sample of each
const sample=async(label,where)=>{const r=(await c.query(`SELECT DISTINCT lower(uc.email) email, uc.name FROM journey_entries je JOIN unified_contacts uc ON uc.id=je.customer_id WHERE je.journey_id=242 AND (${where}) LIMIT 8`)).rows;console.log('\n'+label+' (sample):');r.forEach(x=>console.log('  '+x.email+(x.name?' ('+x.name+')':'')));};
await sample('UNSUBSCRIBED', `lower(coalesce(uc.email_unsubscribe,''))='yes'`);
await sample('INVALID', `uc.email IS NULL OR uc.email='' OR uc.email NOT LIKE '%@%.%'`);
await sample('INTERNAL/STAFF', `uc.email LIKE '%@raynatours.com' OR uc.email LIKE '%@raynab2b.com'`);
await c.end();process.exit(0);

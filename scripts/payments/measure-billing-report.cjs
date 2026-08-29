const XLSX = require('xlsx'), fs = require('fs'), path = require('path');
const F = 'D:/Claude CoWork/PTB/SAP Automation/exports/Billing Report - 010826 to 290826.xlsx';
const DOCS = 'D:/PTB/Website/portal_phase1a_setup/portal/docs';
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
const xd = v => { if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; }
  const s = String(v).trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : s.slice(0,10); };

const wb = XLSX.read(fs.readFileSync(F), { type:'buffer', raw:true });
const aoa = XLSX.utils.sheet_to_json(wb.Sheets['Data'], { header:1, defval:'', raw:true });
const hdr = aoa[3].map(h => String(h).trim());
console.log('COLUMNS (' + hdr.filter(Boolean).length + '):', hdr.filter(Boolean).join(' | '));
const rows = aoa.slice(4).filter(r => String(r[5]||'').trim())
  .map(r => Object.fromEntries(hdr.map((h,i) => [h || 'col'+i, r[i]])));
console.log('\nrows:', rows.length, '(header says', aoa[1][1] + ')');

const get = (r, ...names) => { for (const n of names) if (r[n] !== undefined && String(r[n]).trim() !== '') return r[n]; return ''; };
const inv = rows.map(r => ({
  no: String(get(r,'Dealer invoice number')).trim(),
  date: xd(get(r,'Billing Date')),
  plant: String(get(r,'Plant')).trim(),
  reg: String(get(r,'Reg.No')).trim(),
  order: String(get(r,'Order number')).trim(),
  cust: String(get(r,'Customer Name')).trim(),
  total: num(get(r,'Total')),
  net: num(get(r,'Net value')),
  otype: String(get(r,'Order Type')).trim(),
  odesc: String(get(r,'Order Type description')).trim(),
  btype: String(get(r,'Billing Type')).trim(),
  bdesc: String(get(r,'Billing Type description')).trim(),
  eng: String(get(r,'Engine Number')).trim(),
  extra: Object.values(r).slice(-2).map(v=>String(v).trim()),
}));

const tally = (arr, f) => { const o = {}; arr.forEach(x => { const k = f(x) || '(blank)'; o[k] = (o[k]||0)+1; });
  return Object.entries(o).sort((a,b)=>b[1]-a[1]); };
console.log('\nOrder types:', tally(inv, i=>`${i.otype} ${i.odesc}`).map(([k,v])=>`${k}=${v}`).join(' | '));
console.log('Billing types:', tally(inv, i=>`${i.btype} ${i.bdesc}`).map(([k,v])=>`${k}=${v}`).join(' | '));
console.log('Invoice prefixes:', tally(inv, i=>i.no.slice(0,3)).map(([k,v])=>`${k}=${v}`).join(' | '));
console.log('Plants:', tally(inv, i=>i.plant).map(([k,v])=>`${k}=${v}`).join(' | '));
const dates = inv.map(i=>i.date).sort();
console.log('Date span:', dates[0], '->', dates[dates.length-1]);
console.log('Total value: Rs', Math.round(inv.reduce((s,i)=>s+i.total,0)).toLocaleString('en-IN'));
console.log('Negative/zero totals:', inv.filter(i=>i.total<=0).length);
console.log('Duplicate invoice numbers:', inv.length - new Set(inv.map(i=>i.no)).size);
console.log('Blank reg no:', inv.filter(i=>!i.reg).length, '| blank customer:', inv.filter(i=>!i.cust).length);
console.log('\nRs1930 invoices here:', inv.filter(i=>Math.round(i.total)===1930).length,
            '| Rs1700:', inv.filter(i=>Math.round(i.total)===1700).length,
            '| Rs3400:', inv.filter(i=>Math.round(i.total)===3400).length);

// cash vs credit
const isCash = i => /Cash/i.test(i.odesc) || /Cash/i.test(i.bdesc);
console.log('cash-type invoices:', inv.filter(isCash).length, '| credit-type:', inv.filter(i=>!isCash(i)).length);

// ---- JOIN vs UPI ----
function csv(f){const L=fs.readFileSync(path.join(DOCS,f),'utf8').split(/\r?\n/).filter(l=>l.trim());
 return L.slice(1).map(l=>{const p=[];let c='',q=false;for(const ch of l){if(ch==='"')q=!q;else if(ch===','&&!q){p.push(c);c='';}else c+=ch;}p.push(c);return p;});}
const bp=csv('statement (3).csv').map(r=>({src:'bharatpe',d:r[0].slice(0,10),amt:num(r[5]),payer:r[2],note:''}));
const gp=csv('GPay_Business_Transactions_20260801-20260826_1787735100405.csv').map(r=>({src:'gpay',d:r[3].slice(0,10),amt:num(r[5]),payer:r[0],note:r[10]||''}));
const receipts=[...bp,...gp].filter(r=>r.amt>50 && r.d>=dates[0] && r.d<='2026-08-26');
console.log('\n=== JOIN: UPI receipts vs BILLING REPORT ===');
console.log('receipts in window:', receipts.length, '| value Rs', Math.round(receipts.reduce((s,r)=>s+r.amt,0)).toLocaleString('en-IN'));

const D=s=>new Date(s+'T00:00:00Z').getTime();
const pc=n=>(100*n/receipts.length).toFixed(1)+'%';
// group invoices by order number (a job may bill parts+labour separately)
const orders=new Map();
for(const i of inv){ if(!i.order) continue;
  if(!orders.has(i.order)) orders.set(i.order,{order:i.order,total:0,date:i.date,cust:i.cust,reg:i.reg,n:0});
  const o=orders.get(i.order); o.total+=i.total; o.n++; if(i.date<o.date)o.date=i.date; }
const orderArr=[...orders.values()];
console.log('orders (invoices grouped):', orderArr.length, '| multi-invoice orders:', orderArr.filter(o=>o.n>1).length);

for (const w of [1,3,7]) {
  let one=0,many=0,none=0;
  for(const r of receipts){
    const s=new Set();
    inv.forEach(i=>{ if(Math.round(i.total)===Math.round(r.amt) && Math.abs(D(i.date)-D(r.d))<=w*864e5) s.add('I'+i.no); });
    orderArr.forEach(o=>{ if(Math.round(o.total)===Math.round(r.amt) && Math.abs(D(o.date)-D(r.d))<=w*864e5) s.add('O'+o.order); });
    if(s.size===1)one++; else if(s.size>1)many++; else none++;
  }
  console.log(`  ±${w}d: exactly-1 ${one} (${pc(one)}) | multiple ${many} (${pc(many)}) | none ${none} (${pc(none)})`);
}
// value coverage
let cov=0; for(const r of receipts){ if(inv.some(i=>Math.round(i.total)===Math.round(r.amt)&&Math.abs(D(i.date)-D(r.d))<=3*864e5)) cov+=r.amt; }
console.log('  receipt value with >=1 candidate (±3d): Rs', Math.round(cov).toLocaleString('en-IN'));

// customer-name overlap between payer and invoice customer
const norm=s=>String(s).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(t=>t.length>2);
let nameHelp=0;
for(const r of receipts){
  const cands=inv.filter(i=>Math.round(i.total)===Math.round(r.amt)&&Math.abs(D(i.date)-D(r.d))<=3*864e5);
  if(cands.length<2) continue;
  const pt=norm(r.payer);
  const narrowed=cands.filter(c=>norm(c.cust).some(t=>pt.includes(t)));
  if(narrowed.length===1) nameHelp++;
}
console.log('  ambiguous cases resolved to 1 by payer-name token overlap:', nameHelp);

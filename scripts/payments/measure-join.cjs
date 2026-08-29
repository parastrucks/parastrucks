const XLSX = require('xlsx');
const fs = require('fs'), path = require('path');
const EXP = 'D:/Claude CoWork/PTB/SAP Automation/exports';
const DOCS = 'D:/PTB/Website/portal_phase1a_setup/portal/docs';
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
function xdate(v) {
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; }
  const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/); if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  return s.slice(0,10);
}
function rowsOf(file, must) {
  const wb = XLSX.read(fs.readFileSync(file), { type:'buffer', raw:true });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'', raw:true });
  for (let i=0;i<Math.min(10,aoa.length);i++){
    const row=aoa[i].map(c=>String(c).trim());
    if (must.every(m=>row.includes(m))) {
      const hdr=row;
      return aoa.slice(i+1).filter(r=>r.some(c=>String(c).trim()!==''))
        .map(r=>Object.fromEntries(hdr.map((h,k)=>[h,r[k]])));
    }
  } return [];
}
// CUSTOMER-PAYABLE split types (everything else bills to Ashok Leyland / is free)
const PAYABLE = new Set(['Post warranty /Paid Order', 'Accident Order', 'Repeat Jobs']);

const invoices = new Map();
const files = fs.readdirSync(EXP);
for (const f of files) {
  const isR5=/^R5_wssales_/.test(f), isR6=/^R6_labour_/.test(f);
  if (!isR5 && !isR6) continue;
  const rows = rowsOf(path.join(EXP,f), isR5?['Dealer Invoice Number','With Tax Amount']:['Dealer Invoice Number']);
  for (const r of rows) {
    const inv=String(r['Dealer Invoice Number']||'').trim(); if(!inv) continue;
    const split=String(r['Split Order Type']||'').trim();
    const amtCol = isR5?'With Tax Amount':(r['Amount']!==undefined?'Amount':'Net Value');
    const line=num(r[amtCol]);
    const job=String(r['DBM Order No']||r['Job Card No']||'').trim();
    if(!invoices.has(inv)) invoices.set(inv,{inv,kind:isR5?'R5':'R6',date:xdate(r['Invoice Date']),
      cust:String(r['Customer']||'').trim(), custCode:String(r['Customer Code']||'').trim(),
      reg:String(r['Registration No']||'').trim(), job, amt:0, split,
      terms:String(r['Payment Terms Description']||'').trim(), seen:new Set()});
    const o=invoices.get(inv);
    const sig=`${r['Part No']||r['ROT/Work Order Code']||''}|${r['Quantity']||''}|${line}`;
    if(o.seen.has(sig)) continue; o.seen.add(sig);
    o.amt+=line; if(!o.job&&job) o.job=job;
  }
}
const all=[...invoices.values()];
const paid=all.filter(i=>PAYABLE.has(i.split));
console.log(`Distinct invoices: ${all.length} | customer-payable: ${paid.length} | billed-to-AL/free: ${all.length-paid.length}`);
const bySplit={}; all.forEach(i=>bySplit[i.split]=(bySplit[i.split]||0)+1);
console.log('by split type:',Object.entries(bySplit).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join(' | '));
const dates=paid.map(i=>i.date).sort();
console.log(`payable span ${dates[0]} -> ${dates[dates.length-1]} | value Rs ${Math.round(paid.reduce((s,i)=>s+i.amt,0)).toLocaleString('en-IN')}`);
const cashN=paid.filter(i=>/cash/i.test(i.terms)).length;
console.log(`payment terms: cash=${cashN} credit=${paid.length-cashN}`);

// jobs
const jobs=new Map();
for(const i of paid){ if(!i.job) continue;
  if(!jobs.has(i.job)) jobs.set(i.job,{job:i.job,amt:0,date:i.date,cust:i.cust,reg:i.reg,n:0});
  const j=jobs.get(i.job); j.amt+=i.amt; j.n++; if(i.date<j.date) j.date=i.date; }
const jobArr=[...jobs.values()];
console.log(`jobs: ${jobArr.length} (${jobArr.filter(j=>j.n>1).length} have both parts+labour)`);

// UPI
function csv(f){const L=fs.readFileSync(path.join(DOCS,f),'utf8').split(/\r?\n/).filter(l=>l.trim());
 return L.slice(1).map(l=>{const p=[];let c='',q=false;for(const ch of l){if(ch==='"')q=!q;else if(ch===','&&!q){p.push(c);c='';}else c+=ch;}p.push(c);return p;});}
const bp=csv('statement (3).csv').map(r=>({src:'bharatpe',d:r[0].slice(0,10),amt:num(r[5]),payer:r[2],note:''}));
const gp=csv('GPay_Business_Transactions_20260801-20260826_1787735100405.csv').map(r=>({src:'gpay',d:r[3].slice(0,10),amt:num(r[5]),payer:r[0],note:r[10]||''}));
const receipts=[...bp,...gp].filter(r=>r.amt>50 && r.d>='2026-08-06' && r.d<='2026-08-25');
console.log(`\nUPI receipts in the SAP-covered window (6-25 Aug, >Rs50): ${receipts.length} | value Rs ${Math.round(receipts.reduce((s,r)=>s+r.amt,0)).toLocaleString('en-IN')}`);

const D=s=>new Date(s+'T00:00:00Z').getTime();
const cand=(r,pool,w)=>pool.filter(x=>Math.abs(D(x.date)-D(r.d))<=w*864e5 && Math.round(x.amt)===Math.round(r.amt));
const pc=n=>(100*n/receipts.length).toFixed(1)+'%';
for (const w of [3,7]) {
  let one=0,many=0,none=0;
  for(const r of receipts){ const s=new Set([...cand(r,paid,w).map(x=>'I'+x.inv),...cand(r,jobArr,w).map(x=>'J'+x.job)]);
    if(s.size===1)one++; else if(s.size>1)many++; else none++; }
  console.log(`  match invoice-or-job (±${w}d): exactly-1 ${one} (${pc(one)}) | multiple ${many} (${pc(many)}) | none ${none} (${pc(none)})`);
}
// how much of the money is explained
const matchedVal=receipts.filter(r=>cand(r,paid,7).length||cand(r,jobArr,7).length).reduce((s,r)=>s+r.amt,0);
console.log(`  receipt value with any amount-candidate: Rs ${Math.round(matchedVal).toLocaleString('en-IN')} of Rs ${Math.round(receipts.reduce((s,r)=>s+r.amt,0)).toLocaleString('en-IN')}`);
const af={}; receipts.forEach(r=>af[r.amt]=(af[r.amt]||0)+1);
console.log('  top receipt amounts:',Object.entries(af).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([a,c])=>`Rs${a} x${c}`).join(' | '));
const ai={}; paid.forEach(i=>ai[Math.round(i.amt)]=(ai[Math.round(i.amt)]||0)+1);
console.log('  top invoice amounts:',Object.entries(ai).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([a,c])=>`Rs${a} x${c}`).join(' | '));

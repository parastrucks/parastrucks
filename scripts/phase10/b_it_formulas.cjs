// INVOICE TRACKER: formula patterns, retention claim, diff_tds, variance scan, comments
const XLSX = require('xlsx');
const wb = XLSX.readFile('D:/PTB/Finances/2025-26/INVOICE TRACKER 2025-26.xlsx', {cellFormula:true, cellComments:true});
const ws = wb.Sheets['INVOICE TRACKER'];
const range = XLSX.utils.decode_range(ws['!ref']);
const HDR = [];
for (let c = range.s.c; c <= range.e.c; c++) {
  const cell = ws[XLSX.utils.encode_cell({r:0,c})];
  HDR[c] = cell ? String(cell.v).replace(/\s+/g,' ').trim() : `col${c}`;
}
const num = v => typeof v === 'number' ? v : 0;
const val = (r,c) => { const x = ws[XLSX.utils.encode_cell({r,c})]; return x ? x.v : null; };
const frm = (r,c) => { const x = ws[XLSX.utils.encode_cell({r,c})]; return x ? x.f : undefined; };

// ---- 1. retention value tests (col R=17) ----
{
  let n=0, mSimple=0, mFull=0, ctcZero=0, other=[];
  for (let r=1; r<=range.e.r; r++) {
    const ret = val(r,17); if (ret == null || typeof ret !== 'number') continue;
    const ctc = num(val(r,15)), ctd = num(val(r,16));
    const amc = num(val(r,12)), dsa = num(val(r,13)), ab = num(val(r,14));
    n++;
    const simple = ctc - ctd;
    const full = ctc === 0 ? 0 : ctc - ctd - amc - dsa - ab;
    if (Math.abs(ret - simple) < 0.51) mSimple++;
    if (Math.abs(ret - full) < 0.51) mFull++;
    else if (other.length < 10) other.push(`r${r+1}: ret=${ret} ctc=${ctc} ctd=${ctd} amc=${val(r,12)} dsa=${val(r,13)} ab=${val(r,14)} f=${frm(r,17)}`);
    if (ctc === 0) ctcZero++;
  }
  console.log(`RETENTION n=${n} match(ctc-ctd)=${mSimple} (${(100*mSimple/n).toFixed(1)}%) match(full IF)=${mFull} (${(100*mFull/n).toFixed(1)}%) ctcZeroRows=${ctcZero}`);
  console.log('  mismatches vs full:'); other.forEach(x=>console.log('   '+x));
}
// ---- 2. diff TDS (col 31) vs diff amount (28) & diff base (29) ----
{
  let n=0, mAmt=0, mBase=0;
  for (let r=1; r<=range.e.r; r++) {
    const v = val(r,31); if (typeof v !== 'number') continue; n++;
    if (Math.abs(v - num(val(r,28))*0.001) < 0.51) mAmt++;
    if (Math.abs(v - num(val(r,29))*0.001) < 0.51) mBase++;
  }
  console.log(`DIFF_TDS n=${n} match(amount*0.1%)=${mAmt} (${(100*mAmt/n).toFixed(1)}%) match(base*0.1%)=${mBase} (${(100*mBase/n).toFixed(1)}%)`);
}
// ---- 3. TDS(19) and TOTAL PAYMENT TO AL(20) ----
{
  let n=0, mTds=0, mTot=0;
  for (let r=1; r<=range.e.r; r++) {
    const tds = val(r,19); if (typeof tds !== 'number') continue; n++;
    if (Math.abs(tds - num(val(r,18))*0.001) < 0.51) mTds++;
    const tot = val(r,20);
    if (typeof tot === 'number' && Math.abs(tot - (num(val(r,18)) - num(val(r,19)))) < 0.51) mTot++;
  }
  console.log(`TDS n=${n} match(payment*0.1%)=${mTds}; TOTAL_PAY_AL match(payment-tds)=${mTot}`);
}
// ---- 4. per-column formula variance scan ----
{
  const norm = f => f.replace(/(\$?[A-Z]{1,2}\$?)\d+/g, '$1#').replace(/\s+/g,'');
  const byCol = new Map();
  for (const addr in ws) {
    if (addr[0] === '!') continue;
    const cell = ws[addr];
    if (!cell.f) continue;
    const {r, c} = XLSX.utils.decode_cell(addr);
    if (r === 0) continue;
    if (!byCol.has(c)) byCol.set(c, new Map());
    const m = byCol.get(c);
    const k = norm(cell.f);
    if (!m.has(k)) m.set(k, {n:0, ex:addr});
    m.get(k).n++;
  }
  console.log('\nFORMULA VARIANCE (col: total formulas | dominant pattern n | deviant cells):');
  let totalDeviant = 0;
  for (const [c, m] of [...byCol.entries()].sort((a,b)=>a[0]-b[0])) {
    const pats = [...m.entries()].sort((a,b)=>b[1].n-a[1].n);
    const tot = pats.reduce((s,p)=>s+p[1].n,0);
    const dev = tot - pats[0][1].n;
    totalDeviant += dev;
    if (dev > 0 || pats.length > 1)
      console.log(`  ${XLSX.utils.encode_col(c)} ${HDR[c].slice(0,26)}: total=${tot} dominant="${pats[0][0].slice(0,60)}"×${pats[0][1].n} deviants=${dev} patterns=${pats.length}` +
        (pats.length>1 ? ` | 2nd="${pats[1][0].slice(0,50)}"×${pats[1][1].n} @${pats[1][1].ex}` : ''));
  }
  console.log(`  TOTAL deviant-from-dominant formula cells: ${totalDeviant}`);
}
// ---- 5. comments census ----
{
  console.log('\nCOMMENTS:');
  const byCol = new Map();
  for (const addr in ws) {
    if (addr[0] === '!') continue;
    const cell = ws[addr];
    if (!cell.c || !cell.c.length) continue;
    const { r } = XLSX.utils.decode_cell(addr);
    if (!byCol.has(c)) byCol.set(c, []);
    const txt = cell.c.map(x => (x.t||'')).join(' / ').replace(/\s+/g,' ').trim();
    byCol.get(c).push(`${addr}: "${txt.slice(0,90)}"`);
  }
  for (const [c, list] of [...byCol.entries()].sort((a,b)=>a[0]-b[0])) {
    console.log(`  col ${XLSX.utils.encode_col(c)} ${HDR[c].slice(0,24)} (${list.length}):`);
    list.slice(0,6).forEach(x=>console.log('    '+x));
    if (list.length > 6) console.log(`    ...+${list.length-6} more`);
  }
}
// ---- 6. qty + AMC/DSA/ADBLUE population ----
{
  let qtyNe1=0, qn=0, amcPop=0, dsaPop=0, abPop=0, amcText=0, n=0;
  for (let r=1; r<=range.e.r; r++) {
    if (val(r,5) == null) continue; n++;
    const q = val(r,10); if (q != null) { qn++; if (q !== 1) qtyNe1++; }
    const amc = val(r,12); if (amc != null && amc !== 0 && amc !== '') { amcPop++; if (typeof amc !== 'number') amcText++; }
    const dsa = val(r,13); if (dsa != null && dsa !== 0 && dsa !== '') dsaPop++;
    const ab = val(r,14); if (ab != null && ab !== 0 && ab !== '') abPop++;
  }
  console.log(`\nQTY: rows=${n} qtyNonNull=${qn} qty!=1: ${qtyNe1}`);
  console.log(`AMC populated=${amcPop} (text=${amcText}) DSA populated=${dsaPop} ADBLUE populated=${abPop} => exclusive-basis rows(any pop)=n/a see next`);
  let anyPop=0;
  for (let r=1; r<=range.e.r; r++) {
    if (val(r,5) == null) continue;
    const p = c => { const v = val(r,c); return v != null && v !== 0 && v !== ''; };
    if (p(12)||p(13)||p(14)) anyPop++;
  }
  console.log(`rows with ANY of AMC/DSA/ADBLUE populated (would be ctc_basis=exclusive): ${anyPop}/${n}`);
}
// ---- 7. AGEING + Interest formula sample ----
{
  for (const r of [1,2,3]) console.log(`AGEING r${r+1} f=${frm(r,24)} | INTEREST f=${frm(r,33)}`);
}

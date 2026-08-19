// Sale-side formulas (INV_LIST PTB RETAIL + FY), G-series, 3-way retention, VIN, DSE slab
const XLSX = require('xlsx');
const rd = p => XLSX.readFile(p, {cellFormula:true, raw:true});
const invList = rd('C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/INVOICE LIST - MAR 26.xlsx');
const fy = rd('C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/2025-26.xlsx');
const invTrk = rd('D:/PTB/Finances/2025-26/INVOICE TRACKER 2025-26.xlsx');
const retInt = rd("D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -INTERNAL.xlsx");
const retAl = rd("D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -AL.xlsx");
const alBs = rd('D:/PTB/Finances/2025-26/2026-03 - MARCH/AL Balance Sheet -0326.xlsx');
const rows = (wb, s) => XLSX.utils.sheet_to_json(wb.Sheets[s], {header:1, raw:true, defval:null});
const num = v => typeof v === 'number' ? v : 0;
const CH = /^MB1[A-Z0-9]{14}$/;

const pr = rows(invList, 'PTB RETAIL'); // 15 TALLY,16 CTC,17 AMC,18 TCS,19 TOTAL,24 TOTAL RECD,26 CRETEM,28 TOT RECV,29 NET REFUND,30 RefStat,9 Qty,35 ADBLU,36 CTD,37 ENDHAN
const fyr = rows(fy, 'Sheet1');        // 14 CUSTBILL,15 CTC,16 AMC,17 TCS,18 TOTAL,23 TOT RECD,25 CRETEM,27 TOT RECV,28 NET REFUND,29 RefStat,8 Qty,34 ADBLU,35 CTD,36 ENDHAN

// ---- TOTAL / TCS ----
function saleTests(name, R, i) {
  let n=0, mCt=0, mTally=0, tcsN=0, tcsCtc=0, tcsTally=0;
  for (let r=1; r<R.length; r++) {
    const tot = R[r][i.total]; if (typeof tot !== 'number' || tot === 0) continue; n++;
    const ctc = num(R[r][i.ctc]), tally = num(R[r][i.tally]), amc = num(R[r][i.amc]), tcs = num(R[r][i.tcs]);
    if (Math.abs(tot - (ctc + tcs)) < 1) mCt++;
    if (Math.abs(tot - (tally + amc + tcs)) < 1) mTally++;
  }
  for (let r=1; r<R.length; r++) {
    const tcs = R[r][i.tcs]; if (typeof tcs !== 'number' || tcs === 0) continue; tcsN++;
    if (Math.abs(tcs - num(R[r][i.ctc])*0.01) < 1) tcsCtc++;
    if (Math.abs(tcs - num(R[r][i.tally])*0.01) < 1) tcsTally++;
  }
  console.log(`${name}: TOTAL n=${n} match(ctc+tcs)=${mCt} (${(100*mCt/n).toFixed(1)}%) match(tally+amc+tcs)=${mTally} (${(100*mTally/n).toFixed(1)}%)`);
  console.log(`${name}: TCS n=${tcsN} match(ctc*1%)=${tcsCtc} (${(100*tcsCtc/tcsN).toFixed(1)}%) match(tally*1%)=${tcsTally} (${(100*tcsTally/tcsN).toFixed(1)}%)`);
}
saleTests('PTB_RETAIL', pr, {total:19, ctc:16, tally:15, amc:17, tcs:18});
saleTests('FY', fyr, {total:18, ctc:15, tally:14, amc:16, tcs:17});

// ---- sample formulas for TOTAL, TOTAL RECD, TOTAL RECEIVABLE, NET REFUND ----
{
  const ws = invList.Sheets['PTB RETAIL'];
  const f = a => ws[a] ? ws[a].f : undefined;
  console.log(`PTB_RETAIL formulas r2: TOTAL=${f('T2')} TOTRECD=${f('Y2')} TOTRECV=${f('AC2')} NETREF=${f('AD2')}`);
  console.log(`  r5: TOTAL=${f('T5')} NETREF=${f('AD5')}`);
}

// ---- CRETEM distribution ----
function dist(name, R, c) {
  const m = new Map();
  for (let r=1; r<R.length; r++) {
    const v = R[r][c]; if (v == null || v === '') continue;
    const k = JSON.stringify(v); m.set(k, (m.get(k)||0)+1);
  }
  const top = [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log(`${name}: distinct=${m.size} top: ${top.map(([k,n])=>`${k}×${n}`).join(' ')}`);
}
dist('CRETEM PTB_RETAIL(col26)', pr, 26);
dist('CRETEM FY(col25)', fyr, 25);

// ---- text-in-money columns ----
function textiness(name, R, c) {
  let pop=0, txt=0; const ex=[];
  for (let r=1; r<R.length; r++) {
    const v = R[r][c]; if (v == null || v === '') continue; pop++;
    if (typeof v !== 'number') { txt++; if (ex.length<4) ex.push(JSON.stringify(v).slice(0,30)); }
  }
  console.log(`${name}: populated=${pop} text=${txt} (${pop?(100*txt/pop).toFixed(1):0}%) ex: ${ex.join(' ')}`);
}
textiness('AMC PTB_RETAIL(17)', pr, 17);
textiness('AMC FY(16)', fyr, 16);
textiness('ENDHAN PTB_RETAIL(37)', pr, 37);
textiness('ENDHAN FY(36)', fyr, 36);
textiness('ADBLU PTB_RETAIL(35)', pr, 35);
textiness('ADBLU FY(34)', fyr, 34);
const it = rows(invTrk, 'INVOICE TRACKER');
textiness('PartsPkg IT(34)', it, 34);

// ---- G1 mixed-sign multi-chassis customers ----
function mixedSign(name, R, custC, nrC) {
  const by = new Map();
  for (let r=1; r<R.length; r++) {
    const cu = String(R[r][custC]||'').trim().toUpperCase(); if (!cu) continue;
    const nr = R[r][nrC]; if (typeof nr !== 'number') continue;
    if (!by.has(cu)) by.set(cu, []);
    by.get(cu).push(nr);
  }
  const multi = [...by.entries()].filter(([k,v]) => v.length > 1);
  let mixed = 0;
  for (const [, v] of multi) {
    const hasPos = v.some(x => x > 1), hasNeg = v.some(x => x < -1);
    if (hasPos && hasNeg) mixed++;
  }
  console.log(`${name}: customers=${by.size} multi-chassis=${multi.length} mixed-sign=${mixed} (${(100*mixed/multi.length).toFixed(0)}%)`);
}
mixedSign('G1 PTB_RETAIL cust(10) nr(29)', pr, 10, 29);
mixedSign('G1 FY cust(9) nr(28)', fyr, 9, 28);

// ---- G2 sub-rupee net refund ----
{
  let a=0,b=0;
  for (let r=1; r<pr.length; r++) { const v=pr[r][29]; if (typeof v==='number' && v!==0 && Math.abs(v)<1) a++; }
  for (let r=1; r<fyr.length; r++) { const v=fyr[r][28]; if (typeof v==='number' && v!==0 && Math.abs(v)<1) b++; }
  console.log(`G2 sub-rupee net_refund: PTB_RETAIL=${a} FY=${b}`);
}
// ---- G5 refund status values ----
dist('G5 RefStatus PTB_RETAIL(30)', pr, 30);
dist('G5 RefStatus FY(29)', fyr, 29);

// ---- G3 AL BS no chassis ----
{
  const ab = rows(alBs, 'AL Balance Sheet'); // 0 Date,1 Details,2 Debit,3 Credit,4 CBN,5 Chassis,6 Engine,7 CTD,8 Offtake
  let n=0, noCh=0; const detail = new Map();
  for (let r=1; r<ab.length; r++) {
    const row = ab[r]; if (row.every(v=>v==null)) continue; n++;
    const ch = String(row[5]||'').trim();
    if (!CH.test(ch)) { noCh++; const d = String(row[1]||'').trim().split(' ').slice(0,2).join(' '); detail.set(d,(detail.get(d)||0)+1); }
  }
  console.log(`G3 AL_BS: datarows=${n} noChassis=${noCh} topDetails: ${[...detail.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}×${v}`).join(' | ')}`);
}

// ---- 3-way retention agreement ----
{
  const ri = rows(retInt, "MAR'26"); // 7 CHASSIS, 14 Retention
  const ra = rows(retAl, "MAR'26");  // 8 CHASSIS, 16 Retention, 15 Diff, 17 AppAmt
  const itBy = new Map();
  for (let r=1; r<it.length; r++) { const t=String(it[r][5]||'').trim(); if (CH.test(t)) itBy.set(t, it[r][17]); }
  let j1=0, a1=0, j2=0, a2=0, j3=0, a3=0;
  const raBy = new Map();
  for (let r=1; r<ra.length; r++) { const t=String(ra[r][8]||'').trim(); if (CH.test(t)) raBy.set(t, ra[r][16]); }
  for (let r=1; r<ri.length; r++) {
    const t = String(ri[r][7]||'').trim(); if (!CH.test(t)) continue;
    const rint = ri[r][14];
    if (itBy.has(t) && typeof rint==='number' && typeof itBy.get(t)==='number') { j1++; if (Math.abs(rint-itBy.get(t))<1) a1++; }
    if (raBy.has(t) && typeof rint==='number' && typeof raBy.get(t)==='number') { j2++; if (Math.abs(rint-raBy.get(t))<1) a2++; }
  }
  for (const [t, v] of raBy) {
    if (itBy.has(t) && typeof v==='number' && typeof itBy.get(t)==='number') { j3++; if (Math.abs(v-itBy.get(t))<1) a3++; }
  }
  console.log(`3WAY: INT-vs-IT join=${j1} agree=${a1} (${(100*a1/j1).toFixed(1)}%) | INT-vs-AL join=${j2} agree=${a2} (${(100*a2/j2).toFixed(1)}%) | AL-vs-IT join=${j3} agree=${a3} (${(100*a3/j3).toFixed(1)}%)`);
}

// ---- VIN decode ----
{
  const all = [];
  for (const [wbx, sheet] of [[invTrk,'INVOICE TRACKER',5],[invTrk,'OTHER DEALER',5],[fy,'Sheet1',5]]) {
    const R = rows(wbx, sheet);
    for (let r=1; r<R.length; r++) { const t=String(R[r][5]||'').trim(); if (CH.test(t)) all.push(t); }
  }
  const p10 = new Map(), p12 = new Map();
  for (const ch of all) {
    const y = ch[9], m = ch[11];
    p10.set(y,(p10.get(y)||0)+1); p12.set(m,(p12.get(m)||0)+1);
  }
  console.log(`VIN: total chassis-pattern strings=${all.length}`);
  console.log(`  pos10 (year): ${[...p10.entries()].sort().map(([k,v])=>`${k}×${v}`).join(' ')}`);
  console.log(`  pos12 (month): ${[...p12.entries()].sort().map(([k,v])=>`${k}×${v}`).join(' ')}`);
}

// ---- DSE incentive slab ----
{
  const ri = rows(retInt, "MAR'26"); // 1 DSE, 16 DSE INCENTIVE
  const cnt = new Map();
  for (let r=1; r<ri.length; r++) { const d=String(ri[r][1]||'').trim(); if (d) cnt.set(d,(cnt.get(d)||0)+1); }
  const slab = n => n<5?0 : n<9?1200 : n<13?1500 : 1800;
  let n=0, ok=0; const bad=[];
  for (let r=1; r<ri.length; r++) {
    const d=String(ri[r][1]||'').trim(); const v=ri[r][16];
    if (!d || typeof v!=='number') continue; n++;
    if (v === slab(cnt.get(d))) ok++; else if (bad.length<6) bad.push(`r${r+1} ${d}(count=${cnt.get(d)}) inc=${v} expected=${slab(cnt.get(d))}`);
  }
  console.log(`DSE slab: n=${n} match=${ok} (${(100*ok/n).toFixed(1)}%)`);
  bad.forEach(x=>console.log('  '+x));
  const ws = retInt.Sheets["MAR'26"];
  console.log(`  sample formula Q2=${ws['Q2']?ws['Q2'].f:undefined} R2=${ws['R2']?ws['R2'].f:undefined} S2=${ws['S2']?ws['S2'].f:undefined}`);
}

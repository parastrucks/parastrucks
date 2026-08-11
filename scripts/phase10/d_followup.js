// Follow-ups: INT.Retention vs AL.Diff; VIN pos10/pos12 empirical mapping vs real dates; qty elsewhere
const XLSX = require('D:/PTB/Website/portal_phase1a_setup/portal/node_modules/xlsx');
const rd = p => XLSX.readFile(p, {cellFormula:true, raw:true});
const invTrk = rd('D:/PTB/Finances/2025-26/INVOICE TRACKER 2025-26.xlsx');
const retInt = rd("D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -INTERNAL.xlsx");
const retAl = rd("D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -AL.xlsx");
const invList = rd('C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/INVOICE LIST - MAR 26.xlsx');
const fy = rd('C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/2025-26.xlsx');
const rows = (wb, s) => XLSX.utils.sheet_to_json(wb.Sheets[s], {header:1, raw:true, defval:null});
const CH = /^MB1[A-Z0-9]{14}$/;

// ---- 1. INT.Retention(14) vs AL.Diff(15) and AL.Retention(16) rounding relationship ----
{
  const ri = rows(retInt, "MAR'26");
  const ra = rows(retAl, "MAR'26");
  const raBy = new Map();
  for (let r=1; r<ra.length; r++) { const t=String(ra[r][8]||'').trim(); if (CH.test(t)) raBy.set(t, {diff: ra[r][15], ret: ra[r][16], app: ra[r][17]}); }
  let j=0, agreeDiff=0, retIsRounded=0, appIsDiffMinusRet=0;
  for (let r=1; r<ri.length; r++) {
    const t = String(ri[r][7]||'').trim(); if (!CH.test(t) || !raBy.has(t)) continue;
    const rint = ri[r][14]; const a = raBy.get(t);
    if (typeof rint !== 'number' || typeof a.diff !== 'number') continue;
    j++;
    if (Math.abs(rint - a.diff) < 1) agreeDiff++;
    if (typeof a.ret === 'number' && a.ret % 500 === 0) retIsRounded++;
    if (typeof a.ret === 'number' && typeof a.app === 'number' && Math.abs((a.ret - a.diff) - a.app) < 1) appIsDiffMinusRet++;
  }
  console.log(`INT.Retention vs AL.Diff: join=${j} agree=${agreeDiff} (${(100*agreeDiff/j).toFixed(1)}%) | AL.Retention multiple-of-500: ${retIsRounded}/${j} | AppAmt==AL.Ret-AL.Diff: ${appIsDiffMinusRet}/${j}`);
  const ws = retAl.Sheets["MAR'26"];
  console.log(`  AL formulas r2: P2(Diff)=${ws['P2']?ws['P2'].f:undefined} Q2(Ret)=${ws['Q2']?ws['Q2'].f:'RAW:'+(ws['Q2']?ws['Q2'].v:'')} R2(App)=${ws['R2']?ws['R2'].f:undefined} U2(Int)=${ws['U2']?ws['U2'].f:undefined}`);
}

// ---- 2. VIN pos10 vs Make column; pos12 vs gatepass month (empirical mapping) ----
{
  const it = rows(invTrk, 'INVOICE TRACKER'); // 2 gpdate, 5 chassis, 7 Make
  const p10make = new Map(); // letter -> Map(makeYear->n)
  const p12month = new Map(); // letter -> Map(calMonth->n)
  const excelToDate = n => new Date(Date.UTC(1899,11,30) + n*86400000);
  for (let r=1; r<it.length; r++) {
    const ch = String(it[r][5]||'').trim(); if (!CH.test(ch)) continue;
    const y = ch[9], m = ch[11];
    const make = it[r][7];
    if (typeof make === 'number') {
      if (!p10make.has(y)) p10make.set(y, new Map());
      p10make.get(y).set(make, (p10make.get(y).get(make)||0)+1);
    }
    const gp = it[r][2];
    if (typeof gp === 'number' && gp > 40000) {
      const mo = excelToDate(gp).getUTCMonth()+1;
      if (!p12month.has(m)) p12month.set(m, new Map());
      p12month.get(m).set(mo, (p12month.get(m).get(mo)||0)+1);
    }
  }
  console.log('\nVIN pos10 vs Make column:');
  for (const [k, m] of [...p10make.entries()].sort())
    console.log(`  ${k}: ${[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([y,n])=>`${y}×${n}`).join(' ')}`);
  console.log('VIN pos12 letter vs GATEPASS calendar month (top 3 months per letter):');
  for (const [k, m] of [...p12month.entries()].sort()) {
    const tot = [...m.values()].reduce((a,b)=>a+b,0);
    const top = [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
    console.log(`  ${k} (n=${tot}): ${top.map(([mo,n])=>`m${mo}×${n}`).join(' ')}`);
  }
}

// ---- 3. qty distribution in other sheets ----
{
  const od = rows(invTrk, 'OTHER DEALER');
  const pr = rows(invList, 'PTB RETAIL');
  const fyr = rows(fy, 'Sheet1');
  const q = (R, c, name) => {
    const m = new Map();
    for (let r=1; r<R.length; r++) { const v=R[r][c]; if (v!=null) m.set(JSON.stringify(v),(m.get(JSON.stringify(v))||0)+1); }
    console.log(`QTY ${name}: ${[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,n])=>`${k}×${n}`).join(' ')}`);
  };
  q(od, 10, 'OTHER DEALER(col10)');
  q(pr, 9, 'PTB RETAIL(col9)');
  q(fyr, 8, 'FY(col8)');
}

// ---- 4. RET_INT: which rows are SRS and what distinguishes them ----
{
  const ri = rows(retInt, "MAR'26");
  const seg = new Map();
  for (let r=1; r<ri.length; r++) {
    if (String(ri[r][1]||'').trim() === 'SRS') {
      const s = String(ri[r][4]||'').trim(); seg.set(s,(seg.get(s)||0)+1);
    }
  }
  console.log(`SRS rows by Segment: ${[...seg.entries()].map(([k,v])=>`${k}×${v}`).join(' ')}`);
  // does the sheet's own Q formula produce 0 for SRS? i.e. was the formula overridden or does COUNTIF differ?
  const ws = retInt.Sheets["MAR'26"];
  for (let r=1; r<ri.length; r++) {
    if (String(ri[r][1]||'').trim() === 'SRS') {
      const cell = ws['Q'+(r+1)];
      console.log(`  first SRS row r${r+1}: Q formula=${cell?cell.f:'(none)'} value=${cell?cell.v:''}`);
      break;
    }
  }
}

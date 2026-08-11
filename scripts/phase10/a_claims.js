// A-series: duplicates, cross-file conflicts, layout breaks, DEALERS columns
const XLSX = require('D:/PTB/Website/portal_phase1a_setup/portal/node_modules/xlsx');
const rd = p => XLSX.readFile(p, {cellFormula:true, raw:true});

const invTrk = rd('D:/PTB/Finances/2025-26/INVOICE TRACKER 2025-26.xlsx');
const fy = rd('C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/2025-26.xlsx');
const invList = rd('C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/INVOICE LIST - MAR 26.xlsx');

const rows = (wb, sheet) => XLSX.utils.sheet_to_json(wb.Sheets[sheet], {header:1, raw:true, defval:null});
const CH = /^MB1[A-Z0-9]{14}$/;

// ---- A1: duplicate chassis in INVOICE TRACKER ----
const it = rows(invTrk, 'INVOICE TRACKER'); // F=5 chassis
{
  const seen = new Map(), exact = new Map(), trimOnly = new Set();
  for (let r = 1; r < it.length; r++) {
    const raw = it[r][5];
    if (raw == null || String(raw).trim() === '') continue;
    const s = String(raw);
    const t = s.trim();
    if (!seen.has(t)) seen.set(t, []);
    seen.get(t).push({r: r+1, raw: s});
  }
  let dupGroups = 0, dupRows = 0, wsCollide = 0;
  for (const [t, list] of seen) {
    if (list.length > 1) {
      dupGroups++; dupRows += list.length;
      const rawSet = new Set(list.map(x => x.raw));
      if (rawSet.size > 1) wsCollide++;
    }
  }
  console.log(`A1 INVOICE TRACKER: nonblank chassis rows=${[...seen.values()].reduce((a,b)=>a+b.length,0)}, unique(trimmed)=${seen.size}, dupGroups=${dupGroups}, dupRows=${dupRows}, groups-colliding-only-after-trim=${wsCollide}`);
  for (const [t, list] of seen) if (list.length > 1) console.log(`   dup: ${t} rows=${list.map(x=>x.r).join(',')} rawDiffer=${new Set(list.map(x=>x.raw)).size>1}`);
}

// specific: MB1XEVHD1SRHK1555 detail
{
  for (let r = 1; r < it.length; r++) {
    if (String(it[r][5]||'').trim() === 'MB1XEVHD1SRHK1555')
      console.log(`   K1555 r${r+1}: VPart=${it[r][3]} payDate=${it[r][22]} interest=${it[r][33]}`);
  }
}

// ---- A1b: FY duplicate chassis ----
const fyr = rows(fy, 'Sheet1'); // F=5 chassis, J=9 customer, AC=28 net refund
{
  const seen = new Map();
  for (let r = 1; r < fyr.length; r++) {
    const raw = fyr[r][5];
    if (raw == null || String(raw).trim() === '') continue;
    const t = String(raw).trim();
    if (!seen.has(t)) seen.set(t, []);
    seen.get(t).push(r+1);
  }
  const dups = [...seen.entries()].filter(([k,v]) => v.length > 1);
  console.log(`A1b FY: unique chassis=${seen.size}, dup groups=${dups.length}`);
  // the cited one
  const c = seen.get('MB1PEECDXSAJU4480');
  if (c) for (const r of c) console.log(`   JU4480 r${r}: cust=${fyr[r-1][9]} netRefund=${fyr[r-1][28]}`);
  // how many dup groups have DIFFERENT customers?
  let diffCust = 0;
  for (const [k, rs] of dups) {
    const custs = new Set(rs.map(r => String(fyr[r-1][9]||'').trim().toUpperCase()));
    if (custs.size > 1) diffCust++;
  }
  console.log(`   dup groups w/ different customer: ${diffCust}`);
}

// ---- A2: cross-file conflicts INVOICE TRACKER vs FY ----
{
  // INVOICE TRACKER: F=5 chassis, L=11 customer, P=15 CTC, Q=16 CTD
  // FY Sheet1: F=5 chassis, J=9 customer, P=15 CTC, AJ=35 CTD
  const fyBy = new Map();
  for (let r = 1; r < fyr.length; r++) {
    const t = String(fyr[r][5]||'').trim();
    if (CH.test(t)) fyBy.set(t, r);
  }
  let joined = 0, ctcDis = 0, ctdDis = 0, custDis = 0, stockRows = 0;
  let ctcBothNum = 0, ctdBothNum = 0;
  for (let r = 1; r < it.length; r++) {
    const t = String(it[r][5]||'').trim();
    if (!CH.test(t) || !fyBy.has(t)) continue;
    joined++;
    const fr = fyBy.get(t);
    const ctcA = it[r][15], ctcB = fyr[fr][15];
    const ctdA = it[r][16], ctdB = fyr[fr][35];
    const cuA = String(it[r][11]||'').trim().toUpperCase();
    const cuB = String(fyr[fr][9]||'').trim().toUpperCase();
    if (typeof ctcA === 'number' && typeof ctcB === 'number') { ctcBothNum++; if (Math.abs(ctcA-ctcB) > 0.5) ctcDis++; }
    if (typeof ctdA === 'number' && typeof ctdB === 'number') { ctdBothNum++; if (Math.abs(ctdA-ctdB) > 0.5) ctdDis++; }
    if (cuA && cuB && cuA !== cuB) { custDis++; if (cuA === 'STOCK') stockRows++; }
  }
  console.log(`A2 join IT->FY on chassis: joined=${joined}`);
  console.log(`   CTC disagree=${ctcDis}/${ctcBothNum} (${(100*ctcDis/ctcBothNum).toFixed(1)}%)`);
  console.log(`   CTD disagree=${ctdDis}/${ctdBothNum} (${(100*ctdDis/ctdBothNum).toFixed(1)}%)`);
  console.log(`   customer disagree=${custDis}/${joined} (${(100*custDis/joined).toFixed(1)}%), of which IT says STOCK: ${stockRows}`);
}

// ---- A3: FY layout breaks ----
{
  // invoice date col AH=33 per header ("PTB INVOICE DATE"); check type distribution
  let nonDate = 0, nonDateRows = [];
  for (let r = 1; r < fyr.length; r++) {
    const v = fyr[r][33];
    if (v == null) continue;
    if (typeof v !== 'number' || v < 40000 || v > 50000) { nonDate++; if (nonDateRows.length<8) nonDateRows.push(`r${r+1}=${JSON.stringify(v)}`); }
  }
  console.log(`A3 FY col AH(33) non-date-like nonblank=${nonDate} samples: ${nonDateRows.join(' ')}`);
  // column-shift claim: from r1443 the AD-BLU/CTD/ENDHAN block shifts one left.
  // AD-BLU=34, CTD=35, ENDHAN=36. If shifted left, CTD value would appear in col 34.
  const looksMoney = v => typeof v === 'number' && v > 100000;
  let before = {c34money:0,c35money:0,c36money:0,n:0}, after = {c34money:0,c35money:0,c36money:0,n:0};
  for (let r = 1; r < fyr.length; r++) {
    const tgt = (r+1) < 1443 ? before : after;
    tgt.n++;
    if (looksMoney(fyr[r][34])) tgt.c34money++;
    if (looksMoney(fyr[r][35])) tgt.c35money++;
    if (looksMoney(fyr[r][36])) tgt.c36money++;
  }
  console.log(`   rows<1443: n=${before.n} money-in-col34(ADBLU)=${before.c34money} col35(CTD)=${before.c35money} col36(ENDHAN)=${before.c36money}`);
  console.log(`   rows>=1443: n=${after.n} money-in-col34=${after.c34money} col35=${after.c35money} col36=${after.c36money}`);
  // sample rows around 1443
  for (const r of [1440,1441,1442,1443,1444,1445]) {
    console.log(`   r${r}: 33=${JSON.stringify(fyr[r-1][33])} 34=${JSON.stringify(fyr[r-1][34])} 35=${JSON.stringify(fyr[r-1][35])} 36=${JSON.stringify(fyr[r-1][36])} 37=${JSON.stringify(fyr[r-1][37])}`);
  }
}

// ---- A4: DEALERS sheet columns ----
{
  const dl = rows(invList, 'DEALERS');
  // headers: 0 SRNO 1 NAME 2 VPART 3 Model 4 ChassisNo 5 CTD ...
  let chInModel = 0, chInChassisCol = 0, engineInChassisCol = 0, n = 0, subtotal = 0;
  const ENG = /^[A-Z]{4}[0-9]{6}$/;
  for (let r = 1; r < dl.length; r++) {
    const row = dl[r];
    if (row.every(v => v == null)) continue;
    n++;
    if (CH.test(String(row[3]||'').trim())) chInModel++;
    if (CH.test(String(row[4]||'').trim())) chInChassisCol++;
    if (ENG.test(String(row[4]||'').trim())) engineInChassisCol++;
    if (row[0] == null && row[5] != null) subtotal++;
  }
  console.log(`A4 DEALERS: datarows=${n}, chassis-pattern in 'Model'(col3)=${chInModel}, in 'Chassis No'(col4)=${chInChassisCol}, engine-pattern in col4=${engineInChassisCol}, srno-blank-with-money=${subtotal}`);
}

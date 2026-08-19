const XLSX = require('xlsx');
const files = [
  ['INV_TRK', 'D:/PTB/Finances/2025-26/INVOICE TRACKER 2025-26.xlsx'],
  ['RET_INT', "D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -INTERNAL.xlsx"],
  ['RET_AL',  "D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -AL.xlsx"],
  ['AL_BS',   'D:/PTB/Finances/2025-26/2026-03 - MARCH/AL Balance Sheet -0326.xlsx'],
  ['INV_LIST','C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/INVOICE LIST - MAR 26.xlsx'],
  ['FY',      'C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/2025-26.xlsx'],
];
for (const [tag, path] of files) {
  let wb;
  try { wb = XLSX.readFile(path, {cellFormula:true, cellComments:true, cellDates:false}); }
  catch (e) { console.log(`${tag}: READ ERROR ${e.message}`); continue; }
  console.log(`\n=== ${tag} (${path.split('/').pop()}) ===`);
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'] || '(empty)';
    let comments = 0, formulas = 0;
    if (ws['!ref']) {

      for (const addr in ws) {
        if (addr[0] === '!') continue;
        const c = ws[addr];
        if (c.f) formulas++;
        if (c.c && c.c.length) comments += c.c.length;
      }
    }
    console.log(`  [${name}] ref=${ref} formulas=${formulas} comments=${comments}`);
    // headers: print first two rows compactly for likely-data sheets
    if (ws['!ref']) {
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, range:0, defval:null});
      for (let r = 0; r < Math.min(2, rows.length); r++) {
        const row = (rows[r]||[]).map(v => v===null?'':String(v).slice(0,18));
        console.log(`    r${r}: ${row.slice(0,45).join(' | ')}`);
      }
      console.log(`    total rows in ref: ${rows.length}`);
    }
  }
}

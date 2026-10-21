// Phase 10 column inventory — the input to the vehicle_units column map.
// READ-ONLY. Prints header names and per-column SHAPE (fill count, number/text/date-like counts,
// formula count and its dominant normalised pattern). Prints NO cell values: commercial data stays
// in the workbooks.
const XLSX = require('xlsx');
const DL = 'C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/';
const sheets = [
  ['INV_TRK', 'D:/PTB/Finances/2025-26/INVOICE TRACKER 2025-26.xlsx', ['INVOICE TRACKER', 'OTHER DEALER']],
  ['INV_LIST', DL + 'INVOICE LIST - MAR 26.xlsx', ['PTB RETAIL', 'DEALERS', 'canc rebill']],
  ['FY', DL + '2025-26.xlsx', ['Sheet1']],
  ['RET_INT', "D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -INTERNAL.xlsx", ["MAR'26"]],
  ['RET_AL', "D:/PTB/Finances/2025-26/2026-03 - MARCH/RETENTION TRACKER - MAR'26 -AL.xlsx", ["MAR'26"]],
  ['AL_BS', 'D:/PTB/Finances/2025-26/2026-03 - MARCH/AL Balance Sheet -0326.xlsx', ['AL Balance Sheet']],
];
const DATE_TEXT = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;
// A formula's shape with its own row numbers and literals blanked, so =P2-Q2 and =P3-Q3 match.
const norm = f => f.replace(/\$?([A-Z]{1,3})\$?\d+/g, '$1#').replace(/\b\d+(\.\d+)?\b/g, 'n');

for (const [tag, path, names] of sheets) {
  const wb = XLSX.readFile(path, { cellFormula: true, cellDates: false });
  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) { console.log(`\n=== ${tag} / ${name}: MISSING`); continue; }
    const range = XLSX.utils.decode_range(ws['!ref']);
    // header row = the one of the first 6 with the most text cells
    let hdr = range.s.r, best = -1;
    for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
      let n = 0;
      for (let c = range.s.c; c <= range.e.c; c++) { const v = ws[XLSX.utils.encode_cell({ r, c })]; if (v && v.t === 's') n++ }
      if (n > best) { best = n; hdr = r }
    }
    const rows = range.e.r - hdr;
    console.log(`\n=== ${tag} / ${name} — header row ${hdr + 1}, ${rows} rows below it`);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const h = ws[XLSX.utils.encode_cell({ r: hdr, c })];
      const head = h ? String(h.v).replace(/\s+/g, ' ').trim() : '';
      let fill = 0, num = 0, txt = 0, dateLike = 0, form = 0; const pats = {};
      for (let r = hdr + 1; r <= range.e.r; r++) {
        const v = ws[XLSX.utils.encode_cell({ r, c })];
        if (!v || v.v === '' || v.v == null) continue;
        fill++;
        if (v.t === 'n') { num++; if (v.z && /[dmy]/i.test(v.z) && !/#/.test(v.z)) dateLike++ }
        else if (v.t === 's') { txt++; if (DATE_TEXT.test(String(v.v).trim())) dateLike++ }
        if (v.f) { form++; const p = norm(v.f); pats[p] = (pats[p] || 0) + 1 }
      }
      if (!head && !fill) continue;
      const top = Object.entries(pats).sort((a, b) => b[1] - a[1])[0];
      console.log([
        XLSX.utils.encode_col(c).padEnd(3), (head || '(no header)').slice(0, 34).padEnd(34),
        `fill ${fill}`.padEnd(10), `num ${num}`.padEnd(9), `txt ${txt}`.padEnd(9), `date ${dateLike}`.padEnd(10),
        form ? `f ${form} =${top[0].slice(0, 40)} (${top[1]})` : '',
      ].join(' '));
    }
  }
}

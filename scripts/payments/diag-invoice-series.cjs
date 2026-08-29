const XLSX = require('xlsx');
const fs = require('fs'), path = require('path');
const EXP = 'D:/Claude CoWork/PTB/SAP Automation/exports';
function findHeader(file, must) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', raw: true });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const row = aoa[i].map(c => String(c).trim());
    if (must.every(m => row.includes(m))) return { i, aoa };
  }
  return { i: -1, aoa };
}
function rowsOf(file, must) {
  const { i, aoa } = findHeader(file, must);
  if (i < 0) return [];
  const hdr = aoa[i].map(h => String(h).trim());
  return aoa.slice(i + 1).filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => Object.fromEntries(hdr.map((h, k) => [h, r[k]])));
}
const files = fs.readdirSync(EXP);
const r5f = files.filter(f => /^R5_wssales_/.test(f)), r6f = files.filter(f => /^R6_labour_/.test(f));

// distribution of prefixes
const invPrefix = {}, ordPrefix = {}, splitType = {}, hdrType = {};
const invSet = new Map();
for (const f of [...r5f, ...r6f]) {
  const isR5 = /^R5/.test(f);
  const rows = rowsOf(path.join(EXP, f), isR5 ? ['Dealer Invoice Number','With Tax Amount'] : ['Dealer Invoice Number']);
  for (const r of rows) {
    const inv = String(r['Dealer Invoice Number'] || '').trim();
    const ord = String(r['Dealer Order Number'] || '').trim();
    if (inv) invPrefix[inv.slice(0,3)] = (invPrefix[inv.slice(0,3)] || 0) + 1;
    if (ord) ordPrefix[ord.slice(0,3)] = (ordPrefix[ord.slice(0,3)] || 0) + 1;
    const st = String(r['Split Order Type'] || '').trim(); if (st) splitType[st] = (splitType[st]||0)+1;
    const ht = String(r['Header Order Type'] || '').trim(); if (ht) hdrType[ht] = (hdrType[ht]||0)+1;
    if (inv && !invSet.has(inv)) invSet.set(inv, { inv, ord, st, ht, kind: isR5 ? 'R5':'R6' });
  }
}
const top = o => Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`${k}:${v}`).join('  ');
console.log('DEALER INVOICE prefixes (line rows):', top(invPrefix));
console.log('DEALER ORDER  prefixes (line rows):', top(ordPrefix));
console.log('\nSplit Order Type:', top(splitType));
console.log('Header Order Type:', top(hdrType));

// distinct invoices by invoice-series prefix
const byPfx = {};
for (const v of invSet.values()) byPfx[v.inv.slice(0,3)] = (byPfx[v.inv.slice(0,3)] || 0) + 1;
console.log('\nDISTINCT invoices by series prefix:', top(byPfx));

// cross-tab: invoice prefix vs order prefix
const cross = {};
for (const v of invSet.values()) {
  const k = `${v.inv.slice(0,3)} <- ${v.ord.slice(0,3) || '(blank)'}`;
  cross[k] = (cross[k] || 0) + 1;
}
console.log('\ninvoice-series <- order-series:', Object.entries(cross).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>`${k}=${v}`).join(' | '));

// what do PCS/PCR (cash/credit parts) invoices look like? sample
console.log('\nSample PCS/PCR/LCS/LCR invoices:');
[...invSet.values()].filter(v=>/^(PCS|PCR|LCS|LCR)/.test(v.inv)).slice(0,8)
  .forEach(v=>console.log(`  ${v.inv}  ord=${v.ord}  split="${v.st}"  hdr="${v.ht}"`));
console.log('\nSample of everything else:');
[...invSet.values()].filter(v=>!/^(PCS|PCR|LCS|LCR)/.test(v.inv)).slice(0,8)
  .forEach(v=>console.log(`  ${v.inv}  ord=${v.ord}  split="${v.st}"  hdr="${v.ht}"`));

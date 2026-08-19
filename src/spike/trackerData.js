// Spike-only. Generates data with the SHAPE of the real tracker: ~2050 rows x 88 cols.
// No real commercial data lives in the repo — values are synthetic but realistically formatted.

const SEG = ['HAULAGE', 'TIPPER', 'MAV', 'ICV TRUCKS', 'TRACTOR', 'BUS']
const CUST = ['AIM LOGISTICS', 'RAMAN ROADWAYS', 'DARSHAK MASHERI', 'GOKUL MAMRA PVT LTD',
  'PROFEX RESOURCES', 'AADINATH BULK', 'STOCK', 'NEPTON MANAGEMENT', 'TRANSVOY LOGISTICS']
const MODEL = ['NA5525/34 TT CC', 'EA1916/55 H CO', 'AL 3520/32ft', 'TF2012.0T6R', 'LS1510.3T6R']
const DSE = ['MAHESH', 'UMANG', 'MANISH', 'SRS', 'KISHAN', 'PREM']
const FIN = ['ICICI', 'HDFC', 'AXIS', 'SBI', 'CHOLA', '']
const REFUND = ['PENDING', 'REFUNDED', 'TO COLLECT', 'NA']
const DELIV = ['DELIVERED', 'PENDING', '']

// deterministic pseudo-random so every reload is identical (fair A/B comparison)
let seed = 42
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = a => a[Math.floor(rnd() * a.length)]
const money = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) / 100) * 100
const ddmmyy = () => {
  const d = 1 + Math.floor(rnd() * 28), m = 1 + Math.floor(rnd() * 12)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/26`
}
const chassis = i => `MB1${'ABCDEFGHJKLMNPRSTUVWXYZ'[i % 23]}${String(i).padStart(5, '0')}D${'STPR'[i % 4]}${String(i * 7 % 100000).padStart(5, '0')}`

// 88 columns, grouped the way the real book is
export const COLUMNS = [
  { key: 'srno', name: 'SR', width: 56, frozen: true },
  { key: 'chassis_no', name: 'Chassis No', width: 165, frozen: true },
  { key: 'model', name: 'Model', width: 135, frozen: true },
  { key: 'customer_name', name: 'Customer Name', width: 175 },
  { key: 'segment', name: 'Segment', width: 105 },
  { key: 'dse', name: 'DSE', width: 90 },
  { key: 'engine_no', name: 'Engine No', width: 120 },
  { key: 'gatepass_no', name: 'Gatepass No', width: 115 },
  { key: 'gatepass_date', name: 'Gatepass Date', width: 110 },
  { key: 'vpart', name: 'V Part Number', width: 140 },
  { key: 'qty', name: 'Qty', width: 55 },
  { key: 'ctc', name: 'CTC', width: 105, money: true },
  { key: 'ctd', name: 'CTD', width: 105, money: true },
  { key: 'amc', name: 'AMC', width: 95, money: true },
  { key: 'dsa', name: 'DSA', width: 95, money: true },
  { key: 'ad_blue', name: 'Ad Blue', width: 95, money: true },
  { key: 'retention', name: 'Retention', width: 105, money: true, computed: true },
  { key: 'tally_bill', name: 'Tally Bill', width: 110, money: true },
  { key: 'tcs', name: 'TCS 1%', width: 95, money: true, computed: true },
  { key: 'total', name: 'Total', width: 115, money: true, computed: true },
  { key: 'finance', name: 'Finance', width: 95 },
  { key: 'do_date', name: 'DO Date', width: 100 },
  { key: 'do_amount', name: 'DO Amount', width: 115, money: true },
  { key: 'margin_money', name: 'Margin Money', width: 115, money: true },
  { key: 'finance_recd', name: 'Finance Recd', width: 115, money: true },
  { key: 'total_recd', name: 'Total Recd', width: 115, money: true, computed: true },
  { key: 'insurance', name: 'Insurance', width: 100, money: true },
  { key: 'cretem', name: 'Cretem', width: 95, money: true },
  { key: 'full_tax', name: 'Full Tax', width: 100, money: true },
  { key: 'total_receivable', name: 'Total Receivable', width: 130, money: true, computed: true },
  { key: 'net_refund', name: 'Net Refund', width: 115, money: true, computed: true },
  { key: 'refund_status', name: 'Refund Status', width: 115 },
  { key: 'delivery_status', name: 'Delivery Status', width: 120 },
  { key: 'delivery_date', name: 'Delivery Date', width: 110 },
  { key: 'payment_status', name: 'Payment Status', width: 120 },
  { key: 'invoice_date', name: 'PTB Invoice Date', width: 125 },
  { key: 'notes', name: 'Notes', width: 200 },
]
// pad to 88 columns with the long tail of real-book fields
for (let i = COLUMNS.length; i < 88; i++) {
  COLUMNS.push({ key: `extra_${i}`, name: `Field ${i - 36}`, width: 110, money: i % 3 === 0 })
}

export function makeRows(n = 2050) {
  seed = 42
  const rows = []
  for (let i = 1; i <= n; i++) {
    const ctc = money(1500000, 4200000)
    const ctd = ctc - money(20000, 180000)
    const amc = rnd() > 0.75 ? money(5000, 60000) : 0
    const dsa = rnd() > 0.85 ? money(5000, 40000) : 0
    const ad_blue = rnd() > 0.7 ? money(2000, 35000) : 0
    const tally_bill = ctc + (rnd() > 0.6 ? money(0, 90000) : 0)
    const tcs = Math.round(tally_bill * 0.01)          // the verified basis: tally, NOT ctc
    const total = ctc + tcs
    const margin_money = money(200000, 900000)
    const finance_recd = money(900000, 3200000)
    const insurance = money(8000, 45000)
    const cretem = pick([1500, 7000, 6600, 9000, 7350])
    const full_tax = rnd() > 0.6 ? money(20000, 160000) : 0
    const total_recd = margin_money + finance_recd
    const total_receivable = total + insurance + cretem + full_tax
    const r = {
      id: i, srno: i,
      chassis_no: chassis(i), model: pick(MODEL), customer_name: pick(CUST),
      segment: pick(SEG), dse: pick(DSE),
      engine_no: `${'STPR'[i % 4]}${'PHZ'[i % 3]}${String(100000 + i * 13 % 500000)}`,
      gatepass_no: String(8000000 + i * 37), gatepass_date: ddmmyy(),
      vpart: `CDF${String(190000 + i * 11).slice(0, 6)}C000${i % 9}`, qty: 1,
      ctc, ctd, amc, dsa, ad_blue,
      retention: ctc === 0 ? 0 : ctc - ctd - amc - dsa - ad_blue,   // verified formula
      tally_bill, tcs, total,
      finance: pick(FIN), do_date: ddmmyy(), do_amount: money(1200000, 3600000),
      margin_money, finance_recd, total_recd,
      insurance, cretem, full_tax, total_receivable,
      net_refund: total_recd - total_receivable,
      refund_status: pick(REFUND), delivery_status: pick(DELIV), delivery_date: ddmmyy(),
      payment_status: pick(['Payment Recd', 'Pending', '']), invoice_date: ddmmyy(),
      notes: rnd() > 0.9 ? pick(['held for finance', 'call Ramesh', 'RC pending', '10K URIYA']) : '',
    }
    for (let c = 36; c < 88; c++) {
      r[`extra_${c}`] = c % 3 === 0 ? money(1000, 500000) : (rnd() > 0.7 ? pick(['YES', 'NO', 'NA', '']) : '')
    }
    rows.push(r)
  }
  return rows
}

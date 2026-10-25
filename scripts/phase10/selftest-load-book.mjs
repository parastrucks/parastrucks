// Phase 10 — offline self-test for loadBook (src/tracker/lib/trackerApi.js): the working set comes in pages of
// 2,500 (each database call must finish inside PostgREST's 8 s), ONE at a time (three at once overloaded the
// free instance), and a page that fails is asked for again twice before the book reports an error.
//
//   node scripts/phase10/selftest-load-book.mjs
//
// The real module is imported; only callEdge is replaced (a loader hook serves a fake '../../lib/api'), and
// the retry waits are recorded instead of slept. Expectations are written out by hand.
import { register } from 'node:module'

const fake = `export const callEdge = (...a) => globalThis.__callEdge(...a)`
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (/\\/lib\\/api$/.test(spec)) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(fake)}), shortCircuit: true }
    return next(spec, ctx)
  }`))

let pass = 0, fail = 0
const ok = (cond, label, got) => { if (cond) pass++; else { fail++; console.log('FAIL', label, got === undefined ? '' : JSON.stringify(got)) } }

// retry waits: recorded, run at once
const waits = []
const realTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms) => { waits.push(ms); return realTimeout(fn, 0) }

// a fake book of N trucks; failAt: offset → how many times that page fails before it answers
function server(n, { failAt = {} } = {}) {
  const calls = []
  let open = 0, most = 0
  const fails = { ...failAt }
  globalThis.__callEdge = async (fn, action, p) => {
    calls.push({ fn, action, offset: p.offset, limit: p.limit, scope: p.scope })
    open++; most = Math.max(most, open)
    await new Promise((r) => realTimeout(r, 2))
    open--
    if (fails[p.offset] > 0) { fails[p.offset]--; throw new Error(`page ${p.offset} timed out`) }
    const rows = []
    for (let i = p.offset; i < Math.min(n, p.offset + p.limit); i++) rows.push(i % 2 ? { id: `u${i}`, chassis_no: `C${i}` } : { id: `u${i}` })
    return {
      ok: true, hidden: ['dse_incentive'],
      book: { rows, notes: rows.map((r) => ({ unit_id: r.id, body: 'n' })), formats: rows.slice(0, 1).map((r) => ({ unit_id: r.id })),
        dse_counts: { [`D|${p.offset}`]: 1 }, scope_count: n, fy_start: '2026-04-01', total: n + 100 },
    }
  }
  return { calls, most: () => most }
}

const { loadBook: realLoadBook } = await import('../../src/tracker/lib/trackerApi.js')
// a load that throws is a FAILED check here (not a crash), unless the check expects the error
const loadBook = (...a) => realLoadBook(...a).catch((e) => ({ rows: [], notes: [], formats: [], dseCounts: {}, threw: e }))
const COLS = ['chassis_no', 'model']

// 1. 6,000 trucks: three pages, in order, one at a time, merged
{
  const s = server(6000)
  const progress = []
  const b = await loadBook(COLS, { scope: 'working' }, (got, of) => progress.push([got, of]))
  ok(JSON.stringify(s.calls.map((c) => c.offset)) === '[0,2500,5000]', 'pages asked for at 0, 2,500, 5,000 — in order', s.calls.map((c) => c.offset))
  ok(s.calls.every((c) => c.limit === 2500 && c.action === 'book' && c.fn === 'admin-vehicle-units' && c.scope === 'working'), 'each page: book, 2,500, the scope')
  ok(s.most() === 1, 'one page at a time', s.most())
  ok(b.rows.length === 6000 && b.rows[0].id === 'u0' && b.rows[5999].id === 'u5999' && b.rows[2500].id === 'u2500', 'every row, in the book order')
  ok(b.rows[0].chassis_no === null && b.rows[0].model === null && b.rows[1].chassis_no === 'C1', 'an empty cell the server left out comes back as null')
  ok(b.notes.length === 6000 && b.formats.length === 3, "every page's notes and colours")
  ok(Object.keys(b.dseCounts).length === 3, "every page's DSE counts")
  ok(b.total === 6100 && b.fyStart === '2026-04-01' && JSON.stringify(b.hidden) === '["dse_incentive"]', 'total, year start and hidden columns from the first page')
  ok(JSON.stringify(progress) === '[[2500,6000],[5000,6000],[6000,6000]]', 'progress after each page', progress)
  ok(waits.length === 0, 'no waits when nothing fails', waits)
}

// 2. exactly one page (2,500) and an empty scope: no extra request
{
  const s = server(2500)
  const b = await loadBook(COLS, { scope: 'year', year: 2024 })
  ok(s.calls.length === 1 && b.rows.length === 2500, 'a scope of exactly 2,500 = one request', s.calls.length)
  const e = server(0)
  const z = await loadBook(COLS, {})
  ok(e.calls.length === 1 && z.rows.length === 0 && z.notes.length === 0, 'an empty scope = one request, no rows')
}

// 3. a page that fails once is asked for again (after 1.5 s) and the book is complete
{
  waits.length = 0
  const s = server(6000, { failAt: { 2500: 1 } })
  const b = await loadBook(COLS, {})
  ok(b.rows.length === 6000, 'a page that failed once: the book still complete', b.rows.length)
  ok(s.calls.filter((c) => c.offset === 2500).length === 2, 'the failed page asked for twice')
  ok(JSON.stringify(waits) === '[1500]', 'waited 1.5 s before asking again', waits)
}

// 4. the first page fails twice → third try answers; a page failing three times → the book reports its error
{
  waits.length = 0
  const s = server(3000, { failAt: { 0: 2 } })
  const b = await loadBook(COLS, {})
  ok(b.rows.length === 3000 && s.calls.filter((c) => c.offset === 0).length === 3, 'the first page: third try answers')
  ok(JSON.stringify(waits) === '[1500,3000]', 'waits grow: 1.5 s then 3 s', waits)
  waits.length = 0
  const t = server(6000, { failAt: { 5000: 9 } })
  const err = (await loadBook(COLS, {})).threw
  ok(err?.message === 'page 5000 timed out', 'three failures → the error reaches the page', err?.message)
  ok(t.calls.filter((c) => c.offset === 5000).length === 3, 'no more than three tries', t.calls.filter((c) => c.offset === 5000).length)
}

globalThis.setTimeout = realTimeout
console.log(`selftest-load-book: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

// Load docs/db/seed-reference.sql (pg_dump COPY ... FROM stdin blocks) into
// PGlite, which cannot take COPY from a script. Each block becomes INSERTs.
// Also inserts the synthetic users the probes and the simulation need —
// prod's user rows are not in the repo (PII), so these are stated stubs.

export function copyBlocksToInserts(text, { skipTables = [] } = {}) {
  const out = []
  const re = /^COPY (\S+) \(([^)]*)\) FROM stdin;\n([\s\S]*?)^\\\.$/gm
  let m
  while ((m = re.exec(text))) {
    const [, table, cols, body] = m
    const bare = table.replace(/^public\./, '')
    if (skipTables.includes(bare)) { out.push({ table, rows: 0, skipped: true }); continue }
    const lines = body.split('\n').filter((l) => l.length)
    const values = lines.map((l) => '(' + l.split('\t').map(copyValue).join(',') + ')')
    if (!values.length) { out.push({ table, rows: 0 }); continue }
    out.push({ table, rows: values.length, sql: `INSERT INTO ${table} (${cols}) VALUES ${values.join(',')}` })
  }
  return out
}

function copyValue(v) {
  if (v === '\\N') return 'NULL'
  // pg_dump text format escapes: \\ \t \n \r
  const s = v.replace(/\\\\/g, '\u0000').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\u0000/g, '\\')
  return "'" + s.replace(/'/g, "''") + "'"
}

/** Synthetic people. Prod's singleton admin has entity_id AND department_id NULL. */
export const STUB_USERS = [
  { id: '00000000-0000-4000-8000-000000000a01', username: 'zz.admin',   full_name: 'ZZ Admin',          permission_level: 'admin',     entity: null,  dept: null },
  { id: '00000000-0000-4000-8000-000000000a02', username: 'zz.acct',    full_name: 'ZZ Accounts Exec',  permission_level: 'executive', entity: 'PTB', dept: 'accounts' },
  { id: '00000000-0000-4000-8000-000000000a03', username: 'zz.acctmgr', full_name: 'ZZ Accounts Mgr',   permission_level: 'manager',   entity: 'PTB', dept: 'accounts' },
  { id: '00000000-0000-4000-8000-000000000a04', username: 'zz.svc',     full_name: 'ZZ Service Exec',   permission_level: 'executive', entity: 'PTB', dept: 'service' },
  { id: '00000000-0000-4000-8000-000000000a05', username: 'zz.svcmgr',  full_name: 'ZZ Service Mgr',    permission_level: 'manager',   entity: 'PTB', dept: 'service' },
  { id: '00000000-0000-4000-8000-000000000a06', username: 'zz.salesgm', full_name: 'ZZ Sales GM',       permission_level: 'gm',        entity: 'PTB', dept: 'sales' },
  { id: '00000000-0000-4000-8000-000000000a07', username: 'zz.ptacct',  full_name: 'ZZ PT Accounts',    permission_level: 'executive', entity: 'PT',  dept: 'accounts' },
]

export async function insertStubUsers(db) {
  for (const u of STUB_USERS) {
    // public.users.id REFERENCES auth.users(id) (users_id_fkey, in the snapshot);
    // auth.users needs only an id here. These are the stub's auth rows.
    await db.query(`INSERT INTO auth.users (id, email, aud, role) VALUES ($1, $2, 'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING`,
      [u.id, u.username + '@example.invalid'])
    await db.query(
      `INSERT INTO public.users (id, username, full_name, permission_level, entity_id, department_id, is_active, email)
       VALUES ($1, $2, $3, $4,
               (SELECT id FROM public.entities WHERE code = $5),
               (SELECT id FROM public.departments WHERE code = $6), true, $2 || '@example.invalid')
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.username, u.full_name, u.permission_level, u.entity, u.dept])
  }
  return STUB_USERS.length
}

/** Impersonate a user the way PostgREST does: a JWT claims GUC for auth.uid(). */
export async function actAs(db, userId) {
  await db.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: 'authenticated' })])
}

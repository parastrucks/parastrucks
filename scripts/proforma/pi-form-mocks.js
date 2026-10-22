// Recording stand-ins for everything ProformaInvoice.jsx imports that talks to the outside world.
// Used by selftest-pi-form-diff.cjs: they capture what the component WOULD send, so two builds compare.
const R = () => globalThis.__rec

export const supabase = {
  from(table) {
    const q = {
      select() { return q }, eq() { return q },
      single() { return Promise.resolve({ data: globalThis.__ENT, error: null }) },
      insert(payload) { R().inserts.push({ table, payload: JSON.parse(JSON.stringify(payload)) }); return Promise.resolve({ error: null }) },
    }
    return q
  },
  rpc(fn, args) { R().rpcs.push({ fn, args }); return Promise.resolve({ data: 'PI-T-' + R().rpcs.length, error: null }) },
}

export async function fetchAllRows() { return globalThis.__CATALOG }

export function useAuth() { return globalThis.__auth }

const toast = { success: m => R().toasts.push(['success', m]), error: m => R().toasts.push(['error', m]) }
export function useToast() { return toast }

export async function generateProformaPdf(args) { R().pdfs.push(JSON.parse(JSON.stringify(args))) }

export default function Icon() { return null }

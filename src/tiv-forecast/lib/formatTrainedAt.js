// A date the browser cannot parse must never reach the screen as the words
// "Invalid Date" — that reads as a broken page, when the truth is only that a
// timestamp is missing.
//
// It is missing for a legitimate reason: `trained_at` is stamped by the
// database, so the params object `retrainModel` builds in the browser has none
// until the stored row is read back. Straight after an upload the status strip
// therefore held `new Date(undefined)`, and said so — at the exact moment the
// user is watching hardest.
//
// Lives in its own module so the self-test can exercise the shipped function
// without dragging the page's Supabase client into a node process.
export function formatTrainedAt(value) {
  if (value === null || value === undefined || value === '') return 'just now'
  const d = new Date(value)
  if (isNaN(d.getTime())) return 'just now'
  return d.toLocaleDateString('en-IN')
}

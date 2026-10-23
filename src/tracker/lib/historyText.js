// Phase 10 — a row's history (tracker_audit, read through the Edge Function's "history" action) in words.
// Pure, tested by scripts/phase10/selftest-tracker-cells.mjs.
import { showValue } from './showValue.js'

const HOW = {
  typed: 'typed', paste: 'pasted', fill: 'filled', undo: 'undone', redo: 'redone', delete: 'cleared',
  create: 'added', import: 'imported', revert: 'reverted', unknown: '',
}

const when = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

// entry: { column_key, old_value, new_value, actor_name, source, created_at }; colByKey: columnMeta's COLUMN_BY_KEY
export function describeChange(entry, colByKey) {
  const at = when.format(new Date(entry.created_at))
  const who = entry.actor_name ?? 'someone'
  if (entry.column_key === '*') {
    return { at, who, what: 'Vehicle added', from: '', to: entry.new_value ?? '', how: HOW[entry.source] ?? entry.source }
  }
  const col = colByKey[entry.column_key]
  return {
    at, who,
    what: col?.label ?? entry.column_key,
    from: showValue(col, entry.old_value),
    to: showValue(col, entry.new_value),
    how: HOW[entry.source] ?? entry.source,
  }
}

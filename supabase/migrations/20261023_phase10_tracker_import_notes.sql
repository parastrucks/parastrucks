-- Phase 10 — Vehicle Tracker: notes written by the import (source 'import').
--
-- The first real load merges six families of workbooks into one row per truck; where the files disagree
-- (CTC on ~25% of trucks between the purchase file and the rest), the value shown comes from the column's
-- home file and every other file's different value is kept as a note on that cell — so the team sees the
-- disagreement where it matters (plan §2.5, pilot first). Those notes are neither a person's note
-- ('portal') nor an Excel comment ('excel_comment') nor a hand-typed formula ('excel_formula').
-- Additive: every existing note stays valid.
--
-- Rollback (only while no 'import' note exists):
--   alter table public.unit_cell_notes drop constraint unit_cell_notes_source_check;
--   alter table public.unit_cell_notes add constraint unit_cell_notes_source_check
--     check (source in ('portal','excel_comment','excel_formula'));

begin;

alter table public.unit_cell_notes drop constraint unit_cell_notes_source_check;
alter table public.unit_cell_notes add constraint unit_cell_notes_source_check
  check (source in ('portal', 'excel_comment', 'excel_formula', 'import'));

commit;

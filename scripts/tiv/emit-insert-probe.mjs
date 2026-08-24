// Emits a SELF-ABORTING insert probe for tiv_forecast_model_params.
// Builds the REAL v3 retrain payload from the workbook, wraps a real INSERT in a
// DO block, then raises so the transaction rolls back. Postgres validates the
// full column set (names, types, NOT NULLs) and keeps nothing.
//
// This exercises exactly what admin-tiv does: insert({...params, entity_id, brand_id}).
import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel }   from '../../src/tiv-forecast/lib/retrainModel.js'

const [file, entityId, brandId] = process.argv.slice(2)
const buf = fs.readFileSync(file)
const p = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const params = retrainModel(p.tivActuals, p.ptbActuals, p.alActuals)

// Mirror admin-tiv exactly: spread the retrain output, then inject ids.
const row = { ...params, entity_id: entityId, brand_id: brandId }

const cols = Object.keys(row)
const lit  = v => (v === null || v === undefined)
  ? 'NULL'
  : (typeof v === 'number' ? String(v)
    : typeof v === 'string' ? `$lit$${v}$lit$`
    : `$lit$${JSON.stringify(v)}$lit$::jsonb`)

const sql = `DO $probe$
DECLARE inserted_id bigint;
BEGIN
  INSERT INTO public.tiv_forecast_model_params (${cols.join(', ')})
  VALUES (${cols.map(c => lit(row[c])).join(', ')})
  RETURNING id INTO inserted_id;

  -- Deliberate abort: the row was accepted, so the column set is correct.
  -- Raising rolls the whole thing back, leaving the table untouched.
  RAISE EXCEPTION 'PROBE_OK inserted_id=% cols=%', inserted_id, ${cols.length};
END
$probe$;`

console.log(sql)
console.error(`columns: ${cols.length}\n${cols.join(', ')}`)

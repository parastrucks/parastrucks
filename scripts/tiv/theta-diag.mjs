import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel }   from '../../src/tiv-forecast/lib/retrainModel.js'
import { SEG_COL }        from '../../src/tiv-forecast/constants.js'

const buf = fs.readFileSync(process.argv[2])
const p = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength))
const P = retrainModel(p.tivActuals, p.ptbActuals, p.alActuals)

const EXPECT = { 'Aug-26': {Haulage:109, MAV:125}, 'Sep-26': {Haulage:184, MAV:102}, 'Oct-26': {Haulage:159, MAV:157} }
const MN = {'Aug-26':8,'Sep-26':9,'Oct-26':10}

for (const seg of ['Haulage','MAV']) {
  const tp = P.theta_params[seg]
  console.log(`\n=== ${seg} ===  t12=${(P.yoy_t12[seg]*100).toFixed(2)}%  theta{slope=${tp.slope.toFixed(4)}, ic=${tp.intercept.toFixed(3)}, ses=${tp.ses.toFixed(3)}, n=${tp.n}}`)
  let h = 0
  for (const label of ['Aug-26','Sep-26','Oct-26']) {
    h++
    const m = MN[label]
    const si = P.seasonal_indices[seg][m]
    const plain = P.smly_plain[label][seg]
    const smly = plain * (1 + P.yoy_t12[seg])
    const thetaDes = (tp.intercept + tp.slope*(tp.n + h - 1) + tp.ses)/2
    const theta = thetaDes * si
    const base = 0.6*smly + 0.4*theta
    const want = EXPECT[label][seg]
    // what theta would be needed to hit `want`?
    const needTheta = (want - 0.6*smly)/0.4
    console.log(` ${label} h=${h} SI=${si.toFixed(4)} plain=${plain} smly=${smly.toFixed(2)}`)
    console.log(`   thetaDeseas=${thetaDes.toFixed(2)} theta=${theta.toFixed(2)} -> base=${base.toFixed(2)} (want ${want})`)
    console.log(`   need theta=${needTheta.toFixed(2)}  => needThetaDeseas=${(needTheta/si).toFixed(2)}  ratio=${(needTheta/theta).toFixed(4)}`)
  }
}

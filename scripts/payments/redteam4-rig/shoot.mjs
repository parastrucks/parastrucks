// Screenshot every rendered state at the five viewports. Viewport-only shot
// (what the eye sees without scrolling) and a full-page shot.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const OUT = path.resolve(process.argv[2] || './out')
const only = process.argv[3] ? process.argv[3].split(',') : null
const VIEWPORTS = [
  { name: '360', width: 360, height: 640, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '412', width: 412, height: 915, mobile: true },
  { name: 'land', width: 667, height: 375, mobile: true },
  { name: 'desk', width: 1280, height: 800, mobile: false },
]
const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'))
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
let n = 0
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: 'light' })
  const page = await ctx.newPage()
  for (const s of index) {
    if (only && !only.includes(s.id)) continue
    await page.goto('file://' + path.join(OUT, `${s.id}.html`), { waitUntil: 'load' })
    await page.waitForTimeout(80)
    await page.screenshot({ path: path.join(OUT, `${s.id}-${vp.name}.png`) })
    n++
    // Scroll steps: what a thumb sees after each screen of scrolling. A full-page
    // capture paints the fixed bars mid-page, which no user ever sees.
    if (vp.mobile && !s.overlay) {
      const total = await page.evaluate(() => document.documentElement.scrollHeight)
      const step = Math.round(vp.height * 0.8)
      for (let y = step, i = 1; y < total - vp.height + step && i <= 6; y += step, i++) {
        await page.evaluate((yy) => { document.scrollingElement.scrollTop = yy }, y)
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(OUT, `${s.id}-${vp.name}-s${i}.png`) })
        n++
      }
      await page.evaluate(() => window.scrollTo(0, 0))
    }
  }
  await ctx.close()
}
await browser.close()
console.log(`${n} screenshots → ${OUT}`)

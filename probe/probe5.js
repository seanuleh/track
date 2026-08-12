// Sweeps every modal for open-time reflow: a sheet whose content arrives async
// paints short and then grows, which reads as "it opened, then expanded".
// Also captures the food picker's first frame under a throttled network, to see
// what the skeleton actually looks like while the browse lists are in flight.

const { chromium } = require('/tmp/node_modules/playwright')
const fs = require('fs')
const auth = JSON.parse(fs.readFileSync('/tmp/trackprobe/auth.json', 'utf8'))
const OUT = '/tmp/trackprobe/shots5'

async function stability(page, label) {
  const series = await page.evaluate(async () => {
    const out = []
    const t0 = performance.now()
    return await new Promise(resolve => {
      function tick() {
        const ms = document.querySelectorAll('.modal')
        const m = ms[ms.length - 1]
        if (m) {
          const b = m.getBoundingClientRect()
          out.push({ t: Math.round(performance.now() - t0), h: Math.round(b.height) })
        }
        if (performance.now() - t0 < 1400) requestAnimationFrame(tick)
        else resolve(out)
      }
      requestAnimationFrame(tick)
    })
  })
  if (!series.length) return console.log(`  ${label}: no modal`)
  const first = series[0].h, last = series[series.length - 1].h
  const jumps = []
  for (let i = 1; i < series.length; i++) {
    const d = series[i].h - series[i - 1].h
    if (Math.abs(d) > 2) jumps.push(`${series[i].t}ms ${d > 0 ? '+' : ''}${d}px`)
  }
  const verdict = jumps.length ? `** ${jumps.join(', ')} **` : 'stable'
  console.log(`  ${label.padEnd(26)} ${String(first).padStart(4)}px → ${String(last).padStart(4)}px   ${verdict}`)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 475, height: 605 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  })
  await ctx.addInitScript(a => localStorage.setItem('pocketbase_auth', JSON.stringify(a)), auth)
  const page = await ctx.newPage()
  const goTab = async l => {
    await page.evaluate(x => [...document.querySelectorAll('.tab')].find(b => b.textContent.trim() === x).click(), l)
    await page.waitForTimeout(1000)
  }
  const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(450) }

  await page.goto('http://127.0.0.1:5199', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  console.log('open-time reflow, cover viewport:')

  await goTab('Diary')
  let p = page.locator('.fab').click(); await stability(page, 'FoodPickerSheet'); await p; await esc()
  p = page.locator('.log-card').first().click(); await stability(page, 'FoodEntryModal'); await p; await esc()
  p = page.locator('.log-card', { hasText: 'Ninja Creami' }).first().click()
  await stability(page, 'RecipeGroupModal'); await p; await esc()
  p = page.locator('.header-edit-btn').click(); await stability(page, 'TargetsModal'); await p; await esc()
  p = page.locator('.date-nav-copy').click(); await stability(page, 'CopyDateModal'); await p; await esc()

  await goTab('Foods')
  await page.locator('.log-card', { hasText: 'Chicken Breast' }).first().click()
  await page.waitForTimeout(400)
  p = page.locator('.btn', { hasText: 'Edit' }).first().click()
  await stability(page, 'FoodEditModal'); await p

  // kJ readout inside the kcal field: must track edits live and not sit on top of
  // the typed number (AU panels print kJ, so this is how a scan gets validated).
  {
    const kcal = page.locator('.input-with-suffix .form-input').first()
    await kcal.fill('200')
    await page.waitForTimeout(150)
    const geo = await page.evaluate(() => {
      const wrap = document.querySelector('.input-with-suffix')
      const inp = wrap.querySelector('.form-input')
      const sfx = wrap.querySelector('.input-suffix')
      if (!sfx) return null
      const i = inp.getBoundingClientRect(), s = sfx.getBoundingClientRect()
      return {
        text: sfx.textContent,
        overflowsField: s.right > i.right + 1,
        padRight: getComputedStyle(inp).paddingRight,
        suffixWidth: Math.round(s.width),
      }
    })
    if (!geo) console.log('[cover] kcal kJ suffix: MISSING')
    else {
      const ok = geo.text === '837 kJ' && !geo.overflowsField &&
        parseFloat(geo.padRight) >= geo.suffixWidth + 8
      console.log(`  kcal kJ suffix: 200 kcal → "${geo.text}" ` +
        `(pad ${geo.padRight} vs ${geo.suffixWidth}px) ${ok ? 'ok' : '** BAD **'}`)
    }
    await page.screenshot({ path: `${OUT}/food-edit-kj.png` })
  }
  await esc()

  // Recipe log (edit-before-log) — resolves each ingredient's food record.
  await goTab('Foods')
  await page.locator('.log-card', { hasText: 'Overnight Oats' }).first().click()
  await page.waitForTimeout(400)
  p = page.locator('.btn', { hasText: 'Add' }).first().click()
  await stability(page, 'RecipeLogModal'); await p; await esc()

  // Catalog search, from the Foods FAB.
  await page.locator('.fab').click(); await page.waitForTimeout(400)
  p = page.locator('.fab-action', { hasText: 'Search catalog' }).click()
  await stability(page, 'CatalogSearchModal'); await p; await esc()

  await goTab('Weight')
  p = page.locator('.fab').click(); await stability(page, 'AddEditModal'); await p; await esc()

  // ── Skeleton frame, with the API slowed so it's actually visible ────────
  await ctx.route('**/api/collections/**', async route => {
    await new Promise(r => setTimeout(r, 900))
    await route.continue()
  })
  await goTab('Diary')
  await page.locator('.fab').click({ noWaitAfter: true })
  await page.waitForTimeout(260)
  await page.screenshot({ path: `${OUT}/picker-skeleton.png` })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/picker-loaded.png` })
  console.log('\nskeleton + loaded frames written to', OUT)

  await browser.close()
})()

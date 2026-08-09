// UI probe for the track app: drives the real SPA in Chromium at the two
// Galaxy Z Fold 8 viewport widths measured on-device (cover 475px, unfolded
// ~674px) plus desktop, screenshotting every surface and collecting layout
// diagnostics (horizontal overflow, elements outside the viewport, console
// errors). Points at the throwaway PocketBase copy on :8090 via vite's proxy.

const { chromium } = require('/tmp/node_modules/playwright')
const fs = require('fs')

const BASE = 'http://127.0.0.1:5199'
const OUT = '/tmp/trackprobe/shots'
const auth = JSON.parse(fs.readFileSync('/tmp/trackprobe/auth.json', 'utf8'))

const VIEWPORTS = [
  { name: 'cover', width: 475, height: 605, mobile: true },
  { name: 'unfolded', width: 674, height: 830, mobile: true },
  { name: 'desktop', width: 1200, height: 900, mobile: false },
]

const findings = []
function note(vp, where, msg) {
  findings.push(`[${vp}] ${where}: ${msg}`)
  console.log(`[${vp}] ${where}: ${msg}`)
}

async function diagnose(page, vp, where) {
  const r = await page.evaluate(() => {
    const out = { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, overflowing: [] }
    const vw = document.documentElement.clientWidth
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      if (b.right > vw + 1 || b.left < -1) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed' && cs.opacity === '0') continue
        out.overflowing.push({
          sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
          left: Math.round(b.left), right: Math.round(b.right), text: (el.textContent || '').trim().slice(0, 40),
        })
      }
    }
    // only report the outermost offenders
    return out
  })
  if (r.scrollW > r.clientW + 1) note(vp, where, `horizontal overflow: scrollWidth ${r.scrollW} > clientWidth ${r.clientW}`)
  const seen = new Set()
  for (const o of r.overflowing.slice(0, 8)) {
    if (seen.has(o.sel)) continue
    seen.add(o.sel)
    note(vp, where, `element past right edge: ${o.sel} [${o.left}..${o.right}] "${o.text}"`)
  }
}

async function shot(page, vp, name) {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${vp}-${name}.png`, fullPage: false })
  await diagnose(page, vp, name)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()

  for (const v of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.mobile ? 2.625 : 1,
      isMobile: v.mobile,
      hasTouch: v.mobile,
    })
    await ctx.addInitScript(a => {
      localStorage.setItem('pocketbase_auth', JSON.stringify(a))
    }, auth)

    const page = await ctx.newPage()

    // The tab bar is hidden at rest on touch viewports (it's a swipe
    // confirmation there), so drive it with a forced click rather than a
    // gesture — this probe is about layout, not the swipe itself.
    const goTab = async label => {
      // Dispatch straight on the element: the bar is pointer-events:none at
      // rest on touch viewports, and a coordinate-based forced click would
      // land on the card underneath it instead.
      await page.evaluate(l => {
        [...document.querySelectorAll('.tab')].find(b => b.textContent.trim() === l).click()
      }, label)
      await page.waitForTimeout(900)
    }
    // Escape must actually dismiss; if it doesn't, that's a finding in itself.
    const dismiss = async where => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      if (await page.locator('.modal-overlay').count()) {
        note(v.name, where, 'Escape did not dismiss the modal — falling back to the close button')
        await page.locator('.modal-close').last().click({ force: true })
        await page.waitForTimeout(400)
      }
    }
    const errors = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', e => errors.push('pageerror: ' + e.message))

    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    await goTab('Diary')

    // ── Diary ──────────────────────────────────────────────────────────
    await shot(page, v.name, '01-diary')

    // Diary: tap a log card → FoodEntryModal
    await page.locator('.log-card').first().click()
    await shot(page, v.name, '02-entry-modal')
    await dismiss('02-entry-modal')

    // Diary: tap the grouped recipe card
    const grp = page.locator('.log-card', { hasText: 'Ninja Creami' }).first()
    if (await grp.count()) {
      await grp.click()
      await shot(page, v.name, '03-recipe-group-modal')
      await dismiss('03-recipe-group-modal')
    }

    // Diary: FAB → picker sheet
    await page.locator('.fab').click()
    await shot(page, v.name, '04-picker-sheet')
    // typed search inside the sheet
    await page.locator('.modal .form-input').first().fill('chick')
    await page.waitForTimeout(700)
    await shot(page, v.name, '05-picker-search')
    // long list: type something with many catalog hits
    await page.locator('.modal .form-input').first().fill('milk')
    await page.waitForTimeout(900)
    await shot(page, v.name, '06-picker-search-long')
    await dismiss('06-picker-sheet')

    // Targets modal
    await page.locator('.header-edit-btn').click()
    await shot(page, v.name, '07-targets-modal')
    await dismiss('07-targets-modal')

    // Copy-day modal
    await page.locator('.date-nav-copy').click()
    await shot(page, v.name, '08-copy-modal')
    await dismiss('08-copy-modal')

    // ── Foods ──────────────────────────────────────────────────────────
    await goTab('Foods')
    await shot(page, v.name, '10-foods')

    await page.locator('.log-card').nth(2).click()
    await shot(page, v.name, '11-foods-expanded')
    await page.locator('.log-card').nth(2).click()
    await page.waitForTimeout(200)

    // scroll far down the (infinite) list
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(700)
    await shot(page, v.name, '12-foods-scrolled')
    await page.evaluate(() => window.scrollTo(0, 0))

    // Foods FAB speed dial
    await page.locator('.fab').click()
    await shot(page, v.name, '13-foods-fab')
    await page.locator('.fab-backdrop').click({ force: true }).catch(() => {})
    await page.waitForTimeout(250)

    // Recipes sub-tab
    await page.locator('.food-tab', { hasText: 'Recipes' }).click()
    await page.waitForTimeout(700)
    await shot(page, v.name, '14-recipes')

    // ── Weight ─────────────────────────────────────────────────────────
    await goTab('Weight')
    await page.waitForTimeout(600)
    await shot(page, v.name, '20-weight')

    await page.locator('.pill', { hasText: 'All' }).click()
    await page.waitForTimeout(1000)
    await shot(page, v.name, '21-weight-all')

    await page.locator('.fab').click()
    await shot(page, v.name, '22-weight-modal')
    await dismiss('22-weight-modal')

    if (errors.length) note(v.name, 'console', errors.slice(0, 10).join(' | '))
    await ctx.close()
  }

  // ── Fold/unfold live resize: does anything fail to re-measure? ────────
  {
    const ctx = await browser.newContext({ viewport: { width: 475, height: 605 }, isMobile: true, hasTouch: true })
    await ctx.addInitScript(a => {
      localStorage.setItem('pocketbase_auth', JSON.stringify(a))
    }, auth)
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.evaluate(() => [...document.querySelectorAll('.tab')].find(b => b.textContent.trim() === 'Weight').click())
    await page.waitForTimeout(1500)
    const before = await page.evaluate(() => {
      const ind = document.querySelector('.pill-indicator')
      const act = document.querySelector('.pill.active')
      return { ind: ind.getBoundingClientRect().left, act: act.getBoundingClientRect().left, w: innerWidth }
    })
    await page.setViewportSize({ width: 674, height: 830 })
    await page.waitForTimeout(900)
    const after = await page.evaluate(() => {
      const ind = document.querySelector('.pill-indicator')
      const act = document.querySelector('.pill.active')
      return { ind: ind.getBoundingClientRect().left, act: act.getBoundingClientRect().left, w: innerWidth }
    })
    await page.screenshot({ path: `${OUT}/fold-resize-weight.png` })
    note('resize', 'pill-indicator',
      `cover: indicator@${before.ind.toFixed(0)} vs active pill@${before.act.toFixed(0)}; ` +
      `after unfold to ${after.w}px: indicator@${after.ind.toFixed(0)} vs active pill@${after.act.toFixed(0)} ` +
      `→ drift ${Math.abs(after.ind - after.act).toFixed(0)}px`)
    await ctx.close()
  }

  await browser.close()
  fs.writeFileSync('/tmp/trackprobe/findings.txt', findings.join('\n'))
  console.log('\n--- ' + findings.length + ' findings ---')
})()

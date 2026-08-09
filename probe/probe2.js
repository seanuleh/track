// Targeted probe for the interaction-level jank that a static screenshot of an
// un-scrolled modal can't show: content leaking past the sticky modal header,
// the page scrolling behind an open sheet, and a drag that starts inside the
// modal but ends on the backdrop closing it (losing typed input).

const { chromium } = require('/tmp/node_modules/playwright')
const fs = require('fs')
const auth = JSON.parse(fs.readFileSync('/tmp/trackprobe/auth.json', 'utf8'))
const OUT = '/tmp/trackprobe/shots2'

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 475, height: 605 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  })
  await ctx.addInitScript(a => localStorage.setItem('pocketbase_auth', JSON.stringify(a)), auth)
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:5199', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // ── 1. Sticky header gutter leak ───────────────────────────────────────
  await page.locator('.fab').click()
  await page.waitForTimeout(500)
  await page.locator('.modal').evaluate(m => { m.scrollTop = 220 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/sticky-header-scrolled.png` })

  const geom = await page.evaluate(() => {
    const modal = document.querySelector('.modal')
    const head = document.querySelector('.modal-header')
    const mb = modal.getBoundingClientRect(), hb = head.getBoundingClientRect()
    return {
      modal: [Math.round(mb.left), Math.round(mb.right)],
      header: [Math.round(hb.left), Math.round(hb.right)],
      gutterLeft: Math.round(hb.left - mb.left),
      gutterRight: Math.round(mb.right - hb.right),
      headerBg: getComputedStyle(head).backgroundColor,
      modalBorderTop: getComputedStyle(modal).borderTopWidth + ' ' + getComputedStyle(modal).borderTopColor,
      scrollTop: modal.scrollTop,
    }
  })
  console.log('sticky header geometry:', JSON.stringify(geom))

  // ── 2. Does the page scroll behind the open sheet? ─────────────────────
  const beforeY = await page.evaluate(() => window.scrollY)
  await page.mouse.move(237, 120)   // over the backdrop, above the sheet
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(400)
  const afterY = await page.evaluate(() => window.scrollY)
  console.log(`page scroll behind open modal: ${beforeY} -> ${afterY}` +
    (afterY !== beforeY ? '  ** BACKGROUND SCROLLED **' : '  (locked)'))

  // scroll chaining: scroll the sheet's own list to its end, keep going
  const chain = await page.evaluate(async () => {
    const m = document.querySelector('.modal')
    m.scrollTop = m.scrollHeight
    const y0 = window.scrollY
    m.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 200))
    return { y0, y1: window.scrollY, overscroll: getComputedStyle(m).overscrollBehaviorY }
  })
  console.log('overscroll-behavior-y on .modal:', chain.overscroll)

  // ── 3. Drag starting in the modal, ending on the backdrop ──────────────
  await page.locator('.modal .form-input').first().fill('chicken breast')
  await page.waitForTimeout(600)
  const box = await page.locator('.modal .form-input').first().boundingBox()
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 5 })
  await page.mouse.move(237, 60, { steps: 5 })   // release on the backdrop
  await page.mouse.up()
  await page.waitForTimeout(400)
  const stillOpen = await page.locator('.modal-overlay').count()
  console.log('drag from inside the modal, released on the backdrop:',
    stillOpen ? 'modal stayed open (good)' : '** MODAL CLOSED — typed input lost **')

  if (!stillOpen) { await page.locator('.fab').click(); await page.waitForTimeout(400) }

  // ── 4. Sticky :hover after a tap (touch) ───────────────────────────────
  await page.locator('.modal .form-input').first().fill('')
  await page.waitForTimeout(600)
  const row = page.locator('.modal .search-result').first()
  await row.tap()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/after-tap.png` })

  // ── 5. Bottom inset: how close is the sheet's last control to the edge? ─
  await page.waitForTimeout(300)
  const inset = await page.evaluate(() => {
    const btn = document.querySelector('.modal-actions .btn:last-child')
    if (!btn) return null
    const b = btn.getBoundingClientRect()
    return { bottomGap: Math.round(innerHeight - b.bottom), safeArea: getComputedStyle(document.body).getPropertyValue('padding-bottom') }
  })
  console.log('gap from the sheet\'s primary button to the viewport bottom:', JSON.stringify(inset))
  await page.screenshot({ path: `${OUT}/entry-modal-bottom.png` })

  await browser.close()
})()

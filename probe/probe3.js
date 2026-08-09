// Screenshots the in-app confirm sheets that replaced window.confirm, at the
// Fold cover viewport, and checks each stacks above its parent modal and that
// Escape dismisses only the confirm.

const { chromium } = require('/tmp/node_modules/playwright')
const fs = require('fs')
const auth = JSON.parse(fs.readFileSync('/tmp/trackprobe/auth.json', 'utf8'))
const OUT = '/tmp/trackprobe/shots3'

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 475, height: 605 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  })
  await ctx.addInitScript(a => localStorage.setItem('pocketbase_auth', JSON.stringify(a)), auth)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const goTab = async l => {
    await page.evaluate(x => [...document.querySelectorAll('.tab')].find(b => b.textContent.trim() === x).click(), l)
    await page.waitForTimeout(900)
  }

  await page.goto('http://127.0.0.1:5199', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  async function checkConfirm(name) {
    await page.waitForSelector('.modal--confirm', { timeout: 5000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${name}.png` })
    const n = await page.locator('.modal-overlay').count()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const after = await page.locator('.modal-overlay').count()
    const gone = await page.locator('.modal--confirm').count()
    console.log(`${name}: overlays ${n} -> ${after}, confirm dismissed by Escape: ${gone === 0}` +
      (n > 1 && after === n - 1 ? ', parent modal survived (good)' : n > 1 ? ' ** PARENT ALSO CLOSED **' : ''))
  }

  // 1. Diary log entry → Delete
  await goTab('Diary')
  await page.locator('.log-card').first().click()
  await page.waitForTimeout(500)
  await page.locator('.btn-danger').click()
  await checkConfirm('confirm-log-entry')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // 2. Logged recipe group → Delete
  const grp = page.locator('.log-card', { hasText: 'Ninja Creami' }).first()
  await grp.click()
  await page.waitForTimeout(500)
  await page.locator('.btn-danger').click()
  await checkConfirm('confirm-recipe-group')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // 3. Foods manager → edit a food → Delete (counts usage first)
  await goTab('Foods')
  await page.locator('.log-card', { hasText: 'Chicken Breast' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('.btn', { hasText: 'Edit' }).first().click()
  await page.waitForTimeout(800)
  await page.locator('.btn-danger').click()
  await checkConfirm('confirm-food-in-use')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // 4. Weight entry → delete icon
  await goTab('Weight')
  await page.locator('.entry-card').first().click()
  await page.waitForTimeout(300)
  await page.locator('.entry-card .icon-btn.danger').first().click({ force: true })
  await checkConfirm('confirm-weight-entry')

  console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors')
  await browser.close()
})()

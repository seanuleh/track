# UI probe — driving the real app in a browser

A harness for looking at this app the way it actually renders, on the screens it
actually runs on, without touching production. Built while chasing a batch of
mobile layout bugs; kept because every one of them was invisible in the source
and obvious in a screenshot.

```sh
./probe/run.sh          # set up, run all probes, tear down
./probe/run.sh --keep   # leave the stack up to iterate against
./probe/run.sh --down   # tear down a stack left up by --keep
```

## Read this before reaching for a browser tool

**Use Playwright, not Selenium.** This host has no `chrome`, `chromium` or
`chromedriver`, and installing one needs root. `npx playwright install chromium`
drops a browser into `~/.cache/ms-playwright` as an ordinary user, no sudo, in
about a minute. The `selenium` pip package is not installed either and would
still need a browser binary. Don't spend a turn rediscovering this.

**Never point the probe at production.** `run.sh` restores the newest
`/data/track/backups/*.tar.gz` into `/tmp/trackdev` and serves it from a
throwaway `trackdev` container on :8090. An automated click run *will* write
records; against `/data/track` it would write real ones.

**Get auth without admin credentials.** The `users` collection has an open
create rule, so `mkuser.py` signs up a throwaway user over the public API and
mints a token. Reading admin credentials out of the container environment to
mint one is both unnecessary and likely to be refused.

**Seed the token into `localStorage`, not through a login screen.** There is no
login screen — auth arrives from the cf-auth sidecar (see CLAUDE.md). The probe
reproduces it with:

```js
await ctx.addInitScript(a => localStorage.setItem('pocketbase_auth', JSON.stringify(a)), auth)
```

where `auth` is `{ token, model }`, the exact shape the PocketBase SDK expects.

**Don't drive the tab bar with a coordinate click.** It's `pointer-events: none`
at rest on touch viewports (it's a swipe confirmation there). A Playwright
`click({ force: true })` still dispatches at the element's coordinates, so it
hit-tests through to the *card underneath* and opens a food entry modal instead
— which cost a debugging cycle. Dispatch straight on the element:

```js
await page.evaluate(l => [...document.querySelectorAll('.tab')]
  .find(b => b.textContent.trim() === l).click(), 'Diary')
```

**`addInitScript` runs on every navigation.** Setting `trackTab.v2` there and
then trying to switch tabs by reload silently resets the tab each time.

## Viewports

Use these, not generic phone presets. Measured on-device — see the table in
`~/docs/fold-dashboard.md`.

| Name | CSS width | Notes |
|---|---|---|
| cover | 475 × 605 | Galaxy Z Fold 8 cover screen, portrait, DPR 2.625. **Wider than it looks** — do not assume ~400px |
| unfolded | 674 × 830 | inner screen; anything > 550px |
| desktop | 1200 × 900 | mouse, so `@media (hover: hover)` rules apply |

475px sits just under the app's 520px density breakpoint and just over nothing
else, which makes it the viewport most worth checking after any CSS change.

## What each probe covers

**`probe.js`** — walks every surface at all three viewports and screenshots it:
diary, entry modal, recipe group, picker sheet (idle, searching, long results),
targets, copy-day, foods list, expanded row, infinite scroll, FAB speed dial,
recipes, weight at two windows, weight modal. After each shot it checks for
horizontal overflow and elements past the right edge, and it collects console
errors per viewport. It finishes with a **live fold/unfold**: resizing the
viewport from 475 to 674 without a reload, the way the Fold reuses one webview
across a fold, then asserts the window-pill indicator still lines up with the
selected pill. That check is what caught a 50px drift.

**`probe2.js`** — the interaction-level jank a screenshot of an idle modal can't
show, all at the cover viewport:

- scrolls a modal and measures the sticky header's gutters against the sheet
  edges (this found content leaking past the header — the "white border")
- whether the page scrolls behind an open sheet, and whether scroll chains out
  of the sheet at its end (`overscroll-behavior`)
- a drag that starts inside the modal and is released on the backdrop — it used
  to dismiss and lose typed input
- `:hover` latched onto a tapped row on touch
- how close the sheet's primary button sits to the bottom edge

**`probe3.js`** — the in-app confirm sheets that replaced `window.confirm`. For
each of the four delete paths it checks the sheet stacks *above* its parent
modal and that Escape dismisses only the confirm, leaving the parent open.

**`probe5.js`** — open-time reflow across every modal. Samples the sheet's
height every animation frame for 1.4s after the click and reports any change
over 2px. A sheet whose content arrives asynchronously paints at whatever has
loaded and then grows, which reads as "it opened, then expanded" — the food
picker used to open at 234px and jump to 514px at ~50-110ms, in the middle of
its own fade. Every modal should read `stable`. It also captures the picker's
skeleton frame with the API artificially slowed to 900ms.

All four print findings to stdout; `probe.js` also writes `findings.txt`.
Silence is a pass.

## Adding a case

Put layout and appearance checks in `probe.js` (one `shot()` per surface —
`diagnose()` runs automatically), anything needing a gesture, a scroll position
or a measurement in `probe2.js`, and any new modal in `probe5.js`'s sweep.

If you make a sheet's content load asynchronously, give it a stable height (see
`.modal--picker`) or reserve the space with skeleton rows, and add it to
`probe5.js`. Content-height sheets that fill in after mount are the single
easiest way to reintroduce open jank. When a bug is confirmed, leave the
check behind: every assertion in here started as a bug someone had to find by
eye.

`seed.py` builds a realistic day — 20 foods with units and portions, 3 recipes
(one favourited, one logged as an expanded group), 5 days of logs across all
four meals, a daily target, and 18 months of weight entries across three
medication phases so the chart's colour-banding and legend have something to
draw. Extend it rather than testing against an empty account; most of the
layout bugs found here only appear with real-length names and full macro rows.

Note that `foods` and `food_catalog` are shared, not user-scoped, so the probe
user sees the real food library and the 75k-row OFF mirror from the backup —
searches return realistic results without seeding any of it.

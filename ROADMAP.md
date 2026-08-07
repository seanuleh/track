# Calorie tracking — roadmap & handoff

Written 2026-08-08, at the end of the session that added food tracking to the weight
tracker. Read this **and** `CLAUDE.md` before extending the food side.

`CLAUDE.md` describes what the app *is*. This file describes what it *isn't yet*, and
the things that were learned the hard way so they don't get rediscovered.

---

## Where it got to

Shipped and working end-to-end:

- `foods` / `food_logs` / `recipes` collections (JS migrations — see `CLAUDE.md`)
- Barcode scanning: native `BarcodeDetector`, ZXing lazy fallback
- Open Food Facts lookup called **direct from the browser** (OFF sends
  `access-control-allow-origin: *`, so there is no worker and no API key)
- Write-through cache: cache hit → OFF → manual entry, each miss saved to `foods`
- Day view with per-meal grouping, macro totals, delete-on-tap
- Food/Weight tabs, swipe with wrap-around, auto-hiding pill bar

**Verified**: 600 ml Powerade → 150 kcal / 34.8 g carbs, through the real PB path.
**Not verified**: the camera. Nobody has scanned a physical barcode with this yet.
The first real scanning session is also the only way to get a true AU hit rate —
every coverage figure discussed so far was guessed barcodes and is worthless.

---

## Requested features

Listed in the order I'd build them: each one leans on the ones above it.

### 1. Meal categories — **mostly already done**

Don't rebuild this from scratch; check what's there first.

Already working: `meal` field on `food_logs`; `MEALS` constant and selectable meal
pills in `FoodEntryModal`; `defaultMeal()` guesses from the clock so the common case
needs no taps; `FoodView` groups the day's log under `MEAL_ORDER` headings.

Genuinely missing:
- Per-meal subtotals (currently only a day total)
- Reordering / moving an entry to another meal after logging
- The meal set is hard-coded in two files — `MEALS` in `FoodEntryModal.jsx` and
  `MEAL_ORDER` in `FoodView.jsx`. If it becomes user-configurable, unify them first.
- Logs with an empty `meal` are bucketed into `snack` by the view. If that matters,
  make it explicit rather than a fallback.

### 2. Searching food databases

The real gap. Today's search box queries **only the local `foods` cache** — things you
have already scanned or entered. Whole foods (chicken breast, rolled oats, a banana)
have no barcode and so can never enter the cache by scanning.

**Read this before picking a source — it invalidates the obvious approach:**

> Open Food Facts' `/search` endpoint is aggressively rate-limited and, when throttled,
> returns an **HTML "Page temporarily unavailable" body with HTTP 200**. It did this
> repeatedly during development at trivial request volumes. The barcode endpoint
> (`/api/v2/product/<code>.json`) is a different story — reliable and fast. **Do not
> build interactive search on OFF `/search`.** If you use it at all, treat a non-JSON
> body as a throttle signal, not a parse bug. `off.js` already guards this way.

Recommended instead, in order:

1. **AFCD (Australian Food Composition Database, FSANZ)** — the authoritative AU source
   for whole foods. ~1,600 items, free XLSX download, government data, static. No API,
   so it must be a one-off import into `foods` with `source: 'afcd'`. This is the right
   fix for "chicken breast" and it's a bounded, offline, one-afternoon job. **Start here.**
2. **FatSecret Platform API** — best AU *branded* coverage of the commercial options
   (Woolworths/Coles house brands), free tier, OAuth + attribution required. Worth it
   only if AFCD + scanning still leaves real gaps. Measure before committing.
3. **USDA FoodData Central** — free, huge, but US portions and fortification differ
   enough to be misleading for AU products. Last resort.

Note that a server-side key (FatSecret) breaks the current no-worker architecture —
you'd need a worker sidecar, and the `fridge` app is the pattern to copy.

### 3. Recipes

**Schema and API already exist and work; there is no UI.** See `recipes` in the
migration, and `createRecipe` / `getRecipes` / `logRecipe` / `deleteRecipe` in
`food/api.js`. `logRecipe` is written and unused.

The design decision worth preserving: **a recipe is a template, not a log entry.**
`logRecipe` expands its items into individual `food_logs` rows at log time, dividing by
`servings`. That means editing a recipe later never rewrites history you already
logged. Don't "simplify" this into a stored reference — it silently corrupts past days.

Still to build: a recipe list screen, a builder (search/scan foods into an item list),
serving-size handling, and a "log one serving" action on the day view.

### 4. Daily targets

Nothing exists. Needs a new collection (or user-scoped settings record) — kcal plus
optional protein/fat/carb targets, and ideally date-effective so changing a target
doesn't retroactively rescore old days.

UI: a ring or bar against the day total in the Food header. The header currently shows
a bare number, which is where the remaining/over figure belongs.

Consider deriving a suggested target from the weight trend — the weight data is right
there in the same database, which is the whole reason for putting food in this app.

### 5. Copy meals/foods to another day

Nothing exists. Cheapest useful version: on the day view, "copy this meal to today",
creating fresh `food_logs` rows with a new `date`. Everything needed is already in the
schema.

Natural follow-ons: duplicate a single entry, "log again" from a recent-foods list, and
copy a whole day. A recent-foods list is arguably higher value than search for daily
use — people eat the same things repeatedly.

---

## Gotchas that cost time

Infrastructure and PocketBase gotchas are in `CLAUDE.md` and `~/docs/track.md`. These
are the food-specific ones:

- **Macros are stored per 100 g. Always.** Every source normalises to that basis on
  ingestion, so a serving is one multiply (`macrosFor`). Don't introduce per-serving
  storage — it forces a unit check at every call site.
- **Missing macros are `null`, not `0`.** "Unknown" and "genuinely zero" must not be
  conflated, or totals quietly under-report. `FoodEntryModal` preserves this: a blank
  field stays blank.
- **OFF reports sodium in g/100 g** — stored as mg.
- **Some AU/EU products carry kJ but not kcal.** `off.js` derives kcal at 4.184 kJ/kcal.
  Australian labels lead with kJ, so this path is common, not an edge case.
- **OFF products can lack a name.** `off.js` returns `null` for those rather than
  caching a nameless record you can't identify later.
- **Coverage is not 100%** and never will be. Manual entry isn't a fallback bolted on
  the side, it's a core path — every miss must stay one tap from being logged.
- **The ZXing chunk is excluded from the SW precache** (`globIgnores` in
  `vite.config.js`, `manualChunks` names it). It's ~170 kB gzip that Chrome on Android
  never fetches. If you touch the build config, don't let it back into the precache —
  it regresses app-shell load time, which was a previously-fixed problem.

## Ideas not asked for

- **Recent foods** on the day view — likely the single biggest daily-use win, and
  cheap. See §5.
- **Contribute misses back to OFF.** Manual entries with a barcode are exactly what OFF
  is missing for AU products. Improves the shared DB and your own future hit rate.
- **Photo of the nutrition panel → Claude → fields.** The `fridge` app already shells
  out to the Claude CLI from a worker; that pattern would drop straight in and would
  make manual entry near-free.

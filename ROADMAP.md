# Calorie tracking — roadmap & handoff

Written 2026-08-08, at the end of the session that added food tracking to the weight
tracker, and updated the same day with the design decisions from the follow-up
discussion. Read this **and** `CLAUDE.md` before extending the food side.

`CLAUDE.md` describes what the app *is*. This file describes what it *isn't yet*, the
decisions already taken (with reasons, so they aren't silently reversed), and the
things learned the hard way so they aren't rediscovered.

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
- One real day imported from Cronometer (2026-08-07, 10 items, 1644.5 kcal)

**Verified**: the full OFF → `foods` → `food_logs` → totals path, against the live DB.
**Not verified**: the camera. Nobody has scanned a physical barcode with this yet. The
first real scanning session is also the only way to get a true AU hit rate — every
coverage figure discussed so far came from guessed barcodes and is worthless.

---

## Architecture decisions

Taken deliberately. Reverse them only with a reason better than "it seemed simpler".

### Diary and Foods are separate surfaces

What exists today is a **diary**: date-scoped, touched many times a day, entries are
disposable. What's being built next is a **library**: date-less, browsed and curated,
durable definitions that the diary references. Opposite shapes — cramming a
search-and-manage surface into a day view fights both.

Target nav: **Diary, Foods, Weight**, Diary default.

The Foods tab is a **manager** — browse, edit, curate, fix bad macros, build recipes.
It deliberately carries *no* daily-logging burden. Logging is launched from the diary.

### The food picker is the foundation, not any screen

"Choose a food" happens in at least four places: adding to the diary, adding an
ingredient to a recipe, swapping a component in a Creami, and managing
favourites. That is **one component**, used by all of them:

> search local cache → search remote → scan → recents → favourites
> → returns a food + quantity

Build it once and the Foods tab, the recipe builder and the Creami flow all become
thin. Build it three times and this gets ugly fast. **Do this before the screens that
depend on it.**

### When past logs change, and when they don't

Two cases, two mechanisms, and the split is already correct in the code. Preserve it:

| Change | Past logs | Why |
|---|---|---|
| A food's macros were **wrong** and get corrected | **Do update** | `food_logs` stores a *relation* to the food plus a quantity; kcal is computed at render time from the current food record. Corrections propagate automatically. |
| A **recipe** changes (amounts, new ingredients) | **Don't update** | `logRecipe` expands the recipe into individual `food_logs` rows at log time. Those rows reference foods directly with no link back to the recipe, so recipe edits can't reach backwards. |

This is the intended behaviour, confirmed by Sean. Don't "fix" either half.

The one edge it doesn't cover: a product **reformulated** rather than mis-entered would
also rewrite history that was correct at the time. The escape hatch is creating a new
food rather than editing the old one. Not worth building for.

---

## Build order

Each step leans on the ones above it. The first two are load-bearing — doing anything
else first means redoing it.

### 1. Serving units — ✅ **done 2026-08-08** (`1786152675_serving_units.js`)

Shipped as: `foods.unit_label` + `foods.unit_g` (grams in one such unit), and
`food_logs.amount` + `food_logs.unit` (`'g'` | `'unit'`). Macros stayed per 100 g —
that is only the *storage* basis; the unit is how an amount is *expressed*. Covers all
three cases Sean named: `34` + `g` (chicken), `1` + `unit` of a `scoop`/`block`, and
`135` + `unit` of `ml` (milk is `unit_label: 'ml'`, `unit_g: 1.03`).

`gramsFor(log, food)` resolves an amount to grams **at render time** rather than baking
it into the row, so fixing a mis-measured `unit_g` corrects every past log — the same
correction-propagation rule the table below states for macros. `formatAmount` renders
"1 scoop" / "135 ml" / "34 g". The old `grams` column is still written but never read.

Existing logs were backfilled to `unit: 'g'` (all 10 were grams by definition). The
Cronometer records described below still carry their fictional `100 g == 1 unit` grams
— Sean's call was to wipe and re-enter them rather than migrate, which the Foods tab
(§4) makes easy. Historical context follows.

Surfaced while importing a real Cronometer day. Most items were unit-based — "1 Pack",
"3 wrap", "0.5 each", "2 cookie" — with **no gram weight on the label**. `foods` stores
per 100 g and `food_logs` stores grams, so there was nowhere to put them.

The import worked around it with the convention **100 g == 1 natural unit** of that food
(per wrap, per cookie, per pack): the per-unit kcal goes in `kcal`, and the log records
`units * 100` grams. Totals come out exact, but the gram figures are fictional —
"300 g" of mini wraps means three wraps.

Affected records are tagged `source: 'manual'` with a `raw.basis` string spelling out
the basis used, plus `raw.imported_from: 'cronometer'`. They are findable and
migratable.

Why this was first: **protein powder is scoops.** Recipes are unusable while every
ingredient is pinned to a fake 100 g basis, and a "1 scoop" ingredient is exactly the
case that breaks.

### 2. The picker sheet, and fixing the input flow

The current diary input is clunky, for a specific reason: three competing entry points
(Scan / Add manually / search box) sit at the top of the day, none of them knowing which
meal you're adding to. So you pick a food and *then* get asked which meal — backwards.

Replace with a **`+` on each meal header**. Tapping it means "add to lunch", so the meal
is decided by where you tapped and the meal pills disappear entirely. That `+` opens one
sheet:

- search field, focused, keyboard up
- recents/favourites listed underneath before you type anything
- scan icon in the corner
- "create custom food" at the bottom as the fallback

One surface, one mental model. The fastest path — re-logging something eaten constantly
— becomes zero typing. It also collapses today's two-step (pick food → modal for
grams/meal) into a single sheet with a quantity field.

This sheet **is** the shared picker from the architecture notes. Build it as such.

### 3. Remote food search — ✅ **done 2026-08-08, but not as written below**

Solved by **mirroring OFF locally** rather than by calling any search API, which makes
most of the analysis below moot. Keep reading it only for the AFCD recommendation, which
still stands for whole foods.

`food_catalog` holds the 75,366 AU/NZ products from the nightly parquet dump. Search is a
local SQLite query: **10 ms**, ~20–50 ms through the API, fast enough to filter as you
type, and it works with OFF down or the network gone. The whole DB went from 9.2 MB to
19 MB — the mirror is ~10 MB, an order of magnitude under the earlier estimate.

This also removed the rate-limit problem entirely rather than working around it: nothing
queries OFF's `/search`, and `resolveBarcode` only reaches the network for products newer
than the last sync or sold outside AU/NZ.

Scope is AU + NZ (Sean's call): 62,896 AU, 10,591 NZ, 2,040 both. UK/US were rejected as
noise — they'd have added 1.1M rows of products you can't buy.

The remaining gap — whole foods, which OFF covers badly — is **§9 (AFCD)**, deliberately
parked at low priority.

### 3b. Remote food search — the original analysis

Needed before the recipe builder is worth using: a builder is only as good as its
ingredient pool, and right now you can only pick things already scanned. Whole foods
(chicken breast, rolled oats, a banana) have no barcode and can never enter the cache
by scanning.

**Read this before picking a source — it invalidates the obvious approach:**

> Open Food Facts' `/search` endpoint is aggressively rate-limited and, when throttled,
> returns an **HTML "Page temporarily unavailable" body with HTTP 200**. It did this
> repeatedly during development at trivial request volumes. The barcode endpoint
> (`/api/v2/product/<code>.json`) is a different story — reliable and fast. **Do not
> build interactive search on OFF `/search`.** If you use it at all, treat a non-JSON
> body as a throttle signal, not a parse bug. `off.js` already guards this way.

That warning still holds and is why the mirror exists. The alternative sources this
section used to recommend (AFCD, FatSecret, USDA) have moved to **§9**.

### 4. Foods tab — the manager — ✅ **done 2026-08-08**

Built **before** §2, on Sean's call, and the ordering argument in this file was wrong:
the picker-first case is "don't build a food chooser three times", but the manager isn't
a chooser, so there was no overlap to protect. What the two actually share is the *food
definition form*, which §4 has now produced (`FoodForm.jsx` — fields plus
`formFromFood` / `foodFromForm`). §2's "create custom food" reuses it rather than
reinventing it, and `FoodEntryModal` already does.

The forcing reason: §1 shipped units with no way to set `unit_label`/`unit_g` on a food
that already existed — only on manual creation. §5/§6 were blocked on that regardless of
the picker.

Shipped: `FoodsView` (search by name/brand/barcode, favourites-first sort, infinite
scroll, paginated so it doesn't degrade as the cache grows), `FoodEditModal`
(create/edit/delete, all macros including fibre/sugar/sodium), `favourite` flag
(`1786153138_food_favourites.js`), nav moved to **Diary / Foods / Weight**.

Deleting a food **counts referencing logs first and names the number in the confirm** —
`foods` is not cascade-delete, so deleting one that history points at leaves those logs
as "Unknown food" with no macros and silently changes past totals.

The Cronometer records with fictional grams were deleted (8 of 10) along with their
logs. The two tagged `basis: true per-100 g` — chicken breast, cheese block — were real
weights and were kept.

Still open here: favourites are stored and sorted but nothing consumes them yet; that's
§2's default list.

### 5. Recipes

**Schema and API already exist and work; there is no UI.** See `recipes` in the
migration, and `createRecipe` / `getRecipes` / `logRecipe` / `deleteRecipe` in
`food/api.js`. `logRecipe` is written and unused.

Items are `{ food, amount, unit }` since §1 — so a recipe can hold "1 scoop" of protein
powder next to "34 g" of oats, and dividing by `servings` works either way. `logRecipe`
still reads a legacy `grams` key as a fallback.

To build: a recipe list, a builder (picker → item list → servings), and a "log one
serving" action reachable from the diary.

**Log flow must be edit-before-log**: tapping a recipe opens its item list pre-filled,
you swap or add rows, then confirm. This was chosen over two rejected alternatives:

- *Duplicate-and-edit per variant* — the library rots into "Creami Choc Whey", "Creami
  Vanilla Casein"… a dozen near-identical recipes.
- *Typed slots in the schema* ("protein powder: pick 1", "mixins: pick 0..n") — more
  correct-feeling, but a lot of machinery for one use case.

Edit-before-log needs no new schema concepts, and handles the Creami case *and* every
ordinary "I made this but with less cheese" case. It also fits what's already built:
recipes already expand into diary rows at log time, so this just means touching the
list before expansion.

Cheap addition worth having: mark items `swappable` so the edit screen floats them to
the top with a swap affordance. Most of the slots ergonomics, none of the slots model.

### 6. Ninja Creami support

Sean's actual pattern: **two bases**, varying the protein powder and/or mixins.

Confirmed: **the bases differ in macros, and different flavours vary the macros too.**
So a powder swap is a real ingredient substitution with real numbers, not a label. Each
powder must exist as its own food with its own macros — which is why §1 (scoops) blocks
this.

Given edit-before-log from §5, this needs little beyond `swappable` items and possibly
"save this variation" once the common combinations are known. If it turns out the same
four Creamis recur, that naturally becomes a favourites list.

Deferred by Sean — captured now, build later.

### 7. Daily targets

Nothing exists. Needs a new collection (or user-scoped settings record) — kcal plus
optional protein/fat/carb targets, ideally date-effective so changing a target doesn't
retroactively rescore old days.

UI: a ring or bar against the day total in the diary header, which currently shows a
bare number — that's where remaining/over belongs.

Consider deriving a suggested target from the weight trend. The weight data is in the
same database, which is the whole reason food lives in this app.

### 8. Copy meals/foods to another day

Cheapest useful version: "copy this meal to today", creating fresh `food_logs` rows
with a new `date`. Everything needed is already in the schema.

Follow-ons: duplicate a single entry, copy a whole day.

### 9. AFCD whole foods — **low priority**

The one real gap the OFF mirror leaves. OFF is a *barcode* database, so it is thin on
things sold without a pack: chicken breast, rolled oats, a banana, plain rice. Those are
exactly the ingredients a recipe (§5) is built from, so if the builder feels short of
ingredients, this is why.

**AFCD** (Australian Food Composition Database, FSANZ) is the authoritative AU source:
~1,600 items, free XLSX download, government data, static — no API and no rate limits.
A one-off import, not a sync: it changes on the order of years, so there is no timer to
build and no delta mechanism to maintain.

Import into `food_catalog` with `source: 'afcd'` — the same collection the OFF mirror
uses, since it is the same kind of thing (a browsable reference you copy into `foods` on
first log) and that keeps one search path rather than two. Note `food_catalog` has no
`source` column yet; add one in the same migration so AFCD and OFF rows stay tellable
apart in the UI and on re-import. `barcode` is empty for these, and the unique index on
it will reject the second such row — that index needs relaxing (partial index on
non-empty barcodes) or AFCD rows need a synthetic key. **Check this before starting; it
is the one thing that will bite.**

Deliberately low priority: whole foods are a small share of what actually gets logged
here, manual entry already covers them in one tap, and the macros for chicken breast are
stable enough that entering it once is a permanent fix. Revisit when §5 makes the gap
concrete.

Two commercial options were considered and rejected for now:

- **FatSecret Platform API** — best AU *branded* coverage (Woolworths/Coles house
  brands), free tier, OAuth + attribution. A server-side key breaks the no-worker
  architecture; you'd need a worker sidecar, with `fridge` as the pattern to copy. The
  OFF mirror was expected to make this unnecessary — measure before committing.
- **USDA FoodData Central** — free and huge, but US portions and fortification differ
  enough to mislead for AU products. Last resort.

### Already mostly done — check before building

**Meal categories.** Working: `meal` field on `food_logs`; `MEALS` and selectable pills
in `FoodEntryModal`; `defaultMeal()` guesses from the clock; `FoodView` groups under
`MEAL_ORDER`. Note §2 removes the pills in favour of per-meal `+`.

Genuinely missing: per-meal subtotals; moving an entry to another meal after logging;
the meal set is hard-coded in two files (`MEALS` in `FoodEntryModal.jsx`, `MEAL_ORDER`
in `FoodView.jsx`) and should be unified if it ever becomes configurable; logs with an
empty `meal` are bucketed into `snack` by the view rather than explicitly.

---

## Gotchas that cost time

Infrastructure and PocketBase gotchas are in `CLAUDE.md` and `~/docs/track.md`. These
are the food-specific ones:

- **Dates are local, never UTC.** `toISOString().slice(0, 10)` is the tempting one-liner
  and it is wrong anywhere east of Greenwich. In AEST it reported yesterday for the
  first 10-11 hours of every day, disabled the next-day arrow, and broke day-stepping
  (forward was a silent no-op, back skipped two days). Use `src/dates.js`. An entry
  belongs to the day you were living, not the UTC day.
- **`json` fields need an explicit `maxSize`.** Creating one with `options: {}` stores
  `maxSize: 0`, and 0 means *reject everything*, not *no limit*. Writes fail with
  `validation_json_size_limit: The maximum allowed JSON size is 0 bytes`. This shipped
  broken and silently disabled OFF caching (`foods.raw`) and all recipe saves
  (`recipes.items`) until `1786113033_json_field_max_size.js` fixed it. It went
  unnoticed because the end-to-end test had `raw` stripped from its payload — **test
  json fields with actual content.**
- **Macros are stored per 100 g.** Every source normalises to that basis on ingestion,
  so a serving is one multiply (`macrosFor`). This is unchanged by §1 — units are how an
  amount is *expressed*, not how nutrition is *stored*. Resolve amount → grams with
  `gramsFor` first, then multiply. Never read `food_logs.grams` directly.
- **Missing macros are `null`, not `0`.** "Unknown" and "genuinely zero" must not be
  conflated, or totals quietly under-report. `FoodEntryModal` preserves this: a blank
  field stays blank.
- **OFF reports sodium in g/100 g** — stored as mg.
- **Some AU/EU products carry kJ but not kcal.** `off.js` derives kcal at 4.184 kJ/kcal.
  Australian labels lead with kJ, so this path is common, not an edge case.
- **OFF products can lack a name.** `off.js` returns `null` for those rather than
  caching a nameless record you can't identify later.
- **OFF's data quality is not guaranteed, and the mirror inherits that.** Real examples
  found on import: a V energy drink stating 147 kcal/100 ml while its own kJ figure works
  out to 59, and a Tim Tam Double Coat at 233 kcal when the plain one is 524. The
  importer only rejects the physically impossible (kcal > 900/100 g, 161 rows); plausible
  but wrong values get through by design, because there is no way to tell them from real
  ones. The Foods manager is the fix — correcting a food there also corrects every day it
  was logged on.
- **Coverage is not 100%** and never will be. Manual entry isn't a fallback bolted on
  the side, it's a core path — every miss must stay one tap from being logged.
- **The ZXing chunk is excluded from the SW precache** (`globIgnores` in
  `vite.config.js`, `manualChunks` names it). It's ~170 kB gzip that Chrome on Android
  never fetches. If you touch the build config, don't let it back into the precache —
  it regresses app-shell load time, which was a previously-fixed problem.
- **`docker compose` must be run from `/home/sean`.** Running it from the frontend
  directory fails with `no such service: track`, and the build silently doesn't deploy.

## Ideas not asked for

- **Contribute misses back to OFF.** Manual entries with a barcode are exactly what OFF
  lacks for AU products. Improves the shared DB and your own future hit rate.
- **Photo of the nutrition panel → Claude → fields.** The `fridge` app already shells
  out to the Claude CLI from a worker; that pattern would drop straight in and would
  make manual entry near-free. Likely the highest-leverage idea here.

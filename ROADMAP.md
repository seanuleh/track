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

### 2. The picker sheet, and fixing the input flow — ✅ **done 2026-08-08**

Shipped as `FoodPickerSheet.jsx`. First cut opened it from a `+` on each meal header with
the meal preset; **Sean's call, changed same day**: a single FAB (`FAB.jsx`) opens the
sheet instead, meal is chosen inside `FoodEntryModal` same as before (defaulting from the
clock), and misassigned entries are fixed by **dragging a logged entry onto another meal
section** — native HTML5 drag/drop, `updateLogMeal` in `food/api.js`. `FoodEntryModal`
still supports a locked preset meal (`meal` prop) for anything that wants to skip the
pill step; the diary itself no longer uses it. Meal sections still always render, even
empty, so they're valid drop targets before anything's logged into them. The sheet shows
recents (`getRecentFoods`, read from `food_logs` — the log itself is the freshness
signal) and favourites before typing, your own foods then the catalog after typing, a
scan button, and "create custom food". The old top-of-day Scan/Add-manually/search trio
is gone either way.

Not done as part of this: the quantity field isn't inline in the sheet itself — picking
a result still opens `FoodEntryModal` as a second step for amount/unit. Full single-sheet
fusion would mean duplicating `FoodEntryModal`'s amount/unit/portion logic inline; the
two-tap version was judged good enough for now given meal-picking is already collapsed
away, the bulk of the old friction.

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

### 4b. Foods manager — made comprehensive — ✅ **done 2026-08-08**

Sean's call, reordering the plan: rather than building §2's picker sheet next, make the
Foods manager the one place that owns *everything* about a food or recipe — add, scan,
favourite, build recipes — so the diary can later shrink to just finding and logging.

Shipped:

- **FAB speed-dial** (`FAB.jsx` — plain button when given `onClick`, a stack of labelled
  mini-buttons when given `actions`): Scan barcode / Search catalog / Add manually.
- **Scan from the manager**: reuses `Scanner.jsx` and `resolveBarcode`. Unlike the diary's
  scan (which logs), a manager scan always opens `FoodEditModal` — hit or miss — so it's
  a review-and-fix step, never a silent write. `FoodEditModal` gained a `barcode` prop for
  the miss case, carried through to `createFood` so the next scan of that barcode hits
  the cache.
- **Catalog search from the manager** (`CatalogSearchModal.jsx`): searches the 75k
  `food_catalog` mirror, promotes via `ensureFoodFromCatalog` on tap, then opens the edit
  form on the promoted record — same "find it, then correct/enrich it" shape as scanning.
- **Foods | Recipes sub-tabs** inside `FoodsView` (a segmented control, not a new
  top-level nav item — Sean's call).
- **Recipes UI** (`RecipesView.jsx`, `RecipeBuilderModal.jsx`) — the backend existed since
  §1 with no screens; see §5, now done as part of this rework.
- **`FoodPicker.jsx`** — the shared "find a food" search (own foods + catalog) used by the
  recipe builder. Not the full picker sheet from §2 (no scan, no recents/favourites), but
  the search half of it, reused rather than rebuilt.
- **Macro/kJ display** on every food/catalog/recipe row (`MacroLine.jsx`, `KcalCol.jsx`):
  Pro/Car/Fat + kJ + Kcal, each with its value stacked under its label, aligned into fixed-
  width columns so they line up down the list. On narrow viewports (≤480px — the Fold
  cover display) the name/brand truncate with an ellipsis and kJ drops, rather than either
  wrapping the name or pushing the stats onto their own row — one dense line per card.
  **This is the piece §10 changes**: right now the number is always per-100g; see below.

### 5. Recipes — list + builder + edit-before-log ✅ **done 2026-08-08**

Schema and API existed since §1 with no UI (`recipes` in the migration; `createRecipe` /
`getRecipes` / `updateRecipe` / `deleteRecipe` / `logRecipe` in `food/api.js`). Shipped as
part of §4b: `RecipesView.jsx` (list, delete-with-confirm, per-serving macro/kJ/kcal
display) and `RecipeBuilderModal.jsx` (name, servings, ingredient rows via `FoodPicker`,
a live per-ingredient kcal preview computed from `gramsFor`/`macrosFor` as you edit the
amount). `updateRecipe` was added for this — it didn't exist before.

Items are `{ food, amount, unit }` since §1 — so a recipe can hold "1 scoop" of protein
powder next to "34 g" of oats, and dividing by `servings` works either way. `logRecipe`
still reads a legacy `grams` key as a fallback, and is still written but unused.

**"Log one serving" reachable from the diary — ✅ done 2026-08-08**, but as a direct
one-tap log, not edit-before-log. `FoodPickerSheet.jsx` lists recipes (fetched once,
per-serving kcal precomputed via a local `recipeKcal` helper — a duplicate of
`RecipesView`'s `totalsFor`, not imported, since that helper is private to the view)
alongside foods, both before typing and filtered client-side against the search query.
**Edit-before-log — ✅ done 2026-08-08** (`RecipeLogModal.jsx`). Tapping a recipe in the
picker sheet opens its item list pre-filled at one serving (recipe amounts / servings),
same shape as `RecipeBuilderModal`'s rows: live per-ingredient kcal, amount/unit
editable inline, remove a row, add one via `FoodPicker` (the swap case is remove-then-add,
not a dedicated swap button — the roadmap's `swappable` idea below is still not built).
Confirming calls the new `logRecipeItems` (the shared expansion logic `logRecipe` now
delegates to) with the edited list, not the saved recipe, so edits here never touch the
recipe definition — same "expand by value" rule the rest of this section relies on.

This was chosen over two rejected alternatives:

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

### 7. Daily targets — ✅ **done 2026-08-08**

Shipped as `daily_targets` (`1786183000_daily_targets.js`) — kcal required,
protein/fat/carbs optional. Date-effective as planned: `setTarget` always writes a new
row rather than updating in place, and `getTargetForDate` resolves the newest row with
`effective_date <= date`, so raising a target next month can't rescore days already
logged against the old one.

UI: a bar + remaining/over badge in the diary header (`.target-row`, green under
target, red over), and a "Set/Edit target" button opening `TargetsModal.jsx`. Only kcal
drives the bar for now — the protein/fat/carb fields are captured but nothing displays
progress against them yet.

Not done: deriving a suggested target from the weight trend.

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

### 10. Preferred serving size — replace the /100g default in list views — ✅ **done 2026-08-08**

Shipped as `foods.portion_amount` + `foods.portion_unit` (see `CLAUDE.md`'s "Unit vs pack
serving vs portion" section for the three-way distinction). `portionOf(food)` resolves
with fallback: stored portion → 1 unit → `serving_g` → 100 g. List rows show macros
against the resolved portion with a `/portion` suffix; unset portions render dimmed
(`.portion-unset`) rather than silently defaulting.

Raised by Sean straight after §4b shipped the macro/kJ display: those numbers are
currently always **per 100 g**, which isn't how anyone thinks about a food they actually
eat — "a scoop of protein" or "a slice of bread", not "100 g of it".

Not the same field as the existing `serving_g` (the pack's *stated* serving, when the
label declares one) — this is a **preferred** serving, Sean's own choice of how much he
usually eats, independent of what the packaging says. Needs its own field(s) on `foods`
(schema change — back up first per `CLAUDE.md`, and remember `unit_g`/`unit_label`
already cover "natural unit" for scoops/blocks/ml; a preferred serving is a different
concept from a natural unit and from the pack serving, so don't collapse the three).

Once set, `FoodsView`, `CatalogSearchModal` and `RecipesView` rows (`MacroLine.jsx` /
`KcalCol.jsx`, done in §4b) should show energy/macros scaled to the preferred serving
instead of per 100 g, with the suffix changing to reflect that (not hardcoded `/100g`).
Fall back to per-100g display when no preferred serving is set — most catalog rows won't
have one until Sean sets it, so the fallback path is the common case, not an edge case.

Sean is planning this one with Opus — check for an updated schema/plan before duplicating
work here.

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

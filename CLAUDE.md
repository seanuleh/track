# Weight Tracker — Agent Reference

Self-hosted Docker weight + calorie tracking app. React SPA + PocketBase backend.
Units: **kg**, macros per **100 g**.

> **Extending the food/calorie side? Read [`ROADMAP.md`](ROADMAP.md) first.** It covers
> what's built vs planned (recipes and meal categories are partly done already — check
> before rebuilding), which food databases to use and which one will waste your time,
> and the design decisions that must not be "simplified".

## ⚠️ Always Back Up Before Schema Changes

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
tar -czf /data/track/backups/${TIMESTAMP}.tar.gz -C /data/track --exclude=backups --exclude=storage .
```

PocketBase silently wipes field data when schema is patched without original field IDs.

## Schema Changes — JS Migrations

All schema lives in `pocketbase/pb_migrations/` as `[unix_ts]_description.js`. PocketBase
applies unapplied migrations on startup; applied ones are tracked in `_migrations` and
never re-run.

**Never create or PATCH collections in `entrypoint.sh`** — it runs on every container
restart and would scramble field IDs and orphan data. It does admin bootstrap and
trusted-proxy config only. (This app used the entrypoint mechanism until 2026-08-08;
`1786111415_baseline_existing_schema.js` is the idempotent baseline recording the
pre-migration schema.)

To change schema: back up (above), `date +%s` for a timestamp, write the migration,
then `docker compose up -d --build track`.

To reverse a migration, write a new forward migration — never delete the old file.
`pocketbase migrate down` needs an interactive TTY and panics when piped.

> `users` is PocketBase's built-in auth collection (id `_pb_users_auth_`), already named
> `users`, which is what cf-auth looks up. Never create a second `users` collection —
> it fails on the name collision.

## Looking at the UI — `probe/`

Before changing anything visual, and after: `./probe/run.sh`. It restores the
newest backup into a throwaway PocketBase container, seeds a probe user with a
realistic day's data, starts vite, and drives the real app in Chromium at the
**measured** Galaxy Z Fold 8 widths (cover 475px, unfolded 674px) plus desktop —
screenshotting every surface and asserting the things that only break in a
browser. Production is never touched.

**Read [`probe/README.md`](probe/README.md) first.** It records the traps that
each cost a debugging cycle: Playwright not Selenium (no chrome/chromedriver on
this host, and installing one needs root); auth seeded into `localStorage`
rather than through a login screen that doesn't exist; and why a forced click on
the tab bar hits the card underneath it.

Several bugs found this way were invisible in the source — a `@media` block
placed above the rules it overrode so half of it never applied, a sticky modal
header 18px narrower than its sheet, a pixel-positioned indicator that never
re-measured on unfold. Add a check when you fix something; don't delete one.

## Current Deployment

Live at `track.uleh.tv` on the uleh home server.

- Single `survivor` container — builds from `/home/sean/git/seanuleh/track`
- PocketBase data at `/data/track` (host volume → `/pb/pb_data`)
- nginx config: `/data/nginx/conf.d/track.uleh.tv.conf`
- Auth via cf-auth sidecar + nginx sub_filter (see architecture below)

To rebuild and redeploy:
```sh
cd /home/sean && docker compose up -d --build track
```

## Architecture

```
Cloudflare Access (JWT at edge)
     │
     ▼
[nginx] :443  track.uleh.tv.conf
     │  sub_filter injects localStorage check into HTML
     │  → if no token: redirect to /cf-autologin?app=track
     │  /cf-autologin proxied to cf-auth sidecar
     ▼
[track] container :8090
     ├── /          → React SPA (pb_public/)
     ├── /api/      → PocketBase REST API
     └── /_/        → PocketBase admin UI
          └── /pb/pb_data → /data/track (host volume)
```

## Auth Flow

No login screen. Auth is handled entirely at the infrastructure layer:

1. nginx sub_filter injects a script that checks `localStorage.pocketbase_auth`
2. If missing → redirect to `/cf-autologin?app=track&next=<path>`
3. cf-auth sidecar reads `CF_Authorization` cookie, finds/creates PB user via admin API, sets localStorage, redirects back
4. PocketBase SDK auto-loads token from localStorage on `new PocketBase('/')`

The app has zero auth code — `api.js` just calls `new PocketBase('/')` and the API.

## File Structure

```
track/
├── Dockerfile               # Multi-stage: Vite build → PocketBase + pb_public
├── README.md
├── CLAUDE.md
├── probe/                   # Browser harness: throwaway backend + Playwright (README.md)
├── pocketbase/
│   ├── entrypoint.sh        # Idempotent init: admin + users collection + weight_entries
│   └── pb_hooks/
│       └── vision.pb.js     # POST /api/vision/nutrition — proxies a label photo to Ollama
└── frontend/
    ├── package.json         # react 18, recharts, pocketbase sdk, vite
    ├── vite.config.js       # Dev proxy: /api → localhost:8090
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx           # State, window filtering, delta calc, layout
        ├── App.css           # CSS custom props, mobile-first
        ├── api.js            # PocketBase('/') + CRUD — no auth code
        └── components/
            ├── WeightChart.jsx    # Recharts AreaChart, time-proportional X axis
            ├── EntryList.jsx      # Reverse-chrono cards, infinite scroll
            ├── AddEditModal.jsx   # Bottom-sheet modal
            ├── FoodView.jsx       # Diary tab — the day's log, per-meal groups
            ├── FoodsView.jsx      # Foods tab — the library/manager
            ├── FoodForm.jsx       # Shared food definition fields + form↔record mapping
            ├── FoodEditModal.jsx  # Create/edit/delete a food definition
            ├── FoodEntryModal.jsx # Log/edit an amount; manual entry falls back to FoodForm
            ├── RecipeGroupModal.jsx # Edit/delete a logged recipe as one unit (meal, servings eaten)
            ├── RecipeLogModal.jsx # Edit-before-log: adjust a recipe's items before it's logged
            ├── TargetsModal.jsx   # Set a new daily kcal/macro target, effective from today
            ├── ConfirmModal.jsx   # In-app replacement for window.confirm; stacks over its parent
            └── FAB.jsx            # Fixed + button
```

`probe/` (repo root) holds the browser harness — see "Looking at the UI" above.

Auth is handled by the cf-auth sidecar outside the container — no auth code in the app itself.

One JSVM hook exists: `pb_hooks/vision.pb.js`, `POST /api/vision/nutrition`, record-auth only.
It exists solely because the browser can reach `track` but not `ollama` — both sit on the
internal `pirate` docker network, only the container can call the model directly. It proxies
a base64 JPEG to `qwen2.5vl:7b` on the shared Ollama instance (`OLLAMA_URL` env, defaults to
`http://ollama:11434`) and returns extracted per-100g macros. Local model deliberately, not
Anthropic — no API key, no separate billing, and Claude usage/quota changes can't break it.
Evaluated against 3 real AU nutrition panels (milk, cheese, chocolate) with 8/8 fields exact
on every one — no accuracy gap found against Claude Haiku on the same images. A denser real
label (rice crackers, with Gluten/Monounsaturated/Polyunsaturated/Trans Fats sub-rows) then
row-shifted the read in production — kJ copied straight into kcal, sub-row values landing in
the wrong fields — so the prompt now forces an explicit transcribe-named-rows-only step before
emitting JSON, and warns by name about the sub-rows to skip. Retested against a reconstruction
of the failing label with all 8 fields exact; **still prefill-only, glance at the numbers
before saving** — this fix is not a proof against every future dense layout.

**JSVM gotcha**: use `$apis.requestInfo(c).data` to read the parsed JSON body, not
`c.bindBody(new DynamicModel(...))` — the latter fails with a generic
`{"code":400,"message":"Something went wrong..."}` on PocketBase 0.22.22 for reasons that
never surfaced in the container logs. Confirmed via a minimal debug route before diagnosing.

## PocketBase Collections

**`users`** (auth collection) — created on first boot

**`foods`** (base collection) — shared cache of food definitions. Not user-scoped: it
caches public nutrition data, so any signed-in user may read and add. All macros are
stored **per 100 g** so every source normalises to one basis and a serving is one
multiply. Filled on demand from Open Food Facts barcode lookups, plus manual entries.

| Field | Type | Notes |
|---|---|---|
| barcode | text | indexed; empty for whole foods / manual |
| name | text | required |
| brand | text | |
| source | text | `off` \| `afcd` \| `manual` |
| serving_g | number | pack's stated serving, when declared |
| unit_label | text | name of one natural unit — `scoop`, `block`, `ml`, `wrap` |
| unit_g | number | grams in one such unit (milk: `1.03` per ml). Empty = no gram equivalent |
| favourite | bool | pinned to the top of the Foods manager; will seed the picker's default list |
| portion_amount | number | **your** usual portion; empty = never set, fall back |
| portion_unit | text | `g` \| `unit` — the basis `portion_amount` is counted in |
| kcal, protein, fat, carbs, fiber, sugar | number | per 100 g |
| sodium | number | mg per 100 g |
| raw | json | untouched upstream payload, for later backfill |

**`food_catalog`** (base collection) — the local reference mirror: ~75k Open Food Facts
products sold in AU/NZ, plus the ~1.6k AFCD whole foods. Read-only to clients
(`createRule`/`updateRule`/`deleteRule` are all null); written only by
`scripts/off-import.py` and `scripts/afcd-import.py` straight to SQLite, because 75k
inserts over the REST API would take hours.

`source` (`off` | `afcd`) + `source_id` carry provenance. Two **partial** unique indexes,
which is the part that bites: `barcode` is unique only `WHERE barcode != ''` (AFCD rows
have no barcode, and SQLite treats `'' = ''`, so a plain unique index rejects the second
one), and `(source, source_id)` is unique `WHERE source_id != ''` so re-importing AFCD
upserts instead of duplicating.

Deliberately **not** merged into `foods`. `foods` means "things I actually eat" and backs
the manager, favourites and the barcode cache; 75k imported rows would make it a
haystack. The two join by behaviour: search hits the catalog, and `ensureFoodFromCatalog`
**copies** a row into `foods` the first time it's logged — by value, so a later catalog
refresh can't rewrite macros behind days already logged.

Same reason `resolveBarcode` is now three tiers: `foods` → `food_catalog` → OFF network.
Most scans never touch the network.

**Barcode is not a usable identity for everything in here.** AFCD whole foods and bakery
items are sold without a pack, so `barcode` is `''` and `'' = ''` matches every other
unbarcoded food. Both places that ask "do I already have this?" fall back to exact
name+brand when there's no barcode — `ensureFoodFromCatalog` (which otherwise created a
fresh `foods` row on *every* log of the same AFCD food) and `FoodPickerSheet`'s dedupe of
catalog hits against your library (which otherwise showed them in both sections). Exact
match, not `~`: "Banana, cavendish, peeled, raw" and "Banana, frozen" are different foods.

`searchCatalog` fires **two** queries and merges them — a general one and one restricted
to `source = 'afcd'`. PocketBase sorts and truncates server-side, and OFF outnumbers AFCD
47:1, so a single query for "chicken breast" filled all 20 slots with branded schnitzels
before ever reaching "Chicken, breast, lean flesh, raw" — the exact query AFCD exists to
answer. Whole foods get their own slots rather than competing for the same page.

### Unit vs pack serving vs portion

Three separate ideas that are easy to conflate:

- **Unit** (`unit_label` + `unit_g`) is a *conversion*, not a quantity: "1 scoop = 30 g".
- **`serving_g`** is what the pack claims. Reference only — pack servings are routinely
  absurd in both directions, so they must never be the logging default.
- **`portion_amount` + `portion_unit`** is *your* usual amount. This is what the Foods
  manager reports macros for and what the diary prefills.

Portion is stored as an `{amount, unit}` pair — the same shape as a log — deliberately,
**not** as a single gram figure. "1.5 scoops" has to stay expressed in scoops so that
fixing `unit_g` later corrects the portion too, the same rule `gramsFor` enforces for
logs. Stored as 45 g it would silently go stale.

`portionOf(food)` resolves the default and **falls back** rather than requiring curation:
stored portion → 1 unit (if `unit_g` set) → `serving_g` → 100 g. `serving_g` ranks last
of the real options because it's the manufacturer's number. Nothing is backfilled into
`portion_amount`; empty means "never set", which the Foods list dims (`.portion-unset`).

**`food_logs`** (base collection) — one row per thing eaten: `date` (YYYY-MM-DD),
`food` (relation → foods), `amount`, `unit`, `meal`, `user`. Indexed on `(user, date)`.

`unit` is `g` (amount is grams — "34 g of chicken") or `unit` (amount counts the
food's `unit_label` — "1 scoop", "135 ml"). **Grams are resolved at render time**
by `gramsFor(log, food)`, not read from a stored value, so correcting a food's
`unit_g` fixes every log that used it — same rule as correcting its macros. The
legacy `grams` column is still written for compatibility but nothing computes
from it.

`recipe_group` (text) + `recipe_name` (text), both optional — set on every row a
recipe expands into (`logRecipeItems` in `food/api.js`), sharing one
`crypto.randomUUID()` per logging call. `recipe_name` is copied at log time rather
than a relation, same "expand by value" rule as everything else here: editing or
deleting the recipe later must not change what a past day says was eaten. The diary
(`FoodView.jsx`) groups rows sharing a `recipe_group` back into one card so a logged
recipe shows as itself, not as its expanded ingredients; tapping it opens
`RecipeGroupModal` (reassign meal, scale servings eaten, delete the whole serving) —
individual ingredient amounts are edited through the recipe itself, not here.

**`recipes`** (base collection) — `name`, `items` (json `[{food, amount, unit}]`),
`servings`, `user`. A recipe is a **template**: logging it expands into individual
`food_logs` rows, so later edits to a recipe never rewrite already-logged history.

Logging from the diary is **edit-before-log** (`RecipeLogModal.jsx`): tapping a recipe
opens its item list pre-filled at one serving, where amounts/units can be adjusted and
ingredients swapped (remove + re-add via `FoodPicker`) before anything is written —
this is the Ninja Creami case ("usually chocolate whey, tonight vanilla casein")
without duplicating the recipe or editing its saved definition. `logRecipe` (log-as-is,
still used nowhere directly but kept as the base case) and `RecipeLogModal`'s edited
path both funnel through the shared `logRecipeItems`.

**`daily_targets`** (base collection) — `effective_date` (YYYY-MM-DD), `kcal`
(required), `protein`/`fat`/`carbs` (optional), `user`. Date-effective: `setTarget`
always creates a new row rather than updating one in place, and `getTargetForDate`
resolves the newest row with `effective_date <= date`, so raising a target next month
can't rescore days already logged against the old one. Dates before the very first
target ever set fall back to that first target anyway (a display choice, not a
rescoring) so the targets panel is the diary's default look everywhere once a target
has ever been set, not only from the day it happened to be created.

**`weight_entries`** (base collection)

| Field      | Type     | Required | Notes      |
|------------|----------|----------|------------|
| date       | text     | yes      | YYYY-MM-DD |
| weight     | number   | yes      | kg, min: 0 |
| notes      | text     | no       |            |
| medication | text     | no       |            |
| dose_mg    | number   | no       |            |
| user       | relation | yes      | → users    |

Rules: user can only see/edit their own entries (`@request.auth.id = user`).

## UI

Three tabs — **Diary, Foods, Weight**, opening on Diary. Diary is date-scoped and
disposable; Foods is the date-less library where definitions are curated. The diary's tab
key is still `food` in localStorage so the stored preference survived the rename.

The Foods tab's "no logging affordance" rule (curation only, diary owns logging) was
**reversed 2026-08-08, Sean's call**: tapping a food card now slides its macro line away
and reveals Edit/Add/✕ in its place. Add opens `FoodEntryModal` with no `date` prop, which
is how the modal knows to render its own editable date field (defaulting to today) instead
of trusting a fixed day from the caller — the diary's picker sheet still passes `date`
fixed, so it never sees that field. Edit still opens the existing `FoodEditModal`.

Diary log cards (`FoodView.jsx`) render macros with the same `MacroLine`/`KcalCol`
components as the Foods manager, scaled to the logged amount (`gramsFor(log, food)`)
rather than per-100g or the default portion — visually identical to a Foods row, but
reporting what was actually eaten. Tapping a card opens `FoodEntryModal` in edit mode
(amount/unit/meal/date, plus Delete) instead of deleting on tap — grouped recipe cards
open `RecipeGroupModal` instead (see the `food_logs` collection notes above).

The diary's date label opens a native date picker (`<input type="date">`, visually
invisible, overlaid on the label). It must stay a real, directly-tappable input —
`pointer-events: none` plus a JS-triggered `showPicker()` is flaky on Android Chrome and
can leave the native sheet stuck open and empty. Let the browser's default click-to-open
behaviour fire instead. Desktop Chrome is the exception: it only opens the picker on the
input's own calendar icon, not anywhere else in the (invisible, full-width) field, so the
input also carries an explicit `onClick={e => e.target.showPicker?.()}` — safe alongside
the default behaviour because it's a direct handler on the real input reacting to a
genuine click, not the detached-trigger pattern the paragraph above warns about. The
label text itself is `formatDisplayDate` from `dates.js` ("Sat, 8th Aug 2026"), not the
raw `YYYY-MM-DD` string — `today()` still renders as "Today".

### Motion and modals

All timing and easing comes from four custom properties on `:root`
(`--ease-out`, `--ease-spring`, `--t-fast|base|slow`). Add transitions using
those rather than inventing a duration, and **always name the properties being
transitioned** — `transition: all` was used throughout and would animate
whatever happened to change, including layout properties.

Every `:hover` is wrapped in `@media (hover: hover)`. A touch tap latches hover
onto the element it landed on until something else is tapped, so an un-gated
hover shows as a row that stays highlighted after you've let go. Use `:active`
for touch feedback instead.

Modals are bottom sheets under 600px and centred dialogs above it. Three rules
they all follow:

- **Open at final size.** A sheet whose content loads after mount paints short
  and then grows, mid-fade. Either pin the height (`.modal--picker`) or reserve
  the space with skeleton rows. `probe/probe5.js` checks this.
- **The sheet animates opacity only, never `translateY`.** The browser
  repositions it as the keyboard opens and a transform fights that.
- **Dismissal uses `overlayDismiss` from `modalKeys.js`**, not a bare `onClick`
  on the overlay: a plain click handler fires on the common ancestor of press
  and release, so selecting text in a field and letting go outside the sheet
  discarded the edit.

`window.confirm`/`alert` are not used — `ConfirmModal.jsx` is the in-app
equivalent. It stacks above whichever modal opened it, and `useEscapeClose`
keeps a mount-ordered stack so Escape dismisses only the topmost.

### Daily targets

`TargetsModal.jsx` sets a new kcal (required) + optional protein/fat/carb target,
effective from today (see the `daily_targets` collection notes above for why it's
always a new row). While a target exists for the day being viewed, the diary header
replaces the plain kcal hero + macro row with a 4-row panel (Energy/Protein/Carbs/Fat,
each showing consumed/goal, a percentage, and a coloured bar) plus a small "N kcal
left/over" badge next to the edit-target pencil icon in the title row. Falls back to
the old plain hero display only if no target has ever been set at all.

### Weight tab
- **Header**: current weight large + delta badge (green/red) vs selected window
- **Time windows**: `1W | 1M | 3M | 6M | 1Y | 2Y | 3Y | All` pill buttons, default 3M, persisted to localStorage
- **Chart**: Recharts AreaChart, proportional time X axis
- **Entry list**: reverse-chrono cards, infinite scroll via IntersectionObserver
- **FAB**: fixed bottom-right `+` opens modal

## Open Food Facts catalog

```
food.parquet (7.75 GB, 4.66M products, nightly on Hugging Face)
   │  DuckDB — scripts/off_extract.sql, AU/NZ + 13 columns
   ▼
catalog.csv (7.6 MB, 75k rows)  ──►  food_catalog   [~4 s end to end]

delta/*.json.gz (~23 MB/day, 14-day window)
   │  scripts/off-import.py delta — parsed in Python
   ▼
food_catalog (upsert, newest-wins)              [nightly, ~6 s]
```

- Seed/rebuild: `python3 scripts/off-import.py full` (downloads the parquet unless
  `--parquet` points at one). Takes ~4 s once the parquet is local.
- Nightly: `off-catalog-sync.timer` (user systemd, 03:30 + jitter) → `delta` mode.
  Applied files tracked in `/data/off/delta-state.json`, so a missed night catches up.
- **The deltas only cover 14 days.** If the timer is broken longer than that, reseed
  from the parquet — the mirror can't catch up on its own.
- DuckDB CLI lives at `/home/sean/bin/duckdb` (not a package).
- **The parquet is not kept** — it was deleted after the first import (7.75 GB for a file
  only a reseed needs). `full` re-downloads it automatically. `/data/off/catalog.csv` is
  the extracted 75k rows and survives, so a reseed that doesn't need fresher data can
  skip the download.

Two shapes, which is why `full` and `delta` are separate code paths and not one:
the parquet has `nutriments` as a `STRUCT(name, "100g", …)[]` list and `product_name` as
a `STRUCT(lang, text)[]`; the deltas have **`nutrition.aggregated_set`** (nutrients dict
plus an explicit `per` basis) and a plain-string `product_name`. There is no top-level
`nutriments` in current deltas at all. Both paths must keep the same rules: kJ→kcal at
4.184, sodium g→mg, drop rows with no energy, and drop kcal > 900/100 g (impossible —
pure fat is 900 — and always an upstream entry error).

`aggregated_set.per` is the subtle one: `100g`/`100ml` are taken at face value,
`serving` is scaled by `serving_quantity`, and anything else is **skipped** rather than
assumed, since guessing the basis silently corrupts the macros.

## AFCD whole foods

```
AFCD Release 3 - Nutrient profiles.xlsx (2.1 MB, FSANZ)
   │  DuckDB `excel` extension → CSV, columns matched by name in Python
   ▼
food_catalog  (1,588 rows, source='afcd')        [~1 s, one-off]
```

`python3 scripts/afcd-import.py` (`--xlsx` to reuse a local workbook; files live in
`/data/afcd`). Covers what OFF covers worst — chicken breast, rolled oats, a banana,
plain rice — because OFF is a *barcode* database and those are sold without a pack.

**Not a sync, and deliberately no timer.** AFCD changes on the order of years, so re-run
it by hand when FSANZ publishes a new release. Upserts on `(source, source_id)` — AFCD's
"Public Food Key" — so re-running is idempotent.

Three decisions in the extract that must not be "simplified":

- **Energy "with dietary fibre"**, not without — that's the figure an Australian nutrition
  panel states, so it matches the OFF/packet rows already in the catalog. kJ→kcal at 4.184.
- **"Available carbohydrate, with sugar alcohols"** for `carbs` — the AU convention is
  carbohydrate *excluding* fibre, unlike the US "total carbohydrate".
- Only the **"All solids & liquids per 100 g"** sheet. The workbook's "Liquids only per
  100 mL" sheet is the same foods restated per volume; importing both duplicates every drink.

Columns are matched by *name* in Python, not by position in SQL — the sheet is 90 columns
wide with embedded newlines in the headers. A renamed header **exits with an error** rather
than importing a column of zeros, which would otherwise look like a clean run.

Sodium is already mg in AFCD (no conversion, unlike OFF). `barcode`, `brand` and
`serving_g` are empty: these are generic foods with no pack.

**FSANZ Branded Food Database** (the GTIN-keyed branded one, with GS1) is *not* importable
— as of Aug 2026 there is still no public download, only a submission portal for
manufacturers, and the published subset is permission-gated per data provider. CalorieKing
AU is commercial licence only (no pricing, no self-serve, no free tier). Both were checked;
neither is a route.

## Dependencies

- `pocketbase` SDK `^0.21.5`
- `recharts` `^2.10`
- PocketBase binary `0.22.22`

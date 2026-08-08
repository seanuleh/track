#!/usr/bin/env python3
"""
Import Open Food Facts into the local `food_catalog` collection.

Two modes:

  full   Rebuild from the nightly parquet dump (~7.75 GB), via DuckDB and
         off_extract.sql. Run once to seed the mirror.

  delta  Replay OFF's daily delta exports (~23 MB gz each, last 14 days).
         This is what the systemd timer runs nightly.

The two parse different shapes, which is why they are not one code path:

  parquet  nutriments is STRUCT(name, "100g", ...)[] — a list to search by name
           product_name is STRUCT(lang, text)[]
  delta    nutriments is a flat dict with `_100g` suffixed keys
           product_name is a plain string

The delta shape matches OFF's API v2, so the field handling below deliberately
mirrors frontend/src/food/off.js — same kJ fallback, same sodium conversion.
Change one, change the other.

Why write SQLite directly rather than through the PocketBase REST API: ~90k
inserts over HTTP would take hours; one transaction takes seconds. PocketBase
reads its tables on every query, so rows are visible immediately, no restart.

Safe to run with the app up — WAL plus a busy timeout keeps readers unblocked.
"""

import argparse
import csv
import gzip
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PARQUET_URL = (
    'https://huggingface.co/datasets/openfoodfacts/product-database'
    '/resolve/main/food.parquet?download=true'
)
DELTA_INDEX = 'https://static.openfoodfacts.org/data/delta/index.txt'
DELTA_BASE = 'https://static.openfoodfacts.org/data/delta/'
USER_AGENT = 'uleh-track/1.0 (seanelsayed@gmail.com)'

SCRIPT_DIR = Path(__file__).resolve().parent
EXTRACT_SQL = SCRIPT_DIR / 'off_extract.sql'

DEFAULT_DB = '/data/track/data.db'
DEFAULT_WORK = '/data/off'
DEFAULT_DUCKDB = '/home/sean/bin/duckdb'

# The countries mirrored locally. AU plus NZ: NZ is only ~15k products and
# catches trans-Tasman brands that sit on Australian shelves.
WANTED = {'en:australia', 'en:new-zealand'}

# Pure fat is 900 kcal/100 g. Anything above is an upstream data-entry error.
MAX_KCAL_100G = 900

# Columns the extract produces, in order. Must match off_extract.sql.
COLUMNS = [
    'barcode', 'name', 'brand', 'serving_g', 'kcal', 'protein', 'fat',
    'carbs', 'fiber', 'sugar', 'sodium', 'countries', 'off_modified',
]

# PocketBase declares number fields NOT NULL DEFAULT 0, so a missing macro is
# stored as 0 rather than null. That conflates "unknown" with "genuinely zero",
# but it is PocketBase's own schema convention and `foods` already behaves this
# way — matching it keeps the two collections consistent.
NUMERIC = {'serving_g', 'kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar',
           'sodium', 'off_modified'}


def log(msg):
    print(f'[{datetime.now(timezone.utc):%H:%M:%S}] {msg}', flush=True)


def fetch(url, dest):
    log(f'downloading {os.path.basename(dest)}')
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)
    log(f'  {os.path.getsize(dest) / 1e6:.1f} MB')


# ── shared destination ───────────────────────────────────────────────────

def upsert(db_path, rows_iter):
    """
    Upsert rows into food_catalog, newest-wins.

    The off_modified guard matters for delta replay: deltas are a 14-day window
    applied in file order, so without it an older edit could overwrite a newer
    one already imported.
    """
    cols = ', '.join(f'`{c}`' for c in COLUMNS)
    placeholders = ', '.join('?' for _ in COLUMNS)
    updates = ', '.join(f'`{c}` = excluded.`{c}`' for c in COLUMNS if c != 'barcode')

    sql = f"""
        INSERT INTO food_catalog ({cols}, updated)
        VALUES ({placeholders}, strftime('%Y-%m-%d %H:%M:%fZ'))
        ON CONFLICT(`barcode`) DO UPDATE SET
          {updates},
          updated = strftime('%Y-%m-%d %H:%M:%fZ')
        WHERE excluded.`off_modified` >= food_catalog.`off_modified`
    """

    conn = sqlite3.connect(db_path, timeout=60)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=60000')
    conn.execute('PRAGMA synchronous=NORMAL')

    total, batch = 0, []
    try:
        with conn:
            for row in rows_iter:
                batch.append(row)
                if len(batch) >= 5000:
                    conn.executemany(sql, batch)
                    total += len(batch)
                    batch = []
                    log(f'  {total:,} rows…')
            if batch:
                conn.executemany(sql, batch)
                total += len(batch)
    finally:
        conn.close()
    return total


# ── full import: parquet via DuckDB ──────────────────────────────────────

def run_extract(duckdb_bin, src, out):
    # off_extract.sql defines the projection as a view; the COPY lives here
    # because DuckDB's COPY ... TO requires a literal path.
    sql = (
        f"SET VARIABLE src = '{src}';\n"
        f".read {EXTRACT_SQL}\n"
        f"COPY (SELECT * FROM catalog_rows) TO '{out}' (FORMAT CSV, HEADER);\n"
    )
    proc = subprocess.run([duckdb_bin, '-batch'], input=sql, text=True,
                          capture_output=True)
    if proc.returncode != 0:
        sys.exit(f'DuckDB extract failed:\n{proc.stderr}')
    if proc.stderr.strip():
        log(f'duckdb: {proc.stderr.strip()}')


def read_csv(path):
    with open(path, newline='', encoding='utf-8') as f:
        for rec in csv.DictReader(f):
            row = []
            for c in COLUMNS:
                v = rec.get(c, '')
                row.append((float(v) if v not in ('', None) else 0)
                           if c in NUMERIC else (v or ''))
            yield row


def cmd_full(args):
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)

    parquet = Path(args.parquet) if args.parquet else work / 'food.parquet'
    if not parquet.exists():
        fetch(PARQUET_URL, parquet)
    log(f'source {parquet} ({parquet.stat().st_size / 1e9:.2f} GB)')

    out = work / 'catalog.csv'
    log('extracting AU/NZ subset…')
    run_extract(args.duckdb, parquet, out)
    log(f'extracted {out} ({out.stat().st_size / 1e6:.1f} MB)')

    log('upserting into food_catalog…')
    log(f'done — {upsert(args.db, read_csv(out)):,} rows')


# ── delta import: JSONL, parsed in Python ────────────────────────────────

def num(v):
    """Coerce to float, treating missing/unusable as None (mirrors off.js)."""
    if v in (None, ''):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float('inf') else None


def nutrients_per_100g(p):
    """
    Pull a {name: value-per-100 g} dict out of a delta product.

    OFF changed shape here: current delta exports carry `nutrition`, whose
    `aggregated_set` holds `nutrients` plus an explicit `per` basis, and no
    top-level `nutriments` at all. Older exports carry the flat `nutriments`
    dict with `_100g` suffixed keys (what off.js still sees from the API).
    Both are handled — the newer one first — so a stale delta file or an OFF
    rollback doesn't silently import zeros.

    The `per` basis is the trap: a product whose aggregated set is stated per
    serving needs scaling by serving_quantity, or a 60 g serving gets filed as
    if it were 100 g and every macro reads ~40% low.
    """
    nutrition = p.get('nutrition') or {}
    agg = nutrition.get('aggregated_set') or {}
    nutrients = agg.get('nutrients') or {}

    if nutrients:
        # `value` is what the packaging states; `value_computed` is OFF's own
        # derivation (kcal from kJ, for instance) and is the only one present
        # for some nutrients.
        def pick(name):
            e = nutrients.get(name) or {}
            v = num(e.get('value'))
            return v if v is not None else num(e.get('value_computed'))

        # '100ml' is taken at face value: for the drinks it applies to, OFF
        # treats ml and g interchangeably and so does `foods`. An unrecognised
        # basis is skipped rather than assumed — importing it as per-100 g
        # would be a silent guess at the numbers.
        per = agg.get('per')
        if per in ('100g', '100ml'):
            scale = 1.0
        elif per == 'serving':
            serving = num(p.get('serving_quantity'))
            if not serving:
                return {}  # Per-serving with no serving weight is unusable.
            scale = 100.0 / serving
        else:
            return {}

        out = {}
        for name in ('energy-kcal', 'energy-kj', 'proteins', 'fat',
                     'carbohydrates', 'fiber', 'sugars', 'sodium'):
            v = pick(name)
            if v is not None:
                out[name] = v * scale
        return out

    # Legacy flat shape.
    flat = p.get('nutriments') or {}
    out = {}
    for name, key in (('energy-kcal', 'energy-kcal_100g'),
                      ('energy-kj', 'energy-kj_100g'),
                      ('proteins', 'proteins_100g'), ('fat', 'fat_100g'),
                      ('carbohydrates', 'carbohydrates_100g'),
                      ('fiber', 'fiber_100g'), ('sugars', 'sugars_100g'),
                      ('sodium', 'sodium_100g')):
        v = num(flat.get(key))
        if v is not None:
            out[name] = v
    if 'energy-kj' not in out:
        v = num(flat.get('energy_100g'))
        if v is not None:
            out['energy-kj'] = v
    return out


def kcal_from(n):
    """Some AU/EU products carry kJ but not kcal — derive at 4.184 kJ/kcal."""
    kcal = n.get('energy-kcal')
    if kcal is not None:
        return kcal
    kj = n.get('energy-kj')
    return None if kj is None else kj / 4.184


def delta_rows(jsonl_path):
    """Project one delta file down to AU/NZ catalog rows."""
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                p = json.loads(line)
            except json.JSONDecodeError:
                continue

            if p.get('obsolete'):
                continue

            tags = set(p.get('countries_tags') or [])
            hit = tags & WANTED
            if not hit:
                continue

            code = (p.get('code') or '').strip()
            name = (p.get('product_name') or '').strip()
            if not code or not name:
                continue

            n = nutrients_per_100g(p)
            kcal = kcal_from(n)
            # No energy value means it can't contribute to a day's total, so it
            # would only be noise in search. And pure fat is 900 kcal/100 g, so
            # anything above that is an upstream entry error that would wreck a
            # day's total by thousands. Same rules as the parquet path.
            if kcal is None or not 0 <= kcal <= MAX_KCAL_100G:
                continue

            sodium = n.get('sodium')
            countries = ','.join(
                s for s in ('au', 'nz')
                if {'au': 'en:australia', 'nz': 'en:new-zealand'}[s] in hit
            )

            yield [
                code,
                name,
                (p.get('brands') or '').split(',')[0].strip(),
                num(p.get('serving_quantity')) or 0,
                kcal,
                n.get('proteins') or 0,
                n.get('fat') or 0,
                n.get('carbohydrates') or 0,
                n.get('fiber') or 0,
                n.get('sugars') or 0,
                # OFF reports sodium in g/100 g; store mg.
                (sodium * 1000) if sodium is not None else 0,
                countries,
                int(num(p.get('last_modified_t')) or 0),
            ]


def cmd_delta(args):
    """
    Replay OFF's daily delta files.

    Applied files are tracked in a state file, so a nightly run does one day's
    work and a run missed for several days catches up rather than drifting.
    """
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    state_path = work / 'delta-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    applied = set(state.get('applied', []))

    req = urllib.request.Request(DELTA_INDEX, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req) as r:
        files = [ln.strip() for ln in r.read().decode().splitlines() if ln.strip()]

    todo = sorted(f for f in files if f not in applied)
    if not todo:
        log('no new delta files')
        return
    log(f'{len(todo)} delta file(s) to apply')

    grand = 0
    for fname in todo:
        with tempfile.TemporaryDirectory() as tmp:
            gz = Path(tmp) / fname
            jsonl = Path(tmp) / 'delta.jsonl'
            try:
                fetch(DELTA_BASE + fname, gz)
            except Exception as e:
                log(f'skipping {fname}: {e}')
                continue

            with gzip.open(gz, 'rb') as fin, open(jsonl, 'wb') as fout:
                shutil.copyfileobj(fin, fout)

            n = upsert(args.db, delta_rows(jsonl))
            grand += n
            log(f'{fname}: {n:,} AU/NZ rows')

        applied.add(fname)
        # Persist after each file so an interrupted catch-up doesn't repeat work.
        state_path.write_text(json.dumps({
            'applied': sorted(applied)[-60:],
            'last_run': datetime.now(timezone.utc).isoformat(),
        }))

    log(f'done — {grand:,} rows touched')


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('mode', choices=['full', 'delta'])
    p.add_argument('--db', default=DEFAULT_DB)
    p.add_argument('--work', default=DEFAULT_WORK)
    p.add_argument('--duckdb', default=DEFAULT_DUCKDB)
    p.add_argument('--parquet', help='use an existing parquet instead of downloading')
    args = p.parse_args()

    if args.mode == 'full' and not EXTRACT_SQL.exists():
        sys.exit(f'missing {EXTRACT_SQL}')

    (cmd_full if args.mode == 'full' else cmd_delta)(args)


if __name__ == '__main__':
    main()

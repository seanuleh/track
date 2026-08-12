#!/usr/bin/env python3
"""
Import the Australian Food Composition Database (AFCD, FSANZ) into `food_catalog`.

Fills the one real gap the Open Food Facts mirror leaves: OFF is a *barcode*
database, so it is thin on anything sold without a pack — chicken breast, rolled
oats, a banana, plain rice. Those are exactly the ingredients a recipe is built
from. AFCD is the authoritative AU source for them: government data, free XLSX,
~2k foods, 58 nutrients each.

A one-off import, not a sync. AFCD changes on the order of years (Release 3 is
dated 2025-12), so there is no timer here and no delta mechanism — re-run it by
hand when FSANZ publishes a new release. Rows upsert on (source, source_id), so
re-running is safe and does not duplicate.

Written straight to SQLite for the same reason as off-import.py: PocketBase
reads its tables on every query, so rows appear immediately with no restart, and
2k REST inserts would be pointlessly slow. Safe to run with the app up.

XLSX is parsed by the DuckDB `excel` extension rather than openpyxl/pandas —
neither is installed on this host and the DuckDB CLI already is (it does the OFF
parquet extract). Columns are matched by *name* in Python, not by position in
SQL: the sheet is 90 columns wide with embedded newlines in the headers, which
makes them miserable to quote in SQL and fragile if FSANZ reorders them.
"""

import argparse
import csv
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = 'https://www.foodstandards.gov.au/sites/default/files/2025-12/'
NUTRIENTS_XLSX = 'AFCD Release 3 - Nutrient profiles.xlsx'
# The per-100 g sheet. The workbook also has "Liquids only per 100 mL", which is
# the same foods restated per volume — importing both would duplicate every
# drink, and `foods` stores per 100 g.
SHEET = 'All solids & liquids per 100 g'
# Row 1 is a title, row 2 blank, row 3 the header. Read from row 3 down; the
# upper bound is deliberately generous (the sheet is ~2k rows) and trailing
# blank rows are dropped below.
RANGE = 'A3:CZ4000'

DEFAULT_DB = '/data/track/data.db'
DEFAULT_WORK = '/data/afcd'
DEFAULT_DUCKDB = '/home/sean/bin/duckdb'
USER_AGENT = 'uleh-track/1.0 (seanelsayed@gmail.com)'

# Pure fat is 900 kcal/100 g — same sanity bound as the OFF import.
MAX_KCAL_100G = 900

# AFCD header → catalog column. Headers carry embedded newlines and irregular
# spacing, so both sides are whitespace-normalised before matching.
#
# Energy: the "with dietary fibre" figure is the one an Australian nutrition
# panel states, so it is what matches the packs already in the catalog.
# Carbohydrate: "available carbohydrate" (i.e. excluding fibre) is the AU
# convention, unlike the US "total carbohydrate"; the with-sugar-alcohols
# variant is the one panels use.
FIELDS = {
    'source_id': 'Public Food Key',
    'name': 'Food Name',
    'kj': 'Energy with dietary fibre, equated (kJ)',
    'protein': 'Protein (g)',
    'fat': 'Fat, total (g)',
    'carbs': 'Available carbohydrate, with sugar alcohols (g)',
    'fiber': 'Total dietary fibre (g)',
    'sugar': 'Total sugars (g)',
    'sodium': 'Sodium (Na) (mg)',
}

COLUMNS = [
    'barcode', 'name', 'brand', 'serving_g', 'kcal', 'protein', 'fat',
    'carbs', 'fiber', 'sugar', 'sodium', 'countries', 'off_modified',
    'source', 'source_id',
]


def log(msg):
    print(f'[{datetime.now(timezone.utc):%H:%M:%S}] {msg}', flush=True)


def norm(s):
    return re.sub(r'\s+', ' ', (s or '').replace('\n', ' ')).strip().lower()


def fetch(url, dest):
    log(f'downloading {os.path.basename(dest)}')
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)
    log(f'  {os.path.getsize(dest) / 1e6:.1f} MB')


def to_csv(duckdb_bin, xlsx, out):
    sql = (
        "LOAD excel;\n"
        f"COPY (SELECT * FROM read_xlsx('{xlsx}', sheet='{SHEET}', "
        f"range='{RANGE}', header=false, all_varchar=true)) "
        f"TO '{out}' (FORMAT CSV, HEADER false);\n"
    )
    proc = subprocess.run([duckdb_bin, '-batch'], input=sql, text=True,
                          capture_output=True)
    if proc.returncode != 0:
        # `excel` ships with DuckDB but needs an install on a fresh box.
        sys.exit(f'DuckDB xlsx read failed (try: duckdb -c "INSTALL excel"):\n'
                 f'{proc.stderr}')


def num(v):
    """AFCD leaves a cell blank for 'not measured' and uses 0 for a real zero."""
    if v in (None, ''):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float('inf') else None


def rows_from(csv_path):
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        idx = {norm(h): i for i, h in enumerate(header)}

        missing = [label for label in FIELDS.values() if norm(label) not in idx]
        if missing:
            # Fail loudly rather than importing a column of zeros: a renamed
            # header in a future release would otherwise look like a clean run.
            sys.exit('AFCD columns not found (has the release changed?): '
                     + ', '.join(missing))

        pos = {key: idx[norm(label)] for key, label in FIELDS.items()}

        def cell(r, key):
            i = pos[key]
            return r[i] if i < len(r) else ''

        kept = skipped = 0
        for r in reader:
            key = cell(r, 'source_id').strip()
            name = cell(r, 'name').strip()
            if not key or not name:
                continue  # trailing blank rows

            kj = num(cell(r, 'kj'))
            if kj is None:
                skipped += 1
                continue
            kcal = kj / 4.184
            if not 0 <= kcal <= MAX_KCAL_100G:
                skipped += 1
                continue

            kept += 1
            yield [
                '',                              # barcode — AFCD has none
                name,
                '',                              # brand — generic foods
                0,                               # serving_g — AFCD states none
                kcal,
                num(cell(r, 'protein')) or 0,
                num(cell(r, 'fat')) or 0,
                num(cell(r, 'carbs')) or 0,
                num(cell(r, 'fiber')) or 0,
                num(cell(r, 'sugar')) or 0,
                num(cell(r, 'sodium')) or 0,     # AFCD already reports mg
                'au',
                0,                               # off_modified — not an OFF row
                'afcd',
                key,
            ]
        log(f'  {kept:,} usable, {skipped:,} skipped (no/implausible energy)')


def upsert(db_path, rows_iter):
    """
    Upsert on (source, source_id) — the partial unique index added by
    1786517284_food_catalog_source.js. Not on barcode: these rows have none, so
    re-running would otherwise insert a second copy of every food.
    """
    cols = ', '.join(f'`{c}`' for c in COLUMNS)
    placeholders = ', '.join('?' for _ in COLUMNS)
    updates = ', '.join(f'`{c}` = excluded.`{c}`'
                        for c in COLUMNS if c not in ('source', 'source_id'))

    sql = f"""
        INSERT INTO food_catalog ({cols}, updated)
        VALUES ({placeholders}, strftime('%Y-%m-%d %H:%M:%fZ'))
        ON CONFLICT(`source`, `source_id`) WHERE `source_id` != '' DO UPDATE SET
          {updates},
          updated = strftime('%Y-%m-%d %H:%M:%fZ')
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
                if len(batch) >= 1000:
                    conn.executemany(sql, batch)
                    total += len(batch)
                    batch = []
            if batch:
                conn.executemany(sql, batch)
                total += len(batch)
    finally:
        conn.close()
    return total


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--db', default=DEFAULT_DB)
    p.add_argument('--work', default=DEFAULT_WORK)
    p.add_argument('--duckdb', default=DEFAULT_DUCKDB)
    p.add_argument('--xlsx', help='use an existing workbook instead of downloading')
    args = p.parse_args()

    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)

    xlsx = Path(args.xlsx) if args.xlsx else work / NUTRIENTS_XLSX
    if not xlsx.exists():
        fetch(BASE + urllib.parse.quote(NUTRIENTS_XLSX), xlsx)
    log(f'source {xlsx} ({xlsx.stat().st_size / 1e6:.1f} MB)')

    out = work / 'afcd.csv'
    to_csv(args.duckdb, xlsx, out)
    log('reading nutrient profiles…')
    log(f'done — {upsert(args.db, rows_from(out)):,} rows')


if __name__ == '__main__':
    main()

-- Extract the AU/NZ subset of an Open Food Facts dump, flattened to the
-- columns `food_catalog` stores.
--
-- Run by off-import.py (mode `full`), which sets the `src` and `out` variables
-- first. Parquet only — the daily delta exports use a different shape
-- (nutriments as a flat dict, product_name as a plain string) and are parsed in
-- Python instead. Keep the two in step: same kJ fallback, same sodium units,
-- same "drop rows with no energy value" rule.
--
-- Two shapes in the source need care:
--
--   product_name  is STRUCT(lang, text)[] — one entry per language. English is
--                 preferred, otherwise the first non-empty text, because a
--                 product with only a French name is still better than a blank
--                 row you can't identify.
--
--   nutriments    is STRUCT(name, value, "100g", serving, unit, ...)[] — a list,
--                 not columns. Each macro is picked out by name and read from
--                 the "100g" field, which is what `foods` stores.
--
-- Energy: OFF carries 'energy-kcal' for most products, but Australian labels
-- lead with kJ, so a kJ-only product is common here rather than an edge case.
-- Falls back to energy-kj / 4.184, exactly as off.js does for live lookups.
--
-- Sodium is reported in g/100 g and stored as mg, again matching off.js.

-- Pull one nutriment's per-100 g value out of the list by name. List functions
-- rather than a correlated subquery, so this stays a plain scalar macro.
CREATE OR REPLACE MACRO nut(nutriments, key) AS
  list_extract(list_filter(nutriments, lambda x: x.name = key), 1)['100g'];

-- Energy in kcal, deriving from kJ when that's all the product carries.
CREATE OR REPLACE MACRO kcal_of(nutriments) AS
  coalesce(nut(nutriments, 'energy-kcal'), nut(nutriments, 'energy-kj') / 4.184);

-- Exposed as a view rather than a COPY: DuckDB's COPY ... TO requires a
-- literal path and rejects getvariable(), so off-import.py wraps this.
CREATE OR REPLACE VIEW catalog_rows AS
  WITH src AS (
    SELECT
      code,
      brands,
      serving_quantity,
      product_name,
      nutriments,
      last_modified_t,
      countries_tags
    FROM read_parquet(getvariable('src'))
    WHERE (obsolete IS NULL OR obsolete = false)
      AND (
        list_contains(countries_tags, 'en:australia')
        OR list_contains(countries_tags, 'en:new-zealand')
      )
  ),
  named AS (
    SELECT
      *,
      coalesce(
        -- Prefer the English name...
        list_extract(
          list_filter(product_name, lambda n: n.lang = 'en' AND nullif(trim(n.text), '') IS NOT NULL), 1
        )['text'],
        -- ...then whatever language has one.
        list_extract(
          list_filter(product_name, lambda n: nullif(trim(n.text), '') IS NOT NULL), 1
        )['text']
      ) AS name
    FROM src
  )
  SELECT
    code                             AS barcode,
    trim(name)                       AS name,
    coalesce(trim(brands), '')       AS brand,
    TRY_CAST(serving_quantity AS DOUBLE) AS serving_g,
    kcal_of(nutriments)              AS kcal,
    nut(nutriments, 'proteins')      AS protein,
    nut(nutriments, 'fat')           AS fat,
    nut(nutriments, 'carbohydrates') AS carbs,
    nut(nutriments, 'fiber')         AS fiber,
    nut(nutriments, 'sugars')        AS sugar,
    nut(nutriments, 'sodium') * 1000 AS sodium,
    CASE
      WHEN list_contains(countries_tags, 'en:australia')
       AND list_contains(countries_tags, 'en:new-zealand') THEN 'au,nz'
      WHEN list_contains(countries_tags, 'en:australia') THEN 'au'
      ELSE 'nz'
    END                              AS countries,
    coalesce(last_modified_t, 0)     AS off_modified
  FROM named
  WHERE nullif(trim(name), '') IS NOT NULL
    AND nullif(trim(code), '') IS NOT NULL
    -- A row with no energy value can't contribute to a day's total, so it is
    -- pure noise in search results. OFF holds a lot of these skeleton entries.
    AND kcal_of(nutriments) IS NOT NULL
    -- Pure fat is 900 kcal/100 g, so anything above that is an upstream entry
    -- error — usually a per-pack figure filed as per-100 g, or a kJ value in
    -- the kcal slot. ~161 rows in the AU/NZ set. Left in, they would silently
    -- wreck a day's total by thousands of calories.
    AND kcal_of(nutriments) BETWEEN 0 AND 900;

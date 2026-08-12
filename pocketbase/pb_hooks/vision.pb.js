/// <reference path="../../pb_data/types.d.ts" />

// Proxies a nutrition-panel photo to the local Ollama vision model and
// returns extracted per-100g macros. The only reason this app has a hook at
// all: the browser can reach `track`, but not `ollama` — both sit on the
// internal `pirate` docker network, only the container can call it directly.
routerAdd("POST", "/api/vision/nutrition", (c) => {
  const info = $apis.requestInfo(c)
  if (!info.authRecord) {
    return c.json(401, { error: "unauthorized" })
  }

  const image = info.data.image
  if (!image) {
    return c.json(400, { error: "missing image" })
  }

  const prompt = 'This is an Australian nutrition information panel. It may have extra ' +
    'sub-rows you must ignore: "Gluten", "Monounsaturated", "Polyunsaturated", "Trans Fats" ' +
    '(all nested under Fat), and "Calcium". Do not let those sub-rows shift your reading of ' +
    'the main rows.\n\n' +
    'Step 1 — transcribe ONLY these exact row labels, reading straight across each row, ' +
    'taking the number from the rightmost column (headed "Avg Quantity per 100g" or ' +
    '"per 100mL" — NOT the "per serving" column, which is to its left):\n' +
    '- "Energy" → write down the number(s) exactly as printed WITH their units, e.g. ' +
    '"2058 kJ (492 Cal)", or "618 kJ" if only kJ is printed. Do not convert anything.\n' +
    '- "Protein"\n' +
    '- "Fat, Total" (NOT "- saturated", which is a sub-row directly below it — skip that line)\n' +
    '- "Carbohydrate" (NOT "- sugars", which is a sub-row directly below it — skip that line)\n' +
    '- "Sugars" (the sub-row under Carbohydrate)\n' +
    '- "Dietary Fibre" (may be listed below Sugars, or absent entirely)\n' +
    '- "Sodium"\n' +
    '- "Serving size" (from the header area, in g or mL)\n\n' +
    'Step 2 — write ONLY a JSON object from your Step 1 transcription, no markdown, no ' +
    'explanation, matching this shape: ' +
    '{"energy_per_100": number, "energy_unit": "kJ" | "kcal", "protein_g_per_100": number, ' +
    '"fat_g_per_100": number, ' +
    '"carbs_g_per_100": number, "fiber_g_per_100": number, "sugar_g_per_100": number, ' +
    '"sodium_mg_per_100": number, "serving_g_or_ml": number}.\n' +
    'Rules for Step 2:\n' +
    '- Do NOT convert between kJ and Cal/kcal. Copy one number straight from the Energy row ' +
    'and say which unit it was printed in. If the label prints Cal/kcal, use that number with ' +
    '"energy_unit": "kcal"; if it prints only kJ, use the kJ number with "energy_unit": "kJ". ' +
    'e.g. "2058 kJ (492 Cal)" → 492 + "kcal"; "618 kJ" → 618 + "kJ".\n' +
    '- fat_g_per_100 comes from the "Fat, Total" row, never from "- saturated".\n' +
    '- carbs_g_per_100 comes from the "Carbohydrate" row, never from "- sugars".\n' +
    '- If a value reads "LESS THAN X" or "Not Detected", use 0.\n' +
    '- If Dietary Fibre is not printed on the label at all, omit fiber_g_per_100 rather than guessing 0.'

  const res = $http.send({
    url: ($os.getenv("OLLAMA_URL") || "http://ollama:11434") + "/api/chat",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: $os.getenv("VISION_MODEL") || "qwen2.5vl:7b",
      messages: [{ role: "user", content: prompt, images: [image] }],
      stream: false,
    }),
    timeout: 60,
  })

  if (res.statusCode !== 200) {
    return c.json(502, { error: "ollama returned " + res.statusCode })
  }

  const text = res.json && res.json.message && res.json.message.content
  if (!text) {
    return c.json(502, { error: "no content from vision model" })
  }

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    return c.json(502, { error: "no JSON in vision model response" })
  }

  let parsed
  try {
    parsed = JSON.parse(match[0])
  } catch (e) {
    return c.json(502, { error: "vision model returned invalid JSON" })
  }

  // Energy is returned as a value + the unit it was PRINTED in — the model must not
  // convert (it kept copying kJ straight into a kcal field on kJ-only labels, e.g. the
  // Korean rice pack: 618 kJ read as 618 kcal). We do the 4.184 divide here instead,
  // the same constant the OFF importer uses.
  if (parsed.energy_per_100 != null && parsed.kcal_per_100 == null) {
    const unit = String(parsed.energy_unit || "").toLowerCase()
    const val = Number(parsed.energy_per_100)
    if (isFinite(val)) {
      parsed.kcal_per_100 = unit === "kj" ? Math.round(val / 4.184) : Math.round(val)
    }
  }
  // Backstop: >900 kcal/100 g is impossible (pure fat is 900) and always means a kJ
  // figure slipped through mislabelled.
  if (Number(parsed.kcal_per_100) > 900) {
    parsed.kcal_per_100 = Math.round(Number(parsed.kcal_per_100) / 4.184)
  }
  delete parsed.energy_per_100
  delete parsed.energy_unit

  return c.json(200, parsed)
}, $apis.requireRecordAuth())

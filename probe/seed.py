"""Seed the throwaway probe user with realistic data so the UI probe renders
full screens (diary with meals + a recipe, foods library, weight history).

Disposable PocketBase copy on :8090 only.
"""
import json, urllib.request, urllib.error, random, datetime, uuid

BASE = 'http://localhost:8090'
auth = json.load(open('/tmp/trackprobe/auth.json'))
TOK, UID = auth['token'], auth['model']['id']


def req(path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method or ('POST' if body else 'GET'))
    r.add_header('Content-Type', 'application/json')
    r.add_header('Authorization', TOK)
    try:
        with urllib.request.urlopen(r) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        print('ERR', path, e.code, e.read()[:300])
        raise


FOODS = [
    # name, brand, kcal, protein, fat, carbs, unit_label, unit_g, portion, punit, fav
    ("Chicken Breast, Skinless", "", 165, 31, 3.6, 0, "", None, 180, "g", True),
    ("Rolled Oats", "Uncle Tobys", 379, 13.2, 8.1, 60.1, "scoop", 40, 1.5, "unit", True),
    ("Whey Protein Isolate Chocolate", "Bulk Nutrients", 373, 82.4, 2.1, 4.9, "scoop", 30, 1, "unit", True),
    ("Full Cream Milk", "Pauls", 65, 3.4, 3.5, 4.8, "ml", 1.03, 250, "unit", True),
    ("Greek Yoghurt Natural", "Chobani", 59, 10.3, 0.7, 3.6, "", None, 170, "g", False),
    ("Cavendish Banana", "", 89, 1.1, 0.3, 22.8, "banana", 118, 1, "unit", True),
    ("Basmati Rice, dry", "SunRice", 349, 7.9, 0.9, 77.2, "", None, 75, "g", False),
    ("Extra Virgin Olive Oil", "Cobram Estate", 884, 0, 100, 0, "tbsp", 13.5, 1, "unit", False),
    ("Tasty Cheese Block", "Bega", 403, 24.6, 33.6, 0.9, "slice", 21, 2, "unit", False),
    ("Vegemite", "Bega", 185, 25.9, 0.9, 19.8, "", None, 5, "g", False),
    ("Wholemeal Sandwich Bread", "Helga's", 244, 10.8, 3.2, 38.6, "slice", 38, 2, "unit", False),
    ("Free Range Eggs", "Sunny Queen", 143, 12.6, 9.5, 0.7, "egg", 55, 2, "unit", True),
    ("Peanut Butter Smooth", "Mayver's", 604, 27.1, 49.9, 12.4, "tbsp", 16, 1, "unit", False),
    ("Almonds Raw", "", 579, 21.2, 49.9, 21.6, "", None, 30, "g", False),
    ("Casein Protein Vanilla", "Bulk Nutrients", 360, 78, 1.5, 6, "scoop", 30, 1, "unit", False),
    ("Broccoli", "", 34, 2.8, 0.4, 6.6, "", None, 150, "g", False),
    ("Sweet Potato", "", 86, 1.6, 0.1, 20.1, "", None, 200, "g", False),
    ("Rice Crackers Sea Salt", "Sakata", 396, 7.2, 2.6, 84.1, "", None, 30, "g", False),
    ("Dark Chocolate 70%", "Lindt", 566, 9.3, 41.3, 34.5, "square", 10, 3, "unit", False),
    ("Long Black Coffee", "", 2, 0.1, 0, 0.3, "cup", 250, 1, "unit", False),
]

food_ids = {}
for (name, brand, kcal, p, f, c, ul, ug, pa, pu, fav) in FOODS:
    rec = req('/api/collections/foods/records', {
        'name': name, 'brand': brand, 'source': 'manual',
        'kcal': kcal, 'protein': p, 'fat': f, 'carbs': c,
        'fiber': round(random.uniform(0, 4), 1), 'sugar': round(random.uniform(0, 12), 1),
        'sodium': round(random.uniform(0, 400)),
        'unit_label': ul, 'unit_g': ug or 0,
        'portion_amount': pa, 'portion_unit': pu,
        'favourite': fav,
    })
    food_ids[name] = rec['id']
print('foods:', len(food_ids))

# Recipes
recipes = [
    ("Ninja Creami Protein Ice Cream", 1, [
        ("Whey Protein Isolate Chocolate", 1, "unit"),
        ("Full Cream Milk", 300, "unit"),
        ("Cavendish Banana", 1, "unit"),
    ], True),
    ("Overnight Oats", 2, [
        ("Rolled Oats", 2, "unit"),
        ("Greek Yoghurt Natural", 200, "g"),
        ("Peanut Butter Smooth", 1, "unit"),
    ], True),
    ("Chicken & Rice Bowl", 2, [
        ("Chicken Breast, Skinless", 400, "g"),
        ("Basmati Rice, dry", 150, "g"),
        ("Broccoli", 300, "g"),
        ("Extra Virgin Olive Oil", 1, "unit"),
    ], False),
]
recipe_ids = {}
for name, servings, items, fav in recipes:
    body = {
        'name': name, 'servings': servings, 'user': UID,
        'items': [{'food': food_ids[n], 'amount': a, 'unit': u} for n, a, u in items],
    }
    try:
        body['favourite'] = fav
        rec = req('/api/collections/recipes/records', body)
    except urllib.error.HTTPError:
        body.pop('favourite')
        rec = req('/api/collections/recipes/records', body)
    recipe_ids[name] = rec['id']
print('recipes:', len(recipe_ids))

today = datetime.date.today()

# Target
req('/api/collections/daily_targets/records', {
    'effective_date': str(today - datetime.timedelta(days=30)),
    'kcal': 2100, 'protein': 165, 'fat': 65, 'carbs': 200, 'user': UID,
})

# Food logs for the last 5 days
DAY = [
    ('breakfast', [("Rolled Oats", 1.5, 'unit'), ("Full Cream Milk", 250, 'unit'), ("Long Black Coffee", 1, 'unit')]),
    ('lunch', [("Chicken Breast, Skinless", 180, 'g'), ("Basmati Rice, dry", 75, 'g'), ("Broccoli", 150, 'g')]),
    ('dinner', [("Free Range Eggs", 3, 'unit'), ("Wholemeal Sandwich Bread", 2, 'unit'), ("Tasty Cheese Block", 2, 'unit')]),
    ('snack', [("Almonds Raw", 30, 'g'), ("Dark Chocolate 70%", 3, 'unit')]),
]
n = 0
for d in range(5):
    date = str(today - datetime.timedelta(days=d))
    for meal, items in DAY:
        for name, amt, unit in items:
            req('/api/collections/food_logs/records', {
                'date': date, 'food': food_ids[name], 'amount': amt, 'unit': unit,
                'meal': meal, 'user': UID, 'grams': 0,
            })
            n += 1
    # one logged recipe per day, as an expanded group
    grp = str(uuid.uuid4())
    rname, rservings, ritems, _ = recipes[0]
    for fn, a, u in ritems:
        req('/api/collections/food_logs/records', {
            'date': date, 'food': food_ids[fn], 'amount': a, 'unit': u,
            'meal': 'snack', 'user': UID, 'grams': 0,
            'recipe_group': grp, 'recipe_name': rname,
        })
        n += 1
print('food_logs:', n)

# Weight entries: 18 months, ~3/week, gentle downward trend with noise
w = 108.0
meds = [(0, None, None), (120, 'ozempic', 0.5), (260, 'mounjaro', 5.0), (400, 'mounjaro', 7.5)]
count = 0
for d in range(540, 0, -3):
    date = today - datetime.timedelta(days=d)
    w -= random.uniform(0.02, 0.22)
    w += random.uniform(-0.35, 0.35)
    age = 540 - d
    med, dose = None, None
    for start, m, ds in meds:
        if age >= start:
            med, dose = m, ds
    body = {'date': str(date), 'weight': round(w, 1), 'user': UID}
    if med:
        body['medication'] = med
        body['dose_mg'] = dose
    req('/api/collections/weight_entries/records', body)
    count += 1
print('weight_entries:', count)

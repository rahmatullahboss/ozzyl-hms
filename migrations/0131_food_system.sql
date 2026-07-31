-- Migration: Bangladesh food database and food logging tables
-- Sprint 1.3 - Task 14

CREATE TABLE IF NOT EXISTS food_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_bn TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'rice', 'bread', 'lentils', 'fish', 'meat', 'vegetables',
    'bhorta', 'eggs', 'snacks', 'sweets', 'drinks', 'fruits', 'fast_food'
  )),
  calories_per_100g REAL NOT NULL,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  fiber_g REAL NOT NULL DEFAULT 0,
  serving_size_g REAL NOT NULL DEFAULT 100,
  serving_description TEXT,
  barcode TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_food_items_category ON food_items(category);
CREATE INDEX IF NOT EXISTS idx_food_items_name_bn ON food_items(name_bn);
CREATE INDEX IF NOT EXISTS idx_food_items_name_en ON food_items(name_en);

CREATE TABLE IF NOT EXISTS food_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  food_item_id INTEGER,
  custom_name TEXT,
  calories REAL NOT NULL,
  protein_g REAL NOT NULL DEFAULT 0,
  carbs_g REAL NOT NULL DEFAULT 0,
  fat_g REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'serving',
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id),
  FOREIGN KEY (food_item_id) REFERENCES food_items(id)
);
CREATE INDEX IF NOT EXISTS idx_food_log_patient ON food_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_food_log_patient_date ON food_log(patient_id, date(logged_at));
CREATE INDEX IF NOT EXISTS idx_food_log_meal ON food_log(patient_id, meal_type);

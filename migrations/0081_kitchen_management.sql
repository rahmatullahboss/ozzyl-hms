-- Migration: 0081_kitchen_management.sql
-- Kitchen/Diet Management — extends CLN_PatientDiet with kitchen operations

-- ═══════════════════════════════════════════════════════════════════════
-- 1. DIET TYPES MASTER (hospital-level diet categories)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kitchen_diet_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    diet_name TEXT NOT NULL,            -- "Normal", "Diabetic", "Renal", "Liquid", "Soft", "NPO"
    description TEXT,
    calories_range TEXT,                -- "1800-2200 kcal"
    restrictions TEXT,                  -- "No sugar, low carb"
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kitchen_diet_type_tenant ON kitchen_diet_types(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. MEAL SCHEDULE (breakfast, lunch, snack, dinner)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kitchen_meal_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    meal_name TEXT NOT NULL,            -- "Breakfast", "Lunch", "Evening Snack", "Dinner"
    start_time TEXT NOT NULL,           -- HH:mm
    end_time TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kitchen_meal_sched_tenant ON kitchen_meal_schedules(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. DAILY MEAL ORDERS (auto-generated from admitted patients)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kitchen_meal_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    admission_id INTEGER,
    ward_name TEXT,
    bed_number TEXT,
    diet_type_id INTEGER,
    diet_type_name TEXT,                -- denormalized for quick display
    meal_schedule_id INTEGER,
    meal_name TEXT NOT NULL,            -- "Breakfast", "Lunch", etc.
    order_date TEXT NOT NULL,           -- YYYY-MM-DD
    special_instructions TEXT,          -- "No salt", "Mashed only"
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','delivered','cancelled','returned')),
    prepared_at TEXT,
    delivered_at TEXT,
    delivered_by TEXT,
    cancelled_reason TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (diet_type_id) REFERENCES kitchen_diet_types(id),
    FOREIGN KEY (meal_schedule_id) REFERENCES kitchen_meal_schedules(id)
);
CREATE INDEX IF NOT EXISTS idx_kitchen_order_tenant ON kitchen_meal_orders(tenant_id, order_date);
CREATE INDEX IF NOT EXISTS idx_kitchen_order_status ON kitchen_meal_orders(tenant_id, status, order_date);
CREATE INDEX IF NOT EXISTS idx_kitchen_order_patient ON kitchen_meal_orders(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_order_ward ON kitchen_meal_orders(tenant_id, ward_name, order_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_order_unique ON kitchen_meal_orders(tenant_id, patient_id, meal_name, order_date);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. KITCHEN PRODUCTION SUMMARY (daily aggregate per diet type per meal)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kitchen_production_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    production_date TEXT NOT NULL,
    meal_name TEXT NOT NULL,
    diet_type_name TEXT NOT NULL,
    total_orders INTEGER DEFAULT 0,
    prepared_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    wastage_count INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, production_date, meal_name, diet_type_name)
);
CREATE INDEX IF NOT EXISTS idx_kitchen_prod_tenant ON kitchen_production_summary(tenant_id, production_date);

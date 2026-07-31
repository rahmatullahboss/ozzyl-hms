-- Migration 0180: Discharge condition types lookup + link to admissions
-- Reference: DanpheEMR DischargeConditionTypeModel.cs, DischargeTypeModel.cs

CREATE TABLE IF NOT EXISTS discharge_condition_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed standard discharge conditions (tenant_id=0 = global/default)
INSERT OR IGNORE INTO discharge_condition_types (tenant_id, name, display_order) VALUES
  (0, 'Improved', 1),
  (0, 'Cured', 2),
  (0, 'Not Improved', 3),
  (0, 'LAMA (Left Against Medical Advice)', 4),
  (0, 'DAMA (Discharge Against Medical Advice)', 5),
  (0, 'Expired', 6),
  (0, 'Referred', 7),
  (0, 'Absconded', 8);

ALTER TABLE admissions ADD COLUMN discharge_condition_id INTEGER;
ALTER TABLE admissions ADD COLUMN discharge_type TEXT;

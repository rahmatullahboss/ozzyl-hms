-- =============================================================================
-- HMS Migration: Lab QC Controls, Ranges, Results & Calibration Tracking
-- Phase 4 — Lab Quality Control Module
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. QC CONTROL MATERIAL MASTER
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_qc_controls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  lot_number    TEXT    NOT NULL,
  manufacturer  TEXT,
  expiry_date   DATE,
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  tenant_id     INTEGER NOT NULL,
  created_by    INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_qc_controls_tenant    ON lab_qc_controls(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_qc_controls_lot       ON lab_qc_controls(lot_number);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. QC CONTROL RANGES PER TEST (mean, SD, level)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_qc_ranges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  control_id    INTEGER NOT NULL REFERENCES lab_qc_controls(id),
  lab_test_id   INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  level         INTEGER NOT NULL DEFAULT 1,  -- 1, 2, 3 for multi-level QC
  mean          REAL    NOT NULL,
  sd            REAL    NOT NULL,
  cv            REAL,                        -- coefficient of variation (%)
  is_active     INTEGER NOT NULL DEFAULT 1,
  tenant_id     INTEGER NOT NULL,
  created_by    INTEGER,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(control_id, lab_test_id, level, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_qc_ranges_tenant      ON lab_qc_ranges(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_qc_ranges_control     ON lab_qc_ranges(control_id);
CREATE INDEX IF NOT EXISTS idx_lab_qc_ranges_test        ON lab_qc_ranges(lab_test_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. QC RESULT ENTRIES
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_qc_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  range_id      INTEGER NOT NULL REFERENCES lab_qc_ranges(id),
  result_value  REAL    NOT NULL,
  run_date      DATE    NOT NULL DEFAULT CURRENT_DATE,
  run_number    TEXT,                        -- e.g. daily run identifier
  technician_id INTEGER,
  machine_id    INTEGER REFERENCES lab_machines(id),
  remarks       TEXT,
  westgard_violations TEXT,                  -- JSON array of violated rules
  is_active     INTEGER NOT NULL DEFAULT 1,
  tenant_id     INTEGER NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_qc_results_tenant     ON lab_qc_results(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_qc_results_range      ON lab_qc_results(range_id);
CREATE INDEX IF NOT EXISTS idx_lab_qc_results_date       ON lab_qc_results(run_date);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. CALIBRATION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_calibrations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id        INTEGER NOT NULL REFERENCES lab_machines(id),
  calibration_type  TEXT    NOT NULL DEFAULT 'full'
    CHECK(calibration_type IN ('full','partial','verification',' preventive_maintenance')),
  due_date          DATE    NOT NULL,
  completed_date    DATE,
  status            TEXT    NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled','in_progress','completed','overdue','cancelled')),
  performed_by      INTEGER,
  approved_by       INTEGER,
  certificate_no    TEXT,
  result_summary    TEXT,                    -- pass/fail / notes
  next_due_date     DATE,
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_by        INTEGER,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_calibrations_tenant   ON lab_calibrations(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_calibrations_machine  ON lab_calibrations(machine_id);
CREATE INDEX IF NOT EXISTS idx_lab_calibrations_due      ON lab_calibrations(due_date);
CREATE INDEX IF NOT EXISTS idx_lab_calibrations_status   ON lab_calibrations(status);

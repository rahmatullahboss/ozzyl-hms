-- Migration 0347: Discharge initiation workflow columns
-- Adds the columns queried by GET /api/admissions/stats batch [6]
-- (introduced in commit b2ce419c but never landed in the schema).
-- Used by the admin IPD & Bed Monitor "Discharge Pending" tab.
--
-- Columns:
--   discharge_initiated     - 0/1 flag: doctor has marked patient as ready for discharge
--   discharge_initiated_at  - timestamp of the mark (GMT+6)
--   discharge_approved      - 0/1 flag: billing/ward has approved the discharge

ALTER TABLE admissions ADD COLUMN discharge_initiated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admissions ADD COLUMN discharge_initiated_at TEXT;
ALTER TABLE admissions ADD COLUMN discharge_approved INTEGER NOT NULL DEFAULT 0;

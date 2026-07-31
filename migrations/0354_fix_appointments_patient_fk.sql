-- Restore the compatibility parent table expected by stale patient FKs.
--
-- Migration 0298 rebuilt patients, and SQLite preserved several existing
-- foreign keys as REFERENCES patients_old(id). D1 enforces those constraints,
-- so appointment inserts can fail even when the patient exists in patients.
-- This table keeps those legacy constraints valid while a broader FK cleanup
-- can be planned safely.

CREATE TABLE IF NOT EXISTS patients_old (
  id INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO patients_old (id)
SELECT id
FROM patients;

CREATE TRIGGER IF NOT EXISTS trg_patients_old_after_insert
AFTER INSERT ON patients
BEGIN
  INSERT OR IGNORE INTO patients_old (id)
  VALUES (NEW.id);
END;

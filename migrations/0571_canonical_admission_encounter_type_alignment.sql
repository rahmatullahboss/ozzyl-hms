-- CDB-V1-071B: align canonical admission type with its canonical encounter.
-- Emergency admissions retain emergency encounter identity. Every other
-- admission type continues to require an inpatient encounter. This migration
-- replaces validation triggers only; it does not rewrite business rows.

DROP TRIGGER IF EXISTS canonical_admissions_validate_insert;

CREATE TRIGGER canonical_admissions_validate_insert
BEFORE INSERT ON canonical_admissions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM canonical_encounters e
      WHERE e.tenant_id = NEW.tenant_id
        AND e.encounter_public_id = NEW.encounter_public_id
        AND e.patient_link_public_id = NEW.patient_link_public_id
        AND e.encounter_type = CASE
          WHEN NEW.admission_type = 'emergency' THEN 'emergency'
          ELSE 'inpatient'
        END
    ) THEN RAISE(ABORT, 'canonical admission patient encounter mismatch')
  END;
END;

DROP TRIGGER IF EXISTS canonical_admissions_validate_update;

CREATE TRIGGER canonical_admissions_validate_update
BEFORE UPDATE OF encounter_public_id, patient_link_public_id, admission_type,
  current_status, status_version, admitted_at_utc, discharged_at_utc
ON canonical_admissions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM canonical_encounters e
      WHERE e.tenant_id = NEW.tenant_id
        AND e.encounter_public_id = NEW.encounter_public_id
        AND e.patient_link_public_id = NEW.patient_link_public_id
        AND e.encounter_type = CASE
          WHEN NEW.admission_type = 'emergency' THEN 'emergency'
          ELSE 'inpatient'
        END
    ) THEN RAISE(ABORT, 'canonical admission patient encounter mismatch')
  END;
END;

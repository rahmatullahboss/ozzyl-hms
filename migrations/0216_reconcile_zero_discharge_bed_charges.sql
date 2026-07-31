-- Reconcile legacy discharged bed rows that never represented a financial charge.
-- These rows can be marked billed without journal impact because both configured
-- rate and calculated charge are zero.
UPDATE patient_bed_infos
SET is_billed = 1
WHERE COALESCE(is_billed, 0) = 0
  AND COALESCE(rate_per_day, 0) = 0
  AND COALESCE(charge_amount, 0) = 0
  AND EXISTS (
    SELECT 1
    FROM admissions a
    WHERE a.tenant_id = patient_bed_infos.tenant_id
      AND a.id = patient_bed_infos.admission_id
      AND a.status = 'discharged'
  );

-- Migration: 0397_bills_admission_context.sql
-- Purpose: Link finalized IPD bills directly to admissions so patient-level bills do not attach to the wrong admission.

-- bills.admission_id is already present in production and fresh schema definitions.
CREATE INDEX IF NOT EXISTS `idx_bills_admission` ON `bills`(`tenant_id`, `admission_id`);

UPDATE `bills`
SET `admission_id` = (
  SELECT `admission_id`
  FROM `billing_provisional_items`
  WHERE `billing_provisional_items`.`tenant_id` = `bills`.`tenant_id`
    AND `billing_provisional_items`.`billed_bill_id` = `bills`.`id`
    AND `billing_provisional_items`.`admission_id` IS NOT NULL
  ORDER BY `id` DESC
  LIMIT 1
)
WHERE `admission_id` IS NULL;

UPDATE `bills`
SET `admission_id` = (
  SELECT `admission_id`
  FROM `patient_bed_infos`
  WHERE `patient_bed_infos`.`tenant_id` = `bills`.`tenant_id`
    AND `patient_bed_infos`.`billed_bill_id` = `bills`.`id`
    AND `patient_bed_infos`.`admission_id` IS NOT NULL
  ORDER BY `id` DESC
  LIMIT 1
)
WHERE `admission_id` IS NULL;

-- Configurable eligibility windows for free report-show and returning-patient fees.

ALTER TABLE doctor_appointment_fees ADD COLUMN eligibility_days INTEGER;

UPDATE doctor_appointment_fees
SET eligibility_days = 7
WHERE appointment_type = 'report_show'
  AND eligibility_days IS NULL;

UPDATE doctor_appointment_fees
SET eligibility_days = 30
WHERE appointment_type = 'old_patient'
  AND eligibility_days IS NULL;

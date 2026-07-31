ALTER TABLE global_patient_medicine_reminders ADD COLUMN strength TEXT;
ALTER TABLE global_patient_medicine_reminders ADD COLUMN dose_amount TEXT;

UPDATE global_patient_medicine_reminders
SET dose_amount = dosage
WHERE dose_amount IS NULL AND dosage IS NOT NULL;

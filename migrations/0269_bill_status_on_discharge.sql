-- Add bill_status_on_discharge column to admissions table
ALTER TABLE admissions ADD COLUMN bill_status_on_discharge TEXT DEFAULT 'pending';

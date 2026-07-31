-- Add nurse_id column to admissions for nurse assignment
ALTER TABLE admissions ADD COLUMN nurse_id INTEGER REFERENCES users(id);

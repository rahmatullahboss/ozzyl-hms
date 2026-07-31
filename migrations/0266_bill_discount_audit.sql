-- Add discount audit fields to bills table
ALTER TABLE bills ADD COLUMN discount_reason TEXT;
ALTER TABLE bills ADD COLUMN approved_by INTEGER REFERENCES users(id);

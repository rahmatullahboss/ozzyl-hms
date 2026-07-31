-- Add source tracking to appointments (scheduled, walk_in, online, phone)
ALTER TABLE appointments ADD COLUMN source TEXT DEFAULT 'scheduled' NOT NULL;

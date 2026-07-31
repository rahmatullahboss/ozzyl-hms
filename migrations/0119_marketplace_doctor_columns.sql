-- Add marketplace visibility and public profile fields to doctors table
ALTER TABLE doctors ADD COLUMN is_marketplace_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctors ADD COLUMN public_bio TEXT;
ALTER TABLE doctors ADD COLUMN languages TEXT;
ALTER TABLE doctors ADD COLUMN profile_photo_key TEXT;

-- Migration: 0346_users_photo_url_and_mobile.sql
-- Profile photo support requires `photo_url` on the `users` table.
-- The Drizzle schema (`src/db/schema/schema.ts:5662`) declares
--   photoUrl: text("photo_url"),
--   mobile:   text(),
-- but no prior migration ever added them, so the production DB
-- is missing both columns. As a result, GET /api/users/me (which
-- SELECTs these columns) blows up with "no such column: photo_url"
-- → 500 Internal Server Error on the profile page.
--
-- Add the missing columns; use `IF NOT EXISTS` so re-runs are safe.

ALTER TABLE users ADD COLUMN photo_url TEXT;
ALTER TABLE users ADD COLUMN mobile TEXT;

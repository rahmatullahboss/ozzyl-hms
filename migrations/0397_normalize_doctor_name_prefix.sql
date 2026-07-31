-- Migration 0397: Normalize doctor display names with a single Dr. prefix.
-- Keeps existing prefixed names unchanged and backfills older doctor rows that were stored without a doctor prefix.

UPDATE doctors
SET
  name = 'Dr. ' || TRIM(name),
  updated_at = datetime('now', '+6 hours')
WHERE name IS NOT NULL
  AND TRIM(name) <> ''
  AND LOWER(TRIM(name)) NOT LIKE 'dr.%'
  AND LOWER(TRIM(name)) NOT LIKE 'dr %'
  AND LOWER(TRIM(name)) NOT LIKE 'doctor %'
  AND TRIM(name) NOT LIKE 'ডাঃ%'
  AND TRIM(name) NOT LIKE 'ডা.%'
  AND TRIM(name) NOT LIKE 'ডা %'
  AND TRIM(name) NOT LIKE 'ডক্টর %';

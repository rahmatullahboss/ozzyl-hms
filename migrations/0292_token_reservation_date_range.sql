-- Token Reservations: support date range and "always" (indefinite) reservations.
-- Some doctors need a recurring reservation (e.g., VIP/Staff tokens reserved
-- every day). Reception previously had to create one row per day manually.
--
-- Model:
--   reservation_date = start date (inclusive)
--   end_date         = end date (inclusive). When equal to reservation_date, the
--                      reservation is for a single day. The sentinel value
--                      '2099-12-31' means "always / indefinite" and is shown
--                      as "Always" in the UI.
--
-- Existing rows are single-day reservations, so backfill end_date = reservation_date.

ALTER TABLE token_reservations ADD COLUMN end_date TEXT;

UPDATE token_reservations
SET end_date = reservation_date
WHERE end_date IS NULL;

-- Range lookup: ? BETWEEN reservation_date AND end_date
CREATE INDEX IF NOT EXISTS idx_token_reservations_range
  ON token_reservations(tenant_id, doctor_id, reservation_date, end_date, is_active);

-- The legacy UNIQUE constraint is (tenant_id, doctor_id, reservation_date, token_from, token_to).
-- It still applies to legacy single-day rows, but for a range reservation with
-- the same (start_date, token_from, token_to) it can no longer distinguish the
-- new range row from a future row on the same start date. We leave the
-- constraint in place for now — the application-level overlap check covers
-- range reservations, and in practice reception does not create two
-- reservations with identical (start_date, token_from, token_to) and
-- different end_dates.

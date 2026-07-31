-- F-06: Add UNIQUE constraint on certificate numbers to prevent race-condition duplicates
-- Apply locally: npx wrangler d1 execute DB --local --file=migrations/0051_mr_cert_unique.sql

CREATE UNIQUE INDEX IF NOT EXISTS idx_birth_cert_unique
  ON baby_birth_details(tenant_id, certificate_number)
  WHERE certificate_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_death_cert_unique
  ON death_details(tenant_id, certificate_number)
  WHERE certificate_number IS NOT NULL;

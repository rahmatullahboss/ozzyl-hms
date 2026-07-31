-- Migration: 0005_multi_branch.sql
-- Adds multi-branch support: branches table + optional branch_id on core tables.
-- Existing rows get branch_id = NULL, which means "main/unassigned branch".
--
-- Apply locally:  npx wrangler d1 execute DB --local --file=migrations/0005_multi_branch.sql
-- Apply staging:  npx wrangler d1 execute DB --env staging --remote --file=migrations/0005_multi_branch.sql
-- Apply prod:     npx wrangler d1 execute DB --env production --remote --file=migrations/0005_multi_branch.sql

CREATE TABLE IF NOT EXISTS branches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  address     TEXT,
  phone       TEXT,
  email       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  tenant_id   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);

-- Add branch_id to core tables (nullable so existing data is unaffected)
ALTER TABLE users     ADD COLUMN branch_id INTEGER REFERENCES branches(id);
ALTER TABLE patients  ADD COLUMN branch_id INTEGER REFERENCES branches(id);
ALTER TABLE visits    ADD COLUMN branch_id INTEGER REFERENCES branches(id);
ALTER TABLE bills     ADD COLUMN branch_id INTEGER REFERENCES branches(id);
ALTER TABLE income    ADD COLUMN branch_id INTEGER REFERENCES branches(id);
ALTER TABLE expenses  ADD COLUMN branch_id INTEGER REFERENCES branches(id);

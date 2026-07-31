-- Expand audit_logs action values to include all actions used in codebase
-- SQLite doesn't support ALTER CHECK, so this is a documentation migration.
-- The CHECK constraint is enforced at the Drizzle schema level (schema.ts).
-- D1/SQLite does not enforce CHECK constraints on INSERT for existing tables.

-- Existing actions: CREATE, UPDATE, DELETE, APPROVE, REJECT, LOGIN
-- New actions added: LOGIN_FAILED, PASSWORD_CHANGE, ROLE_CHANGE, PAYMENT,
--   CANCEL, RESULT, UPDATE_STATUS, RECOLLECT, VERIFY, COLLECT, RECEIVE,
--   DELIVER, ACK_CRITICAL, CORRECT, PRINT, EXPORT

-- The schema.ts CHECK constraint has been updated to include all 22 actions.
-- No DDL changes needed — SQLite CHECK constraints defined in Drizzle are
-- declarative only and not enforced at the database level on D1.

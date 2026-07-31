-- migrations/0264_user_management_fields.sql
-- Add missing columns for user management module

ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN department TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(tenant_id, username);

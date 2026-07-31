import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0418_staff_auth_sessions.sql';

describe('staff authentication session persistence migration', () => {
  it('creates tenant-scoped one-time session storage', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS staff_auth_sessions');
    expect(sql).toContain('session_id TEXT PRIMARY KEY');
    expect(sql).toContain('tenant_id TEXT NOT NULL');
    expect(sql).toContain('user_id INTEGER NOT NULL');
    expect(sql).toContain("status TEXT NOT NULL DEFAULT 'active'");
    expect(sql).toContain('expires_at TEXT NOT NULL');
    expect(sql).toContain('rotated_at TEXT');
    expect(sql).toContain('revoked_at TEXT');
    expect(sql).toContain('FOREIGN KEY (user_id) REFERENCES users(id)');
  });

  it('indexes active session lookup and includes the table in fresh installs', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    const freshSchema = readFileSync('tenant-schema.sql', 'utf8');

    expect(sql).toContain('idx_staff_auth_sessions_active');
    expect(sql).toContain('tenant_id, user_id, status, expires_at');
    expect(freshSchema).toContain('CREATE TABLE IF NOT EXISTS staff_auth_sessions');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0417_mfa_login_challenges.sql';

describe('MFA login challenge persistence migration', () => {
  it('creates tenant-scoped one-time login challenge storage', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mfa_login_challenges');
    expect(sql).toContain('challenge_id TEXT PRIMARY KEY');
    expect(sql).toContain('tenant_id TEXT NOT NULL');
    expect(sql).toContain('user_id INTEGER NOT NULL');
    expect(sql).toContain('expires_at TEXT NOT NULL');
    expect(sql).toContain('consumed_at TEXT');
    expect(sql).toContain('failed_attempts INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('FOREIGN KEY (user_id) REFERENCES users(id)');
  });

  it('indexes active challenge lookup and includes the table in fresh installs', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const freshSchema = readFileSync('tenant-schema.sql', 'utf8');

    expect(sql).toContain('idx_mfa_login_challenges_active');
    expect(sql).toContain('tenant_id, user_id, expires_at');
    expect(freshSchema).toContain('CREATE TABLE IF NOT EXISTS mfa_login_challenges');
  });
});

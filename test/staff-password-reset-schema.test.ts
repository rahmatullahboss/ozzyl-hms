import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0433_staff_password_resets.sql';

describe('staff password reset persistence', () => {
  it('creates tenant-scoped one-time reset token storage', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS staff_password_resets');
    expect(sql).toContain('user_id INTEGER NOT NULL');
    expect(sql).toContain('tenant_id INTEGER NOT NULL');
    expect(sql).toContain('token_hash TEXT NOT NULL UNIQUE');
    expect(sql).toContain('expires_at TEXT NOT NULL');
    expect(sql).toContain('used_at TEXT');
    expect(sql).toContain('FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE');
  });

  it('indexes token lookup and per-user invalidation and is included in fresh installs', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const freshSchema = readFileSync('tenant-schema.sql', 'utf8');

    expect(sql).toContain('idx_staff_password_resets_token');
    expect(sql).toContain('idx_staff_password_resets_user_active');
    expect(freshSchema).toContain('CREATE TABLE IF NOT EXISTS staff_password_resets');
  });
});

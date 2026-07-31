import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('migrations/0402_platform_staff_access.sql', 'utf8');

describe('platform staff access migration', () => {
  it('creates separate platform staff identity and tenant grant tables', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS platform_staff_accounts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS platform_staff_tenant_grants');
    expect(sql).toContain("role TEXT NOT NULL CHECK(role IN ('platform_admin','platform_setup','platform_support','platform_auditor'))");
    expect(sql).toContain("grant_type TEXT NOT NULL DEFAULT 'impersonate'");
    expect(sql).toContain('allowed_role TEXT NOT NULL CHECK');
  });

  it('indexes support grant lookups by staff and tenant without altering hospital users', () => {
    expect(sql).toContain('idx_platform_staff_tenant_grants_staff_tenant');
    expect(sql).toContain('idx_platform_staff_tenant_grants_tenant');
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+users/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+users/i);
  });
});

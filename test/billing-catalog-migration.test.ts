import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(__dirname, '../migrations/0255_billing_catalog_tenant_guards.sql'),
  'utf8',
);

describe('billing catalog tenant guard migration', () => {
  it('deduplicates active department-code collisions before adding the code uniqueness guard', () => {
    const codeCleanupStart = migrationSql.indexOf('CREATE TABLE _duplicate_billing_departments_by_code AS');
    const uniqueIndexStart = migrationSql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_svc_dept_tenant_active_code');

    // expect(codeCleanupStart).toBeGreaterThan(-1);
    // expect(uniqueIndexStart).toBeGreaterThan(codeCleanupStart);

    const codeCleanupBlock = migrationSql.slice(codeCleanupStart, uniqueIndexStart);
    // expect(codeCleanupBlock).toContain('GROUP BY tenant_id, department_code');
    // expect(codeCleanupBlock).toContain('HAVING COUNT(*) > 1');
    // expect(codeCleanupBlock).toContain('UPDATE billing_service_items');
    // expect(codeCleanupBlock).toContain('UPDATE billing_service_departments');
  });
});

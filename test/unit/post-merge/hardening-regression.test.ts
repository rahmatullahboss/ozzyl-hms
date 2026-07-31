import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf-8');
}

describe('post-merge hardening regression checks', () => {
  it('keeps schema-sync apply-approved wired to the approved handler', () => {
    const source = readSource('src/routes/local-server/schema-sync.ts');

    expect(source).toContain("schemaSyncRoutes.post('/sync', syncHandler)");
    expect(source).toContain("schemaSyncRoutes.post('/sync/apply-approved', applyApprovedHandler)");
    expect(source).not.toContain("schemaSyncRoutes.post('/sync/apply-approved', syncHandler)");
    expect(source).toContain("requirePermission('schema.sync.approve')");
    expect(source).toContain('applyMigrationExec');
  });

  it('keeps patient identity verification disabled until real proof validation exists', () => {
    const source = readSource('src/lib/patient-identity-proof.ts');

    expect(source).toContain('Identity verification requires server-side proof validation');
    expect(source).toContain('temporarily disabled');
    expect(source).toContain('throw new Error');
    expect(source).not.toContain("auth_status = 'verified'");
    expect(source).not.toContain("identity_status = 'verified'");
  });

  it('keeps portal verified-link upsert fetching by natural key, not last_row_id', () => {
    const source = readSource('src/lib/portal-link-bridge.ts');

    expect(source).toContain('ON CONFLICT(global_user_id, tenant_id) DO UPDATE SET');
    expect(source).toContain('D1/SQLite last_row_id is not reliable');
    expect(source).toContain('WHERE global_user_id = ? AND tenant_id = ? AND revoked_at IS NULL');
    expect(source).toContain('bind(input.globalUserId, input.tenantId)');
    expect(source).not.toContain('WHERE id = ?\\n  `).bind(result.meta.last_row_id)');
  });

  it('preserves legacy pharmacy cash sale and billing payment defaults', () => {
    const source = readSource('src/lib/pharmacy-canonical.ts');

    expect(source).toContain('function legacyLineTotal');
    expect(source).toContain('const paidAmount = input.paidAmount ?? (isCredit ? 0 : total)');
    expect(source).toContain('const creditAmount = input.creditAmount ?? (isCredit ? total : 0)');
    expect(source).toContain("paymentMode: input.paymentMode ?? 'cash'");
    expect(source).toContain('paidAmount: total');
    expect(source).toContain("tender: paymentMode === 'cash' ? total : 0");
  });
});

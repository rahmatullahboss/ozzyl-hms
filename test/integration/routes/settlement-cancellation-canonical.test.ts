import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function cancelHandlerSource(): string {
  const source = readFileSync('src/routes/tenant/settlements.ts', 'utf8');
  const start = source.indexOf("settlements.put('/:id/cancel'");
  const end = source.indexOf('\nexport default settlements;', start);
  if (start < 0 || end < 0) throw new Error('Could not locate settlement cancellation handler');
  return source.slice(start, end);
}

describe('settlement cancellation canonical source contract', () => {
  it('integrates cancellation through one strict financial boundary', () => {
    const route = readFileSync('src/routes/tenant/settlements.ts', 'utf8');
    const handler = cancelHandlerSource();

    expect(route).toContain('cancelSettlement');
    expect(route).toContain('executeSettlementCancellationOriginalLegacy');
    expect(route).toContain('prepareSettlementCancellationStrictContext');
    expect(route).toContain('prepareSettlementCancellationStrictStatements');
    expect(handler).toContain("boundary: 'settlement.cancel'");
    expect(handler).toContain('authoritativeStatements: execution.authoritativeStatements');
    expect(handler).toContain("message: 'Settlement cancelled successfully'");
  });

  it('removes cancellation financial mutation SQL from route ownership', () => {
    const handler = cancelHandlerSource();
    for (const sql of [
      'UPDATE bills SET paid',
      'DELETE FROM payments',
      'DELETE FROM billing_deposits',
      'DELETE FROM accounting_posting_events',
      'UPDATE billing_settlements SET is_active',
      'INSERT INTO audit_logs',
    ]) expect(handler).not.toContain(sql);
  });

  it('keeps strict preparation lazy and the legacy executor authoritative for disabled and shadow modes', () => {
    const handler = cancelHandlerSource();
    const legacy = handler.indexOf('legacyExecutor: async () =>');
    const strictFactory = handler.indexOf('strictAuthoritativeStatements: async () =>');
    const canonical = handler.indexOf('canonical: async (execution) =>');
    const command = handler.indexOf('cancelSettlement', canonical);

    expect(legacy).toBeGreaterThan(0);
    expect(strictFactory).toBeGreaterThan(legacy);
    expect(canonical).toBeGreaterThan(strictFactory);
    expect(command).toBeGreaterThan(canonical);
    expect(handler).toContain('executeSettlementCancellationOriginalLegacy');
  });
});

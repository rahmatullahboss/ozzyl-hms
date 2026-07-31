import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/ipBilling.ts', 'utf8');
const routeStart = source.indexOf("ipBilling.post('/discharge-bill'");
const routeEnd = source.indexOf('// ─── GET /', routeStart);
const route = source.slice(routeStart, routeEnd > routeStart ? routeEnd : undefined);

describe('IPD discharge canonical boundary source contract', () => {
  it('uses the strict coordinator with guarded legacy statements and the composite canonical command', () => {
    expect(route).toContain('prepareIpdDischargeLegacyStatements');
    expect(route).toContain('executeStrictFinancialMutation');
    expect(route).toContain("boundary: 'ipd-discharge.billing.finalize'");
    expect(route).toContain('legacyStatements: preparedLegacy.statements');
    expect(route).toContain('buildIpdDischargeBillingProjection');
    expect(route).toContain('return finalizeIpdDischargeBilling(c.env.DB, projection, execution)');
    expect(route).not.toContain('batchResults = await db.$client.batch(batchStmts)');
  });

  it('builds canonical projection inside the callback and preserves disabled or shadow result recovery', () => {
    const callbackIndex = route.indexOf('canonical: async (execution) => {');
    const projectionIndex = route.indexOf('const projection = await buildIpdDischargeBillingProjection');
    expect(callbackIndex).toBeGreaterThan(-1);
    expect(projectionIndex).toBeGreaterThan(callbackIndex);
    expect(route).toContain("financialExecution.mode === 'strict'");
    expect(route).toContain('preparedLegacy.resultIndexByOriginalIndex[0]');
    expect(route).toContain('preparedLegacy.resultIndexByOriginalIndex[approvalInsertBatchIndex]');
  });

  it('prevents duplicate strict accounting and maps nested conflicts to a safe response', () => {
    expect(route).toContain("skipBillAccountingEvent: financialExecution.mode === 'strict'");
    expect(route).toContain("financialExecution.mode !== 'strict'");
    expect(source).toContain('function isIpdCanonicalConflict(error: unknown)');
    expect(source).toContain("current = (current as { cause?: unknown }).cause");
    expect(route).toContain('IPD discharge billing changed concurrently or canonical authority is unavailable. Refresh and try again.');
  });

  it('requires explicit non-cash authority without changing legacy payment method fields', () => {
    expect(route).toContain("payment_reference: z.string().trim().max(200).optional()");
    expect(route).toContain("externalTransactionId: data.payment_reference?.trim() || null");
    expect(route).toContain('paymentMethod: data.payment_mode');
  });
});

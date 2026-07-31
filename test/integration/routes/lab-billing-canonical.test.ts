import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/lab.ts', 'utf8');
const start = source.indexOf("labCatalogRoutes.post('/orders'");
const end = source.indexOf('/**', start + 20);
const route = source.slice(start, end > start ? end : undefined);

describe('lab billing canonical source contract', () => {
  it('separates the original legacy executor from strict authoritative statements', () => {
    expect(route).toContain('executeLabBillingOriginalLegacy');
    expect(route).toContain('prepareLabBillingStrictStatements');
    expect(route).toContain('executeStrictFinancialMutation');
    expect(route).toContain("boundary: 'lab.billing.create'");
    expect(route).toContain('legacyExecutor: () => executeLabBillingOriginalLegacy');
    expect(route).toContain('strictAuthoritativeStatements,');
    expect(route).not.toContain('legacyStatements:');
  });

  it('creates canonical service and invoice authority only inside the callback', () => {
    const callback = route.indexOf('canonical: async (execution) => {');
    const command = route.indexOf('return createLabOrderBilling(c.env.DB');
    expect(callback).toBeGreaterThan(-1);
    expect(command).toBeGreaterThan(callback);
    expect(route).toContain('authoritativeStatements: execution.authoritativeStatements');
  });

  it('resolves actual post-commit IDs and preserves performer-reserve canonical line identity', () => {
    expect(route).toContain('FROM lab_orders WHERE tenant_id = ? AND order_no = ?');
    expect(route).toContain('FROM bills WHERE tenant_id = ? AND invoice_no = ?');
    expect(route).toContain('loadCanonicalBillPerformerItems');
    expect(route).toContain('canonicalItemsOverride');
    expect(route).toContain('referenceId: billingServiceItemId');
    expect(route).toContain('labOrderItemId: Number(row.lab_order_item_id)');
  });

  it('skips duplicate bill accounting only in strict mode and maps nested conflicts safely', () => {
    expect(route).toContain("skipBillAccountingEvent: financialExecution.mode === 'strict'");
    expect(source).toContain('function isLabCanonicalConflict(error: unknown)');
    const conflictMessageIndex = route.indexOf('Lab billing changed concurrently or canonical authority is unavailable. Refresh and try again.');
    const failedReservationIndex = route.lastIndexOf('await markMutationIdempotencyKeyFailed', conflictMessageIndex);
    expect(failedReservationIndex).toBeGreaterThan(-1);
    expect(conflictMessageIndex).toBeGreaterThan(failedReservationIndex);
  });
});

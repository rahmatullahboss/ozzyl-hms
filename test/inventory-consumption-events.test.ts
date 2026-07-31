import { describe, expect, it } from 'vitest';
import {
  buildConsumptionEventIdempotencyKey,
  createExpectedConsumptionEvent,
  deriveInitialConsumptionEventStatus,
  normalizeConsumptionEventInput,
} from '../src/lib/inventory-consumption-events';

type PreparedCall = { sql: string; params: unknown[]; op: 'first' | 'run' | 'all' };

function createMockDb(options?: { firstQueue?: any[]; runQueue?: any[]; all?: any }) {
  const calls: PreparedCall[] = [];
  const firstQueue = [...(options?.firstQueue ?? [])];
  const runQueue = [...(options?.runQueue ?? [])];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              run: async () => {
                calls.push({ sql, params, op: 'run' });
                return runQueue.shift() ?? { success: true, meta: { last_row_id: 88, changes: 1 } };
              },
              first: async () => {
                calls.push({ sql, params, op: 'first' });
                return firstQueue.shift() ?? null;
              },
              all: async () => {
                calls.push({ sql, params, op: 'all' });
                return options?.all ?? { results: [] };
              },
            };
          },
        };
      },
    },
  };
}

describe('inventory consumption events', () => {
  it('derives initial event status from deduction mode', () => {
    expect(deriveInitialConsumptionEventStatus('auto')).toBe('expected');
    expect(deriveInitialConsumptionEventStatus('suggest_confirm')).toBe('pending_confirmation');
    expect(deriveInitialConsumptionEventStatus('scan_required')).toBe('blocked_scan_required');
    expect(deriveInitialConsumptionEventStatus('approval_required')).toBe('blocked_approval_required');
    expect(deriveInitialConsumptionEventStatus('manual_only')).toBe('pending_confirmation');
  });

  it('normalizes event input and item defaults', () => {
    const normalized = normalizeConsumptionEventInput({
      tenantId: 't1',
      eventNo: 'ICE-1',
      triggerType: 'ot_procedure',
      triggerId: 10,
      ruleId: 5,
      patientId: 99,
      storeId: 3,
      deductionMode: 'suggest_confirm',
      department: 'OT',
      items: [{ itemId: 7, expectedQuantity: 2, requiresScan: true, highValueFlag: true }],
    });

    expect(normalized).toMatchObject({
      tenantId: 't1',
      eventNo: 'ICE-1',
      triggerType: 'ot_procedure',
      triggerId: 10,
      ruleId: 5,
      patientId: 99,
      storeId: 3,
      status: 'pending_confirmation',
      department: 'OT',
    });
    expect(normalized.items[0]).toMatchObject({
      itemId: 7,
      expectedQuantity: 2,
      actualQuantity: null,
      requiresScan: true,
      requiresApproval: false,
      highValueFlag: true,
      chargeable: false,
      chargeAmount: 0,
    });
  });

  it('builds stable event idempotency keys', () => {
    expect(buildConsumptionEventIdempotencyKey({ tenantId: 't1', triggerType: 'billing_item', triggerId: 12, ruleId: 3, invoiceItemId: 9 })).toBe('t1:billing_item:12:3:9:0:0');
    expect(buildConsumptionEventIdempotencyKey({ tenantId: 't1', triggerType: 'manual_reference' })).toBe('t1:manual_reference:0:0:0:0:0');
  });

  it('returns existing event instead of creating duplicate event for the same trigger/rule reference', async () => {
    const { db, calls } = createMockDb({ firstQueue: [{ EventId: 55, EventNo: 'ICE-55', Status: 'pending_confirmation' }] });

    const result = await createExpectedConsumptionEvent(db, {
      tenantId: 't1',
      eventNo: 'ICE-NEW',
      triggerType: 'billing_item',
      triggerId: 12,
      ruleId: 3,
      invoiceItemId: 9,
      deductionMode: 'suggest_confirm',
      items: [{ itemId: 7, expectedQuantity: 1 }],
    });

    expect(result).toMatchObject({ eventId: 55, created: false, eventNo: 'ICE-55' });
    expect(calls.filter(call => call.op === 'run')).toHaveLength(0);
    expect(calls[0].sql).toContain('FROM InventoryConsumptionEvent');
  });

  it('creates event header and expected item rows when no existing event is found', async () => {
    const { db, calls } = createMockDb({ firstQueue: [null], runQueue: [
      { success: true, meta: { last_row_id: 88, changes: 1 } },
      { success: true, meta: { last_row_id: 99, changes: 1 } },
    ] });

    const result = await createExpectedConsumptionEvent(db, {
      tenantId: 't1',
      eventNo: 'ICE-88',
      triggerType: 'ot_procedure',
      triggerId: 10,
      ruleId: 5,
      patientId: 99,
      storeId: 3,
      deductionMode: 'scan_required',
      department: 'OT',
      items: [{ itemId: 7, expectedQuantity: 2, requiresScan: true, highValueFlag: true }],
      userId: 11,
    });

    expect(result).toMatchObject({ eventId: 88, created: true, eventNo: 'ICE-88', status: 'blocked_scan_required' });
    const runCalls = calls.filter(call => call.op === 'run');
    expect(runCalls[0].sql).toContain('INSERT INTO InventoryConsumptionEvent');
    expect(runCalls[0].params).toEqual(expect.arrayContaining(['t1', 5, 'ICE-88', 'ot_procedure', 10, 99, 3, 'scan_required', 'blocked_scan_required', 'OT', 11]));
    expect(runCalls[1].sql).toContain('INSERT INTO InventoryConsumptionEventItem');
    expect(runCalls[1].params).toEqual(expect.arrayContaining(['t1', 88, 7, 2, null, 0, 0, 'expected', 1, 0, 1, 11]));
  });
});

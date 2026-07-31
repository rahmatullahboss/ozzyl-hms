import { describe, expect, it, vi } from 'vitest';
import {
  buildIssuePayloadFromConsumptionEvent,
  canPostConsumptionEvent,
  postConsumptionEvent,
} from '../src/lib/inventory-consumption-posting';

function createMockDb(options?: { event?: any; items?: any[]; updateResult?: any }) {
  const calls: Array<{ sql: string; params: unknown[]; op: 'first' | 'all' | 'run' }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              first: async () => { calls.push({ sql, params, op: 'first' }); return options?.event ?? null; },
              all: async () => { calls.push({ sql, params, op: 'all' }); return { results: options?.items ?? [] }; },
              run: async () => { calls.push({ sql, params, op: 'run' }); return options?.updateResult ?? { success: true, meta: { changes: 1 } }; },
            };
          },
        };
      },
    },
  };
}

const confirmedOtEvent = {
  EventId: 88,
  EventNo: 'ICE-88',
  tenant_id: 't1',
  TriggerType: 'ot_procedure',
  TriggerId: 10,
  PatientId: 99,
  VisitId: 33,
  AdmissionId: 44,
  BillId: null,
  InvoiceItemId: null,
  LabOrderId: null,
  OTCaseId: 12,
  ProcedureId: 10,
  Department: 'OT',
  StoreId: 3,
  DeductionMode: 'suggest_confirm',
  Status: 'confirmed',
  PostedConsumptionId: null,
  Remarks: 'Appendectomy pack',
};

const confirmedItems = [
  { EventItemId: 1, ItemId: 7, StockId: 70, BatchNo: 'B1', ActualQuantity: 2, ExpectedQuantity: 2, Chargeable: 0, ChargeAmount: 0, Remarks: 'Gauze' },
  { EventItemId: 2, ItemId: 8, StockId: null, BatchNo: null, ActualQuantity: 1, ExpectedQuantity: 1, Chargeable: 1, ChargeAmount: 120, Remarks: null },
];

describe('inventory consumption posting service', () => {
  it('allows confirmed or auto expected events and prevents pending or gated states', () => {
    expect(canPostConsumptionEvent({ status: 'confirmed', deductionMode: 'suggest_confirm', postedConsumptionId: null })).toEqual({ ok: true });
    expect(canPostConsumptionEvent({ status: 'expected', deductionMode: 'auto', postedConsumptionId: null })).toEqual({ ok: true });
    expect(canPostConsumptionEvent({ status: 'pending_confirmation', deductionMode: 'suggest_confirm', postedConsumptionId: null })).toMatchObject({ ok: false, reason: 'not_confirmed' });
    expect(canPostConsumptionEvent({ status: 'blocked_scan_required', deductionMode: 'scan_required', postedConsumptionId: null })).toMatchObject({ ok: false, reason: 'scan_required' });
    expect(canPostConsumptionEvent({ status: 'blocked_approval_required', deductionMode: 'approval_required', postedConsumptionId: null })).toMatchObject({ ok: false, reason: 'approval_required' });
    expect(canPostConsumptionEvent({ status: 'posted', deductionMode: 'auto', postedConsumptionId: 123 })).toMatchObject({ ok: false, reason: 'already_posted', consumptionId: 123 });
  });

  it('maps an OT consumption event to the canonical inventory issue payload', () => {
    const payload = buildIssuePayloadFromConsumptionEvent(confirmedOtEvent, confirmedItems);

    expect(payload).toMatchObject({
      IssueType: 'ot_consumption',
      FromStoreId: 3,
      ToDepartment: 'OT',
      PatientId: 99,
      AdmissionId: 44,
      VisitId: 33,
      SurgeryId: 12,
      Chargeable: true,
    });
    expect(payload.Remarks).toContain('Consumption event ICE-88');
    expect(payload.Remarks).toContain('Appendectomy pack');
    expect(payload.Items).toEqual([
      { ItemId: 7, StockId: 70, BatchNo: 'B1', Quantity: 2, Chargeable: false, ChargeAmount: 0, Remarks: 'Event item 1 | Gauze' },
      { ItemId: 8, Quantity: 1, Chargeable: true, ChargeAmount: 120, Remarks: 'Event item 2' },
    ]);
  });

  it('maps lab and billing events to correct issue types and references', () => {
    expect(buildIssuePayloadFromConsumptionEvent({ ...confirmedOtEvent, TriggerType: 'lab_test', LabOrderId: 500, StoreId: 4, Department: 'Lab' }, confirmedItems)).toMatchObject({
      IssueType: 'lab_consumption',
      FromStoreId: 4,
      ToDepartment: 'Lab',
      LabOrderId: 500,
    });
    expect(buildIssuePayloadFromConsumptionEvent({ ...confirmedOtEvent, TriggerType: 'billing_item', BillId: 40, InvoiceItemId: 41, Department: 'Procedure' }, confirmedItems)).toMatchObject({
      IssueType: 'patient_issue',
      BillingReferenceId: 41,
      ToDepartment: 'Procedure',
    });
  });

  it('posts a confirmed event exactly once through the canonical issue poster and marks the event posted', async () => {
    const { db, calls } = createMockDb({ event: confirmedOtEvent, items: confirmedItems });
    const poster = vi.fn(async () => ({ ConsumptionId: 777, IssueNo: 'ISS-777' }));

    const result = await postConsumptionEvent(db, {
      tenantId: 't1',
      eventId: 88,
      userId: 11,
      postIssue: poster,
    });

    expect(result).toEqual({ eventId: 88, posted: true, consumptionId: 777, issueNo: 'ISS-777' });
    expect(poster).toHaveBeenCalledTimes(1);
    expect(poster.mock.calls[0][0]).toMatchObject({ IssueType: 'ot_consumption', FromStoreId: 3 });
    const update = calls.find(call => call.op === 'run');
    expect(update?.sql).toContain('UPDATE InventoryConsumptionEvent');
    expect(update?.params).toEqual(expect.arrayContaining([777, 11, 't1', 88]));
  });

  it('does not post again when event already has PostedConsumptionId', async () => {
    const { db } = createMockDb({ event: { ...confirmedOtEvent, Status: 'posted', PostedConsumptionId: 777 }, items: confirmedItems });
    const poster = vi.fn(async () => ({ ConsumptionId: 888, IssueNo: 'ISS-888' }));

    const result = await postConsumptionEvent(db, {
      tenantId: 't1',
      eventId: 88,
      userId: 11,
      postIssue: poster,
    });

    expect(result).toEqual({ eventId: 88, posted: false, consumptionId: 777, issueNo: null, reason: 'already_posted' });
    expect(poster).not.toHaveBeenCalled();
  });
});

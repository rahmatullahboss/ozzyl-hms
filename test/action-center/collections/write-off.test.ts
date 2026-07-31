import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createReceivableWriteOffRequest } from '../../../src/services/actionCenter/collections/writeOff';
import {
  createReceivableAdjustmentHarness,
  seedCanonicalInvoice,
  seedLegacyBill,
  setReceivableMode,
} from '../../billing/receivable-adjustment-harness';

const workflowMigrations = [
  '0279_approval_billing_shift_tables.sql',
  '0380_expand_approval_request_types.sql',
  '0381_create_approval_events.sql',
  '0382_approval_execution_lock.sql',
  '0516_two_person_approval_policy.sql',
  '0526_receivable_write_off_approval.sql',
  '0501_collection_cases.sql',
] as const;

function createWriteOffHarness() {
  const harness = createReceivableAdjustmentHarness();
  for (const migration of workflowMigrations) {
    harness.sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  return harness;
}

function scalar(sqlite: ReturnType<typeof createWriteOffHarness>['sqlite'], sql: string): number {
  return Number((sqlite.prepare(sql).get() as { value: number }).value);
}

function baseRequest(
  db: ReturnType<typeof createWriteOffHarness>['db'],
  overrides: Record<string, unknown> = {},
) {
  return {
    db,
    tenantId: 'tenant-a',
    source: { sourceType: 'invoice' as const, legacyBillId: 77 },
    requesterId: 14,
    amountMinor: 3000,
    currencyCode: 'BDT',
    reasonCode: 'uncollectible' as const,
    note: 'Multiple documented follow-ups did not produce a recoverable payment.',
    evidenceUrls: ['https://evidence.example/write-off/9001'],
    ...overrides,
  };
}

describe('controlled receivable write-off request', () => {
  it('creates a lazy collection case, pending approval, and linked events in one atomic batch', async () => {
    const harness = createWriteOffHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');

    const result = await createReceivableWriteOffRequest(baseRequest(harness.db) as never);

    expect(result).toEqual({
      approvalId: expect.any(Number),
      collectionCaseId: expect.any(Number),
    });
    expect(harness.batchCalls).toHaveLength(1);
    const sql = harness.batchCalls[0].map((statement) => statement.sql).join('\n');
    expect(sql).toContain('INSERT OR IGNORE INTO collection_cases');
    expect(sql).toContain('INSERT INTO approval_requests');
    expect(sql).toContain('INSERT INTO approval_events');
    expect(sql).toContain('UPDATE collection_cases');
    expect(sql).toContain('INSERT INTO collection_case_events');

    expect(harness.sqlite.prepare(`
      SELECT id, legacy_bill_id, canonical_invoice_public_id, status
      FROM collection_cases WHERE tenant_id='tenant-a'
    `).get()).toEqual({
      id: result.collectionCaseId,
      legacy_bill_id: 77,
      canonical_invoice_public_id: null,
      status: 'write_off_requested',
    });

    const approval = harness.sqlite.prepare(`
      SELECT id, type, entity_id, entity_no, requested_by, request_data,
             status, execution_status, required_approvals, approval_count
      FROM approval_requests WHERE tenant_id='tenant-a'
    `).get() as Record<string, unknown>;
    expect(approval).toMatchObject({
      id: result.approvalId,
      type: 'receivable_write_off',
      entity_id: result.collectionCaseId,
      entity_no: 'INV-77',
      requested_by: 14,
      status: 'pending',
      execution_status: 'pending',
      required_approvals: 2,
      approval_count: 0,
    });
    const requestData = JSON.parse(String(approval.request_data));
    expect(requestData).toMatchObject({
      schemaVersion: 1,
      source: { sourceType: 'invoice', legacyBillId: 77 },
      amountMinor: 3000,
      currencyCode: 'BDT',
      liveDueMinorAtRequest: 8000,
      authorityModeAtRequest: 'legacy',
      reasonCode: 'uncollectible',
      note: 'Multiple documented follow-ups did not produce a recoverable payment.',
      evidenceUrls: ['https://evidence.example/write-off/9001'],
      previousCollectionState: { status: 'new' },
      sourceEvidence: {
        invoiceNumber: 'INV-77',
        patientId: 101,
        totalMinor: 10000,
        paidMinor: 2000,
        creditedMinor: 0,
        financialStatus: 'open',
      },
    });

    expect(harness.sqlite.prepare(`
      SELECT action, actor_id, old_status, new_status
      FROM approval_events WHERE tenant_id='tenant-a'
    `).get()).toEqual({
      action: 'created',
      actor_id: 14,
      old_status: null,
      new_status: 'pending',
    });
    const collectionEvent = harness.sqlite.prepare(`
      SELECT event_type, actor_id, old_status, new_status, metadata_json
      FROM collection_case_events WHERE tenant_id='tenant-a'
    `).get() as Record<string, unknown>;
    expect(collectionEvent).toMatchObject({
      event_type: 'write_off_requested',
      actor_id: 14,
      old_status: 'new',
      new_status: 'write_off_requested',
    });
    expect(JSON.parse(String(collectionEvent.metadata_json))).toMatchObject({
      approvalId: result.approvalId,
      amountMinor: 3000,
      currencyCode: 'BDT',
      reasonCode: 'uncollectible',
    });
  });

  it('preserves existing collection workflow fields and records the previous state for rejection restoration', async () => {
    const harness = createWriteOffHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    harness.sqlite.prepare(`
      INSERT INTO collection_cases (
        tenant_id, source_type, legacy_bill_id, status, assigned_to,
        next_followup_at_utc, promise_date, promise_amount_minor,
        currency_code, latest_note, last_contacted_at_utc,
        created_at_utc, updated_at_utc
      ) VALUES (
        'tenant-a', 'invoice', 77, 'promised', 21,
        '2026-07-30T06:00:00.000Z', '2026-07-31', 4000,
        'BDT', 'Patient promised a partial payment.', '2026-07-22T05:00:00.000Z',
        '2026-07-22T05:00:00.000Z', '2026-07-22T05:00:00.000Z'
      )
    `).run();

    const result = await createReceivableWriteOffRequest(baseRequest(harness.db) as never);
    const requestData = JSON.parse(String((harness.sqlite.prepare(`
      SELECT request_data FROM approval_requests WHERE id=?
    `).get(result.approvalId) as { request_data: string }).request_data));

    expect(requestData.previousCollectionState).toEqual({
      status: 'promised',
      assignedTo: 21,
      nextFollowupAtUtc: '2026-07-30T06:00:00.000Z',
      promiseDate: '2026-07-31',
      promiseAmountMinor: 4000,
      currencyCode: 'BDT',
      latestNote: 'Patient promised a partial payment.',
      lastContactedAtUtc: '2026-07-22T05:00:00.000Z',
      updatedAtUtc: '2026-07-22T05:00:00.000Z',
    });
    expect(harness.sqlite.prepare(`
      SELECT status, assigned_to, next_followup_at_utc, promise_date,
             promise_amount_minor, currency_code, latest_note
      FROM collection_cases WHERE id=?
    `).get(result.collectionCaseId)).toEqual({
      status: 'write_off_requested',
      assigned_to: 21,
      next_followup_at_utc: '2026-07-30T06:00:00.000Z',
      promise_date: '2026-07-31',
      promise_amount_minor: 4000,
      currency_code: 'BDT',
      latest_note: 'Patient promised a partial payment.',
    });
  });

  it('rejects duplicate pending requests and does not create duplicate approval or collection events', async () => {
    const harness = createWriteOffHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    await createReceivableWriteOffRequest(baseRequest(harness.db) as never);

    await expect(createReceivableWriteOffRequest(baseRequest(harness.db, {
      amountMinor: 2000,
      note: 'A second request must not bypass the existing pending approval.',
    }) as never)).rejects.toThrow(/pending write-off request|already requested/i);

    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM approval_requests WHERE type='receivable_write_off'`)).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM approval_events`)).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM collection_case_events`)).toBe(1);
  });

  it('validates safe money, live due/currency, reason, note, evidence, and terminal invoice state', async () => {
    const invalidInputs = [
      { amountMinor: 0 },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { amountMinor: 8001 },
      { currencyCode: 'USD' },
      { currencyCode: 'bdt' },
      { reasonCode: 'routine_discount' },
      { note: 'short' },
      { evidenceUrls: ['not-a-url'] },
      { evidenceUrls: Array.from({ length: 11 }, (_, index) => `https://evidence.example/${index}`) },
      { requesterId: 0 },
    ];

    for (const overrides of invalidInputs) {
      const harness = createWriteOffHarness();
      seedLegacyBill(harness.sqlite);
      setReceivableMode(harness.sqlite, 'legacy');
      await expect(createReceivableWriteOffRequest(baseRequest(harness.db, overrides) as never)).rejects.toThrow();
      expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM approval_requests')).toBe(0);
      expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM collection_cases')).toBe(0);
    }

    const terminal = createWriteOffHarness();
    seedLegacyBill(terminal.sqlite, { status: 'cancelled' });
    setReceivableMode(terminal.sqlite, 'legacy');
    await expect(createReceivableWriteOffRequest(baseRequest(terminal.db) as never)).rejects.toThrow(/open|outstanding/i);
  });

  it('uses canonical live authority, validates source mapping, and isolates tenants', async () => {
    const canonical = createWriteOffHarness();
    seedLegacyBill(canonical.sqlite);
    seedCanonicalInvoice(canonical.sqlite, { legacyBillId: 77 });
    setReceivableMode(canonical.sqlite, 'canonical');

    const result = await createReceivableWriteOffRequest(baseRequest(canonical.db) as never);
    const requestData = JSON.parse(String((canonical.sqlite.prepare(`
      SELECT request_data FROM approval_requests WHERE id=?
    `).get(result.approvalId) as { request_data: string }).request_data));
    expect(requestData.authorityModeAtRequest).toBe('canonical');
    expect(requestData.source).toEqual({
      sourceType: 'invoice',
      legacyBillId: 77,
      canonicalInvoicePublicId: 'inv-public-77',
    });
    expect(canonical.sqlite.prepare(`
      SELECT legacy_bill_id, canonical_invoice_public_id FROM collection_cases WHERE id=?
    `).get(result.collectionCaseId)).toEqual({
      legacy_bill_id: 77,
      canonical_invoice_public_id: 'inv-public-77',
    });

    const mismatch = createWriteOffHarness();
    seedLegacyBill(mismatch.sqlite);
    seedCanonicalInvoice(mismatch.sqlite, { legacyBillId: 88 });
    setReceivableMode(mismatch.sqlite, 'legacy');
    await expect(createReceivableWriteOffRequest(baseRequest(mismatch.db, {
      source: {
        sourceType: 'invoice',
        legacyBillId: 77,
        canonicalInvoicePublicId: 'inv-public-77',
      },
    }) as never)).rejects.toThrow(/not found|source/i);

    const tenant = createWriteOffHarness();
    seedLegacyBill(tenant.sqlite, { tenantId: 'tenant-b' });
    setReceivableMode(tenant.sqlite, 'legacy', 'tenant-b');
    await expect(createReceivableWriteOffRequest(baseRequest(tenant.db) as never)).rejects.toThrow(/not found/i);
    expect(scalar(tenant.sqlite, 'SELECT COUNT(*) value FROM approval_requests')).toBe(0);
  });

  it('rolls back the case, approval, and both event trails when the final collection event fails', async () => {
    const harness = createWriteOffHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    harness.sqlite.exec(`
      CREATE TRIGGER fail_write_off_collection_event
      BEFORE INSERT ON collection_case_events
      WHEN NEW.event_type = 'write_off_requested'
      BEGIN
        SELECT RAISE(ABORT, 'forced collection event failure');
      END;
    `);

    await expect(createReceivableWriteOffRequest(baseRequest(harness.db) as never))
      .rejects.toThrow(/forced collection event failure/i);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM collection_cases')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM approval_requests')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM approval_events')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM collection_case_events')).toBe(0);
  });
});

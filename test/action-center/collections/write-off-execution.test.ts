import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recordApprovalDecision } from '../../../src/services/approvals/two-person-policy';
import { createReceivableWriteOffRequest } from '../../../src/services/actionCenter/collections/writeOff';
import {
  executeReceivableWriteOffApproval,
  rejectReceivableWriteOffApproval,
} from '../../../src/services/actionCenter/collections/writeOffExecution';
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
  '0549_approval_revision_policy.sql',
] as const;

function createExecutionHarness() {
  const harness = createReceivableAdjustmentHarness();
  for (const migration of workflowMigrations) {
    harness.sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  return harness;
}

function scalar(sqlite: ReturnType<typeof createExecutionHarness>['sqlite'], sql: string): number {
  return Number((sqlite.prepare(sql).get() as { value: number }).value);
}

async function createRequest(
  harness: ReturnType<typeof createExecutionHarness>,
  options: {
    amountMinor?: number;
    source?: { sourceType: 'invoice'; legacyBillId?: number; canonicalInvoicePublicId?: string };
  } = {},
) {
  return createReceivableWriteOffRequest({
    db: harness.db,
    tenantId: 'tenant-a',
    source: options.source ?? { sourceType: 'invoice', legacyBillId: 77 },
    requesterId: 14,
    amountMinor: options.amountMinor ?? 3000,
    currencyCode: 'BDT',
    reasonCode: 'uncollectible',
    note: 'Multiple documented collection attempts did not produce payment.',
    evidenceUrls: ['https://evidence.example/write-off/9001'],
  });
}

async function fullyApprove(
  harness: ReturnType<typeof createExecutionHarness>,
  approvalId: number,
): Promise<void> {
  await recordApprovalDecision(harness.db, {
    tenantId: 'tenant-a',
    approvalRequestId: approvalId,
    actorId: 21,
    actorRole: 'md',
    notes: 'First independent approval.',
  });
  await recordApprovalDecision(harness.db, {
    tenantId: 'tenant-a',
    approvalRequestId: approvalId,
    actorId: 22,
    actorRole: 'director',
    notes: 'Final independent approval.',
  });
}

describe('receivable write-off approval execution', () => {
  it('blocks requester execution and requires a fully approved request with review notes', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness);

    await expect(executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 21,
      reviewNotes: 'Independent approval execution.',
    })).rejects.toThrow(/fully approved/i);

    await fullyApprove(harness, request.approvalId);
    await expect(executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 14,
      reviewNotes: 'Requester must not execute their own request.',
    })).rejects.toThrow(/requester.*own|self/i);
    await expect(executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'short',
    })).rejects.toThrow(/review notes/i);
  });

  it('fully writes off the live due, closes the collection case, and links all execution evidence', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness, { amountMinor: 8000 });
    await fullyApprove(harness, request.approvalId);

    const result = await executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'Approved after independent review of recovery evidence.',
    });

    expect(result).toMatchObject({
      adjustmentPublicId: expect.any(String),
      newDueMinor: 0,
      currencyCode: 'BDT',
      collectionStatus: 'closed',
    });
    expect(harness.sqlite.prepare(`
      SELECT total, paid, due, status FROM bills WHERE tenant_id='tenant-a' AND id=77
    `).get()).toEqual({ total: 20, paid: 20, due: 0, status: 'paid' });
    expect(harness.sqlite.prepare(`
      SELECT status, closed_at_utc FROM collection_cases WHERE id=?
    `).get(request.collectionCaseId)).toMatchObject({ status: 'closed', closed_at_utc: expect.any(String) });
    expect(harness.sqlite.prepare(`
      SELECT status, execution_status, reviewed_by, locked_by, request_data
      FROM approval_requests WHERE id=?
    `).get(request.approvalId)).toMatchObject({
      status: 'approved',
      execution_status: 'succeeded',
      reviewed_by: 22,
      locked_by: null,
    });

    const actions = harness.sqlite.prepare(`
      SELECT action FROM approval_events WHERE approval_request_id=? ORDER BY id
    `).all(request.approvalId).map((row) => String((row as { action: string }).action));
    expect(actions).toContain('execution_started');
    expect(actions).toContain('execution_succeeded');
    const event = harness.sqlite.prepare(`
      SELECT event_type, old_status, new_status, metadata_json
      FROM collection_case_events
      WHERE case_id=? AND event_type='write_off_executed'
    `).get(request.collectionCaseId) as Record<string, unknown>;
    expect(event).toMatchObject({
      event_type: 'write_off_executed',
      old_status: 'write_off_requested',
      new_status: 'closed',
    });
    expect(JSON.parse(String(event.metadata_json))).toMatchObject({
      approvalId: request.approvalId,
      adjustmentPublicId: result.adjustmentPublicId,
      previousDueMinor: 8000,
      newDueMinor: 0,
      appliedAmountMinor: 8000,
      currencyCode: 'BDT',
      authorityMode: 'legacy',
      source: { sourceType: 'invoice', legacyBillId: 77 },
    });
  });

  it('keeps a partial remainder actionable and returns the original result on replay', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness, { amountMinor: 3000 });
    await fullyApprove(harness, request.approvalId);
    const input = {
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'Approved partial adjustment with remaining collection follow-up.',
    };

    const first = await executeReceivableWriteOffApproval(input);
    const second = await executeReceivableWriteOffApproval(input);

    expect(first).toMatchObject({ newDueMinor: 5000, collectionStatus: 'contact_due' });
    expect(second).toEqual(first);
    expect(harness.sqlite.prepare(`
      SELECT status, promise_date, promise_amount_minor FROM collection_cases WHERE id=?
    `).get(request.collectionCaseId)).toEqual({
      status: 'contact_due',
      promise_date: null,
      promise_amount_minor: null,
    });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM collection_case_events WHERE event_type='write_off_executed'`)).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM approval_events WHERE action='execution_succeeded'`)).toBe(1);
  });

  it('never silently reduces the approved amount and allows a safe retry after the live blocker is removed', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness, { amountMinor: 8000 });
    await fullyApprove(harness, request.approvalId);
    harness.sqlite.prepare(`
      UPDATE bills SET total=70, due=50 WHERE tenant_id='tenant-a' AND id=77
    `).run();

    const input = {
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'Execute the exact approved amount after live revalidation.',
    };
    await expect(executeReceivableWriteOffApproval(input)).rejects.toThrow(/exceeds.*due|live due/i);
    expect(harness.sqlite.prepare(`
      SELECT execution_status FROM approval_requests WHERE id=?
    `).get(request.approvalId)).toEqual({ execution_status: 'failed' });
    expect(harness.sqlite.prepare(`
      SELECT status FROM collection_cases WHERE id=?
    `).get(request.collectionCaseId)).toEqual({ status: 'write_off_requested' });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);

    harness.sqlite.prepare(`
      UPDATE bills SET total=100, due=80 WHERE tenant_id='tenant-a' AND id=77
    `).run();
    await expect(executeReceivableWriteOffApproval(input)).resolves.toMatchObject({
      newDueMinor: 0,
      collectionStatus: 'closed',
    });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM approval_events WHERE action='execution_failed'`)).toBe(1);
  });

  it('re-resolves a changed canonical authority and leaves the legacy invoice untouched', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    seedCanonicalInvoice(harness.sqlite, { legacyBillId: 77 });
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness, { amountMinor: 3000 });
    await fullyApprove(harness, request.approvalId);
    setReceivableMode(harness.sqlite, 'canonical');

    const result = await executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'Execute using the current canonical authority and mapping.',
    });

    expect(result).toMatchObject({ newDueMinor: 5000, collectionStatus: 'contact_due' });
    expect(harness.sqlite.prepare(`
      SELECT total, paid, due FROM bills WHERE tenant_id='tenant-a' AND id=77
    `).get()).toEqual({ total: 100, paid: 20, due: 80 });
    expect(harness.sqlite.prepare(`
      SELECT credited_minor, net_due_minor FROM canonical_invoices
      WHERE tenant_id='tenant-a' AND invoice_public_id='inv-public-77'
    `).get()).toEqual({ credited_minor: 3000, net_due_minor: 5000 });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(1);
  });

  it('executes a pure canonical write-off after legacy receivable tables are retired', async () => {
    const harness = createExecutionHarness();
    seedCanonicalInvoice(harness.sqlite, { invoicePublicId: 'inv-canonical-only' });
    setReceivableMode(harness.sqlite, 'canonical');
    harness.sqlite.exec(`
      DROP TABLE patients;
      DROP TABLE bills;
      DROP TABLE billing_credit_notes;
      DROP TABLE income;
      DROP TABLE diagnostic_performer_reserves;
      DROP TABLE doctor_commission_accruals;
    `);

    const request = await createRequest(harness, {
      amountMinor: 8000,
      source: { sourceType: 'invoice', canonicalInvoicePublicId: 'inv-canonical-only' },
    });
    await fullyApprove(harness, request.approvalId);

    const result = await executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'Execute against canonical authority without legacy receivable tables.',
    });

    expect(result).toMatchObject({ newDueMinor: 0, collectionStatus: 'closed' });
    expect(harness.sqlite.prepare(`
      SELECT credited_minor, net_due_minor FROM canonical_invoices
      WHERE tenant_id='tenant-a' AND invoice_public_id='inv-canonical-only'
    `).get()).toEqual({ credited_minor: 8000, net_due_minor: 0 });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM canonical_outbox_events WHERE event_type='canonical.credit_note.posted'`)).toBe(1);
    expect(harness.sqlite.prepare(`
      SELECT source_type, source_public_id, source_table, mapping_status
      FROM canonical_source_mappings
      WHERE tenant_id='tenant-a' AND entity_type='credit_note'
    `).get()).toEqual({
      source_type: 'receivable_write_off',
      source_public_id: String(request.approvalId),
      source_table: 'approval_requests',
      mapping_status: 'mapped',
    });
    expect(harness.sqlite.prepare(`SELECT status FROM collection_cases WHERE id=?`).get(request.collectionCaseId))
      .toEqual({ status: 'closed' });
  });

  it('completes an in-flight legacy-source request after canonical cutover and legacy retirement', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    seedCanonicalInvoice(harness.sqlite, { legacyBillId: 77 });
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness, { amountMinor: 3000 });
    await fullyApprove(harness, request.approvalId);

    setReceivableMode(harness.sqlite, 'canonical');
    harness.sqlite.exec(`
      DROP TABLE patients;
      DROP TABLE bills;
      DROP TABLE billing_credit_notes;
      DROP TABLE income;
      DROP TABLE diagnostic_performer_reserves;
      DROP TABLE doctor_commission_accruals;
    `);

    await expect(executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'Complete the approved in-flight request through the mapped canonical invoice.',
    })).resolves.toMatchObject({
      newDueMinor: 5000,
      currencyCode: 'BDT',
      collectionStatus: 'contact_due',
    });

    expect(harness.sqlite.prepare(`
      SELECT credited_minor, net_due_minor FROM canonical_invoices
      WHERE tenant_id='tenant-a' AND invoice_public_id='inv-public-77'
    `).get()).toEqual({ credited_minor: 3000, net_due_minor: 5000 });
    expect(harness.sqlite.prepare(`SELECT status FROM collection_cases WHERE id=?`).get(request.collectionCaseId))
      .toEqual({ status: 'contact_due' });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(1);
  });

  it('prevents a second executor from taking an active execution lock', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness);
    await fullyApprove(harness, request.approvalId);
    harness.sqlite.prepare(`
      UPDATE approval_requests
      SET execution_status='processing', locked_by=99, locked_at=datetime('now', '+6 hours')
      WHERE id=?
    `).run(request.approvalId);

    await expect(executeReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'A concurrent executor already owns this approval lock.',
    })).rejects.toThrow(/already.*processing|lock/i);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
  });

  it('recovers idempotently when collection finalization fails after financial execution', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness);
    await fullyApprove(harness, request.approvalId);
    harness.sqlite.exec(`
      CREATE TRIGGER fail_write_off_execution_event
      BEFORE INSERT ON collection_case_events
      WHEN NEW.event_type='write_off_executed'
      BEGIN
        SELECT RAISE(ABORT, 'forced write-off finalization failure');
      END;
    `);
    const input = {
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 22,
      reviewNotes: 'Retry finalization without duplicating the financial adjustment.',
    };

    await expect(executeReceivableWriteOffApproval(input)).rejects.toThrow(/forced write-off finalization failure/i);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
    expect(harness.sqlite.prepare(`SELECT execution_status FROM approval_requests WHERE id=?`).get(request.approvalId))
      .toEqual({ execution_status: 'failed' });
    expect(harness.sqlite.prepare(`SELECT status FROM collection_cases WHERE id=?`).get(request.collectionCaseId))
      .toEqual({ status: 'write_off_requested' });

    harness.sqlite.exec('DROP TRIGGER fail_write_off_execution_event;');
    await expect(executeReceivableWriteOffApproval({
      ...input,
      approverId: 23,
      reviewNotes: 'A different authorised reviewer safely resumes the failed finalization.',
    })).resolves.toMatchObject({ newDueMinor: 5000 });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM collection_case_events WHERE event_type='write_off_executed'`)).toBe(1);
  });
});

describe('receivable write-off rejection', () => {
  it('requires independent review notes, restores the previous collection state, and creates no financial mutation', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    harness.sqlite.prepare(`
      INSERT INTO collection_cases (
        tenant_id, source_type, legacy_bill_id, status, assigned_to,
        next_followup_at_utc, promise_date, promise_amount_minor,
        currency_code, latest_note, last_contacted_at_utc,
        created_at_utc, updated_at_utc
      ) VALUES (
        'tenant-a', 'invoice', 77, 'promised', 31,
        '2026-07-30T06:00:00.000Z', '2026-07-31', 4000,
        'BDT', 'Existing promise.', '2026-07-22T05:00:00.000Z',
        '2026-07-22T05:00:00.000Z', '2026-07-22T05:00:00.000Z'
      )
    `).run();
    const request = await createRequest(harness);

    await expect(rejectReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 21,
      reviewNotes: 'short',
    })).rejects.toThrow(/review notes/i);
    await expect(rejectReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 14,
      reviewNotes: 'Requester cannot reject their own controlled request.',
    })).rejects.toThrow(/requester.*own|self/i);

    const result = await rejectReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 21,
      reviewNotes: 'Rejected because recovery follow-up remains appropriate.',
    });
    expect(result).toEqual({ collectionStatus: 'promised' });
    expect(harness.sqlite.prepare(`
      SELECT status, assigned_to, next_followup_at_utc, promise_date,
             promise_amount_minor, currency_code, latest_note
      FROM collection_cases WHERE id=?
    `).get(request.collectionCaseId)).toEqual({
      status: 'promised',
      assigned_to: 31,
      next_followup_at_utc: '2026-07-30T06:00:00.000Z',
      promise_date: '2026-07-31',
      promise_amount_minor: 4000,
      currency_code: 'BDT',
      latest_note: 'Existing promise.',
    });
    expect(harness.sqlite.prepare(`
      SELECT status, reviewed_by, execution_status FROM approval_requests WHERE id=?
    `).get(request.approvalId)).toEqual({
      status: 'rejected',
      reviewed_by: 21,
      execution_status: 'not_required',
    });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM canonical_credit_notes')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_mutation_idempotency_keys')).toBe(0);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM approval_events WHERE action='rejected'`)).toBe(1);
    expect(scalar(harness.sqlite, `SELECT COUNT(*) value FROM collection_case_events WHERE event_type='write_off_rejected'`)).toBe(1);
  });

  it('closes the collection case instead of restoring stale workflow when the source becomes terminal', async () => {
    const harness = createExecutionHarness();
    seedLegacyBill(harness.sqlite);
    setReceivableMode(harness.sqlite, 'legacy');
    const request = await createRequest(harness);
    harness.sqlite.prepare(`
      UPDATE bills SET status='cancelled' WHERE tenant_id='tenant-a' AND id=77
    `).run();

    const result = await rejectReceivableWriteOffApproval({
      db: harness.db,
      tenantId: 'tenant-a',
      approvalId: request.approvalId,
      approverId: 21,
      reviewNotes: 'Rejected and reconciled because the source is now terminal.',
    });

    expect(result).toEqual({ collectionStatus: 'closed' });
    expect(harness.sqlite.prepare(`
      SELECT status, closed_at_utc FROM collection_cases WHERE id=?
    `).get(request.collectionCaseId)).toMatchObject({ status: 'closed', closed_at_utc: expect.any(String) });
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
  });
});

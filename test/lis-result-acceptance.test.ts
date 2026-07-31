import { describe, expect, it } from 'vitest';
import {
  acceptStagedLisResult,
  LisAcceptanceError,
} from '../src/services/lis-result-acceptance';
import { createMockDB } from './integration/helpers/mock-db';

const baseInbox = {
  id: 80,
  tenant_id: 'tenant-1',
  state_version: 1,
  disposition: 'review_required',
  match_state: 'exact',
  qc_state: 'pass',
  validation_state: 'pass',
  ingestion_status: 'completed',
  lab_order_item_id: 10,
  lab_order_id: 20,
  patient_id: 40,
  specimen_id: 30,
  lab_test_id: 7,
  component_id: null,
  normalized_value: '14.2',
  normalized_numeric: 14.2,
  normalized_units: 'g/dL',
  selected_reference_range: '12-16',
  normalized_interpretation: 'normal',
  critical_flag: 0,
  normalized_result_status: 'final',
  machine_id: 1,
  machine_result_log_id: 99,
  machine_test_code: 'HGB',
  machine_test_name: 'Hemoglobin',
  staged_by: 9,
  supersedes_inbox_id: null,
  supersession_reason: null,
  applied_retraction_request_id: null,
  latest_report_id: null,
  latest_report_status: null,
  latest_report_version: null,
  existing_result: null,
  existing_result_status: null,
};

function createAcceptanceDb(
  inbox: Record<string, unknown> | null = baseInbox,
  options: { batchError?: Error | string; guardChanges?: number } = {},
) {
  return createMockDB({
    batchError: options.batchError,
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lis_analyzer_inbox') && lower.includes('join lab_order_items')) {
        return { first: inbox };
      }
      if (lower.includes('insert into lis_result_acceptance_commands')) {
        return { meta: { changes: options.guardChanges ?? 1, last_row_id: 501 } };
      }
      if (lower.includes('insert into lab_results')) {
        return { meta: { changes: 1, last_row_id: 601 } };
      }
      return null;
    },
  });
}

function acceptInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    inboxId: 80,
    expectedVersion: 1,
    reviewerUserId: 15,
    reviewerRole: 'pathologist',
    ...overrides,
  } as any;
}

describe('LIS staged result acceptance', () => {
  it('rejects callers outside laboratory governance roles before any batch write', async () => {
    const mock = createAcceptanceDb();

    await expect(acceptStagedLisResult(mock.db, acceptInput({ reviewerRole: 'lab_tech' })))
      .rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('rejects a stale inbox version before canonical writes', async () => {
    const mock = createAcceptanceDb({ ...baseInbox, state_version: 2 });

    await expect(acceptStagedLisResult(mock.db, acceptInput()))
      .rejects.toMatchObject({ code: 'stale_version', status: 409 });
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('enforces separation of duty between staging and acceptance', async () => {
    const mock = createAcceptanceDb();

    await expect(acceptStagedLisResult(mock.db, acceptInput({ reviewerUserId: 9 })))
      .rejects.toMatchObject({ code: 'self_approval_forbidden', status: 409 });
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('rejects observations from an ingestion message that did not finish staging', async () => {
    const mock = createAcceptanceDb({ ...baseInbox, ingestion_status: 'error' });

    await expect(acceptStagedLisResult(mock.db, acceptInput()))
      .rejects.toMatchObject({ code: 'ingestion_not_complete', status: 409 });
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('rejects non-exact, QC-blocked, or validation-blocked observations', async () => {
    for (const inbox of [
      { ...baseInbox, match_state: 'ambiguous' },
      { ...baseInbox, qc_state: 'config_missing', disposition: 'qc_blocked' },
      { ...baseInbox, validation_state: 'fail', disposition: 'validation_blocked' },
    ]) {
      const mock = createAcceptanceDb(inbox);
      await expect(acceptStagedLisResult(mock.db, acceptInput()))
        .rejects.toBeInstanceOf(LisAcceptanceError);
      expect(mock.batchCalls).toHaveLength(0);
    }
  });

  it('commits canonical result, audit, workflow and inbox transition in one D1 batch', async () => {
    const mock = createAcceptanceDb();

    const result = await acceptStagedLisResult(mock.db, acceptInput());

    expect(result).toMatchObject({
      accepted: true,
      inboxId: 80,
      labOrderItemId: 10,
      labOrderId: 20,
      corrected: false,
      critical: false,
    });
    expect(mock.batchCalls).toHaveLength(1);
    const batch = mock.batchCalls[0].join('\n').toLowerCase();
    expect(batch).toContain('insert into lis_result_acceptance_commands');
    expect(batch).toContain('insert or ignore into lab_reports');
    expect(batch).toContain('update lab_order_items');
    expect(batch).toContain('insert into lab_results');
    expect(batch).toContain('insert into lab_observation_audit');
    expect(batch).toContain('update lis_analyzer_inbox');
    expect(batch).toContain('update lab_orders');
    expect(batch).not.toContain("report_status = 'published'");
    expect(batch).not.toContain('insert into lis_critical_event_outbox');
  });

  it('creates a durable critical communication outbox record inside the same batch', async () => {
    const mock = createAcceptanceDb({
      ...baseInbox,
      normalized_value: '2.4',
      normalized_numeric: 2.4,
      normalized_interpretation: 'critical',
      critical_flag: 1,
    });

    const result = await acceptStagedLisResult(mock.db, acceptInput());

    expect(result.critical).toBe(true);
    expect(mock.batchCalls).toHaveLength(1);
    expect(mock.batchCalls[0].join('\n').toLowerCase()).toContain('insert into lis_critical_event_outbox');
  });

  it('preserves correction provenance rather than destructively replacing history', async () => {
    const mock = createAcceptanceDb({
      ...baseInbox,
      normalized_value: '15.1',
      normalized_numeric: 15.1,
      normalized_result_status: 'corrected',
      existing_result: '14.2',
      existing_result_status: 'final',
    });

    const result = await acceptStagedLisResult(mock.db, acceptInput());

    expect(result.corrected).toBe(true);
    const batch = mock.batchCalls[0].join('\n').toLowerCase();
    expect(batch).toContain('supersedes_observation_id');
    expect(batch).toContain('correction_reason');
  });

  it('treats a superseding review as a correction even when the clinical value is unchanged', async () => {
    const mock = createAcceptanceDb({
      ...baseInbox,
      supersedes_inbox_id: 79,
      supersession_reason: 'Correct order linkage after clinical review.',
      existing_result: '14.2',
      existing_result_status: 'final',
    });

    const result = await acceptStagedLisResult(mock.db, acceptInput());

    expect(result.corrected).toBe(true);
    const auditInsert = mock.queries.find(query => query.sql.includes('INSERT INTO lab_observation_audit'));
    expect(auditInsert?.params).toContain('Correct order linkage after clinical review.');
    const resultInsert = mock.queries.find(query => query.sql.includes('INSERT INTO lab_results'));
    expect(resultInsert?.params).toContain('Accepted superseding analyzer review from inbox #80');
  });

  it('creates a versioned amended report after applied retraction and never inserts into the withdrawn report', async () => {
    const mock = createAcceptanceDb({
      ...baseInbox,
      supersedes_inbox_id: 79,
      supersession_reason: 'Correct order linkage after formal result retraction.',
      applied_retraction_request_id: 701,
      latest_report_id: 501,
      latest_report_status: 'retracted',
      latest_report_version: 1,
      existing_result: null,
      existing_result_status: 'retracted',
    });

    await expect(acceptStagedLisResult(mock.db, acceptInput())).resolves.toMatchObject({
      accepted: true,
      corrected: true,
    });

    const reportInsert = mock.queries.find(query => query.sql.includes('INSERT OR IGNORE INTO lab_reports'));
    expect(reportInsert?.sql).toContain('report_version');
    expect(reportInsert?.sql).toContain('supersedes_report_id');
    expect(reportInsert?.sql).toContain('amendment_reason');
    expect(reportInsert?.params).toContain(2);
    expect(reportInsert?.params).toContain(501);
    expect(reportInsert?.params).toContain('Correct order linkage after formal result retraction.');

    const resultInsert = mock.queries.find(query => query.sql.includes('INSERT INTO lab_results'));
    expect(resultInsert?.sql).toContain("report.report_status <> 'retracted'");
    expect(resultInsert?.sql).toContain('COALESCE(report.report_version, 1) DESC');

    const inboxUpdate = mock.queries.find(query => query.sql.includes("SET disposition = 'accepted'"));
    expect(inboxUpdate?.sql).toContain('accepted_result.lis_analyzer_inbox_id = ?');
  });

  it('blocks amendment acceptance when a withdrawn report has no applied retraction lineage', async () => {
    const mock = createAcceptanceDb({
      ...baseInbox,
      supersedes_inbox_id: 79,
      supersession_reason: 'Corrected analyzer review.',
      applied_retraction_request_id: null,
      latest_report_id: 501,
      latest_report_status: 'retracted',
      latest_report_version: 1,
    });

    await expect(acceptStagedLisResult(mock.db, acceptInput()))
      .rejects.toMatchObject({ code: 'retracted_report_amendment_required', status: 409 });
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('does not perform follow-up writes when the atomic D1 batch fails', async () => {
    const mock = createAcceptanceDb(baseInbox, { batchError: 'simulated atomic failure' });

    await expect(acceptStagedLisResult(mock.db, acceptInput()))
      .rejects.toThrow('simulated atomic failure');
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('returns a conflict when the conditional acceptance command cannot claim the inbox', async () => {
    const mock = createAcceptanceDb(baseInbox, { guardChanges: 0 });

    await expect(acceptStagedLisResult(mock.db, acceptInput()))
      .rejects.toMatchObject({ code: 'acceptance_conflict', status: 409 });
    expect(mock.batchCalls).toHaveLength(1);
  });
});

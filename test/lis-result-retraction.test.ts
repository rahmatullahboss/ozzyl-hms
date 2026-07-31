import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import {
  approveLisResultRetraction,
  canManageLisResultRetraction,
  rejectLisResultRetraction,
  requestLisResultRetraction,
} from '../src/services/lis-result-retraction';

const acceptedResult = {
  inbox_id: 80,
  inbox_state_version: 2,
  inbox_disposition: 'accepted',
  accepted_by: 9,
  canonical_lab_result_id: 601,
  lab_result_id: 601,
  lab_result_status: 'final',
  lab_report_id: 501,
  lab_report_status: 'published',
  lab_order_item_id: 10,
  lab_order_id: 20,
  patient_id: 40,
  existing_open_request_id: null,
};

const requestedRetraction = {
  id: 701,
  tenant_id: 'tenant-1',
  lis_analyzer_inbox_id: 80,
  lab_result_id: 601,
  lab_report_id: 501,
  lab_order_item_id: 10,
  lab_order_id: 20,
  patient_id: 40,
  requested_by: 15,
  requester_role: 'pathologist',
  reason_code: 'wrong_order',
  reason: 'Result was published against the wrong laboratory order.',
  notes: null,
  status: 'requested',
  state_version: 1,
};

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    inboxId: 80,
    expectedInboxVersion: 2,
    requestedBy: 15,
    requesterRole: 'pathologist',
    reasonCode: 'wrong_order',
    reason: 'Result was published against the wrong laboratory order.',
    notes: undefined,
    ...overrides,
  } as any;
}

function approvalInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    requestId: 701,
    expectedVersion: 1,
    reviewedBy: 16,
    reviewerRole: 'lab_supervisor',
    reviewNotes: 'Verified against analyzer source and the patient order.',
    ...overrides,
  } as any;
}

function retractionDb(options: {
  accepted?: Record<string, unknown> | null;
  request?: Record<string, unknown> | null;
  finalRequest?: Record<string, unknown> | null;
  batchError?: Error | string;
} = {}) {
  const accepted = options.accepted === undefined ? acceptedResult : options.accepted;
  const request = options.request === undefined ? requestedRetraction : options.request;
  const finalRequest = options.finalRequest === undefined
    ? { ...requestedRetraction, status: 'applied', state_version: 2, reviewed_by: 16 }
    : options.finalRequest;

  return createMockDB({
    batchError: options.batchError,
    queryOverride(sql) {
      if (sql.includes('existing_open_request_id')) return { first: accepted };
      if (sql.includes('FROM lis_result_retraction_requests request') && sql.includes('WHERE request.id = ?')) {
        if (sql.includes('request.status AS request_status')) return { first: request };
        return { first: finalRequest };
      }
      if (sql.includes('INSERT INTO lis_result_retraction_requests')) {
        return { success: true, meta: { changes: 1, last_row_id: 701 } };
      }
      if (sql.includes('UPDATE lis_result_retraction_requests')) {
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE lab_results')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('UPDATE lab_order_items')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('UPDATE lab_reports')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('INSERT INTO lab_observation_audit')) {
        return { success: true, meta: { changes: 1, last_row_id: 801 } };
      }
      if (sql.includes('INSERT INTO lis_result_retraction_notification_outbox')) {
        return { success: true, meta: { changes: 1, last_row_id: 901 } };
      }
      return null;
    },
  });
}

describe('LIS accepted-result retraction service', () => {
  it('limits retraction governance to accountable clinical roles', () => {
    expect(canManageLisResultRetraction('pathologist')).toBe(true);
    expect(canManageLisResultRetraction('lab-supervisor')).toBe(true);
    expect(canManageLisResultRetraction('hospital_admin')).toBe(true);
    expect(canManageLisResultRetraction('md')).toBe(true);
    expect(canManageLisResultRetraction('lab_tech')).toBe(false);
  });

  it('rejects unauthorized or incomplete requests before reading clinical evidence', async () => {
    const unauthorized = retractionDb();
    await expect(requestLisResultRetraction(unauthorized.db, requestInput({ requesterRole: 'lab_tech' })))
      .rejects.toMatchObject({ code: 'retraction_forbidden', status: 403 });
    expect(unauthorized.queries).toHaveLength(0);

    const invalidReason = retractionDb();
    await expect(requestLisResultRetraction(invalidReason.db, requestInput({ reason: 'wrong' })))
      .rejects.toMatchObject({ code: 'invalid_retraction_reason', status: 400 });
    expect(invalidReason.queries).toHaveLength(0);
  });

  it('requires a current accepted inbox row with an active canonical result', async () => {
    await expect(requestLisResultRetraction(retractionDb({ accepted: null }).db, requestInput()))
      .rejects.toMatchObject({ code: 'accepted_result_not_found', status: 404 });

    await expect(requestLisResultRetraction(
      retractionDb({ accepted: { ...acceptedResult, inbox_state_version: 3 } }).db,
      requestInput(),
    )).rejects.toMatchObject({ code: 'retraction_conflict', status: 409 });

    await expect(requestLisResultRetraction(
      retractionDb({ accepted: { ...acceptedResult, inbox_disposition: 'rejected' } }).db,
      requestInput(),
    )).rejects.toMatchObject({ code: 'result_not_accepted', status: 409 });

    await expect(requestLisResultRetraction(
      retractionDb({ accepted: { ...acceptedResult, lab_result_status: 'retracted' } }).db,
      requestInput(),
    )).rejects.toMatchObject({ code: 'result_already_retracted', status: 409 });
  });

  it('prevents more than one open retraction request for the same accepted evidence', async () => {
    const mock = retractionDb({ accepted: { ...acceptedResult, existing_open_request_id: 700 } });

    await expect(requestLisResultRetraction(mock.db, requestInput()))
      .rejects.toMatchObject({ code: 'open_retraction_exists', status: 409 });
  });

  it('creates an immutable optimistic retraction request without changing the result', async () => {
    const mock = retractionDb({
      finalRequest: { ...requestedRetraction, status: 'requested', state_version: 1 },
    });

    await expect(requestLisResultRetraction(mock.db, requestInput())).resolves.toEqual({
      requested: true,
      requestId: 701,
      inboxId: 80,
      stateVersion: 1,
      status: 'requested',
    });

    expect(mock.batchCalls).toHaveLength(1);
    expect(mock.batchCalls[0]).toHaveLength(1);
    expect(mock.batchCalls[0][0]).toContain('INSERT OR IGNORE INTO lis_result_retraction_requests');
    expect(mock.queries.some(query => query.sql.includes('UPDATE lab_results'))).toBe(false);
  });

  it('enforces second-person approval and optimistic request versioning', async () => {
    await expect(approveLisResultRetraction(retractionDb().db, approvalInput({ reviewedBy: 15 })))
      .rejects.toMatchObject({ code: 'self_approval_forbidden', status: 409 });

    await expect(approveLisResultRetraction(
      retractionDb({ request: { ...requestedRetraction, state_version: 2 } }).db,
      approvalInput(),
    )).rejects.toMatchObject({ code: 'retraction_conflict', status: 409 });
  });

  it('atomically retracts canonical result/report, records audit, and creates notification outbox', async () => {
    const mock = retractionDb();

    await expect(approveLisResultRetraction(mock.db, approvalInput())).resolves.toEqual({
      applied: true,
      requestId: 701,
      inboxId: 80,
      labResultId: 601,
      labReportId: 501,
      nextVersion: 2,
    });

    expect(mock.batchCalls).toHaveLength(1);
    const batch = mock.batchCalls[0].join('\n');
    expect(batch).toContain("status = 'applying'");
    expect(batch).toContain("status = 'rejected'");
    expect(batch).toContain("result_status = 'retracted'");
    expect(batch).toContain("report_status = 'retracted'");
    expect(batch).toContain('INSERT INTO lab_observation_audit');
    expect(batch).toContain('INSERT INTO lis_result_retraction_notification_outbox');
    expect(batch).toContain("status = 'applied'");
  });

  it('rolls back the full retraction when a later batch statement fails', async () => {
    const mock = retractionDb({ batchError: 'simulated retraction failure' });

    await expect(approveLisResultRetraction(mock.db, approvalInput()))
      .rejects.toThrow('simulated retraction failure');
  });

  it('allows a different governance reviewer to reject a pending request with a reason', async () => {
    const mock = retractionDb({
      finalRequest: { ...requestedRetraction, status: 'rejected', state_version: 2, reviewed_by: 16 },
    });

    await expect(rejectLisResultRetraction(mock.db, {
      ...approvalInput(),
      reviewNotes: 'Analyzer evidence and the published order are correct.',
    })).resolves.toEqual({
      rejected: true,
      requestId: 701,
      nextVersion: 2,
    });

    expect(mock.batchCalls).toHaveLength(1);
    expect(mock.batchCalls[0][0]).toContain("status = 'rejected'");
    expect(mock.queries.some(query => query.sql.includes('UPDATE lab_results'))).toBe(false);
  });
});

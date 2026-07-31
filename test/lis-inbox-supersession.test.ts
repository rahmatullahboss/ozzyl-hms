import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import {
  createLisInboxSupersession,
  LisInboxSupersessionError,
} from '../src/services/lis-inbox-supersession';

const source = {
  id: 80,
  tenant_id: 'tenant-1',
  ingestion_message_id: 70,
  observation_index: 0,
  order_group_index: 0,
  machine_id: 1,
  bridge_agent_id: null,
  machine_result_log_id: 99,
  identifier_type: 'barcode',
  identifier_value: 'BC-100',
  machine_test_code: 'HGB',
  machine_test_name: 'Hemoglobin',
  analyzer_observation_id: 'OBX-1',
  lab_order_item_id: 10,
  patient_id: 40,
  specimen_id: 30,
  lab_test_id: 7,
  component_id: null,
  candidate_metadata_json: '{"candidateCount":1}',
  raw_value: '14.2',
  raw_units: 'g/dL',
  raw_reference_range: '12-16',
  normalized_value: '14.2',
  normalized_numeric: 14.2,
  normalized_units: 'g/dL',
  selected_reference_range: '12-16',
  conversion_rule: null,
  conversion_factor: null,
  analyzer_result_status: 'F',
  normalized_result_status: 'final',
  analyzer_abnormal_flag: 'N',
  normalized_interpretation: 'normal',
  critical_flag: 0,
  match_state: 'exact',
  qc_state: 'pass',
  validation_state: 'pass',
  disposition: 'rejected',
  disposition_reason: 'Wrong order',
  state_version: 2,
  source_payload_json: '{"observationIndex":0}',
  validation_details_json: '{"warnings":[]}',
  qc_details_json: '{"latestStatus":"passed"}',
  staged_by: 9,
  successor_id: null,
  applied_retraction_request_id: null,
};

const target = {
  id: 11,
  tenant_id: 'tenant-1',
  lab_order_id: 21,
  lab_test_id: 7,
  specimen_id: 31,
  status: 'processing',
  result_status: null,
  patient_id: 40,
  order_no: 'ORD-21',
  test_name: 'Hemoglobin',
  test_code: 'HGB',
};

function input(overrides: Partial<Parameters<typeof createLisInboxSupersession>[1]> = {}) {
  return {
    tenantId: 'tenant-1',
    sourceInboxId: 80,
    expectedVersion: 2,
    targetLabOrderItemId: 11,
    requestedBy: 15,
    requesterRole: 'pathologist',
    reason: 'The analyzer observation belongs to order ORD-21.',
    ...overrides,
  };
}

function supersessionDb(options: {
  source?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  successor?: Record<string, unknown> | null;
  batchError?: Error;
} = {}) {
  const sourceRow = options.source === undefined ? source : options.source;
  const targetRow = options.target === undefined ? target : options.target;
  const successorRow = options.successor === undefined
    ? { id: 81, state_version: 1, disposition: 'review_required' }
    : options.successor;

  return createMockDB({
    batchError: options.batchError,
    queryOverride(sql) {
      if (sql.includes('successor.id AS successor_id')) return { first: sourceRow };
      if (sql.includes('FROM lab_order_items target_item')) return { first: targetRow };
      if (sql.includes('WHERE successor.supersedes_inbox_id = ?')) return { first: successorRow };
      if (sql.includes('INSERT OR IGNORE INTO lis_inbox_supersession_commands')) {
        return { success: true, meta: { changes: 1, last_row_id: 501 } };
      }
      if (sql.includes('INSERT INTO lis_analyzer_inbox')) {
        return { success: true, meta: { changes: 1, last_row_id: 81 } };
      }
      if (sql.includes('UPDATE lis_analyzer_inbox')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('UPDATE lis_inbox_supersession_commands')) return { success: true, meta: { changes: 1 } };
      return null;
    },
  });
}

describe('LIS analyzer inbox supersession service', () => {
  it('allows only pathologists and laboratory supervisors to create clinical supersessions', async () => {
    const mock = supersessionDb();

    await expect(createLisInboxSupersession(mock.db, input({ requesterRole: 'hospital_admin' })))
      .rejects.toMatchObject({ code: 'supersession_forbidden', status: 403 });
    expect(mock.queries).toHaveLength(0);
  });

  it('requires a meaningful reason before reading clinical evidence', async () => {
    const mock = supersessionDb();

    await expect(createLisInboxSupersession(mock.db, input({ reason: 'wrong' })))
      .rejects.toMatchObject({ code: 'invalid_supersession_reason', status: 400 });
    expect(mock.queries).toHaveLength(0);
  });

  it('rejects missing, stale, or already-superseded source evidence', async () => {
    await expect(createLisInboxSupersession(supersessionDb({ source: null }).db, input()))
      .rejects.toMatchObject({ code: 'source_not_found', status: 404 });

    await expect(createLisInboxSupersession(
      supersessionDb({ source: { ...source, state_version: 3 } }).db,
      input(),
    )).rejects.toMatchObject({ code: 'supersession_conflict', status: 409 });

    await expect(createLisInboxSupersession(
      supersessionDb({ source: { ...source, successor_id: 90 } }).db,
      input(),
    )).rejects.toMatchObject({ code: 'supersession_exists', status: 409 });
  });

  it('rejects unavailable or incompatible target order items', async () => {
    await expect(createLisInboxSupersession(supersessionDb({ target: null }).db, input()))
      .rejects.toMatchObject({ code: 'target_not_found', status: 404 });

    await expect(createLisInboxSupersession(
      supersessionDb({ target: { ...target, status: 'cancelled' } }).db,
      input(),
    )).rejects.toMatchObject({ code: 'target_not_reviewable', status: 409 });

    await expect(createLisInboxSupersession(
      supersessionDb({ target: { ...target, lab_test_id: 99 } }).db,
      input(),
    )).rejects.toMatchObject({ code: 'target_test_mismatch', status: 409 });
  });

  it('does not rematch an already accepted result to another order item without an applied retraction', async () => {
    const accepted = { ...source, disposition: 'accepted' };

    await expect(createLisInboxSupersession(supersessionDb({ source: accepted }).db, input()))
      .rejects.toMatchObject({ code: 'accepted_result_retraction_required', status: 409 });

    await expect(createLisInboxSupersession(
      supersessionDb({ source: { ...accepted, lab_order_item_id: 11 } }).db,
      input(),
    )).resolves.toMatchObject({ created: true, inboxId: 81 });

    await expect(createLisInboxSupersession(
      supersessionDb({ source: { ...accepted, applied_retraction_request_id: 701 } }).db,
      input(),
    )).resolves.toMatchObject({ created: true, inboxId: 81 });

    await expect(createLisInboxSupersession(
      supersessionDb({
        source: { ...accepted, applied_retraction_request_id: 701 },
        target: {
          ...target,
          id: 10,
          lab_order_id: 20,
          specimen_id: 30,
          status: 'rejected',
          result_status: 'retracted',
        },
      }).db,
      input({ targetLabOrderItemId: 10 }),
    )).resolves.toMatchObject({ created: true, inboxId: 81 });
  });

  it('requires explicit QC and validation override reasons when the original gates cannot be reused', async () => {
    await expect(createLisInboxSupersession(
      supersessionDb({ source: { ...source, qc_state: 'fail' } }).db,
      input(),
    )).rejects.toMatchObject({ code: 'qc_override_required', status: 409 });

    await expect(createLisInboxSupersession(
      supersessionDb({ source: { ...source, validation_state: 'fail' } }).db,
      input(),
    )).rejects.toMatchObject({ code: 'validation_override_required', status: 409 });

    await expect(createLisInboxSupersession(
      supersessionDb({ target: { ...target, patient_id: 41 } }).db,
      input(),
    )).rejects.toMatchObject({ code: 'validation_override_required', status: 409 });
  });

  it('atomically creates one immutable successor and supersedes a nonterminal source', async () => {
    const mock = supersessionDb({
      source: { ...source, disposition: 'qc_blocked', qc_state: 'fail' },
    });

    await expect(createLisInboxSupersession(mock.db, input({
      qcOverrideReason: 'Supervisor reviewed the control run and approved a documented exception.',
    }))).resolves.toEqual({
      created: true,
      sourceInboxId: 80,
      inboxId: 81,
      stateVersion: 1,
      disposition: 'review_required',
    });

    expect(mock.batchCalls).toHaveLength(1);
    expect(mock.batchCalls[0]).toHaveLength(4);
    expect(mock.batchCalls[0][0]).toContain('INSERT OR IGNORE INTO lis_inbox_supersession_commands');
    expect(mock.batchCalls[0][1]).toContain('INSERT INTO lis_analyzer_inbox');
    expect(mock.batchCalls[0][1]).not.toContain('INSERT OR IGNORE INTO lis_analyzer_inbox');
    expect(mock.batchCalls[0][1]).toContain('command.target_lab_order_item_id = target_item.id');
    expect(mock.batchCalls[0][1]).toContain("COALESCE(target_item.status, 'pending') NOT IN");
    expect(mock.batchCalls[0][2]).toContain("SET disposition = 'rejected'");
    expect(mock.batchCalls[0][2]).toContain('rejection_reason = ?');
    expect(mock.batchCalls[0][3]).toContain('UPDATE lis_inbox_supersession_commands');

    const cloneQuery = mock.queries.find(query => query.sql.includes('INSERT INTO lis_analyzer_inbox'));
    expect(cloneQuery?.sql).toContain('source.raw_value');
    expect(cloneQuery?.sql).toContain('command.requested_by, source.id, CURRENT_TIMESTAMP');
    expect(cloneQuery?.params).toContain('override');
    expect(cloneQuery?.sql).toContain("'review_required'");
  });

  it('preserves terminal source decisions while still creating a successor', async () => {
    const mock = supersessionDb({ source: { ...source, disposition: 'rejected' } });

    await createLisInboxSupersession(mock.db, input());

    const sourceUpdate = mock.queries.find(query => query.sql.includes('UPDATE lis_analyzer_inbox'));
    expect(sourceUpdate?.sql).toContain("disposition NOT IN ('accepted', 'rejected')");
  });

  it('propagates an atomic batch failure without returning a successor', async () => {
    const mock = supersessionDb({ batchError: new Error('simulated supersession batch failure') });

    await expect(createLisInboxSupersession(mock.db, input()))
      .rejects.toThrow('simulated supersession batch failure');
  });

  it('does not return another reviewer’s concurrent successor as this request’s success', async () => {
    const mock = supersessionDb({
      successor: {
        id: 81,
        state_version: 1,
        disposition: 'review_required',
        requested_by: 22,
        target_lab_order_item_id: 12,
      },
    });

    await expect(createLisInboxSupersession(mock.db, input()))
      .rejects.toMatchObject({ code: 'supersession_exists', status: 409 });
  });

  it('fails if the guarded batch did not produce a successor', async () => {
    const mock = supersessionDb({ successor: null });

    await expect(createLisInboxSupersession(mock.db, input()))
      .rejects.toBeInstanceOf(LisInboxSupersessionError);
    await expect(createLisInboxSupersession(mock.db, input()))
      .rejects.toMatchObject({ code: 'supersession_conflict', status: 409 });
  });
});

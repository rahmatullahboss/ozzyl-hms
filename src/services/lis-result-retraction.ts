const RETRACTION_ROLES = new Set(['pathologist', 'lab_supervisor', 'hospital_admin', 'md']);
const RETRACTION_REASON_CODES = new Set([
  'wrong_patient',
  'wrong_order',
  'wrong_specimen',
  'invalid_result',
  'duplicate_result',
  'analyzer_error',
  'other',
]);

export class LisResultRetractionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LisResultRetractionError';
  }
}

export interface RequestLisResultRetractionInput {
  tenantId: string | number;
  inboxId: number;
  expectedInboxVersion: number;
  requestedBy: string | number;
  requesterRole: string;
  reasonCode: string;
  reason: string;
  notes?: string | null;
}

export interface ReviewLisResultRetractionInput {
  tenantId: string | number;
  requestId: number;
  expectedVersion: number;
  reviewedBy: string | number;
  reviewerRole: string;
  reviewNotes: string;
}

interface AcceptedResultRow {
  inbox_id: number;
  inbox_state_version: number;
  inbox_disposition: string;
  accepted_by: number | null;
  canonical_lab_result_id: number | null;
  lab_result_id: number | null;
  lab_result_status: string | null;
  lab_report_id: number | null;
  lab_report_status: string | null;
  lab_order_item_id: number | null;
  lab_order_id: number | null;
  patient_id: number | null;
  existing_open_request_id: number | null;
}

interface RetractionRequestRow {
  id: number;
  tenant_id: string;
  lis_analyzer_inbox_id: number;
  lab_result_id: number;
  lab_report_id: number;
  lab_order_item_id: number;
  lab_order_id: number;
  patient_id: number | null;
  requested_by: number;
  requester_role: string;
  reason_code: string;
  reason: string;
  notes: string | null;
  status: string;
  request_status?: string;
  state_version: number;
  reviewed_by: number | null;
}

function normalizeRole(role: string): string {
  return String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function positiveInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LisResultRetractionError(`${label} must be a positive integer`, 'invalid_identifier', 400);
  }
  return parsed;
}

function requiredText(value: unknown, code: string, label: string, minLength = 10, maxLength = 1000): string {
  const text = String(value ?? '').trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new LisResultRetractionError(
      `${label} must be between ${minLength} and ${maxLength} characters`,
      code,
      400,
    );
  }
  return text;
}

function optionalText(value: unknown, code: string, label: string, maxLength = 2000): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new LisResultRetractionError(`${label} must be at most ${maxLength} characters`, code, 400);
  }
  return text;
}

function resultChanges(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
}

function lastRowId(result: unknown): number {
  return Number((result as { meta?: { last_row_id?: number } } | undefined)?.meta?.last_row_id ?? 0);
}

export function canManageLisResultRetraction(role: string): boolean {
  return RETRACTION_ROLES.has(normalizeRole(role));
}

async function loadRetractionRequest(
  db: D1Database,
  tenantId: string | number,
  requestId: number,
  includeRequestStatusAlias = false,
): Promise<RetractionRequestRow | null> {
  return db.prepare(`
    SELECT
      request.*${includeRequestStatusAlias ? ', request.status AS request_status' : ''}
    FROM lis_result_retraction_requests request
    WHERE request.id = ? AND request.tenant_id = ?
  `).bind(requestId, tenantId).first<RetractionRequestRow>();
}

export async function requestLisResultRetraction(
  db: D1Database,
  input: RequestLisResultRetractionInput,
): Promise<{ requested: true; requestId: number; inboxId: number; stateVersion: number; status: string }> {
  if (!canManageLisResultRetraction(input.requesterRole)) {
    throw new LisResultRetractionError(
      'Only laboratory governance roles may request result retraction',
      'retraction_forbidden',
      403,
    );
  }

  const inboxId = positiveInteger(input.inboxId, 'inboxId');
  const expectedInboxVersion = positiveInteger(input.expectedInboxVersion, 'expectedInboxVersion');
  const requestedBy = positiveInteger(input.requestedBy, 'requestedBy');
  const reasonCode = String(input.reasonCode ?? '').trim().toLowerCase();
  if (!RETRACTION_REASON_CODES.has(reasonCode)) {
    throw new LisResultRetractionError('Invalid retraction reason code', 'invalid_retraction_reason_code', 400);
  }
  const reason = requiredText(input.reason, 'invalid_retraction_reason', 'Retraction reason', 10, 500);
  const notes = optionalText(input.notes, 'invalid_retraction_notes', 'Retraction notes');

  const accepted = await db.prepare(`
    SELECT
      inbox.id AS inbox_id,
      inbox.state_version AS inbox_state_version,
      inbox.disposition AS inbox_disposition,
      inbox.accepted_by,
      inbox.canonical_lab_result_id,
      result.id AS lab_result_id,
      result.result_status AS lab_result_status,
      report.id AS lab_report_id,
      report.report_status AS lab_report_status,
      inbox.lab_order_item_id,
      item.lab_order_id,
      lab_order.patient_id,
      (
        SELECT request.id
        FROM lis_result_retraction_requests request
        WHERE request.tenant_id = inbox.tenant_id
          AND request.lis_analyzer_inbox_id = inbox.id
          AND request.status IN ('requested', 'applying')
        ORDER BY request.id DESC
        LIMIT 1
      ) AS existing_open_request_id
    FROM lis_analyzer_inbox inbox
    LEFT JOIN lab_results result
      ON result.id = inbox.canonical_lab_result_id
     AND result.tenant_id = inbox.tenant_id
    LEFT JOIN lab_reports report
      ON report.id = result.lab_report_id
     AND report.tenant_id = inbox.tenant_id
    LEFT JOIN lab_order_items item
      ON item.id = inbox.lab_order_item_id
     AND item.tenant_id = inbox.tenant_id
    LEFT JOIN lab_orders lab_order
      ON lab_order.id = item.lab_order_id
     AND lab_order.tenant_id = inbox.tenant_id
    WHERE inbox.id = ? AND inbox.tenant_id = ?
  `).bind(inboxId, input.tenantId).first<AcceptedResultRow>();

  if (!accepted || accepted.lab_result_id == null || accepted.lab_report_id == null) {
    throw new LisResultRetractionError('Accepted analyzer result not found', 'accepted_result_not_found', 404);
  }
  if (Number(accepted.inbox_state_version) !== expectedInboxVersion) {
    throw new LisResultRetractionError(
      'Accepted analyzer evidence changed; refresh before requesting retraction',
      'retraction_conflict',
      409,
    );
  }
  if (String(accepted.inbox_disposition) !== 'accepted') {
    throw new LisResultRetractionError('Only accepted analyzer evidence can be retracted', 'result_not_accepted', 409);
  }
  if (String(accepted.lab_result_status) === 'retracted') {
    throw new LisResultRetractionError('The laboratory result is already retracted', 'result_already_retracted', 409);
  }
  if (accepted.existing_open_request_id != null) {
    throw new LisResultRetractionError(
      'An open retraction request already exists for this analyzer result',
      'open_retraction_exists',
      409,
    );
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO lis_result_retraction_requests (
      tenant_id,
      lis_analyzer_inbox_id,
      lab_result_id,
      lab_report_id,
      lab_order_item_id,
      lab_order_id,
      patient_id,
      expected_inbox_version,
      requested_by,
      requester_role,
      reason_code,
      reason,
      notes,
      status,
      state_version,
      created_at,
      updated_at
    )
    SELECT
      inbox.tenant_id,
      inbox.id,
      result.id,
      report.id,
      inbox.lab_order_item_id,
      item.lab_order_id,
      lab_order.patient_id,
      inbox.state_version,
      ?, ?, ?, ?, ?, 'requested', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM lis_analyzer_inbox inbox
    JOIN lab_results result
      ON result.id = inbox.canonical_lab_result_id
     AND result.tenant_id = inbox.tenant_id
    JOIN lab_reports report
      ON report.id = result.lab_report_id
     AND report.tenant_id = inbox.tenant_id
    JOIN lab_order_items item
      ON item.id = inbox.lab_order_item_id
     AND item.tenant_id = inbox.tenant_id
    JOIN lab_orders lab_order
      ON lab_order.id = item.lab_order_id
     AND lab_order.tenant_id = inbox.tenant_id
    WHERE inbox.id = ?
      AND inbox.tenant_id = ?
      AND inbox.state_version = ?
      AND inbox.disposition = 'accepted'
      AND result.result_status <> 'retracted'
      AND NOT EXISTS (
        SELECT 1
        FROM lis_result_retraction_requests open_request
        WHERE open_request.tenant_id = inbox.tenant_id
          AND open_request.lis_analyzer_inbox_id = inbox.id
          AND open_request.status IN ('requested', 'applying')
      )
  `).bind(
    requestedBy,
    normalizeRole(input.requesterRole),
    reasonCode,
    reason,
    notes,
    inboxId,
    input.tenantId,
    expectedInboxVersion,
  );

  const results = await db.batch([insert]);
  const inserted = results[0];
  let requestId = resultChanges(inserted) > 0 ? lastRowId(inserted) : 0;
  if (!requestId) {
    const existing = await db.prepare(`
      SELECT id
      FROM lis_result_retraction_requests
      WHERE tenant_id = ?
        AND lis_analyzer_inbox_id = ?
        AND status IN ('requested', 'applying')
      ORDER BY id DESC
      LIMIT 1
    `).bind(input.tenantId, inboxId).first<{ id: number }>();
    requestId = Number(existing?.id ?? 0);
  }

  if (!requestId) {
    throw new LisResultRetractionError(
      'Retraction request could not be claimed; refresh and try again',
      'retraction_conflict',
      409,
    );
  }

  const request = await loadRetractionRequest(db, input.tenantId, requestId);
  if (!request) {
    throw new LisResultRetractionError('Retraction request not found after creation', 'retraction_conflict', 409);
  }
  if (Number(request.requested_by) !== requestedBy || String(request.reason) !== reason) {
    throw new LisResultRetractionError(
      'Another reviewer created the open retraction request',
      'open_retraction_exists',
      409,
    );
  }

  return {
    requested: true,
    requestId: Number(request.id),
    inboxId,
    stateVersion: Number(request.state_version),
    status: String(request.status),
  };
}

export async function approveLisResultRetraction(
  db: D1Database,
  input: ReviewLisResultRetractionInput,
): Promise<{
  applied: true;
  requestId: number;
  inboxId: number;
  labResultId: number;
  labReportId: number;
  nextVersion: number;
}> {
  if (!canManageLisResultRetraction(input.reviewerRole)) {
    throw new LisResultRetractionError(
      'Only laboratory governance roles may approve result retraction',
      'retraction_forbidden',
      403,
    );
  }

  const requestId = positiveInteger(input.requestId, 'requestId');
  const expectedVersion = positiveInteger(input.expectedVersion, 'expectedVersion');
  const reviewedBy = positiveInteger(input.reviewedBy, 'reviewedBy');
  const reviewNotes = requiredText(input.reviewNotes, 'invalid_review_notes', 'Review notes', 10, 1000);

  const request = await loadRetractionRequest(db, input.tenantId, requestId, true);
  if (!request) {
    throw new LisResultRetractionError('Retraction request not found', 'retraction_not_found', 404);
  }
  if (Number(request.state_version) !== expectedVersion || String(request.status) !== 'requested') {
    throw new LisResultRetractionError(
      'Retraction request changed; refresh before reviewing',
      'retraction_conflict',
      409,
    );
  }
  if (Number(request.requested_by) === reviewedBy) {
    throw new LisResultRetractionError(
      'The requester cannot approve their own result retraction',
      'self_approval_forbidden',
      409,
    );
  }

  const payload = JSON.stringify({
    requestId,
    inboxId: Number(request.lis_analyzer_inbox_id),
    labResultId: Number(request.lab_result_id),
    labReportId: Number(request.lab_report_id),
    labOrderItemId: Number(request.lab_order_item_id),
    labOrderId: Number(request.lab_order_id),
    patientId: request.patient_id == null ? null : Number(request.patient_id),
    reasonCode: request.reason_code,
    reason: request.reason,
    notes: request.notes,
    requestedBy: Number(request.requested_by),
    approvedBy: reviewedBy,
  });
  const recipients = JSON.stringify({
    notifyPatient: true,
    notifyOrderingClinician: true,
    notifyLaboratoryGovernance: true,
    channels: ['in_app', 'portal'],
  });

  const guard = `EXISTS (
    SELECT 1
    FROM lis_result_retraction_requests guard_request
    WHERE guard_request.id = ?
      AND guard_request.tenant_id = ?
      AND guard_request.status = 'applying'
      AND guard_request.reviewed_by = ?
      AND guard_request.state_version = ?
  )`;
  const nextVersion = expectedVersion + 1;

  const statements: D1PreparedStatement[] = [
    db.prepare(`
      UPDATE lis_result_retraction_requests
      SET status = 'applying',
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          review_notes = ?,
          state_version = state_version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'requested'
        AND state_version = ?
        AND requested_by <> ?
    `).bind(reviewedBy, reviewNotes, requestId, input.tenantId, expectedVersion, reviewedBy),
    db.prepare(`
      UPDATE lab_results
      SET result_status = 'retracted',
          retracted_at = CURRENT_TIMESTAMP,
          retracted_by = ?,
          retraction_reason = ?,
          retraction_request_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND tenant_id = ?
        AND result_status <> 'retracted'
        AND ${guard}
    `).bind(
      reviewedBy,
      request.reason,
      requestId,
      request.lab_result_id,
      input.tenantId,
      requestId,
      input.tenantId,
      reviewedBy,
      nextVersion,
    ),
    db.prepare(`
      UPDATE lab_order_items
      SET status = 'rejected',
          result_status = 'retracted',
          retracted_at = CURRENT_TIMESTAMP,
          retracted_by = ?,
          retraction_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND tenant_id = ?
        AND ${guard}
    `).bind(
      reviewedBy,
      request.reason,
      request.lab_order_item_id,
      input.tenantId,
      requestId,
      input.tenantId,
      reviewedBy,
      nextVersion,
    ),
    db.prepare(`
      UPDATE lab_reports
      SET report_status = 'retracted',
          review_status = 'pending',
          delivery_status = 'retracted',
          retracted_at = CURRENT_TIMESTAMP,
          retracted_by = ?,
          retraction_reason = ?,
          retraction_count = COALESCE(retraction_count, 0) + 1,
          corrected_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND tenant_id = ?
        AND ${guard}
    `).bind(
      reviewedBy,
      request.reason,
      request.lab_report_id,
      input.tenantId,
      requestId,
      input.tenantId,
      reviewedBy,
      nextVersion,
    ),
    db.prepare(`
      INSERT INTO lab_observation_audit (
        tenant_id,
        lab_result_id,
        lab_order_item_id,
        lab_test_id,
        component_id,
        specimen_id,
        result_value,
        result_numeric,
        units,
        reference_range,
        abnormal_flag,
        critical_flag,
        result_status,
        observation_source,
        machine_id,
        machine_result_log_id,
        entered_by,
        verified_by,
        verified_at,
        correction_reason,
        version_no,
        supersedes_observation_id,
        retraction_request_id,
        lis_analyzer_inbox_id,
        created_at
      )
      SELECT
        result.tenant_id,
        result.id,
        request.lab_order_item_id,
        result.lab_test_id,
        result.component_id,
        inbox.specimen_id,
        result.result_value,
        result.result_numeric,
        result.units,
        result.normal_range,
        result.abnormal_flag,
        inbox.critical_flag,
        'retracted',
        'retraction',
        result.machine_id,
        inbox.machine_result_log_id,
        request.requested_by,
        request.reviewed_by,
        CURRENT_TIMESTAMP,
        request.reason,
        COALESCE((
          SELECT MAX(existing.version_no) + 1
          FROM lab_observation_audit existing
          WHERE existing.tenant_id = request.tenant_id
            AND existing.lab_order_item_id = request.lab_order_item_id
        ), 1),
        (
          SELECT existing.id
          FROM lab_observation_audit existing
          WHERE existing.tenant_id = request.tenant_id
            AND existing.lab_order_item_id = request.lab_order_item_id
          ORDER BY existing.version_no DESC, existing.id DESC
          LIMIT 1
        ),
        request.id,
        NULL,
        CURRENT_TIMESTAMP
      FROM lis_result_retraction_requests request
      JOIN lab_results result
        ON result.id = request.lab_result_id
       AND result.tenant_id = request.tenant_id
      JOIN lis_analyzer_inbox inbox
        ON inbox.id = request.lis_analyzer_inbox_id
       AND inbox.tenant_id = request.tenant_id
      WHERE request.id = ?
        AND request.tenant_id = ?
        AND request.status = 'applying'
        AND request.reviewed_by = ?
        AND request.state_version = ?
    `).bind(requestId, input.tenantId, reviewedBy, nextVersion),
    db.prepare(`
      INSERT INTO lis_result_retraction_notification_outbox (
        tenant_id,
        retraction_request_id,
        event_type,
        status,
        payload_json,
        recipient_policy_json,
        attempt_count,
        created_at,
        updated_at
      )
      SELECT ?, ?, 'result_retracted', 'pending', ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE ${guard}
    `).bind(
      input.tenantId,
      requestId,
      payload,
      recipients,
      requestId,
      input.tenantId,
      reviewedBy,
      nextVersion,
    ),
    db.prepare(`
      UPDATE lis_result_retraction_requests
      SET status = 'applied',
          applied_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'applying'
        AND reviewed_by = ?
        AND state_version = ?
    `).bind(requestId, input.tenantId, reviewedBy, nextVersion),
  ];

  await db.batch(statements);

  const applied = await loadRetractionRequest(db, input.tenantId, requestId);
  if (
    !applied
    || String(applied.status) !== 'applied'
    || Number(applied.reviewed_by) !== reviewedBy
    || Number(applied.state_version) !== nextVersion
  ) {
    throw new LisResultRetractionError(
      'Retraction approval could not be claimed; refresh and try again',
      'retraction_conflict',
      409,
    );
  }

  return {
    applied: true,
    requestId,
    inboxId: Number(applied.lis_analyzer_inbox_id),
    labResultId: Number(applied.lab_result_id),
    labReportId: Number(applied.lab_report_id),
    nextVersion,
  };
}

export async function rejectLisResultRetraction(
  db: D1Database,
  input: ReviewLisResultRetractionInput,
): Promise<{ rejected: true; requestId: number; nextVersion: number }> {
  if (!canManageLisResultRetraction(input.reviewerRole)) {
    throw new LisResultRetractionError(
      'Only laboratory governance roles may reject result retraction',
      'retraction_forbidden',
      403,
    );
  }

  const requestId = positiveInteger(input.requestId, 'requestId');
  const expectedVersion = positiveInteger(input.expectedVersion, 'expectedVersion');
  const reviewedBy = positiveInteger(input.reviewedBy, 'reviewedBy');
  const reviewNotes = requiredText(input.reviewNotes, 'invalid_review_notes', 'Review notes', 10, 1000);

  const request = await loadRetractionRequest(db, input.tenantId, requestId, true);
  if (!request) {
    throw new LisResultRetractionError('Retraction request not found', 'retraction_not_found', 404);
  }
  if (Number(request.state_version) !== expectedVersion || String(request.status) !== 'requested') {
    throw new LisResultRetractionError(
      'Retraction request changed; refresh before reviewing',
      'retraction_conflict',
      409,
    );
  }
  if (Number(request.requested_by) === reviewedBy) {
    throw new LisResultRetractionError(
      'The requester cannot reject their own result retraction',
      'self_approval_forbidden',
      409,
    );
  }

  const update = db.prepare(`
    UPDATE lis_result_retraction_requests
    SET status = 'rejected',
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP,
        review_notes = ?,
        state_version = state_version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND tenant_id = ?
      AND status = 'requested'
      AND state_version = ?
      AND requested_by <> ?
  `).bind(reviewedBy, reviewNotes, requestId, input.tenantId, expectedVersion, reviewedBy);

  await db.batch([update]);

  const rejected = await loadRetractionRequest(db, input.tenantId, requestId);
  const nextVersion = expectedVersion + 1;
  if (
    !rejected
    || String(rejected.status) !== 'rejected'
    || Number(rejected.reviewed_by) !== reviewedBy
    || Number(rejected.state_version) !== nextVersion
  ) {
    throw new LisResultRetractionError(
      'Retraction rejection could not be claimed; refresh and try again',
      'retraction_conflict',
      409,
    );
  }

  return { rejected: true, requestId, nextVersion };
}

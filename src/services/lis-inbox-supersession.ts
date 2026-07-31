const LIS_SUPERSESSION_ROLES = new Set(['pathologist', 'lab_supervisor']);
const REVIEWABLE_SOURCE_DISPOSITIONS = new Set([
  'unmatched',
  'ambiguous',
  'qc_blocked',
  'validation_blocked',
  'review_required',
  'acceptance_eligible',
  'accepted',
  'rejected',
]);
const BLOCKED_TARGET_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'rejected']);

export class LisInboxSupersessionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LisInboxSupersessionError';
  }
}

export interface CreateLisInboxSupersessionInput {
  tenantId: string | number;
  sourceInboxId: number;
  expectedVersion: number;
  targetLabOrderItemId: number;
  requestedBy: string | number;
  requesterRole: string;
  reason: string;
  qcOverrideReason?: string | null;
  validationOverrideReason?: string | null;
}

export interface LisInboxSupersessionResult {
  created: true;
  sourceInboxId: number;
  inboxId: number;
  stateVersion: number;
  disposition: string;
}

interface SourceInboxRow extends Record<string, unknown> {
  id: number;
  state_version: number;
  disposition: string;
  lab_order_item_id: number | null;
  patient_id: number | null;
  lab_test_id: number | null;
  qc_state: string;
  validation_state: string;
  candidate_metadata_json: string | null;
  source_payload_json: string;
  validation_details_json: string | null;
  qc_details_json: string | null;
  successor_id: number | null;
  applied_retraction_request_id: number | null;
}

interface TargetOrderItemRow {
  id: number;
  lab_order_id: number;
  lab_test_id: number;
  specimen_id: number | null;
  status: string | null;
  result_status: string | null;
  patient_id: number | null;
  order_no: string | null;
  test_name: string | null;
  test_code: string | null;
}

interface SuccessorRow {
  id: number;
  state_version: number;
  disposition: string;
  requested_by?: number | null;
  target_lab_order_item_id?: number | null;
}

function normalizeRole(role: string): string {
  return String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function positiveInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LisInboxSupersessionError(`${label} must be a positive integer`, 'invalid_identifier', 400);
  }
  return parsed;
}

function requiredReason(value: unknown, code: string, label: string, minLength = 10): string {
  const reason = String(value ?? '').trim();
  if (reason.length < minLength || reason.length > 500) {
    throw new LisInboxSupersessionError(
      `${label} must be between ${minLength} and 500 characters`,
      code,
      400,
    );
  }
  return reason;
}

function optionalReason(value: unknown, code: string, label: string): string | null {
  const reason = String(value ?? '').trim();
  if (!reason) return null;
  return requiredReason(reason, code, label);
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildDerivedEvidence(
  source: SourceInboxRow,
  input: {
    targetLabOrderItemId: number;
    requestedBy: number;
    reason: string;
    requestedAt: string;
    qcOverrideReason: string | null;
    validationOverrideReason: string | null;
  },
) {
  const lineage = {
    sourceInboxId: Number(source.id),
    targetLabOrderItemId: input.targetLabOrderItemId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    reason: input.reason,
  };

  const candidateMetadata = {
    original: parseJson(source.candidate_metadata_json),
    supersession: lineage,
  };
  const sourcePayload = {
    original: parseJson(source.source_payload_json),
    supersession: lineage,
  };
  const validationDetails = input.validationOverrideReason
    ? {
        original: parseJson(source.validation_details_json),
        override: {
          ...lineage,
          reason: input.validationOverrideReason,
        },
      }
    : parseJson(source.validation_details_json);
  const qcDetails = input.qcOverrideReason
    ? {
        original: parseJson(source.qc_details_json),
        override: {
          ...lineage,
          reason: input.qcOverrideReason,
        },
      }
    : parseJson(source.qc_details_json);

  return {
    candidateMetadataJson: JSON.stringify(candidateMetadata),
    sourcePayloadJson: JSON.stringify(sourcePayload),
    validationDetailsJson: validationDetails == null ? null : JSON.stringify(validationDetails),
    qcDetailsJson: qcDetails == null ? null : JSON.stringify(qcDetails),
  };
}

export function canCreateLisInboxSupersession(role: string): boolean {
  return LIS_SUPERSESSION_ROLES.has(normalizeRole(role));
}

export async function createLisInboxSupersession(
  db: D1Database,
  input: CreateLisInboxSupersessionInput,
): Promise<LisInboxSupersessionResult> {
  if (!canCreateLisInboxSupersession(input.requesterRole)) {
    throw new LisInboxSupersessionError(
      'Only a pathologist or laboratory supervisor can create a superseding analyzer review',
      'supersession_forbidden',
      403,
    );
  }

  const sourceInboxId = positiveInteger(input.sourceInboxId, 'sourceInboxId');
  const expectedVersion = positiveInteger(input.expectedVersion, 'expectedVersion');
  const targetLabOrderItemId = positiveInteger(input.targetLabOrderItemId, 'targetLabOrderItemId');
  const requestedBy = positiveInteger(input.requestedBy, 'requestedBy');
  const reason = requiredReason(input.reason, 'invalid_supersession_reason', 'Supersession reason');
  const qcOverrideReason = optionalReason(
    input.qcOverrideReason,
    'invalid_qc_override_reason',
    'QC override reason',
  );
  const validationOverrideReason = optionalReason(
    input.validationOverrideReason,
    'invalid_validation_override_reason',
    'Validation override reason',
  );

  const source = await db.prepare(`
    SELECT
      source.*,
      successor.id AS successor_id,
      (
        SELECT retraction.id
        FROM lis_result_retraction_requests retraction
        WHERE retraction.tenant_id = source.tenant_id
          AND retraction.lis_analyzer_inbox_id = source.id
          AND retraction.status = 'applied'
        ORDER BY retraction.id DESC
        LIMIT 1
      ) AS applied_retraction_request_id
    FROM lis_analyzer_inbox source
    LEFT JOIN lis_analyzer_inbox successor
      ON successor.tenant_id = source.tenant_id
     AND successor.supersedes_inbox_id = source.id
    WHERE source.id = ? AND source.tenant_id = ?
  `).bind(sourceInboxId, input.tenantId).first<SourceInboxRow>();

  if (!source) {
    throw new LisInboxSupersessionError('Source analyzer evidence not found', 'source_not_found', 404);
  }
  if (Number(source.state_version) !== expectedVersion) {
    throw new LisInboxSupersessionError(
      'Source analyzer evidence changed; refresh before creating a supersession',
      'supersession_conflict',
      409,
    );
  }
  if (source.successor_id != null) {
    throw new LisInboxSupersessionError(
      'This analyzer evidence already has a direct successor',
      'supersession_exists',
      409,
    );
  }
  if (!REVIEWABLE_SOURCE_DISPOSITIONS.has(String(source.disposition))) {
    throw new LisInboxSupersessionError(
      `Analyzer evidence in ${source.disposition} state cannot be superseded`,
      'source_not_reviewable',
      409,
    );
  }

  const target = await db.prepare(`
    SELECT
      target_item.id,
      target_item.lab_order_id,
      target_item.lab_test_id,
      target_item.specimen_id,
      target_item.status,
      target_item.result_status,
      target_order.patient_id,
      target_order.order_no,
      target_test.name AS test_name,
      target_test.code AS test_code
    FROM lab_order_items target_item
    JOIN lab_orders target_order
      ON target_order.id = target_item.lab_order_id
     AND target_order.tenant_id = target_item.tenant_id
    JOIN lab_test_catalog target_test
      ON target_test.id = target_item.lab_test_id
     AND target_test.tenant_id = target_item.tenant_id
    WHERE target_item.id = ? AND target_item.tenant_id = ?
  `).bind(targetLabOrderItemId, input.tenantId).first<TargetOrderItemRow>();

  if (!target) {
    throw new LisInboxSupersessionError('Target laboratory order item not found', 'target_not_found', 404);
  }
  const targetStatus = String(target.status ?? '').trim().toLowerCase();
  const sameItemRetractedAmendment = source.disposition === 'accepted'
    && source.applied_retraction_request_id != null
    && Number(source.lab_order_item_id) === Number(targetLabOrderItemId)
    && targetStatus === 'rejected'
    && String(target.result_status ?? '').trim().toLowerCase() === 'retracted';
  if (BLOCKED_TARGET_STATUSES.has(targetStatus) && !sameItemRetractedAmendment) {
    throw new LisInboxSupersessionError(
      `Target laboratory order item is ${target.status}`,
      'target_not_reviewable',
      409,
    );
  }
  if (source.lab_test_id != null && Number(source.lab_test_id) !== Number(target.lab_test_id)) {
    throw new LisInboxSupersessionError(
      'Target laboratory order item is for a different test',
      'target_test_mismatch',
      409,
    );
  }
  if (
    source.disposition === 'accepted'
    && Number(source.lab_order_item_id) !== Number(targetLabOrderItemId)
    && source.applied_retraction_request_id == null
  ) {
    throw new LisInboxSupersessionError(
      'An accepted result cannot be moved to another order item without a formal result retraction workflow',
      'accepted_result_retraction_required',
      409,
    );
  }

  const sourceQcReusable = ['pass', 'override'].includes(String(source.qc_state));
  if (!sourceQcReusable && !qcOverrideReason) {
    throw new LisInboxSupersessionError(
      `Source QC state is ${source.qc_state}; an explicit QC override reason is required`,
      'qc_override_required',
      409,
    );
  }

  const patientChanged = source.patient_id == null
    || target.patient_id == null
    || Number(source.patient_id) !== Number(target.patient_id);
  const sourceValidationReusable = ['pass', 'override'].includes(String(source.validation_state))
    && !patientChanged;
  if (!sourceValidationReusable && !validationOverrideReason) {
    throw new LisInboxSupersessionError(
      patientChanged
        ? 'Patient identity changed; an explicit validation override reason is required'
        : `Source validation state is ${source.validation_state}; an explicit validation override reason is required`,
      'validation_override_required',
      409,
    );
  }

  const effectiveQcState = qcOverrideReason ? 'override' : String(source.qc_state);
  const effectiveValidationState = validationOverrideReason
    ? 'override'
    : String(source.validation_state);
  const requestedAt = new Date().toISOString();
  const evidence = buildDerivedEvidence(source, {
    targetLabOrderItemId,
    requestedBy,
    reason,
    requestedAt,
    qcOverrideReason,
    validationOverrideReason,
  });

  const commandStatement = db.prepare(`
    INSERT OR IGNORE INTO lis_inbox_supersession_commands (
      tenant_id, source_inbox_id, source_state_version,
      target_lab_order_item_id, requested_by, requester_role,
      reason, qc_override_reason, validation_override_reason
    )
    SELECT
      source.tenant_id, source.id, source.state_version,
      ?, ?, ?, ?, ?, ?
    FROM lis_analyzer_inbox source
    JOIN lab_order_items target_item
      ON target_item.id = ?
     AND target_item.tenant_id = source.tenant_id
    WHERE source.id = ?
      AND source.tenant_id = ?
      AND source.state_version = ?
      AND (
        COALESCE(target_item.status, 'pending') NOT IN ('cancelled', 'canceled', 'refunded', 'rejected')
        OR (
          source.disposition = 'accepted'
          AND source.lab_order_item_id = target_item.id
          AND target_item.status = 'rejected'
          AND target_item.result_status = 'retracted'
          AND EXISTS (
            SELECT 1
            FROM lis_result_retraction_requests applied_retraction
            WHERE applied_retraction.tenant_id = source.tenant_id
              AND applied_retraction.lis_analyzer_inbox_id = source.id
              AND applied_retraction.status = 'applied'
          )
        )
      )
      AND (source.lab_test_id IS NULL OR source.lab_test_id = target_item.lab_test_id)
      AND (
        source.disposition <> 'accepted'
        OR source.lab_order_item_id = target_item.id
        OR EXISTS (
          SELECT 1
          FROM lis_result_retraction_requests applied_retraction
          WHERE applied_retraction.tenant_id = source.tenant_id
            AND applied_retraction.lis_analyzer_inbox_id = source.id
            AND applied_retraction.status = 'applied'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM lis_analyzer_inbox successor
        WHERE successor.tenant_id = source.tenant_id
          AND successor.supersedes_inbox_id = source.id
      )
  `).bind(
    targetLabOrderItemId,
    requestedBy,
    normalizeRole(input.requesterRole),
    reason,
    qcOverrideReason,
    validationOverrideReason,
    targetLabOrderItemId,
    sourceInboxId,
    input.tenantId,
    expectedVersion,
  );

  const cloneStatement = db.prepare(`
    INSERT INTO lis_analyzer_inbox (
      tenant_id, ingestion_message_id, observation_index, order_group_index,
      machine_id, bridge_agent_id, machine_result_log_id,
      identifier_type, identifier_value, machine_test_code, machine_test_name,
      analyzer_observation_id,
      lab_order_item_id, patient_id, specimen_id, lab_test_id, component_id,
      candidate_metadata_json,
      raw_value, raw_units, raw_reference_range,
      normalized_value, normalized_numeric, normalized_units,
      selected_reference_range, conversion_rule, conversion_factor,
      analyzer_result_status, normalized_result_status,
      analyzer_abnormal_flag, normalized_interpretation, critical_flag,
      match_state, qc_state, validation_state,
      disposition, disposition_reason, state_version,
      source_payload_json, validation_details_json, qc_details_json,
      staged_by, supersedes_inbox_id, created_at, updated_at
    )
    SELECT
      source.tenant_id,
      source.ingestion_message_id,
      (
        SELECT COALESCE(MAX(existing.observation_index), -1) + 1
        FROM lis_analyzer_inbox existing
        WHERE existing.ingestion_message_id = source.ingestion_message_id
      ),
      source.order_group_index,
      source.machine_id,
      source.bridge_agent_id,
      source.machine_result_log_id,
      source.identifier_type,
      source.identifier_value,
      source.machine_test_code,
      source.machine_test_name,
      source.analyzer_observation_id,
      target_item.id,
      target_order.patient_id,
      target_item.specimen_id,
      target_item.lab_test_id,
      source.component_id,
      ?,
      source.raw_value,
      source.raw_units,
      source.raw_reference_range,
      source.normalized_value,
      source.normalized_numeric,
      source.normalized_units,
      source.selected_reference_range,
      source.conversion_rule,
      source.conversion_factor,
      source.analyzer_result_status,
      source.normalized_result_status,
      source.analyzer_abnormal_flag,
      source.normalized_interpretation,
      source.critical_flag,
      'exact', ?, ?,
      'review_required', ?, 1,
      ?, ?, ?,
      command.requested_by, source.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM lis_analyzer_inbox source
    JOIN lis_inbox_supersession_commands command
      ON command.tenant_id = source.tenant_id
     AND command.source_inbox_id = source.id
     AND command.source_state_version = source.state_version
     AND command.requested_by = ?
     AND command.target_lab_order_item_id = ?
     AND command.command_status = 'claimed'
    JOIN lab_order_items target_item
      ON command.target_lab_order_item_id = target_item.id
     AND target_item.tenant_id = source.tenant_id
    JOIN lab_orders target_order
      ON target_order.id = target_item.lab_order_id
     AND target_order.tenant_id = target_item.tenant_id
    WHERE source.id = ?
      AND source.tenant_id = ?
      AND source.state_version = ?
      AND (
        COALESCE(target_item.status, 'pending') NOT IN ('cancelled', 'canceled', 'refunded', 'rejected')
        OR (
          source.disposition = 'accepted'
          AND source.lab_order_item_id = target_item.id
          AND target_item.status = 'rejected'
          AND target_item.result_status = 'retracted'
          AND EXISTS (
            SELECT 1
            FROM lis_result_retraction_requests applied_retraction
            WHERE applied_retraction.tenant_id = source.tenant_id
              AND applied_retraction.lis_analyzer_inbox_id = source.id
              AND applied_retraction.status = 'applied'
          )
        )
      )
      AND (source.lab_test_id IS NULL OR source.lab_test_id = target_item.lab_test_id)
      AND (
        source.disposition <> 'accepted'
        OR source.lab_order_item_id = target_item.id
        OR EXISTS (
          SELECT 1
          FROM lis_result_retraction_requests applied_retraction
          WHERE applied_retraction.tenant_id = source.tenant_id
            AND applied_retraction.lis_analyzer_inbox_id = source.id
            AND applied_retraction.status = 'applied'
        )
      )
  `).bind(
    evidence.candidateMetadataJson,
    effectiveQcState,
    effectiveValidationState,
    reason,
    evidence.sourcePayloadJson,
    evidence.validationDetailsJson,
    evidence.qcDetailsJson,
    requestedBy,
    targetLabOrderItemId,
    sourceInboxId,
    input.tenantId,
    expectedVersion,
  );

  const sourceTransitionStatement = db.prepare(`
    UPDATE lis_analyzer_inbox
    SET disposition = 'rejected',
        disposition_reason = ?,
        rejected_by = ?,
        rejected_at = CURRENT_TIMESTAMP,
        rejection_reason = ?,
        state_version = state_version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND tenant_id = ?
      AND state_version = ?
      AND disposition NOT IN ('accepted', 'rejected')
      AND EXISTS (
        SELECT 1 FROM lis_analyzer_inbox successor
        WHERE successor.tenant_id = lis_analyzer_inbox.tenant_id
          AND successor.supersedes_inbox_id = lis_analyzer_inbox.id
      )
  `).bind(reason, requestedBy, reason, sourceInboxId, input.tenantId, expectedVersion);

  const completeCommandStatement = db.prepare(`
    UPDATE lis_inbox_supersession_commands
    SET command_status = 'completed',
        superseding_inbox_id = (
          SELECT successor.id
          FROM lis_analyzer_inbox successor
          WHERE successor.tenant_id = ?
            AND successor.supersedes_inbox_id = ?
        ),
        completed_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ?
      AND source_inbox_id = ?
      AND requested_by = ?
      AND target_lab_order_item_id = ?
      AND command_status = 'claimed'
      AND EXISTS (
        SELECT 1 FROM lis_analyzer_inbox successor
        WHERE successor.tenant_id = lis_inbox_supersession_commands.tenant_id
          AND successor.supersedes_inbox_id = lis_inbox_supersession_commands.source_inbox_id
      )
  `).bind(
    input.tenantId,
    sourceInboxId,
    input.tenantId,
    sourceInboxId,
    requestedBy,
    targetLabOrderItemId,
  );

  await db.batch([
    commandStatement,
    cloneStatement,
    sourceTransitionStatement,
    completeCommandStatement,
  ]);

  const successor = await db.prepare(`
    SELECT
      successor.id,
      successor.state_version,
      successor.disposition,
      command.requested_by,
      command.target_lab_order_item_id
    FROM lis_analyzer_inbox successor
    JOIN lis_inbox_supersession_commands command
      ON command.tenant_id = successor.tenant_id
     AND command.source_inbox_id = successor.supersedes_inbox_id
    WHERE successor.supersedes_inbox_id = ?
      AND successor.tenant_id = ?
  `).bind(sourceInboxId, input.tenantId).first<SuccessorRow>();

  if (!successor) {
    throw new LisInboxSupersessionError(
      'Analyzer supersession could not be claimed; refresh and try again',
      'supersession_conflict',
      409,
    );
  }
  if (
    successor.requested_by != null
    && (
      Number(successor.requested_by) !== requestedBy
      || Number(successor.target_lab_order_item_id) !== targetLabOrderItemId
    )
  ) {
    throw new LisInboxSupersessionError(
      'This analyzer evidence was superseded by another clinical review',
      'supersession_exists',
      409,
    );
  }

  return {
    created: true,
    sourceInboxId,
    inboxId: Number(successor.id),
    stateVersion: Number(successor.state_version),
    disposition: String(successor.disposition),
  };
}

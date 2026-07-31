import { deriveMachineResultWorkflowState } from '../lib/lab-machine-capabilities';

const LIS_ACCEPTANCE_ROLES = new Set([
  'pathologist',
  'lab_supervisor',
  'hospital_admin',
  'md',
]);

export class LisAcceptanceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LisAcceptanceError';
  }
}

export interface AcceptStagedLisResultInput {
  tenantId: string | number;
  inboxId: number;
  expectedVersion: number;
  reviewerUserId: string | number;
  reviewerRole: string;
}

export interface LisAcceptanceResult {
  accepted: true;
  inboxId: number;
  labOrderItemId: number;
  labOrderId: number;
  corrected: boolean;
  critical: boolean;
  nextVersion: number;
}

interface StagedInboxRow {
  id: number;
  tenant_id: string | number;
  state_version: number;
  disposition: string;
  match_state: string;
  qc_state: string;
  validation_state: string;
  ingestion_status: string;
  lab_order_item_id: number | null;
  lab_order_id: number;
  patient_id: number | null;
  specimen_id: number | null;
  lab_test_id: number | null;
  component_id: number | null;
  normalized_value: string | null;
  normalized_numeric: number | null;
  normalized_units: string | null;
  selected_reference_range: string | null;
  normalized_interpretation: string | null;
  critical_flag: number;
  normalized_result_status: string | null;
  machine_id: number | null;
  machine_result_log_id: number | null;
  machine_test_code: string;
  machine_test_name: string | null;
  staged_by: number | null;
  supersedes_inbox_id: number | null;
  supersession_reason: string | null;
  applied_retraction_request_id: number | null;
  latest_report_id: number | null;
  latest_report_status: string | null;
  latest_report_version: number | null;
  existing_result: string | null;
  existing_result_status: string | null;
}

function asNumber(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LisAcceptanceError('Invalid user or tenant identifier', 'invalid_identifier', 400);
  }
  return parsed;
}

function isAllowedGateState(value: string): boolean {
  return value === 'pass' || value === 'override';
}

function commandExistsSql(): string {
  return `EXISTS (
    SELECT 1
    FROM lis_result_acceptance_commands cmd
    WHERE cmd.tenant_id = ?
      AND cmd.lis_analyzer_inbox_id = ?
      AND cmd.reviewer_user_id = ?
      AND cmd.command_status = 'claimed'
  )`;
}

function extractChanges(result: unknown): number {
  const candidate = result as { meta?: { changes?: number } } | undefined;
  return Number(candidate?.meta?.changes ?? 0);
}

export async function acceptStagedLisResult(
  database: D1Database,
  input: AcceptStagedLisResultInput,
): Promise<LisAcceptanceResult> {
  const reviewerRole = String(input.reviewerRole || '').trim().toLowerCase();
  if (!LIS_ACCEPTANCE_ROLES.has(reviewerRole)) {
    throw new LisAcceptanceError(
      'Only laboratory governance roles may accept analyzer results',
      'forbidden',
      403,
    );
  }

  if (!Number.isInteger(input.inboxId) || input.inboxId <= 0) {
    throw new LisAcceptanceError('Invalid analyzer inbox id', 'invalid_inbox_id', 400);
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
    throw new LisAcceptanceError('Expected inbox version is required', 'invalid_version', 400);
  }

  const reviewerUserId = asNumber(input.reviewerUserId);
  const staged = await database.prepare(`
    SELECT
      inbox.id,
      inbox.tenant_id,
      inbox.state_version,
      inbox.disposition,
      inbox.match_state,
      inbox.qc_state,
      inbox.validation_state,
      message.status AS ingestion_status,
      inbox.lab_order_item_id,
      loi.lab_order_id,
      inbox.patient_id,
      inbox.specimen_id,
      inbox.lab_test_id,
      inbox.component_id,
      inbox.normalized_value,
      inbox.normalized_numeric,
      inbox.normalized_units,
      inbox.selected_reference_range,
      inbox.normalized_interpretation,
      inbox.critical_flag,
      inbox.normalized_result_status,
      inbox.machine_id,
      inbox.machine_result_log_id,
      inbox.machine_test_code,
      inbox.machine_test_name,
      inbox.staged_by,
      inbox.supersedes_inbox_id,
      supersession.reason AS supersession_reason,
      (
        SELECT applied_retraction.id
        FROM lis_result_retraction_requests applied_retraction
        WHERE applied_retraction.tenant_id = inbox.tenant_id
          AND applied_retraction.lis_analyzer_inbox_id = inbox.supersedes_inbox_id
          AND applied_retraction.status = 'applied'
        ORDER BY applied_retraction.id DESC
        LIMIT 1
      ) AS applied_retraction_request_id,
      latest_report.id AS latest_report_id,
      latest_report.report_status AS latest_report_status,
      latest_report.report_version AS latest_report_version,
      loi.result AS existing_result,
      loi.result_status AS existing_result_status
    FROM lis_analyzer_inbox inbox
    JOIN lis_ingestion_messages message
      ON message.id = inbox.ingestion_message_id
     AND message.tenant_id = inbox.tenant_id
    LEFT JOIN lis_inbox_supersession_commands supersession
      ON supersession.tenant_id = inbox.tenant_id
     AND supersession.superseding_inbox_id = inbox.id
    JOIN lab_order_items loi
      ON loi.id = inbox.lab_order_item_id
     AND loi.tenant_id = inbox.tenant_id
    JOIN lab_orders lo
      ON lo.id = loi.lab_order_id
     AND lo.tenant_id = inbox.tenant_id
    LEFT JOIN lab_reports latest_report
      ON latest_report.id = (
        SELECT candidate_report.id
        FROM lab_reports candidate_report
        WHERE candidate_report.lab_order_id = loi.lab_order_id
          AND candidate_report.tenant_id = inbox.tenant_id
        ORDER BY COALESCE(candidate_report.report_version, 1) DESC, candidate_report.id DESC
        LIMIT 1
      )
    WHERE inbox.id = ? AND inbox.tenant_id = ?
    LIMIT 1
  `).bind(input.inboxId, input.tenantId).first<StagedInboxRow>();

  if (!staged) {
    throw new LisAcceptanceError('Analyzer inbox result not found', 'not_found', 404);
  }
  if (Number(staged.state_version) !== input.expectedVersion) {
    throw new LisAcceptanceError('Analyzer inbox result changed; reload before accepting', 'stale_version', 409);
  }
  if (staged.staged_by != null && Number(staged.staged_by) === reviewerUserId) {
    throw new LisAcceptanceError(
      'The same user cannot stage and accept an analyzer result',
      'self_approval_forbidden',
      409,
    );
  }
  if (!['completed', 'partial'].includes(staged.ingestion_status)) {
    throw new LisAcceptanceError(
      `Analyzer message did not finish staging (${staged.ingestion_status})`,
      'ingestion_not_complete',
      409,
    );
  }
  if (!['review_required', 'acceptance_eligible'].includes(staged.disposition)) {
    throw new LisAcceptanceError(
      `Analyzer result is not eligible for acceptance (${staged.disposition})`,
      'not_eligible',
      409,
    );
  }
  if (staged.match_state !== 'exact' || !staged.lab_order_item_id || !staged.lab_test_id) {
    throw new LisAcceptanceError('Analyzer result does not have one exact clinical match', 'match_not_exact', 409);
  }
  if (!isAllowedGateState(staged.qc_state)) {
    throw new LisAcceptanceError(`QC gate is not released (${staged.qc_state})`, 'qc_not_released', 409);
  }
  if (!isAllowedGateState(staged.validation_state)) {
    throw new LisAcceptanceError(
      `Clinical validation gate is not released (${staged.validation_state})`,
      'validation_not_released',
      409,
    );
  }
  if (staged.normalized_value == null || staged.normalized_result_status == null) {
    throw new LisAcceptanceError('Analyzer result is missing normalized clinical data', 'normalization_incomplete', 409);
  }

  const workflow = deriveMachineResultWorkflowState(staged.normalized_result_status);
  if (!workflow.recognized) {
    throw new LisAcceptanceError('Analyzer result status is not recognized', 'status_unrecognized', 409);
  }

  const superseding = staged.supersedes_inbox_id != null;
  const latestReportRetracted = String(staged.latest_report_status ?? '').trim().toLowerCase() === 'retracted';
  const amendmentAllowed = superseding && staged.applied_retraction_request_id != null;
  if (latestReportRetracted && !amendmentAllowed) {
    throw new LisAcceptanceError(
      'The latest laboratory report is retracted; an applied result retraction and superseding review are required before amendment',
      'retracted_report_amendment_required',
      409,
    );
  }
  const createReport = staged.latest_report_id == null || latestReportRetracted;
  const reportVersion = latestReportRetracted
    ? Math.max(1, Number(staged.latest_report_version ?? 1)) + 1
    : 1;
  const supersedesReportId = latestReportRetracted ? Number(staged.latest_report_id) : null;

  const corrected = superseding
    || staged.normalized_result_status === 'corrected'
    || (staged.existing_result != null && staged.existing_result !== staged.normalized_value);
  const critical = Number(staged.critical_flag) === 1
    || staged.normalized_interpretation === 'critical';
  const correctionReason = superseding
    ? staged.supersession_reason
      ?? `Superseding analyzer review accepted for inbox #${staged.supersedes_inbox_id}`
    : corrected
      ? `Analyzer correction accepted; previous value: ${staged.existing_result ?? 'not recorded'}`
      : null;
  const acceptanceNote = superseding
    ? `Accepted superseding analyzer review from inbox #${staged.id}`
    : corrected
      ? `Accepted corrected analyzer result from inbox #${staged.id}`
      : `Accepted analyzer result from inbox #${staged.id}`;
  const guardExists = commandExistsSql();

  const statements: D1PreparedStatement[] = [
    database.prepare(`
      INSERT INTO lis_result_acceptance_commands (
        tenant_id, lis_analyzer_inbox_id, expected_version,
        reviewer_user_id, reviewer_role, command_status, created_at
      )
      SELECT ?, inbox.id, ?, ?, ?, 'claimed', CURRENT_TIMESTAMP
      FROM lis_analyzer_inbox inbox
      WHERE inbox.id = ?
        AND inbox.tenant_id = ?
        AND inbox.state_version = ?
        AND inbox.disposition IN ('review_required', 'acceptance_eligible')
        AND inbox.match_state = 'exact'
        AND inbox.qc_state IN ('pass', 'override')
        AND inbox.validation_state IN ('pass', 'override')
        AND EXISTS (
          SELECT 1
          FROM lis_ingestion_messages message
          WHERE message.id = inbox.ingestion_message_id
            AND message.tenant_id = inbox.tenant_id
            AND message.status IN ('completed', 'partial')
        )
        AND (inbox.staged_by IS NULL OR inbox.staged_by <> ?)
    `).bind(
      input.tenantId,
      input.expectedVersion,
      reviewerUserId,
      reviewerRole,
      staged.id,
      input.tenantId,
      input.expectedVersion,
      reviewerUserId,
    ),
    database.prepare(`
      INSERT OR IGNORE INTO lab_reports (
        lab_order_id, report_status, review_status, tenant_id,
        report_version, supersedes_report_id, amendment_reason, created_at
      )
      SELECT ?, 'pending', 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP
      WHERE ${guardExists}
        AND ? = 1
        AND NOT EXISTS (
          SELECT 1
          FROM lab_reports existing_report
          WHERE existing_report.lab_order_id = ?
            AND existing_report.tenant_id = ?
            AND COALESCE(existing_report.report_version, 1) = ?
        )
    `).bind(
      staged.lab_order_id,
      input.tenantId,
      reportVersion,
      supersedesReportId,
      latestReportRetracted ? correctionReason : null,
      input.tenantId,
      staged.id,
      reviewerUserId,
      createReport ? 1 : 0,
      staged.lab_order_id,
      input.tenantId,
      reportVersion,
    ),
    database.prepare(`
      UPDATE lab_order_items
      SET result = ?,
          result_numeric = ?,
          abnormal_flag = ?,
          status = ?,
          result_status = ?,
          completed_at = CASE
            WHEN ? = 1 THEN COALESCE(completed_at, CURRENT_TIMESTAMP)
            ELSE completed_at
          END,
          machine_id = ?,
          machine_result_log_id = ?,
          notes = CASE
            WHEN notes IS NULL OR TRIM(notes) = '' THEN ?
            ELSE notes || CHAR(10) || ?
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
        AND ${guardExists}
    `).bind(
      staged.normalized_value,
      staged.normalized_numeric,
      staged.normalized_interpretation ?? 'pending',
      workflow.itemStatus,
      workflow.resultStatus,
      workflow.isFinalLike ? 1 : 0,
      staged.machine_id,
      staged.machine_result_log_id,
      acceptanceNote,
      acceptanceNote,
      staged.lab_order_item_id,
      input.tenantId,
      input.tenantId,
      staged.id,
      reviewerUserId,
    ),
    database.prepare(`
      INSERT INTO lab_results (
        lab_report_id, lab_test_id, component_id, result_code, result_text,
        result_value, result_numeric, units, normal_range, abnormal_flag,
        result_status, comments, machine_id, tenant_id,
        lis_analyzer_inbox_id, created_at
      )
      SELECT report.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
      FROM lab_reports report
      WHERE report.lab_order_id = ?
        AND report.tenant_id = ?
        AND report.report_status <> 'retracted'
        AND ${guardExists}
      ORDER BY COALESCE(report.report_version, 1) DESC, report.id DESC
      LIMIT 1
    `).bind(
      staged.lab_test_id,
      staged.component_id,
      staged.machine_test_code,
      staged.machine_test_name ?? staged.machine_test_code,
      staged.normalized_value,
      staged.normalized_numeric,
      staged.normalized_units,
      staged.selected_reference_range,
      staged.normalized_interpretation ?? 'pending',
      workflow.resultStatus,
      acceptanceNote,
      staged.machine_id,
      input.tenantId,
      staged.id,
      staged.lab_order_id,
      input.tenantId,
      input.tenantId,
      staged.id,
      reviewerUserId,
    ),
    database.prepare(`
      INSERT INTO lab_observation_audit (
        tenant_id, lab_result_id, lab_order_item_id, lab_test_id, component_id,
        specimen_id, result_value, result_numeric, units, reference_range,
        abnormal_flag, critical_flag, result_status, observation_source,
        machine_id, machine_result_log_id, entered_by, verified_by, verified_at,
        correction_reason, version_no, supersedes_observation_id,
        lis_analyzer_inbox_id, created_at
      )
      SELECT
        ?,
        (SELECT id FROM lab_results WHERE tenant_id = ? AND lis_analyzer_inbox_id = ?),
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'machine', ?, ?, ?, ?, CURRENT_TIMESTAMP,
        ?,
        COALESCE((
          SELECT MAX(version_no) + 1
          FROM lab_observation_audit
          WHERE tenant_id = ? AND lab_order_item_id = ?
        ), 1),
        (SELECT id
         FROM lab_observation_audit
         WHERE tenant_id = ? AND lab_order_item_id = ?
         ORDER BY version_no DESC, id DESC
         LIMIT 1),
        ?, CURRENT_TIMESTAMP
      WHERE ${guardExists}
    `).bind(
      input.tenantId,
      input.tenantId,
      staged.id,
      staged.lab_order_item_id,
      staged.lab_test_id,
      staged.component_id,
      staged.specimen_id,
      staged.normalized_value,
      staged.normalized_numeric,
      staged.normalized_units,
      staged.selected_reference_range,
      staged.normalized_interpretation ?? 'pending',
      critical ? 1 : 0,
      workflow.resultStatus,
      staged.machine_id,
      staged.machine_result_log_id,
      staged.staged_by,
      reviewerUserId,
      correctionReason,
      input.tenantId,
      staged.lab_order_item_id,
      input.tenantId,
      staged.lab_order_item_id,
      staged.id,
      input.tenantId,
      staged.id,
      reviewerUserId,
    ),
  ];

  if (critical) {
    const criticalPayload = JSON.stringify({
      inboxId: staged.id,
      labOrderId: staged.lab_order_id,
      labOrderItemId: staged.lab_order_item_id,
      patientId: staged.patient_id,
      testCode: staged.machine_test_code,
      testName: staged.machine_test_name ?? staged.machine_test_code,
      value: staged.normalized_value,
      numericValue: staged.normalized_numeric,
      units: staged.normalized_units,
      referenceRange: staged.selected_reference_range,
      interpretation: staged.normalized_interpretation,
    });
    statements.push(database.prepare(`
      INSERT INTO lis_critical_event_outbox (
        tenant_id, lis_analyzer_inbox_id, event_type, status,
        payload_json, recipient_policy_json, attempt_count,
        acknowledgement_deadline, created_at, updated_at
      )
      SELECT ?, ?, 'critical_result', 'pending', ?, ?, 0,
             DATETIME(CURRENT_TIMESTAMP, '+15 minutes'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE ${guardExists}
    `).bind(
      input.tenantId,
      staged.id,
      criticalPayload,
      JSON.stringify({ roles: ['doctor', 'pathologist', 'lab_supervisor', 'hospital_admin'], escalationMinutes: 15 }),
      input.tenantId,
      staged.id,
      reviewerUserId,
    ));
  }

  statements.push(
    database.prepare(`
      UPDATE lis_analyzer_inbox
      SET disposition = 'accepted',
          accepted_by = ?,
          accepted_at = CURRENT_TIMESTAMP,
          canonical_lab_result_id = (
            SELECT accepted_result.id
            FROM lab_results accepted_result
            WHERE accepted_result.tenant_id = ?
              AND accepted_result.lis_analyzer_inbox_id = ?
          ),
          state_version = state_version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ? AND state_version = ?
        AND ${guardExists}
        AND EXISTS (
          SELECT 1
          FROM lab_results accepted_result
          WHERE accepted_result.tenant_id = ?
            AND accepted_result.lis_analyzer_inbox_id = ?
        )
    `).bind(
      reviewerUserId,
      input.tenantId,
      staged.id,
      staged.id,
      input.tenantId,
      input.expectedVersion,
      input.tenantId,
      staged.id,
      reviewerUserId,
      input.tenantId,
      staged.id,
    ),
    database.prepare(`
      UPDATE lab_orders
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
        AND ${guardExists}
        AND NOT EXISTS (
          SELECT 1
          FROM lab_order_items item
          WHERE item.lab_order_id = ?
            AND item.tenant_id = ?
            AND item.status NOT IN ('completed', 'cancelled')
        )
    `).bind(
      staged.lab_order_id,
      input.tenantId,
      input.tenantId,
      staged.id,
      reviewerUserId,
      staged.lab_order_id,
      input.tenantId,
    ),
    database.prepare(`
      UPDATE lis_result_acceptance_commands
      SET command_status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND lis_analyzer_inbox_id = ?
        AND reviewer_user_id = ?
        AND command_status = 'claimed'
    `).bind(input.tenantId, staged.id, reviewerUserId),
  );

  let batchResults: D1Result<unknown>[];
  try {
    batchResults = await database.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique constraint|lis_result_acceptance_commands|ux_lab_results_lis_inbox/i.test(message)) {
      throw new LisAcceptanceError('Analyzer result was already accepted or claimed', 'acceptance_conflict', 409);
    }
    throw error;
  }

  if (extractChanges(batchResults[0]) !== 1) {
    throw new LisAcceptanceError(
      'Analyzer result could not be claimed for acceptance',
      'acceptance_conflict',
      409,
    );
  }

  return {
    accepted: true,
    inboxId: staged.id,
    labOrderItemId: staged.lab_order_item_id,
    labOrderId: staged.lab_order_id,
    corrected,
    critical,
    nextVersion: input.expectedVersion + 1,
  };
}

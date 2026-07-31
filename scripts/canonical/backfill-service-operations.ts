import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface ServiceOperationsPreparedStatement {
  bind(...values: unknown[]): ServiceOperationsPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface ServiceOperationsBackfillDatabase {
  prepare(sql: string): ServiceOperationsPreparedStatement;
  batch(statements: ServiceOperationsPreparedStatement[]): Promise<unknown[]>;
}

export interface ServiceOperationsBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface ServiceOperationsBackfillCounts {
  scanned: number;
  requestsCreated: number;
  eventsCreated: number;
  participantsCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}

export interface ServiceOperationsBackfillResult {
  completed: boolean;
  counts: ServiceOperationsBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface StartCounts {
  requests: number;
  events: number;
  participants: number;
  mappings: number;
  issues: number;
}
interface Context {
  db: ServiceOperationsBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
}

interface LabItemRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  ordered_by: number | null;
  order_date: string | null;
  order_status: string | null;
  order_created_at: string | null;
  lab_test_id: number;
  item_status: string | null;
  completed_at: string | null;
  processed_by: number | null;
  verified_by: number | null;
  verified_at: string | null;
  result_status: string | null;
  item_updated_at: string | null;
}
interface RadiologyRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  admission_id: number | null;
  imaging_item_id: number | null;
  prescriber_id: number | null;
  order_status: string | null;
  is_report_saved: number;
  is_scanned: number;
  scanned_by: string | null;
  scanned_on: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}
interface ConsultationRow {
  id: number;
  doctor_id: number;
  patient_id: number;
  scheduled_at: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}
interface ProcedureRow {
  id: number;
  patient_id: number;
  visit_id: number | null;
  service_item_id: number | null;
  ordered_by: number | null;
  performed_by: number | null;
  status: string | null;
  ordered_at: string | null;
  performed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}
interface BedReservationRow {
  id: number;
  patient_id: number;
  bed_id: number;
  reserved_from: string;
  reserved_to: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}
interface BedStayRow {
  id: number;
  patient_id: number;
  admission_id: number;
  bed_id: number;
  started_on: string;
  ended_on: string | null;
  days: number | null;
  created_at: string | null;
}
interface PrescriptionItemRow {
  id: number;
  prescription_id: number;
  patient_id: number;
  doctor_id: number | null;
  appointment_id: number | null;
  admission_id: number | null;
  prescription_status: string | null;
  dispense_status: string | null;
  prescription_created_at: string | null;
  prescription_updated_at: string | null;
  medicine_id: number | null;
  quantity: number | null;
  dispensed_qty: number | null;
}

const SRC_LAB = 'legacy_lab_order_item';
const SRC_RAD = 'legacy_radiology_requisition';
const SRC_CONSULT = 'legacy_consultation_operation';
const SRC_PROC = 'legacy_procedure_order';
const SRC_BED_RES = 'legacy_bed_reservation';
const SRC_BED_STAY = 'legacy_bed_stay_operation';
const SRC_RX_ITEM = 'legacy_prescription_item';

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function limit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError('maxSourceRecords must be a positive integer');
  }
  return value;
}

function legacyUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return toUtcIso(`${raw}T00:00:00+06:00`);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return toUtcIso(iso);
  return toUtcIso(`${iso}+06:00`);
}

function integerId(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function all<T>(statement: ServiceOperationsPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function tableCount(
  db: ServiceOperationsBackfillDatabase,
  table: string,
  tenantId: string,
  tail = '',
): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?${tail}`)
    .bind(tenantId).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function capture(db: ServiceOperationsBackfillDatabase, tenantId: string): Promise<StartCounts> {
  return {
    requests: await tableCount(db, 'canonical_service_requests', tenantId),
    events: await tableCount(db, 'canonical_service_events', tenantId),
    participants: await tableCount(db, 'canonical_service_participants', tenantId),
    mappings: await tableCount(
      db,
      'canonical_source_mappings',
      tenantId,
      " AND entity_type IN ('service_request','service_event')",
    ),
    issues: await tableCount(
      db,
      'canonical_processing_issues',
      tenantId,
      " AND issue_type='service_operations_backfill'",
    ),
  };
}

async function result(
  db: ServiceOperationsBackfillDatabase,
  tenantId: string,
  start: StartCounts,
  scanned: number,
  completed: boolean,
): Promise<ServiceOperationsBackfillResult> {
  const end = await capture(db, tenantId);
  return {
    completed,
    counts: {
      scanned,
      requestsCreated: end.requests - start.requests,
      eventsCreated: end.events - start.events,
      participantsCreated: end.participants - start.participants,
      mappingsCreated: end.mappings - start.mappings,
      issuesCreated: end.issues - start.issues,
    },
  };
}

async function ensureRun(
  db: ServiceOperationsBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<RunRow> {
  let row = await db.prepare(
    'SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1',
  ).bind(tenantId, runPublicId).first<RunRow>();
  if (!row) {
    await db.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,
        started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,'0509_canonical_service_requests_events.sql','backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, nowUtc, nowUtc, nowUtc).run();
    row = await db.prepare(
      'SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1',
    ).bind(tenantId, runPublicId).first<RunRow>();
  }
  if (!row) throw new Error('Failed to create service operations migration run');
  if (row.status === 'failed' || row.status === 'cancelled') {
    throw new Error(`Service operations backfill run is terminal: ${row.status}`);
  }
  return row;
}

async function checkpoint(ctx: Context, sourceType: string): Promise<CheckpointRow> {
  let row = await ctx.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='service_operations'
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(ctx.tenantId, ctx.runId, sourceType).first<CheckpointRow>();
  if (!row) {
    const publicId = await createDeterministicSourceId(
      'chk', ctx.tenantId, 'service_operations_backfill', `${ctx.runPublicId}:${sourceType}`,
    );
    await ctx.db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'service_operations',?,'','running',?,?,?)
    `).bind(
      ctx.tenantId, publicId, ctx.runId, sourceType,
      ctx.nowUtc, ctx.nowUtc, ctx.nowUtc,
    ).run();
    row = await ctx.db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='service_operations'
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(ctx.tenantId, ctx.runId, sourceType).first<CheckpointRow>();
  }
  if (!row) throw new Error(`Failed to create service operations checkpoint for ${sourceType}`);
  if (row.status === 'paused') {
    await ctx.db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET status='running',completed_at_utc=NULL,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(ctx.nowUtc, ctx.tenantId, row.id).run();
    row.status = 'running';
  }
  return row;
}

function progress(
  ctx: Context,
  cp: CheckpointRow,
  cursor: string,
  created = 0,
  mapped = 0,
  skipped = 0,
  exceptions = 0,
): ServiceOperationsPreparedStatement {
  return ctx.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,scanned_count=scanned_count+1,created_count=created_count+?,
        mapped_count=mapped_count+?,skipped_count=skipped_count+?,
        exception_count=exception_count+?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(cursor, created, mapped, skipped, exceptions, ctx.nowUtc, ctx.tenantId, cp.id);
}

async function mapping(
  ctx: Context,
  entityType: 'service_request' | 'service_event',
  sourceType: string,
  sourceId: string,
): Promise<MappingRow | null> {
  return ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(ctx.tenantId, entityType, sourceType, sourceId).first<MappingRow>();
}

async function canonicalMapping(
  ctx: Context,
  entityType: string,
  sourceType: string,
  sourceId: number | string | null | undefined,
): Promise<string | null> {
  if (sourceId == null) return null;
  const row = await ctx.db.prepare(`
    SELECT canonical_public_id FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
      AND mapping_status='mapped' LIMIT 1
  `).bind(ctx.tenantId, entityType, sourceType, String(sourceId)).first<{ canonical_public_id: string | null }>();
  return row?.canonical_public_id ?? null;
}

function mapStatement(
  ctx: Context,
  entityType: 'service_request' | 'service_event',
  canonicalId: string | null,
  sourceType: string,
  sourceId: string,
  sourceTable: string,
  status: 'mapped' | 'ambiguous' | 'rejected',
  evidence: string,
): ServiceOperationsPreparedStatement {
  return ctx.db.prepare(`
    INSERT OR IGNORE INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)
  `).bind(
    ctx.tenantId, entityType, canonicalId, sourceType, sourceId, sourceTable,
    status, ctx.runId, evidence, ctx.nowUtc, ctx.nowUtc,
  );
}

async function issue(
  ctx: Context,
  code: string,
  sourceType: string,
  sourceId: string | null,
  key: string,
  summary: string,
  details?: Record<string, number | string>,
): Promise<ServiceOperationsPreparedStatement> {
  const fingerprint = await createDeterministicSourceId('fp', ctx.tenantId, code, key);
  const issuePublicId = await createDeterministicSourceId('iss', ctx.tenantId, code, key);
  return ctx.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'service_operations_backfill',?,'service_operation',?,?,?,
              'error','open',1,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      details_json=excluded.details_json,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    ctx.tenantId, issuePublicId, ctx.runId, code, sourceType, sourceId,
    fingerprint, summary, details ? JSON.stringify(details) : null,
    ctx.nowUtc, ctx.nowUtc, ctx.nowUtc, ctx.nowUtc,
  );
}

async function skip(ctx: Context, cp: CheckpointRow, sourceId: string): Promise<void> {
  await ctx.db.batch([progress(ctx, cp, sourceId, 0, 0, 1, 0)]);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function handleExisting(
  ctx: Context,
  cp: CheckpointRow,
  entityType: 'service_request' | 'service_event',
  sourceType: string,
  sourceId: string,
  evidence: string,
): Promise<boolean> {
  const prior = await mapping(ctx, entityType, sourceType, sourceId);
  if (!prior) return false;
  if (prior.evidence_sha256 !== evidence) {
    await ctx.db.batch([
      await issue(
        ctx,
        'SERVICE_OPERATION_SOURCE_EVIDENCE_CHANGED',
        sourceType,
        sourceId,
        `${sourceType}:${sourceId}:evidence-changed`,
        'Previously mapped service operation evidence changed and requires review.',
      ),
      progress(ctx, cp, sourceId, 0, 0, 1, 1),
    ]);
    ctx.scanned += 1;
    ctx.remaining -= 1;
    return true;
  }
  await skip(ctx, cp, sourceId);
  return true;
}

function requestStatement(
  ctx: Context,
  input: {
    publicId: string;
    patientId: number;
    encounterId: string | null;
    serviceId: string;
    requestedQuantity: number;
    fulfilledQuantity: number;
    status: string;
    requestedAtUtc: string;
    cancelledAtUtc?: string | null;
    evidence: string;
  },
): ServiceOperationsPreparedStatement {
  return ctx.db.prepare(`
    INSERT OR IGNORE INTO canonical_service_requests (
      tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
      service_public_id,requested_quantity,fulfilled_quantity,status,
      requested_at_utc,cancelled_at_utc,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    ctx.tenantId, input.publicId, input.patientId, input.encounterId,
    input.serviceId, input.requestedQuantity, input.fulfilledQuantity,
    input.status, input.requestedAtUtc, input.cancelledAtUtc ?? null,
    input.evidence, ctx.nowUtc, ctx.nowUtc,
  );
}

function eventStatement(
  ctx: Context,
  input: {
    publicId: string;
    requestId: string | null;
    encounterId: string | null;
    serviceId: string;
    eventType: string;
    quantity: number;
    occurredAtUtc: string;
    evidence: string;
  },
): ServiceOperationsPreparedStatement {
  return ctx.db.prepare(`
    INSERT OR IGNORE INTO canonical_service_events (
      tenant_id,event_public_id,request_public_id,encounter_public_id,
      service_public_id,event_type,quantity,status,occurred_at_utc,
      source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,'posted',?,?,?,?)
  `).bind(
    ctx.tenantId, input.publicId, input.requestId, input.encounterId,
    input.serviceId, input.eventType, input.quantity, input.occurredAtUtc,
    input.evidence, ctx.nowUtc, ctx.nowUtc,
  );
}

async function participant(
  ctx: Context,
  input: {
    requestId?: string | null;
    eventId?: string | null;
    doctorId: number | null;
    role: string;
    evidenceType: string;
    sourceType: string;
    sourceId: string;
  },
): Promise<{ statements: ServiceOperationsPreparedStatement[]; count: number; exceptions: number }> {
  if (input.doctorId == null) return { statements: [], count: 0, exceptions: 0 };
  const practitionerId = await canonicalMapping(
    ctx, 'practitioner', 'legacy_doctor', input.doctorId,
  );
  if (!practitionerId) {
    return {
      statements: [await issue(
        ctx,
        'SERVICE_OPERATION_PRACTITIONER_UNRESOLVED',
        input.sourceType,
        input.sourceId,
        `${input.sourceType}:${input.sourceId}:doctor:${input.doctorId}:${input.role}`,
        'Service operation practitioner source has no canonical practitioner mapping.',
      )],
      count: 0,
      exceptions: 1,
    };
  }
  return {
    statements: [ctx.db.prepare(`
      INSERT OR IGNORE INTO canonical_service_participants (
        tenant_id,request_public_id,event_public_id,practitioner_public_id,
        participant_role,evidence_type,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      ctx.tenantId, input.requestId ?? null, input.eventId ?? null,
      practitionerId, input.role, input.evidenceType, ctx.nowUtc, ctx.nowUtc,
    )],
    count: 1,
    exceptions: 0,
  };
}

async function unresolved(
  ctx: Context,
  cp: CheckpointRow,
  sourceType: string,
  sourceId: string,
  sourceTable: string,
  evidence: string,
  code: string,
  summary: string,
  entityType: 'service_request' | 'service_event' = 'service_request',
): Promise<void> {
  await ctx.db.batch([
    mapStatement(ctx, entityType, null, sourceType, sourceId, sourceTable, 'ambiguous', evidence),
    await issue(ctx, code, sourceType, sourceId, `${sourceType}:${sourceId}:${code}`, summary),
    progress(ctx, cp, sourceId, 0, 1, 0, 1),
  ]);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

function isDeliveredLab(row: LabItemRow): boolean {
  const itemStatus = row.item_status?.toLowerCase();
  const resultStatus = row.result_status?.toLowerCase();
  return Boolean(
    row.completed_at || row.verified_at
    || itemStatus === 'completed' || itemStatus === 'verified'
    || resultStatus === 'validated' || resultStatus === 'verified',
  );
}

async function processLab(ctx: Context, cp: CheckpointRow, row: LabItemRow): Promise<void> {
  const sourceId = String(row.id);
  const delivered = isDeliveredLab(row);
  const requestedAt = legacyUtc(row.order_date ?? row.order_created_at, ctx.nowUtc);
  const occurredAt = delivered
    ? legacyUtc(row.verified_at ?? row.completed_at ?? row.item_updated_at, requestedAt)
    : null;
  const evidence = await createSourceEvidenceSha256({
    sourceType: SRC_LAB,
    sourcePublicId: sourceId,
    orderId: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    labTestId: row.lab_test_id,
    orderStatus: row.order_status,
    itemStatus: row.item_status,
    resultStatus: row.result_status,
    completedAtUtc: occurredAt,
    orderedBy: row.ordered_by,
    processedBy: row.processed_by,
    verifiedBy: row.verified_by,
  });
  if (await handleExisting(ctx, cp, 'service_request', SRC_LAB, sourceId, evidence)) return;

  const serviceId = await canonicalMapping(
    ctx, 'service_catalog_item', 'legacy_lab_test', row.lab_test_id,
  );
  if (!serviceId) {
    await unresolved(
      ctx, cp, SRC_LAB, sourceId, 'lab_order_items', evidence,
      'SERVICE_OPERATION_CATALOG_UNRESOLVED',
      'Laboratory order item has no canonical service catalog mapping.',
    );
    return;
  }
  const encounterId = await canonicalMapping(ctx, 'encounter', 'legacy_visit', row.visit_id);
  const requestId = await createDeterministicSourceId('req', ctx.tenantId, SRC_LAB, sourceId);
  const eventId = delivered
    ? await createDeterministicSourceId('evt', ctx.tenantId, SRC_LAB, sourceId)
    : null;
  const cancelled = ['cancelled', 'rejected'].includes(row.item_status?.toLowerCase() ?? '');
  const requestStatus = cancelled ? 'cancelled' : delivered ? 'fulfilled' : 'active';
  const statements: ServiceOperationsPreparedStatement[] = [
    requestStatement(ctx, {
      publicId: requestId,
      patientId: row.patient_id,
      encounterId,
      serviceId,
      requestedQuantity: 1,
      fulfilledQuantity: delivered ? 1 : 0,
      status: requestStatus,
      requestedAtUtc: requestedAt,
      cancelledAtUtc: cancelled ? legacyUtc(row.item_updated_at, ctx.nowUtc) : null,
      evidence,
    }),
    mapStatement(ctx, 'service_request', requestId, SRC_LAB, sourceId, 'lab_order_items', 'mapped', evidence),
  ];
  let created = 1;
  let mapped = 1;
  let participants = 0;
  let exceptions = 0;
  const ordering = await participant(ctx, {
    requestId,
    doctorId: row.ordered_by,
    role: 'ordering',
    evidenceType: 'legacy_lab_orderer',
    sourceType: SRC_LAB,
    sourceId,
  });
  statements.push(...ordering.statements);
  participants += ordering.count;
  exceptions += ordering.exceptions;
  if (!encounterId && row.visit_id != null) {
    statements.push(await issue(
      ctx,
      'SERVICE_OPERATION_ENCOUNTER_UNRESOLVED',
      SRC_LAB,
      sourceId,
      `${SRC_LAB}:${sourceId}:visit:${row.visit_id}`,
      'Laboratory request visit has no canonical encounter mapping.',
    ));
    exceptions += 1;
  }
  if (eventId && occurredAt) {
    statements.push(
      eventStatement(ctx, {
        publicId: eventId,
        requestId,
        encounterId,
        serviceId,
        eventType: 'completed',
        quantity: 1,
        occurredAtUtc: occurredAt,
        evidence,
      }),
      mapStatement(ctx, 'service_event', eventId, SRC_LAB, sourceId, 'lab_order_items', 'mapped', evidence),
    );
    created += 1;
    mapped += 1;
    const performing = await participant(ctx, {
      eventId,
      doctorId: row.processed_by,
      role: 'performing',
      evidenceType: 'legacy_lab_processor',
      sourceType: SRC_LAB,
      sourceId,
    });
    const approving = await participant(ctx, {
      eventId,
      doctorId: row.verified_by,
      role: 'approving',
      evidenceType: 'legacy_lab_verifier',
      sourceType: SRC_LAB,
      sourceId,
    });
    statements.push(...performing.statements, ...approving.statements);
    participants += performing.count + approving.count;
    exceptions += performing.exceptions + approving.exceptions;
  }
  statements.push(progress(ctx, cp, sourceId, created + participants, mapped, 0, exceptions));
  await ctx.db.batch(statements);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function processRadiology(ctx: Context, cp: CheckpointRow, row: RadiologyRow): Promise<void> {
  const sourceId = String(row.id);
  const delivered = Boolean(
    row.is_scanned === 1 || row.is_report_saved === 1
    || ['completed', 'reported', 'verified'].includes(row.order_status?.toLowerCase() ?? ''),
  );
  const requestedAt = legacyUtc(row.created_at, ctx.nowUtc);
  const occurredAt = delivered ? legacyUtc(row.scanned_on ?? row.updated_at, requestedAt) : null;
  const evidence = await createSourceEvidenceSha256({
    sourceType: SRC_RAD,
    sourcePublicId: sourceId,
    patientId: row.patient_id,
    visitId: row.visit_id,
    admissionId: row.admission_id,
    imagingItemId: row.imaging_item_id,
    prescriberId: row.prescriber_id,
    orderStatus: row.order_status,
    scanned: row.is_scanned,
    reportSaved: row.is_report_saved,
    scannedOnUtc: occurredAt,
  });
  if (await handleExisting(ctx, cp, 'service_request', SRC_RAD, sourceId, evidence)) return;
  const serviceId = await canonicalMapping(
    ctx, 'service_catalog_item', 'legacy_radiology_item', row.imaging_item_id,
  );
  if (!serviceId) {
    await unresolved(
      ctx, cp, SRC_RAD, sourceId, 'radiology_requisitions', evidence,
      'SERVICE_OPERATION_CATALOG_UNRESOLVED',
      'Radiology requisition has no canonical service catalog mapping.',
    );
    return;
  }
  const encounterId = await canonicalMapping(ctx, 'encounter', 'legacy_visit', row.visit_id)
    ?? await canonicalMapping(ctx, 'encounter', 'legacy_admission', row.admission_id);
  const requestId = await createDeterministicSourceId('req', ctx.tenantId, SRC_RAD, sourceId);
  const eventId = delivered
    ? await createDeterministicSourceId('evt', ctx.tenantId, SRC_RAD, sourceId)
    : null;
  const cancelled = row.is_active === 0
    || ['cancelled', 'rejected'].includes(row.order_status?.toLowerCase() ?? '');
  const statements: ServiceOperationsPreparedStatement[] = [
    requestStatement(ctx, {
      publicId: requestId,
      patientId: row.patient_id,
      encounterId,
      serviceId,
      requestedQuantity: 1,
      fulfilledQuantity: delivered ? 1 : 0,
      status: cancelled ? 'cancelled' : delivered ? 'fulfilled' : 'active',
      requestedAtUtc: requestedAt,
      cancelledAtUtc: cancelled ? legacyUtc(row.updated_at, ctx.nowUtc) : null,
      evidence,
    }),
    mapStatement(ctx, 'service_request', requestId, SRC_RAD, sourceId, 'radiology_requisitions', 'mapped', evidence),
  ];
  let created = 1;
  let mapped = 1;
  let participants = 0;
  let exceptions = 0;
  const prescriber = await participant(ctx, {
    requestId,
    doctorId: row.prescriber_id,
    role: 'prescribing',
    evidenceType: 'legacy_radiology_prescriber',
    sourceType: SRC_RAD,
    sourceId,
  });
  statements.push(...prescriber.statements);
  participants += prescriber.count;
  exceptions += prescriber.exceptions;
  if (!encounterId && (row.visit_id != null || row.admission_id != null)) {
    statements.push(await issue(
      ctx,
      'SERVICE_OPERATION_ENCOUNTER_UNRESOLVED',
      SRC_RAD,
      sourceId,
      `${SRC_RAD}:${sourceId}:encounter`,
      'Radiology requisition has no canonical encounter mapping.',
    ));
    exceptions += 1;
  }
  if (eventId && occurredAt) {
    statements.push(
      eventStatement(ctx, {
        publicId: eventId,
        requestId,
        encounterId,
        serviceId,
        eventType: 'completed',
        quantity: 1,
        occurredAtUtc: occurredAt,
        evidence,
      }),
      mapStatement(ctx, 'service_event', eventId, SRC_RAD, sourceId, 'radiology_requisitions', 'mapped', evidence),
    );
    created += 1;
    mapped += 1;
    const performer = await participant(ctx, {
      eventId,
      doctorId: integerId(row.scanned_by),
      role: 'performing',
      evidenceType: 'legacy_radiology_performer',
      sourceType: SRC_RAD,
      sourceId,
    });
    statements.push(...performer.statements);
    participants += performer.count;
    exceptions += performer.exceptions;
  }
  statements.push(progress(ctx, cp, sourceId, created + participants, mapped, 0, exceptions));
  await ctx.db.batch(statements);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function consultationCatalog(
  ctx: Context,
  doctorId: number,
): Promise<{ serviceId: string | null; candidateCount: number }> {
  const fees = await all<{ id: number }>(ctx.db.prepare(`
    SELECT id FROM doctor_appointment_fees
    WHERE CAST(tenant_id AS TEXT)=? AND doctor_id=? AND is_active=1 ORDER BY id
  `).bind(ctx.tenantId, doctorId));
  if (fees.length !== 1) return { serviceId: null, candidateCount: fees.length };
  return {
    serviceId: await canonicalMapping(
      ctx, 'service_catalog_item', 'legacy_consultation_fee', fees[0].id,
    ),
    candidateCount: 1,
  };
}

async function processConsultation(
  ctx: Context,
  cp: CheckpointRow,
  row: ConsultationRow,
): Promise<void> {
  const sourceId = String(row.id);
  const requestedAt = legacyUtc(row.scheduled_at, ctx.nowUtc);
  const status = row.status.toLowerCase();
  const delivered = status === 'completed';
  const accepted = status === 'in_progress';
  const evidence = await createSourceEvidenceSha256({
    sourceType: SRC_CONSULT,
    sourcePublicId: sourceId,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    scheduledAtUtc: requestedAt,
    status,
    updatedAt: row.updated_at,
  });
  if (await handleExisting(ctx, cp, 'service_request', SRC_CONSULT, sourceId, evidence)) return;
  const catalog = await consultationCatalog(ctx, row.doctor_id);
  if (!catalog.serviceId) {
    const ambiguous = catalog.candidateCount > 1;
    await unresolved(
      ctx, cp, SRC_CONSULT, sourceId, 'consultations', evidence,
      ambiguous
        ? 'SERVICE_OPERATION_CATALOG_AMBIGUOUS'
        : 'SERVICE_OPERATION_CATALOG_UNRESOLVED',
      ambiguous
        ? 'Consultation has multiple active catalog candidates.'
        : 'Consultation has no uniquely mapped service catalog candidate.',
    );
    return;
  }
  const encounterId = await canonicalMapping(
    ctx, 'encounter', 'legacy_consultation', row.id,
  );
  const requestId = await createDeterministicSourceId('req', ctx.tenantId, SRC_CONSULT, sourceId);
  const eventId = delivered || accepted
    ? await createDeterministicSourceId('evt', ctx.tenantId, SRC_CONSULT, sourceId)
    : null;
  const cancelled = status === 'cancelled';
  const statements: ServiceOperationsPreparedStatement[] = [
    requestStatement(ctx, {
      publicId: requestId,
      patientId: row.patient_id,
      encounterId,
      serviceId: catalog.serviceId,
      requestedQuantity: 1,
      fulfilledQuantity: delivered ? 1 : 0,
      status: cancelled ? 'cancelled' : delivered ? 'fulfilled' : status === 'scheduled' ? 'planned' : 'active',
      requestedAtUtc: requestedAt,
      cancelledAtUtc: cancelled ? legacyUtc(row.updated_at, ctx.nowUtc) : null,
      evidence,
    }),
    mapStatement(ctx, 'service_request', requestId, SRC_CONSULT, sourceId, 'consultations', 'mapped', evidence),
  ];
  let created = 1;
  let mapped = 1;
  let participants = 0;
  let exceptions = 0;
  if (eventId) {
    statements.push(
      eventStatement(ctx, {
        publicId: eventId,
        requestId,
        encounterId,
        serviceId: catalog.serviceId,
        eventType: delivered ? 'completed' : 'accepted',
        quantity: 1,
        occurredAtUtc: legacyUtc(row.updated_at ?? row.scheduled_at, requestedAt),
        evidence,
      }),
      mapStatement(ctx, 'service_event', eventId, SRC_CONSULT, sourceId, 'consultations', 'mapped', evidence),
    );
    created += 1;
    mapped += 1;
    const performer = await participant(ctx, {
      eventId,
      doctorId: row.doctor_id,
      role: 'performing',
      evidenceType: 'legacy_consultation_doctor',
      sourceType: SRC_CONSULT,
      sourceId,
    });
    statements.push(...performer.statements);
    participants += performer.count;
    exceptions += performer.exceptions;
  }
  statements.push(progress(ctx, cp, sourceId, created + participants, mapped, 0, exceptions));
  await ctx.db.batch(statements);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function processProcedure(
  ctx: Context,
  cp: CheckpointRow,
  row: ProcedureRow,
): Promise<void> {
  const sourceId = String(row.id);
  const requestedAt = legacyUtc(row.ordered_at ?? row.created_at, ctx.nowUtc);
  const delivered = Boolean(
    row.performed_at || ['performed', 'completed'].includes(row.status?.toLowerCase() ?? ''),
  );
  const evidence = await createSourceEvidenceSha256({
    sourceType: SRC_PROC,
    sourcePublicId: sourceId,
    patientId: row.patient_id,
    visitId: row.visit_id,
    serviceItemId: row.service_item_id,
    orderedBy: row.ordered_by,
    performedBy: row.performed_by,
    status: row.status,
    performedAt: row.performed_at,
  });
  if (await handleExisting(ctx, cp, 'service_request', SRC_PROC, sourceId, evidence)) return;
  const serviceId = await canonicalMapping(
    ctx, 'service_catalog_item', 'legacy_billing_service_item', row.service_item_id,
  );
  if (!serviceId) {
    await unresolved(
      ctx, cp, SRC_PROC, sourceId, 'procedure_orders', evidence,
      'SERVICE_OPERATION_CATALOG_UNRESOLVED',
      'Procedure order has no canonical service catalog mapping.',
    );
    return;
  }
  const encounterId = await canonicalMapping(ctx, 'encounter', 'legacy_visit', row.visit_id);
  const requestId = await createDeterministicSourceId('req', ctx.tenantId, SRC_PROC, sourceId);
  const eventId = delivered
    ? await createDeterministicSourceId('evt', ctx.tenantId, SRC_PROC, sourceId)
    : null;
  const cancelled = ['cancelled', 'rejected'].includes(row.status?.toLowerCase() ?? '');
  const statements: ServiceOperationsPreparedStatement[] = [
    requestStatement(ctx, {
      publicId: requestId,
      patientId: row.patient_id,
      encounterId,
      serviceId,
      requestedQuantity: 1,
      fulfilledQuantity: delivered ? 1 : 0,
      status: cancelled ? 'cancelled' : delivered ? 'fulfilled' : 'active',
      requestedAtUtc: requestedAt,
      cancelledAtUtc: cancelled ? legacyUtc(row.updated_at, ctx.nowUtc) : null,
      evidence,
    }),
    mapStatement(ctx, 'service_request', requestId, SRC_PROC, sourceId, 'procedure_orders', 'mapped', evidence),
  ];
  let created = 1;
  let mapped = 1;
  let participants = 0;
  let exceptions = 0;
  const ordering = await participant(ctx, {
    requestId,
    doctorId: row.ordered_by,
    role: 'ordering',
    evidenceType: 'legacy_procedure_orderer',
    sourceType: SRC_PROC,
    sourceId,
  });
  statements.push(...ordering.statements);
  participants += ordering.count;
  exceptions += ordering.exceptions;
  if (!encounterId && row.visit_id != null) {
    statements.push(await issue(
      ctx,
      'SERVICE_OPERATION_ENCOUNTER_UNRESOLVED',
      SRC_PROC,
      sourceId,
      `${SRC_PROC}:${sourceId}:visit:${row.visit_id}`,
      'Procedure order visit has no canonical encounter mapping.',
    ));
    exceptions += 1;
  }
  if (eventId) {
    statements.push(
      eventStatement(ctx, {
        publicId: eventId,
        requestId,
        encounterId,
        serviceId,
        eventType: 'completed',
        quantity: 1,
        occurredAtUtc: legacyUtc(row.performed_at ?? row.updated_at, requestedAt),
        evidence,
      }),
      mapStatement(ctx, 'service_event', eventId, SRC_PROC, sourceId, 'procedure_orders', 'mapped', evidence),
    );
    created += 1;
    mapped += 1;
    const performer = await participant(ctx, {
      eventId,
      doctorId: row.performed_by,
      role: 'performing',
      evidenceType: 'legacy_procedure_performer',
      sourceType: SRC_PROC,
      sourceId,
    });
    statements.push(...performer.statements);
    participants += performer.count;
    exceptions += performer.exceptions;
  }
  statements.push(progress(ctx, cp, sourceId, created + participants, mapped, 0, exceptions));
  await ctx.db.batch(statements);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function processBedReservation(
  ctx: Context,
  cp: CheckpointRow,
  row: BedReservationRow,
): Promise<void> {
  const sourceId = String(row.id);
  const requestedAt = legacyUtc(row.reserved_from ?? row.created_at, ctx.nowUtc);
  const evidence = await createSourceEvidenceSha256({
    sourceType: SRC_BED_RES,
    sourcePublicId: sourceId,
    patientId: row.patient_id,
    bedId: row.bed_id,
    reservedFromUtc: requestedAt,
    reservedTo: row.reserved_to,
    status: row.status,
  });
  if (await handleExisting(ctx, cp, 'service_request', SRC_BED_RES, sourceId, evidence)) return;
  const serviceId = await canonicalMapping(
    ctx, 'service_catalog_item', 'legacy_bed', row.bed_id,
  );
  if (!serviceId) {
    await unresolved(
      ctx, cp, SRC_BED_RES, sourceId, 'bed_reservations', evidence,
      'SERVICE_OPERATION_CATALOG_UNRESOLVED',
      'Bed reservation has no canonical bed service mapping.',
    );
    return;
  }
  const requestId = await createDeterministicSourceId('req', ctx.tenantId, SRC_BED_RES, sourceId);
  const cancelled = ['cancelled', 'expired'].includes(row.status.toLowerCase());
  await ctx.db.batch([
    requestStatement(ctx, {
      publicId: requestId,
      patientId: row.patient_id,
      encounterId: null,
      serviceId,
      requestedQuantity: 1,
      fulfilledQuantity: 0,
      status: cancelled ? 'cancelled' : 'active',
      requestedAtUtc: requestedAt,
      cancelledAtUtc: cancelled ? legacyUtc(row.updated_at, ctx.nowUtc) : null,
      evidence,
    }),
    mapStatement(ctx, 'service_request', requestId, SRC_BED_RES, sourceId, 'bed_reservations', 'mapped', evidence),
    progress(ctx, cp, sourceId, 1, 1, 0, 0),
  ]);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function processBedStay(ctx: Context, cp: CheckpointRow, row: BedStayRow): Promise<void> {
  const sourceId = String(row.id);
  const started = legacyUtc(row.started_on, ctx.nowUtc);
  const quantity = Math.max(1, Number.isSafeInteger(row.days) ? Number(row.days) : 1);
  const evidence = await createSourceEvidenceSha256({
    sourceType: SRC_BED_STAY,
    sourcePublicId: sourceId,
    patientId: row.patient_id,
    admissionId: row.admission_id,
    bedId: row.bed_id,
    startedAtUtc: started,
    endedOn: row.ended_on,
    days: row.days,
  });
  if (await handleExisting(ctx, cp, 'service_event', SRC_BED_STAY, sourceId, evidence)) return;
  const serviceId = await canonicalMapping(
    ctx, 'service_catalog_item', 'legacy_bed', row.bed_id,
  );
  if (!serviceId) {
    await unresolved(
      ctx, cp, SRC_BED_STAY, sourceId, 'patient_bed_infos', evidence,
      'SERVICE_OPERATION_CATALOG_UNRESOLVED',
      'Bed stay has no canonical bed service mapping.',
      'service_event',
    );
    return;
  }
  const encounterId = await canonicalMapping(
    ctx, 'encounter', 'legacy_admission', row.admission_id,
  );
  if (!encounterId) {
    await ctx.db.batch([
      mapStatement(ctx, 'service_event', null, SRC_BED_STAY, sourceId, 'patient_bed_infos', 'ambiguous', evidence),
      await issue(
        ctx,
        'SERVICE_OPERATION_ENCOUNTER_UNRESOLVED',
        SRC_BED_STAY,
        sourceId,
        `${SRC_BED_STAY}:${sourceId}:admission:${row.admission_id}`,
        'Bed stay admission has no canonical encounter mapping.',
      ),
      progress(ctx, cp, sourceId, 0, 1, 0, 1),
    ]);
    ctx.scanned += 1;
    ctx.remaining -= 1;
    return;
  }
  const eventId = await createDeterministicSourceId('evt', ctx.tenantId, SRC_BED_STAY, sourceId);
  await ctx.db.batch([
    eventStatement(ctx, {
      publicId: eventId,
      requestId: null,
      encounterId,
      serviceId,
      eventType: 'occupied',
      quantity,
      occurredAtUtc: started,
      evidence,
    }),
    mapStatement(ctx, 'service_event', eventId, SRC_BED_STAY, sourceId, 'patient_bed_infos', 'mapped', evidence),
    progress(ctx, cp, sourceId, 1, 1, 0, 0),
  ]);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function processPrescriptionItem(
  ctx: Context,
  cp: CheckpointRow,
  row: PrescriptionItemRow,
): Promise<void> {
  const sourceId = String(row.id);
  const requestedQuantity = Number(row.quantity ?? 0);
  const fulfilledQuantity = Math.max(0, Number(row.dispensed_qty ?? 0));
  const requestedAt = legacyUtc(row.prescription_created_at, ctx.nowUtc);
  const evidence = await createSourceEvidenceSha256({
    sourceType: SRC_RX_ITEM,
    sourcePublicId: sourceId,
    prescriptionId: row.prescription_id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    appointmentId: row.appointment_id,
    admissionId: row.admission_id,
    medicineId: row.medicine_id,
    quantity: requestedQuantity,
    dispensedQuantity: fulfilledQuantity,
    prescriptionStatus: row.prescription_status,
    dispenseStatus: row.dispense_status,
  });
  if (await handleExisting(ctx, cp, 'service_request', SRC_RX_ITEM, sourceId, evidence)) return;
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0
      || !Number.isSafeInteger(fulfilledQuantity) || fulfilledQuantity > requestedQuantity) {
    await unresolved(
      ctx, cp, SRC_RX_ITEM, sourceId, 'prescription_items', evidence,
      'SERVICE_OPERATION_QUANTITY_INVALID',
      'Prescription item quantity is invalid or dispensed quantity exceeds requested quantity.',
    );
    return;
  }
  const serviceId = await canonicalMapping(
    ctx, 'service_catalog_item', 'legacy_medicine', row.medicine_id,
  );
  if (!serviceId) {
    await unresolved(
      ctx, cp, SRC_RX_ITEM, sourceId, 'prescription_items', evidence,
      'SERVICE_OPERATION_CATALOG_UNRESOLVED',
      'Prescription item has no explicit medicine catalog mapping.',
    );
    return;
  }
  const encounterId = await canonicalMapping(
    ctx, 'encounter', 'legacy_admission', row.admission_id,
  ) ?? await canonicalMapping(ctx, 'encounter', 'legacy_appointment', row.appointment_id);
  const requestId = await createDeterministicSourceId('req', ctx.tenantId, SRC_RX_ITEM, sourceId);
  const eventId = fulfilledQuantity > 0
    ? await createDeterministicSourceId('evt', ctx.tenantId, SRC_RX_ITEM, sourceId)
    : null;
  const cancelled = ['cancelled', 'void'].includes(row.prescription_status?.toLowerCase() ?? '');
  const status = cancelled
    ? 'cancelled'
    : fulfilledQuantity === requestedQuantity
      ? 'fulfilled'
      : fulfilledQuantity > 0
        ? 'partially_fulfilled'
        : 'active';
  const statements: ServiceOperationsPreparedStatement[] = [
    requestStatement(ctx, {
      publicId: requestId,
      patientId: row.patient_id,
      encounterId,
      serviceId,
      requestedQuantity,
      fulfilledQuantity,
      status,
      requestedAtUtc: requestedAt,
      cancelledAtUtc: cancelled ? legacyUtc(row.prescription_updated_at, ctx.nowUtc) : null,
      evidence,
    }),
    mapStatement(ctx, 'service_request', requestId, SRC_RX_ITEM, sourceId, 'prescription_items', 'mapped', evidence),
  ];
  let created = 1;
  let mapped = 1;
  let participants = 0;
  let exceptions = 0;
  const prescribing = await participant(ctx, {
    requestId,
    doctorId: row.doctor_id,
    role: 'prescribing',
    evidenceType: 'legacy_prescription_doctor',
    sourceType: SRC_RX_ITEM,
    sourceId,
  });
  statements.push(...prescribing.statements);
  participants += prescribing.count;
  exceptions += prescribing.exceptions;
  if (!encounterId && (row.admission_id != null || row.appointment_id != null)) {
    statements.push(await issue(
      ctx,
      'SERVICE_OPERATION_ENCOUNTER_UNRESOLVED',
      SRC_RX_ITEM,
      sourceId,
      `${SRC_RX_ITEM}:${sourceId}:encounter`,
      'Prescription item has no canonical encounter mapping.',
    ));
    exceptions += 1;
  }
  if (eventId) {
    statements.push(
      eventStatement(ctx, {
        publicId: eventId,
        requestId,
        encounterId,
        serviceId,
        eventType: 'dispensed',
        quantity: fulfilledQuantity,
        occurredAtUtc: legacyUtc(row.prescription_updated_at, requestedAt),
        evidence,
      }),
      mapStatement(ctx, 'service_event', eventId, SRC_RX_ITEM, sourceId, 'prescription_items', 'mapped', evidence),
    );
    created += 1;
    mapped += 1;
  }
  statements.push(progress(ctx, cp, sourceId, created + participants, mapped, 0, exceptions));
  await ctx.db.batch(statements);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

async function runPhase<T extends { id: number }>(
  ctx: Context,
  sourceType: string,
  rows: T[],
  processor: (ctx: Context, cp: CheckpointRow, row: T) => Promise<void>,
): Promise<boolean> {
  const cp = await checkpoint(ctx, sourceType);
  if (cp.status === 'completed') return true;
  const cursor = Number(cp.cursor_value ?? 0);
  for (const row of rows.filter((candidate) => candidate.id > cursor)) {
    if (ctx.remaining <= 0) {
      await ctx.db.prepare(`
        UPDATE canonical_backfill_checkpoints
        SET status='paused',completed_at_utc=NULL,updated_at_utc=?
        WHERE tenant_id=? AND id=?
      `).bind(ctx.nowUtc, ctx.tenantId, cp.id).run();
      return false;
    }
    await processor(ctx, cp, row);
  }
  await ctx.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='completed',completed_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(ctx.nowUtc, ctx.nowUtc, ctx.tenantId, cp.id).run();
  return true;
}

export async function backfillServiceOperations(
  db: ServiceOperationsBackfillDatabase,
  options: ServiceOperationsBackfillOptions,
): Promise<ServiceOperationsBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const start = await capture(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  if (run.status === 'succeeded') return result(db, tenantId, start, 0, true);
  const ctx: Context = {
    db,
    tenantId,
    runId: run.id,
    runPublicId,
    nowUtc,
    remaining: limit(options.maxSourceRecords),
    scanned: 0,
  };

  const lab = await all<LabItemRow>(db.prepare(`
    SELECT i.id,o.patient_id,o.visit_id,o.ordered_by,o.order_date,
           o.status order_status,o.created_at order_created_at,
           i.lab_test_id,i.status item_status,i.completed_at,i.processed_by,
           i.verified_by,i.verified_at,i.result_status,i.updated_at item_updated_at
    FROM lab_order_items i
    JOIN lab_orders o ON o.id=i.lab_order_id
      AND CAST(o.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
    WHERE CAST(i.tenant_id AS TEXT)=? ORDER BY i.id
  `).bind(tenantId));
  if (!await runPhase(ctx, SRC_LAB, lab, processLab)) {
    return result(db, tenantId, start, ctx.scanned, false);
  }

  const radiology = await all<RadiologyRow>(db.prepare(`
    SELECT id,patient_id,visit_id,admission_id,imaging_item_id,prescriber_id,
           order_status,is_report_saved,is_scanned,scanned_by,scanned_on,
           is_active,created_at,updated_at
    FROM radiology_requisitions
    WHERE CAST(tenant_id AS TEXT)=? ORDER BY id
  `).bind(tenantId));
  if (!await runPhase(ctx, SRC_RAD, radiology, processRadiology)) {
    return result(db, tenantId, start, ctx.scanned, false);
  }

  const consultations = await all<ConsultationRow>(db.prepare(`
    SELECT id,doctor_id,patient_id,scheduled_at,status,created_at,updated_at
    FROM consultations WHERE CAST(tenant_id AS TEXT)=? ORDER BY id
  `).bind(tenantId));
  if (!await runPhase(ctx, SRC_CONSULT, consultations, processConsultation)) {
    return result(db, tenantId, start, ctx.scanned, false);
  }

  const procedures = await all<ProcedureRow>(db.prepare(`
    SELECT id,patient_id,visit_id,service_item_id,ordered_by,performed_by,
           status,ordered_at,performed_at,created_at,updated_at
    FROM procedure_orders WHERE CAST(tenant_id AS TEXT)=? ORDER BY id
  `).bind(tenantId));
  if (!await runPhase(ctx, SRC_PROC, procedures, processProcedure)) {
    return result(db, tenantId, start, ctx.scanned, false);
  }

  const reservations = await all<BedReservationRow>(db.prepare(`
    SELECT id,patient_id,bed_id,reserved_from,reserved_to,status,created_at,updated_at
    FROM bed_reservations WHERE CAST(tenant_id AS TEXT)=? ORDER BY id
  `).bind(tenantId));
  if (!await runPhase(ctx, SRC_BED_RES, reservations, processBedReservation)) {
    return result(db, tenantId, start, ctx.scanned, false);
  }

  const bedStays = await all<BedStayRow>(db.prepare(`
    SELECT id,patient_id,admission_id,bed_id,started_on,ended_on,days,created_at
    FROM patient_bed_infos WHERE CAST(tenant_id AS TEXT)=? ORDER BY id
  `).bind(tenantId));
  if (!await runPhase(ctx, SRC_BED_STAY, bedStays, processBedStay)) {
    return result(db, tenantId, start, ctx.scanned, false);
  }

  const prescriptionItems = await all<PrescriptionItemRow>(db.prepare(`
    SELECT i.id,i.prescription_id,p.patient_id,p.doctor_id,p.appointment_id,
           p.admission_id,p.status prescription_status,p.dispense_status,
           p.created_at prescription_created_at,p.updated_at prescription_updated_at,
           i.medicine_id,i.quantity,i.dispensed_qty
    FROM prescription_items i
    JOIN prescriptions p ON p.id=i.prescription_id
    WHERE CAST(p.tenant_id AS TEXT)=? ORDER BY i.id
  `).bind(tenantId));
  if (!await runPhase(ctx, SRC_RX_ITEM, prescriptionItems, processPrescriptionItem)) {
    return result(db, tenantId, start, ctx.scanned, false);
  }

  const out = await result(db, tenantId, start, ctx.scanned, true);
  await db.prepare(`
    UPDATE canonical_migration_runs
    SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(nowUtc, JSON.stringify(out.counts), nowUtc, tenantId, run.id).run();
  return out;
}

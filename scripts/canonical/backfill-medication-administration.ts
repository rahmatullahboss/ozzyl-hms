import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  cancelCanonicalMedicationReconciliation,
  createCanonicalMedicationReconciliationDraft,
  finalizeCanonicalMedicationReconciliation,
  recordCanonicalMedicationAdministrationEvent,
  type CanonicalMedicationAdministrationOutcome,
  type CanonicalMedicationReconciliationDecision,
  type CanonicalMedicationReconciliationItemInput,
  type CanonicalMedicationReconciliationItemSourceKind,
} from '../../src/lib/canonical/commands/manage-medication-administration';
import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface MedicationAdministrationBackfillPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): MedicationAdministrationBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface MedicationAdministrationBackfillDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): MedicationAdministrationBackfillPreparedStatement;
  batch(statements: MedicationAdministrationBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface MedicationAdministrationBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  maxSourceRecords?: number;
}

export interface MedicationAdministrationBackfillCounts {
  scanned: number;
  administrationEventsCreated: number;
  reconciliationsCreated: number;
  reconciliationVersionsCreated: number;
  reconciliationItemsCreated: number;
  reconciliationStatusEventsCreated: number;
  mappingsCreated: number;
  skipped: number;
  issues: number;
}

export interface MedicationAdministrationBackfillResult {
  completed: boolean;
  counts: MedicationAdministrationBackfillCounts;
}

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface MedicationOrderRow {
  medication_order_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  current_status: string;
  status_version: number;
}
interface ReconciliationStateRow {
  reconciliation_public_id: string;
  current_version_public_id: string | null;
  current_status: 'draft' | 'final' | 'cancelled' | 'entered_in_error';
  status_version: number;
}
interface ReconciliationVersionRow {
  version_public_id: string;
  version_number: number;
  content_sha256: string;
}

interface StartingCounts {
  administrationEvents: number;
  reconciliations: number;
  versions: number;
  items: number;
  statusEvents: number;
  mappings: number;
  issues: number;
}

interface Context {
  db: MedicationAdministrationBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
  skipped: number;
}

interface Partition {
  sourceType: string;
  partitionKey: string;
  process(context: Context, checkpoint: CheckpointRow): Promise<boolean>;
}

interface ProcessOutcome {
  created?: boolean;
  mapped?: boolean;
  skipped?: boolean;
  issue?: boolean;
}

interface MarRow {
  id: number;
  patient_id: number;
  visit_id: number;
  dose: string | null;
  route: string | null;
  administered_on: string | null;
  administered_by: number | null;
  status: string | null;
  is_active: number;
  created_at: string | null;
  updated_by: number | null;
  updated_at: string | null;
  order_id: number | null;
  scheduled_time: string | null;
  actual_time: string | null;
  reason_not_given: string | null;
  barcode_scanned: number | null;
}

interface ReconciliationHeaderRow {
  id: number;
  patient_id: number;
  visit_id: number;
  reconciliation_type: 'admission' | 'transfer' | 'discharge';
  status: 'in_progress' | 'completed' | 'cancelled';
  performed_by: number;
  completed_at: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}

interface ReconciliationItemRow {
  id: number;
  reconciliation_id: number;
  medication_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  source: string | null;
  action: string;
  action_reason: string | null;
  new_dose: string | null;
  new_route: string | null;
  new_frequency: string | null;
  is_active: number;
  created_at: string | null;
}

const MIGRATION_NAME = 'CDB-124D medication administration backfill';
const ENTITY_TYPE = 'medication_administration_reconciliation';
const MAR_SOURCE = 'legacy_nur_medication_admin';
const RECON_SOURCE = 'legacy_cln_medication_reconciliation';
const RECON_ITEM_SOURCE = 'legacy_cln_medication_reconciliation_item';
const ADMIN_STATUSES = ['given', 'late', 'partially_given'] as const;
const NON_ADMIN_STATUSES = ['withheld', 'hold', 'refused', 'missed', 'not_given', 'omitted', 'not_available', 'cancelled'] as const;
const OUTCOME_STATUSES = [...ADMIN_STATUSES, ...NON_ADMIN_STATUSES] as const;

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function sourceLimit(value: number | undefined): number {
  if (value === undefined) return 1_000_000;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive safe integer');
  return value;
}

function normalizedUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  if (raw.endsWith('Z')) return toUtcIso(raw);
  return toUtcIso(`${raw.includes('T') ? raw : raw.replace(' ', 'T')}+06:00`);
}

function businessDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function cursorNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/^[A-Z]:/, ''));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function rows<T>(statement: MedicationAdministrationBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function count(
  db: MedicationAdministrationBackfillDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}

async function tableExists(db: MedicationAdministrationBackfillDatabase, table: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name=? LIMIT 1`).bind(table).first()) != null;
}

async function captureCounts(db: MedicationAdministrationBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    administrationEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_medication_administration_events WHERE tenant_id=?`, [tenantId]),
    reconciliations: await count(db, `SELECT COUNT(*) AS count FROM canonical_medication_reconciliations WHERE tenant_id=?`, [tenantId]),
    versions: await count(db, `SELECT COUNT(*) AS count FROM canonical_medication_reconciliation_versions WHERE tenant_id=?`, [tenantId]),
    items: await count(db, `SELECT COUNT(*) AS count FROM canonical_medication_reconciliation_items WHERE tenant_id=?`, [tenantId]),
    statusEvents: await count(db, `SELECT COUNT(*) AS count FROM canonical_medication_reconciliation_status_events WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type IN (
        'medication_administration_event','medication_reconciliation','medication_reconciliation_item'
      )
    `, [tenantId]),
    issues: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type=?
    `, [tenantId, ENTITY_TYPE]),
  };
}

async function resultFromDelta(
  context: Context,
  starting: StartingCounts,
  completed: boolean,
): Promise<MedicationAdministrationBackfillResult> {
  const ending = await captureCounts(context.db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      administrationEventsCreated: ending.administrationEvents - starting.administrationEvents,
      reconciliationsCreated: ending.reconciliations - starting.reconciliations,
      reconciliationVersionsCreated: ending.versions - starting.versions,
      reconciliationItemsCreated: ending.items - starting.items,
      reconciliationStatusEventsCreated: ending.statusEvents - starting.statusEvents,
      mappingsCreated: ending.mappings - starting.mappings,
      skipped: context.skipped,
      issues: ending.issues - starting.issues,
    },
  };
}

async function ensureRun(
  db: MedicationAdministrationBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<MigrationRunRow> {
  let run = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (run) return run;
  await db.prepare(`
    INSERT INTO canonical_migration_runs (
      tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'backfill','running',?,?,?)
  `).bind(tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc).run();
  run = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!run) throw new Error('failed to create medication administration backfill run');
  return run;
}

async function ensureCheckpoint(context: Context, partition: Partition): Promise<CheckpointRow> {
  let checkpoint = await context.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type=? AND source_type=? AND partition_key=?
    LIMIT 1
  `).bind(
    context.tenantId, context.runId, ENTITY_TYPE, partition.sourceType, partition.partitionKey,
  ).first<CheckpointRow>();
  if (checkpoint) return checkpoint;
  const checkpointPublicId = await createDeterministicSourceId(
    'medcp', context.tenantId, partition.sourceType, `${context.runPublicId}:${partition.partitionKey}`,
  );
  await context.db.prepare(`
    INSERT INTO canonical_backfill_checkpoints (
      tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
      partition_key,status,started_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,'pending',?,?,?)
  `).bind(
    context.tenantId, checkpointPublicId, context.runId, ENTITY_TYPE,
    partition.sourceType, partition.partitionKey, context.nowUtc, context.nowUtc, context.nowUtc,
  ).run();
  checkpoint = await context.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND checkpoint_public_id=? LIMIT 1
  `).bind(context.tenantId, checkpointPublicId).first<CheckpointRow>();
  if (!checkpoint) throw new Error('failed to create medication administration backfill checkpoint');
  return checkpoint;
}

async function markCheckpointRunning(context: Context, checkpoint: CheckpointRow): Promise<void> {
  if (checkpoint.status === 'completed') return;
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='running',completed_at_utc=NULL,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
}

async function recordCheckpointOutcome(
  context: Context,
  checkpoint: CheckpointRow,
  cursor: string,
  outcome: ProcessOutcome,
): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,scanned_count=scanned_count+1,
        created_count=created_count+?,mapped_count=mapped_count+?,
        skipped_count=skipped_count+?,exception_count=exception_count+?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    cursor,
    outcome.created ? 1 : 0,
    outcome.mapped ? 1 : 0,
    outcome.skipped ? 1 : 0,
    outcome.issue ? 1 : 0,
    context.nowUtc,
    context.tenantId,
    checkpoint.id,
  ).run();
  checkpoint.cursor_value = cursor;
  context.scanned += 1;
  context.remaining -= 1;
  if (outcome.skipped) context.skipped += 1;
}

async function setCheckpointCursor(context: Context, checkpoint: CheckpointRow, cursor: string): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints SET cursor_value=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(cursor, context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.cursor_value = cursor;
}

async function completeCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='completed',completed_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc, context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.status = 'completed';
}

async function pauseCheckpoint(context: Context, checkpoint: CheckpointRow): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='paused',completed_at_utc=NULL,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(context.nowUtc, context.tenantId, checkpoint.id).run();
  checkpoint.status = 'paused';
}

async function recordIssue(
  context: Context,
  input: {
    code: string;
    sourceType: string;
    sourcePublicId: string;
    reasonCode: string;
    severity?: 'info' | 'warning' | 'error' | 'critical';
  },
): Promise<void> {
  const fingerprint = await createRequestFingerprint({
    schemaVersion: 1,
    issueCode: input.code,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const issuePublicId = await createDeterministicSourceId(
    'medissue', context.tenantId, input.sourceType, `${input.code}:${input.sourcePublicId}`,
  );
  const details = stableCanonicalJson({ schemaVersion: 1, reasonCode: input.reasonCode });
  await context.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,issue_type,
      issue_code,entity_type,entity_public_id,source_type,source_public_id,fingerprint,
      severity,status,occurrence_count,summary,details_json,first_seen_at_utc,
      last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,NULL,'migration_mapping',?,?,NULL,?,?,?,?,'open',1,?,?,?, ?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    context.tenantId,
    issuePublicId,
    context.runId,
    input.code,
    ENTITY_TYPE,
    input.sourceType,
    input.sourcePublicId,
    fingerprint,
    input.severity ?? 'warning',
    input.code,
    details,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
  ).run();
}

async function sourceMapping(
  db: MedicationAdministrationBackfillDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<string | null> {
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
  return row?.mapping_status === 'mapped' ? row.canonical_public_id : null;
}

async function resolvePatientLink(
  db: MedicationAdministrationBackfillDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<string | null> {
  const direct = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1
  `).bind(tenantId, legacyPatientId).first<PatientLinkRow>();
  if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) {
    return direct.patient_link_public_id;
  }
  return sourceMapping(db, tenantId, 'patient_link', 'legacy_patient', String(legacyPatientId));
}

async function resolveEncounter(
  db: MedicationAdministrationBackfillDatabase,
  tenantId: string,
  legacyVisitId: number,
): Promise<string | null> {
  return sourceMapping(db, tenantId, 'encounter', 'legacy_visit', String(legacyVisitId));
}

async function resolvePractitioner(
  db: MedicationAdministrationBackfillDatabase,
  tenantId: string,
  legacyUserId: number | null,
): Promise<string | null> {
  if (legacyUserId == null) return null;
  const row = await db.prepare(`
    SELECT p.practitioner_public_id,p.status
    FROM canonical_practitioner_user_links l
    JOIN canonical_practitioners p
      ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
    WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1
  `).bind(tenantId, legacyUserId).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}

async function resolveMedicationOrder(
  db: MedicationAdministrationBackfillDatabase,
  tenantId: string,
  legacyOrderId: number | null,
): Promise<MedicationOrderRow | null> {
  if (legacyOrderId == null) return null;
  const canonicalPublicId = await sourceMapping(
    db, tenantId, 'medication_order', 'legacy_cln_medication_order', String(legacyOrderId),
  );
  if (!canonicalPublicId) return null;
  return db.prepare(`
    SELECT medication_order_public_id,patient_link_public_id,encounter_public_id,
           current_status,status_version
    FROM canonical_medication_orders
    WHERE tenant_id=? AND medication_order_public_id=? LIMIT 1
  `).bind(tenantId, canonicalPublicId).first<MedicationOrderRow>();
}

function parseDose(value: string | null): { value: string; unit: string } | null {
  if (!value?.trim()) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-zµμ]+(?:\/[A-Za-z]+)?)$/.exec(value.trim());
  if (!match) return null;
  return { value: match[1], unit: match[2] };
}

function mapOutcome(status: string): CanonicalMedicationAdministrationOutcome | null {
  const normalized = status.toLowerCase();
  if (normalized === 'given' || normalized === 'late') return 'given';
  if (normalized === 'partially_given') return 'partially_given';
  if (normalized === 'withheld' || normalized === 'hold') return 'withheld';
  if (normalized === 'refused') return 'refused';
  if (normalized === 'missed' || normalized === 'not_given' || normalized === 'omitted') return 'omitted';
  if (normalized === 'not_available') return 'not_available';
  if (normalized === 'cancelled') return 'cancelled';
  return null;
}

function mappedOrderExistsClause(alias = 'm'): string {
  return `EXISTS (
    SELECT 1 FROM canonical_source_mappings sm
    WHERE sm.tenant_id=${alias}.tenant_id
      AND sm.entity_type='medication_order'
      AND sm.source_type='legacy_cln_medication_order'
      AND sm.source_public_id=CAST(${alias}.order_id AS TEXT)
      AND sm.mapping_status='mapped'
  )`;
}

async function processMarOutcome(
  context: Context,
  row: MarRow,
  sourceType: string,
): Promise<ProcessOutcome> {
  const sourcePublicId = String(row.id);
  const existing = await sourceMapping(
    context.db, context.tenantId, 'medication_administration_event', MAR_SOURCE, sourcePublicId,
  );
  if (existing) return { skipped: true };
  const patientLinkPublicId = await resolvePatientLink(context.db, context.tenantId, row.patient_id);
  const encounterPublicId = await resolveEncounter(context.db, context.tenantId, row.visit_id);
  const practitionerPublicId = await resolvePractitioner(context.db, context.tenantId, row.administered_by ?? row.updated_by);
  const medicationOrder = await resolveMedicationOrder(context.db, context.tenantId, row.order_id);
  if (!medicationOrder) {
    await recordIssue(context, {
      code: 'MAR_CANONICAL_ORDER_MAPPING_MISSING', sourceType, sourcePublicId,
      reasonCode: 'exact_legacy_order_to_canonical_order_mapping_missing',
    });
    return { issue: true, skipped: true };
  }
  if (!patientLinkPublicId || !encounterPublicId || !practitionerPublicId) {
    await recordIssue(context, {
      code: 'MAR_CLINICAL_SCOPE_MAPPING_MISSING', sourceType, sourcePublicId,
      reasonCode: 'patient_encounter_or_practitioner_mapping_missing',
    });
    return { issue: true, skipped: true };
  }
  if (
    medicationOrder.patient_link_public_id !== patientLinkPublicId
    || medicationOrder.encounter_public_id !== encounterPublicId
  ) {
    await recordIssue(context, {
      code: 'MAR_MEDICATION_ORDER_SCOPE_MISMATCH', sourceType, sourcePublicId,
      reasonCode: 'mapped_order_patient_or_encounter_scope_mismatch', severity: 'error',
    });
    return { issue: true, skipped: true };
  }
  const outcomeCode = mapOutcome(String(row.status ?? ''));
  if (!outcomeCode) {
    await recordIssue(context, {
      code: 'MAR_OUTCOME_UNSUPPORTED', sourceType, sourcePublicId,
      reasonCode: 'legacy_status_cannot_be_mapped_to_canonical_outcome',
    });
    return { issue: true, skipped: true };
  }
  const isAdministration = outcomeCode === 'given' || outcomeCode === 'partially_given';
  const dose = isAdministration ? parseDose(row.dose) : null;
  if (isAdministration && (!dose || !row.route?.trim())) {
    await recordIssue(context, {
      code: !dose ? 'MAR_DOSE_PARSE_AMBIGUOUS' : 'MAR_ROUTE_MISSING', sourceType, sourcePublicId,
      reasonCode: !dose ? 'legacy_dose_is_not_an_exact_decimal_unit_pair' : 'administration_route_missing',
    });
    return { issue: true, skipped: true };
  }
  if (!isAdministration && !row.reason_not_given?.trim()) {
    await recordIssue(context, {
      code: 'MAR_NON_ADMINISTRATION_REASON_MISSING', sourceType, sourcePublicId,
      reasonCode: 'non_administration_outcome_has_no_reason',
    });
    return { issue: true, skipped: true };
  }
  const occurredAtUtc = normalizedUtc(row.actual_time ?? row.administered_on, context.nowUtc);
  const scheduledAtUtc = row.scheduled_time ? normalizedUtc(row.scheduled_time, occurredAtUtc) : null;
  const recordedAtUtc = normalizedUtc(row.updated_at ?? row.created_at ?? row.actual_time ?? row.administered_on, occurredAtUtc);
  const evidence = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    orderId: row.order_id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    administeredBy: row.administered_by,
    status: row.status,
    dose: row.dose,
    route: row.route,
    scheduledTime: row.scheduled_time,
    actualTime: row.actual_time,
    administeredOn: row.administered_on,
    reasonNotGiven: row.reason_not_given,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  });
  await recordCanonicalMedicationAdministrationEvent(context.db, {
    tenantId: context.tenantId,
    medicationOrderPublicId: medicationOrder.medication_order_public_id,
    medicationOrderStatusVersion: Number(medicationOrder.status_version),
    patientLinkPublicId,
    encounterPublicId,
    administeringPractitionerPublicId: practitionerPublicId,
    scheduledAtUtc,
    occurredAtUtc,
    recordedAtUtc: recordedAtUtc < occurredAtUtc ? occurredAtUtc : recordedAtUtc,
    lateEntryReasonCode: String(row.status ?? '').toLowerCase() === 'late' ? 'legacy_late_status' : null,
    outcomeCode,
    administeredDoseValueDecimal: dose?.value ?? null,
    administeredDoseUnitCode: dose?.unit ?? null,
    routeCode: isAdministration ? row.route!.trim() : null,
    reasonCode: isAdministration ? null : row.reason_not_given!.trim(),
    barcodeSourceType: row.barcode_scanned ? 'legacy_mar_barcode_marker' : null,
    barcodeSourcePublicId: row.barcode_scanned ? `${sourcePublicId}:barcode` : null,
    sourceType: MAR_SOURCE,
    sourcePublicId,
    sourceTable: 'nur_medication_admin',
    sourceEvidenceSha256: evidence,
    actorSystemKey: 'canonical.backfill.medication-administration',
    idempotencyKey: `cdb124d:mar:${sourcePublicId}`,
    commandOccurredAtUtc: recordedAtUtc < occurredAtUtc ? occurredAtUtc : recordedAtUtc,
    businessDate: businessDate(occurredAtUtc),
  });
  return { created: true, mapped: true };
}

async function processAdministrationOutcomes(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'nur_medication_admin'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const records = await rows<MarRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,dose,route,administered_on,administered_by,status,
           is_active,created_at,updated_by,updated_at,order_id,scheduled_time,actual_time,
           reason_not_given,barcode_scanned
    FROM nur_medication_admin m
    WHERE tenant_id=? AND id>? AND is_active=1
      AND lower(COALESCE(status,'')) IN ('given','late','partially_given')
      AND ${mappedOrderExistsClause('m')}
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of records) {
    const outcome = await processMarOutcome(context, row, 'legacy_mar_administration_outcome');
    await recordCheckpointOutcome(context, checkpoint, String(row.id), outcome);
    if (context.remaining === 0) return false;
  }
  return records.length < context.remaining + records.length;
}

async function processNonAdministrationOutcomes(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'nur_medication_admin'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const records = await rows<MarRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,dose,route,administered_on,administered_by,status,
           is_active,created_at,updated_by,updated_at,order_id,scheduled_time,actual_time,
           reason_not_given,barcode_scanned
    FROM nur_medication_admin m
    WHERE tenant_id=? AND id>? AND is_active=1
      AND lower(COALESCE(status,'')) IN ('withheld','hold','refused','missed','not_given','omitted','not_available','cancelled')
      AND ${mappedOrderExistsClause('m')}
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of records) {
    const outcome = await processMarOutcome(context, row, 'legacy_mar_non_administration_outcome');
    await recordCheckpointOutcome(context, checkpoint, String(row.id), outcome);
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processUnmappedMar(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'nur_medication_admin'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const placeholders = OUTCOME_STATUSES.map(() => '?').join(',');
  const records = await rows<{ id: number }>(context.db.prepare(`
    SELECT id FROM nur_medication_admin m
    WHERE tenant_id=? AND id>? AND is_active=1
      AND lower(COALESCE(status,'')) IN (${placeholders})
      AND NOT ${mappedOrderExistsClause('m')}
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, ...OUTCOME_STATUSES, context.remaining));
  for (const row of records) {
    await recordIssue(context, {
      code: 'MAR_CANONICAL_ORDER_MAPPING_MISSING',
      sourceType: 'legacy_mar_unmapped_order',
      sourcePublicId: String(row.id),
      reasonCode: 'free_text_medication_and_numeric_coincidence_are_not_identity_proof',
    });
    await recordCheckpointOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processScheduleProjection(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'nur_medication_admin'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const records = await rows<{ id: number }>(context.db.prepare(`
    SELECT id FROM nur_medication_admin
    WHERE tenant_id=? AND id>? AND is_active=1
      AND (lower(COALESCE(status,''))='scheduled' OR actual_time IS NULL)
      AND lower(COALESCE(status,'')) NOT IN ('given','late','partially_given','withheld','hold','refused','missed','not_given','omitted','not_available','cancelled')
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of records) {
    await recordIssue(context, {
      code: 'MAR_SCHEDULE_PROJECTION_ONLY',
      sourceType: 'legacy_mar_schedule_projection',
      sourcePublicId: String(row.id),
      reasonCode: 'schedule_only_row_is_workflow_projection_not_administration_fact',
      severity: 'info',
    });
    await recordCheckpointOutcome(context, checkpoint, String(row.id), { issue: true, skipped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

function mapItemSource(source: string | null): CanonicalMedicationReconciliationItemSourceKind {
  return source === 'home' || source === 'inpatient' || source === 'new' ? source : 'unknown';
}

function mapItemDecision(action: string): CanonicalMedicationReconciliationDecision | null {
  return action === 'continue' || action === 'modify' || action === 'discontinue' || action === 'add'
    ? action
    : null;
}

async function loadReconciliationItems(
  context: Context,
  header: ReconciliationHeaderRow,
): Promise<{ items: CanonicalMedicationReconciliationItemInput[]; mappingStatements: MedicationAdministrationBackfillPreparedStatement[] } | null> {
  const sourceRows = await rows<ReconciliationItemRow>(context.db.prepare(`
    SELECT id,reconciliation_id,medication_name,dose,route,frequency,source,action,
           action_reason,new_dose,new_route,new_frequency,is_active,created_at
    FROM cln_medication_reconciliation_items
    WHERE tenant_id=? AND reconciliation_id=? AND is_active=1 ORDER BY id
  `).bind(context.tenantId, header.id));
  if (sourceRows.length === 0) return null;
  const items: CanonicalMedicationReconciliationItemInput[] = [];
  const mappingStatements: MedicationAdministrationBackfillPreparedStatement[] = [];
  for (const row of sourceRows) {
    const decisionCode = mapItemDecision(row.action);
    if (!decisionCode) return null;
    const itemPublicId = await createDeterministicSourceId(
      'medrecitem', context.tenantId, RECON_ITEM_SOURCE, String(row.id),
    );
    const evidence = await createSourceEvidenceSha256({
      sourcePublicId: String(row.id),
      reconciliationId: row.reconciliation_id,
      medicationName: row.medication_name,
      dose: row.dose,
      route: row.route,
      frequency: row.frequency,
      source: row.source,
      action: row.action,
      actionReason: row.action_reason,
      newDose: row.new_dose,
      newRoute: row.new_route,
      newFrequency: row.new_frequency,
      isActive: row.is_active,
      createdAt: row.created_at,
    });
    items.push({
      itemPublicId,
      sourceKind: mapItemSource(row.source),
      decisionCode,
      medicationDescriptionSnapshot: row.medication_name.trim(),
      priorDoseSnapshot: row.dose?.trim() || null,
      priorRouteSnapshot: row.route?.trim() || null,
      priorFrequencySnapshot: row.frequency?.trim() || null,
      proposedDoseSnapshot: row.new_dose?.trim() || null,
      proposedRouteSnapshot: row.new_route?.trim() || null,
      proposedFrequencySnapshot: row.new_frequency?.trim() || null,
      reasonCode: row.action_reason?.trim() || 'legacy_reconciliation_decision',
      sourceEvidenceSha256: evidence,
    });
    mappingStatements.push(context.db.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,'mapped',1,?,?,?,?)
    `).bind(
      context.tenantId,
      'medication_reconciliation_item',
      itemPublicId,
      RECON_ITEM_SOURCE,
      String(row.id),
      'cln_medication_reconciliation_items',
      context.runId,
      evidence,
      context.nowUtc,
      context.nowUtc,
    ) as MedicationAdministrationBackfillPreparedStatement);
  }
  return { items, mappingStatements };
}

async function processReconciliationHeaders(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'cln_medication_reconciliation'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const records = await rows<ReconciliationHeaderRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,reconciliation_type,status,performed_by,completed_at,
           is_active,created_at,updated_at
    FROM cln_medication_reconciliation
    WHERE tenant_id=? AND id>? AND is_active=1 ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of records) {
    const sourcePublicId = String(row.id);
    const existing = await sourceMapping(
      context.db, context.tenantId, 'medication_reconciliation', RECON_SOURCE, sourcePublicId,
    );
    if (existing) {
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const patientLinkPublicId = await resolvePatientLink(context.db, context.tenantId, row.patient_id);
    const encounterPublicId = await resolveEncounter(context.db, context.tenantId, row.visit_id);
    const practitionerPublicId = await resolvePractitioner(context.db, context.tenantId, row.performed_by);
    const loaded = await loadReconciliationItems(context, row);
    if (!patientLinkPublicId || !encounterPublicId || !practitionerPublicId || !loaded) {
      await recordIssue(context, {
        code: !loaded ? 'MEDICATION_RECONCILIATION_ITEMS_MISSING' : 'MEDICATION_RECONCILIATION_SCOPE_MAPPING_MISSING',
        sourceType: 'legacy_medication_reconciliation_header',
        sourcePublicId,
        reasonCode: !loaded ? 'active_reconciliation_has_no_reconstructable_items' : 'patient_encounter_or_practitioner_mapping_missing',
      });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const occurredAtUtc = normalizedUtc(row.created_at, context.nowUtc);
    const sourceEvidenceSha256 = await createSourceEvidenceSha256({
      sourcePublicId,
      patientId: row.patient_id,
      visitId: row.visit_id,
      reconciliationType: row.reconciliation_type,
      status: row.status,
      performedBy: row.performed_by,
      completedAt: row.completed_at,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    const sourceSummarySha256 = await createRequestFingerprint({
      schemaVersion: 1,
      headerSourcePublicId: sourcePublicId,
      itemSourcePublicIds: loaded.items.map((item) => item.itemPublicId),
    });
    await createCanonicalMedicationReconciliationDraft(context.db, {
      tenantId: context.tenantId,
      patientLinkPublicId,
      encounterPublicId,
      reconciliationType: row.reconciliation_type,
      creatingPractitionerPublicId: practitionerPublicId,
      items: loaded.items,
      sourceSummarySha256,
      sourceType: RECON_SOURCE,
      sourcePublicId,
      sourceTable: 'cln_medication_reconciliation',
      sourceEvidenceSha256,
      actorSystemKey: 'canonical.backfill.medication-reconciliation',
      idempotencyKey: `cdb124d:reconciliation:${sourcePublicId}:draft`,
      occurredAtUtc,
      businessDate: businessDate(occurredAtUtc),
    }, { authoritativeStatements: loaded.mappingStatements });
    await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { created: true, mapped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processReconciliationItems(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'cln_medication_reconciliation_items'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const records = await rows<{ id: number; reconciliation_id: number; is_active: number }>(context.db.prepare(`
    SELECT i.id,i.reconciliation_id,i.is_active
    FROM cln_medication_reconciliation_items i
    WHERE i.tenant_id=? AND i.id>? ORDER BY i.id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of records) {
    const headerExists = await context.db.prepare(`
      SELECT 1 AS present FROM cln_medication_reconciliation
      WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(context.tenantId, row.reconciliation_id).first();
    const mapped = await sourceMapping(
      context.db, context.tenantId, 'medication_reconciliation_item', RECON_ITEM_SOURCE, String(row.id),
    );
    let outcome: ProcessOutcome = { skipped: true };
    if (!headerExists) {
      await recordIssue(context, {
        code: 'MEDICATION_RECONCILIATION_ORPHAN_ITEM',
        sourceType: 'legacy_medication_reconciliation_item',
        sourcePublicId: String(row.id),
        reasonCode: 'item_references_missing_reconciliation_header',
      });
      outcome = { issue: true, skipped: true };
    } else if (row.is_active !== 1) {
      await recordIssue(context, {
        code: 'MEDICATION_RECONCILIATION_INACTIVE_ITEM_REVIEW_REQUIRED',
        sourceType: 'legacy_medication_reconciliation_item',
        sourcePublicId: String(row.id),
        reasonCode: 'inactive_legacy_item_is_not_migrated_as_active_version_content',
      });
      outcome = { issue: true, skipped: true };
    } else if (!mapped) {
      await recordIssue(context, {
        code: 'MEDICATION_RECONCILIATION_ITEM_MAPPING_MISSING',
        sourceType: 'legacy_medication_reconciliation_item',
        sourcePublicId: String(row.id),
        reasonCode: 'active_item_not_linked_to_reconstructed_canonical_version',
      });
      outcome = { issue: true, skipped: true };
    }
    await recordCheckpointOutcome(context, checkpoint, String(row.id), outcome);
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processReconciliationLifecycle(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  if (!(await tableExists(context.db, 'cln_medication_reconciliation'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const records = await rows<ReconciliationHeaderRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,reconciliation_type,status,performed_by,completed_at,
           is_active,created_at,updated_at
    FROM cln_medication_reconciliation
    WHERE tenant_id=? AND id>? AND is_active=1 AND status IN ('completed','cancelled')
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of records) {
    const sourcePublicId = String(row.id);
    const reconciliationPublicId = await sourceMapping(
      context.db, context.tenantId, 'medication_reconciliation', RECON_SOURCE, sourcePublicId,
    );
    const practitionerPublicId = await resolvePractitioner(context.db, context.tenantId, row.performed_by);
    if (!reconciliationPublicId || !practitionerPublicId) {
      await recordIssue(context, {
        code: 'MEDICATION_RECONCILIATION_LIFECYCLE_MAPPING_MISSING',
        sourceType: 'legacy_medication_reconciliation_lifecycle', sourcePublicId,
        reasonCode: 'canonical_reconciliation_or_practitioner_mapping_missing',
      });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const state = await context.db.prepare(`
      SELECT reconciliation_public_id,current_version_public_id,current_status,status_version
      FROM canonical_medication_reconciliations
      WHERE tenant_id=? AND reconciliation_public_id=? LIMIT 1
    `).bind(context.tenantId, reconciliationPublicId).first<ReconciliationStateRow>();
    if (!state?.current_version_public_id) {
      await recordIssue(context, {
        code: 'MEDICATION_RECONCILIATION_CURRENT_VERSION_MISSING',
        sourceType: 'legacy_medication_reconciliation_lifecycle', sourcePublicId,
        reasonCode: 'canonical_reconciliation_has_no_current_version', severity: 'error',
      });
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    if (state.current_status !== 'draft') {
      await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { skipped: true });
      if (context.remaining === 0) return false;
      continue;
    }
    const version = await context.db.prepare(`
      SELECT version_public_id,version_number,content_sha256
      FROM canonical_medication_reconciliation_versions
      WHERE tenant_id=? AND reconciliation_public_id=? AND version_public_id=? LIMIT 1
    `).bind(
      context.tenantId, reconciliationPublicId, state.current_version_public_id,
    ).first<ReconciliationVersionRow>();
    if (!version) throw new Error('canonical medication reconciliation version missing during lifecycle backfill');
    const occurredAtUtc = normalizedUtc(row.completed_at ?? row.updated_at ?? row.created_at, context.nowUtc);
    const evidence = await createSourceEvidenceSha256({
      sourcePublicId,
      sourceStatus: row.status,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
      performedBy: row.performed_by,
    });
    if (row.status === 'completed') {
      await finalizeCanonicalMedicationReconciliation(context.db, {
        tenantId: context.tenantId,
        reconciliationPublicId,
        expectedStatusVersion: Number(state.status_version),
        versionPublicId: version.version_public_id,
        finalizingPractitionerPublicId: practitionerPublicId,
        signedContentSha256: version.content_sha256,
        reasonCode: 'legacy_reconciliation_completed',
        sourceEvidenceSha256: evidence,
        actorSystemKey: 'canonical.backfill.medication-reconciliation',
        idempotencyKey: `cdb124d:reconciliation:${sourcePublicId}:finalize`,
        occurredAtUtc,
        businessDate: businessDate(occurredAtUtc),
      });
    } else {
      await cancelCanonicalMedicationReconciliation(context.db, {
        tenantId: context.tenantId,
        reconciliationPublicId,
        expectedStatusVersion: Number(state.status_version),
        versionPublicId: version.version_public_id,
        cancellingPractitionerPublicId: practitionerPublicId,
        reasonCode: 'legacy_reconciliation_cancelled',
        sourceEvidenceSha256: evidence,
        actorSystemKey: 'canonical.backfill.medication-reconciliation',
        idempotencyKey: `cdb124d:reconciliation:${sourcePublicId}:cancel`,
        occurredAtUtc,
        businessDate: businessDate(occurredAtUtc),
      });
    }
    await recordCheckpointOutcome(context, checkpoint, sourcePublicId, { created: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

async function processEffectAndHistoryDisposition(context: Context, checkpoint: CheckpointRow): Promise<boolean> {
  const phase = checkpoint.cursor_value?.startsWith('R:') ? 'R' : 'M';
  if (phase === 'M' && await tableExists(context.db, 'nur_medication_admin')) {
    const cursor = cursorNumber(checkpoint.cursor_value);
    const records = await rows<{ id: number }>(context.db.prepare(`
      SELECT id FROM nur_medication_admin
      WHERE tenant_id=? AND id>? AND (is_active=0 OR updated_by IS NOT NULL OR updated_at IS NOT NULL)
      ORDER BY id LIMIT ?
    `).bind(context.tenantId, cursor, context.remaining));
    for (const row of records) {
      await recordIssue(context, {
        code: 'MAR_MUTABLE_HISTORY_REVIEW_REQUIRED',
        sourceType: 'legacy_mar_mutable_history',
        sourcePublicId: String(row.id),
        reasonCode: 'legacy_row_was_hidden_or_mutated_and_requires_source_snapshot_review',
      });
      await recordCheckpointOutcome(context, checkpoint, `M:${row.id}`, { issue: true, skipped: true });
      if (context.remaining === 0) return false;
    }
    await setCheckpointCursor(context, checkpoint, 'R:0');
  } else if (phase === 'M') {
    await setCheckpointCursor(context, checkpoint, 'R:0');
  }
  if (!(await tableExists(context.db, 'cln_medication_reconciliation_items'))) return true;
  const cursor = cursorNumber(checkpoint.cursor_value);
  const records = await rows<{ id: number; action: string }>(context.db.prepare(`
    SELECT id,action FROM cln_medication_reconciliation_items
    WHERE tenant_id=? AND id>? AND action IN ('modify','discontinue','add')
    ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of records) {
    await recordIssue(context, {
      code: 'MEDICATION_RECONCILIATION_INTENT_REQUIRES_EXPLICIT_COMMAND',
      sourceType: 'legacy_reconciliation_intent_disposition',
      sourcePublicId: String(row.id),
      reasonCode: 'reconciliation_decision_does_not_implicitly_create_prescription_order_or_discharge_effect',
      severity: 'info',
    });
    await recordCheckpointOutcome(context, checkpoint, `R:${row.id}`, { issue: true, skipped: true });
    if (context.remaining === 0) return false;
  }
  return true;
}

const PARTITIONS: Partition[] = [
  { sourceType: 'legacy_mar_administration_outcome', partitionKey: '01-order-linked-administration-outcomes', process: processAdministrationOutcomes },
  { sourceType: 'legacy_mar_non_administration_outcome', partitionKey: '02-order-linked-non-administration-outcomes', process: processNonAdministrationOutcomes },
  { sourceType: 'legacy_mar_unmapped_order', partitionKey: '03-mar-without-exact-order-mapping', process: processUnmappedMar },
  { sourceType: 'legacy_mar_schedule_projection', partitionKey: '04-schedule-only-projection-disposition', process: processScheduleProjection },
  { sourceType: 'legacy_medication_reconciliation_header', partitionKey: '05-reconciliation-headers', process: processReconciliationHeaders },
  { sourceType: 'legacy_medication_reconciliation_item', partitionKey: '06-reconciliation-items-version-reconstruction', process: processReconciliationItems },
  { sourceType: 'legacy_medication_reconciliation_lifecycle', partitionKey: '07-reconciliation-completion-cancellation', process: processReconciliationLifecycle },
  { sourceType: 'legacy_medication_effect_disposition', partitionKey: '08-effect-duplicate-correction-disposition', process: processEffectAndHistoryDisposition },
];

export async function backfillMedicationAdministration(
  db: MedicationAdministrationBackfillDatabase,
  options: MedicationAdministrationBackfillOptions,
): Promise<MedicationAdministrationBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const nowUtc = normalizedUtc(options.nowUtc, options.nowUtc);
  const remaining = sourceLimit(options.maxSourceRecords);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const starting = await captureCounts(db, tenantId);
  if (run.status === 'succeeded') {
    return {
      completed: true,
      counts: {
        scanned: 0,
        administrationEventsCreated: 0,
        reconciliationsCreated: 0,
        reconciliationVersionsCreated: 0,
        reconciliationItemsCreated: 0,
        reconciliationStatusEventsCreated: 0,
        mappingsCreated: 0,
        skipped: 0,
        issues: 0,
      },
    };
  }
  const context: Context = {
    db, tenantId, runId: Number(run.id), runPublicId, nowUtc,
    remaining, scanned: 0, skipped: 0,
  };
  let allCompleted = true;
  for (const partition of PARTITIONS) {
    const checkpoint = await ensureCheckpoint(context, partition);
    if (checkpoint.status === 'completed') continue;
    if (context.remaining === 0) {
      allCompleted = false;
      break;
    }
    await markCheckpointRunning(context, checkpoint);
    const completed = await partition.process(context, checkpoint);
    if (completed) await completeCheckpoint(context, checkpoint);
    else {
      await pauseCheckpoint(context, checkpoint);
      allCompleted = false;
      if (context.remaining === 0) break;
    }
  }
  const incompleteCount = await count(db, `
    SELECT COUNT(*) AS count FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND status!='completed'
  `, [tenantId, run.id]);
  allCompleted = allCompleted && incompleteCount === 0;
  const result = await resultFromDelta(context, starting, allCompleted);
  if (allCompleted) {
    await db.prepare(`
      UPDATE canonical_migration_runs
      SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(
      nowUtc,
      stableCanonicalJson({ schemaVersion: 1, counts: result.counts, partitionCount: PARTITIONS.length }),
      nowUtc,
      tenantId,
      run.id,
    ).run();
  } else {
    await db.prepare(`
      UPDATE canonical_migration_runs SET status='running',updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(nowUtc, tenantId, run.id).run();
  }
  return result;
}

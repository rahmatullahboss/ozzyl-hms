import { createRequestFingerprint, stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PrescriptionMedicationBackfillPreparedStatement {
  bind(...values: unknown[]): PrescriptionMedicationBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PrescriptionMedicationBackfillDatabase {
  prepare(sql: string): PrescriptionMedicationBackfillPreparedStatement;
  batch(statements: PrescriptionMedicationBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface PrescriptionMedicationBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  maxSourceRecords?: number;
}

export interface PrescriptionMedicationBackfillCounts {
  scanned: number;
  prescriptionsCreated: number;
  versionsCreated: number;
  medicationOrdersCreated: number;
  standaloneOrdersCreated: number;
  safetyEventsCreated: number;
  mappingsCreated: number;
  skipped: number;
  issues: number;
}

export interface PrescriptionMedicationBackfillResult {
  completed: boolean;
  counts: PrescriptionMedicationBackfillCounts;
}

interface MigrationRunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface EncounterRow { encounter_public_id: string; patient_link_public_id: string | null; status: string }
interface ClaimRow { visit_id: number; encounter_id: number | null }
interface AdmissionRow { encounter_public_id: string }
interface AppointmentLinkRow { encounter_public_id: string }

interface PrescriptionSourceRow {
  id: number;
  patient_id: number;
  doctor_id: number | null;
  appointment_id: number | null;
  admission_id: number | null;
  completion_claim_id: number | null;
  status: string;
  is_locked: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

interface PrescriptionItemRow {
  id: number;
  medicine_name: string;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  sort_order: number | null;
  quantity: number | null;
  dispensed_qty: number | null;
  medicine_id: number | null;
}

interface PrescriptionOverrideRow {
  id: number;
  override_type: string;
  severity: string | null;
  created_at: string;
}

interface PrescriptionSafetyCheckRow {
  id: number;
  check_type: string;
  has_warnings: number | null;
  warning_count: number | null;
  action_taken: string | null;
  checked_by: number;
  checked_at: string;
}

interface CpoeOrderRow {
  id: number;
  patient_id: number;
  visit_id: number;
  formulary_item_id: number | null;
  medication_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  dose: string;
  route: string;
  frequency: string;
  duration: string | null;
  instructions: string | null;
  priority: string;
  start_datetime: string;
  end_datetime: string | null;
  status: string;
  status_reason: string | null;
  idempotency_key: string | null;
  ordered_by: number;
  created_at: string;
}

interface StartingCounts {
  prescriptions: number;
  versions: number;
  orders: number;
  standaloneOrders: number;
  safety: number;
  mappings: number;
  issues: number;
}

interface Context {
  db: PrescriptionMedicationBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
  skipped: number;
}

const MIGRATION_NAME = 'CDB-121D prescription medication intent backfill';
const PRESCRIPTION_SOURCE = 'legacy_prescription';
const CPOE_SOURCE = 'legacy_cln_medication_order';
const PRESCRIPTION_PARTITION = 'prescription_headers';
const CPOE_PARTITION = 'standalone_cpoe_orders';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function limit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('maxSourceRecords must be a positive safe integer');
  }
  return value;
}

function normalizedUtc(value: string, label: string): string {
  const exactValue = exact(value, label);
  if (exactValue.endsWith('Z')) return toUtcIso(exactValue);
  const local = exactValue.includes('T') ? exactValue : exactValue.replace(' ', 'T');
  return toUtcIso(`${local}+06:00`);
}

function mapPrescriptionStatus(source: string, locked: number): {
  prescription: 'draft' | 'final' | 'cancelled' | 'entered_in_error';
  version: 'draft' | 'final' | 'retracted' | 'entered_in_error';
  order: 'draft' | 'active' | 'cancelled' | 'entered_in_error';
} {
  const status = source.trim().toLowerCase();
  if (['entered_in_error', 'invalid', 'error'].includes(status)) {
    return { prescription: 'entered_in_error', version: 'entered_in_error', order: 'entered_in_error' };
  }
  if (['cancelled', 'canceled', 'void'].includes(status)) {
    return { prescription: 'cancelled', version: 'retracted', order: 'cancelled' };
  }
  if (locked === 1 || ['final', 'issued', 'completed', 'locked', 'active'].includes(status)) {
    return { prescription: 'final', version: 'final', order: 'active' };
  }
  return { prescription: 'draft', version: 'draft', order: 'draft' };
}

function mapCpoeStatus(value: string): 'draft' | 'active' | 'on_hold' | 'completed' | 'stopped' | 'cancelled' | 'entered_in_error' {
  const status = value.trim().toLowerCase();
  if (['active', 'verified', 'approved'].includes(status)) return 'active';
  if (['hold', 'held', 'on_hold'].includes(status)) return 'on_hold';
  if (['complete', 'completed', 'administered'].includes(status)) return 'completed';
  if (['stop', 'stopped', 'discontinued'].includes(status)) return 'stopped';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['entered_in_error', 'error', 'invalid'].includes(status)) return 'entered_in_error';
  return 'draft';
}

function mapPriority(value: string): 'routine' | 'urgent' | 'stat' | 'prn' {
  const priority = value.trim().toLowerCase();
  if (priority === 'urgent') return 'urgent';
  if (priority === 'stat') return 'stat';
  if (priority === 'prn') return 'prn';
  return 'routine';
}

function mapSafetyType(value: string): 'allergy_check' | 'interaction_check' | 'duplicate_therapy_check' | 'dose_check' | 'override' | 'other' {
  const type = value.trim().toLowerCase();
  if (type.includes('allerg')) return 'allergy_check';
  if (type.includes('interact')) return 'interaction_check';
  if (type.includes('duplicate')) return 'duplicate_therapy_check';
  if (type.includes('dose')) return 'dose_check';
  if (type.includes('override')) return 'override';
  return 'other';
}

function mapSeverity(value: string | null): 'none' | 'low' | 'moderate' | 'high' | 'critical' | 'unknown' {
  const severity = value?.trim().toLowerCase();
  if (severity === 'none') return 'none';
  if (severity === 'low') return 'low';
  if (severity === 'moderate' || severity === 'medium') return 'moderate';
  if (severity === 'high') return 'high';
  if (severity === 'critical') return 'critical';
  return 'unknown';
}

async function allRows<T>(statement: PrescriptionMedicationBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function count(
  db: PrescriptionMedicationBackfillDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function captureCounts(db: PrescriptionMedicationBackfillDatabase, tenantId: string): Promise<StartingCounts> {
  return {
    prescriptions: await count(db, `SELECT COUNT(*) AS count FROM canonical_prescriptions WHERE tenant_id=?`, [tenantId]),
    versions: await count(db, `SELECT COUNT(*) AS count FROM canonical_prescription_versions WHERE tenant_id=?`, [tenantId]),
    orders: await count(db, `SELECT COUNT(*) AS count FROM canonical_medication_orders WHERE tenant_id=?`, [tenantId]),
    standaloneOrders: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_medication_orders
      WHERE tenant_id=? AND prescription_public_id IS NULL
    `, [tenantId]),
    safety: await count(db, `SELECT COUNT(*) AS count FROM canonical_prescription_safety_events WHERE tenant_id=?`, [tenantId]),
    mappings: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type IN ('prescription','prescription_version','medication_order','prescription_safety_event')
    `, [tenantId]),
    issues: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_processing_issues
      WHERE tenant_id=? AND entity_type IN ('prescription','medication_order')
    `, [tenantId]),
  };
}

async function resultFromDelta(
  db: PrescriptionMedicationBackfillDatabase,
  context: Context,
  starting: StartingCounts,
  completed: boolean,
): Promise<PrescriptionMedicationBackfillResult> {
  const ending = await captureCounts(db, context.tenantId);
  return {
    completed,
    counts: {
      scanned: context.scanned,
      prescriptionsCreated: ending.prescriptions - starting.prescriptions,
      versionsCreated: ending.versions - starting.versions,
      medicationOrdersCreated: ending.orders - starting.orders,
      standaloneOrdersCreated: ending.standaloneOrders - starting.standaloneOrders,
      safetyEventsCreated: ending.safety - starting.safety,
      mappingsCreated: ending.mappings - starting.mappings,
      skipped: context.skipped,
      issues: ending.issues - starting.issues,
    },
  };
}

async function ensureRun(
  db: PrescriptionMedicationBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<MigrationRunRow> {
  let row = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  if (!row) {
    await db.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, MIGRATION_NAME, nowUtc, nowUtc, nowUtc).run();
    row = await db.prepare(`
      SELECT id,status FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=? LIMIT 1
    `).bind(tenantId, runPublicId).first<MigrationRunRow>();
  } else if (row.status !== 'succeeded') {
    await db.prepare(`
      UPDATE canonical_migration_runs SET status='running',completed_at_utc=NULL,
        error_code=NULL,error_summary=NULL,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(nowUtc, tenantId, row.id).run();
  }
  if (!row) throw new Error('failed to create prescription medication migration run');
  return row;
}

async function ensureCheckpoint(
  db: PrescriptionMedicationBackfillDatabase,
  input: {
    tenantId: string;
    runId: number;
    runPublicId: string;
    sourceType: string;
    partitionKey: string;
    nowUtc: string;
  },
): Promise<CheckpointRow> {
  let row = await db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='prescription_medication_intent'
      AND source_type=? AND partition_key=? LIMIT 1
  `).bind(input.tenantId, input.runId, input.sourceType, input.partitionKey).first<CheckpointRow>();
  if (!row) {
    const checkpointPublicId = await createDeterministicSourceId(
      'rxcp', input.tenantId, input.runPublicId, `${input.sourceType}:${input.partitionKey}`,
    );
    await db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,cursor_value,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'prescription_medication_intent',?,?,NULL,'running',?,?,?)
    `).bind(
      input.tenantId,
      checkpointPublicId,
      input.runId,
      input.sourceType,
      input.partitionKey,
      input.nowUtc,
      input.nowUtc,
      input.nowUtc,
    ).run();
    row = await db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='prescription_medication_intent'
        AND source_type=? AND partition_key=? LIMIT 1
    `).bind(input.tenantId, input.runId, input.sourceType, input.partitionKey).first<CheckpointRow>();
  }
  if (!row) throw new Error('failed to create prescription medication checkpoint');
  return row;
}

async function updateCheckpoint(
  context: Context,
  checkpointId: number,
  cursor: number | null,
  status: 'running' | 'completed',
): Promise<void> {
  await context.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,status=?,scanned_count=scanned_count+1,
        completed_at_utc=CASE WHEN ?='completed' THEN ? ELSE NULL END,
        updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    cursor == null ? null : String(cursor),
    status,
    status,
    context.nowUtc,
    context.nowUtc,
    context.tenantId,
    checkpointId,
  ).run();
}

async function mapping(
  db: PrescriptionMedicationBackfillDatabase,
  input: { tenantId: string; entityType: string; sourceType: string; sourcePublicId: string },
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
  ).first<MappingRow>();
}

async function mappedPublicId(
  db: PrescriptionMedicationBackfillDatabase,
  input: { tenantId: string; entityType: string; sourceType: string; sourcePublicId: string },
): Promise<string | null> {
  const row = await mapping(db, input);
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? row.canonical_public_id : null;
}

function sourceMappingStatement(
  db: PrescriptionMedicationBackfillDatabase,
  input: {
    tenantId: string;
    entityType: string;
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    evidenceSha256: string;
    runId: number;
    nowUtc: string;
  },
): PrescriptionMedicationBackfillPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,'mapped',1,?,?,?,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.runId,
    input.evidenceSha256,
    input.nowUtc,
    input.nowUtc,
  );
}

async function issueStatement(
  context: Context,
  input: {
    code: string;
    entityType: 'prescription' | 'medication_order';
    sourceType: string;
    sourcePublicId: string;
    summary: string;
    details: Record<string, unknown>;
  },
): Promise<PrescriptionMedicationBackfillPreparedStatement> {
  const fingerprint = await createSourceEvidenceSha256({
    issueType: 'identity_resolution',
    code: input.code,
    entityType: input.entityType,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const issuePublicId = await createDeterministicSourceId(
    'rxissue', context.tenantId, input.code, input.sourcePublicId,
  );
  return context.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,issue_type,
      issue_code,entity_type,entity_public_id,source_type,source_public_id,fingerprint,
      severity,status,occurrence_count,summary,details_json,first_seen_at_utc,last_seen_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,NULL,'identity_resolution',?,?,NULL,?,?,?,'error','open',1,?,?,?, ?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    context.tenantId,
    issuePublicId,
    context.runId,
    input.code,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
    fingerprint,
    input.summary,
    stableCanonicalJson(input.details),
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
    context.nowUtc,
  );
}

async function resolvePatientLink(
  context: Context,
  legacyPatientId: number,
): Promise<string | null> {
  const publicId = await mappedPublicId(context.db, {
    tenantId: context.tenantId,
    entityType: 'patient_link',
    sourceType: 'legacy_patient',
    sourcePublicId: String(legacyPatientId),
  });
  if (!publicId) return null;
  const row = await context.db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(context.tenantId, publicId).first<PatientLinkRow>();
  if (!row || ['rejected', 'retired'].includes(row.link_status) || row.effective_to_utc != null) return null;
  return publicId;
}

async function resolveDoctorPractitioner(
  context: Context,
  doctorId: number | null,
  fallbackUserId: number,
): Promise<string | null> {
  let publicId: string | null = null;
  if (doctorId != null) {
    publicId = await mappedPublicId(context.db, {
      tenantId: context.tenantId,
      entityType: 'practitioner',
      sourceType: 'legacy_doctor',
      sourcePublicId: String(doctorId),
    });
  }
  if (!publicId) {
    const link = await context.db.prepare(`
      SELECT practitioner_public_id,status FROM (
        SELECT l.practitioner_public_id,p.status
        FROM canonical_practitioner_user_links l
        JOIN canonical_practitioners p
          ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
        WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active'
        LIMIT 1
      )
    `).bind(context.tenantId, fallbackUserId).first<PractitionerRow>();
    publicId = link?.status === 'active' ? link.practitioner_public_id : null;
  }
  if (!publicId) return null;
  const practitioner = await context.db.prepare(`
    SELECT practitioner_public_id,status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1
  `).bind(context.tenantId, publicId).first<PractitionerRow>();
  return practitioner?.status === 'active' ? publicId : null;
}

async function validEncounter(
  context: Context,
  encounterPublicId: string | null,
  patientLinkPublicId: string,
): Promise<string | null> {
  if (!encounterPublicId) return null;
  const row = await context.db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(context.tenantId, encounterPublicId).first<EncounterRow>();
  if (!row || row.patient_link_public_id !== patientLinkPublicId || row.status === 'entered_in_error') return null;
  return row.encounter_public_id;
}

async function resolvePrescriptionEncounter(
  context: Context,
  source: PrescriptionSourceRow,
  patientLinkPublicId: string,
): Promise<{ encounterPublicId: string | null; candidateCount: number }> {
  const candidates = new Set<string>();
  if (source.completion_claim_id != null) {
    const claim = await context.db.prepare(`
      SELECT visit_id,encounter_id FROM consultation_completion_claims
      WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(context.tenantId, source.completion_claim_id).first<ClaimRow>();
    if (claim) {
      const fromVisit = await mappedPublicId(context.db, {
        tenantId: context.tenantId,
        entityType: 'encounter',
        sourceType: 'legacy_visit',
        sourcePublicId: String(claim.visit_id),
      });
      const validVisit = await validEncounter(context, fromVisit, patientLinkPublicId);
      if (validVisit) candidates.add(validVisit);
      if (claim.encounter_id != null) {
        const fromEncounter = await mappedPublicId(context.db, {
          tenantId: context.tenantId,
          entityType: 'encounter',
          sourceType: 'legacy_encounter',
          sourcePublicId: String(claim.encounter_id),
        });
        const validLegacyEncounter = await validEncounter(context, fromEncounter, patientLinkPublicId);
        if (validLegacyEncounter) candidates.add(validLegacyEncounter);
      }
    }
  }
  if (source.appointment_id != null) {
    const appointmentPublicId = await mappedPublicId(context.db, {
      tenantId: context.tenantId,
      entityType: 'appointment',
      sourceType: 'legacy_appointment',
      sourcePublicId: String(source.appointment_id),
    });
    if (appointmentPublicId) {
      const links = await allRows<AppointmentLinkRow>(context.db.prepare(`
        SELECT encounter_public_id FROM canonical_appointment_encounter_links
        WHERE tenant_id=? AND appointment_public_id=? AND link_status='active'
      `).bind(context.tenantId, appointmentPublicId));
      for (const link of links) {
        const valid = await validEncounter(context, link.encounter_public_id, patientLinkPublicId);
        if (valid) candidates.add(valid);
      }
    }
  }
  if (source.admission_id != null) {
    const admissionPublicId = await mappedPublicId(context.db, {
      tenantId: context.tenantId,
      entityType: 'admission',
      sourceType: 'legacy_admission',
      sourcePublicId: String(source.admission_id),
    });
    if (admissionPublicId) {
      const admission = await context.db.prepare(`
        SELECT encounter_public_id FROM canonical_admissions
        WHERE tenant_id=? AND admission_public_id=? LIMIT 1
      `).bind(context.tenantId, admissionPublicId).first<AdmissionRow>();
      const valid = await validEncounter(context, admission?.encounter_public_id ?? null, patientLinkPublicId);
      if (valid) candidates.add(valid);
    }
  }
  return {
    encounterPublicId: candidates.size === 1 ? [...candidates][0] : null,
    candidateCount: candidates.size,
  };
}

async function processPrescription(
  context: Context,
  source: PrescriptionSourceRow,
): Promise<void> {
  const sourcePublicId = String(source.id);
  const existing = await mapping(context.db, {
    tenantId: context.tenantId,
    entityType: 'prescription',
    sourceType: PRESCRIPTION_SOURCE,
    sourcePublicId,
  });
  if (existing?.mapping_status === 'mapped' && existing.canonical_public_id) {
    context.skipped += 1;
    return;
  }

  const patientLinkPublicId = await resolvePatientLink(context, source.patient_id);
  if (!patientLinkPublicId) {
    await context.db.batch([await issueStatement(context, {
      code: 'RX_PATIENT_LINK_MISSING',
      entityType: 'prescription',
      sourceType: PRESCRIPTION_SOURCE,
      sourcePublicId,
      summary: 'Prescription patient link evidence is missing or inactive',
      details: { missingPatientLink: true },
    })]);
    return;
  }
  const practitionerPublicId = await resolveDoctorPractitioner(
    context,
    source.doctor_id,
    source.created_by,
  );
  if (!practitionerPublicId) {
    await context.db.batch([await issueStatement(context, {
      code: 'RX_PRACTITIONER_EVIDENCE_MISSING',
      entityType: 'prescription',
      sourceType: PRESCRIPTION_SOURCE,
      sourcePublicId,
      summary: 'Prescription practitioner evidence is missing or inactive',
      details: { missingPractitioner: true },
    })]);
    return;
  }
  const encounter = await resolvePrescriptionEncounter(context, source, patientLinkPublicId);
  if (!encounter.encounterPublicId) {
    await context.db.batch([await issueStatement(context, {
      code: encounter.candidateCount > 1
        ? 'RX_ENCOUNTER_EVIDENCE_AMBIGUOUS'
        : 'RX_ENCOUNTER_EVIDENCE_MISSING',
      entityType: 'prescription',
      sourceType: PRESCRIPTION_SOURCE,
      sourcePublicId,
      summary: encounter.candidateCount > 1
        ? 'Prescription has conflicting exact encounter evidence'
        : 'Prescription has no exact encounter evidence',
      details: { exactEncounterCandidateCount: encounter.candidateCount },
    })]);
    return;
  }

  const items = await allRows<PrescriptionItemRow>(context.db.prepare(`
    SELECT id,medicine_name,dosage,frequency,duration,instructions,sort_order,
           quantity,dispensed_qty,medicine_id
    FROM prescription_items WHERE prescription_id=? ORDER BY COALESCE(sort_order,0),id
  `).bind(source.id));
  const overrides = await allRows<PrescriptionOverrideRow>(context.db.prepare(`
    SELECT id,override_type,severity,created_at FROM prescription_overrides
    WHERE tenant_id=? AND prescription_id=? ORDER BY id
  `).bind(context.tenantId, source.id));
  const safetyChecks = await allRows<PrescriptionSafetyCheckRow>(context.db.prepare(`
    SELECT id,check_type,has_warnings,warning_count,action_taken,checked_by,checked_at
    FROM prescription_safety_checks
    WHERE tenant_id=? AND prescription_id=? ORDER BY id
  `).bind(context.tenantId, source.id));

  const authoredAtUtc = normalizedUtc(source.created_at, 'prescription.created_at');
  const updatedAtUtc = normalizedUtc(source.updated_at, 'prescription.updated_at');
  const evidenceSha256 = await createSourceEvidenceSha256({
    source: {
      id: source.id,
      patientId: source.patient_id,
      doctorId: source.doctor_id,
      appointmentId: source.appointment_id,
      admissionId: source.admission_id,
      completionClaimId: source.completion_claim_id,
      status: source.status,
      locked: source.is_locked,
      createdAtUtc: authoredAtUtc,
      updatedAtUtc,
    },
    itemEvidence: await Promise.all(items.map((item) => createSourceEvidenceSha256(item))),
  });
  const requestFingerprintSha256 = await createRequestFingerprint({
    sourceType: PRESCRIPTION_SOURCE,
    sourcePublicId,
    patientLinkPublicId,
    encounterPublicId: encounter.encounterPublicId,
    practitionerPublicId,
    evidenceSha256,
  });
  const prescriptionPublicId = await createDeterministicSourceId(
    'rx', context.tenantId, PRESCRIPTION_SOURCE, sourcePublicId,
  );
  const versionPublicId = await createDeterministicSourceId(
    'rxver', context.tenantId, PRESCRIPTION_SOURCE, `${sourcePublicId}:v1`,
  );
  const status = mapPrescriptionStatus(source.status, Number(source.is_locked));
  const finalizedAtUtc = status.prescription === 'final' ? updatedAtUtc : null;
  const cancelledAtUtc = ['cancelled', 'entered_in_error'].includes(status.prescription) ? updatedAtUtc : null;
  const statements: PrescriptionMedicationBackfillPreparedStatement[] = [
    context.db.prepare(`
      INSERT INTO canonical_prescriptions (
        tenant_id,prescription_public_id,patient_link_public_id,encounter_public_id,
        prescribing_practitioner_public_id,current_version_public_id,current_status,
        status_version,authored_at_utc,finalized_at_utc,cancelled_at_utc,idempotency_key,
        request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,NULL,?,1,?,?,?,?,?,?,?,?)
    `).bind(
      context.tenantId,
      prescriptionPublicId,
      patientLinkPublicId,
      encounter.encounterPublicId,
      practitionerPublicId,
      status.prescription,
      authoredAtUtc,
      finalizedAtUtc,
      cancelledAtUtc,
      `backfill:${PRESCRIPTION_SOURCE}:${sourcePublicId}`,
      requestFingerprintSha256,
      evidenceSha256,
      context.nowUtc,
      context.nowUtc,
    ),
    context.db.prepare(`
      INSERT INTO canonical_prescription_versions (
        tenant_id,version_public_id,prescription_public_id,version_number,
        supersedes_version_public_id,version_status,content_sha256,signed_snapshot_sha256,
        authored_at_utc,finalized_at_utc,authoring_practitioner_public_id,
        signing_practitioner_public_id,actor_user_public_id,actor_system_key,
        source_evidence_sha256,created_at_utc
      ) VALUES (?,?,?,1,NULL,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      context.tenantId,
      versionPublicId,
      prescriptionPublicId,
      status.version,
      evidenceSha256,
      status.version === 'final' ? evidenceSha256 : null,
      authoredAtUtc,
      finalizedAtUtc,
      practitionerPublicId,
      status.version === 'final' ? practitionerPublicId : null,
      null,
      'canonical.backfill.prescription-medication-intent',
      evidenceSha256,
      context.nowUtc,
    ),
    sourceMappingStatement(context.db, {
      tenantId: context.tenantId,
      entityType: 'prescription',
      canonicalPublicId: prescriptionPublicId,
      sourceType: PRESCRIPTION_SOURCE,
      sourcePublicId,
      sourceTable: 'prescriptions',
      evidenceSha256,
      runId: context.runId,
      nowUtc: context.nowUtc,
    }),
    sourceMappingStatement(context.db, {
      tenantId: context.tenantId,
      entityType: 'prescription_version',
      canonicalPublicId: versionPublicId,
      sourceType: PRESCRIPTION_SOURCE,
      sourcePublicId: `${sourcePublicId}:v1`,
      sourceTable: 'prescriptions',
      evidenceSha256,
      runId: context.runId,
      nowUtc: context.nowUtc,
    }),
  ];

  for (const item of items) {
    const itemSourcePublicId = String(item.id);
    const orderPublicId = await createDeterministicSourceId(
      'rxord', context.tenantId, 'legacy_prescription_item', itemSourcePublicId,
    );
    const itemEvidenceSha256 = await createSourceEvidenceSha256(item);
    const itemFingerprintSha256 = await createRequestFingerprint({
      itemSourcePublicId,
      prescriptionPublicId,
      versionPublicId,
      itemEvidenceSha256,
    });
    const medicationCodeSystem = item.medicine_id == null ? null : 'legacy_medicine';
    const medicationCode = item.medicine_id == null ? null : String(item.medicine_id);
    statements.push(
      context.db.prepare(`
        INSERT INTO canonical_medication_orders (
          tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
          prescribing_practitioner_public_id,prescription_public_id,prescription_version_public_id,
          medication_code_system,medication_code,medication_display,generic_display,
          strength_snapshot,dose_text,route_code,frequency_code,duration_text,instructions_text,
          priority,intended_start_utc,intended_end_utc,current_status,status_version,
          idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,'unspecified',?,?,?,?,?,NULL,?,1,?,?,?,?,?)
      `).bind(
        context.tenantId,
        orderPublicId,
        patientLinkPublicId,
        encounter.encounterPublicId,
        practitionerPublicId,
        prescriptionPublicId,
        versionPublicId,
        medicationCodeSystem,
        medicationCode,
        item.medicine_name,
        item.dosage?.trim() || 'unspecified',
        item.frequency?.trim() || 'unspecified',
        item.duration,
        item.instructions,
        'routine',
        authoredAtUtc,
        status.order,
        `backfill:legacy_prescription_item:${itemSourcePublicId}`,
        itemFingerprintSha256,
        itemEvidenceSha256,
        context.nowUtc,
        context.nowUtc,
      ),
      context.db.prepare(`
        INSERT INTO canonical_medication_order_status_events (
          tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
          event_version,reason_code,safe_note,actor_practitioner_public_id,
          actor_user_public_id,actor_system_key,idempotency_key,source_evidence_sha256,
          occurred_at_utc,created_at_utc
        ) VALUES (?,?,?,NULL,?,1,'legacy_backfill',NULL,?,NULL,
                  'canonical.backfill.prescription-medication-intent',?,?,?,?)
      `).bind(
        context.tenantId,
        await createDeterministicSourceId('rxosevt', context.tenantId, 'legacy_prescription_item', itemSourcePublicId),
        orderPublicId,
        status.order,
        practitionerPublicId,
        `backfill:legacy_prescription_item:${itemSourcePublicId}:status`,
        itemEvidenceSha256,
        authoredAtUtc,
        context.nowUtc,
      ),
      sourceMappingStatement(context.db, {
        tenantId: context.tenantId,
        entityType: 'medication_order',
        canonicalPublicId: orderPublicId,
        sourceType: 'legacy_prescription_item',
        sourcePublicId: itemSourcePublicId,
        sourceTable: 'prescription_items',
        evidenceSha256: itemEvidenceSha256,
        runId: context.runId,
        nowUtc: context.nowUtc,
      }),
    );
  }

  for (const override of overrides) {
    const eventPublicId = await createDeterministicSourceId(
      'rxsafe', context.tenantId, 'legacy_prescription_override', String(override.id),
    );
    const safetyEvidenceSha256 = await createSourceEvidenceSha256(override);
    const occurredAtUtc = normalizedUtc(override.created_at, 'prescription_override.created_at');
    statements.push(
      context.db.prepare(`
        INSERT INTO canonical_prescription_safety_events (
          tenant_id,event_public_id,prescription_public_id,prescription_version_public_id,
          medication_order_public_id,event_type,outcome,severity,evidence_code,
          actor_practitioner_public_id,actor_user_public_id,actor_system_key,
          idempotency_key,source_evidence_sha256,occurred_at_utc,created_at_utc
        ) VALUES (?,?,?,?,NULL,'override','overridden',?,'legacy_override',?,NULL,
                  'canonical.backfill.prescription-medication-intent',?,?,?,?)
      `).bind(
        context.tenantId,
        eventPublicId,
        prescriptionPublicId,
        versionPublicId,
        mapSeverity(override.severity),
        practitionerPublicId,
        `backfill:legacy_prescription_override:${override.id}`,
        safetyEvidenceSha256,
        occurredAtUtc,
        context.nowUtc,
      ),
      sourceMappingStatement(context.db, {
        tenantId: context.tenantId,
        entityType: 'prescription_safety_event',
        canonicalPublicId: eventPublicId,
        sourceType: 'legacy_prescription_override',
        sourcePublicId: String(override.id),
        sourceTable: 'prescription_overrides',
        evidenceSha256: safetyEvidenceSha256,
        runId: context.runId,
        nowUtc: context.nowUtc,
      }),
    );
  }

  for (const safety of safetyChecks) {
    const eventPublicId = await createDeterministicSourceId(
      'rxsafe', context.tenantId, 'legacy_prescription_safety_check', String(safety.id),
    );
    const safetyEvidenceSha256 = await createSourceEvidenceSha256(safety);
    const occurredAtUtc = normalizedUtc(safety.checked_at, 'prescription_safety_check.checked_at');
    const actor = await resolveDoctorPractitioner(context, null, safety.checked_by);
    const action = safety.action_taken?.toLowerCase() ?? 'reviewed';
    const outcome = action.includes('override')
      ? 'overridden'
      : Number(safety.has_warnings ?? 0) > 0 || Number(safety.warning_count ?? 0) > 0
        ? 'warning'
        : 'passed';
    const eventType = action.includes('override') ? 'override' : mapSafetyType(safety.check_type);
    statements.push(
      context.db.prepare(`
        INSERT INTO canonical_prescription_safety_events (
          tenant_id,event_public_id,prescription_public_id,prescription_version_public_id,
          medication_order_public_id,event_type,outcome,severity,evidence_code,
          actor_practitioner_public_id,actor_user_public_id,actor_system_key,
          idempotency_key,source_evidence_sha256,occurred_at_utc,created_at_utc
        ) VALUES (?,?,?,?,NULL,?,?,?,'legacy_safety_check',?,NULL,
                  'canonical.backfill.prescription-medication-intent',?,?,?,?)
      `).bind(
        context.tenantId,
        eventPublicId,
        prescriptionPublicId,
        versionPublicId,
        eventType,
        outcome,
        Number(safety.has_warnings ?? 0) > 0 ? 'unknown' : 'none',
        actor,
        `backfill:legacy_prescription_safety_check:${safety.id}`,
        safetyEvidenceSha256,
        occurredAtUtc,
        context.nowUtc,
      ),
      sourceMappingStatement(context.db, {
        tenantId: context.tenantId,
        entityType: 'prescription_safety_event',
        canonicalPublicId: eventPublicId,
        sourceType: 'legacy_prescription_safety_check',
        sourcePublicId: String(safety.id),
        sourceTable: 'prescription_safety_checks',
        evidenceSha256: safetyEvidenceSha256,
        runId: context.runId,
        nowUtc: context.nowUtc,
      }),
    );
  }

  statements.push(context.db.prepare(`
    UPDATE canonical_prescriptions SET current_version_public_id=?,updated_at_utc=?
    WHERE tenant_id=? AND prescription_public_id=? AND current_version_public_id IS NULL
  `).bind(versionPublicId, context.nowUtc, context.tenantId, prescriptionPublicId));
  await context.db.batch(statements);
}

async function processCpoeOrder(context: Context, source: CpoeOrderRow): Promise<void> {
  const sourcePublicId = String(source.id);
  const existing = await mapping(context.db, {
    tenantId: context.tenantId,
    entityType: 'medication_order',
    sourceType: CPOE_SOURCE,
    sourcePublicId,
  });
  if (existing?.mapping_status === 'mapped' && existing.canonical_public_id) {
    context.skipped += 1;
    return;
  }
  const patientLinkPublicId = await resolvePatientLink(context, source.patient_id);
  const practitionerPublicId = await resolveDoctorPractitioner(context, null, source.ordered_by);
  const encounterMapped = await mappedPublicId(context.db, {
    tenantId: context.tenantId,
    entityType: 'encounter',
    sourceType: 'legacy_visit',
    sourcePublicId: String(source.visit_id),
  });
  const encounterPublicId = patientLinkPublicId
    ? await validEncounter(context, encounterMapped, patientLinkPublicId)
    : null;
  const missing = [
    !patientLinkPublicId ? 'patient_link' : null,
    !practitionerPublicId ? 'practitioner' : null,
    !encounterPublicId ? 'encounter' : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    await context.db.batch([await issueStatement(context, {
      code: 'RX_CPOE_IDENTITY_EVIDENCE_MISSING',
      entityType: 'medication_order',
      sourceType: CPOE_SOURCE,
      sourcePublicId,
      summary: 'Standalone CPOE medication order lacks exact identity or encounter evidence',
      details: { missingEvidenceKinds: missing },
    })]);
    return;
  }

  const occurredAtUtc = normalizedUtc(source.start_datetime || source.created_at, 'cln_medication_order.start_datetime');
  const endAtUtc = source.end_datetime == null ? null : normalizedUtc(source.end_datetime, 'cln_medication_order.end_datetime');
  const status = mapCpoeStatus(source.status);
  const evidenceSha256 = await createSourceEvidenceSha256(source);
  const orderPublicId = await createDeterministicSourceId(
    'rxord', context.tenantId, CPOE_SOURCE, sourcePublicId,
  );
  const requestFingerprintSha256 = await createRequestFingerprint({
    sourceType: CPOE_SOURCE,
    sourcePublicId,
    patientLinkPublicId,
    practitionerPublicId,
    encounterPublicId,
    evidenceSha256,
  });
  const medicationCodeSystem = source.formulary_item_id == null ? null : 'legacy_formulary';
  const medicationCode = source.formulary_item_id == null ? null : String(source.formulary_item_id);
  await context.db.batch([
    context.db.prepare(`
      INSERT INTO canonical_medication_orders (
        tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
        prescribing_practitioner_public_id,prescription_public_id,prescription_version_public_id,
        medication_code_system,medication_code,medication_display,generic_display,
        strength_snapshot,dose_text,route_code,frequency_code,duration_text,instructions_text,
        priority,intended_start_utc,intended_end_utc,current_status,status_version,
        idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)
    `).bind(
      context.tenantId,
      orderPublicId,
      patientLinkPublicId,
      encounterPublicId,
      practitionerPublicId,
      medicationCodeSystem,
      medicationCode,
      source.medication_name,
      source.generic_name,
      source.strength,
      source.dose,
      source.route,
      source.frequency,
      source.duration,
      source.instructions,
      mapPriority(source.priority),
      occurredAtUtc,
      endAtUtc,
      status,
      `backfill:${CPOE_SOURCE}:${sourcePublicId}`,
      requestFingerprintSha256,
      evidenceSha256,
      context.nowUtc,
      context.nowUtc,
    ),
    context.db.prepare(`
      INSERT INTO canonical_medication_order_status_events (
        tenant_id,event_public_id,medication_order_public_id,from_status,to_status,event_version,
        reason_code,safe_note,actor_practitioner_public_id,actor_user_public_id,actor_system_key,
        idempotency_key,source_evidence_sha256,occurred_at_utc,created_at_utc
      ) VALUES (?,?,?,NULL,?,1,'legacy_cpoe_backfill',NULL,?,NULL,
                'canonical.backfill.prescription-medication-intent',?,?,?,?)
    `).bind(
      context.tenantId,
      await createDeterministicSourceId('rxosevt', context.tenantId, CPOE_SOURCE, sourcePublicId),
      orderPublicId,
      status,
      practitionerPublicId,
      `backfill:${CPOE_SOURCE}:${sourcePublicId}:status`,
      evidenceSha256,
      occurredAtUtc,
      context.nowUtc,
    ),
    sourceMappingStatement(context.db, {
      tenantId: context.tenantId,
      entityType: 'medication_order',
      canonicalPublicId: orderPublicId,
      sourceType: CPOE_SOURCE,
      sourcePublicId,
      sourceTable: 'cln_medication_orders',
      evidenceSha256,
      runId: context.runId,
      nowUtc: context.nowUtc,
    }),
  ]);
}

async function processPrescriptionPartition(context: Context): Promise<boolean> {
  const checkpoint = await ensureCheckpoint(context.db, {
    tenantId: context.tenantId,
    runId: context.runId,
    runPublicId: context.runPublicId,
    sourceType: PRESCRIPTION_SOURCE,
    partitionKey: PRESCRIPTION_PARTITION,
    nowUtc: context.nowUtc,
  });
  if (checkpoint.status === 'completed') return true;
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const rows = await allRows<PrescriptionSourceRow>(context.db.prepare(`
    SELECT id,patient_id,doctor_id,appointment_id,admission_id,completion_claim_id,
           status,is_locked,created_by,created_at,updated_at
    FROM prescriptions
    WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of rows) {
    context.scanned += 1;
    context.remaining -= 1;
    await processPrescription(context, row);
    await updateCheckpoint(context, checkpoint.id, row.id, 'running');
    if (context.remaining <= 0) break;
  }
  const latestCursor = rows.length > 0 ? rows[rows.length - 1].id : cursor;
  const more = await count(context.db, `
    SELECT COUNT(*) AS count FROM prescriptions WHERE tenant_id=? AND id>?
  `, [context.tenantId, latestCursor]);
  if (more === 0) {
    await context.db.prepare(`
      UPDATE canonical_backfill_checkpoints SET status='completed',completed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(context.nowUtc, context.nowUtc, context.tenantId, checkpoint.id).run();
    return true;
  }
  return false;
}

async function processCpoePartition(context: Context): Promise<boolean> {
  const checkpoint = await ensureCheckpoint(context.db, {
    tenantId: context.tenantId,
    runId: context.runId,
    runPublicId: context.runPublicId,
    sourceType: CPOE_SOURCE,
    partitionKey: CPOE_PARTITION,
    nowUtc: context.nowUtc,
  });
  if (checkpoint.status === 'completed') return true;
  if (context.remaining <= 0) return false;
  const cursor = Number(checkpoint.cursor_value ?? 0);
  const rows = await allRows<CpoeOrderRow>(context.db.prepare(`
    SELECT id,patient_id,visit_id,formulary_item_id,medication_name,generic_name,strength,
           dosage_form,dose,route,frequency,duration,instructions,priority,start_datetime,
           end_datetime,status,status_reason,idempotency_key,ordered_by,created_at
    FROM cln_medication_orders
    WHERE tenant_id=? AND id>? ORDER BY id LIMIT ?
  `).bind(context.tenantId, cursor, context.remaining));
  for (const row of rows) {
    context.scanned += 1;
    context.remaining -= 1;
    await processCpoeOrder(context, row);
    await updateCheckpoint(context, checkpoint.id, row.id, 'running');
    if (context.remaining <= 0) break;
  }
  const latestCursor = rows.length > 0 ? rows[rows.length - 1].id : cursor;
  const more = await count(context.db, `
    SELECT COUNT(*) AS count FROM cln_medication_orders WHERE tenant_id=? AND id>?
  `, [context.tenantId, latestCursor]);
  if (more === 0) {
    await context.db.prepare(`
      UPDATE canonical_backfill_checkpoints SET status='completed',completed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(context.nowUtc, context.nowUtc, context.tenantId, checkpoint.id).run();
    return true;
  }
  return false;
}

export async function backfillPrescriptionMedicationIntent(
  db: PrescriptionMedicationBackfillDatabase,
  raw: PrescriptionMedicationBackfillOptions,
): Promise<PrescriptionMedicationBackfillResult> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const runPublicId = exact(raw.runPublicId, 'runPublicId');
  const nowUtc = toUtcIso(raw.nowUtc);
  const starting = await captureCounts(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  const context: Context = {
    db,
    tenantId,
    runId: run.id,
    runPublicId,
    nowUtc,
    remaining: limit(raw.maxSourceRecords),
    scanned: 0,
    skipped: 0,
  };

  const prescriptionsCompleted = await processPrescriptionPartition(context);
  const cpoeCompleted = prescriptionsCompleted && context.remaining > 0
    ? await processCpoePartition(context)
    : false;
  const completed = prescriptionsCompleted && cpoeCompleted;
  const result = await resultFromDelta(db, context, starting, completed);
  await db.prepare(`
    UPDATE canonical_migration_runs
    SET status=?,completed_at_utc=?,result_summary_json=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(
    completed ? 'succeeded' : 'running',
    completed ? nowUtc : null,
    stableCanonicalJson({ completed, counts: result.counts }),
    nowUtc,
    tenantId,
    run.id,
  ).run();
  return result;
}

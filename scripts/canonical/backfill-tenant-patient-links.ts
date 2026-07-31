import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PatientLinkBackfillPreparedStatement {
  bind(...values: unknown[]): PatientLinkBackfillPreparedStatement;
  run(): Promise<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PatientLinkBackfillDatabase {
  prepare(sql: string): PatientLinkBackfillPreparedStatement;
  batch(
    statements: PatientLinkBackfillPreparedStatement[],
  ): Promise<Array<{ success?: boolean; meta?: { changes?: number; last_row_id?: number } }>>;
}

export interface TenantPatientLinkBackfillInput {
  tenantId: string;
  runPublicId: string;
  nowUtc: string;
  chunkSize?: number;
  afterLegacyPatientId?: number | null;
}

export interface TenantPatientLinkBackfillCounts {
  scanned: number;
  created: number;
  skipped: number;
  verified: number;
  candidate: number;
  unlinked: number;
  events: number;
  mappings: number;
  issues: number;
}

export interface TenantPatientLinkBackfillResult {
  completed: boolean;
  nextCursorLegacyPatientId: number | null;
  counts: TenantPatientLinkBackfillCounts;
}

type SourcePatientRow = {
  id: number;
  tenant_id: string;
  uhid: string | null;
  national_id: string | null;
};

type GlobalIdentityRow = {
  global_uhid: string;
};

type ExistingMappingRow = {
  source_public_id: string;
  canonical_public_id: string | null;
};

type GlobalIdentitySchema = {
  uhidColumn: 'global_uhid' | 'uhid';
  activePredicate: 'is_active=1' | "identity_status='verified'";
};

async function resolveGlobalIdentitySchema(
  db: PatientLinkBackfillDatabase,
): Promise<GlobalIdentitySchema> {
  const columns = (await db.prepare(`
    PRAGMA table_info('global_patient_identity')
  `).all<{ name: string }>()).results;
  const names = new Set(columns.map((column) => column.name));
  const uhidColumn = names.has('global_uhid')
    ? 'global_uhid'
    : names.has('uhid')
      ? 'uhid'
      : null;
  if (!uhidColumn) {
    throw new Error('global_patient_identity requires global_uhid or uhid');
  }
  const activePredicate = names.has('is_active')
    ? 'is_active=1'
    : names.has('identity_status')
      ? "identity_status='verified'"
      : null;
  if (!activePredicate) {
    throw new Error('global_patient_identity requires is_active or identity_status');
  }
  return { uhidColumn, activePredicate };
}

type Classification = {
  status: 'verified' | 'candidate' | 'unlinked';
  verificationLevel: 'verified' | 'candidate' | 'unverified';
  evidenceType: 'unique_uhid' | 'ambiguous_candidate' | 'no_link_placeholder';
  eventType: 'verified_linked' | 'candidate_detected' | 'registered';
  globalPatientUhid: string | null;
  issueCode: 'PATIENT_UHID_AMBIGUOUS' | 'PATIENT_UHID_UNRESOLVED' | null;
  issueReason: string | null;
};

function requireExactString(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function requireNormalizedUtc(value: string): string {
  const normalized = toUtcIso(value);
  if (normalized !== value) throw new RangeError('nowUtc must be a normalized UTC ISO timestamp');
  return value;
}

function normalizeOptionalExact(value: string | null): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function classifyPatient(
  patient: SourcePatientRow,
  globalByUhid: Map<string, GlobalIdentityRow[]>,
): Classification {
  const sourceUhid = normalizeOptionalExact(patient.uhid);
  if (!sourceUhid) {
    return {
      status: 'unlinked',
      verificationLevel: 'unverified',
      evidenceType: 'no_link_placeholder',
      eventType: 'registered',
      globalPatientUhid: null,
      issueCode: null,
      issueReason: null,
    };
  }

  const matches = globalByUhid.get(sourceUhid) ?? [];
  if (matches.length === 1) {
    return {
      status: 'verified',
      verificationLevel: 'verified',
      evidenceType: 'unique_uhid',
      eventType: 'verified_linked',
      globalPatientUhid: matches[0].global_uhid,
      issueCode: null,
      issueReason: null,
    };
  }

  return {
    status: 'candidate',
    verificationLevel: 'candidate',
    evidenceType: 'ambiguous_candidate',
    eventType: 'candidate_detected',
    globalPatientUhid: null,
    issueCode: matches.length > 1 ? 'PATIENT_UHID_AMBIGUOUS' : 'PATIENT_UHID_UNRESOLVED',
    issueReason: matches.length > 1
      ? 'Source UHID resolves to multiple active global identities.'
      : 'Source UHID has no active global identity match.',
  };
}

function migrationRunStatement(
  db: PatientLinkBackfillDatabase,
  input: Required<TenantPatientLinkBackfillInput>,
  counts: TenantPatientLinkBackfillCounts,
): PatientLinkBackfillPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_migration_runs (
      tenant_id,run_public_id,migration_name,migration_kind,status,
      started_at_utc,completed_at_utc,result_summary_json,created_at_utc,updated_at_utc
    ) VALUES (?,?,'canonical_tenant_patient_links_backfill','backfill','succeeded',?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.runPublicId,
    input.nowUtc,
    input.nowUtc,
    stableCanonicalJson(counts),
    input.nowUtc,
    input.nowUtc,
  );
}

function linkStatement(
  db: PatientLinkBackfillDatabase,
  input: Required<TenantPatientLinkBackfillInput>,
  patient: SourcePatientRow,
  classification: Classification,
  patientLinkPublicId: string,
  evidenceSha256: string,
): PatientLinkBackfillPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,global_patient_uhid,
      link_status,verification_level,evidence_type,evidence_sha256,
      effective_from_utc,effective_to_utc,version,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,NULL,1,?,?)
  `).bind(
    input.tenantId,
    patientLinkPublicId,
    patient.id,
    classification.globalPatientUhid,
    classification.status,
    classification.verificationLevel,
    classification.evidenceType,
    evidenceSha256,
    input.nowUtc,
    input.nowUtc,
    input.nowUtc,
  );
}

function eventStatement(
  db: PatientLinkBackfillDatabase,
  input: Required<TenantPatientLinkBackfillInput>,
  patient: SourcePatientRow,
  classification: Classification,
  patientLinkPublicId: string,
  eventPublicId: string,
  evidenceSha256: string,
): PatientLinkBackfillPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_tenant_patient_link_events (
      tenant_id,event_public_id,patient_link_public_id,legacy_patient_id,global_patient_uhid,
      event_type,from_status,to_status,source_legacy_patient_id,target_legacy_patient_id,
      actor_user_id,actor_system_key,reason_code,evidence_type,evidence_sha256,
      idempotency_key,sequence,occurred_at_utc,created_at_utc
    ) VALUES (?,?,?,?,?,?,NULL,?,NULL,NULL,NULL,'canonical.patient-link.backfill',?,?,?,?,1,?,?)
  `).bind(
    input.tenantId,
    eventPublicId,
    patientLinkPublicId,
    patient.id,
    classification.globalPatientUhid,
    classification.eventType,
    classification.status,
    classification.issueCode ?? 'deterministic_patient_link_backfill',
    classification.evidenceType,
    evidenceSha256,
    `patient-link-backfill:${input.tenantId}:${patient.id}`,
    input.nowUtc,
    input.nowUtc,
  );
}

function mappingStatement(
  db: PatientLinkBackfillDatabase,
  input: Required<TenantPatientLinkBackfillInput>,
  patient: SourcePatientRow,
  patientLinkPublicId: string,
  evidenceSha256: string,
): PatientLinkBackfillPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?, 'patient_link', ?, 'legacy_patient', ?, 'patients', 'mapped', 1,
      (SELECT id FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=?),
      ?, ?, ?
    )
  `).bind(
    input.tenantId,
    patientLinkPublicId,
    String(patient.id),
    input.tenantId,
    input.runPublicId,
    evidenceSha256,
    input.nowUtc,
    input.nowUtc,
  );
}

function issueStatement(
  db: PatientLinkBackfillDatabase,
  input: Required<TenantPatientLinkBackfillInput>,
  patient: SourcePatientRow,
  classification: Classification,
  patientLinkPublicId: string,
  issuePublicId: string,
  issueFingerprint: string,
): PatientLinkBackfillPreparedStatement | null {
  if (!classification.issueCode || !classification.issueReason) return null;
  return db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,reconciliation_run_id,
      issue_type,issue_code,entity_type,entity_public_id,source_type,source_public_id,
      fingerprint,severity,status,occurrence_count,summary,details_json,
      first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?, ?,
      (SELECT id FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=?),
      NULL,'identity_resolution',?,'patient_link',?,'legacy_patient',?,
      ?,'warning','open',1,?,?, ?,?,?,?
    )
  `).bind(
    input.tenantId,
    issuePublicId,
    input.tenantId,
    input.runPublicId,
    classification.issueCode,
    patientLinkPublicId,
    String(patient.id),
    issueFingerprint,
    classification.issueReason,
    stableCanonicalJson({
      sourceTable: 'patients',
      sourcePatientId: String(patient.id),
      candidateOnly: true,
      automaticMergePerformed: false,
    }),
    input.nowUtc,
    input.nowUtc,
    input.nowUtc,
    input.nowUtc,
  );
}

function checkpointStatement(
  db: PatientLinkBackfillDatabase,
  input: Required<TenantPatientLinkBackfillInput>,
  checkpointPublicId: string,
  counts: TenantPatientLinkBackfillCounts,
  lastPatientId: number | null,
  completed: boolean,
): PatientLinkBackfillPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_backfill_checkpoints (
      tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
      partition_key,cursor_value,status,scanned_count,created_count,mapped_count,
      skipped_count,exception_count,started_at_utc,completed_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?, ?,
      (SELECT id FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=?),
      'patient_link','legacy_patient','',?,?,?,?,?,?,?,?,?,?,?
    )
  `).bind(
    input.tenantId,
    checkpointPublicId,
    input.tenantId,
    input.runPublicId,
    lastPatientId == null ? null : String(lastPatientId),
    completed ? 'completed' : 'paused',
    counts.scanned,
    counts.created,
    counts.mappings,
    counts.skipped,
    counts.issues,
    input.nowUtc,
    completed ? input.nowUtc : null,
    input.nowUtc,
    input.nowUtc,
  );
}

export async function backfillTenantPatientLinks(
  db: PatientLinkBackfillDatabase,
  rawInput: TenantPatientLinkBackfillInput,
): Promise<TenantPatientLinkBackfillResult> {
  const chunkSize = rawInput.chunkSize ?? 500;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > 5_000) {
    throw new RangeError('chunkSize must be an integer between 1 and 5000');
  }
  const afterLegacyPatientId = rawInput.afterLegacyPatientId ?? 0;
  if (!Number.isInteger(afterLegacyPatientId) || afterLegacyPatientId < 0) {
    throw new RangeError('afterLegacyPatientId must be a non-negative integer');
  }
  const input = {
    tenantId: requireExactString(rawInput.tenantId, 'tenantId'),
    runPublicId: requireExactString(rawInput.runPublicId, 'runPublicId'),
    nowUtc: requireNormalizedUtc(rawInput.nowUtc),
    chunkSize,
    afterLegacyPatientId,
  };

  const candidatePatients = (await db.prepare(`
    SELECT id,tenant_id,uhid,national_id
    FROM patients
    WHERE tenant_id=? AND id>?
    ORDER BY id
    LIMIT ?
  `).bind(input.tenantId, input.afterLegacyPatientId, input.chunkSize + 1).all<SourcePatientRow>()).results;
  const hasMore = candidatePatients.length > input.chunkSize;
  const patients = candidatePatients.slice(0, input.chunkSize);
  const globalIdentitySchema = await resolveGlobalIdentitySchema(db);
  const globalIdentities = (await db.prepare(`
    SELECT ${globalIdentitySchema.uhidColumn} AS global_uhid
    FROM global_patient_identity
    WHERE ${globalIdentitySchema.activePredicate}
      AND ${globalIdentitySchema.uhidColumn} IS NOT NULL
      AND trim(${globalIdentitySchema.uhidColumn})!=''
    ORDER BY id
  `).all<GlobalIdentityRow>()).results;
  const existingMappings = (await db.prepare(`
    SELECT source_public_id,canonical_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='patient_link' AND source_type='legacy_patient'
  `).bind(input.tenantId).all<ExistingMappingRow>()).results;

  const mappedSourceIds = new Set(existingMappings.map((row) => row.source_public_id));
  const globalByUhid = new Map<string, GlobalIdentityRow[]>();
  for (const identity of globalIdentities) {
    const uhid = normalizeOptionalExact(identity.global_uhid);
    if (!uhid) continue;
    const rows = globalByUhid.get(uhid) ?? [];
    rows.push(identity);
    globalByUhid.set(uhid, rows);
  }

  const counts: TenantPatientLinkBackfillCounts = {
    scanned: patients.length,
    created: 0,
    skipped: 0,
    verified: 0,
    candidate: 0,
    unlinked: 0,
    events: 0,
    mappings: 0,
    issues: 0,
  };
  const patientFacts: Array<{
    patient: SourcePatientRow;
    classification: Classification;
    patientLinkPublicId: string;
    eventPublicId: string;
    evidenceSha256: string;
    issuePublicId: string | null;
    issueFingerprint: string | null;
  }> = [];

  for (const patient of patients) {
    const sourcePublicId = String(patient.id);
    if (mappedSourceIds.has(sourcePublicId)) {
      counts.skipped += 1;
      continue;
    }
    const classification = classifyPatient(patient, globalByUhid);
    const patientLinkPublicId = await createDeterministicSourceId(
      'ptlink',
      input.tenantId,
      'legacy_patient',
      sourcePublicId,
    );
    const eventPublicId = await createDeterministicSourceId(
      'ptlevt',
      input.tenantId,
      'legacy_patient_event',
      sourcePublicId,
    );
    const evidenceSha256 = await createSourceEvidenceSha256({
      tenantId: input.tenantId,
      sourceTable: 'patients',
      sourcePublicId,
      sourceUhid: normalizeOptionalExact(patient.uhid),
      classification: classification.status,
      evidenceType: classification.evidenceType,
      globalMatchCount: normalizeOptionalExact(patient.uhid)
        ? (globalByUhid.get(normalizeOptionalExact(patient.uhid)!) ?? []).length
        : 0,
    });
    const issuePublicId = classification.issueCode
      ? await createDeterministicSourceId('ptlissue', input.tenantId, classification.issueCode, sourcePublicId)
      : null;
    const issueFingerprint = classification.issueCode
      ? await createSourceEvidenceSha256({
        tenantId: input.tenantId,
        issueCode: classification.issueCode,
        sourceType: 'legacy_patient',
        sourcePublicId,
      })
      : null;

    patientFacts.push({
      patient,
      classification,
      patientLinkPublicId,
      eventPublicId,
      evidenceSha256,
      issuePublicId,
      issueFingerprint,
    });
    counts.created += 1;
    counts.events += 1;
    counts.mappings += 1;
    counts[classification.status] += 1;
    if (classification.issueCode) counts.issues += 1;
  }

  const statements: PatientLinkBackfillPreparedStatement[] = [
    migrationRunStatement(db, input, counts),
  ];
  for (const fact of patientFacts) {
    statements.push(
      linkStatement(db, input, fact.patient, fact.classification, fact.patientLinkPublicId, fact.evidenceSha256),
      eventStatement(
        db,
        input,
        fact.patient,
        fact.classification,
        fact.patientLinkPublicId,
        fact.eventPublicId,
        fact.evidenceSha256,
      ),
      mappingStatement(db, input, fact.patient, fact.patientLinkPublicId, fact.evidenceSha256),
    );
    const issue = fact.issuePublicId && fact.issueFingerprint
      ? issueStatement(
        db,
        input,
        fact.patient,
        fact.classification,
        fact.patientLinkPublicId,
        fact.issuePublicId,
        fact.issueFingerprint,
      )
      : null;
    if (issue) statements.push(issue);
  }
  const checkpointPublicId = await createDeterministicSourceId(
    'ptlcp',
    input.tenantId,
    'patient_link_backfill_run',
    input.runPublicId,
  );
  const lastProcessedPatientId = patients.length > 0 ? patients[patients.length - 1].id : null;
  statements.push(checkpointStatement(
    db,
    input,
    checkpointPublicId,
    counts,
    lastProcessedPatientId,
    !hasMore,
  ));

  await db.batch(statements);
  return {
    completed: !hasMore,
    nextCursorLegacyPatientId: hasMore ? lastProcessedPatientId : null,
    counts,
  };
}

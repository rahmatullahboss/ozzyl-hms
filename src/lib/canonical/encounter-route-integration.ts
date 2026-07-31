import type {
  CanonicalBatchDatabase,
  CanonicalCommandExecutionOptions,
  CanonicalCommandResult,
  CanonicalPreparedStatement,
} from './command-batch';
import {
  cancelEncounter,
  completeEncounter,
  prepareCompleteEncounterBatch,
  prepareStartEncounterBatch,
  replaceEncounterParticipant,
  startEncounter,
  type CompleteEncounterResult,
  type PreparedEncounterCompletion,
  type ReplaceEncounterParticipantResult,
  type StartEncounterParticipantRole,
  type StartEncounterResult,
  type StartEncounterType,
} from './commands/start-encounter';
import { resolveAppointmentRoutePractitioner } from './appointment-route-integration';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from './source-mapping';

interface PatientLinkResolutionRow {
  link_count: number;
  patient_link_public_id: string | null;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface EncounterRow {
  encounter_public_id: string;
  legacy_patient_id: number;
  patient_link_public_id: string | null;
  encounter_type: StartEncounterType;
  status: string;
  encounter_version: number;
  started_at_utc: string;
  ended_at_utc: string | null;
}

export interface EncounterVisitSnapshot {
  visitId: number;
  patientId: number;
  doctorId: number | null;
  visitType: string;
  visitDate: string;
  status: string;
  appointmentId: number | null;
  canonicalSourceKey: string | null;
}

export interface EncounterRouteContext {
  tenantId: string;
  sourceType: 'legacy_visit';
  sourcePublicId: string;
  encounterPublicId: string;
  encounterVersion: number;
  encounterStatus: string;
  startedAtUtc: string;
  patientId: number;
  patientLinkPublicId: string;
  practitionerPublicId: string | null;
  encounterType: StartEncounterType;
}

export interface StartRouteEncounterInput {
  tenantId: string;
  visitId: number;
  patientId: number;
  doctorId: number | null;
  visitType: string;
  startedAtUtc: string;
  sourceEvidence: unknown;
  idempotencyKey: string;
  businessDate: string;
  authoritativeStatements: readonly CanonicalPreparedStatement[];
}

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} cannot be empty`);
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function encounterType(value: string): StartEncounterType {
  if (value === 'ipd' || value === 'inpatient') return 'inpatient';
  if (value === 'telemedicine' || value === 'teleconsultation') return 'teleconsultation';
  if (value === 'emergency' || value === 'er') return 'emergency';
  if (value === 'opd' || value === 'outpatient') return 'outpatient';
  return 'other';
}

async function exactPatientLink(
  db: CanonicalBatchDatabase,
  tenantId: string,
  patientId: number,
): Promise<string> {
  const result = await db.prepare(`
    SELECT COUNT(*) AS link_count,MAX(patient_link_public_id) AS patient_link_public_id
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
      AND effective_to_utc IS NULL
      AND link_status NOT IN ('rejected','retired')
  `).bind(tenantId, patientId).first<PatientLinkResolutionRow>();
  if (Number(result?.link_count ?? 0) !== 1 || !result?.patient_link_public_id) {
    throw new Error('encounter requires one exact active tenant patient link');
  }
  return String(result.patient_link_public_id);
}

export async function createEncounterVisitSourceKey(
  tenantId: string,
  suppliedOperationKey?: string | null,
): Promise<string> {
  const tenant = exact(tenantId, 'tenantId');
  const operationKey = suppliedOperationKey?.trim();
  return operationKey
    ? createDeterministicSourceId('vissrc', tenant, 'visit_route', operationKey)
    : `vissrc_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function findEncounterVisitBySourceKey(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourceKey: string,
): Promise<{ id: number; visit_no: string | null } | null> {
  return db.prepare(`
    SELECT id,visit_no
    FROM visits
    WHERE tenant_id=? AND canonical_source_key=?
    LIMIT 1
  `).bind(exact(tenantId, 'tenantId'), exact(sourceKey, 'sourceKey'))
    .first<{ id: number; visit_no: string | null }>();
}

export async function reserveEncounterVisitId(
  db: CanonicalBatchDatabase,
  tenantId: string,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COALESCE(MAX(id),0)+1 AS next_id
    FROM visits
    WHERE tenant_id=?
  `).bind(exact(tenantId, 'tenantId')).first<{ next_id: number }>();
  return positive(Number(row?.next_id ?? 0), 'nextVisitId');
}

export async function resolveEncounterRouteContext(
  db: CanonicalBatchDatabase,
  input: { tenantId: string; visit: EncounterVisitSnapshot },
): Promise<EncounterRouteContext> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const visitId = positive(input.visit.visitId, 'visitId');
  const patientId = positive(input.visit.patientId, 'patientId');
  const patientLinkPublicId = await exactPatientLink(db, tenantId, patientId);
  const practitionerPublicId = await resolveAppointmentRoutePractitioner(
    db,
    tenantId,
    input.visit.doctorId,
  );
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type='legacy_visit' AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, String(visitId)).first<MappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('visit requires one exact Canonical encounter mapping');
  }
  const encounter = await db.prepare(`
    SELECT encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,
           status,encounter_version,started_at_utc,ended_at_utc
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, mapping.canonical_public_id).first<EncounterRow>();
  if (!encounter) throw new Error('mapped Canonical encounter not found');
  if (
    Number(encounter.legacy_patient_id) !== patientId
    || encounter.patient_link_public_id !== patientLinkPublicId
  ) {
    throw new Error('mapped Canonical encounter does not match visit patient evidence');
  }
  return {
    tenantId,
    sourceType: 'legacy_visit',
    sourcePublicId: String(visitId),
    encounterPublicId: String(encounter.encounter_public_id),
    encounterVersion: positive(Number(encounter.encounter_version), 'encounterVersion'),
    encounterStatus: String(encounter.status),
    startedAtUtc: String(encounter.started_at_utc),
    patientId,
    patientLinkPublicId,
    practitionerPublicId,
    encounterType: encounter.encounter_type,
  };
}

async function routeStartEncounterInput(
  db: CanonicalBatchDatabase,
  input: StartRouteEncounterInput,
) {
  const tenantId = exact(input.tenantId, 'tenantId');
  const visitId = positive(input.visitId, 'visitId');
  const patientId = positive(input.patientId, 'patientId');
  const patientLinkPublicId = await exactPatientLink(db, tenantId, patientId);
  const practitionerPublicId = await resolveAppointmentRoutePractitioner(db, tenantId, input.doctorId);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256(input.sourceEvidence);
  return {
    tenantId,
    legacyPatientId: patientId,
    patientLinkPublicId,
    encounterType: encounterType(input.visitType),
    startedAtUtc: exact(input.startedAtUtc, 'startedAtUtc'),
    practitionerPublicId,
    participantRole: practitionerPublicId ? 'treating' as const : null,
    sourceKind: 'runtime' as const,
    sourceType: 'legacy_visit',
    sourcePublicId: String(visitId),
    sourceTable: 'visits',
    sourceEvidenceSha256,
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    businessDate: exact(input.businessDate, 'businessDate'),
  };
}

export async function startRouteEncounter(
  db: CanonicalBatchDatabase,
  input: StartRouteEncounterInput,
): Promise<CanonicalCommandResult<StartEncounterResult>> {
  return startEncounter(db, await routeStartEncounterInput(db, input), {
    authoritativeStatements: input.authoritativeStatements,
  });
}

export async function prepareStartRouteEncounterBatch(
  db: CanonicalBatchDatabase,
  input: StartRouteEncounterInput,
) {
  return prepareStartEncounterBatch(
    db,
    await routeStartEncounterInput(db, input),
    input.authoritativeStatements,
  );
}

function completionInput(
  context: EncounterRouteContext,
  input: {
    completedAtUtc: string;
    sourceEvidenceSha256: string;
    idempotencyKey: string;
    businessDate: string;
    signedSnapshotSha256?: string | null;
    signedAtUtc?: string | null;
  },
) {
  return {
    tenantId: context.tenantId,
    encounterPublicId: context.encounterPublicId,
    expectedVersion: context.encounterVersion,
    completedAtUtc: exact(input.completedAtUtc, 'completedAtUtc'),
    signedSnapshotSha256: input.signedSnapshotSha256 ?? null,
    signedAtUtc: input.signedAtUtc ?? null,
    sourceEvidenceSha256: exact(input.sourceEvidenceSha256, 'sourceEvidenceSha256'),
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    businessDate: exact(input.businessDate, 'businessDate'),
  };
}

export async function completeRouteEncounter(
  db: CanonicalBatchDatabase,
  context: EncounterRouteContext,
  input: {
    completedAtUtc: string;
    sourceEvidence: unknown;
    idempotencyKey: string;
    businessDate: string;
    signedSnapshotSha256?: string | null;
    signedAtUtc?: string | null;
    authoritativeStatements: readonly CanonicalPreparedStatement[];
  },
): Promise<CanonicalCommandResult<CompleteEncounterResult>> {
  const sourceEvidenceSha256 = await createSourceEvidenceSha256(input.sourceEvidence);
  return completeEncounter(db, completionInput(context, {
    ...input,
    sourceEvidenceSha256,
  }), { authoritativeStatements: input.authoritativeStatements });
}

export async function cancelRouteEncounter(
  db: CanonicalBatchDatabase,
  context: EncounterRouteContext,
  input: {
    cancelledAtUtc: string;
    sourceEvidence: unknown;
    idempotencyKey: string;
    businessDate: string;
    authoritativeStatements: readonly CanonicalPreparedStatement[];
  },
) {
  const sourceEvidenceSha256 = await createSourceEvidenceSha256(input.sourceEvidence);
  return cancelEncounter(db, {
    tenantId: context.tenantId,
    encounterPublicId: context.encounterPublicId,
    expectedVersion: context.encounterVersion,
    cancelledAtUtc: exact(input.cancelledAtUtc, 'cancelledAtUtc'),
    sourceEvidenceSha256,
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    businessDate: exact(input.businessDate, 'businessDate'),
  }, { authoritativeStatements: input.authoritativeStatements });
}

export async function prepareRouteEncounterCompletionBatch(
  db: CanonicalBatchDatabase,
  context: EncounterRouteContext,
  input: {
    completedAtUtc: string;
    sourceEvidence: unknown;
    idempotencyKey: string;
    businessDate: string;
    signedSnapshotSha256?: string | null;
    signedAtUtc?: string | null;
    authoritativeStatements?: readonly CanonicalPreparedStatement[];
  },
): Promise<PreparedEncounterCompletion> {
  const sourceEvidenceSha256 = await createSourceEvidenceSha256(input.sourceEvidence);
  return prepareCompleteEncounterBatch(db, completionInput(context, {
    ...input,
    sourceEvidenceSha256,
  }), input.authoritativeStatements ?? []);
}

export async function replaceRouteEncounterParticipant(
  db: CanonicalBatchDatabase,
  context: EncounterRouteContext,
  input: {
    doctorId: number;
    changedAtUtc: string;
    sourceEvidence: unknown;
    idempotencyKey: string;
    businessDate: string;
    participantRole?: StartEncounterParticipantRole;
    authoritativeStatements: readonly CanonicalPreparedStatement[];
  },
): Promise<CanonicalCommandResult<ReplaceEncounterParticipantResult>> {
  const practitionerPublicId = await resolveAppointmentRoutePractitioner(
    db,
    context.tenantId,
    positive(input.doctorId, 'doctorId'),
  );
  if (!practitionerPublicId) throw new Error('participant replacement requires an exact practitioner mapping');
  const sourceEvidenceSha256 = await createSourceEvidenceSha256(input.sourceEvidence);
  return replaceEncounterParticipant(db, {
    tenantId: context.tenantId,
    encounterPublicId: context.encounterPublicId,
    expectedVersion: context.encounterVersion,
    practitionerPublicId,
    participantRole: input.participantRole ?? 'treating',
    changedAtUtc: exact(input.changedAtUtc, 'changedAtUtc'),
    sourceEvidenceSha256,
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    businessDate: exact(input.businessDate, 'businessDate'),
  }, { authoritativeStatements: input.authoritativeStatements });
}

export function routeExecutionOptions(
  statements: readonly CanonicalPreparedStatement[],
): CanonicalCommandExecutionOptions {
  return { authoritativeStatements: statements };
}

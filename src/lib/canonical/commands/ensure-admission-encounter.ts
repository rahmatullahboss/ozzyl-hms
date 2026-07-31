import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandResult,
} from '../command-batch';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';

const SOURCE_TYPE = 'legacy_admission';
const SOURCE_TABLE = 'admissions';
const COMMAND_NAME = 'canonical.admission.encounter.ensure';

export type AdmissionEncounterType = 'inpatient' | 'emergency';

export interface EnsureAdmissionEncounterInput {
  tenantId: string;
  legacyAdmissionId: number;
  admissionNo: string;
  legacyPatientId: number;
  admissionType: 'general' | 'emergency' | 'planned' | 'transfer';
  startedAtUtc: string;
}

export interface EnsureAdmissionEncounterResult {
  encounterPublicId: string;
  legacyAdmissionId: number;
  encounterType: AdmissionEncounterType;
  encounterStatus: 'in_progress';
}

interface AdmissionAuthorityRow {
  encounter_public_id: string;
  admission_no: string;
  link_status: string;
  legacy_patient_id: number;
  encounter_type: string;
  status: string;
  started_at_utc: string;
  ended_at_utc: string | null;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface EncounterRow {
  encounter_public_id: string;
  legacy_patient_id: number;
  encounter_type: string;
  status: string;
  started_at_utc: string;
  ended_at_utc: string | null;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function admissionType(value: string): EnsureAdmissionEncounterInput['admissionType'] {
  const normalized = exact(value, 'admissionType');
  if (!['general', 'emergency', 'planned', 'transfer'].includes(normalized)) {
    throw new RangeError('admissionType is invalid');
  }
  return normalized as EnsureAdmissionEncounterInput['admissionType'];
}

function encounterType(value: EnsureAdmissionEncounterInput['admissionType']): AdmissionEncounterType {
  return value === 'emergency' ? 'emergency' : 'inpatient';
}

function normalizedUtc(value: string, label: string): string {
  const exactValue = exact(value, label);
  let normalized: string;
  try {
    normalized = toUtcIso(exactValue);
  } catch (cause) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`, { cause });
  }
  if (normalized !== exactValue) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return normalized;
}

function verifyEncounter(input: {
  row: EncounterRow | AdmissionAuthorityRow;
  patientId: number;
  expectedType: AdmissionEncounterType;
}): void {
  if (Number(input.row.legacy_patient_id) !== input.patientId) {
    throw new Error('Canonical admission encounter patient mismatch');
  }
  if (input.row.encounter_type !== input.expectedType) {
    throw new Error('Canonical admission encounter type mismatch');
  }
  if (input.row.status !== 'in_progress' || input.row.ended_at_utc != null) {
    throw new Error('Canonical admission encounter is not active');
  }
}

function resultFromRow(
  row: Pick<EncounterRow, 'encounter_public_id' | 'encounter_type'>,
  legacyAdmissionId: number,
): EnsureAdmissionEncounterResult {
  return {
    encounterPublicId: row.encounter_public_id,
    legacyAdmissionId,
    encounterType: row.encounter_type as AdmissionEncounterType,
    encounterStatus: 'in_progress',
  };
}

async function readAdmissionAuthority(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyAdmissionId: number,
): Promise<AdmissionAuthorityRow | null> {
  return db.prepare(`
    SELECT l.encounter_public_id,l.admission_no,l.link_status,
           e.legacy_patient_id,e.encounter_type,e.status,e.started_at_utc,e.ended_at_utc
    FROM canonical_encounter_admission_links l
    JOIN canonical_encounters e
      ON e.tenant_id=l.tenant_id AND e.encounter_public_id=l.encounter_public_id
    WHERE l.tenant_id=? AND l.legacy_admission_id=? AND l.link_status='active'
    LIMIT 1
  `).bind(tenantId, legacyAdmissionId).first<AdmissionAuthorityRow>();
}

async function readAdmissionMapping(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyAdmissionId: number,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, SOURCE_TYPE, String(legacyAdmissionId)).first<MappingRow>();
}

async function readEncounter(
  db: CanonicalBatchDatabase,
  tenantId: string,
  encounterPublicId: string,
): Promise<EncounterRow | null> {
  return db.prepare(`
    SELECT encounter_public_id,legacy_patient_id,encounter_type,status,started_at_utc,ended_at_utc
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(tenantId, encounterPublicId).first<EncounterRow>();
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    encounterPublicId: string;
    legacyAdmissionId: number;
    evidenceSha256: string;
  },
) {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'encounter',?,?,?,'admissions','mapped',1,?)
  `).bind(
    input.tenantId,
    input.encounterPublicId,
    SOURCE_TYPE,
    String(input.legacyAdmissionId),
    input.evidenceSha256,
  );
}

export async function ensureAdmissionEncounter(
  db: CanonicalBatchDatabase,
  input: EnsureAdmissionEncounterInput,
): Promise<CanonicalCommandResult<EnsureAdmissionEncounterResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const legacyAdmissionId = positive(input.legacyAdmissionId, 'legacyAdmissionId');
  const admissionNo = exact(input.admissionNo, 'admissionNo');
  const legacyPatientId = positive(input.legacyPatientId, 'legacyPatientId');
  const sourceAdmissionType = admissionType(input.admissionType);
  const expectedEncounterType = encounterType(sourceAdmissionType);
  const startedAtUtc = normalizedUtc(input.startedAtUtc, 'startedAtUtc');
  const sourcePublicId = String(legacyAdmissionId);
  const evidenceSha256 = await createSourceEvidenceSha256({
    sourceType: SOURCE_TYPE,
    sourcePublicId,
    sourceTable: SOURCE_TABLE,
    legacyAdmissionId,
    admissionNo,
    legacyPatientId,
    admissionType: sourceAdmissionType,
    startedAtUtc,
  });

  const linked = await readAdmissionAuthority(db, tenantId, legacyAdmissionId);
  const mapping = await readAdmissionMapping(db, tenantId, legacyAdmissionId);
  if (linked) {
    if (linked.admission_no !== admissionNo) throw new Error('Canonical admission number mismatch');
    verifyEncounter({ row: linked, patientId: legacyPatientId, expectedType: expectedEncounterType });
    if (mapping) {
      if (mapping.mapping_status !== 'mapped' || mapping.canonical_public_id !== linked.encounter_public_id) {
        throw new Error('Canonical admission mapping mismatch');
      }
    } else {
      await db.batch([mappingStatement(db, {
        tenantId,
        encounterPublicId: linked.encounter_public_id,
        legacyAdmissionId,
        evidenceSha256,
      })]);
    }
    return { status: 'replayed', result: resultFromRow(linked, legacyAdmissionId) };
  }

  if (mapping) {
    if (mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
      throw new Error('Canonical admission mapping is unresolved');
    }
    const existingEncounter = await readEncounter(db, tenantId, mapping.canonical_public_id);
    if (!existingEncounter) throw new Error('Canonical admission mapping target is missing');
    verifyEncounter({ row: existingEncounter, patientId: legacyPatientId, expectedType: expectedEncounterType });
    await db.batch([
      db.prepare(`
        INSERT INTO canonical_encounter_admission_links (
          tenant_id,encounter_public_id,legacy_admission_id,admission_no,
          link_status,source_evidence_sha256
        ) VALUES (?,?,?,?,'active',?)
      `).bind(
        tenantId,
        existingEncounter.encounter_public_id,
        legacyAdmissionId,
        admissionNo,
        evidenceSha256,
      ),
    ]);
    return { status: 'replayed', result: resultFromRow(existingEncounter, legacyAdmissionId) };
  }

  const encounterPublicId = await createDeterministicSourceId(
    'enc', tenantId, SOURCE_TYPE, sourcePublicId,
  );
  const eventPublicId = await createDeterministicSourceId(
    'outevt', tenantId, 'canonical_admission_encounter_started', sourcePublicId,
  );
  const result: EnsureAdmissionEncounterResult = {
    encounterPublicId,
    legacyAdmissionId,
    encounterType: expectedEncounterType,
    encounterStatus: 'in_progress',
  };

  return runCanonicalBatch(db, {
    tenantId,
    commandName: COMMAND_NAME,
    idempotencyKey: `canonical-admission-encounter:${sourcePublicId}`,
    request: {
      legacyAdmissionId,
      admissionNo,
      legacyPatientId,
      admissionType: sourceAdmissionType,
      startedAtUtc,
    },
    statements: [
      db.prepare(`
        INSERT INTO canonical_encounters (
          tenant_id,encounter_public_id,legacy_patient_id,encounter_type,
          status,started_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,'in_progress',?,?)
      `).bind(
        tenantId,
        encounterPublicId,
        legacyPatientId,
        expectedEncounterType,
        startedAtUtc,
        evidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_encounter_admission_links (
          tenant_id,encounter_public_id,legacy_admission_id,admission_no,
          link_status,source_evidence_sha256
        ) VALUES (?,?,?,?,'active',?)
      `).bind(
        tenantId,
        encounterPublicId,
        legacyAdmissionId,
        admissionNo,
        evidenceSha256,
      ),
    ],
    reconciliationStatements: [mappingStatement(db, {
      tenantId,
      encounterPublicId,
      legacyAdmissionId,
      evidenceSha256,
    })],
    result,
    event: {
      eventPublicId,
      aggregateType: 'canonical_encounter',
      aggregatePublicId: encounterPublicId,
      eventType: 'canonical.admission_encounter.started',
      payload: {
        encounterPublicId,
        legacyAdmissionId,
        encounterType: expectedEncounterType,
        status: 'in_progress',
      },
      occurredAtUtc: startedAtUtc,
    },
  });
}

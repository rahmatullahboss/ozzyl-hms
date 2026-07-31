export type EncounterProviderMode = 'legacy' | 'shadow' | 'canonical';
export type EncounterProviderSourceType = 'legacy_encounter' | 'legacy_visit' | 'legacy_consultation';

export interface EncounterProviderPreparedStatement {
  bind(...values: unknown[]): EncounterProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface EncounterProviderDatabase {
  prepare(sql: string): EncounterProviderPreparedStatement;
}

export interface EncounterProviderInput {
  tenantId: string;
  sourceType: EncounterProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface EncounterParticipantProjection {
  practitionerPublicId: string;
  role: string;
}

export interface EncounterProviderParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  practitioner: boolean;
  type: boolean;
  status: boolean;
  interval: boolean;
  participants: boolean;
  careLocation: boolean;
}

export interface EncounterProviderProjection {
  mode: EncounterProviderMode;
  encounterPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterType: string;
  currentStatus: string;
  status: string;
  encounterVersion: number;
  version: number;
  startedAtUtc: string;
  endedAtUtc: string | null;
  participantPublicIds: string[];
  participants: EncounterParticipantProjection[];
  careLocationPublicId: string | null;
  signed: boolean;
  addendumCount: number;
  legacy: { sourceType: EncounterProviderSourceType; legacyId: number };
  parity?: EncounterProviderParity;
}

interface FlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string }
interface LegacyEncounterRow {
  patient_id: number;
  encounter_type: string | null;
  status: string | null;
  start_value: string | null;
  end_value: string | null;
  practitioner_id: number | null;
  signed_state: string | null;
  addendum_count: number | null;
}
interface CanonicalEncounterRow {
  encounter_public_id: string;
  patient_link_public_id: string | null;
  encounter_type: string;
  status: string;
  encounter_version: number;
  started_at_utc: string;
  ended_at_utc: string | null;
  care_location_public_id: string | null;
  signed_at_utc: string | null;
}
interface ParticipantRow { practitioner_public_id: string; participant_role: string }
interface CountRow { count: number }

const FLAG_KEY = 'canonical_encounter_provider_v1';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function sourceType(value: string): EncounterProviderSourceType {
  if (!['legacy_encounter', 'legacy_visit', 'legacy_consultation'].includes(value)) {
    throw new RangeError('sourceType is invalid');
  }
  return value as EncounterProviderSourceType;
}

function normalizeUtc(value: string | null, label: string): string | null {
  if (value == null) return null;
  const raw = value.trim();
  if (!raw) throw new RangeError(`${label} is invalid`);
  const localIso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00+06:00`
    : raw.includes('T')
      ? raw
      : raw.replace(' ', 'T');
  const exactIso = /(?:Z|[+-]\d{2}:\d{2})$/i.test(localIso)
    ? localIso
    : `${localIso}+06:00`;
  const parsed = new Date(exactIso);
  if (!Number.isFinite(parsed.getTime())) throw new RangeError(`${label} is invalid`);
  return parsed.toISOString();
}

function normalizeEncounterType(value: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['outpatient', 'opd', 'visit'].includes(normalized)) return 'outpatient';
  if (['inpatient', 'ipd', 'admission'].includes(normalized)) return 'inpatient';
  if (['teleconsultation', 'telemedicine', 'consultation'].includes(normalized)) return 'teleconsultation';
  if (normalized === 'emergency') return 'emergency';
  return 'other';
}

function normalizeEncounterStatus(value: string | null): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['in_progress', 'active', 'ongoing', 'admitted', 'checked_in', 'engaged', 'initiated'].includes(normalized)) return 'in_progress';
  if (['on_hold', 'held'].includes(normalized)) return 'on_hold';
  if (['completed', 'closed', 'concluded', 'discharged'].includes(normalized)) return 'completed';
  if (['cancelled', 'canceled', 'no_show'].includes(normalized)) return 'cancelled';
  if (normalized === 'entered_in_error') return 'entered_in_error';
  if (normalized === 'planned') return 'planned';
  return 'unknown';
}

async function readMapping(
  db: EncounterProviderDatabase,
  tenantId: string,
  entityType: string,
  mappedSourceType: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, entityType, mappedSourceType, sourcePublicId).first<MappingRow>();
}

function mapped(row: MappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id
    ? String(row.canonical_public_id)
    : null;
}

export async function resolveEncounterProviderMode(
  db: EncounterProviderDatabase,
  tenantId: string,
): Promise<EncounterProviderMode> {
  const tenant = exact(tenantId, 'tenantId');
  try {
    const row = await db.prepare(`
      SELECT mode,is_enabled FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=? LIMIT 1
    `).bind(tenant, FLAG_KEY).first<FlagRow>();
    if (!row || Number(row.is_enabled) !== 1) return 'legacy';
    if (row.mode === 'shadow') return 'shadow';
    if (row.mode === 'canonical') return 'canonical';
    return 'legacy';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*canonical_feature_flags/i.test(message)) return 'legacy';
    throw error;
  }
}

async function readLegacyEncounterTable(
  db: EncounterProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyEncounterRow | null> {
  try {
    return await db.prepare(`
      SELECT patient_id,encounter_type,status,
             start_time AS start_value,end_time AS end_value,
             provider_id AS practitioner_id,signed_at AS signed_state,
             addendum_count
      FROM encounters WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(tenantId, legacyId).first<LegacyEncounterRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such column:/i.test(message)) throw error;
  }
  try {
    return await db.prepare(`
      SELECT patient_id,encounter_type,status,
             start_time AS start_value,end_time AS end_value,
             provider_id AS practitioner_id,signed_snapshot AS signed_state,
             0 AS addendum_count
      FROM encounters WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(tenantId, legacyId).first<LegacyEncounterRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such column:/i.test(message)) throw error;
  }
  return db.prepare(`
    SELECT patient_id,encounter_type,status,
           started_at_utc AS start_value,ended_at_utc AS end_value,
           doctor_id AS practitioner_id,NULL AS signed_state,0 AS addendum_count
    FROM encounters WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(tenantId, legacyId).first<LegacyEncounterRow>();
}

async function readLegacyEncounter(
  db: EncounterProviderDatabase,
  tenantId: string,
  resolvedSourceType: EncounterProviderSourceType,
  legacyId: number,
): Promise<{
  legacyPatientId: number;
  legacyPractitionerId: number | null;
  encounterType: string;
  currentStatus: string;
  startedAtUtc: string;
  endedAtUtc: string | null;
  signed: boolean;
  addendumCount: number;
}> {
  let row: LegacyEncounterRow | null;
  if (resolvedSourceType === 'legacy_encounter') {
    row = await readLegacyEncounterTable(db, tenantId, legacyId);
  } else if (resolvedSourceType === 'legacy_visit') {
    row = await db.prepare(`
      SELECT patient_id,visit_type AS encounter_type,status,
             COALESCE(visit_date,created_at) AS start_value,NULL AS end_value,
             doctor_id AS practitioner_id,NULL AS signed_state,0 AS addendum_count
      FROM visits WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(tenantId, legacyId).first<LegacyEncounterRow>();
  } else {
    row = await db.prepare(`
      SELECT patient_id,'teleconsultation' AS encounter_type,status,
             scheduled_at AS start_value,NULL AS end_value,
             doctor_id AS practitioner_id,NULL AS signed_state,0 AS addendum_count
      FROM consultations WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(tenantId, legacyId).first<LegacyEncounterRow>();
  }
  if (!row) throw new Error('legacy encounter source not found');
  const startedAtUtc = normalizeUtc(row.start_value, 'encounter start time');
  if (startedAtUtc == null) throw new Error('legacy encounter start time is required');
  return {
    legacyPatientId: Number(row.patient_id),
    legacyPractitionerId: row.practitioner_id == null ? null : Number(row.practitioner_id),
    encounterType: normalizeEncounterType(row.encounter_type),
    currentStatus: normalizeEncounterStatus(row.status),
    startedAtUtc,
    endedAtUtc: normalizeUtc(row.end_value, 'encounter end time'),
    signed: row.signed_state != null,
    addendumCount: Number(row.addendum_count ?? 0),
  };
}

async function readUniquePatientLink(
  db: EncounterProviderDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<string | null> {
  const rows = (await db.prepare(`
    SELECT patient_link_public_id
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
      AND link_status NOT IN ('rejected','retired') AND effective_to_utc IS NULL
    ORDER BY version DESC,patient_link_public_id
  `).bind(tenantId, legacyPatientId).all<PatientLinkRow>()).results;
  return rows.length === 1 ? String(rows[0].patient_link_public_id) : null;
}

async function readCanonicalEncounter(
  db: EncounterProviderDatabase,
  tenantId: string,
  encounterPublicId: string,
): Promise<{
  encounterPublicId: string;
  patientLinkPublicId: string | null;
  encounterType: string;
  currentStatus: string;
  encounterVersion: number;
  startedAtUtc: string;
  endedAtUtc: string | null;
  participants: EncounterParticipantProjection[];
  careLocationPublicId: string | null;
  signed: boolean;
  addendumCount: number;
}> {
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,encounter_type,status,encounter_version,
           started_at_utc,ended_at_utc,care_location_public_id,signed_at_utc
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, encounterPublicId).first<CanonicalEncounterRow>();
  if (!row) throw new Error('mapped canonical encounter not found');
  const participants = (await db.prepare(`
    SELECT practitioner_public_id,participant_role
    FROM canonical_encounter_participants
    WHERE tenant_id=? AND encounter_public_id=? AND active_to_utc IS NULL
    ORDER BY participant_role,practitioner_public_id
  `).bind(tenantId, encounterPublicId).all<ParticipantRow>()).results.map((entry) => ({
    practitionerPublicId: String(entry.practitioner_public_id),
    role: String(entry.participant_role),
  }));
  const addenda = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_encounter_addenda
    WHERE tenant_id=? AND encounter_public_id=?
  `).bind(tenantId, encounterPublicId).first<CountRow>();
  return {
    encounterPublicId: String(row.encounter_public_id),
    patientLinkPublicId: row.patient_link_public_id == null ? null : String(row.patient_link_public_id),
    encounterType: String(row.encounter_type),
    currentStatus: String(row.status),
    encounterVersion: Number(row.encounter_version),
    startedAtUtc: String(row.started_at_utc),
    endedAtUtc: row.ended_at_utc == null ? null : String(row.ended_at_utc),
    participants,
    careLocationPublicId: row.care_location_public_id == null ? null : String(row.care_location_public_id),
    signed: row.signed_at_utc != null,
    addendumCount: Number(addenda?.count ?? 0),
  };
}

async function careLocationExists(
  db: EncounterProviderDatabase,
  tenantId: string,
  careLocationPublicId: string | null,
): Promise<boolean> {
  if (careLocationPublicId == null) return false;
  const row = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_care_locations
    WHERE tenant_id=? AND location_public_id=?
  `).bind(tenantId, careLocationPublicId).first<CountRow>();
  return Number(row?.count ?? 0) === 1;
}

function projection(
  mode: EncounterProviderMode,
  input: {
    encounterPublicId: string | null;
    patientLinkPublicId: string | null;
    encounterType: string;
    currentStatus: string;
    encounterVersion: number;
    startedAtUtc: string;
    endedAtUtc: string | null;
    participants: EncounterParticipantProjection[];
    careLocationPublicId: string | null;
    signed: boolean;
    addendumCount: number;
    sourceType: EncounterProviderSourceType;
    legacyId: number;
    parity?: EncounterProviderParity;
  },
): EncounterProviderProjection {
  return {
    mode,
    encounterPublicId: input.encounterPublicId,
    patientLinkPublicId: input.patientLinkPublicId,
    encounterType: input.encounterType,
    currentStatus: input.currentStatus,
    status: input.currentStatus,
    encounterVersion: input.encounterVersion,
    version: input.encounterVersion,
    startedAtUtc: input.startedAtUtc,
    endedAtUtc: input.endedAtUtc,
    participantPublicIds: input.participants.map((entry) => entry.practitionerPublicId),
    participants: input.participants,
    careLocationPublicId: input.careLocationPublicId,
    signed: input.signed,
    addendumCount: input.addendumCount,
    legacy: { sourceType: input.sourceType, legacyId: input.legacyId },
    ...(input.parity == null ? {} : { parity: input.parity }),
  };
}

export async function resolveEncounterProjection(
  db: EncounterProviderDatabase,
  input: EncounterProviderInput,
): Promise<EncounterProviderProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const resolvedSourceType = sourceType(input.sourceType);
  const legacyId = positive(input.legacyId, 'legacyId');
  const mode = await resolveEncounterProviderMode(db, tenantId);
  const legacy = await readLegacyEncounter(db, tenantId, resolvedSourceType, legacyId);
  const encounterMapping = await readMapping(db, tenantId, 'encounter', resolvedSourceType, String(legacyId));
  const encounterPublicId = mapped(encounterMapping);
  const patientLinkPublicId = await readUniquePatientLink(db, tenantId, legacy.legacyPatientId);
  const practitionerMapping = legacy.legacyPractitionerId == null
    ? null
    : await readMapping(db, tenantId, 'practitioner', 'legacy_doctor', String(legacy.legacyPractitionerId));
  const practitionerPublicId = mapped(practitionerMapping);
  const identityComplete = encounterPublicId != null
    && patientLinkPublicId != null
    && (legacy.legacyPractitionerId == null || practitionerPublicId != null);

  if (input.identitySensitive && encounterPublicId == null) {
    throw new Error('explicit encounter source mapping is required for identity-sensitive resolution');
  }
  if (input.identitySensitive && !identityComplete) {
    throw new Error('explicit patient link and practitioner mapping are required for identity-sensitive resolution');
  }
  const legacyParticipants = practitionerPublicId == null
    ? []
    : [{ practitionerPublicId, role: 'treating' }];
  if (encounterPublicId == null) {
    if (mode === 'canonical') throw new Error('explicit encounter source mapping is required for canonical mode');
    return projection(mode, {
      encounterPublicId: null,
      patientLinkPublicId,
      encounterType: legacy.encounterType,
      currentStatus: legacy.currentStatus,
      encounterVersion: 0,
      startedAtUtc: legacy.startedAtUtc,
      endedAtUtc: legacy.endedAtUtc,
      participants: legacyParticipants,
      careLocationPublicId: null,
      signed: legacy.signed,
      addendumCount: legacy.addendumCount,
      sourceType: resolvedSourceType,
      legacyId,
    });
  }

  const canonical = await readCanonicalEncounter(db, tenantId, encounterPublicId);
  const practitioner = legacy.legacyPractitionerId == null
    ? canonical.participants.length === 0
    : practitionerPublicId != null && canonical.participants.some(
      (entry) => entry.practitionerPublicId === practitionerPublicId,
    );
  const participants = legacyParticipants.length === canonical.participants.length
    && legacyParticipants.every((legacyParticipant) => canonical.participants.some(
      (canonicalParticipant) => canonicalParticipant.practitionerPublicId === legacyParticipant.practitionerPublicId
        && canonicalParticipant.role === legacyParticipant.role,
    ));
  const careLocation = canonical.careLocationPublicId == null
    || await careLocationExists(db, tenantId, canonical.careLocationPublicId);
  const signedHistory = legacy.signed === canonical.signed && legacy.addendumCount === canonical.addendumCount;
  const parityChecks = {
    mapping: mapped(encounterMapping) === canonical.encounterPublicId,
    patientLink: patientLinkPublicId != null && patientLinkPublicId === canonical.patientLinkPublicId,
    practitioner,
    type: legacy.encounterType === canonical.encounterType,
    status: legacy.currentStatus === canonical.currentStatus,
    interval: legacy.startedAtUtc === canonical.startedAtUtc && legacy.endedAtUtc === canonical.endedAtUtc,
    participants,
    careLocation,
  };
  const parity: EncounterProviderParity = {
    ok: Object.values(parityChecks).every(Boolean) && signedHistory,
    ...parityChecks,
  };

  if (mode === 'canonical') {
    if (patientLinkPublicId == null || canonical.patientLinkPublicId == null) {
      throw new Error('canonical encounter patient evidence is missing');
    }
    if (!identityComplete) throw new Error('canonical mode requires exact patient and practitioner mappings');
    if (!parity.ok) throw new Error('canonical encounter parity mismatch');
    return projection(mode, {
      ...canonical,
      sourceType: resolvedSourceType,
      legacyId,
    });
  }

  return projection(mode, {
    encounterPublicId,
    patientLinkPublicId,
    encounterType: legacy.encounterType,
    currentStatus: legacy.currentStatus,
    encounterVersion: canonical.encounterVersion,
    startedAtUtc: legacy.startedAtUtc,
    endedAtUtc: legacy.endedAtUtc,
    participants: legacyParticipants,
    careLocationPublicId: canonical.careLocationPublicId,
    signed: legacy.signed,
    addendumCount: legacy.addendumCount,
    sourceType: resolvedSourceType,
    legacyId,
    ...(mode === 'shadow' ? { parity } : {}),
  });
}

export const resolveEncounterDetail = resolveEncounterProjection;

export async function resolvePatientTimelineEncounter(
  db: EncounterProviderDatabase,
  input: EncounterProviderInput,
): Promise<EncounterProviderProjection> {
  return resolveEncounterProjection(db, { ...input, identitySensitive: true });
}

export async function resolveEncounterMutationValidation(
  db: EncounterProviderDatabase,
  input: EncounterProviderInput,
): Promise<{
  encounterPublicId: string;
  patientLinkPublicId: string;
  currentStatus: string;
  encounterVersion: number;
}> {
  const result = await resolveEncounterProjection(db, { ...input, identitySensitive: true });
  if (!result.encounterPublicId || !result.patientLinkPublicId) {
    throw new Error('encounter mutation requires explicit encounter and patient identity');
  }
  return {
    encounterPublicId: result.encounterPublicId,
    patientLinkPublicId: result.patientLinkPublicId,
    currentStatus: result.currentStatus,
    encounterVersion: result.encounterVersion,
  };
}

export async function resolvePaidVisitEpisodeEvidence(
  db: EncounterProviderDatabase,
  input: EncounterProviderInput,
): Promise<{
  encounterPublicId: string;
  patientLinkPublicId: string;
  encounterType: string;
  currentStatus: string;
}> {
  const result = await resolveEncounterProjection(db, { ...input, identitySensitive: true });
  if (!result.encounterPublicId || !result.patientLinkPublicId) {
    throw new Error('paid visit episode evidence requires explicit encounter and patient identity');
  }
  return {
    encounterPublicId: result.encounterPublicId,
    patientLinkPublicId: result.patientLinkPublicId,
    encounterType: result.encounterType,
    currentStatus: result.currentStatus,
  };
}

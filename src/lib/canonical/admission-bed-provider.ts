export type AdmissionBedProviderMode = 'legacy' | 'shadow' | 'canonical';

export interface AdmissionBedProviderPreparedStatement {
  bind(...values: unknown[]): AdmissionBedProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface AdmissionBedProviderDatabase {
  prepare(sql: string): AdmissionBedProviderPreparedStatement;
}

export interface AdmissionBedProviderInput {
  tenantId: string;
  legacyAdmissionId?: number;
  sourceType?: 'legacy_admission';
  legacyId?: number;
  identitySensitive?: boolean;
}

export interface ActiveAdmissionProviderProjection {
  mode: AdmissionBedProviderMode;
  legacyAdmissionId: number | null;
  admissionPublicId: string | null;
  admissionNumber: string;
  currentStatus: string;
}

export interface AdmissionBedProviderParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  identity: boolean;
  lifecycle: boolean;
  latestEvent: boolean;
  openStayCardinality: boolean;
  bedMapping: boolean;
  derivedOccupancy: boolean;
  bedOperationalState: boolean;
}

export interface AdmissionBedProviderProjection {
  mode: AdmissionBedProviderMode;
  admissionPublicId: string | null;
  encounterPublicId: string | null;
  patientLinkPublicId: string | null;
  admissionNumber: string;
  admissionType: string;
  admissionSource: string;
  currentStatus: string;
  status: string;
  statusVersion: number;
  version: number;
  admittedAtUtc: string;
  dischargedAtUtc: string | null;
  latestEventStatus: string | null;
  currentBedStayPublicId: string | null;
  currentBedPublicId: string | null;
  currentLocationPublicId: string | null;
  bedLocationPublicId: string | null;
  bedOperationalStatus: string | null;
  bedStayStartedAtUtc: string | null;
  bedStayVersion: number | null;
  legacy: {
    legacyAdmissionId: number;
    legacyPatientId: number;
    legacyBedId: number | null;
    legacyPatientBedInfoId: number | null;
  };
  parity?: AdmissionBedProviderParity;
}

interface FlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string }
interface LegacyAdmissionRow {
  admission_no: string;
  patient_id: number;
  bed_id: number | null;
  admission_type: string;
  admission_source: string | null;
  admission_date: string;
  discharge_date: string | null;
  status: string;
}
interface LegacyStayRow {
  id: number;
  bed_id: number;
  started_on: string;
  ended_on: string | null;
}
interface LegacyBedRow { status: string }
interface CanonicalAdmissionRow {
  admission_public_id: string;
  encounter_public_id: string;
  patient_link_public_id: string;
  admission_number: string;
  admission_type: string;
  admission_source: string;
  current_status: string;
  status_version: number;
  admitted_at_utc: string;
  discharged_at_utc: string | null;
}
interface CanonicalEventRow { to_status: string; sequence: number }
interface CanonicalStayRow {
  bed_stay_public_id: string;
  encounter_public_id: string;
  admission_public_id: string | null;
  bed_public_id: string | null;
  patient_link_public_id: string | null;
  started_at_utc: string;
  ended_at_utc: string | null;
  status: string;
  stay_version: number;
}
interface CanonicalBedRow { location_public_id: string; operational_status: string }
interface CountRow { count: number }

interface LegacyFacts {
  legacyAdmissionId: number;
  legacyPatientId: number;
  legacyBedId: number | null;
  legacyPatientBedInfoId: number | null;
  admissionNumber: string;
  admissionType: string;
  admissionSource: string;
  currentStatus: string;
  admittedAtUtc: string;
  dischargedAtUtc: string | null;
  bedStayStartedAtUtc: string | null;
  bedStayEndedAtUtc: string | null;
  bedStayStatus: string | null;
  legacyBedStatus: string | null;
}

interface CanonicalFacts {
  admissionPublicId: string;
  encounterPublicId: string;
  patientLinkPublicId: string;
  admissionNumber: string;
  admissionType: string;
  admissionSource: string;
  currentStatus: string;
  statusVersion: number;
  admittedAtUtc: string;
  dischargedAtUtc: string | null;
  latestEventStatus: string | null;
  latestEventSequence: number | null;
  openStayCount: number;
  currentBedStayPublicId: string | null;
  currentBedPublicId: string | null;
  currentLocationPublicId: string | null;
  bedOperationalStatus: string | null;
  bedStayStartedAtUtc: string | null;
  bedStayEndedAtUtc: string | null;
  bedStayStatus: string | null;
  bedStayVersion: number | null;
  stayEncounterPublicId: string | null;
  stayAdmissionPublicId: string | null;
  stayPatientLinkPublicId: string | null;
}

const FLAG_KEY = 'canonical_admission_bed_provider_v1';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positive(value: number | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function normalizeUtc(value: string | null, label: string): string | null {
  if (value == null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new RangeError(`${label} is invalid`);
  return parsed.toISOString();
}

function normalizeAdmissionType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (['planned', 'ipd', 'inpatient'].includes(normalized)) return 'inpatient';
  if (normalized === 'emergency') return 'emergency';
  if (normalized === 'transfer') return 'transfer';
  if (normalized === 'direct') return 'direct';
  if (['conversion', 'encounter_conversion'].includes(normalized)) return 'conversion';
  return 'other';
}

function normalizeAdmissionSource(value: string | null, fallback: string): string {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (['planned', 'emergency', 'transfer', 'direct', 'import', 'manual'].includes(normalized)) return normalized;
  if (['conversion', 'encounter_conversion'].includes(normalized)) return 'encounter_conversion';
  return 'other';
}

function normalizeAdmissionStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (['planned', 'admitted', 'transfer_pending', 'discharge_pending', 'discharged', 'cancelled', 'entered_in_error'].includes(normalized)) {
    return normalized;
  }
  if (['active', 'occupied', 'inpatient'].includes(normalized)) return 'admitted';
  if (['closed', 'complete', 'completed'].includes(normalized)) return 'discharged';
  if (normalized === 'canceled') return 'cancelled';
  return 'entered_in_error';
}

function normalizeBedStatus(value: string | null): string | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (['occupied', 'available', 'active'].includes(normalized)) return 'active';
  if (['maintenance', 'inactive', 'retired'].includes(normalized)) return normalized;
  return 'inactive';
}

export async function resolveAdmissionBedProviderMode(
  db: AdmissionBedProviderDatabase,
  tenantId: string,
): Promise<AdmissionBedProviderMode> {
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

function uniqueLegacyPatientIds(values: readonly number[]): number[] {
  return [...new Set(values.map(Number))].filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
}

function mappedLegacyAdmissionId(value: unknown): number | null {
  if (value == null) return null;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

export async function resolveActiveAdmissionsForLegacyPatients(
  db: AdmissionBedProviderDatabase,
  tenantIdRaw: string,
  legacyPatientIdsRaw: readonly number[],
): Promise<Map<number, ActiveAdmissionProviderProjection>> {
  const tenantId = exact(tenantIdRaw, 'tenantId');
  const legacyPatientIds = uniqueLegacyPatientIds(legacyPatientIdsRaw);
  const activeAdmissions = new Map<number, ActiveAdmissionProviderProjection>();
  if (legacyPatientIds.length === 0) return activeAdmissions;

  const mode = await resolveAdmissionBedProviderMode(db, tenantId);
  const placeholders = legacyPatientIds.map(() => '?').join(',');

  if (mode === 'canonical') {
    const rows = (await db.prepare(`
      SELECT links.legacy_patient_id,
             admissions.admission_public_id,
             admissions.admission_number,
             admissions.current_status,
             mappings.source_public_id AS legacy_admission_id
      FROM canonical_tenant_patient_links links
      JOIN canonical_admissions admissions
        ON admissions.tenant_id = links.tenant_id
       AND admissions.patient_link_public_id = links.patient_link_public_id
      LEFT JOIN canonical_source_mappings mappings
        ON mappings.tenant_id = admissions.tenant_id
       AND mappings.entity_type = 'admission'
       AND mappings.canonical_public_id = admissions.admission_public_id
       AND mappings.source_type = 'legacy_admission'
       AND mappings.mapping_status = 'mapped'
      WHERE links.tenant_id = ?
        AND links.legacy_patient_id IN (${placeholders})
        AND links.effective_to_utc IS NULL
        AND links.link_status NOT IN ('rejected','retired')
        AND admissions.current_status IN ('admitted','transfer_pending','discharge_pending')
      ORDER BY links.legacy_patient_id,
               admissions.admitted_at_utc DESC,
               admissions.admission_public_id DESC
    `).bind(tenantId, ...legacyPatientIds).all<{
      legacy_patient_id: number;
      admission_public_id: string;
      admission_number: string;
      current_status: string;
      legacy_admission_id: string | null;
    }>()).results;

    for (const row of rows) {
      const legacyPatientId = Number(row.legacy_patient_id);
      if (activeAdmissions.has(legacyPatientId)) continue;
      activeAdmissions.set(legacyPatientId, {
        mode,
        legacyAdmissionId: mappedLegacyAdmissionId(row.legacy_admission_id),
        admissionPublicId: String(row.admission_public_id),
        admissionNumber: String(row.admission_number),
        currentStatus: String(row.current_status),
      });
    }
    return activeAdmissions;
  }

  const rows = (await db.prepare(`
    SELECT admissions.id,
           admissions.patient_id,
           admissions.admission_no,
           admissions.status,
           mappings.canonical_public_id AS admission_public_id
    FROM admissions
    LEFT JOIN canonical_source_mappings mappings
      ON mappings.tenant_id = admissions.tenant_id
     AND mappings.entity_type = 'admission'
     AND mappings.source_type = 'legacy_admission'
     AND mappings.source_public_id = CAST(admissions.id AS TEXT)
     AND mappings.mapping_status = 'mapped'
    WHERE admissions.tenant_id = ?
      AND admissions.patient_id IN (${placeholders})
      AND admissions.status IN ('admitted','critical','transferred')
    ORDER BY admissions.patient_id,
             admissions.admission_date DESC,
             admissions.id DESC
  `).bind(tenantId, ...legacyPatientIds).all<{
    id: number;
    patient_id: number;
    admission_no: string;
    status: string;
    admission_public_id: string | null;
  }>()).results;

  for (const row of rows) {
    const legacyPatientId = Number(row.patient_id);
    if (activeAdmissions.has(legacyPatientId)) continue;
    activeAdmissions.set(legacyPatientId, {
      mode,
      legacyAdmissionId: Number(row.id),
      admissionPublicId: row.admission_public_id == null
        ? null
        : String(row.admission_public_id),
      admissionNumber: String(row.admission_no),
      currentStatus: normalizeAdmissionStatus(String(row.status)),
    });
  }
  return activeAdmissions;
}

async function readMapping(
  db: AdmissionBedProviderDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
}

function mapped(row: MappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id
    ? String(row.canonical_public_id)
    : null;
}

async function readPatientLink(
  db: AdmissionBedProviderDatabase,
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

async function readLegacyAdmission(
  db: AdmissionBedProviderDatabase,
  tenantId: string,
  legacyAdmissionId: number,
): Promise<LegacyAdmissionRow | null> {
  for (const sql of [
    `SELECT admission_no,patient_id,bed_id,admission_type,admission_source,
            admitted_at_utc AS admission_date,discharged_at_utc AS discharge_date,status
     FROM admissions WHERE tenant_id=? AND id=? LIMIT 1`,
    `SELECT admission_no,patient_id,bed_id,admission_type,
            admit_source AS admission_source,admission_date,discharge_date,status
     FROM admissions WHERE tenant_id=? AND id=? LIMIT 1`,
    `SELECT admission_no,patient_id,bed_id,admission_type,
            admission_type AS admission_source,admission_date,discharge_date,status
     FROM admissions WHERE tenant_id=? AND id=? LIMIT 1`,
  ]) {
    try {
      const row = await db.prepare(sql).bind(tenantId, legacyAdmissionId).first<LegacyAdmissionRow>();
      if (row?.admission_date != null) return row;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such column:/i.test(message)) throw error;
    }
  }
  return null;
}

async function readLegacyStay(
  db: AdmissionBedProviderDatabase,
  tenantId: string,
  legacyAdmissionId: number,
): Promise<LegacyStayRow | null> {
  for (const sql of [
    `SELECT id,bed_id,started_at_utc AS started_on,ended_at_utc AS ended_on
     FROM patient_bed_infos
     WHERE tenant_id=? AND admission_id=?
     ORDER BY CASE WHEN ended_at_utc IS NULL THEN 0 ELSE 1 END,started_at_utc DESC,id DESC
     LIMIT 1`,
    `SELECT id,bed_id,started_on,ended_on
     FROM patient_bed_infos
     WHERE tenant_id=? AND admission_id=?
     ORDER BY CASE WHEN ended_on IS NULL THEN 0 ELSE 1 END,started_on DESC,id DESC
     LIMIT 1`,
  ]) {
    try {
      const row = await db.prepare(sql).bind(tenantId, legacyAdmissionId).first<LegacyStayRow>();
      if (row?.started_on != null) return row;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such column:/i.test(message)) throw error;
    }
  }
  return null;
}

async function readLegacyFacts(
  db: AdmissionBedProviderDatabase,
  tenantId: string,
  legacyAdmissionId: number,
): Promise<LegacyFacts> {
  const admission = await readLegacyAdmission(db, tenantId, legacyAdmissionId);
  if (!admission) throw new Error('legacy admission source not found');
  const stay = await readLegacyStay(db, tenantId, legacyAdmissionId);
  const legacyBedId = stay == null
    ? (admission.bed_id == null ? null : Number(admission.bed_id))
    : Number(stay.bed_id);
  const bed = legacyBedId == null ? null : await db.prepare(`
    SELECT status FROM beds WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(tenantId, legacyBedId).first<LegacyBedRow>();
  const admittedAtUtc = normalizeUtc(admission.admission_date, 'legacy admission time');
  if (admittedAtUtc == null) throw new Error('legacy admission time is required');
  return {
    legacyAdmissionId,
    legacyPatientId: Number(admission.patient_id),
    legacyBedId,
    legacyPatientBedInfoId: stay == null ? null : Number(stay.id),
    admissionNumber: String(admission.admission_no),
    admissionType: normalizeAdmissionType(String(admission.admission_type)),
    admissionSource: normalizeAdmissionSource(admission.admission_source, admission.admission_type),
    currentStatus: normalizeAdmissionStatus(String(admission.status)),
    admittedAtUtc,
    dischargedAtUtc: normalizeUtc(admission.discharge_date, 'legacy discharge time'),
    bedStayStartedAtUtc: normalizeUtc(stay?.started_on ?? null, 'legacy bed stay start'),
    bedStayEndedAtUtc: normalizeUtc(stay?.ended_on ?? null, 'legacy bed stay end'),
    bedStayStatus: stay == null ? null : (stay.ended_on == null ? 'active' : 'completed'),
    legacyBedStatus: bed == null ? null : String(bed.status),
  };
}

async function readCanonicalFacts(
  db: AdmissionBedProviderDatabase,
  tenantId: string,
  admissionPublicId: string,
): Promise<CanonicalFacts> {
  const admission = await db.prepare(`
    SELECT admission_public_id,encounter_public_id,patient_link_public_id,
           admission_number,admission_type,admission_source,current_status,status_version,
           admitted_at_utc,discharged_at_utc
    FROM canonical_admissions
    WHERE tenant_id=? AND admission_public_id=? LIMIT 1
  `).bind(tenantId, admissionPublicId).first<CanonicalAdmissionRow>();
  if (!admission) throw new Error('mapped canonical admission not found');
  const latestEvent = await db.prepare(`
    SELECT to_status,sequence FROM canonical_admission_status_events
    WHERE tenant_id=? AND admission_public_id=?
    ORDER BY sequence DESC,event_public_id DESC LIMIT 1
  `).bind(tenantId, admissionPublicId).first<CanonicalEventRow>();
  const openStayCount = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_bed_stays
    WHERE tenant_id=? AND admission_public_id=? AND status='active' AND ended_at_utc IS NULL
  `).bind(tenantId, admissionPublicId).first<CountRow>();
  const stay = await db.prepare(`
    SELECT bed_stay_public_id,encounter_public_id,admission_public_id,bed_public_id,
           patient_link_public_id,started_at_utc,ended_at_utc,status,stay_version
    FROM canonical_bed_stays
    WHERE tenant_id=? AND admission_public_id=?
    ORDER BY CASE WHEN status='active' AND ended_at_utc IS NULL THEN 0 ELSE 1 END,
             started_at_utc DESC,bed_stay_public_id DESC
    LIMIT 1
  `).bind(tenantId, admissionPublicId).first<CanonicalStayRow>();
  const bed = stay?.bed_public_id == null ? null : await db.prepare(`
    SELECT location_public_id,operational_status
    FROM canonical_beds WHERE tenant_id=? AND bed_public_id=? LIMIT 1
  `).bind(tenantId, stay.bed_public_id).first<CanonicalBedRow>();
  return {
    admissionPublicId: String(admission.admission_public_id),
    encounterPublicId: String(admission.encounter_public_id),
    patientLinkPublicId: String(admission.patient_link_public_id),
    admissionNumber: String(admission.admission_number),
    admissionType: String(admission.admission_type),
    admissionSource: String(admission.admission_source),
    currentStatus: String(admission.current_status),
    statusVersion: Number(admission.status_version),
    admittedAtUtc: String(admission.admitted_at_utc),
    dischargedAtUtc: admission.discharged_at_utc == null ? null : String(admission.discharged_at_utc),
    latestEventStatus: latestEvent == null ? null : String(latestEvent.to_status),
    latestEventSequence: latestEvent == null ? null : Number(latestEvent.sequence),
    openStayCount: Number(openStayCount?.count ?? 0),
    currentBedStayPublicId: stay == null ? null : String(stay.bed_stay_public_id),
    currentBedPublicId: stay?.bed_public_id == null ? null : String(stay.bed_public_id),
    currentLocationPublicId: bed == null ? null : String(bed.location_public_id),
    bedOperationalStatus: bed == null ? null : String(bed.operational_status),
    bedStayStartedAtUtc: stay == null ? null : String(stay.started_at_utc),
    bedStayEndedAtUtc: stay?.ended_at_utc == null ? null : String(stay.ended_at_utc),
    bedStayStatus: stay == null ? null : String(stay.status),
    bedStayVersion: stay == null ? null : Number(stay.stay_version),
    stayEncounterPublicId: stay == null ? null : String(stay.encounter_public_id),
    stayAdmissionPublicId: stay?.admission_public_id == null ? null : String(stay.admission_public_id),
    stayPatientLinkPublicId: stay?.patient_link_public_id == null ? null : String(stay.patient_link_public_id),
  };
}

function projection(
  mode: AdmissionBedProviderMode,
  legacy: LegacyFacts,
  input: {
    admissionPublicId: string | null;
    encounterPublicId: string | null;
    patientLinkPublicId: string | null;
    admissionNumber: string;
    admissionType: string;
    admissionSource: string;
    currentStatus: string;
    statusVersion: number;
    admittedAtUtc: string;
    dischargedAtUtc: string | null;
    latestEventStatus: string | null;
    currentBedStayPublicId: string | null;
    currentBedPublicId: string | null;
    currentLocationPublicId: string | null;
    bedOperationalStatus: string | null;
    bedStayStartedAtUtc: string | null;
    bedStayVersion: number | null;
    parity?: AdmissionBedProviderParity;
  },
): AdmissionBedProviderProjection {
  return {
    mode,
    admissionPublicId: input.admissionPublicId,
    encounterPublicId: input.encounterPublicId,
    patientLinkPublicId: input.patientLinkPublicId,
    admissionNumber: input.admissionNumber,
    admissionType: input.admissionType,
    admissionSource: input.admissionSource,
    currentStatus: input.currentStatus,
    status: input.currentStatus,
    statusVersion: input.statusVersion,
    version: input.statusVersion,
    admittedAtUtc: input.admittedAtUtc,
    dischargedAtUtc: input.dischargedAtUtc,
    latestEventStatus: input.latestEventStatus,
    currentBedStayPublicId: input.currentBedStayPublicId,
    currentBedPublicId: input.currentBedPublicId,
    currentLocationPublicId: input.currentLocationPublicId,
    bedLocationPublicId: input.currentLocationPublicId,
    bedOperationalStatus: input.bedOperationalStatus,
    bedStayStartedAtUtc: input.bedStayStartedAtUtc,
    bedStayVersion: input.bedStayVersion,
    legacy: {
      legacyAdmissionId: legacy.legacyAdmissionId,
      legacyPatientId: legacy.legacyPatientId,
      legacyBedId: legacy.legacyBedId,
      legacyPatientBedInfoId: legacy.legacyPatientBedInfoId,
    },
    ...(input.parity == null ? {} : { parity: input.parity }),
  };
}

export async function resolveAdmissionBedProjection(
  db: AdmissionBedProviderDatabase,
  input: AdmissionBedProviderInput,
): Promise<AdmissionBedProviderProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  if (input.sourceType != null && input.sourceType !== 'legacy_admission') {
    throw new RangeError('sourceType must be legacy_admission');
  }
  const legacyAdmissionId = positive(input.legacyAdmissionId ?? input.legacyId, 'legacyAdmissionId');
  const mode = await resolveAdmissionBedProviderMode(db, tenantId);
  const legacy = await readLegacyFacts(db, tenantId, legacyAdmissionId);
  const admissionMapping = await readMapping(db, tenantId, 'admission', 'legacy_admission', String(legacyAdmissionId));
  const admissionPublicId = mapped(admissionMapping);
  const patientLinkPublicId = await readPatientLink(db, tenantId, legacy.legacyPatientId);
  const bedMapping = legacy.legacyBedId == null
    ? null
    : await readMapping(db, tenantId, 'bed', 'legacy_bed', String(legacy.legacyBedId));
  const bedPublicId = mapped(bedMapping);
  const stayMapping = legacy.legacyPatientBedInfoId == null
    ? null
    : await readMapping(db, tenantId, 'bed_stay', 'legacy_patient_bed_info', String(legacy.legacyPatientBedInfoId));
  const stayPublicId = mapped(stayMapping);

  if (input.identitySensitive && admissionPublicId == null) {
    throw new Error('explicit admission mapping is required for identity-sensitive resolution');
  }
  if (input.identitySensitive && patientLinkPublicId == null) {
    throw new Error('explicit patient link is required for identity-sensitive admission resolution');
  }
  if (mode === 'canonical' && admissionPublicId == null) {
    throw new Error('explicit admission mapping is required for canonical mode');
  }
  if (mode === 'canonical' && legacy.legacyBedId != null && bedPublicId == null) {
    throw new Error('explicit bed mapping is required for canonical mode');
  }
  if (mode === 'canonical' && legacy.legacyPatientBedInfoId != null && stayPublicId == null) {
    throw new Error('explicit bed stay mapping is required for canonical mode');
  }

  if (admissionPublicId == null) {
    return projection(mode, legacy, {
      admissionPublicId: null,
      encounterPublicId: null,
      patientLinkPublicId,
      admissionNumber: legacy.admissionNumber,
      admissionType: legacy.admissionType,
      admissionSource: legacy.admissionSource,
      currentStatus: legacy.currentStatus,
      statusVersion: 0,
      admittedAtUtc: legacy.admittedAtUtc,
      dischargedAtUtc: legacy.dischargedAtUtc,
      latestEventStatus: null,
      currentBedStayPublicId: stayPublicId,
      currentBedPublicId: bedPublicId,
      currentLocationPublicId: null,
      bedOperationalStatus: normalizeBedStatus(legacy.legacyBedStatus),
      bedStayStartedAtUtc: legacy.bedStayStartedAtUtc,
      bedStayVersion: null,
    });
  }

  const canonical = await readCanonicalFacts(db, tenantId, admissionPublicId);
  const expectedOpenStays = legacy.bedStayStatus === 'active' ? 1 : 0;
  const mapping = mapped(admissionMapping) === canonical.admissionPublicId;
  const patientLink = patientLinkPublicId != null && patientLinkPublicId === canonical.patientLinkPublicId;
  const identity = patientLink
    && canonical.encounterPublicId.length > 0
    && (canonical.currentBedStayPublicId == null || (
      canonical.stayAdmissionPublicId === canonical.admissionPublicId
      && canonical.stayEncounterPublicId === canonical.encounterPublicId
      && canonical.stayPatientLinkPublicId === canonical.patientLinkPublicId
    ));
  const lifecycle = legacy.admissionNumber === canonical.admissionNumber
    && legacy.admissionType === canonical.admissionType
    && legacy.admissionSource === canonical.admissionSource
    && legacy.currentStatus === canonical.currentStatus
    && legacy.admittedAtUtc === canonical.admittedAtUtc
    && legacy.dischargedAtUtc === canonical.dischargedAtUtc;
  const latestEvent = canonical.latestEventStatus === canonical.currentStatus
    && canonical.latestEventSequence === canonical.statusVersion;
  const openStayCardinality = canonical.openStayCount === expectedOpenStays;
  const bedMappingMatches = legacy.legacyBedId == null
    ? canonical.currentBedPublicId == null
    : bedPublicId != null && bedPublicId === canonical.currentBedPublicId;
  const stayMappingMatches = legacy.legacyPatientBedInfoId == null
    ? canonical.currentBedStayPublicId == null
    : stayPublicId != null && stayPublicId === canonical.currentBedStayPublicId;
  const derivedOccupancy = stayMappingMatches
    && legacy.bedStayStartedAtUtc === canonical.bedStayStartedAtUtc
    && legacy.bedStayEndedAtUtc === canonical.bedStayEndedAtUtc
    && legacy.bedStayStatus === canonical.bedStayStatus;
  const bedOperationalState = normalizeBedStatus(legacy.legacyBedStatus) === canonical.bedOperationalStatus;
  const parityChecks = {
    mapping,
    patientLink,
    identity,
    lifecycle,
    latestEvent,
    openStayCardinality,
    bedMapping: bedMappingMatches,
    derivedOccupancy,
    bedOperationalState,
  };
  const parity: AdmissionBedProviderParity = {
    ok: Object.values(parityChecks).every(Boolean),
    ...parityChecks,
  };

  if (mode === 'canonical') {
    if (patientLinkPublicId == null || !identity) throw new Error('canonical admission patient or episode identity is incomplete');
    if (canonical.openStayCount > 1) throw new Error('canonical admission open stay cardinality is invalid');
    if (!parity.ok) throw new Error('canonical admission or bed parity mismatch');
    return projection(mode, legacy, {
      ...canonical,
    });
  }

  return projection(mode, legacy, {
    admissionPublicId,
    encounterPublicId: canonical.encounterPublicId,
    patientLinkPublicId,
    admissionNumber: legacy.admissionNumber,
    admissionType: legacy.admissionType,
    admissionSource: legacy.admissionSource,
    currentStatus: legacy.currentStatus,
    statusVersion: canonical.statusVersion,
    admittedAtUtc: legacy.admittedAtUtc,
    dischargedAtUtc: legacy.dischargedAtUtc,
    latestEventStatus: canonical.latestEventStatus,
    currentBedStayPublicId: stayPublicId,
    currentBedPublicId: bedPublicId,
    currentLocationPublicId: canonical.currentLocationPublicId,
    bedOperationalStatus: canonical.bedOperationalStatus,
    bedStayStartedAtUtc: legacy.bedStayStartedAtUtc,
    bedStayVersion: canonical.bedStayVersion,
    ...(mode === 'shadow' ? { parity } : {}),
  });
}

export const resolveAdmissionDetail = resolveAdmissionBedProjection;

export async function resolveAdmissionCensusProjection(
  db: AdmissionBedProviderDatabase,
  input: AdmissionBedProviderInput,
): Promise<{
  admissionPublicId: string | null;
  patientLinkPublicId: string | null;
  currentStatus: string;
  currentBedPublicId: string | null;
  currentLocationPublicId: string | null;
  legacyAdmissionId: number;
}> {
  const value = await resolveAdmissionBedProjection(db, { ...input, identitySensitive: true });
  return {
    admissionPublicId: value.admissionPublicId,
    patientLinkPublicId: value.patientLinkPublicId,
    currentStatus: value.currentStatus,
    currentBedPublicId: value.currentBedPublicId,
    currentLocationPublicId: value.currentLocationPublicId,
    legacyAdmissionId: value.legacy.legacyAdmissionId,
  };
}

export async function resolveCurrentBedOccupancy(
  db: AdmissionBedProviderDatabase,
  input: AdmissionBedProviderInput,
): Promise<{
  admissionPublicId: string | null;
  bedStayPublicId: string | null;
  currentBedPublicId: string | null;
  currentLocationPublicId: string | null;
  startedAtUtc: string | null;
  status: string | null;
  legacyAdmissionId: number;
}> {
  const value = await resolveAdmissionBedProjection(db, { ...input, identitySensitive: true });
  return {
    admissionPublicId: value.admissionPublicId,
    bedStayPublicId: value.currentBedStayPublicId,
    currentBedPublicId: value.currentBedPublicId,
    currentLocationPublicId: value.currentLocationPublicId,
    startedAtUtc: value.bedStayStartedAtUtc,
    status: value.currentBedStayPublicId == null ? null : 'active',
    legacyAdmissionId: value.legacy.legacyAdmissionId,
  };
}

export async function resolveAdmissionMutationValidation(
  db: AdmissionBedProviderDatabase,
  input: AdmissionBedProviderInput,
): Promise<{
  admissionPublicId: string;
  encounterPublicId: string;
  patientLinkPublicId: string;
  currentStatus: string;
  statusVersion: number;
  currentBedStayPublicId: string | null;
}> {
  const value = await resolveAdmissionBedProjection(db, { ...input, identitySensitive: true });
  if (!value.admissionPublicId || !value.encounterPublicId || !value.patientLinkPublicId) {
    throw new Error('admission mutation requires exact admission, encounter, and patient identity');
  }
  return {
    admissionPublicId: value.admissionPublicId,
    encounterPublicId: value.encounterPublicId,
    patientLinkPublicId: value.patientLinkPublicId,
    currentStatus: value.currentStatus,
    statusVersion: value.statusVersion,
    currentBedStayPublicId: value.currentBedStayPublicId,
  };
}

export async function resolveAdmissionSlipEnrichment(
  db: AdmissionBedProviderDatabase,
  input: AdmissionBedProviderInput,
): Promise<{
  admissionPublicId: string;
  encounterPublicId: string;
  admissionNumber: string;
  admittedAtUtc: string;
  currentStatus: string;
  currentBedPublicId: string | null;
  currentLocationPublicId: string | null;
  legacyAdmissionId: number;
}> {
  const value = await resolveAdmissionBedProjection(db, { ...input, identitySensitive: true });
  if (!value.admissionPublicId || !value.encounterPublicId) {
    throw new Error('admission slip enrichment requires exact admission and encounter identity');
  }
  return {
    admissionPublicId: value.admissionPublicId,
    encounterPublicId: value.encounterPublicId,
    admissionNumber: value.admissionNumber,
    admittedAtUtc: value.admittedAtUtc,
    currentStatus: value.currentStatus,
    currentBedPublicId: value.currentBedPublicId,
    currentLocationPublicId: value.currentLocationPublicId,
    legacyAdmissionId: value.legacy.legacyAdmissionId,
  };
}

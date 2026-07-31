import { toUtcIso } from './time';

export type MedicationAdministrationProviderMode = 'legacy' | 'shadow' | 'canonical';
export type MedicationAdministrationProviderSourceType =
  | 'legacy_nur_medication_admin'
  | 'legacy_cln_medication_reconciliation';

export interface MedicationAdministrationProviderPreparedStatement {
  bind(...values: unknown[]): MedicationAdministrationProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface MedicationAdministrationProviderDatabase {
  prepare(sql: string): MedicationAdministrationProviderPreparedStatement;
}

export interface MedicationAdministrationProviderInput {
  tenantId: string;
  sourceType: MedicationAdministrationProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface MedicationAdministrationParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  practitioner: boolean;
  status: boolean;
  clinicalShape: boolean;
  effectiveTime: boolean;
  historyVisible: boolean;
}

export interface MedicationAdministrationProjection {
  mode: MedicationAdministrationProviderMode;
  kind: 'administration' | 'reconciliation';
  canonicalPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  practitionerPublicId: string | null;
  status: string;
  statusVersion: number;
  effectiveAtUtc: string;
  outcomeCode: string | null;
  doseValueDecimal: string | null;
  doseUnitCode: string | null;
  routeCode: string | null;
  itemCount: number;
  historyCount: number;
  legacy: {
    sourceType: MedicationAdministrationProviderSourceType;
    legacyId: number;
  };
  parity?: MedicationAdministrationParity;
}

interface ProviderFlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface EncounterRow { encounter_public_id: string; patient_link_public_id: string | null; status: string }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface CanonicalAdministrationRow {
  administration_event_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  administering_practitioner_public_id: string;
  event_kind: string;
  outcome_code: string | null;
  administered_dose_value_decimal: string | null;
  administered_dose_unit_code: string | null;
  route_code: string | null;
  occurred_at_utc: string;
  medication_order_status_version: number;
  depth: number;
}
interface CanonicalReconciliationRow {
  reconciliation_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  creating_practitioner_public_id: string;
  current_status: string;
  status_version: number;
  current_version_public_id: string;
  authored_at_utc: string;
  item_count: number;
  history_count: number;
}
interface LegacyFacts {
  kind: 'administration' | 'reconciliation';
  patientId: number;
  encounterLegacyId: number;
  practitionerLegacyUserId: number | null;
  status: string;
  effectiveAtUtc: string;
  outcomeCode: string | null;
  doseValueDecimal: string | null;
  doseUnitCode: string | null;
  routeCode: string | null;
  itemCount: number;
}

const FLAG_KEY = 'canonical_medication_administration_provider_v1';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function normalizedUtc(value: string | null | undefined, label: string): string {
  if (!value?.trim()) throw new TypeError(`${label} is required`);
  const raw = value.trim();
  if (raw.endsWith('Z')) return toUtcIso(raw);
  const local = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return toUtcIso(`${local}+06:00`);
}

function mappedPublicId(row: MappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? row.canonical_public_id : null;
}

async function readMapping(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
  sourceType: MedicationAdministrationProviderSourceType,
  legacyId: number,
): Promise<string | null> {
  const entityType = sourceType === 'legacy_nur_medication_admin'
    ? 'medication_administration_event'
    : 'medication_reconciliation';
  const row = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, entityType, sourceType, String(legacyId)).first<MappingRow>();
  return mappedPublicId(row);
}

async function resolvePatientLink(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
  patientId: number,
): Promise<string | null> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='patient_link' AND source_type='legacy_patient'
      AND source_public_id=? LIMIT 1
  `).bind(tenantId, String(patientId)).first<MappingRow>();
  let publicId = mappedPublicId(mapping);
  if (!publicId) {
    const direct = await db.prepare(`
      SELECT patient_link_public_id,link_status,effective_to_utc
      FROM canonical_tenant_patient_links
      WHERE tenant_id=? AND legacy_patient_id=? LIMIT 1
    `).bind(tenantId, patientId).first<PatientLinkRow>();
    if (direct && !['rejected', 'retired'].includes(direct.link_status) && direct.effective_to_utc == null) {
      publicId = direct.patient_link_public_id;
    }
  }
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<PatientLinkRow>();
  return row && !['rejected', 'retired'].includes(row.link_status) && row.effective_to_utc == null
    ? row.patient_link_public_id
    : null;
}

async function resolveEncounter(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
  visitId: number,
  patientLinkPublicId: string | null,
): Promise<string | null> {
  if (!patientLinkPublicId) return null;
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter' AND source_type='legacy_visit'
      AND source_public_id=? LIMIT 1
  `).bind(tenantId, String(visitId)).first<MappingRow>();
  const publicId = mappedPublicId(mapping);
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<EncounterRow>();
  return row && row.patient_link_public_id === patientLinkPublicId && row.status !== 'entered_in_error'
    ? row.encounter_public_id
    : null;
}

async function resolvePractitioner(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
  legacyUserId: number | null,
): Promise<string | null> {
  if (legacyUserId == null) return null;
  const row = await db.prepare(`
    SELECT l.practitioner_public_id,p.status
    FROM canonical_practitioner_user_links l
    JOIN canonical_practitioners p
      ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
    WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1
  `).bind(tenantId, legacyUserId).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}

function parseLegacyDose(value: string | null): { value: string; unit: string } | null {
  if (!value?.trim()) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-zµμ]+(?:\/[A-Za-z]+)?)$/.exec(value.trim());
  return match ? { value: match[1].replace(/\.0+$/, ''), unit: match[2] } : null;
}

function legacyOutcome(status: string): string | null {
  const value = status.toLowerCase();
  if (value === 'given' || value === 'late') return 'given';
  if (value === 'partially_given') return 'partially_given';
  if (value === 'hold' || value === 'withheld') return 'withheld';
  if (value === 'refused') return 'refused';
  if (['missed', 'not_given', 'omitted'].includes(value)) return 'omitted';
  if (value === 'not_available') return 'not_available';
  if (value === 'cancelled') return 'cancelled';
  return null;
}

async function readLegacyFacts(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
  sourceType: MedicationAdministrationProviderSourceType,
  legacyId: number,
): Promise<LegacyFacts> {
  if (sourceType === 'legacy_nur_medication_admin') {
    const row = await db.prepare(`
      SELECT patient_id,visit_id,status,dose,route,administered_on,actual_time,
             administered_by,reason_not_given
      FROM nur_medication_admin WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(tenantId, legacyId).first<Record<string, unknown>>();
    if (!row) throw new Error('legacy medication administration row not found');
    const outcomeCode = legacyOutcome(String(row.status ?? ''));
    const dose = outcomeCode === 'given' || outcomeCode === 'partially_given'
      ? parseLegacyDose(row.dose as string | null)
      : null;
    return {
      kind: 'administration',
      patientId: Number(row.patient_id),
      encounterLegacyId: Number(row.visit_id),
      practitionerLegacyUserId: row.administered_by == null ? null : Number(row.administered_by),
      status: outcomeCode ?? String(row.status ?? 'unknown'),
      effectiveAtUtc: normalizedUtc((row.actual_time ?? row.administered_on) as string | null, 'actual administration time'),
      outcomeCode,
      doseValueDecimal: dose?.value ?? null,
      doseUnitCode: dose?.unit ?? null,
      routeCode: outcomeCode === 'given' || outcomeCode === 'partially_given'
        ? String(row.route ?? '').trim() || null
        : null,
      itemCount: 0,
    };
  }
  const row = await db.prepare(`
    SELECT patient_id,visit_id,status,performed_by,completed_at,created_at
    FROM cln_medication_reconciliation WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(tenantId, legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy medication reconciliation row not found');
  const itemCount = Number((await db.prepare(`
    SELECT COUNT(*) AS count FROM cln_medication_reconciliation_items
    WHERE tenant_id=? AND reconciliation_id=? AND COALESCE(is_active,1)=1
  `).bind(tenantId, legacyId).first<{ count: number }>())?.count ?? 0);
  const status = row.status === 'completed' ? 'final' : row.status === 'cancelled' ? 'cancelled' : 'draft';
  return {
    kind: 'reconciliation',
    patientId: Number(row.patient_id),
    encounterLegacyId: Number(row.visit_id),
    practitionerLegacyUserId: Number(row.performed_by),
    status,
    effectiveAtUtc: normalizedUtc((row.completed_at ?? row.created_at) as string | null, 'reconciliation time'),
    outcomeCode: null,
    doseValueDecimal: null,
    doseUnitCode: null,
    routeCode: null,
    itemCount,
  };
}

export async function resolveMedicationAdministrationProviderMode(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
): Promise<MedicationAdministrationProviderMode> {
  const tenant = exact(tenantId, 'tenantId');
  let row: ProviderFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode,is_enabled FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=? LIMIT 1
    `).bind(tenant, FLAG_KEY).first<ProviderFlagRow>();
  } catch (error) {
    if (/no such table:\s*canonical_feature_flags/i.test(error instanceof Error ? error.message : String(error))) return 'legacy';
    throw error;
  }
  if (!row || Number(row.is_enabled) !== 1) return 'legacy';
  return row.mode === 'shadow' || row.mode === 'canonical' ? row.mode : 'legacy';
}

async function readCanonicalAdministration(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
  mappedPublicId: string,
  sourceType: MedicationAdministrationProviderSourceType,
  legacyId: number,
  mode: MedicationAdministrationProviderMode,
): Promise<MedicationAdministrationProjection> {
  const row = await db.prepare(`
    WITH RECURSIVE chain AS (
      SELECT a.*,0 AS depth FROM canonical_medication_administration_events a
      WHERE a.tenant_id=? AND a.administration_event_public_id=?
      UNION ALL
      SELECT next.*,chain.depth+1
      FROM canonical_medication_administration_events next
      JOIN chain ON next.tenant_id=chain.tenant_id
        AND next.supersedes_administration_event_public_id=chain.administration_event_public_id
    )
    SELECT administration_event_public_id,patient_link_public_id,encounter_public_id,
           administering_practitioner_public_id,event_kind,outcome_code,
           administered_dose_value_decimal,administered_dose_unit_code,route_code,
           occurred_at_utc,medication_order_status_version,depth
    FROM chain ORDER BY depth DESC LIMIT 1
  `).bind(tenantId, mappedPublicId).first<CanonicalAdministrationRow>();
  if (!row) throw new Error('mapped canonical medication administration event not found');
  return {
    mode,
    kind: 'administration',
    canonicalPublicId: mappedPublicId,
    patientLinkPublicId: row.patient_link_public_id,
    encounterPublicId: row.encounter_public_id,
    practitionerPublicId: row.administering_practitioner_public_id,
    status: row.event_kind === 'entered_in_error' ? 'entered_in_error' : String(row.outcome_code),
    statusVersion: Number(row.medication_order_status_version),
    effectiveAtUtc: row.occurred_at_utc,
    outcomeCode: row.outcome_code,
    doseValueDecimal: row.administered_dose_value_decimal,
    doseUnitCode: row.administered_dose_unit_code,
    routeCode: row.route_code,
    itemCount: 0,
    historyCount: Number(row.depth) + 1,
    legacy: { sourceType, legacyId },
  };
}

async function readCanonicalReconciliation(
  db: MedicationAdministrationProviderDatabase,
  tenantId: string,
  mappedPublicId: string,
  sourceType: MedicationAdministrationProviderSourceType,
  legacyId: number,
  mode: MedicationAdministrationProviderMode,
): Promise<MedicationAdministrationProjection> {
  const row = await db.prepare(`
    SELECT r.reconciliation_public_id,r.patient_link_public_id,r.encounter_public_id,
           r.creating_practitioner_public_id,r.current_status,r.status_version,
           r.current_version_public_id,v.authored_at_utc,
           (SELECT COUNT(*) FROM canonical_medication_reconciliation_items i
             WHERE i.tenant_id=r.tenant_id AND i.reconciliation_public_id=r.reconciliation_public_id
               AND i.version_public_id=r.current_version_public_id) AS item_count,
           (SELECT COUNT(*) FROM canonical_medication_reconciliation_status_events e
             WHERE e.tenant_id=r.tenant_id AND e.reconciliation_public_id=r.reconciliation_public_id) AS history_count
    FROM canonical_medication_reconciliations r
    JOIN canonical_medication_reconciliation_versions v
      ON v.tenant_id=r.tenant_id AND v.reconciliation_public_id=r.reconciliation_public_id
     AND v.version_public_id=r.current_version_public_id
    WHERE r.tenant_id=? AND r.reconciliation_public_id=? LIMIT 1
  `).bind(tenantId, mappedPublicId).first<CanonicalReconciliationRow>();
  if (!row) throw new Error('mapped canonical medication reconciliation not found');
  return {
    mode,
    kind: 'reconciliation',
    canonicalPublicId: row.reconciliation_public_id,
    patientLinkPublicId: row.patient_link_public_id,
    encounterPublicId: row.encounter_public_id,
    practitionerPublicId: row.creating_practitioner_public_id,
    status: row.current_status,
    statusVersion: Number(row.status_version),
    effectiveAtUtc: row.authored_at_utc,
    outcomeCode: null,
    doseValueDecimal: null,
    doseUnitCode: null,
    routeCode: null,
    itemCount: Number(row.item_count),
    historyCount: Number(row.history_count),
    legacy: { sourceType, legacyId },
  };
}

function parity(
  legacy: MedicationAdministrationProjection,
  canonical: MedicationAdministrationProjection | null,
): MedicationAdministrationParity {
  const result = {
    mapping: canonical != null,
    patientLink: canonical != null && legacy.patientLinkPublicId === canonical.patientLinkPublicId,
    encounter: canonical != null && legacy.encounterPublicId === canonical.encounterPublicId,
    practitioner: canonical != null && legacy.practitionerPublicId === canonical.practitionerPublicId,
    status: canonical != null && legacy.status === canonical.status,
    clinicalShape: canonical != null && (
      legacy.kind === 'reconciliation'
        ? legacy.itemCount === canonical.itemCount
        : legacy.outcomeCode === canonical.outcomeCode
          && legacy.doseValueDecimal === canonical.doseValueDecimal
          && legacy.doseUnitCode === canonical.doseUnitCode
          && legacy.routeCode === canonical.routeCode
    ),
    effectiveTime: canonical != null && legacy.effectiveAtUtc === canonical.effectiveAtUtc,
    historyVisible: canonical != null && canonical.historyCount >= 1,
  };
  return { ok: Object.values(result).every(Boolean), ...result };
}

export async function resolveMedicationAdministrationProjection(
  db: MedicationAdministrationProviderDatabase,
  input: MedicationAdministrationProviderInput,
): Promise<MedicationAdministrationProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const legacyId = positive(input.legacyId, 'legacyId');
  const sourceType = input.sourceType;
  const mode = await resolveMedicationAdministrationProviderMode(db, tenantId);
  const facts = await readLegacyFacts(db, tenantId, sourceType, legacyId);
  const canonicalPublicId = await readMapping(db, tenantId, sourceType, legacyId);
  if (input.identitySensitive && !canonicalPublicId) {
    throw new Error('explicit medication administration source mapping is required for identity-sensitive reads');
  }
  if (mode === 'canonical' && !canonicalPublicId) {
    throw new Error('canonical medication administration mapping is required');
  }
  const patientLinkPublicId = await resolvePatientLink(db, tenantId, facts.patientId);
  const encounterPublicId = await resolveEncounter(db, tenantId, facts.encounterLegacyId, patientLinkPublicId);
  const practitionerPublicId = await resolvePractitioner(db, tenantId, facts.practitionerLegacyUserId);
  const legacyProjection: MedicationAdministrationProjection = {
    mode,
    kind: facts.kind,
    canonicalPublicId,
    patientLinkPublicId,
    encounterPublicId,
    practitionerPublicId,
    status: facts.status,
    statusVersion: 0,
    effectiveAtUtc: facts.effectiveAtUtc,
    outcomeCode: facts.outcomeCode,
    doseValueDecimal: facts.doseValueDecimal,
    doseUnitCode: facts.doseUnitCode,
    routeCode: facts.routeCode,
    itemCount: facts.itemCount,
    historyCount: 0,
    legacy: { sourceType, legacyId },
  };
  if (mode === 'legacy') return legacyProjection;
  const canonicalProjection = canonicalPublicId
    ? sourceType === 'legacy_nur_medication_admin'
      ? await readCanonicalAdministration(db, tenantId, canonicalPublicId, sourceType, legacyId, mode)
      : await readCanonicalReconciliation(db, tenantId, canonicalPublicId, sourceType, legacyId, mode)
    : null;
  if (mode === 'canonical') {
    if (!canonicalProjection) throw new Error('canonical medication administration mapping is required');
    return canonicalProjection;
  }
  return { ...legacyProjection, mode: 'shadow', parity: parity(legacyProjection, canonicalProjection) };
}

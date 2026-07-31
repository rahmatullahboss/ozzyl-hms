import { toUtcIso } from './time';

export type PrescriptionMedicationProviderMode = 'legacy' | 'shadow' | 'canonical';
export type MedicationOrderProviderSourceType = 'legacy_prescription_item' | 'legacy_cln_medication_order';

export interface PrescriptionMedicationProviderPreparedStatement {
  bind(...values: unknown[]): PrescriptionMedicationProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PrescriptionMedicationProviderDatabase {
  prepare(sql: string): PrescriptionMedicationProviderPreparedStatement;
}

export interface PrescriptionDocumentProviderInput {
  tenantId: string;
  legacyPrescriptionId: number;
  identitySensitive?: boolean;
}

export interface MedicationOrderProviderInput {
  tenantId: string;
  sourceType: MedicationOrderProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface PrescriptionDocumentParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  practitioner: boolean;
  status: boolean;
  version: boolean;
  orderCount: boolean;
  safetyCount: boolean;
}

export interface MedicationOrderParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  practitioner: boolean;
  prescriptionScope: boolean;
  status: boolean;
  medication: boolean;
  schedule: boolean;
}

export interface PrescriptionDocumentProjection {
  kind: 'prescription';
  mode: PrescriptionMedicationProviderMode;
  prescriptionPublicId: string | null;
  currentVersionPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  prescribingPractitionerPublicId: string | null;
  currentStatus: string;
  statusVersion: number;
  authoredAtUtc: string;
  finalizedAtUtc: string | null;
  cancelledAtUtc: string | null;
  orderCount: number;
  safetyEventCount: number;
  legacy: {
    sourceType: 'legacy_prescription';
    legacyId: number;
  };
  parity?: PrescriptionDocumentParity;
}

export interface MedicationOrderProjection {
  kind: 'medication_order';
  mode: PrescriptionMedicationProviderMode;
  medicationOrderPublicId: string | null;
  prescriptionPublicId: string | null;
  prescriptionVersionPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  prescribingPractitionerPublicId: string | null;
  medicationCodeSystem: string | null;
  medicationCode: string | null;
  medicationDisplay: string;
  genericDisplay: string | null;
  strengthSnapshot: string | null;
  doseText: string;
  routeCode: string;
  frequencyCode: string;
  durationText: string | null;
  instructionsText: string | null;
  priority: string;
  intendedStartUtc: string | null;
  intendedEndUtc: string | null;
  currentStatus: string;
  statusVersion: number;
  legacy: {
    sourceType: MedicationOrderProviderSourceType;
    legacyId: number;
  };
  parity?: MedicationOrderParity;
}

interface ProviderFlagRow {
  mode: string;
  is_enabled: number | string;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface PatientLinkRow {
  patient_link_public_id: string;
  link_status: string;
  effective_to_utc: string | null;
}

interface PractitionerRow {
  practitioner_public_id: string;
  status: string;
}

interface EncounterRow {
  encounter_public_id: string;
  patient_link_public_id: string | null;
  status: string;
}

interface ClaimRow {
  visit_id: number;
  encounter_id: number | null;
}

interface AppointmentLinkRow {
  encounter_public_id: string;
}

interface AdmissionRow {
  encounter_public_id: string;
}

interface LegacyPrescriptionRow {
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

interface LegacyPrescriptionItemRow {
  prescription_id: number;
  medicine_name: string;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  medicine_id: number | null;
}

interface LegacyCpoeRow {
  patient_id: number;
  visit_id: number;
  formulary_item_id: number | null;
  medication_name: string;
  generic_name: string | null;
  strength: string | null;
  dose: string;
  route: string;
  frequency: string;
  duration: string | null;
  instructions: string | null;
  priority: string;
  start_datetime: string;
  end_datetime: string | null;
  status: string;
  ordered_by: number;
}

interface CanonicalPrescriptionRow {
  prescription_public_id: string;
  current_version_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  prescribing_practitioner_public_id: string;
  current_status: string;
  status_version: number;
  authored_at_utc: string;
  finalized_at_utc: string | null;
  cancelled_at_utc: string | null;
}

interface CanonicalMedicationOrderRow {
  medication_order_public_id: string;
  prescription_public_id: string | null;
  prescription_version_public_id: string | null;
  patient_link_public_id: string;
  encounter_public_id: string;
  prescribing_practitioner_public_id: string;
  medication_code_system: string | null;
  medication_code: string | null;
  medication_display: string;
  generic_display: string | null;
  strength_snapshot: string | null;
  dose_text: string;
  route_code: string;
  frequency_code: string;
  duration_text: string | null;
  instructions_text: string | null;
  priority: string;
  intended_start_utc: string | null;
  intended_end_utc: string | null;
  current_status: string;
  status_version: number;
}

interface CountRow {
  count: number;
}

interface ExactScope {
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  practitionerPublicId: string | null;
  encounterCandidateCount: number;
}

interface LegacyPrescriptionFacts extends ExactScope {
  legacyId: number;
  currentStatus: string;
  authoredAtUtc: string;
  finalizedAtUtc: string | null;
  cancelledAtUtc: string | null;
  orderCount: number;
  safetyEventCount: number;
}

interface LegacyMedicationOrderFacts extends ExactScope {
  sourceType: MedicationOrderProviderSourceType;
  legacyId: number;
  prescriptionPublicId: string | null;
  prescriptionVersionPublicId: string | null;
  medicationCodeSystem: string | null;
  medicationCode: string | null;
  medicationDisplay: string;
  genericDisplay: string | null;
  strengthSnapshot: string | null;
  doseText: string;
  routeCode: string;
  frequencyCode: string;
  durationText: string | null;
  instructionsText: string | null;
  priority: string;
  intendedStartUtc: string | null;
  intendedEndUtc: string | null;
  currentStatus: string;
}

const FLAG_KEY = 'canonical_prescription_medication_provider_v1';

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

function normalizedUtc(value: string, label: string): string {
  const normalized = exact(value, label);
  if (normalized.endsWith('Z')) return toUtcIso(normalized);
  const local = normalized.includes('T') ? normalized : normalized.replace(' ', 'T');
  return toUtcIso(`${local}+06:00`);
}

function medicationSourceType(value: string): MedicationOrderProviderSourceType {
  if (value !== 'legacy_prescription_item' && value !== 'legacy_cln_medication_order') {
    throw new RangeError('sourceType must be legacy_prescription_item or legacy_cln_medication_order');
  }
  return value;
}

function mapPrescriptionStatus(source: string, locked: number): string {
  const status = source.trim().toLowerCase();
  if (['entered_in_error', 'invalid', 'error'].includes(status)) return 'entered_in_error';
  if (['cancelled', 'canceled', 'void'].includes(status)) return 'cancelled';
  if (locked === 1 || ['final', 'issued', 'completed', 'locked', 'active'].includes(status)) return 'final';
  return 'draft';
}

function mapOrderStatus(source: string): string {
  const status = source.trim().toLowerCase();
  if (['active', 'verified', 'approved'].includes(status)) return 'active';
  if (['hold', 'held', 'on_hold'].includes(status)) return 'on_hold';
  if (['complete', 'completed', 'administered'].includes(status)) return 'completed';
  if (['stop', 'stopped', 'discontinued'].includes(status)) return 'stopped';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['entered_in_error', 'error', 'invalid'].includes(status)) return 'entered_in_error';
  return 'draft';
}

function mapPriority(source: string): string {
  const value = source.trim().toLowerCase();
  if (value === 'urgent' || value === 'stat' || value === 'prn') return value;
  return 'routine';
}

async function allRows<T>(statement: PrescriptionMedicationProviderPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function count(
  db: PrescriptionMedicationProviderDatabase,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function readMapping(
  db: PrescriptionMedicationProviderDatabase,
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

function mappedPublicId(row: MappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id
    ? String(row.canonical_public_id)
    : null;
}

export async function resolvePrescriptionMedicationProviderMode(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
): Promise<PrescriptionMedicationProviderMode> {
  const tenant = exact(tenantId, 'tenantId');
  let row: ProviderFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode,is_enabled FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=? LIMIT 1
    `).bind(tenant, FLAG_KEY).first<ProviderFlagRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*canonical_feature_flags/i.test(message)) return 'legacy';
    throw error;
  }
  if (!row || Number(row.is_enabled) !== 1) return 'legacy';
  if (row.mode === 'shadow') return 'shadow';
  if (row.mode === 'canonical') return 'canonical';
  return 'legacy';
}

async function resolvePatientLink(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<string | null> {
  const mapping = await readMapping(db, tenantId, 'patient_link', 'legacy_patient', String(legacyPatientId));
  const publicId = mappedPublicId(mapping);
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<PatientLinkRow>();
  if (!row || ['rejected', 'retired'].includes(row.link_status) || row.effective_to_utc != null) return null;
  return publicId;
}

async function resolvePractitioner(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  legacyDoctorId: number | null,
  legacyUserId: number,
): Promise<string | null> {
  let publicId: string | null = null;
  if (legacyDoctorId != null) {
    publicId = mappedPublicId(await readMapping(
      db,
      tenantId,
      'practitioner',
      'legacy_doctor',
      String(legacyDoctorId),
    ));
  }
  if (!publicId) {
    const user = await db.prepare(`
      SELECT l.practitioner_public_id,p.status
      FROM canonical_practitioner_user_links l
      JOIN canonical_practitioners p
        ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
      WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active'
      LIMIT 1
    `).bind(tenantId, legacyUserId).first<PractitionerRow>();
    publicId = user?.status === 'active' ? String(user.practitioner_public_id) : null;
  }
  if (!publicId) return null;
  const practitioner = await db.prepare(`
    SELECT practitioner_public_id,status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<PractitionerRow>();
  return practitioner?.status === 'active' ? publicId : null;
}

async function validEncounter(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  encounterPublicId: string | null,
  patientLinkPublicId: string | null,
): Promise<string | null> {
  if (!encounterPublicId || !patientLinkPublicId) return null;
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, encounterPublicId).first<EncounterRow>();
  if (!row || row.patient_link_public_id !== patientLinkPublicId || row.status === 'entered_in_error') return null;
  return String(row.encounter_public_id);
}

async function resolvePrescriptionEncounter(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  source: LegacyPrescriptionRow,
  patientLinkPublicId: string | null,
): Promise<{ encounterPublicId: string | null; candidateCount: number }> {
  const candidates = new Set<string>();
  if (source.completion_claim_id != null) {
    const claim = await db.prepare(`
      SELECT visit_id,encounter_id FROM consultation_completion_claims
      WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(tenantId, source.completion_claim_id).first<ClaimRow>();
    if (claim) {
      const fromVisit = mappedPublicId(await readMapping(
        db,
        tenantId,
        'encounter',
        'legacy_visit',
        String(claim.visit_id),
      ));
      const validVisit = await validEncounter(db, tenantId, fromVisit, patientLinkPublicId);
      if (validVisit) candidates.add(validVisit);
      if (claim.encounter_id != null) {
        const fromEncounter = mappedPublicId(await readMapping(
          db,
          tenantId,
          'encounter',
          'legacy_encounter',
          String(claim.encounter_id),
        ));
        const validLegacyEncounter = await validEncounter(db, tenantId, fromEncounter, patientLinkPublicId);
        if (validLegacyEncounter) candidates.add(validLegacyEncounter);
      }
    }
  }
  if (source.appointment_id != null) {
    const appointmentPublicId = mappedPublicId(await readMapping(
      db,
      tenantId,
      'appointment',
      'legacy_appointment',
      String(source.appointment_id),
    ));
    if (appointmentPublicId) {
      const links = await allRows<AppointmentLinkRow>(db.prepare(`
        SELECT encounter_public_id FROM canonical_appointment_encounter_links
        WHERE tenant_id=? AND appointment_public_id=? AND link_status='active'
      `).bind(tenantId, appointmentPublicId));
      for (const link of links) {
        const valid = await validEncounter(db, tenantId, link.encounter_public_id, patientLinkPublicId);
        if (valid) candidates.add(valid);
      }
    }
  }
  if (source.admission_id != null) {
    const admissionPublicId = mappedPublicId(await readMapping(
      db,
      tenantId,
      'admission',
      'legacy_admission',
      String(source.admission_id),
    ));
    if (admissionPublicId) {
      const admission = await db.prepare(`
        SELECT encounter_public_id FROM canonical_admissions
        WHERE tenant_id=? AND admission_public_id=? LIMIT 1
      `).bind(tenantId, admissionPublicId).first<AdmissionRow>();
      const valid = await validEncounter(db, tenantId, admission?.encounter_public_id ?? null, patientLinkPublicId);
      if (valid) candidates.add(valid);
    }
  }
  return {
    encounterPublicId: candidates.size === 1 ? [...candidates][0] : null,
    candidateCount: candidates.size,
  };
}

async function readLegacyPrescriptionFacts(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  legacyId: number,
): Promise<LegacyPrescriptionFacts> {
  const row = await db.prepare(`
    SELECT patient_id,doctor_id,appointment_id,admission_id,completion_claim_id,
           status,is_locked,created_by,created_at,updated_at
    FROM prescriptions WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(tenantId, legacyId).first<LegacyPrescriptionRow>();
  if (!row) throw new Error('legacy prescription source not found');
  const patientLinkPublicId = await resolvePatientLink(db, tenantId, Number(row.patient_id));
  const practitionerPublicId = await resolvePractitioner(
    db,
    tenantId,
    row.doctor_id == null ? null : Number(row.doctor_id),
    Number(row.created_by),
  );
  const encounter = await resolvePrescriptionEncounter(db, tenantId, row, patientLinkPublicId);
  const currentStatus = mapPrescriptionStatus(String(row.status), Number(row.is_locked));
  const authoredAtUtc = normalizedUtc(String(row.created_at), 'prescription.created_at');
  const updatedAtUtc = normalizedUtc(String(row.updated_at), 'prescription.updated_at');
  const orderCount = await count(db, `
    SELECT COUNT(*) AS count FROM prescription_items WHERE prescription_id=?
  `, [legacyId]);
  const safetyEventCount = await count(db, `
    SELECT (
      (SELECT COUNT(*) FROM prescription_overrides WHERE tenant_id=? AND prescription_id=?)
      +
      (SELECT COUNT(*) FROM prescription_safety_checks WHERE tenant_id=? AND prescription_id=?)
    ) AS count
  `, [tenantId, legacyId, tenantId, legacyId]);
  return {
    legacyId,
    patientLinkPublicId,
    encounterPublicId: encounter.encounterPublicId,
    practitionerPublicId,
    encounterCandidateCount: encounter.candidateCount,
    currentStatus,
    authoredAtUtc,
    finalizedAtUtc: currentStatus === 'final' ? updatedAtUtc : null,
    cancelledAtUtc: ['cancelled', 'entered_in_error'].includes(currentStatus) ? updatedAtUtc : null,
    orderCount,
    safetyEventCount,
  };
}

async function readCanonicalPrescription(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  publicId: string,
): Promise<CanonicalPrescriptionRow> {
  const row = await db.prepare(`
    SELECT prescription_public_id,current_version_public_id,patient_link_public_id,
           encounter_public_id,prescribing_practitioner_public_id,current_status,status_version,
           authored_at_utc,finalized_at_utc,cancelled_at_utc
    FROM canonical_prescriptions
    WHERE tenant_id=? AND prescription_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<CanonicalPrescriptionRow>();
  if (!row) throw new Error('mapped canonical prescription not found');
  return row;
}

async function canonicalPrescriptionCounts(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  publicId: string,
): Promise<{ orderCount: number; safetyEventCount: number }> {
  return {
    orderCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_medication_orders
      WHERE tenant_id=? AND prescription_public_id=?
    `, [tenantId, publicId]),
    safetyEventCount: await count(db, `
      SELECT COUNT(*) AS count FROM canonical_prescription_safety_events
      WHERE tenant_id=? AND prescription_public_id=?
    `, [tenantId, publicId]),
  };
}

function failedPrescriptionParity(): PrescriptionDocumentParity {
  return {
    ok: false,
    mapping: false,
    patientLink: false,
    encounter: false,
    practitioner: false,
    status: false,
    version: false,
    orderCount: false,
    safetyCount: false,
  };
}

function comparePrescriptionParity(
  mapping: MappingRow,
  legacy: LegacyPrescriptionFacts,
  canonical: CanonicalPrescriptionRow,
  counts: { orderCount: number; safetyEventCount: number },
): PrescriptionDocumentParity {
  const result = {
    mapping: mapping.mapping_status === 'mapped'
      && mapping.canonical_public_id === canonical.prescription_public_id,
    patientLink: legacy.patientLinkPublicId === canonical.patient_link_public_id,
    encounter: legacy.encounterPublicId === canonical.encounter_public_id,
    practitioner: legacy.practitionerPublicId === canonical.prescribing_practitioner_public_id,
    status: legacy.currentStatus === canonical.current_status,
    version: Boolean(canonical.current_version_public_id) && Number(canonical.status_version) > 0,
    orderCount: legacy.orderCount === counts.orderCount,
    safetyCount: legacy.safetyEventCount === counts.safetyEventCount,
  };
  return { ok: Object.values(result).every(Boolean), ...result };
}

function legacyPrescriptionProjection(
  mode: PrescriptionMedicationProviderMode,
  legacy: LegacyPrescriptionFacts,
  mappingPublicId: string | null,
  canonical: CanonicalPrescriptionRow | null,
  parity?: PrescriptionDocumentParity,
): PrescriptionDocumentProjection {
  return {
    kind: 'prescription',
    mode,
    prescriptionPublicId: mappingPublicId,
    currentVersionPublicId: canonical?.current_version_public_id ?? null,
    patientLinkPublicId: legacy.patientLinkPublicId,
    encounterPublicId: legacy.encounterPublicId,
    prescribingPractitionerPublicId: legacy.practitionerPublicId,
    currentStatus: legacy.currentStatus,
    statusVersion: canonical == null ? 0 : Number(canonical.status_version),
    authoredAtUtc: legacy.authoredAtUtc,
    finalizedAtUtc: legacy.finalizedAtUtc,
    cancelledAtUtc: legacy.cancelledAtUtc,
    orderCount: legacy.orderCount,
    safetyEventCount: legacy.safetyEventCount,
    legacy: { sourceType: 'legacy_prescription', legacyId: legacy.legacyId },
    ...(parity == null ? {} : { parity }),
  };
}

function canonicalPrescriptionProjection(
  canonical: CanonicalPrescriptionRow,
  counts: { orderCount: number; safetyEventCount: number },
  legacyId: number,
): PrescriptionDocumentProjection {
  return {
    kind: 'prescription',
    mode: 'canonical',
    prescriptionPublicId: String(canonical.prescription_public_id),
    currentVersionPublicId: String(canonical.current_version_public_id),
    patientLinkPublicId: String(canonical.patient_link_public_id),
    encounterPublicId: String(canonical.encounter_public_id),
    prescribingPractitionerPublicId: String(canonical.prescribing_practitioner_public_id),
    currentStatus: String(canonical.current_status),
    statusVersion: Number(canonical.status_version),
    authoredAtUtc: String(canonical.authored_at_utc),
    finalizedAtUtc: canonical.finalized_at_utc == null ? null : String(canonical.finalized_at_utc),
    cancelledAtUtc: canonical.cancelled_at_utc == null ? null : String(canonical.cancelled_at_utc),
    orderCount: counts.orderCount,
    safetyEventCount: counts.safetyEventCount,
    legacy: { sourceType: 'legacy_prescription', legacyId },
  };
}

export async function resolvePrescriptionDocumentProjection(
  db: PrescriptionMedicationProviderDatabase,
  input: PrescriptionDocumentProviderInput,
): Promise<PrescriptionDocumentProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const legacyId = positive(input.legacyPrescriptionId, 'legacyPrescriptionId');
  const mode = await resolvePrescriptionMedicationProviderMode(db, tenantId);
  const legacy = await readLegacyPrescriptionFacts(db, tenantId, legacyId);
  const sourceMapping = await readMapping(
    db,
    tenantId,
    'prescription',
    'legacy_prescription',
    String(legacyId),
  );
  const prescriptionPublicId = mappedPublicId(sourceMapping);
  const identityComplete = prescriptionPublicId != null
    && legacy.patientLinkPublicId != null
    && legacy.practitionerPublicId != null
    && legacy.encounterPublicId != null
    && legacy.encounterCandidateCount === 1;

  if (input.identitySensitive && !identityComplete) {
    throw new Error('explicit prescription source mapping and exact patient, practitioner, and encounter evidence are required');
  }

  if (mode === 'legacy') {
    const canonical = prescriptionPublicId == null
      ? null
      : await readCanonicalPrescription(db, tenantId, prescriptionPublicId);
    return legacyPrescriptionProjection(mode, legacy, prescriptionPublicId, canonical);
  }

  if (!prescriptionPublicId || !sourceMapping) {
    if (mode === 'canonical') throw new Error('explicit prescription source mapping is required for canonical mode');
    return legacyPrescriptionProjection(mode, legacy, null, null, failedPrescriptionParity());
  }

  const canonical = await readCanonicalPrescription(db, tenantId, prescriptionPublicId);
  const counts = await canonicalPrescriptionCounts(db, tenantId, prescriptionPublicId);
  const scopeMatches = legacy.patientLinkPublicId === canonical.patient_link_public_id
    && legacy.encounterPublicId === canonical.encounter_public_id
    && legacy.practitionerPublicId === canonical.prescribing_practitioner_public_id;

  if (mode === 'canonical') {
    if (!identityComplete || !scopeMatches) {
      throw new Error('canonical prescription scope conflicts with exact legacy evidence');
    }
    return canonicalPrescriptionProjection(canonical, counts, legacyId);
  }

  return legacyPrescriptionProjection(
    mode,
    legacy,
    prescriptionPublicId,
    canonical,
    identityComplete
      ? comparePrescriptionParity(sourceMapping, legacy, canonical, counts)
      : failedPrescriptionParity(),
  );
}

async function readLegacyMedicationOrderFacts(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  sourceType: MedicationOrderProviderSourceType,
  legacyId: number,
): Promise<LegacyMedicationOrderFacts> {
  if (sourceType === 'legacy_prescription_item') {
    const item = await db.prepare(`
      SELECT prescription_id,medicine_name,dosage,frequency,duration,instructions,medicine_id
      FROM prescription_items WHERE id=? LIMIT 1
    `).bind(legacyId).first<LegacyPrescriptionItemRow>();
    if (!item) throw new Error('legacy prescription item source not found');
    const prescription = await readLegacyPrescriptionFacts(db, tenantId, Number(item.prescription_id));
    const prescriptionPublicId = mappedPublicId(await readMapping(
      db,
      tenantId,
      'prescription',
      'legacy_prescription',
      String(item.prescription_id),
    ));
    let prescriptionVersionPublicId: string | null = null;
    if (prescriptionPublicId) {
      const row = await db.prepare(`
        SELECT current_version_public_id FROM canonical_prescriptions
        WHERE tenant_id=? AND prescription_public_id=? LIMIT 1
      `).bind(tenantId, prescriptionPublicId).first<{ current_version_public_id: string | null }>();
      prescriptionVersionPublicId = row?.current_version_public_id == null
        ? null
        : String(row.current_version_public_id);
    }
    return {
      sourceType,
      legacyId,
      patientLinkPublicId: prescription.patientLinkPublicId,
      encounterPublicId: prescription.encounterPublicId,
      practitionerPublicId: prescription.practitionerPublicId,
      encounterCandidateCount: prescription.encounterCandidateCount,
      prescriptionPublicId,
      prescriptionVersionPublicId,
      medicationCodeSystem: item.medicine_id == null ? null : 'legacy_medicine',
      medicationCode: item.medicine_id == null ? null : String(item.medicine_id),
      medicationDisplay: String(item.medicine_name),
      genericDisplay: null,
      strengthSnapshot: null,
      doseText: item.dosage?.trim() || 'unspecified',
      routeCode: 'unspecified',
      frequencyCode: item.frequency?.trim() || 'unspecified',
      durationText: item.duration == null ? null : String(item.duration),
      instructionsText: item.instructions == null ? null : String(item.instructions),
      priority: 'routine',
      intendedStartUtc: prescription.authoredAtUtc,
      intendedEndUtc: null,
      currentStatus: prescription.currentStatus === 'final'
        ? 'active'
        : prescription.currentStatus === 'cancelled'
          ? 'cancelled'
          : prescription.currentStatus === 'entered_in_error'
            ? 'entered_in_error'
            : 'draft',
    };
  }

  const row = await db.prepare(`
    SELECT patient_id,visit_id,formulary_item_id,medication_name,generic_name,strength,
           dose,route,frequency,duration,instructions,priority,start_datetime,end_datetime,
           status,ordered_by
    FROM cln_medication_orders WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(tenantId, legacyId).first<LegacyCpoeRow>();
  if (!row) throw new Error('legacy CPOE medication order source not found');
  const patientLinkPublicId = await resolvePatientLink(db, tenantId, Number(row.patient_id));
  const practitionerPublicId = await resolvePractitioner(db, tenantId, null, Number(row.ordered_by));
  const encounterMapped = mappedPublicId(await readMapping(
    db,
    tenantId,
    'encounter',
    'legacy_visit',
    String(row.visit_id),
  ));
  const encounterPublicId = await validEncounter(db, tenantId, encounterMapped, patientLinkPublicId);
  return {
    sourceType,
    legacyId,
    patientLinkPublicId,
    encounterPublicId,
    practitionerPublicId,
    encounterCandidateCount: encounterPublicId == null ? 0 : 1,
    prescriptionPublicId: null,
    prescriptionVersionPublicId: null,
    medicationCodeSystem: row.formulary_item_id == null ? null : 'legacy_formulary',
    medicationCode: row.formulary_item_id == null ? null : String(row.formulary_item_id),
    medicationDisplay: String(row.medication_name),
    genericDisplay: row.generic_name == null ? null : String(row.generic_name),
    strengthSnapshot: row.strength == null ? null : String(row.strength),
    doseText: String(row.dose),
    routeCode: String(row.route),
    frequencyCode: String(row.frequency),
    durationText: row.duration == null ? null : String(row.duration),
    instructionsText: row.instructions == null ? null : String(row.instructions),
    priority: mapPriority(String(row.priority)),
    intendedStartUtc: normalizedUtc(String(row.start_datetime), 'cln_medication_order.start_datetime'),
    intendedEndUtc: row.end_datetime == null
      ? null
      : normalizedUtc(String(row.end_datetime), 'cln_medication_order.end_datetime'),
    currentStatus: mapOrderStatus(String(row.status)),
  };
}

async function readCanonicalMedicationOrder(
  db: PrescriptionMedicationProviderDatabase,
  tenantId: string,
  publicId: string,
): Promise<CanonicalMedicationOrderRow> {
  const row = await db.prepare(`
    SELECT medication_order_public_id,prescription_public_id,prescription_version_public_id,
           patient_link_public_id,encounter_public_id,prescribing_practitioner_public_id,
           medication_code_system,medication_code,medication_display,generic_display,
           strength_snapshot,dose_text,route_code,frequency_code,duration_text,instructions_text,
           priority,intended_start_utc,intended_end_utc,current_status,status_version
    FROM canonical_medication_orders
    WHERE tenant_id=? AND medication_order_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<CanonicalMedicationOrderRow>();
  if (!row) throw new Error('mapped canonical medication order not found');
  return row;
}

function failedOrderParity(): MedicationOrderParity {
  return {
    ok: false,
    mapping: false,
    patientLink: false,
    encounter: false,
    practitioner: false,
    prescriptionScope: false,
    status: false,
    medication: false,
    schedule: false,
  };
}

function compareOrderParity(
  mapping: MappingRow,
  legacy: LegacyMedicationOrderFacts,
  canonical: CanonicalMedicationOrderRow,
): MedicationOrderParity {
  const result = {
    mapping: mapping.mapping_status === 'mapped'
      && mapping.canonical_public_id === canonical.medication_order_public_id,
    patientLink: legacy.patientLinkPublicId === canonical.patient_link_public_id,
    encounter: legacy.encounterPublicId === canonical.encounter_public_id,
    practitioner: legacy.practitionerPublicId === canonical.prescribing_practitioner_public_id,
    prescriptionScope: legacy.prescriptionPublicId === canonical.prescription_public_id
      && legacy.prescriptionVersionPublicId === canonical.prescription_version_public_id,
    status: legacy.currentStatus === canonical.current_status,
    medication: legacy.medicationCodeSystem === canonical.medication_code_system
      && legacy.medicationCode === canonical.medication_code
      && legacy.medicationDisplay === canonical.medication_display
      && legacy.doseText === canonical.dose_text
      && legacy.routeCode.toLowerCase() === canonical.route_code.toLowerCase()
      && legacy.frequencyCode === canonical.frequency_code,
    schedule: legacy.priority === canonical.priority
      && legacy.intendedStartUtc === canonical.intended_start_utc
      && legacy.intendedEndUtc === canonical.intended_end_utc,
  };
  return { ok: Object.values(result).every(Boolean), ...result };
}

function legacyOrderProjection(
  mode: PrescriptionMedicationProviderMode,
  legacy: LegacyMedicationOrderFacts,
  publicId: string | null,
  canonical: CanonicalMedicationOrderRow | null,
  parity?: MedicationOrderParity,
): MedicationOrderProjection {
  return {
    kind: 'medication_order',
    mode,
    medicationOrderPublicId: publicId,
    prescriptionPublicId: legacy.prescriptionPublicId,
    prescriptionVersionPublicId: legacy.prescriptionVersionPublicId,
    patientLinkPublicId: legacy.patientLinkPublicId,
    encounterPublicId: legacy.encounterPublicId,
    prescribingPractitionerPublicId: legacy.practitionerPublicId,
    medicationCodeSystem: legacy.medicationCodeSystem,
    medicationCode: legacy.medicationCode,
    medicationDisplay: legacy.medicationDisplay,
    genericDisplay: legacy.genericDisplay,
    strengthSnapshot: legacy.strengthSnapshot,
    doseText: legacy.doseText,
    routeCode: legacy.routeCode,
    frequencyCode: legacy.frequencyCode,
    durationText: legacy.durationText,
    instructionsText: legacy.instructionsText,
    priority: legacy.priority,
    intendedStartUtc: legacy.intendedStartUtc,
    intendedEndUtc: legacy.intendedEndUtc,
    currentStatus: legacy.currentStatus,
    statusVersion: canonical == null ? 0 : Number(canonical.status_version),
    legacy: { sourceType: legacy.sourceType, legacyId: legacy.legacyId },
    ...(parity == null ? {} : { parity }),
  };
}

function canonicalOrderProjection(
  canonical: CanonicalMedicationOrderRow,
  sourceType: MedicationOrderProviderSourceType,
  legacyId: number,
): MedicationOrderProjection {
  return {
    kind: 'medication_order',
    mode: 'canonical',
    medicationOrderPublicId: String(canonical.medication_order_public_id),
    prescriptionPublicId: canonical.prescription_public_id == null ? null : String(canonical.prescription_public_id),
    prescriptionVersionPublicId: canonical.prescription_version_public_id == null
      ? null
      : String(canonical.prescription_version_public_id),
    patientLinkPublicId: String(canonical.patient_link_public_id),
    encounterPublicId: String(canonical.encounter_public_id),
    prescribingPractitionerPublicId: String(canonical.prescribing_practitioner_public_id),
    medicationCodeSystem: canonical.medication_code_system == null ? null : String(canonical.medication_code_system),
    medicationCode: canonical.medication_code == null ? null : String(canonical.medication_code),
    medicationDisplay: String(canonical.medication_display),
    genericDisplay: canonical.generic_display == null ? null : String(canonical.generic_display),
    strengthSnapshot: canonical.strength_snapshot == null ? null : String(canonical.strength_snapshot),
    doseText: String(canonical.dose_text),
    routeCode: String(canonical.route_code),
    frequencyCode: String(canonical.frequency_code),
    durationText: canonical.duration_text == null ? null : String(canonical.duration_text),
    instructionsText: canonical.instructions_text == null ? null : String(canonical.instructions_text),
    priority: String(canonical.priority),
    intendedStartUtc: canonical.intended_start_utc == null ? null : String(canonical.intended_start_utc),
    intendedEndUtc: canonical.intended_end_utc == null ? null : String(canonical.intended_end_utc),
    currentStatus: String(canonical.current_status),
    statusVersion: Number(canonical.status_version),
    legacy: { sourceType, legacyId },
  };
}

export async function resolveMedicationOrderProjection(
  db: PrescriptionMedicationProviderDatabase,
  input: MedicationOrderProviderInput,
): Promise<MedicationOrderProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourceType = medicationSourceType(input.sourceType);
  const legacyId = positive(input.legacyId, 'legacyId');
  const mode = await resolvePrescriptionMedicationProviderMode(db, tenantId);
  const legacy = await readLegacyMedicationOrderFacts(db, tenantId, sourceType, legacyId);
  const sourceMapping = await readMapping(
    db,
    tenantId,
    'medication_order',
    sourceType,
    String(legacyId),
  );
  const medicationOrderPublicId = mappedPublicId(sourceMapping);
  const identityComplete = medicationOrderPublicId != null
    && legacy.patientLinkPublicId != null
    && legacy.practitionerPublicId != null
    && legacy.encounterPublicId != null
    && legacy.encounterCandidateCount === 1;

  if (input.identitySensitive && medicationOrderPublicId == null) {
    throw new Error('explicit medication-order source mapping is required for identity-sensitive resolution');
  }
  if (input.identitySensitive && !identityComplete) {
    throw new Error('exact patient, practitioner, and encounter evidence is required for identity-sensitive resolution');
  }

  if (mode === 'legacy') {
    const canonical = medicationOrderPublicId == null
      ? null
      : await readCanonicalMedicationOrder(db, tenantId, medicationOrderPublicId);
    return legacyOrderProjection(mode, legacy, medicationOrderPublicId, canonical);
  }

  if (!medicationOrderPublicId || !sourceMapping) {
    if (mode === 'canonical') throw new Error('explicit medication-order source mapping is required for canonical mode');
    return legacyOrderProjection(mode, legacy, null, null, failedOrderParity());
  }

  const canonical = await readCanonicalMedicationOrder(db, tenantId, medicationOrderPublicId);
  const scopeMatches = legacy.patientLinkPublicId === canonical.patient_link_public_id
    && legacy.encounterPublicId === canonical.encounter_public_id
    && legacy.practitionerPublicId === canonical.prescribing_practitioner_public_id
    && legacy.prescriptionPublicId === canonical.prescription_public_id
    && legacy.prescriptionVersionPublicId === canonical.prescription_version_public_id;

  if (mode === 'canonical') {
    if (!identityComplete || !scopeMatches) {
      throw new Error('canonical medication-order scope conflicts with exact legacy evidence');
    }
    return canonicalOrderProjection(canonical, sourceType, legacyId);
  }

  return legacyOrderProjection(
    mode,
    legacy,
    medicationOrderPublicId,
    canonical,
    identityComplete
      ? compareOrderParity(sourceMapping, legacy, canonical)
      : failedOrderParity(),
  );
}

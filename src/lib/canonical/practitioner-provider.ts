import {
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from './source-mapping';

export type PractitionerProviderMode = 'legacy' | 'shadow' | 'canonical';
export type PractitionerProviderSourceType = 'legacy_doctor' | 'legacy_external_referrer';

export interface PractitionerProviderPreparedStatement {
  bind(...values: unknown[]): PractitionerProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PractitionerProviderDatabase {
  prepare(sql: string): PractitionerProviderPreparedStatement;
}

export interface PractitionerProviderInput {
  tenantId: string;
  sourceType: PractitionerProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface PractitionerProviderIdentifier {
  system: string;
  issuerKey: string;
  verificationStatus: string;
}

export interface PractitionerProviderClassification {
  normalizedKey: string;
  isPrimary: boolean;
}

export interface PractitionerProviderParity {
  ok: boolean;
  mapping: boolean;
  kind: boolean;
  status: boolean;
  identifier: boolean;
  specialties: boolean;
  departments: boolean;
  userLink: boolean;
  employeeLink: boolean;
}

export interface PractitionerProviderProjection {
  mode: PractitionerProviderMode;
  practitionerPublicId: string | null;
  practitionerKind: 'internal' | 'external';
  displayName: string;
  status: 'active' | 'inactive' | 'unknown';
  legacy: {
    sourceType: PractitionerProviderSourceType;
    legacyId: number;
  };
  legacyUserId: number | null;
  legacyStaffId: number | null;
  identifiers: PractitionerProviderIdentifier[];
  specialties: PractitionerProviderClassification[];
  departments: PractitionerProviderClassification[];
  parity?: PractitionerProviderParity;
}

interface ProviderFlagRow {
  mode: string;
  is_enabled: number | string;
}

interface SourceMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface LegacyDoctorRow {
  id: number;
  name: string;
  is_active: number;
  user_id: number | null;
  bmdc_reg_no: string | null;
  specialty: string | null;
  department: string | null;
  is_marketplace_visible: number;
}

interface LegacyExternalReferrerRow {
  id: number;
  name: string;
  specialty: string | null;
}

interface CanonicalPractitionerRow {
  practitioner_public_id: string;
  practitioner_kind: 'internal' | 'external';
  display_name: string;
  status: 'active' | 'inactive' | 'unknown';
}

interface CanonicalIdentifierRow {
  identifier_system: string;
  issuer_key: string;
  normalized_value: string;
  verification_status: string;
}

interface CanonicalClassificationRow {
  normalized_key: string;
  is_primary: number;
}

interface CanonicalUserLinkRow {
  legacy_user_id: number;
}

interface CanonicalEmployeeLinkRow {
  legacy_staff_id: number;
}

interface LegacyFacts {
  sourceType: PractitionerProviderSourceType;
  legacyId: number;
  practitionerKind: 'internal' | 'external';
  displayName: string;
  status: 'active' | 'inactive';
  legacyUserId: number | null;
  registrationNumber: string | null;
  specialtyKey: string | null;
  departmentKey: string | null;
}

interface CanonicalFacts {
  practitionerPublicId: string;
  practitionerKind: 'internal' | 'external';
  displayName: string;
  status: 'active' | 'inactive' | 'unknown';
  legacyUserId: number | null;
  legacyStaffId: number | null;
  identifiers: Array<PractitionerProviderIdentifier & { normalizedValue: string }>;
  specialties: PractitionerProviderClassification[];
  departments: PractitionerProviderClassification[];
}

const FLAG_KEY = 'canonical_practitioner_provider_v1';

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positive(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function sourceType(value: string): PractitionerProviderSourceType {
  if (value !== 'legacy_doctor' && value !== 'legacy_external_referrer') {
    throw new RangeError('sourceType must be legacy_doctor or legacy_external_referrer');
  }
  return value;
}

function classification(value: string | null): string | null {
  return normalizeIdentityText(value);
}

export async function resolvePractitionerProviderMode(
  db: PractitionerProviderDatabase,
  tenantId: string,
): Promise<PractitionerProviderMode> {
  const tenant = exact(tenantId, 'tenantId');
  let row: ProviderFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode,is_enabled
      FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=?
      LIMIT 1
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

async function readLegacyFacts(
  db: PractitionerProviderDatabase,
  tenantId: string,
  resolvedSourceType: PractitionerProviderSourceType,
  legacyId: number,
): Promise<LegacyFacts> {
  if (resolvedSourceType === 'legacy_doctor') {
    const row = await db.prepare(`
      SELECT id,name,is_active,user_id,bmdc_reg_no,specialty,department,is_marketplace_visible
      FROM doctors
      WHERE tenant_id=? AND id=?
      LIMIT 1
    `).bind(tenantId, legacyId).first<LegacyDoctorRow>();
    if (!row) throw new Error('legacy practitioner source not found');
    return {
      sourceType: resolvedSourceType,
      legacyId,
      practitionerKind: 'internal',
      displayName: String(row.name),
      status: Number(row.is_active) === 1 ? 'active' : 'inactive',
      legacyUserId: row.user_id == null ? null : Number(row.user_id),
      registrationNumber: normalizeRegistrationNumber(row.bmdc_reg_no),
      specialtyKey: classification(row.specialty),
      departmentKey: classification(row.department),
    };
  }

  const row = await db.prepare(`
    SELECT id,name,specialty
    FROM external_referring_doctors
    WHERE tenant_id=? AND id=?
    LIMIT 1
  `).bind(tenantId, legacyId).first<LegacyExternalReferrerRow>();
  if (!row) throw new Error('legacy practitioner source not found');
  return {
    sourceType: resolvedSourceType,
    legacyId,
    practitionerKind: 'external',
    displayName: String(row.name),
    status: 'active',
    legacyUserId: null,
    registrationNumber: null,
    specialtyKey: classification(row.specialty),
    departmentKey: null,
  };
}

async function readSourceMapping(
  db: PractitionerProviderDatabase,
  tenantId: string,
  resolvedSourceType: PractitionerProviderSourceType,
  legacyId: number,
): Promise<SourceMappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='practitioner'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, resolvedSourceType, String(legacyId)).first<SourceMappingRow>();
}

async function readCanonicalFacts(
  db: PractitionerProviderDatabase,
  tenantId: string,
  practitionerPublicId: string,
): Promise<CanonicalFacts> {
  const practitioner = await db.prepare(`
    SELECT practitioner_public_id,practitioner_kind,display_name,status
    FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<CanonicalPractitionerRow>();
  if (!practitioner) throw new Error('mapped canonical practitioner not found');

  const identifiers = (await db.prepare(`
    SELECT identifier_system,issuer_key,normalized_value,verification_status
    FROM canonical_practitioner_identifiers
    WHERE tenant_id=? AND practitioner_public_id=?
    ORDER BY identifier_system,issuer_key,normalized_value
  `).bind(tenantId, practitionerPublicId).all<CanonicalIdentifierRow>()).results.map((row) => ({
    system: String(row.identifier_system),
    issuerKey: String(row.issuer_key),
    normalizedValue: String(row.normalized_value),
    verificationStatus: String(row.verification_status),
  }));
  const specialties = (await db.prepare(`
    SELECT normalized_key,is_primary
    FROM canonical_practitioner_specialties
    WHERE tenant_id=? AND practitioner_public_id=?
    ORDER BY is_primary DESC,normalized_key
  `).bind(tenantId, practitionerPublicId).all<CanonicalClassificationRow>()).results.map((row) => ({
    normalizedKey: String(row.normalized_key),
    isPrimary: Number(row.is_primary) === 1,
  }));
  const departments = (await db.prepare(`
    SELECT normalized_key,is_primary
    FROM canonical_practitioner_departments
    WHERE tenant_id=? AND practitioner_public_id=?
    ORDER BY is_primary DESC,normalized_key
  `).bind(tenantId, practitionerPublicId).all<CanonicalClassificationRow>()).results.map((row) => ({
    normalizedKey: String(row.normalized_key),
    isPrimary: Number(row.is_primary) === 1,
  }));
  const userLink = await db.prepare(`
    SELECT legacy_user_id
    FROM canonical_practitioner_user_links
    WHERE tenant_id=? AND practitioner_public_id=? AND link_status='active'
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<CanonicalUserLinkRow>();
  const employeeLink = await db.prepare(`
    SELECT legacy_staff_id
    FROM canonical_practitioner_employee_links
    WHERE tenant_id=? AND practitioner_public_id=? AND link_status='active'
    LIMIT 1
  `).bind(tenantId, practitionerPublicId).first<CanonicalEmployeeLinkRow>();

  return {
    practitionerPublicId: String(practitioner.practitioner_public_id),
    practitionerKind: practitioner.practitioner_kind,
    displayName: String(practitioner.display_name),
    status: practitioner.status,
    legacyUserId: userLink == null ? null : Number(userLink.legacy_user_id),
    legacyStaffId: employeeLink == null ? null : Number(employeeLink.legacy_staff_id),
    identifiers,
    specialties,
    departments,
  };
}

function legacyProjection(
  mode: PractitionerProviderMode,
  legacy: LegacyFacts,
  practitionerPublicId: string | null,
  parity?: PractitionerProviderParity,
): PractitionerProviderProjection {
  const identifiers: PractitionerProviderIdentifier[] = legacy.registrationNumber == null ? [] : [{
    system: 'bmdc',
    issuerKey: 'bmdc-bd',
    verificationStatus: 'verified',
  }];
  return {
    mode,
    practitionerPublicId,
    practitionerKind: legacy.practitionerKind,
    displayName: legacy.displayName,
    status: legacy.status,
    legacy: { sourceType: legacy.sourceType, legacyId: legacy.legacyId },
    legacyUserId: legacy.legacyUserId,
    legacyStaffId: null,
    identifiers,
    specialties: legacy.specialtyKey == null ? [] : [{ normalizedKey: legacy.specialtyKey, isPrimary: true }],
    departments: legacy.departmentKey == null ? [] : [{ normalizedKey: legacy.departmentKey, isPrimary: true }],
    ...(parity == null ? {} : { parity }),
  };
}

function canonicalProjection(
  mode: PractitionerProviderMode,
  legacy: LegacyFacts,
  canonical: CanonicalFacts,
): PractitionerProviderProjection {
  return {
    mode,
    practitionerPublicId: canonical.practitionerPublicId,
    practitionerKind: canonical.practitionerKind,
    displayName: canonical.displayName,
    status: canonical.status,
    legacy: { sourceType: legacy.sourceType, legacyId: legacy.legacyId },
    legacyUserId: canonical.legacyUserId,
    legacyStaffId: canonical.legacyStaffId,
    identifiers: canonical.identifiers.map(({ system, issuerKey, verificationStatus }) => ({
      system,
      issuerKey,
      verificationStatus,
    })),
    specialties: canonical.specialties,
    departments: canonical.departments,
  };
}

function hasPrimaryClassification(
  rows: PractitionerProviderClassification[],
  expected: string | null,
): boolean {
  if (expected == null) return rows.length === 0;
  return rows.some((row) => row.isPrimary && row.normalizedKey === expected);
}

function parity(
  legacy: LegacyFacts,
  mapping: SourceMappingRow,
  canonical: CanonicalFacts,
): PractitionerProviderParity {
  const mappingMatches = mapping.mapping_status === 'mapped'
    && mapping.canonical_public_id === canonical.practitionerPublicId;
  const kindMatches = legacy.practitionerKind === canonical.practitionerKind;
  const statusMatches = legacy.status === canonical.status;
  const identifierMatches = legacy.registrationNumber == null
    ? !canonical.identifiers.some((row) => row.system === 'bmdc' && row.verificationStatus === 'verified')
    : canonical.identifiers.some((row) => (
        row.system === 'bmdc'
        && row.verificationStatus === 'verified'
        && row.normalizedValue === legacy.registrationNumber
      ));
  const specialtyMatches = hasPrimaryClassification(canonical.specialties, legacy.specialtyKey);
  const departmentMatches = hasPrimaryClassification(canonical.departments, legacy.departmentKey);
  const userLinkMatches = legacy.legacyUserId === canonical.legacyUserId;
  const employeeLinkMatches = canonical.legacyStaffId == null;
  const checks = [
    mappingMatches,
    kindMatches,
    statusMatches,
    identifierMatches,
    specialtyMatches,
    departmentMatches,
    userLinkMatches,
    employeeLinkMatches,
  ];
  return {
    ok: checks.every(Boolean),
    mapping: mappingMatches,
    kind: kindMatches,
    status: statusMatches,
    identifier: identifierMatches,
    specialties: specialtyMatches,
    departments: departmentMatches,
    userLink: userLinkMatches,
    employeeLink: employeeLinkMatches,
  };
}

export async function resolvePractitionerProjection(
  db: PractitionerProviderDatabase,
  input: PractitionerProviderInput,
): Promise<PractitionerProviderProjection> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const resolvedSourceType = sourceType(input.sourceType);
  const legacyId = positive(input.legacyId, 'legacyId');
  const mode = await resolvePractitionerProviderMode(db, tenantId);
  const legacy = await readLegacyFacts(db, tenantId, resolvedSourceType, legacyId);
  const mapping = await readSourceMapping(db, tenantId, resolvedSourceType, legacyId);
  const mappedPublicId = mapping?.mapping_status === 'mapped' && mapping.canonical_public_id
    ? String(mapping.canonical_public_id)
    : null;

  if (input.identitySensitive && mappedPublicId == null) {
    throw new Error('explicit practitioner source mapping is required for identity-sensitive resolution');
  }
  if (mode === 'legacy') return legacyProjection(mode, legacy, mappedPublicId);
  if (mappedPublicId == null || mapping == null) {
    if (mode === 'canonical') throw new Error('explicit practitioner source mapping is required for canonical mode');
    return legacyProjection(mode, legacy, null, {
      ok: false,
      mapping: false,
      kind: false,
      status: false,
      identifier: false,
      specialties: false,
      departments: false,
      userLink: false,
      employeeLink: false,
    });
  }

  const canonical = await readCanonicalFacts(db, tenantId, mappedPublicId);
  if (mode === 'canonical') return canonicalProjection(mode, legacy, canonical);
  return legacyProjection(mode, legacy, mappedPublicId, parity(legacy, mapping, canonical));
}

export function resolvePractitionerForGlobalSearch(
  db: PractitionerProviderDatabase,
  input: Omit<PractitionerProviderInput, 'identitySensitive'>,
): Promise<PractitionerProviderProjection> {
  return resolvePractitionerProjection(db, { ...input, identitySensitive: false });
}

export async function validateAppointmentPractitioner(
  db: PractitionerProviderDatabase,
  input: { tenantId: string; legacyDoctorId: number },
): Promise<{ practitionerPublicId: string; legacyDoctorId: number }> {
  const projection = await resolvePractitionerProjection(db, {
    tenantId: input.tenantId,
    sourceType: 'legacy_doctor',
    legacyId: input.legacyDoctorId,
    identitySensitive: true,
  });
  if (projection.practitionerKind !== 'internal') throw new Error('appointment practitioner must be internal');
  if (projection.status !== 'active') throw new Error('appointment practitioner must be active');
  if (!projection.practitionerPublicId) throw new Error('appointment practitioner mapping is missing');
  return {
    practitionerPublicId: projection.practitionerPublicId,
    legacyDoctorId: positive(input.legacyDoctorId, 'legacyDoctorId'),
  };
}

export async function listMarketplacePractitioners(
  db: PractitionerProviderDatabase,
  tenantId: string,
): Promise<PractitionerProviderProjection[]> {
  const tenant = exact(tenantId, 'tenantId');
  const doctors = (await db.prepare(`
    SELECT id
    FROM doctors
    WHERE tenant_id=? AND is_marketplace_visible=1 AND is_active=1
    ORDER BY id
  `).bind(tenant).all<{ id: number }>()).results;
  const projections: PractitionerProviderProjection[] = [];
  for (const doctor of doctors) {
    projections.push(await resolvePractitionerProjection(db, {
      tenantId: tenant,
      sourceType: 'legacy_doctor',
      legacyId: Number(doctor.id),
      identitySensitive: false,
    }));
  }
  return projections;
}

export async function resolveEncounterParticipant(
  db: PractitionerProviderDatabase,
  input: PractitionerProviderInput & { role: string },
): Promise<{ practitionerPublicId: string; legacyId: number; role: string }> {
  const role = exact(input.role, 'role');
  const projection = await resolvePractitionerProjection(db, {
    tenantId: input.tenantId,
    sourceType: input.sourceType,
    legacyId: input.legacyId,
    identitySensitive: true,
  });
  if (!projection.practitionerPublicId) throw new Error('encounter participant mapping is missing');
  if (projection.status !== 'active') throw new Error('encounter participant must be active');
  return {
    practitionerPublicId: projection.practitionerPublicId,
    legacyId: positive(input.legacyId, 'legacyId'),
    role,
  };
}

export type PatientIdentityProviderMode = 'legacy' | 'shadow' | 'canonical';

export interface PatientIdentityProviderPreparedStatement {
  bind(...values: unknown[]): PatientIdentityProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PatientIdentityProviderDatabase {
  prepare(sql: string): PatientIdentityProviderPreparedStatement;
}

export interface PatientIdentityProviderInput {
  tenantId: string;
  legacyPatientId: number;
  identitySensitive?: boolean;
}

export interface LegacyPatientIdentityProjection {
  legacyPatientId: number;
  patientCode: string | null;
  uhid: string | null;
  name: string;
  fatherHusband: string;
  address: string;
  mobile: string | null;
  guardianMobile: string | null;
  age: number | null;
  gender: string | null;
  bloodGroup: string | null;
  email: string | null;
  dateOfBirth: string | null;
}

export interface CanonicalPatientRelationshipProjection {
  patientLinkPublicId: string;
  legacyPatientId: number;
  linkStatus: string;
  verificationLevel: string;
  evidenceType: string;
  evidenceSha256: string;
  globalPatientUhid: string | null;
  version: number;
  effectiveFromUtc: string;
  effectiveToUtc: string | null;
}

export interface PatientIdentityProviderParity {
  ok: boolean;
  exactTenantPatientLink: boolean;
  legacyPatientAgreement: boolean;
  activeRelationship: boolean;
  effectiveInterval: boolean;
  positiveVersion: boolean;
}

export interface PatientIdentityProviderProjection {
  mode: PatientIdentityProviderMode;
  legacy: LegacyPatientIdentityProjection;
  relationship: CanonicalPatientRelationshipProjection | null;
  parity?: PatientIdentityProviderParity;
}

interface FlagRow { mode: string; is_enabled: number | string }
interface LegacyPatientRow {
  id: number;
  patient_code: string | null;
  uhid: string | null;
  name: string;
  father_husband: string;
  address: string;
  mobile: string | null;
  guardian_mobile: string | null;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
  email: string | null;
  date_of_birth: string | null;
}
interface RelationshipRow {
  patient_link_public_id: string;
  legacy_patient_id: number;
  link_status: string;
  verification_level: string;
  evidence_type: string;
  evidence_sha256: string;
  global_patient_uhid: string | null;
  version: number;
  effective_from_utc: string;
  effective_to_utc: string | null;
}

const FLAG_KEY = 'canonical_patient_identity_provider_v1';

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

async function rows<T>(statement: PatientIdentityProviderPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

export async function resolvePatientIdentityProviderMode(
  db: PatientIdentityProviderDatabase,
  tenantId: string,
): Promise<PatientIdentityProviderMode> {
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

async function readLegacyPatient(
  db: PatientIdentityProviderDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<LegacyPatientIdentityProjection> {
  const row = await db.prepare(`
    SELECT id,patient_code,uhid,name,father_husband,address,mobile,guardian_mobile,
           age,gender,blood_group,email,date_of_birth
    FROM patients WHERE CAST(tenant_id AS TEXT)=? AND id=? LIMIT 1
  `).bind(tenantId, legacyPatientId).first<LegacyPatientRow>();
  if (!row) throw new Error('legacy patient source not found');
  return {
    legacyPatientId: Number(row.id),
    patientCode: row.patient_code == null ? null : String(row.patient_code),
    uhid: row.uhid == null ? null : String(row.uhid),
    name: String(row.name),
    fatherHusband: String(row.father_husband),
    address: String(row.address),
    mobile: row.mobile == null ? null : String(row.mobile),
    guardianMobile: row.guardian_mobile == null ? null : String(row.guardian_mobile),
    age: row.age == null ? null : Number(row.age),
    gender: row.gender == null ? null : String(row.gender),
    bloodGroup: row.blood_group == null ? null : String(row.blood_group),
    email: row.email == null ? null : String(row.email),
    dateOfBirth: row.date_of_birth == null ? null : String(row.date_of_birth),
  };
}

async function readRelationships(
  db: PatientIdentityProviderDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<RelationshipRow[]> {
  return rows<RelationshipRow>(db.prepare(`
    SELECT patient_link_public_id,legacy_patient_id,link_status,verification_level,
           evidence_type,evidence_sha256,global_patient_uhid,version,
           effective_from_utc,effective_to_utc
    FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND legacy_patient_id=?
    ORDER BY version DESC,patient_link_public_id
  `).bind(tenantId, legacyPatientId));
}

function relationshipProjection(row: RelationshipRow): CanonicalPatientRelationshipProjection {
  return {
    patientLinkPublicId: String(row.patient_link_public_id),
    legacyPatientId: Number(row.legacy_patient_id),
    linkStatus: String(row.link_status),
    verificationLevel: String(row.verification_level),
    evidenceType: String(row.evidence_type),
    evidenceSha256: String(row.evidence_sha256),
    globalPatientUhid: row.global_patient_uhid == null ? null : String(row.global_patient_uhid),
    version: Number(row.version),
    effectiveFromUtc: String(row.effective_from_utc),
    effectiveToUtc: row.effective_to_utc == null ? null : String(row.effective_to_utc),
  };
}

function activeRelationship(row: RelationshipRow, legacyPatientId: number): boolean {
  return Number(row.legacy_patient_id) === legacyPatientId
    && !['rejected', 'retired'].includes(String(row.link_status))
    && row.effective_to_utc == null
    && Number(row.version) > 0;
}

function parity(
  relationships: RelationshipRow[],
  legacyPatientId: number,
): PatientIdentityProviderParity {
  const exactRows = relationships.filter((row) => activeRelationship(row, legacyPatientId));
  const selected = exactRows.length === 1 ? exactRows[0] : null;
  const result: PatientIdentityProviderParity = {
    exactTenantPatientLink: exactRows.length === 1,
    legacyPatientAgreement: selected != null && Number(selected.legacy_patient_id) === legacyPatientId,
    activeRelationship: selected != null && !['rejected', 'retired'].includes(String(selected.link_status)),
    effectiveInterval: selected != null && selected.effective_to_utc == null,
    positiveVersion: selected != null && Number(selected.version) > 0,
    ok: false,
  };
  result.ok = result.exactTenantPatientLink
    && result.legacyPatientAgreement
    && result.activeRelationship
    && result.effectiveInterval
    && result.positiveVersion;
  return result;
}

export async function providePatientIdentityProjection(
  db: PatientIdentityProviderDatabase,
  raw: PatientIdentityProviderInput,
): Promise<PatientIdentityProviderProjection> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const legacyPatientId = positive(raw.legacyPatientId, 'legacyPatientId');
  const mode = await resolvePatientIdentityProviderMode(db, tenantId);
  const legacy = await readLegacyPatient(db, tenantId, legacyPatientId);
  const relationships = await readRelationships(db, tenantId, legacyPatientId);
  const comparison = parity(relationships, legacyPatientId);
  const activeRows = relationships.filter((row) => activeRelationship(row, legacyPatientId));
  const selected = activeRows.length === 1 ? relationshipProjection(activeRows[0]) : null;

  if (raw.identitySensitive && selected == null) {
    throw new Error('identity-sensitive patient resolution requires one exact active tenant patient link');
  }
  if (mode === 'canonical' && selected == null) {
    throw new Error('canonical patient identity requires one exact active tenant patient link');
  }

  if (mode === 'shadow') {
    return { mode, legacy, relationship: selected, parity: comparison };
  }
  return { mode, legacy, relationship: selected };
}

export async function resolvePatientIdentityDetail(
  db: PatientIdentityProviderDatabase,
  input: PatientIdentityProviderInput,
): Promise<PatientIdentityProviderProjection> {
  return providePatientIdentityProjection(db, input);
}

export async function resolvePatientIdentityLink(
  db: PatientIdentityProviderDatabase,
  input: PatientIdentityProviderInput,
): Promise<CanonicalPatientRelationshipProjection | null> {
  const projection = await providePatientIdentityProjection(db, input);
  return projection.relationship;
}

export async function resolvePatientAuthScope(
  db: PatientIdentityProviderDatabase,
  input: PatientIdentityProviderInput,
): Promise<{
  mode: PatientIdentityProviderMode;
  legacyPatientId: number;
  patientLinkPublicId: string;
}> {
  const projection = await providePatientIdentityProjection(db, {
    ...input,
    identitySensitive: true,
  });
  if (!projection.relationship) {
    throw new Error('patient authentication scope requires one exact active tenant patient link');
  }
  return {
    mode: projection.mode,
    legacyPatientId: projection.legacy.legacyPatientId,
    patientLinkPublicId: projection.relationship.patientLinkPublicId,
  };
}

import { toUtcIso } from './time';

export type ClinicalDocumentDiagnosisProviderMode = 'legacy' | 'shadow' | 'canonical';
export type ClinicalDocumentProviderSourceType =
  | 'legacy_clinical_note'
  | 'legacy_form_soap'
  | 'legacy_treatment_plan'
  | 'legacy_encounter_snapshot';
export type ClinicalDiagnosisProviderSourceType =
  | 'legacy_clinical_diagnosis'
  | 'legacy_final_diagnosis';

export interface ClinicalDocumentDiagnosisProviderPreparedStatement {
  bind(...values: unknown[]): ClinicalDocumentDiagnosisProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface ClinicalDocumentDiagnosisProviderDatabase {
  prepare(sql: string): ClinicalDocumentDiagnosisProviderPreparedStatement;
}

export interface ClinicalDocumentProviderInput {
  tenantId: string;
  sourceType: ClinicalDocumentProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface ClinicalDiagnosisProviderInput {
  tenantId: string;
  sourceType: ClinicalDiagnosisProviderSourceType;
  legacyId: number;
  identitySensitive?: boolean;
}

export interface ClinicalDocumentParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  practitioner: boolean;
  documentType: boolean;
  status: boolean;
  version: boolean;
  contentHash: boolean;
}

export interface ClinicalDiagnosisParity {
  ok: boolean;
  mapping: boolean;
  patientLink: boolean;
  encounter: boolean;
  practitioner: boolean;
  code: boolean;
  role: boolean;
  clinicalStatus: boolean;
  verificationStatus: boolean;
}

export interface ClinicalDocumentProjection {
  kind: 'clinical_document';
  mode: ClinicalDocumentDiagnosisProviderMode;
  documentPublicId: string | null;
  currentVersionPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  authoringPractitionerPublicId: string | null;
  documentType: string;
  currentStatus: string;
  statusVersion: number;
  confidentialityCode: string;
  authoredAtUtc: string;
  finalizedAtUtc: string | null;
  contentFormat: string;
  contentPayload: string | null;
  encryptedPayloadReference: string | null;
  contentSha256: string | null;
  signatureCount: number;
  attachmentCount: number;
  legacy: {
    sourceType: ClinicalDocumentProviderSourceType;
    legacyId: number;
  };
  parity?: ClinicalDocumentParity;
}

export interface ClinicalDiagnosisProjection {
  kind: 'clinical_diagnosis';
  mode: ClinicalDocumentDiagnosisProviderMode;
  diagnosisPublicId: string | null;
  patientLinkPublicId: string | null;
  encounterPublicId: string | null;
  assertingPractitionerPublicId: string | null;
  supportingDocumentPublicId: string | null;
  supportingVersionPublicId: string | null;
  codeSystem: string;
  codeSystemVersion: string | null;
  code: string;
  displaySnapshot: string;
  diagnosisRole: string;
  certainty: string;
  clinicalStatus: string;
  verificationStatus: string;
  statusVersion: number;
  assertedAtUtc: string;
  reviewedAtUtc: string | null;
  legacy: {
    sourceType: ClinicalDiagnosisProviderSourceType;
    legacyId: number;
  };
  parity?: ClinicalDiagnosisParity;
}

interface ProviderFlagRow { mode: string; is_enabled: number | string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string }
interface PatientLinkRow { patient_link_public_id: string; link_status: string; effective_to_utc: string | null }
interface PractitionerRow { practitioner_public_id: string; status: string }
interface EncounterRow { encounter_public_id: string; patient_link_public_id: string | null; status: string }
interface CountRow { count: number }

interface LegacyDocumentFacts {
  patientId: number;
  encounterSourceType: 'legacy_visit' | 'legacy_encounter';
  encounterLegacyId: number | null;
  authorLegacyUserId: string | number | null;
  documentType: string;
  currentStatus: string;
  authoredAtUtc: string;
  finalizedAtUtc: string | null;
  contentFormat: string;
  contentPayload: string | null;
}

interface LegacyDiagnosisFacts {
  patientId: number;
  encounterLegacyId: number | null;
  authorLegacyUserId: string | number | null;
  codeSystem: string;
  code: string;
  displaySnapshot: string;
  diagnosisRole: string;
  certainty: string;
  clinicalStatus: string;
  verificationStatus: string;
  assertedAtUtc: string;
  reviewedAtUtc: string | null;
}

interface CanonicalDocumentRow {
  document_public_id: string;
  current_version_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string | null;
  authoring_practitioner_public_id: string;
  document_type: string;
  current_status: string;
  status_version: number;
  confidentiality_code: string;
  authored_at_utc: string;
  finalized_at_utc: string | null;
  content_format: string;
  content_payload: string | null;
  encrypted_payload_reference: string | null;
  content_sha256: string;
}

interface CanonicalDiagnosisRow {
  diagnosis_public_id: string;
  patient_link_public_id: string;
  encounter_public_id: string;
  asserting_practitioner_public_id: string;
  supporting_document_public_id: string | null;
  supporting_version_public_id: string | null;
  code_system: string;
  code_system_version: string | null;
  code: string;
  display_snapshot: string;
  diagnosis_role: string;
  certainty: string;
  clinical_status: string;
  verification_status: string;
  status_version: number;
  asserted_at_utc: string;
  reviewed_at_utc: string | null;
}

const FLAG_KEY = 'canonical_clinical_document_diagnosis_provider_v1';

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

function normalizedUtc(value: string, label: string): string {
  const normalized = exact(value, label);
  if (normalized.endsWith('Z')) return toUtcIso(normalized);
  const local = normalized.includes('T') ? normalized : normalized.replace(' ', 'T');
  return toUtcIso(`${local}+06:00`);
}

async function readMapping(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  entityType: string,
  sourceType: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(tenantId, entityType, sourceType, sourcePublicId).first<MappingRow>();
}

function mappedPublicId(row: MappingRow | null): string | null {
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? String(row.canonical_public_id) : null;
}

async function resolvePatientLink(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<string | null> {
  const publicId = mappedPublicId(await readMapping(db, tenantId, 'patient_link', 'legacy_patient', String(legacyPatientId)));
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT patient_link_public_id,link_status,effective_to_utc FROM canonical_tenant_patient_links
    WHERE tenant_id=? AND patient_link_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<PatientLinkRow>();
  if (!row || ['rejected', 'retired'].includes(row.link_status) || row.effective_to_utc != null) return null;
  return row.patient_link_public_id;
}

async function resolvePractitioner(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  legacyUserId: string | number | null,
): Promise<string | null> {
  if (legacyUserId == null || String(legacyUserId).trim() === '') return null;
  const numeric = Number(legacyUserId);
  let publicId: string | null = null;
  if (Number.isSafeInteger(numeric) && numeric > 0) {
    const user = await db.prepare(`
      SELECT l.practitioner_public_id,p.status
      FROM canonical_practitioner_user_links l
      JOIN canonical_practitioners p
        ON p.tenant_id=l.tenant_id AND p.practitioner_public_id=l.practitioner_public_id
      WHERE l.tenant_id=? AND l.legacy_user_id=? AND l.link_status='active' LIMIT 1
    `).bind(tenantId, numeric).first<PractitionerRow>();
    publicId = user?.status === 'active' ? user.practitioner_public_id : null;
  }
  if (!publicId) {
    publicId = mappedPublicId(await readMapping(db, tenantId, 'practitioner', 'legacy_doctor', String(legacyUserId)));
  }
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT practitioner_public_id,status FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<PractitionerRow>();
  return row?.status === 'active' ? row.practitioner_public_id : null;
}

async function resolveEncounter(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  sourceType: 'legacy_visit' | 'legacy_encounter',
  legacyId: number | null,
  patientLinkPublicId: string | null,
): Promise<string | null> {
  if (legacyId == null || patientLinkPublicId == null) return null;
  const publicId = mappedPublicId(await readMapping(db, tenantId, 'encounter', sourceType, String(legacyId)));
  if (!publicId) return null;
  const row = await db.prepare(`
    SELECT encounter_public_id,patient_link_public_id,status FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=? LIMIT 1
  `).bind(tenantId, publicId).first<EncounterRow>();
  if (!row || row.patient_link_public_id !== patientLinkPublicId || row.status === 'entered_in_error') return null;
  return row.encounter_public_id;
}

async function count(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  sql: string,
  values: readonly unknown[],
): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<CountRow>())?.count ?? 0);
}

export async function resolveClinicalDocumentDiagnosisProviderMode(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
): Promise<ClinicalDocumentDiagnosisProviderMode> {
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
  if (row.mode === 'shadow') return 'shadow';
  if (row.mode === 'canonical') return 'canonical';
  return 'legacy';
}

async function readLegacyDocument(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  sourceType: ClinicalDocumentProviderSourceType,
  legacyId: number,
): Promise<LegacyDocumentFacts> {
  if (sourceType === 'legacy_clinical_note') {
    const row = await db.prepare(`
      SELECT patient_id,visit_id,note_type,content,performer_id,is_signed,signed_at,
             is_active,created_by,created_at
      FROM clinical_notes WHERE tenant_id=? AND id=? LIMIT 1
    `).bind(tenantId, legacyId).first<{
      patient_id: number; visit_id: number | null; note_type: string; content: string;
      performer_id: number | null; is_signed: number; signed_at: string | null;
      is_active: number; created_by: number | null; created_at: string;
    }>();
    if (!row) throw new Error('legacy clinical note not found');
    return {
      patientId: Number(row.patient_id), encounterSourceType: 'legacy_visit',
      encounterLegacyId: row.visit_id == null ? null : Number(row.visit_id),
      authorLegacyUserId: row.performer_id ?? row.created_by,
      documentType: row.note_type.toLowerCase().includes('progress') ? 'progress_note' : 'other',
      currentStatus: row.is_active === 0 ? 'entered_in_error' : row.is_signed === 1 ? 'final' : 'draft',
      authoredAtUtc: normalizedUtc(row.created_at, 'created_at'),
      finalizedAtUtc: row.is_signed === 1 && row.signed_at ? normalizedUtc(row.signed_at, 'signed_at') : null,
      contentFormat: 'plain_text', contentPayload: row.content,
    };
  }
  if (sourceType === 'legacy_form_soap') {
    const row = await db.prepare(`
      SELECT PatientId,EncounterId,ChiefComplaint,Subjective,Objective,Assessment,Plan,CreatedById,CreatedAt
      FROM FormSOAP WHERE tenant_id=? AND SOAPId=? LIMIT 1
    `).bind(tenantId, legacyId).first<Record<string, unknown>>();
    if (!row) throw new Error('legacy SOAP note not found');
    return {
      patientId: Number(row.PatientId), encounterSourceType: 'legacy_encounter',
      encounterLegacyId: row.EncounterId == null ? null : Number(row.EncounterId),
      authorLegacyUserId: String(row.CreatedById ?? ''), documentType: 'soap_note',
      currentStatus: 'draft', authoredAtUtc: normalizedUtc(String(row.CreatedAt), 'CreatedAt'),
      finalizedAtUtc: null, contentFormat: 'soap_json',
      contentPayload: JSON.stringify({
        chiefComplaint: row.ChiefComplaint ?? null, subjective: row.Subjective ?? null,
        objective: row.Objective ?? null, assessment: row.Assessment ?? null, plan: row.Plan ?? null,
      }),
    };
  }
  if (sourceType === 'legacy_treatment_plan') {
    const row = await db.prepare(`
      SELECT PatientId,EncounterId,PresentingIssues,PatientHistory,Medications,
             AnyOtherRelevantInformation,Diagnosis,TreatmentReceived,RecommendationForFollowUp,
             CreatedById,CreatedAt
      FROM FormTreatmentPlan WHERE tenant_id=? AND TreatmentPlanId=? LIMIT 1
    `).bind(tenantId, legacyId).first<Record<string, unknown>>();
    if (!row) throw new Error('legacy treatment plan not found');
    return {
      patientId: Number(row.PatientId), encounterSourceType: 'legacy_encounter',
      encounterLegacyId: row.EncounterId == null ? null : Number(row.EncounterId),
      authorLegacyUserId: String(row.CreatedById ?? ''), documentType: 'treatment_plan',
      currentStatus: 'draft', authoredAtUtc: normalizedUtc(String(row.CreatedAt), 'CreatedAt'),
      finalizedAtUtc: null, contentFormat: 'structured_json', contentPayload: JSON.stringify(row),
    };
  }
  const row = await db.prepare(`
    SELECT patient_id,provider_id,signed_snapshot,signed_at,created_at
    FROM encounters WHERE tenant_id=? AND id=? AND signed_snapshot IS NOT NULL LIMIT 1
  `).bind(tenantId, legacyId).first<{
    patient_id: number; provider_id: number | null; signed_snapshot: string;
    signed_at: string | null; created_at: string;
  }>();
  if (!row) throw new Error('legacy signed encounter snapshot not found');
  return {
    patientId: Number(row.patient_id), encounterSourceType: 'legacy_encounter', encounterLegacyId: legacyId,
    authorLegacyUserId: row.provider_id, documentType: 'encounter_summary', currentStatus: 'final',
    authoredAtUtc: normalizedUtc(row.created_at, 'created_at'),
    finalizedAtUtc: row.signed_at ? normalizedUtc(row.signed_at, 'signed_at') : null,
    contentFormat: 'plain_text', contentPayload: row.signed_snapshot,
  };
}

async function readCanonicalDocument(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  documentPublicId: string,
): Promise<CanonicalDocumentRow | null> {
  return db.prepare(`
    SELECT d.document_public_id,d.current_version_public_id,d.patient_link_public_id,
           d.encounter_public_id,d.authoring_practitioner_public_id,d.document_type,
           d.current_status,d.status_version,d.confidentiality_code,d.authored_at_utc,
           d.finalized_at_utc,v.content_format,v.content_payload,
           v.encrypted_payload_reference,v.content_sha256
    FROM canonical_clinical_documents d
    JOIN canonical_clinical_document_versions v
      ON v.tenant_id=d.tenant_id AND v.document_public_id=d.document_public_id
     AND v.version_public_id=d.current_version_public_id
    WHERE d.tenant_id=? AND d.document_public_id=? LIMIT 1
  `).bind(tenantId, documentPublicId).first<CanonicalDocumentRow>();
}

function legacyDocumentProjection(
  mode: ClinicalDocumentDiagnosisProviderMode,
  sourceType: ClinicalDocumentProviderSourceType,
  legacyId: number,
  facts: LegacyDocumentFacts,
  scope: { patientLinkPublicId: string | null; encounterPublicId: string | null; practitionerPublicId: string | null },
  documentPublicId: string | null,
  parity?: ClinicalDocumentParity,
): ClinicalDocumentProjection {
  return {
    kind: 'clinical_document', mode, documentPublicId, currentVersionPublicId: null,
    patientLinkPublicId: scope.patientLinkPublicId, encounterPublicId: scope.encounterPublicId,
    authoringPractitionerPublicId: scope.practitionerPublicId, documentType: facts.documentType,
    currentStatus: facts.currentStatus, statusVersion: 0, confidentialityCode: 'normal',
    authoredAtUtc: facts.authoredAtUtc, finalizedAtUtc: facts.finalizedAtUtc,
    contentFormat: facts.contentFormat, contentPayload: facts.contentPayload,
    encryptedPayloadReference: null, contentSha256: null, signatureCount: 0, attachmentCount: 0,
    legacy: { sourceType, legacyId }, ...(parity ? { parity } : {}),
  };
}

export async function resolveClinicalDocumentProjection(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  raw: ClinicalDocumentProviderInput,
): Promise<ClinicalDocumentProjection> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const legacyId = positive(raw.legacyId, 'legacyId');
  const sourceType = raw.sourceType;
  const mode = await resolveClinicalDocumentDiagnosisProviderMode(db, tenantId);
  const legacy = await readLegacyDocument(db, tenantId, sourceType, legacyId);
  const patientLinkPublicId = await resolvePatientLink(db, tenantId, legacy.patientId);
  const encounterPublicId = await resolveEncounter(
    db, tenantId, legacy.encounterSourceType, legacy.encounterLegacyId, patientLinkPublicId,
  );
  const practitionerPublicId = await resolvePractitioner(db, tenantId, legacy.authorLegacyUserId);
  const mappedId = mappedPublicId(await readMapping(db, tenantId, 'clinical_document', sourceType, String(legacyId)));
  if (mode === 'legacy') {
    if (raw.identitySensitive && !mappedId) throw new Error('explicit clinical-document source mapping is required');
    return legacyDocumentProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, mappedId);
  }
  if (!mappedId) {
    if (mode === 'canonical') throw new Error('canonical clinical document mapping is required');
    const parity: ClinicalDocumentParity = {
      ok: false, mapping: false, patientLink: false, encounter: false, practitioner: false,
      documentType: false, status: false, version: false, contentHash: false,
    };
    return legacyDocumentProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, null, parity);
  }
  const canonical = await readCanonicalDocument(db, tenantId, mappedId);
  if (!canonical) {
    if (mode === 'canonical') throw new Error('mapped canonical clinical document is missing');
    const parity: ClinicalDocumentParity = {
      ok: false, mapping: true, patientLink: false, encounter: false, practitioner: false,
      documentType: false, status: false, version: false, contentHash: false,
    };
    return legacyDocumentProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, mappedId, parity);
  }
  const parity: ClinicalDocumentParity = {
    mapping: true,
    patientLink: canonical.patient_link_public_id === patientLinkPublicId,
    encounter: canonical.encounter_public_id === encounterPublicId,
    practitioner: canonical.authoring_practitioner_public_id === practitionerPublicId,
    documentType: canonical.document_type === legacy.documentType,
    status: canonical.current_status === legacy.currentStatus,
    version: canonical.current_version_public_id.length > 0,
    contentHash: false,
    ok: false,
  };
  parity.ok = Object.entries(parity).filter(([key]) => key !== 'ok').every(([, value]) => value === true);
  if (mode === 'shadow') {
    return legacyDocumentProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, mappedId, parity);
  }
  const signatureCount = await count(db, `
    SELECT COUNT(*) AS count FROM canonical_clinical_document_signatures
    WHERE tenant_id=? AND document_public_id=?
  `, [tenantId, canonical.document_public_id]);
  const attachmentCount = await count(db, `
    SELECT COUNT(*) AS count FROM canonical_clinical_document_attachments
    WHERE tenant_id=? AND document_public_id=? AND lifecycle_status='active'
  `, [tenantId, canonical.document_public_id]);
  return {
    kind: 'clinical_document', mode, documentPublicId: canonical.document_public_id,
    currentVersionPublicId: canonical.current_version_public_id,
    patientLinkPublicId: canonical.patient_link_public_id, encounterPublicId: canonical.encounter_public_id,
    authoringPractitionerPublicId: canonical.authoring_practitioner_public_id,
    documentType: canonical.document_type, currentStatus: canonical.current_status,
    statusVersion: Number(canonical.status_version), confidentialityCode: canonical.confidentiality_code,
    authoredAtUtc: canonical.authored_at_utc, finalizedAtUtc: canonical.finalized_at_utc,
    contentFormat: canonical.content_format, contentPayload: canonical.content_payload,
    encryptedPayloadReference: canonical.encrypted_payload_reference,
    contentSha256: canonical.content_sha256, signatureCount, attachmentCount,
    legacy: { sourceType, legacyId }, parity,
  };
}

async function readLegacyDiagnosis(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  sourceType: ClinicalDiagnosisProviderSourceType,
  legacyId: number,
): Promise<LegacyDiagnosisFacts> {
  if (sourceType === 'legacy_clinical_diagnosis') {
    const row = await db.prepare(`
      SELECT PatientId,PatientVisitId,ICD10Code,ICD10Description,icd11_code,icd11_title,
             DiagnosisType,IsActive,CreatedBy,CreatedOn,review_status,reviewed_at
      FROM ClinicalDiagnosis WHERE tenant_id=? AND DiagnosisId=? LIMIT 1
    `).bind(tenantId, legacyId).first<Record<string, unknown>>();
    if (!row) throw new Error('legacy clinical diagnosis not found');
    const review = String(row.review_status ?? '').toLowerCase();
    return {
      patientId: Number(row.PatientId), encounterLegacyId: row.PatientVisitId == null ? null : Number(row.PatientVisitId),
      authorLegacyUserId: String(row.CreatedBy ?? ''),
      codeSystem: String(row.icd11_code ?? '').trim() ? 'icd11' : 'icd10',
      code: String(row.icd11_code ?? row.ICD10Code ?? ''),
      displaySnapshot: String(row.icd11_title ?? row.ICD10Description ?? ''),
      diagnosisRole: String(row.DiagnosisType ?? 'other').toLowerCase(), certainty: 'confirmed',
      clinicalStatus: Number(row.IsActive) === 0 ? 'inactive' : 'active',
      verificationStatus: ['verified', 'reviewed', 'approved'].includes(review) ? 'verified'
        : ['refuted', 'rejected'].includes(review) ? 'refuted' : 'provisional',
      assertedAtUtc: normalizedUtc(String(row.CreatedOn), 'CreatedOn'),
      reviewedAtUtc: row.reviewed_at ? normalizedUtc(String(row.reviewed_at), 'reviewed_at') : null,
    };
  }
  const row = await db.prepare(`
    SELECT fd.patient_id,fd.visit_id,fd.is_primary,fd.is_active,fd.created_by,fd.created_at,
           ic.code,ic.description,fd.icd11_code,fd.icd11_title
    FROM final_diagnosis fd
    LEFT JOIN icd10_codes ic ON ic.id=fd.icd10_id AND ic.tenant_id=fd.tenant_id
    WHERE fd.tenant_id=? AND fd.id=? LIMIT 1
  `).bind(tenantId, legacyId).first<Record<string, unknown>>();
  if (!row) throw new Error('legacy final diagnosis not found');
  return {
    patientId: Number(row.patient_id), encounterLegacyId: row.visit_id == null ? null : Number(row.visit_id),
    authorLegacyUserId: String(row.created_by ?? ''),
    codeSystem: String(row.icd11_code ?? '').trim() ? 'icd11' : 'icd10',
    code: String(row.icd11_code ?? row.code ?? ''), displaySnapshot: String(row.icd11_title ?? row.description ?? ''),
    diagnosisRole: Number(row.is_primary) === 1 ? 'primary' : 'secondary', certainty: 'confirmed',
    clinicalStatus: Number(row.is_active) === 0 ? 'inactive' : 'active', verificationStatus: 'provisional',
    assertedAtUtc: normalizedUtc(String(row.created_at), 'created_at'), reviewedAtUtc: null,
  };
}

async function readCanonicalDiagnosis(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  tenantId: string,
  diagnosisPublicId: string,
): Promise<CanonicalDiagnosisRow | null> {
  return db.prepare(`
    SELECT diagnosis_public_id,patient_link_public_id,encounter_public_id,
           asserting_practitioner_public_id,supporting_document_public_id,
           supporting_version_public_id,code_system,code_system_version,code,
           display_snapshot,diagnosis_role,certainty,clinical_status,verification_status,
           status_version,asserted_at_utc,reviewed_at_utc
    FROM canonical_diagnosis_assertions
    WHERE tenant_id=? AND diagnosis_public_id=? LIMIT 1
  `).bind(tenantId, diagnosisPublicId).first<CanonicalDiagnosisRow>();
}

function legacyDiagnosisProjection(
  mode: ClinicalDocumentDiagnosisProviderMode,
  sourceType: ClinicalDiagnosisProviderSourceType,
  legacyId: number,
  facts: LegacyDiagnosisFacts,
  scope: { patientLinkPublicId: string | null; encounterPublicId: string | null; practitionerPublicId: string | null },
  diagnosisPublicId: string | null,
  parity?: ClinicalDiagnosisParity,
): ClinicalDiagnosisProjection {
  return {
    kind: 'clinical_diagnosis', mode, diagnosisPublicId,
    patientLinkPublicId: scope.patientLinkPublicId, encounterPublicId: scope.encounterPublicId,
    assertingPractitionerPublicId: scope.practitionerPublicId,
    supportingDocumentPublicId: null, supportingVersionPublicId: null,
    codeSystem: facts.codeSystem, codeSystemVersion: null, code: facts.code,
    displaySnapshot: facts.displaySnapshot, diagnosisRole: facts.diagnosisRole,
    certainty: facts.certainty, clinicalStatus: facts.clinicalStatus,
    verificationStatus: facts.verificationStatus, statusVersion: 0,
    assertedAtUtc: facts.assertedAtUtc, reviewedAtUtc: facts.reviewedAtUtc,
    legacy: { sourceType, legacyId }, ...(parity ? { parity } : {}),
  };
}

export async function resolveClinicalDiagnosisProjection(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  raw: ClinicalDiagnosisProviderInput,
): Promise<ClinicalDiagnosisProjection> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const legacyId = positive(raw.legacyId, 'legacyId');
  const sourceType = raw.sourceType;
  const mode = await resolveClinicalDocumentDiagnosisProviderMode(db, tenantId);
  const legacy = await readLegacyDiagnosis(db, tenantId, sourceType, legacyId);
  const patientLinkPublicId = await resolvePatientLink(db, tenantId, legacy.patientId);
  const encounterPublicId = await resolveEncounter(db, tenantId, 'legacy_visit', legacy.encounterLegacyId, patientLinkPublicId);
  const practitionerPublicId = await resolvePractitioner(db, tenantId, legacy.authorLegacyUserId);
  const mappedId = mappedPublicId(await readMapping(db, tenantId, 'diagnosis_assertion', sourceType, String(legacyId)));
  if (mode === 'legacy') {
    if (raw.identitySensitive && !mappedId) throw new Error('explicit diagnosis source mapping is required');
    return legacyDiagnosisProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, mappedId);
  }
  if (!mappedId) {
    if (mode === 'canonical') throw new Error('canonical diagnosis mapping is required');
    const parity: ClinicalDiagnosisParity = {
      ok: false, mapping: false, patientLink: false, encounter: false, practitioner: false,
      code: false, role: false, clinicalStatus: false, verificationStatus: false,
    };
    return legacyDiagnosisProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, null, parity);
  }
  const canonical = await readCanonicalDiagnosis(db, tenantId, mappedId);
  if (!canonical) {
    if (mode === 'canonical') throw new Error('mapped canonical diagnosis is missing');
    const parity: ClinicalDiagnosisParity = {
      ok: false, mapping: true, patientLink: false, encounter: false, practitioner: false,
      code: false, role: false, clinicalStatus: false, verificationStatus: false,
    };
    return legacyDiagnosisProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, mappedId, parity);
  }
  const parity: ClinicalDiagnosisParity = {
    mapping: true,
    patientLink: canonical.patient_link_public_id === patientLinkPublicId,
    encounter: canonical.encounter_public_id === encounterPublicId,
    practitioner: canonical.asserting_practitioner_public_id === practitionerPublicId,
    code: canonical.code_system === legacy.codeSystem && canonical.code === legacy.code,
    role: canonical.diagnosis_role === legacy.diagnosisRole,
    clinicalStatus: canonical.clinical_status === legacy.clinicalStatus,
    verificationStatus: canonical.verification_status === legacy.verificationStatus,
    ok: false,
  };
  parity.ok = Object.entries(parity).filter(([key]) => key !== 'ok').every(([, value]) => value === true);
  if (mode === 'shadow') {
    return legacyDiagnosisProjection(mode, sourceType, legacyId, legacy, {
      patientLinkPublicId, encounterPublicId, practitionerPublicId,
    }, mappedId, parity);
  }
  return {
    kind: 'clinical_diagnosis', mode, diagnosisPublicId: canonical.diagnosis_public_id,
    patientLinkPublicId: canonical.patient_link_public_id, encounterPublicId: canonical.encounter_public_id,
    assertingPractitionerPublicId: canonical.asserting_practitioner_public_id,
    supportingDocumentPublicId: canonical.supporting_document_public_id,
    supportingVersionPublicId: canonical.supporting_version_public_id,
    codeSystem: canonical.code_system, codeSystemVersion: canonical.code_system_version,
    code: canonical.code, displaySnapshot: canonical.display_snapshot,
    diagnosisRole: canonical.diagnosis_role, certainty: canonical.certainty,
    clinicalStatus: canonical.clinical_status, verificationStatus: canonical.verification_status,
    statusVersion: Number(canonical.status_version), assertedAtUtc: canonical.asserted_at_utc,
    reviewedAtUtc: canonical.reviewed_at_utc, legacy: { sourceType, legacyId }, parity,
  };
}

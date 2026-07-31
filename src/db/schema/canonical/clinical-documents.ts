import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { canonicalEncounters } from './clinical';
import { canonicalPractitioners } from './identity';
import { canonicalTenantPatientLinks } from './patient-identity';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const lowercaseSha256 = (column: unknown) => sql`length(${column}) = 64
  AND ${column} = lower(${column})
  AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const canonicalClinicalDocuments = sqliteTable(
  'canonical_clinical_documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    documentPublicId: text('document_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id'),
    scopeKind: text('scope_kind').notNull(),
    authoringPractitionerPublicId: text('authoring_practitioner_public_id').notNull(),
    documentType: text('document_type').notNull(),
    currentVersionPublicId: text('current_version_public_id'),
    currentStatus: text('current_status').notNull().default('draft'),
    statusVersion: integer('status_version').notNull().default(1),
    confidentialityCode: text('confidentiality_code').notNull().default('normal'),
    authoredAtUtc: text('authored_at_utc').notNull(),
    finalizedAtUtc: text('finalized_at_utc'),
    enteredInErrorAtUtc: text('entered_in_error_at_utc'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_clinical_documents_public_id').on(table.tenantId, table.documentPublicId),
    uniqueIndex('uq_canonical_clinical_documents_patient_scope').on(
      table.tenantId,
      table.documentPublicId,
      table.patientLinkPublicId,
    ),
    uniqueIndex('uq_canonical_clinical_documents_encounter_scope').on(
      table.tenantId,
      table.documentPublicId,
      table.encounterPublicId,
    ),
    uniqueIndex('uq_canonical_clinical_documents_full_scope').on(
      table.tenantId,
      table.documentPublicId,
      table.patientLinkPublicId,
      table.encounterPublicId,
    ),
    uniqueIndex('uq_canonical_clinical_documents_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_clinical_documents_patient_time').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.authoredAtUtc,
      table.documentPublicId,
    ),
    index('idx_canonical_clinical_documents_encounter_status').on(
      table.tenantId,
      table.encounterPublicId,
      table.currentStatus,
      table.authoredAtUtc,
      table.documentPublicId,
    ),
    index('idx_canonical_clinical_documents_author_time').on(
      table.tenantId,
      table.authoringPractitionerPublicId,
      table.authoredAtUtc,
      table.documentPublicId,
    ),
    index('idx_canonical_clinical_documents_type_status').on(
      table.tenantId,
      table.documentType,
      table.currentStatus,
      table.authoredAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_clinical_documents_patient_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_documents_encounter_scope',
      columns: [table.tenantId, table.encounterPublicId, table.patientLinkPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId, canonicalEncounters.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_documents_author',
      columns: [table.tenantId, table.authoringPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    // Migration 0555 enforces the circular document -> current version relationship.
    check('canonical_clinical_documents_scope_kind_check', sql`${table.scopeKind} IN ('patient','encounter')`),
    check(
      'canonical_clinical_documents_scope_check',
      sql`(${table.scopeKind} = 'patient' AND ${table.encounterPublicId} IS NULL)
        OR (${table.scopeKind} = 'encounter' AND ${table.encounterPublicId} IS NOT NULL)`,
    ),
    check(
      'canonical_clinical_documents_type_check',
      sql`${table.documentType} IN (
        'progress_note','soap_note','consultation_note','doctor_round_note',
        'treatment_plan','encounter_summary','discharge_summary','procedure_note',
        'operative_note','referral_note','other'
      )`,
    ),
    check(
      'canonical_clinical_documents_status_check',
      sql`${table.currentStatus} IN ('draft','final','amended','retracted','entered_in_error')`,
    ),
    check(
      'canonical_clinical_documents_confidentiality_check',
      sql`${table.confidentialityCode} IN ('normal','restricted','very_restricted')`,
    ),
    check('canonical_clinical_documents_status_version_check', sql`${table.statusVersion} > 0`),
    check(
      'canonical_clinical_documents_lifecycle_check',
      sql`(${table.currentStatus} = 'draft'
          AND ${table.finalizedAtUtc} IS NULL
          AND ${table.enteredInErrorAtUtc} IS NULL)
        OR (${table.currentStatus} IN ('final','amended','retracted')
          AND ${table.finalizedAtUtc} IS NOT NULL
          AND ${table.enteredInErrorAtUtc} IS NULL)
        OR (${table.currentStatus} = 'entered_in_error'
          AND ${table.enteredInErrorAtUtc} IS NOT NULL)`,
    ),
    check(
      'canonical_clinical_documents_time_check',
      sql`substr(${table.authoredAtUtc}, -1) = 'Z'
        AND (${table.finalizedAtUtc} IS NULL OR (
          substr(${table.finalizedAtUtc}, -1) = 'Z'
          AND ${table.finalizedAtUtc} >= ${table.authoredAtUtc}
        ))
        AND (${table.enteredInErrorAtUtc} IS NULL OR (
          substr(${table.enteredInErrorAtUtc}, -1) = 'Z'
          AND ${table.enteredInErrorAtUtc} >= ${table.authoredAtUtc}
        ))`,
    ),
    check('canonical_clinical_documents_fingerprint_check', lowercaseSha256(table.requestFingerprintSha256)),
    check('canonical_clinical_documents_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalClinicalDocumentVersions = sqliteTable(
  'canonical_clinical_document_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    versionPublicId: text('version_public_id').notNull(),
    documentPublicId: text('document_public_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    supersedesVersionPublicId: text('supersedes_version_public_id'),
    versionKind: text('version_kind').notNull(),
    contentFormat: text('content_format').notNull(),
    contentPayload: text('content_payload'),
    encryptedPayloadReference: text('encrypted_payload_reference'),
    encryptionKeyVersion: text('encryption_key_version'),
    contentSha256: text('content_sha256').notNull(),
    sectionManifestJson: text('section_manifest_json'),
    authoringPractitionerPublicId: text('authoring_practitioner_public_id').notNull(),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    authoredAtUtc: text('authored_at_utc').notNull(),
    finalizedAtUtc: text('finalized_at_utc'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_clinical_document_versions_public_id').on(table.tenantId, table.versionPublicId),
    uniqueIndex('uq_canonical_clinical_document_versions_parent_public_id').on(
      table.tenantId,
      table.documentPublicId,
      table.versionPublicId,
    ),
    uniqueIndex('uq_canonical_clinical_document_versions_number').on(
      table.tenantId,
      table.documentPublicId,
      table.versionNumber,
    ),
    uniqueIndex('uq_canonical_clinical_document_versions_content_identity').on(
      table.tenantId,
      table.documentPublicId,
      table.versionPublicId,
      table.contentSha256,
    ),
    index('idx_canonical_clinical_document_versions_timeline').on(
      table.tenantId,
      table.documentPublicId,
      table.versionNumber,
      table.authoredAtUtc,
    ),
    index('idx_canonical_clinical_document_versions_kind').on(
      table.tenantId,
      table.versionKind,
      table.finalizedAtUtc,
      table.versionPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_clinical_document_versions_document',
      columns: [table.tenantId, table.documentPublicId],
      foreignColumns: [canonicalClinicalDocuments.tenantId, canonicalClinicalDocuments.documentPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_versions_supersedes',
      columns: [table.tenantId, table.documentPublicId, table.supersedesVersionPublicId],
      foreignColumns: [table.tenantId, table.documentPublicId, table.versionPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_versions_author',
      columns: [table.tenantId, table.authoringPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_clinical_document_versions_number_check', sql`${table.versionNumber} > 0`),
    check(
      'canonical_clinical_document_versions_kind_check',
      sql`${table.versionKind} IN ('draft','final','amendment','retraction','entered_in_error')`,
    ),
    check(
      'canonical_clinical_document_versions_format_check',
      sql`${table.contentFormat} IN ('plain_text','soap_json','structured_json','markdown','html','fhir_composition_json')`,
    ),
    check(
      'canonical_clinical_document_versions_payload_check',
      sql`(${table.contentPayload} IS NOT NULL
          AND ${table.encryptedPayloadReference} IS NULL
          AND ${table.encryptionKeyVersion} IS NULL)
        OR (${table.contentPayload} IS NULL
          AND ${table.encryptedPayloadReference} IS NOT NULL
          AND ${table.encryptionKeyVersion} IS NOT NULL)`,
    ),
    check(
      'canonical_clinical_document_versions_manifest_check',
      sql`${table.sectionManifestJson} IS NULL OR json_valid(${table.sectionManifestJson})`,
    ),
    check(
      'canonical_clinical_document_versions_self_supersession_check',
      sql`${table.supersedesVersionPublicId} IS NULL
        OR ${table.supersedesVersionPublicId} != ${table.versionPublicId}`,
    ),
    check(
      'canonical_clinical_document_versions_actor_check',
      sql`${table.actorUserPublicId} IS NOT NULL OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_clinical_document_versions_lifecycle_check',
      sql`(${table.versionKind} = 'draft' AND ${table.finalizedAtUtc} IS NULL)
        OR (${table.versionKind} IN ('final','amendment','retraction','entered_in_error')
          AND ${table.finalizedAtUtc} IS NOT NULL)`,
    ),
    check(
      'canonical_clinical_document_versions_time_check',
      sql`substr(${table.authoredAtUtc}, -1) = 'Z'
        AND (${table.finalizedAtUtc} IS NULL OR (
          substr(${table.finalizedAtUtc}, -1) = 'Z'
          AND ${table.finalizedAtUtc} >= ${table.authoredAtUtc}
        ))`,
    ),
    check('canonical_clinical_document_versions_content_hash_check', lowercaseSha256(table.contentSha256)),
    check('canonical_clinical_document_versions_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalClinicalDocumentSignatures = sqliteTable(
  'canonical_clinical_document_signatures',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    signaturePublicId: text('signature_public_id').notNull(),
    documentPublicId: text('document_public_id').notNull(),
    versionPublicId: text('version_public_id').notNull(),
    signerPractitionerPublicId: text('signer_practitioner_public_id').notNull(),
    actorUserPublicId: text('actor_user_public_id'),
    signatureMethod: text('signature_method').notNull(),
    signedContentSha256: text('signed_content_sha256').notNull(),
    attestationSha256: text('attestation_sha256').notNull(),
    signingKeyReference: text('signing_key_reference'),
    signedAtUtc: text('signed_at_utc').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_clinical_document_signatures_public_id').on(table.tenantId, table.signaturePublicId),
    uniqueIndex('uq_canonical_clinical_document_signatures_version_signer_method').on(
      table.tenantId,
      table.documentPublicId,
      table.versionPublicId,
      table.signerPractitionerPublicId,
      table.signatureMethod,
    ),
    index('idx_canonical_clinical_document_signatures_version').on(
      table.tenantId,
      table.documentPublicId,
      table.versionPublicId,
      table.signedAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_clinical_document_signatures_document',
      columns: [table.tenantId, table.documentPublicId],
      foreignColumns: [canonicalClinicalDocuments.tenantId, canonicalClinicalDocuments.documentPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_signatures_version_hash',
      columns: [table.tenantId, table.documentPublicId, table.versionPublicId, table.signedContentSha256],
      foreignColumns: [
        canonicalClinicalDocumentVersions.tenantId,
        canonicalClinicalDocumentVersions.documentPublicId,
        canonicalClinicalDocumentVersions.versionPublicId,
        canonicalClinicalDocumentVersions.contentSha256,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_signatures_signer',
      columns: [table.tenantId, table.signerPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_clinical_document_signatures_method_check',
      sql`${table.signatureMethod} IN (
        'authenticated_attestation','digital_signature','imported_legacy_signature','system_seal'
      )`,
    ),
    check('canonical_clinical_document_signatures_time_check', sql`substr(${table.signedAtUtc}, -1) = 'Z'`),
    check('canonical_clinical_document_signatures_content_hash_check', lowercaseSha256(table.signedContentSha256)),
    check('canonical_clinical_document_signatures_attestation_hash_check', lowercaseSha256(table.attestationSha256)),
    check('canonical_clinical_document_signatures_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalClinicalDocumentAttachments = sqliteTable(
  'canonical_clinical_document_attachments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    attachmentPublicId: text('attachment_public_id').notNull(),
    documentPublicId: text('document_public_id').notNull(),
    versionPublicId: text('version_public_id'),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id'),
    attachmentType: text('attachment_type').notNull(),
    bodyPartCode: text('body_part_code'),
    storageProvider: text('storage_provider').notNull(),
    objectReference: text('object_reference').notNull(),
    contentSha256: text('content_sha256').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    mimeType: text('mime_type').notNull(),
    originalFilename: text('original_filename'),
    uploaderPractitionerPublicId: text('uploader_practitioner_public_id'),
    uploaderUserPublicId: text('uploader_user_public_id'),
    uploaderSystemKey: text('uploader_system_key'),
    lifecycleStatus: text('lifecycle_status').notNull().default('active'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_clinical_document_attachments_public_id').on(table.tenantId, table.attachmentPublicId),
    index('idx_canonical_clinical_document_attachments_document').on(
      table.tenantId,
      table.documentPublicId,
      table.versionPublicId,
      table.lifecycleStatus,
    ),
    index('idx_canonical_clinical_document_attachments_patient').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.createdAtUtc,
      table.attachmentPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_clinical_document_attachments_patient',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_attachments_document_patient',
      columns: [table.tenantId, table.documentPublicId, table.patientLinkPublicId],
      foreignColumns: [
        canonicalClinicalDocuments.tenantId,
        canonicalClinicalDocuments.documentPublicId,
        canonicalClinicalDocuments.patientLinkPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_attachments_document_encounter',
      columns: [table.tenantId, table.documentPublicId, table.encounterPublicId],
      foreignColumns: [
        canonicalClinicalDocuments.tenantId,
        canonicalClinicalDocuments.documentPublicId,
        canonicalClinicalDocuments.encounterPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_attachments_version',
      columns: [table.tenantId, table.documentPublicId, table.versionPublicId],
      foreignColumns: [
        canonicalClinicalDocumentVersions.tenantId,
        canonicalClinicalDocumentVersions.documentPublicId,
        canonicalClinicalDocumentVersions.versionPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_clinical_document_attachments_uploader',
      columns: [table.tenantId, table.uploaderPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_clinical_document_attachments_type_check',
      sql`${table.attachmentType} IN ('clinical_image','scanned_document','external_report','audio','video','other')`,
    ),
    check(
      'canonical_clinical_document_attachments_status_check',
      sql`${table.lifecycleStatus} IN ('active','superseded','retracted','entered_in_error')`,
    ),
    check(
      'canonical_clinical_document_attachments_actor_check',
      sql`${table.uploaderPractitionerPublicId} IS NOT NULL
        OR ${table.uploaderUserPublicId} IS NOT NULL
        OR ${table.uploaderSystemKey} IS NOT NULL`,
    ),
    check(
      'canonical_clinical_document_attachments_storage_check',
      sql`length(trim(${table.storageProvider})) > 0 AND length(trim(${table.objectReference})) > 0`,
    ),
    check('canonical_clinical_document_attachments_size_check', sql`${table.fileSizeBytes} >= 0`),
    check('canonical_clinical_document_attachments_mime_check', sql`length(trim(${table.mimeType})) > 0`),
    check('canonical_clinical_document_attachments_content_hash_check', lowercaseSha256(table.contentSha256)),
    check('canonical_clinical_document_attachments_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalDiagnosisAssertions = sqliteTable(
  'canonical_diagnosis_assertions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    diagnosisPublicId: text('diagnosis_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    encounterPublicId: text('encounter_public_id').notNull(),
    assertingPractitionerPublicId: text('asserting_practitioner_public_id').notNull(),
    supportingDocumentPublicId: text('supporting_document_public_id'),
    supportingVersionPublicId: text('supporting_version_public_id'),
    codeSystem: text('code_system').notNull(),
    codeSystemVersion: text('code_system_version'),
    code: text('code').notNull(),
    displaySnapshot: text('display_snapshot').notNull(),
    codingPublicId: text('coding_public_id'),
    diagnosisRole: text('diagnosis_role').notNull(),
    certainty: text('certainty').notNull(),
    clinicalStatus: text('clinical_status').notNull(),
    verificationStatus: text('verification_status').notNull(),
    statusVersion: integer('status_version').notNull().default(1),
    assertedAtUtc: text('asserted_at_utc').notNull(),
    reviewedAtUtc: text('reviewed_at_utc'),
    resolvedAtUtc: text('resolved_at_utc'),
    enteredInErrorAtUtc: text('entered_in_error_at_utc'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprintSha256: text('request_fingerprint_sha256').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_diagnosis_assertions_public_id').on(table.tenantId, table.diagnosisPublicId),
    uniqueIndex('uq_canonical_diagnosis_assertions_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_diagnosis_assertions_patient_status').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.clinicalStatus,
      table.assertedAtUtc,
      table.diagnosisPublicId,
    ),
    index('idx_canonical_diagnosis_assertions_encounter_role').on(
      table.tenantId,
      table.encounterPublicId,
      table.diagnosisRole,
      table.verificationStatus,
      table.assertedAtUtc,
    ),
    index('idx_canonical_diagnosis_assertions_code').on(
      table.tenantId,
      table.codeSystem,
      table.code,
      table.verificationStatus,
      table.diagnosisPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_diagnosis_assertions_patient',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_diagnosis_assertions_encounter_scope',
      columns: [table.tenantId, table.encounterPublicId, table.patientLinkPublicId],
      foreignColumns: [canonicalEncounters.tenantId, canonicalEncounters.encounterPublicId, canonicalEncounters.patientLinkPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_diagnosis_assertions_practitioner',
      columns: [table.tenantId, table.assertingPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_diagnosis_assertions_support_document_patient',
      columns: [table.tenantId, table.supportingDocumentPublicId, table.patientLinkPublicId],
      foreignColumns: [
        canonicalClinicalDocuments.tenantId,
        canonicalClinicalDocuments.documentPublicId,
        canonicalClinicalDocuments.patientLinkPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_diagnosis_assertions_support_document_encounter',
      columns: [table.tenantId, table.supportingDocumentPublicId, table.encounterPublicId],
      foreignColumns: [
        canonicalClinicalDocuments.tenantId,
        canonicalClinicalDocuments.documentPublicId,
        canonicalClinicalDocuments.encounterPublicId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_diagnosis_assertions_support_version',
      columns: [table.tenantId, table.supportingDocumentPublicId, table.supportingVersionPublicId],
      foreignColumns: [
        canonicalClinicalDocumentVersions.tenantId,
        canonicalClinicalDocumentVersions.documentPublicId,
        canonicalClinicalDocumentVersions.versionPublicId,
      ],
    }).onDelete('restrict'),
    check(
      'canonical_diagnosis_assertions_support_pair_check',
      sql`(${table.supportingDocumentPublicId} IS NULL AND ${table.supportingVersionPublicId} IS NULL)
        OR (${table.supportingDocumentPublicId} IS NOT NULL AND ${table.supportingVersionPublicId} IS NOT NULL)`,
    ),
    check(
      'canonical_diagnosis_assertions_code_system_check',
      sql`${table.codeSystem} IN ('icd10','icd11','snomed_ct','local','other')`,
    ),
    check(
      'canonical_diagnosis_assertions_code_check',
      sql`length(trim(${table.code})) > 0 AND length(trim(${table.displaySnapshot})) > 0`,
    ),
    check(
      'canonical_diagnosis_assertions_role_check',
      sql`${table.diagnosisRole} IN ('primary','secondary','admitting','discharge','differential','other')`,
    ),
    check(
      'canonical_diagnosis_assertions_certainty_check',
      sql`${table.certainty} IN ('suspected','probable','confirmed','ruled_out','unknown')`,
    ),
    check(
      'canonical_diagnosis_assertions_clinical_status_check',
      sql`${table.clinicalStatus} IN ('active','resolved','inactive','unknown')`,
    ),
    check(
      'canonical_diagnosis_assertions_verification_status_check',
      sql`${table.verificationStatus} IN ('unverified','provisional','verified','refuted','entered_in_error')`,
    ),
    check('canonical_diagnosis_assertions_status_version_check', sql`${table.statusVersion} > 0`),
    check(
      'canonical_diagnosis_assertions_review_check',
      sql`${table.verificationStatus} IN ('unverified','provisional') OR ${table.reviewedAtUtc} IS NOT NULL`,
    ),
    check(
      'canonical_diagnosis_assertions_resolution_check',
      sql`${table.clinicalStatus} != 'resolved' OR ${table.resolvedAtUtc} IS NOT NULL`,
    ),
    check(
      'canonical_diagnosis_assertions_error_check',
      sql`${table.verificationStatus} != 'entered_in_error' OR ${table.enteredInErrorAtUtc} IS NOT NULL`,
    ),
    check(
      'canonical_diagnosis_assertions_time_check',
      sql`substr(${table.assertedAtUtc}, -1) = 'Z'
        AND (${table.reviewedAtUtc} IS NULL OR (
          substr(${table.reviewedAtUtc}, -1) = 'Z'
          AND ${table.reviewedAtUtc} >= ${table.assertedAtUtc}
        ))
        AND (${table.resolvedAtUtc} IS NULL OR (
          substr(${table.resolvedAtUtc}, -1) = 'Z'
          AND ${table.resolvedAtUtc} >= ${table.assertedAtUtc}
        ))
        AND (${table.enteredInErrorAtUtc} IS NULL OR (
          substr(${table.enteredInErrorAtUtc}, -1) = 'Z'
          AND ${table.enteredInErrorAtUtc} >= ${table.assertedAtUtc}
        ))`,
    ),
    check('canonical_diagnosis_assertions_fingerprint_check', lowercaseSha256(table.requestFingerprintSha256)),
    check('canonical_diagnosis_assertions_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

export const canonicalDiagnosisStatusEvents = sqliteTable(
  'canonical_diagnosis_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    diagnosisPublicId: text('diagnosis_public_id').notNull(),
    fromVerificationStatus: text('from_verification_status'),
    toVerificationStatus: text('to_verification_status').notNull(),
    fromClinicalStatus: text('from_clinical_status'),
    toClinicalStatus: text('to_clinical_status').notNull(),
    eventVersion: integer('event_version').notNull(),
    eventType: text('event_type').notNull(),
    reasonCode: text('reason_code').notNull(),
    actorPractitionerPublicId: text('actor_practitioner_public_id'),
    actorUserPublicId: text('actor_user_public_id'),
    actorSystemKey: text('actor_system_key'),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_diagnosis_status_events_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_diagnosis_status_events_version').on(
      table.tenantId,
      table.diagnosisPublicId,
      table.eventVersion,
    ),
    index('idx_canonical_diagnosis_status_events_timeline').on(
      table.tenantId,
      table.diagnosisPublicId,
      table.eventVersion,
      table.occurredAtUtc,
    ),
    index('idx_canonical_diagnosis_status_events_type').on(
      table.tenantId,
      table.eventType,
      table.occurredAtUtc,
      table.diagnosisPublicId,
    ),
    foreignKey({
      name: 'fk_canonical_diagnosis_status_events_diagnosis',
      columns: [table.tenantId, table.diagnosisPublicId],
      foreignColumns: [canonicalDiagnosisAssertions.tenantId, canonicalDiagnosisAssertions.diagnosisPublicId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_diagnosis_status_events_practitioner',
      columns: [table.tenantId, table.actorPractitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check(
      'canonical_diagnosis_status_events_from_verification_check',
      sql`${table.fromVerificationStatus} IS NULL OR ${table.fromVerificationStatus} IN (
        'unverified','provisional','verified','refuted','entered_in_error'
      )`,
    ),
    check(
      'canonical_diagnosis_status_events_to_verification_check',
      sql`${table.toVerificationStatus} IN ('unverified','provisional','verified','refuted','entered_in_error')`,
    ),
    check(
      'canonical_diagnosis_status_events_from_clinical_check',
      sql`${table.fromClinicalStatus} IS NULL OR ${table.fromClinicalStatus} IN ('active','resolved','inactive','unknown')`,
    ),
    check(
      'canonical_diagnosis_status_events_to_clinical_check',
      sql`${table.toClinicalStatus} IN ('active','resolved','inactive','unknown')`,
    ),
    check(
      'canonical_diagnosis_status_events_type_check',
      sql`${table.eventType} IN ('asserted','reviewed','confirmed','refuted','resolved','reopened','entered_in_error')`,
    ),
    check('canonical_diagnosis_status_events_version_check', sql`${table.eventVersion} > 0`),
    check('canonical_diagnosis_status_events_reason_check', sql`length(trim(${table.reasonCode})) > 0`),
    check(
      'canonical_diagnosis_status_events_actor_check',
      sql`${table.actorPractitionerPublicId} IS NOT NULL
        OR ${table.actorUserPublicId} IS NOT NULL
        OR ${table.actorSystemKey} IS NOT NULL`,
    ),
    check('canonical_diagnosis_status_events_time_check', sql`substr(${table.occurredAtUtc}, -1) = 'Z'`),
    check('canonical_diagnosis_status_events_evidence_check', lowercaseSha256(table.sourceEvidenceSha256)),
  ],
);

import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const canonicalPractitioners = sqliteTable(
  'canonical_practitioners',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    practitionerPublicId: text('practitioner_public_id').notNull(),
    practitionerKind: text('practitioner_kind').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    sourceEvidenceSha256: text('source_evidence_sha256')
      .notNull()
      .default('0000000000000000000000000000000000000000000000000000000000000000'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_practitioners_public_id').on(table.tenantId, table.practitionerPublicId),
    index('idx_canonical_practitioners_kind_status').on(
      table.tenantId,
      table.practitionerKind,
      table.status,
      table.practitionerPublicId,
    ),
    index('idx_canonical_practitioners_operational_version').on(
      table.tenantId,
      table.practitionerPublicId,
      table.status,
      table.version,
    ),
    check('canonical_practitioners_kind_check', sql`practitioner_kind IN ('internal', 'external')`),
    check('canonical_practitioners_status_check', sql`status IN ('active', 'inactive', 'unknown')`),
    check('canonical_practitioners_version_check', sql`version > 0`),
    check(
      'canonical_practitioners_source_evidence_sha256_check',
      sql`length(source_evidence_sha256) = 64 AND source_evidence_sha256 NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const canonicalPractitionerUserLinks = sqliteTable(
  'canonical_practitioner_user_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    practitionerPublicId: text('practitioner_public_id').notNull(),
    legacyUserId: integer('legacy_user_id').notNull(),
    linkStatus: text('link_status').notNull().default('active'),
    evidenceType: text('evidence_type').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_practitioner_user_links_practitioner').on(table.tenantId, table.practitionerPublicId),
    uniqueIndex('uq_canonical_practitioner_user_links_user').on(table.tenantId, table.legacyUserId),
    index('idx_canonical_practitioner_user_links_status').on(table.tenantId, table.linkStatus, table.legacyUserId),
    foreignKey({
      name: 'fk_canonical_practitioner_user_links_practitioner',
      columns: [table.tenantId, table.practitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_practitioner_user_links_status_check', sql`link_status IN ('active', 'rejected', 'retired')`),
    check(
      'canonical_practitioner_user_links_evidence_check',
      sql`evidence_type IN ('legacy_doctor_user_id', 'approved_manual')`,
    ),
  ],
);

export const canonicalPractitionerEmployeeLinks = sqliteTable(
  'canonical_practitioner_employee_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    practitionerPublicId: text('practitioner_public_id').notNull(),
    legacyStaffId: integer('legacy_staff_id').notNull(),
    linkStatus: text('link_status').notNull().default('active'),
    evidenceType: text('evidence_type').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_practitioner_employee_links_practitioner').on(
      table.tenantId,
      table.practitionerPublicId,
    ),
    uniqueIndex('uq_canonical_practitioner_employee_links_staff').on(table.tenantId, table.legacyStaffId),
    index('idx_canonical_practitioner_employee_links_status').on(
      table.tenantId,
      table.linkStatus,
      table.legacyStaffId,
    ),
    foreignKey({
      name: 'fk_canonical_practitioner_employee_links_practitioner',
      columns: [table.tenantId, table.practitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_practitioner_employee_links_status_check', sql`link_status IN ('active', 'rejected', 'retired')`),
    check(
      'canonical_practitioner_employee_links_evidence_check',
      sql`evidence_type IN ('shared_explicit_user_id', 'approved_manual')`,
    ),
  ],
);

export const canonicalPractitionerIdentifiers = sqliteTable(
  'canonical_practitioner_identifiers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    practitionerPublicId: text('practitioner_public_id').notNull(),
    identifierSystem: text('identifier_system').notNull(),
    issuerKey: text('issuer_key').notNull().default(''),
    normalizedValue: text('normalized_value').notNull(),
    displayValue: text('display_value').notNull(),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_practitioner_identifier_value').on(
      table.tenantId,
      table.identifierSystem,
      table.issuerKey,
      table.normalizedValue,
    ),
    uniqueIndex('uq_canonical_practitioner_identifier_practitioner').on(
      table.tenantId,
      table.practitionerPublicId,
      table.identifierSystem,
      table.issuerKey,
      table.normalizedValue,
    ),
    index('idx_canonical_practitioner_identifiers_practitioner').on(
      table.tenantId,
      table.practitionerPublicId,
      table.verificationStatus,
    ),
    foreignKey({
      name: 'fk_canonical_practitioner_identifiers_practitioner',
      columns: [table.tenantId, table.practitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_practitioner_identifiers_system_check', sql`identifier_system IN ('bmdc', 'employee_code', 'other')`),
    check(
      'canonical_practitioner_identifiers_verification_check',
      sql`verification_status IN ('unverified', 'verified', 'rejected', 'retired')`,
    ),
  ],
);

export const canonicalPractitionerSpecialties = sqliteTable(
  'canonical_practitioner_specialties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    practitionerPublicId: text('practitioner_public_id').notNull(),
    normalizedKey: text('normalized_key').notNull(),
    displayText: text('display_text').notNull(),
    isPrimary: integer('is_primary').notNull().default(1),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_practitioner_specialties_value').on(
      table.tenantId,
      table.practitionerPublicId,
      table.normalizedKey,
    ),
    index('idx_canonical_practitioner_specialties_lookup').on(table.tenantId, table.normalizedKey, table.isPrimary),
    foreignKey({
      name: 'fk_canonical_practitioner_specialties_practitioner',
      columns: [table.tenantId, table.practitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_practitioner_specialties_primary_check', sql`is_primary IN (0, 1)`),
  ],
);

export const canonicalPractitionerDepartments = sqliteTable(
  'canonical_practitioner_departments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    practitionerPublicId: text('practitioner_public_id').notNull(),
    normalizedKey: text('normalized_key').notNull(),
    displayText: text('display_text').notNull(),
    isPrimary: integer('is_primary').notNull().default(1),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_practitioner_departments_value').on(
      table.tenantId,
      table.practitionerPublicId,
      table.normalizedKey,
    ),
    index('idx_canonical_practitioner_departments_lookup').on(table.tenantId, table.normalizedKey, table.isPrimary),
    foreignKey({
      name: 'fk_canonical_practitioner_departments_practitioner',
      columns: [table.tenantId, table.practitionerPublicId],
      foreignColumns: [canonicalPractitioners.tenantId, canonicalPractitioners.practitionerPublicId],
    }).onDelete('restrict'),
    check('canonical_practitioner_departments_primary_check', sql`is_primary IN (0, 1)`),
  ],
);

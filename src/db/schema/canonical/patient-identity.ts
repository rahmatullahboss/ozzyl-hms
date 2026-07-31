import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const canonicalTenantPatientLinks = sqliteTable(
  'canonical_tenant_patient_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    legacyPatientId: integer('legacy_patient_id').notNull(),
    globalPatientUhid: text('global_patient_uhid'),
    linkStatus: text('link_status').notNull(),
    verificationLevel: text('verification_level').notNull(),
    evidenceType: text('evidence_type').notNull(),
    evidenceSha256: text('evidence_sha256').notNull(),
    effectiveFromUtc: text('effective_from_utc').notNull(),
    effectiveToUtc: text('effective_to_utc'),
    version: integer('version').notNull().default(1),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_tenant_patient_links_public_id').on(
      table.tenantId,
      table.patientLinkPublicId,
    ),
    uniqueIndex('uq_canonical_tenant_patient_links_legacy_patient').on(
      table.tenantId,
      table.legacyPatientId,
    ),
    uniqueIndex('uq_canonical_tenant_patient_links_verified_global')
      .on(table.tenantId, table.globalPatientUhid)
      .where(sql`${table.globalPatientUhid} IS NOT NULL AND ${table.linkStatus} = 'verified'`),
    index('idx_canonical_tenant_patient_links_global').on(
      table.globalPatientUhid,
      table.linkStatus,
      table.tenantId,
    ),
    index('idx_canonical_tenant_patient_links_status').on(
      table.tenantId,
      table.linkStatus,
      table.updatedAtUtc,
      table.id,
    ),
    check('canonical_tenant_patient_links_legacy_patient_check', sql`${table.legacyPatientId} > 0`),
    check(
      'canonical_tenant_patient_links_status_check',
      sql`${table.linkStatus} IN ('unlinked', 'candidate', 'verified', 'rejected', 'merged', 'retired')`,
    ),
    check(
      'canonical_tenant_patient_links_verification_check',
      sql`${table.verificationLevel} IN ('unverified', 'candidate', 'reviewed', 'verified')`,
    ),
    check(
      'canonical_tenant_patient_links_evidence_type_check',
      sql`${table.evidenceType} IN (
        'no_link_placeholder', 'ambiguous_candidate', 'unique_uhid', 'authenticated_claim',
        'verified_national_identity', 'reviewed_manual', 'migration_evidence'
      )`,
    ),
    check('canonical_tenant_patient_links_evidence_hash_check', sql`length(${table.evidenceSha256}) = 64`),
    check('canonical_tenant_patient_links_version_check', sql`${table.version} > 0`),
    check('canonical_tenant_patient_links_effective_from_check', sql`substr(${table.effectiveFromUtc}, -1) = 'Z'`),
    check(
      'canonical_tenant_patient_links_effective_to_check',
      sql`${table.effectiveToUtc} IS NULL OR (
        substr(${table.effectiveToUtc}, -1) = 'Z'
        AND ${table.effectiveToUtc} >= ${table.effectiveFromUtc}
      )`,
    ),
    check(
      'canonical_tenant_patient_links_verified_evidence_check',
      sql`${table.linkStatus} != 'verified' OR (
        ${table.globalPatientUhid} IS NOT NULL
        AND trim(${table.globalPatientUhid}) != ''
        AND ${table.verificationLevel} = 'verified'
        AND ${table.evidenceType} IN (
          'unique_uhid', 'authenticated_claim', 'verified_national_identity', 'reviewed_manual'
        )
      )`,
    ),
    check(
      'canonical_tenant_patient_links_nonverified_global_check',
      sql`${table.linkStatus} IN ('verified', 'merged') OR ${table.globalPatientUhid} IS NULL`,
    ),
    check(
      'canonical_tenant_patient_links_candidate_check',
      sql`${table.linkStatus} != 'candidate' OR (
        ${table.verificationLevel} = 'candidate' AND ${table.evidenceType} = 'ambiguous_candidate'
      )`,
    ),
    check(
      'canonical_tenant_patient_links_unlinked_check',
      sql`${table.linkStatus} != 'unlinked' OR (
        ${table.verificationLevel} = 'unverified' AND ${table.evidenceType} = 'no_link_placeholder'
      )`,
    ),
  ],
);

export const canonicalTenantPatientLinkEvents = sqliteTable(
  'canonical_tenant_patient_link_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    patientLinkPublicId: text('patient_link_public_id').notNull(),
    legacyPatientId: integer('legacy_patient_id').notNull(),
    globalPatientUhid: text('global_patient_uhid'),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    sourceLegacyPatientId: integer('source_legacy_patient_id'),
    targetLegacyPatientId: integer('target_legacy_patient_id'),
    actorUserId: integer('actor_user_id'),
    actorSystemKey: text('actor_system_key'),
    reasonCode: text('reason_code').notNull(),
    evidenceType: text('evidence_type').notNull(),
    evidenceSha256: text('evidence_sha256').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    sequence: integer('sequence').notNull(),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_tenant_patient_link_events_public_id').on(
      table.tenantId,
      table.eventPublicId,
    ),
    uniqueIndex('uq_canonical_tenant_patient_link_events_sequence').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.sequence,
    ),
    uniqueIndex('uq_canonical_tenant_patient_link_events_idempotency').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    index('idx_canonical_tenant_patient_link_events_link').on(
      table.tenantId,
      table.patientLinkPublicId,
      table.sequence,
      table.id,
    ),
    index('idx_canonical_tenant_patient_link_events_global').on(
      table.globalPatientUhid,
      table.occurredAtUtc,
      table.id,
    ),
    index('idx_canonical_tenant_patient_link_events_source').on(
      table.tenantId,
      table.legacyPatientId,
      table.occurredAtUtc,
      table.id,
    ),
    foreignKey({
      name: 'fk_canonical_tenant_patient_link_events_link',
      columns: [table.tenantId, table.patientLinkPublicId],
      foreignColumns: [canonicalTenantPatientLinks.tenantId, canonicalTenantPatientLinks.patientLinkPublicId],
    }).onDelete('restrict'),
    check('canonical_tenant_patient_link_events_legacy_patient_check', sql`${table.legacyPatientId} > 0`),
    check(
      'canonical_tenant_patient_link_events_type_check',
      sql`${table.eventType} IN (
        'registered', 'candidate_detected', 'verified_linked', 'link_rejected',
        'unlinked', 'merged', 'unmerged', 'retired'
      )`,
    ),
    check(
      'canonical_tenant_patient_link_events_from_status_check',
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN (
        'unlinked', 'candidate', 'verified', 'rejected', 'merged', 'retired'
      )`,
    ),
    check(
      'canonical_tenant_patient_link_events_to_status_check',
      sql`${table.toStatus} IN ('unlinked', 'candidate', 'verified', 'rejected', 'merged', 'retired')`,
    ),
    check(
      'canonical_tenant_patient_link_events_evidence_type_check',
      sql`${table.evidenceType} IN (
        'no_link_placeholder', 'ambiguous_candidate', 'unique_uhid', 'authenticated_claim',
        'verified_national_identity', 'reviewed_manual', 'migration_evidence'
      )`,
    ),
    check('canonical_tenant_patient_link_events_evidence_hash_check', sql`length(${table.evidenceSha256}) = 64`),
    check('canonical_tenant_patient_link_events_sequence_check', sql`${table.sequence} > 0`),
    check('canonical_tenant_patient_link_events_occurred_check', sql`substr(${table.occurredAtUtc}, -1) = 'Z'`),
    check(
      'canonical_tenant_patient_link_events_actor_check',
      sql`${table.actorUserId} IS NOT NULL OR (
        ${table.actorSystemKey} IS NOT NULL AND trim(${table.actorSystemKey}) != ''
      )`,
    ),
    check('canonical_tenant_patient_link_events_reason_check', sql`trim(${table.reasonCode}) != ''`),
    check(
      'canonical_tenant_patient_link_events_merge_check',
      sql`${table.eventType} NOT IN ('merged', 'unmerged') OR (
        ${table.sourceLegacyPatientId} IS NOT NULL
        AND ${table.targetLegacyPatientId} IS NOT NULL
        AND ${table.sourceLegacyPatientId} > 0
        AND ${table.targetLegacyPatientId} > 0
        AND ${table.sourceLegacyPatientId} != ${table.targetLegacyPatientId}
      )`,
    ),
    check(
      'canonical_tenant_patient_link_events_verified_check',
      sql`${table.toStatus} != 'verified' OR (
        ${table.globalPatientUhid} IS NOT NULL
        AND trim(${table.globalPatientUhid}) != ''
        AND ${table.evidenceType} IN (
          'unique_uhid', 'authenticated_claim', 'verified_national_identity', 'reviewed_manual'
        )
      )`,
    ),
  ],
);

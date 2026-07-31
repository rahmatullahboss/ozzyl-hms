import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const canonicalSchemaVersions = sqliteTable(
  'canonical_schema_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    domain: text('domain').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    migrationName: text('migration_name').notNull(),
    migrationChecksum: text('migration_checksum').notNull(),
    state: text('state').notNull().default('registered'),
    activatedAtUtc: text('activated_at_utc'),
    retiredAtUtc: text('retired_at_utc'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_schema_versions_domain_version').on(
      table.tenantId,
      table.domain,
      table.schemaVersion,
    ),
    uniqueIndex('uq_canonical_schema_versions_active')
      .on(table.tenantId, table.domain)
      .where(sql`state = 'active'`),
    index('idx_canonical_schema_versions_state').on(
      table.tenantId,
      table.domain,
      table.state,
      table.schemaVersion,
    ),
    check('canonical_schema_versions_version_check', sql`schema_version > 0`),
    check(
      'canonical_schema_versions_state_check',
      sql`state IN ('registered', 'shadow', 'active', 'retired')`,
    ),
    check(
      'canonical_schema_versions_activated_utc_check',
      sql`activated_at_utc IS NULL OR substr(activated_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_schema_versions_retired_utc_check',
      sql`retired_at_utc IS NULL OR substr(retired_at_utc, -1) = 'Z'`,
    ),
  ],
);

export const canonicalMigrationRuns = sqliteTable(
  'canonical_migration_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    runPublicId: text('run_public_id').notNull(),
    migrationName: text('migration_name').notNull(),
    migrationKind: text('migration_kind').notNull(),
    status: text('status').notNull().default('pending'),
    sourceDatabaseId: text('source_database_id'),
    sourceBookmark: text('source_bookmark'),
    rollbackBookmark: text('rollback_bookmark'),
    startedAtUtc: text('started_at_utc').notNull().default(utcNow),
    completedAtUtc: text('completed_at_utc'),
    resultSummaryJson: text('result_summary_json'),
    errorCode: text('error_code'),
    errorSummary: text('error_summary'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_migration_runs_public_id').on(table.tenantId, table.runPublicId),
    uniqueIndex('uq_canonical_migration_runs_tenant_id').on(table.tenantId, table.id),
    index('idx_canonical_migration_runs_status').on(table.tenantId, table.status, table.startedAtUtc),
    index('idx_canonical_migration_runs_name').on(table.tenantId, table.migrationName, table.startedAtUtc),
    check(
      'canonical_migration_runs_kind_check',
      sql`migration_kind IN ('schema', 'backfill', 'reconciliation', 'cutover', 'rollback')`,
    ),
    check(
      'canonical_migration_runs_status_check',
      sql`status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'canonical_migration_runs_completed_utc_check',
      sql`completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_migration_runs_lifecycle_check',
      sql`(status IN ('succeeded', 'failed', 'cancelled') AND completed_at_utc IS NOT NULL) OR (status IN ('pending', 'running') AND completed_at_utc IS NULL)`,
    ),
    check(
      'canonical_migration_runs_summary_json_check',
      sql`result_summary_json IS NULL OR json_valid(result_summary_json)`,
    ),
  ],
);

export const canonicalReconciliationRuns = sqliteTable(
  'canonical_reconciliation_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    runPublicId: text('run_public_id').notNull(),
    migrationRunId: integer('migration_run_id'),
    domain: text('domain').notNull(),
    reconciliationType: text('reconciliation_type').notNull(),
    status: text('status').notNull().default('pending'),
    scannedCount: integer('scanned_count').notNull().default(0),
    matchedCount: integer('matched_count').notNull().default(0),
    mismatchCount: integer('mismatch_count').notNull().default(0),
    exceptionCount: integer('exception_count').notNull().default(0),
    expectedTotalMinor: integer('expected_total_minor'),
    actualTotalMinor: integer('actual_total_minor'),
    varianceMinor: integer('variance_minor'),
    currencyCode: text('currency_code'),
    evidenceSha256: text('evidence_sha256'),
    resultSummaryJson: text('result_summary_json'),
    startedAtUtc: text('started_at_utc').notNull().default(utcNow),
    completedAtUtc: text('completed_at_utc'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_reconciliation_runs_public_id').on(table.tenantId, table.runPublicId),
    uniqueIndex('uq_canonical_reconciliation_runs_tenant_id').on(table.tenantId, table.id),
    index('idx_canonical_reconciliation_runs_status').on(
      table.tenantId,
      table.domain,
      table.status,
      table.startedAtUtc,
    ),
    index('idx_canonical_reconciliation_runs_migration').on(
      table.tenantId,
      table.migrationRunId,
      table.startedAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_reconciliation_runs_migration',
      columns: [table.tenantId, table.migrationRunId],
      foreignColumns: [canonicalMigrationRuns.tenantId, canonicalMigrationRuns.id],
    }).onDelete('restrict'),
    check(
      'canonical_reconciliation_runs_type_check',
      sql`reconciliation_type IN ('baseline', 'backfill', 'shadow', 'cutover', 'post_cutover')`,
    ),
    check(
      'canonical_reconciliation_runs_status_check',
      sql`status IN ('pending', 'running', 'passed', 'failed', 'accepted_with_exceptions')`,
    ),
    check(
      'canonical_reconciliation_runs_counts_check',
      sql`scanned_count >= 0 AND matched_count >= 0 AND mismatch_count >= 0 AND exception_count >= 0`,
    ),
    check(
      'canonical_reconciliation_runs_classification_check',
      sql`matched_count + mismatch_count = scanned_count AND exception_count <= mismatch_count`,
    ),
    check(
      'canonical_reconciliation_runs_money_check',
      sql`(expected_total_minor IS NULL AND actual_total_minor IS NULL AND variance_minor IS NULL AND currency_code IS NULL) OR (expected_total_minor IS NOT NULL AND actual_total_minor IS NOT NULL AND variance_minor = actual_total_minor - expected_total_minor AND currency_code IS NOT NULL AND length(currency_code) = 3)`,
    ),
    check(
      'canonical_reconciliation_runs_completed_utc_check',
      sql`completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_reconciliation_runs_lifecycle_check',
      sql`(status IN ('passed', 'failed', 'accepted_with_exceptions') AND completed_at_utc IS NOT NULL) OR (status IN ('pending', 'running') AND completed_at_utc IS NULL)`,
    ),
    check(
      'canonical_reconciliation_runs_summary_json_check',
      sql`result_summary_json IS NULL OR json_valid(result_summary_json)`,
    ),
  ],
);

export const canonicalBackfillCheckpoints = sqliteTable(
  'canonical_backfill_checkpoints',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    checkpointPublicId: text('checkpoint_public_id').notNull(),
    migrationRunId: integer('migration_run_id').notNull(),
    entityType: text('entity_type').notNull(),
    sourceType: text('source_type').notNull(),
    partitionKey: text('partition_key').notNull().default(''),
    cursorValue: text('cursor_value'),
    status: text('status').notNull().default('pending'),
    scannedCount: integer('scanned_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    mappedCount: integer('mapped_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    exceptionCount: integer('exception_count').notNull().default(0),
    startedAtUtc: text('started_at_utc').notNull().default(utcNow),
    completedAtUtc: text('completed_at_utc'),
    lastErrorCode: text('last_error_code'),
    lastErrorSummary: text('last_error_summary'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_backfill_checkpoints_public_id').on(table.tenantId, table.checkpointPublicId),
    uniqueIndex('uq_canonical_backfill_checkpoint_scope').on(
      table.tenantId,
      table.migrationRunId,
      table.entityType,
      table.sourceType,
      table.partitionKey,
    ),
    index('idx_canonical_backfill_checkpoints_status').on(
      table.tenantId,
      table.migrationRunId,
      table.status,
      table.updatedAtUtc,
    ),
    foreignKey({
      name: 'fk_canonical_backfill_checkpoints_migration',
      columns: [table.tenantId, table.migrationRunId],
      foreignColumns: [canonicalMigrationRuns.tenantId, canonicalMigrationRuns.id],
    }).onDelete('restrict'),
    check(
      'canonical_backfill_checkpoints_status_check',
      sql`status IN ('pending', 'running', 'paused', 'completed', 'failed')`,
    ),
    check(
      'canonical_backfill_checkpoints_counts_check',
      sql`scanned_count >= 0 AND created_count >= 0 AND mapped_count >= 0 AND skipped_count >= 0 AND exception_count >= 0`,
    ),
    check(
      'canonical_backfill_checkpoints_completed_utc_check',
      sql`completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_backfill_checkpoints_lifecycle_check',
      sql`(status IN ('completed', 'failed') AND completed_at_utc IS NOT NULL) OR (status IN ('pending', 'running', 'paused') AND completed_at_utc IS NULL)`,
    ),
  ],
);

export const canonicalSourceMappings = sqliteTable(
  'canonical_source_mappings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    entityType: text('entity_type').notNull(),
    canonicalPublicId: text('canonical_public_id'),
    sourceType: text('source_type').notNull(),
    sourcePublicId: text('source_public_id').notNull(),
    sourceTable: text('source_table').notNull(),
    mappingStatus: text('mapping_status').notNull().default('mapped'),
    mappingVersion: integer('mapping_version').notNull().default(1),
    migrationRunId: integer('migration_run_id'),
    evidenceSha256: text('evidence_sha256'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_source_mapping_source').on(
      table.tenantId,
      table.entityType,
      table.sourceType,
      table.sourcePublicId,
    ),
    index('idx_canonical_source_mappings_canonical').on(
      table.tenantId,
      table.entityType,
      table.canonicalPublicId,
      table.mappingStatus,
    ),
    index('idx_canonical_source_mappings_run').on(
      table.tenantId,
      table.migrationRunId,
      table.mappingStatus,
    ),
    foreignKey({
      name: 'fk_canonical_source_mappings_migration',
      columns: [table.tenantId, table.migrationRunId],
      foreignColumns: [canonicalMigrationRuns.tenantId, canonicalMigrationRuns.id],
    }).onDelete('restrict'),
    check(
      'canonical_source_mappings_status_check',
      sql`mapping_status IN ('mapped', 'ambiguous', 'rejected', 'retired')`,
    ),
    check('canonical_source_mappings_version_check', sql`mapping_version > 0`),
    check(
      'canonical_source_mappings_identity_check',
      sql`(mapping_status IN ('mapped', 'retired') AND canonical_public_id IS NOT NULL) OR (mapping_status IN ('ambiguous', 'rejected') AND canonical_public_id IS NULL)`,
    ),
  ],
);

export const canonicalOutboxEvents = sqliteTable(
  'canonical_outbox_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregatePublicId: text('aggregate_public_id').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull().default(1),
    payloadJson: text('payload_json').notNull(),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    businessDate: text('business_date'),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').notNull().default('pending'),
    availableAtUtc: text('available_at_utc').notNull().default(utcNow),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    lockedAtUtc: text('locked_at_utc'),
    lockedBy: text('locked_by'),
    publishedAtUtc: text('published_at_utc'),
    lastErrorCode: text('last_error_code'),
    lastErrorSummary: text('last_error_summary'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_outbox_event_public_id').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_outbox_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_outbox_delivery').on(table.tenantId, table.status, table.availableAtUtc, table.id),
    index('idx_canonical_outbox_aggregate').on(
      table.tenantId,
      table.aggregateType,
      table.aggregatePublicId,
      table.occurredAtUtc,
    ),
    check('canonical_outbox_event_version_check', sql`event_version > 0`),
    check('canonical_outbox_payload_json_check', sql`json_valid(payload_json)`),
    check(
      'canonical_outbox_occurred_utc_check',
      sql`occurred_at_utc IS NOT NULL AND substr(occurred_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_outbox_business_date_check',
      sql`business_date IS NULL OR business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      'canonical_outbox_status_check',
      sql`status IN ('pending', 'processing', 'published', 'retry', 'dead_letter', 'cancelled')`,
    ),
    check('canonical_outbox_attempts_check', sql`processing_attempts >= 0`),
    check(
      'canonical_outbox_locked_utc_check',
      sql`locked_at_utc IS NULL OR substr(locked_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_outbox_published_utc_check',
      sql`published_at_utc IS NULL OR substr(published_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_outbox_processing_lock_check',
      sql`status != 'processing' OR (locked_at_utc IS NOT NULL AND locked_by IS NOT NULL)`,
    ),
    check(
      'canonical_outbox_published_evidence_check',
      sql`status != 'published' OR published_at_utc IS NOT NULL`,
    ),
  ],
);

export const canonicalProcessingIssues = sqliteTable(
  'canonical_processing_issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    issuePublicId: text('issue_public_id').notNull(),
    migrationRunId: integer('migration_run_id'),
    reconciliationRunId: integer('reconciliation_run_id'),
    issueType: text('issue_type').notNull(),
    issueCode: text('issue_code').notNull(),
    entityType: text('entity_type').notNull(),
    entityPublicId: text('entity_public_id'),
    sourceType: text('source_type'),
    sourcePublicId: text('source_public_id'),
    fingerprint: text('fingerprint').notNull(),
    severity: text('severity').notNull().default('error'),
    status: text('status').notNull().default('open'),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    summary: text('summary').notNull(),
    detailsJson: text('details_json'),
    firstSeenAtUtc: text('first_seen_at_utc').notNull().default(utcNow),
    lastSeenAtUtc: text('last_seen_at_utc').notNull().default(utcNow),
    resolvedAtUtc: text('resolved_at_utc'),
    resolvedByPublicId: text('resolved_by_public_id'),
    resolutionCode: text('resolution_code'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_processing_issues_public_id').on(table.tenantId, table.issuePublicId),
    uniqueIndex('uq_canonical_processing_issues_fingerprint').on(
      table.tenantId,
      table.issueType,
      table.fingerprint,
    ),
    index('idx_canonical_processing_issues_queue').on(
      table.tenantId,
      table.status,
      table.severity,
      table.lastSeenAtUtc,
    ),
    index('idx_canonical_processing_issues_entity').on(
      table.tenantId,
      table.entityType,
      table.entityPublicId,
      table.status,
    ),
    foreignKey({
      name: 'fk_canonical_processing_issues_migration',
      columns: [table.tenantId, table.migrationRunId],
      foreignColumns: [canonicalMigrationRuns.tenantId, canonicalMigrationRuns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_canonical_processing_issues_reconciliation',
      columns: [table.tenantId, table.reconciliationRunId],
      foreignColumns: [canonicalReconciliationRuns.tenantId, canonicalReconciliationRuns.id],
    }).onDelete('restrict'),
    check(
      'canonical_processing_issues_severity_check',
      sql`severity IN ('info', 'warning', 'error', 'critical')`,
    ),
    check(
      'canonical_processing_issues_status_check',
      sql`status IN ('open', 'acknowledged', 'resolved', 'waived')`,
    ),
    check('canonical_processing_issues_occurrence_check', sql`occurrence_count > 0`),
    check(
      'canonical_processing_issues_details_json_check',
      sql`details_json IS NULL OR json_valid(details_json)`,
    ),
    check(
      'canonical_processing_issues_resolved_utc_check',
      sql`resolved_at_utc IS NULL OR substr(resolved_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_processing_issues_resolution_check',
      sql`status NOT IN ('resolved', 'waived') OR (resolved_at_utc IS NOT NULL AND resolution_code IS NOT NULL)`,
    ),
  ],
);

export const canonicalFinancialBatchAssertions = sqliteTable(
  'canonical_financial_batch_assertions',
  {
    tenantId: text('tenant_id').notNull(),
    operationKey: text('operation_key').notNull(),
    stepKey: text('step_key').notNull(),
    assertionValue: integer('assertion_value').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.operationKey, table.stepKey] }),
    index('idx_canonical_financial_batch_assertions_created').on(table.tenantId, table.createdAtUtc),
    check(
      'canonical_financial_batch_assertions_operation_key_check',
      sql`length(trim(operation_key)) > 0`,
    ),
    check(
      'canonical_financial_batch_assertions_step_key_check',
      sql`length(trim(step_key)) > 0`,
    ),
    check(
      'canonical_financial_batch_assertions_value_check',
      sql`assertion_value = 1`,
    ),
  ],
);

export const canonicalSyncInboxEvents = sqliteTable(
  'canonical_sync_inbox_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    inboxPublicId: text('inbox_public_id').notNull(),
    eventPublicId: text('event_public_id').notNull(),
    protocolVersion: integer('protocol_version').notNull().default(1),
    entityType: text('entity_type').notNull(),
    entityPublicId: text('entity_public_id').notNull(),
    eventType: text('event_type').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    operation: text('operation').notNull(),
    payloadJson: text('payload_json').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    sourceNodePublicId: text('source_node_public_id').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    receivedAtUtc: text('received_at_utc').notNull().default(utcNow),
    appliedAtUtc: text('applied_at_utc'),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
    errorCode: text('error_code'),
    errorHash: text('error_hash'),
    occurredAtUtc: text('occurred_at_utc'),
    claimPublicId: text('claim_public_id'),
    claimOwnerPublicId: text('claim_owner_public_id'),
    claimExpiresAtUtc: text('claim_expires_at_utc'),
    nextAttemptAtUtc: text('next_attempt_at_utc'),
  },
  (table) => [
    uniqueIndex('uq_canonical_sync_inbox_public_id').on(table.tenantId, table.inboxPublicId),
    uniqueIndex('uq_canonical_sync_inbox_event').on(table.tenantId, table.eventPublicId),
    uniqueIndex('uq_canonical_sync_inbox_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_canonical_sync_inbox_pending').on(
      table.tenantId,
      table.status,
      table.receivedAtUtc,
      table.eventPublicId,
    ),
    index('idx_canonical_sync_inbox_claimable').on(
      table.tenantId,
      table.status,
      table.nextAttemptAtUtc,
      table.claimExpiresAtUtc,
      table.receivedAtUtc,
      table.eventPublicId,
    ),
    check(
      'canonical_sync_inbox_public_id_check',
      sql`length(trim(inbox_public_id)) BETWEEN 1 AND 160 AND inbox_public_id GLOB '*[^0-9]*'`,
    ),
    check(
      'canonical_sync_inbox_event_public_id_check',
      sql`length(trim(event_public_id)) BETWEEN 1 AND 160 AND event_public_id GLOB '*[^0-9]*'`,
    ),
    check(
      'canonical_sync_inbox_entity_public_id_check',
      sql`length(trim(entity_public_id)) BETWEEN 1 AND 192 AND entity_public_id GLOB '*[^0-9]*'`,
    ),
    check('canonical_sync_inbox_protocol_check', sql`protocol_version = 1`),
    check('canonical_sync_inbox_version_check', sql`aggregate_version >= 1`),
    check('canonical_sync_inbox_operation_check', sql`operation IN ('upsert', 'tombstone')`),
    check('canonical_sync_inbox_payload_json_check', sql`json_valid(payload_json)`),
    check(
      'canonical_sync_inbox_status_check',
      sql`status IN ('pending', 'applying', 'applied', 'conflict', 'retry', 'dead_letter')`,
    ),
    check('canonical_sync_inbox_attempt_check', sql`attempt_count >= 0`),
    check(
      'canonical_sync_inbox_payload_hash_check',
      sql`length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'canonical_sync_inbox_idempotency_check',
      sql`length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'canonical_sync_inbox_source_node_check',
      sql`length(trim(source_node_public_id)) BETWEEN 1 AND 192 AND source_node_public_id GLOB '*[^0-9]*'`,
    ),
    check(
      'canonical_sync_inbox_received_utc_check',
      sql`length(trim(received_at_utc)) >= 20 AND substr(received_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_sync_inbox_applied_utc_check',
      sql`applied_at_utc IS NULL OR substr(applied_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_sync_inbox_updated_utc_check',
      sql`length(trim(updated_at_utc)) >= 20 AND substr(updated_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_sync_inbox_error_hash_check',
      sql`error_hash IS NULL OR (length(error_hash) = 64 AND error_hash NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      'canonical_sync_inbox_claim_public_id_check',
      sql`claim_public_id IS NULL OR (length(trim(claim_public_id)) BETWEEN 1 AND 160 AND claim_public_id GLOB '*[^0-9]*')`,
    ),
    check(
      'canonical_sync_inbox_claim_owner_check',
      sql`claim_owner_public_id IS NULL OR (length(trim(claim_owner_public_id)) BETWEEN 1 AND 192 AND claim_owner_public_id GLOB '*[^0-9]*')`,
    ),
    check(
      'canonical_sync_inbox_claim_expiry_check',
      sql`claim_expires_at_utc IS NULL OR substr(claim_expires_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_sync_inbox_next_attempt_check',
      sql`next_attempt_at_utc IS NULL OR substr(next_attempt_at_utc, -1) = 'Z'`,
    ),
  ],
);

export const canonicalSyncInboxDependencies = sqliteTable(
  'canonical_sync_inbox_dependencies',
  {
    tenantId: text('tenant_id').notNull(),
    inboxEventPublicId: text('inbox_event_public_id').notNull(),
    dependencyEntityType: text('dependency_entity_type').notNull(),
    dependencyEntityPublicId: text('dependency_entity_public_id').notNull(),
    minimumVersion: integer('minimum_version').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.tenantId,
        table.inboxEventPublicId,
        table.dependencyEntityType,
        table.dependencyEntityPublicId,
      ],
    }),
    foreignKey({
      name: 'fk_canonical_sync_dependencies_inbox',
      columns: [table.tenantId, table.inboxEventPublicId],
      foreignColumns: [canonicalSyncInboxEvents.tenantId, canonicalSyncInboxEvents.eventPublicId],
    }).onDelete('cascade'),
    index('idx_canonical_sync_dependency_lookup').on(
      table.tenantId,
      table.dependencyEntityType,
      table.dependencyEntityPublicId,
      table.minimumVersion,
    ),
    check(
      'canonical_sync_dependency_entity_public_id_check',
      sql`length(trim(dependency_entity_public_id)) BETWEEN 1 AND 192 AND dependency_entity_public_id GLOB '*[^0-9]*'`,
    ),
    check('canonical_sync_dependency_version_check', sql`minimum_version >= 1`),
  ],
);

export const canonicalSyncEntityVersions = sqliteTable(
  'canonical_sync_entity_versions',
  {
    tenantId: text('tenant_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityPublicId: text('entity_public_id').notNull(),
    appliedVersion: integer('applied_version').notNull().default(0),
    lastEventPublicId: text('last_event_public_id'),
    lastOperation: text('last_operation'),
    lastPayloadSha256: text('last_payload_sha256'),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.entityType, table.entityPublicId] }),
    check(
      'canonical_sync_entity_public_id_check',
      sql`length(trim(entity_public_id)) BETWEEN 1 AND 192 AND entity_public_id GLOB '*[^0-9]*'`,
    ),
    check('canonical_sync_entity_version_check', sql`applied_version >= 0`),
    check(
      'canonical_sync_entity_last_event_check',
      sql`last_event_public_id IS NULL OR (length(trim(last_event_public_id)) BETWEEN 1 AND 160 AND last_event_public_id GLOB '*[^0-9]*')`,
    ),
    check(
      'canonical_sync_entity_operation_check',
      sql`last_operation IS NULL OR last_operation IN ('upsert', 'tombstone')`,
    ),
    check(
      'canonical_sync_entity_payload_hash_check',
      sql`last_payload_sha256 IS NULL OR (length(last_payload_sha256) = 64 AND last_payload_sha256 NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      'canonical_sync_entity_updated_utc_check',
      sql`length(trim(updated_at_utc)) >= 20 AND substr(updated_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_sync_entity_evidence_check',
      sql`(applied_version = 0 AND last_event_public_id IS NULL AND last_operation IS NULL AND last_payload_sha256 IS NULL) OR (applied_version >= 1 AND last_event_public_id IS NOT NULL AND last_operation IS NOT NULL AND last_payload_sha256 IS NOT NULL)`,
    ),
  ],
);

export const canonicalSyncBatchAssertions = sqliteTable(
  'canonical_sync_batch_assertions',
  {
    tenantId: text('tenant_id').notNull(),
    operationKey: text('operation_key').notNull(),
    stepKey: text('step_key').notNull(),
    assertionValue: integer('assertion_value').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.operationKey, table.stepKey] }),
    check('canonical_sync_batch_assertion_check', sql`assertion_value = 1`),
    check(
      'canonical_sync_batch_assertion_utc_check',
      sql`length(trim(created_at_utc)) >= 20 AND substr(created_at_utc, -1) = 'Z'`,
    ),
  ],
);

export const canonicalFeatureFlags = sqliteTable(
  'canonical_feature_flags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    flagKey: text('flag_key').notNull(),
    domain: text('domain').notNull(),
    mode: text('mode').notNull().default('legacy'),
    isEnabled: integer('is_enabled').notNull().default(0),
    version: integer('version').notNull().default(1),
    configJson: text('config_json'),
    effectiveAtUtc: text('effective_at_utc'),
    expiresAtUtc: text('expires_at_utc'),
    updatedByPublicId: text('updated_by_public_id'),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_feature_flags_key').on(table.tenantId, table.flagKey),
    index('idx_canonical_feature_flags_domain').on(table.tenantId, table.domain, table.mode, table.isEnabled),
    check(
      'canonical_feature_flags_mode_check',
      sql`mode IN ('legacy', 'shadow', 'canonical', 'disabled')`,
    ),
    check('canonical_feature_flags_enabled_check', sql`is_enabled IN (0, 1)`),
    check('canonical_feature_flags_version_check', sql`version > 0`),
    check('canonical_feature_flags_disabled_check', sql`mode != 'disabled' OR is_enabled = 0`),
    check(
      'canonical_feature_flags_config_json_check',
      sql`config_json IS NULL OR json_valid(config_json)`,
    ),
    check(
      'canonical_feature_flags_effective_utc_check',
      sql`effective_at_utc IS NULL OR substr(effective_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_feature_flags_expires_utc_check',
      sql`expires_at_utc IS NULL OR substr(expires_at_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_feature_flags_window_check',
      sql`expires_at_utc IS NULL OR effective_at_utc IS NULL OR expires_at_utc >= effective_at_utc`,
    ),
  ],
);

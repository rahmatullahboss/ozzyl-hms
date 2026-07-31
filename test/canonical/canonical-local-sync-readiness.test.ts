import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCanonicalLocalSyncReadiness,
  type CanonicalSyncReadinessReason,
} from '../../scripts/canonical/check-canonical-local-sync-readiness';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hms-canonical-sync-readiness-'));
  roots.push(root);
  return root;
}

function write(root: string, path: string, content: string): void {
  const fullPath = join(root, path);
  mkdirSync(fullPath.slice(0, fullPath.lastIndexOf('/')), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function entity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entityType: 'invoice',
    canonicalTable: 'canonical_invoices',
    publicIdColumn: 'invoice_public_id',
    migrationPath: 'migrations/0510_canonical_invoices.sql',
    outboxEvidencePath: 'src/lib/canonical/commands/issue-invoice.ts',
    outboxEvidencePattern: 'canonical.invoice.issued',
    dependencies: [],
    externalDependencies: ['patient_identity'],
    canonicalOutboxProduced: true,
    localCanonicalOutboxConsumption: false,
    cloudCanonicalApply: false,
    localCanonicalApply: false,
    versionConflictPolicy: false,
    terminalSemanticsPolicy: 'tombstone',
    terminalSemanticsVerified: false,
    terminalSemanticsEvidencePath: 'src/lib/canonical/commands/issue-invoice.ts',
    terminalSemanticsEvidencePattern: 'canonical.invoice.cancelled',
    tombstoneSupport: false,
    dependencyOrdering: false,
    blocker: 'Canonical local sync transport is incomplete.',
    implementationTask: 'CDB-110B',
    ...overrides,
  };
}

function prepareFixture(
  root: string,
  entities: Record<string, unknown>[],
): void {
  write(root, 'docs/database/canonical-local-sync-entity-registry.yaml', `${JSON.stringify({
    version: 2,
    reviewedAtUtc: '2026-07-24T23:05:00Z',
    activationAuthorized: false,
    activationTask: 'CDB-110Z',
    protocolFoundation: {
      status: 'verified_offline',
      schemaMigration: 'migrations/0541_canonical_local_sync_protocol.sql',
      envelopeModule: 'src/lib/canonical/local-sync-protocol.ts',
      schemaTest: 'test/canonical/canonical-local-sync-protocol-schema.test.ts',
      protocolTest: 'test/canonical/canonical-local-sync-protocol.test.ts',
      inboxLifecycleStatus: 'verified_offline',
      inboxLifecycleMigration: 'migrations/0542_canonical_sync_inbox_lifecycle.sql',
      inboxLifecycleModule: 'src/lib/canonical/local-sync-inbox.ts',
      inboxLifecycleSchemaTest: 'test/canonical/canonical-sync-inbox-lifecycle-schema.test.ts',
      inboxLifecycleTest: 'test/canonical/canonical-sync-inbox.test.ts',
      outboxConversionStatus: 'verified_offline',
      outboxConversionModule: 'src/lib/canonical/local-sync-outbox-converter.ts',
      outboxConversionTest: 'test/canonical/canonical-sync-outbox-converter.test.ts',
      businessApplyStatus: 'verified_offline',
      businessApplyModule: 'src/lib/canonical/local-sync-business-apply.ts',
      businessApplyTest: 'test/canonical/canonical-sync-business-apply.test.ts',
      businessCompletionTest: 'test/canonical/canonical-sync-business-completion.test.ts',
      sourceOutboxLifecycleStatus: 'verified_offline',
      sourceOutboxLifecycleMigration: 'migrations/0543_canonical_sync_outbox_lifecycle.sql',
      sourceOutboxLifecycleModule: 'src/lib/canonical/local-sync-outbox-lifecycle.ts',
      sourceOutboxLifecycleTest: 'test/canonical/canonical-sync-outbox-lifecycle.test.ts',
      offlineDeliveryOrchestrationStatus: 'verified_offline',
      offlineDeliveryModule: 'src/lib/canonical/local-sync-delivery.ts',
      offlineOrchestrationModule: 'src/lib/canonical/local-sync-orchestrator.ts',
      offlineOrchestrationTest: 'test/canonical/canonical-sync-offline-orchestration.test.ts',
      disconnectedMultiEventRehearsalStatus: 'verified_offline',
      disconnectedMultiEventRehearsalModule: 'src/lib/canonical/local-sync-rehearsal.ts',
      disconnectedMultiEventRehearsalTest: 'test/canonical/canonical-sync-offline-rehearsal.test.ts',
      terminalSemanticsPolicyStatus: 'reviewed_offline',
      terminalSemanticsDesign: 'docs/superpowers/specs/2026-07-25-cdb-110i-canonical-terminal-semantics-policy-design.md',
      terminalSemanticsTest: 'test/canonical/canonical-local-sync-readiness.test.ts',
      localOutboxConsumerContractStatus: 'verified_offline',
      localOutboxConsumerModule: 'src/lib/canonical/local-sync-consumer.ts',
      localOutboxConsumerTest: 'test/canonical/canonical-sync-local-outbox-consumer.test.ts',
      localOutboxConsumerRuntimeIsolationTest: 'test/canonical/canonical-sync-local-outbox-consumer-runtime-isolation.test.ts',
      networkDeliveryAdapterContractStatus: 'verified_offline',
      networkDeliveryAdapterModule: 'src/lib/canonical/local-sync-network-delivery.ts',
      networkDeliveryAdapterTest: 'test/canonical/canonical-sync-network-delivery.test.ts',
      networkDeliveryAdapterRuntimeIsolationTest: 'test/canonical/canonical-sync-network-delivery-runtime-isolation.test.ts',
      networkAuthenticationEvidenceContractStatus: 'verified_offline',
      networkAuthenticationEvidenceModule: 'src/lib/canonical/local-sync-network-auth.ts',
      networkAuthenticationEvidenceTest: 'test/canonical/canonical-sync-network-auth.test.ts',
      networkAuthenticationEvidenceRuntimeIsolationTest: 'test/canonical/canonical-sync-network-auth-runtime-isolation.test.ts',
      runtimeConsumptionConnected: false,
      businessApplyConnected: false,
    },
    entities,
  }, null, 2)}\n`);
  write(root, 'migrations/0541_canonical_local_sync_protocol.sql', 'CREATE TABLE canonical_sync_inbox_events (id INTEGER);');
  write(root, 'src/lib/canonical/local-sync-protocol.ts', 'export const protocolVersion = 1;');
  write(root, 'test/canonical/canonical-local-sync-protocol-schema.test.ts', 'export {};');
  write(root, 'test/canonical/canonical-local-sync-protocol.test.ts', 'export {};');
  write(root, 'migrations/0542_canonical_sync_inbox_lifecycle.sql', 'ALTER TABLE canonical_sync_inbox_events ADD COLUMN claim_public_id TEXT;');
  write(root, 'src/lib/canonical/local-sync-inbox.ts', 'export const inboxLifecycle = true;');
  write(root, 'test/canonical/canonical-sync-inbox-lifecycle-schema.test.ts', 'export {};');
  write(root, 'test/canonical/canonical-sync-inbox.test.ts', 'export {};');
  write(root, 'src/lib/canonical/local-sync-outbox-converter.ts', 'export const converter = true;');
  write(root, 'test/canonical/canonical-sync-outbox-converter.test.ts', 'export {};');
  write(root, 'src/lib/canonical/local-sync-business-apply.ts', 'export const businessApply = true;');
  write(root, 'test/canonical/canonical-sync-business-apply.test.ts', 'export {};');
  write(root, 'test/canonical/canonical-sync-business-completion.test.ts', 'export {};');
  write(root, 'migrations/0543_canonical_sync_outbox_lifecycle.sql', 'ALTER TABLE canonical_outbox_events ADD COLUMN claim_public_id TEXT;');
  write(root, 'src/lib/canonical/local-sync-outbox-lifecycle.ts', 'export const sourceOutboxLifecycle = true;');
  write(root, 'test/canonical/canonical-sync-outbox-lifecycle.test.ts', 'export {};');
  write(root, 'src/lib/canonical/local-sync-delivery.ts', 'export const offlineDelivery = true;');
  write(root, 'src/lib/canonical/local-sync-orchestrator.ts', 'export const offlineOrchestration = true;');
  write(root, 'test/canonical/canonical-sync-offline-orchestration.test.ts', 'export {};');
  write(root, 'src/lib/canonical/local-sync-rehearsal.ts', 'export const disconnectedRehearsal = true;');
  write(root, 'test/canonical/canonical-sync-offline-rehearsal.test.ts', 'export {};');
  write(root, 'docs/superpowers/specs/2026-07-25-cdb-110i-canonical-terminal-semantics-policy-design.md', 'terminal semantics policy');
  write(root, 'test/canonical/canonical-local-sync-readiness.test.ts', 'export {};');
  write(root, 'src/lib/canonical/local-sync-consumer.ts', 'export const localOutboxConsumer = true;');
  write(root, 'test/canonical/canonical-sync-local-outbox-consumer.test.ts', 'export {};');
  write(root, 'test/canonical/canonical-sync-local-outbox-consumer-runtime-isolation.test.ts', 'export {};');
  write(root, 'src/lib/canonical/local-sync-network-delivery.ts', 'export const networkDelivery = true;');
  write(root, 'test/canonical/canonical-sync-network-delivery.test.ts', 'export {};');
  write(root, 'test/canonical/canonical-sync-network-delivery-runtime-isolation.test.ts', 'export {};');
  write(root, 'src/lib/canonical/local-sync-network-auth.ts', 'export const networkAuthenticationEvidence = true;');
  write(root, 'test/canonical/canonical-sync-network-auth.test.ts', 'export {};');
  write(root, 'test/canonical/canonical-sync-network-auth-runtime-isolation.test.ts', 'export {};');
  write(root, 'migrations/0510_canonical_invoices.sql', `
    CREATE TABLE IF NOT EXISTS canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL
    );
  `);
  write(root, 'src/lib/canonical/commands/issue-invoice.ts', `
    const eventType = 'canonical.invoice.issued';
    const cancellationEventType = 'canonical.invoice.cancelled';
  `);
  write(root, 'src/routes/sync.ts', `
    const syncEventSchema = z.object({ entityId: z.string() });
    SELECT * FROM legacy_table;
    INSERT OR REPLACE INTO legacy_table (id) VALUES (?);
  `);
  write(root, 'src/lib/local-sync-coverage.ts', `
    export const LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS = ['bills', 'payments'];
    export const LOCAL_SERVER_CORE_OUTBOX_GAPS = ['bills', 'invoice_items', 'payments'];
  `);
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('canonical local sync readiness', () => {
  it('blocks an entity with stable readiness reasons and audits legacy transport patterns', () => {
    const root = createRoot();
    prepareFixture(root, [entity()]);

    const result = buildCanonicalLocalSyncReadiness(root);
    expect(result.entityCount).toBe(1);
    expect(result.readyEntityCount).toBe(0);
    expect(result.blockedEntityCount).toBe(1);
    expect(result.blockedEntities).toEqual([{
      entityType: 'invoice',
      reasons: [
        'LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING',
        'CLOUD_CANONICAL_APPLY_MISSING',
        'LOCAL_CANONICAL_APPLY_MISSING',
        'VERSION_CONFLICT_POLICY_MISSING',
        'TOMBSTONE_SUPPORT_MISSING',
        'TERMINAL_SEMANTICS_MISSING',
        'DEPENDENCY_ORDERING_MISSING',
      ] satisfies CanonicalSyncReadinessReason[],
    }]);
    expect(result.protocolFoundation).toEqual({
      status: 'verified_offline',
      inboxLifecycleStatus: 'verified_offline',
      outboxConversionStatus: 'verified_offline',
      businessApplyStatus: 'verified_offline',
      sourceOutboxLifecycleStatus: 'verified_offline',
      offlineDeliveryOrchestrationStatus: 'verified_offline',
      disconnectedMultiEventRehearsalStatus: 'verified_offline',
      terminalSemanticsPolicyStatus: 'reviewed_offline',
      localOutboxConsumerContractStatus: 'verified_offline',
      networkDeliveryAdapterContractStatus: 'verified_offline',
      networkAuthenticationEvidenceContractStatus: 'verified_offline',
      runtimeConsumptionConnected: false,
      businessApplyConnected: false,
    });
    expect(result.auditedLegacyBlockers).toEqual({
      genericEntityIdTransportPresent: true,
      legacySnapshotSelectAllPresent: true,
      legacySnapshotReplaceApplyPresent: true,
      declaredCoreOutboxGapCount: 3,
      declaredEntityMappingGapCount: 2,
    });
  });

  it('marks an entity ready only when every readiness dimension is true and blocker is empty', () => {
    const root = createRoot();
    prepareFixture(root, [entity({
      localCanonicalOutboxConsumption: true,
      cloudCanonicalApply: true,
      localCanonicalApply: true,
      versionConflictPolicy: true,
      terminalSemanticsVerified: true,
      tombstoneSupport: true,
      dependencyOrdering: true,
      blocker: '',
    })]);

    const result = buildCanonicalLocalSyncReadiness(root);
    expect(result.readyEntityCount).toBe(1);
    expect(result.blockedEntityCount).toBe(0);
    expect(result.readyEntities).toEqual(['invoice']);
  });

  it('accepts verified lifecycle-state and append-only reversal semantics without tombstone support', () => {
    for (const terminalSemanticsPolicy of ['lifecycle_state', 'append_only_reversal'] as const) {
      const root = createRoot();
      prepareFixture(root, [entity({
        localCanonicalOutboxConsumption: true,
        cloudCanonicalApply: true,
        localCanonicalApply: true,
        versionConflictPolicy: true,
        terminalSemanticsPolicy,
        terminalSemanticsVerified: true,
        tombstoneSupport: false,
        dependencyOrdering: true,
        blocker: '',
      })]);

      const result = buildCanonicalLocalSyncReadiness(root);
      expect(result.readyEntities).toEqual(['invoice']);
      expect(result.blockedEntities).toEqual([]);
    }
  });

  it('uses terminal-semantics reasons and rejects contradictory policies or missing evidence', () => {
    const incompleteRoot = createRoot();
    prepareFixture(incompleteRoot, [entity({
      terminalSemanticsPolicy: 'lifecycle_state',
      terminalSemanticsVerified: false,
    })]);
    expect(buildCanonicalLocalSyncReadiness(incompleteRoot).blockedEntities[0].reasons)
      .toContain('TERMINAL_SEMANTICS_MISSING');
    expect(buildCanonicalLocalSyncReadiness(incompleteRoot).blockedEntities[0].reasons)
      .not.toContain('TOMBSTONE_SUPPORT_MISSING');

    const appendOnlyRoot = createRoot();
    prepareFixture(appendOnlyRoot, [entity({
      terminalSemanticsPolicy: 'append_only_reversal',
      terminalSemanticsVerified: true,
      tombstoneSupport: true,
    })]);
    expect(() => buildCanonicalLocalSyncReadiness(appendOnlyRoot)).toThrow(/append-only reversal.*tombstone/i);

    const tombstoneRoot = createRoot();
    prepareFixture(tombstoneRoot, [entity({ terminalSemanticsVerified: true, tombstoneSupport: false })]);
    expect(() => buildCanonicalLocalSyncReadiness(tombstoneRoot)).toThrow(/verified tombstone.*support/i);

    const unknownRoot = createRoot();
    prepareFixture(unknownRoot, [entity({ terminalSemanticsPolicy: 'delete_row' })]);
    expect(() => buildCanonicalLocalSyncReadiness(unknownRoot)).toThrow(/terminal semantics policy/i);

    const evidenceRoot = createRoot();
    prepareFixture(evidenceRoot, [entity({ terminalSemanticsEvidencePattern: 'missing-terminal-pattern' })]);
    expect(() => buildCanonicalLocalSyncReadiness(evidenceRoot)).toThrow(/terminal semantics evidence/i);

    const consumerEvidenceRoot = createRoot();
    prepareFixture(consumerEvidenceRoot, [entity()]);
    rmSync(join(consumerEvidenceRoot, 'src/lib/canonical/local-sync-consumer.ts'));
    expect(() => buildCanonicalLocalSyncReadiness(consumerEvidenceRoot))
      .toThrow(/local outbox consumer module/i);

    const networkEvidenceRoot = createRoot();
    prepareFixture(networkEvidenceRoot, [entity()]);
    rmSync(join(networkEvidenceRoot, 'src/lib/canonical/local-sync-network-delivery.ts'));
    expect(() => buildCanonicalLocalSyncReadiness(networkEvidenceRoot))
      .toThrow(/network delivery adapter module/i);

    const authenticationEvidenceRoot = createRoot();
    prepareFixture(authenticationEvidenceRoot, [entity()]);
    rmSync(join(authenticationEvidenceRoot, 'src/lib/canonical/local-sync-network-auth.ts'));
    expect(() => buildCanonicalLocalSyncReadiness(authenticationEvidenceRoot))
      .toThrow(/network authentication evidence module/i);
  });

  it('rejects missing canonical table or public-ID migration evidence', () => {
    const root = createRoot();
    prepareFixture(root, [entity({ publicIdColumn: 'missing_public_id' })]);

    expect(() => buildCanonicalLocalSyncReadiness(root)).toThrow(/public-id migration evidence/i);
  });

  it('rejects duplicate entity types and unknown internal dependencies', () => {
    const duplicateRoot = createRoot();
    prepareFixture(duplicateRoot, [entity(), entity()]);
    expect(() => buildCanonicalLocalSyncReadiness(duplicateRoot)).toThrow(/unique entityType/i);

    const dependencyRoot = createRoot();
    prepareFixture(dependencyRoot, [entity({ dependencies: ['missing_entity'] })]);
    expect(() => buildCanonicalLocalSyncReadiness(dependencyRoot)).toThrow(/unknown canonical sync dependency/i);
  });

  it('reports the real repository as eight blocked and zero ready entities', () => {
    const result = buildCanonicalLocalSyncReadiness(process.cwd());
    expect(result.entityCount).toBe(8);
    expect(result.readyEntityCount).toBe(0);
    expect(result.blockedEntityCount).toBe(8);
    expect(result.readyEntities).toEqual([]);
    expect(result.blockedEntities.map((entry) => entry.entityType)).toEqual([
      'compensation_accrual',
      'deposit',
      'encounter',
      'inventory_movement',
      'invoice',
      'payment_receipt',
      'service_event',
      'service_request',
    ]);
    const terminalGaps = result.blockedEntities
      .filter((entry) => entry.reasons.includes('TERMINAL_SEMANTICS_MISSING'))
      .map((entry) => entry.entityType);
    expect(terminalGaps).toEqual([]);
    expect(result.blockedEntities.every((entry) => !entry.reasons.includes('TOMBSTONE_SUPPORT_MISSING'))).toBe(true);
    expect(result.blockedEntities.every((entry) => (
      entry.reasons.length === 1
      && entry.reasons[0] === 'LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING'
    ))).toBe(true);
    expect(result.protocolFoundation.terminalSemanticsPolicyStatus).toBe('reviewed_offline');
    expect(result.protocolFoundation.localOutboxConsumerContractStatus).toBe('verified_offline');
    expect(result.protocolFoundation.networkDeliveryAdapterContractStatus).toBe('verified_offline');
    expect(result.protocolFoundation.networkAuthenticationEvidenceContractStatus).toBe('verified_offline');
    expect(result.protocolFoundation.runtimeConsumptionConnected).toBe(false);
    expect(result.auditedLegacyBlockers).toEqual({
      genericEntityIdTransportPresent: true,
      legacySnapshotSelectAllPresent: true,
      legacySnapshotReplaceApplyPresent: true,
      declaredCoreOutboxGapCount: 8,
      declaredEntityMappingGapCount: 7,
    });
  });
});

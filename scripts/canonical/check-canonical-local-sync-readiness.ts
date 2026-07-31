import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type CanonicalSyncReadinessReason =
  | 'CANONICAL_OUTBOX_PRODUCTION_MISSING'
  | 'LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING'
  | 'CLOUD_CANONICAL_APPLY_MISSING'
  | 'LOCAL_CANONICAL_APPLY_MISSING'
  | 'VERSION_CONFLICT_POLICY_MISSING'
  | 'TOMBSTONE_SUPPORT_MISSING'
  | 'TERMINAL_SEMANTICS_MISSING'
  | 'DEPENDENCY_ORDERING_MISSING';

export type CanonicalTerminalSemanticsPolicy =
  | 'tombstone'
  | 'lifecycle_state'
  | 'append_only_reversal';

interface CanonicalSyncEntityEntry {
  entityType: string;
  canonicalTable: string;
  publicIdColumn: string;
  migrationPath: string;
  outboxEvidencePath: string;
  outboxEvidencePattern: string;
  dependencies: string[];
  externalDependencies: string[];
  canonicalOutboxProduced: boolean;
  localCanonicalOutboxConsumption: boolean;
  cloudCanonicalApply: boolean;
  localCanonicalApply: boolean;
  versionConflictPolicy: boolean;
  terminalSemanticsPolicy: CanonicalTerminalSemanticsPolicy;
  terminalSemanticsVerified: boolean;
  terminalSemanticsEvidencePath: string;
  terminalSemanticsEvidencePattern: string;
  tombstoneSupport: boolean;
  dependencyOrdering: boolean;
  blocker: string;
  implementationTask: string;
}

interface CanonicalSyncProtocolFoundation {
  status: 'verified_offline';
  schemaMigration: string;
  envelopeModule: string;
  schemaTest: string;
  protocolTest: string;
  inboxLifecycleStatus: 'verified_offline';
  inboxLifecycleMigration: string;
  inboxLifecycleModule: string;
  inboxLifecycleSchemaTest: string;
  inboxLifecycleTest: string;
  outboxConversionStatus: 'verified_offline';
  outboxConversionModule: string;
  outboxConversionTest: string;
  businessApplyStatus: 'verified_offline';
  businessApplyModule: string;
  businessApplyTest: string;
  businessCompletionTest: string;
  sourceOutboxLifecycleStatus: 'verified_offline';
  sourceOutboxLifecycleMigration: string;
  sourceOutboxLifecycleModule: string;
  sourceOutboxLifecycleTest: string;
  offlineDeliveryOrchestrationStatus: 'verified_offline';
  offlineDeliveryModule: string;
  offlineOrchestrationModule: string;
  offlineOrchestrationTest: string;
  disconnectedMultiEventRehearsalStatus: 'verified_offline';
  disconnectedMultiEventRehearsalModule: string;
  disconnectedMultiEventRehearsalTest: string;
  terminalSemanticsPolicyStatus: 'reviewed_offline';
  terminalSemanticsDesign: string;
  terminalSemanticsTest: string;
  localOutboxConsumerContractStatus: 'verified_offline';
  localOutboxConsumerModule: string;
  localOutboxConsumerTest: string;
  localOutboxConsumerRuntimeIsolationTest: string;
  networkDeliveryAdapterContractStatus: 'verified_offline';
  networkDeliveryAdapterModule: string;
  networkDeliveryAdapterTest: string;
  networkDeliveryAdapterRuntimeIsolationTest: string;
  networkAuthenticationEvidenceContractStatus: 'verified_offline';
  networkAuthenticationEvidenceModule: string;
  networkAuthenticationEvidenceTest: string;
  networkAuthenticationEvidenceRuntimeIsolationTest: string;
  runtimeConsumptionConnected: boolean;
  businessApplyConnected: boolean;
}

interface CanonicalSyncRegistry {
  version: number;
  reviewedAtUtc: string;
  activationAuthorized: boolean;
  activationTask: string;
  protocolFoundation: CanonicalSyncProtocolFoundation;
  entities: CanonicalSyncEntityEntry[];
}

export interface CanonicalLocalSyncReadiness {
  entityCount: number;
  readyEntityCount: number;
  blockedEntityCount: number;
  protocolFoundation: {
    status: 'verified_offline';
    inboxLifecycleStatus: 'verified_offline';
    outboxConversionStatus: 'verified_offline';
    businessApplyStatus: 'verified_offline';
    sourceOutboxLifecycleStatus: 'verified_offline';
    offlineDeliveryOrchestrationStatus: 'verified_offline';
    disconnectedMultiEventRehearsalStatus: 'verified_offline';
    terminalSemanticsPolicyStatus: 'reviewed_offline';
    localOutboxConsumerContractStatus: 'verified_offline';
    networkDeliveryAdapterContractStatus: 'verified_offline';
    networkAuthenticationEvidenceContractStatus: 'verified_offline';
    runtimeConsumptionConnected: boolean;
    businessApplyConnected: boolean;
  };
  readyEntities: string[];
  blockedEntities: Array<{
    entityType: string;
    reasons: CanonicalSyncReadinessReason[];
  }>;
  auditedLegacyBlockers: {
    genericEntityIdTransportPresent: boolean;
    legacySnapshotSelectAllPresent: boolean;
    legacySnapshotReplaceApplyPresent: boolean;
    declaredCoreOutboxGapCount: number;
    declaredEntityMappingGapCount: number;
  };
}

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const EXTERNAL_DEPENDENCIES = new Set([
  'patient_identity',
  'service_catalog',
  'practitioner',
  'inventory_item',
  'inventory_location',
]);
const TERMINAL_SEMANTICS_POLICIES = new Set<CanonicalTerminalSemanticsPolicy>([
  'tombstone',
  'lifecycle_state',
  'append_only_reversal',
]);
const BOOLEAN_FIELDS = [
  'canonicalOutboxProduced',
  'localCanonicalOutboxConsumption',
  'cloudCanonicalApply',
  'localCanonicalApply',
  'versionConflictPolicy',
  'terminalSemanticsVerified',
  'tombstoneSupport',
  'dependencyOrdering',
] as const;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readText(root: string, path: string, label: string): string {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseRegistry(root: string): CanonicalSyncRegistry {
  const path = 'docs/database/canonical-local-sync-entity-registry.yaml';
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(root, path, 'canonical local-sync registry'));
  } catch (error) {
    throw new Error(`Invalid canonical local-sync registry: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid canonical local-sync registry metadata.');
  const registry = parsed as Partial<CanonicalSyncRegistry>;
  const foundation = registry.protocolFoundation;
  if (registry.version !== 2
    || !UTC_TIMESTAMP_PATTERN.test(registry.reviewedAtUtc ?? '')
    || typeof registry.activationAuthorized !== 'boolean'
    || !nonEmpty(registry.activationTask)
    || !foundation
    || foundation.status !== 'verified_offline'
    || !nonEmpty(foundation.schemaMigration)
    || !nonEmpty(foundation.envelopeModule)
    || !nonEmpty(foundation.schemaTest)
    || !nonEmpty(foundation.protocolTest)
    || foundation.inboxLifecycleStatus !== 'verified_offline'
    || !nonEmpty(foundation.inboxLifecycleMigration)
    || !nonEmpty(foundation.inboxLifecycleModule)
    || !nonEmpty(foundation.inboxLifecycleSchemaTest)
    || !nonEmpty(foundation.inboxLifecycleTest)
    || foundation.outboxConversionStatus !== 'verified_offline'
    || !nonEmpty(foundation.outboxConversionModule)
    || !nonEmpty(foundation.outboxConversionTest)
    || foundation.businessApplyStatus !== 'verified_offline'
    || !nonEmpty(foundation.businessApplyModule)
    || !nonEmpty(foundation.businessApplyTest)
    || !nonEmpty(foundation.businessCompletionTest)
    || foundation.sourceOutboxLifecycleStatus !== 'verified_offline'
    || !nonEmpty(foundation.sourceOutboxLifecycleMigration)
    || !nonEmpty(foundation.sourceOutboxLifecycleModule)
    || !nonEmpty(foundation.sourceOutboxLifecycleTest)
    || foundation.offlineDeliveryOrchestrationStatus !== 'verified_offline'
    || !nonEmpty(foundation.offlineDeliveryModule)
    || !nonEmpty(foundation.offlineOrchestrationModule)
    || !nonEmpty(foundation.offlineOrchestrationTest)
    || foundation.disconnectedMultiEventRehearsalStatus !== 'verified_offline'
    || !nonEmpty(foundation.disconnectedMultiEventRehearsalModule)
    || !nonEmpty(foundation.disconnectedMultiEventRehearsalTest)
    || foundation.terminalSemanticsPolicyStatus !== 'reviewed_offline'
    || !nonEmpty(foundation.terminalSemanticsDesign)
    || !nonEmpty(foundation.terminalSemanticsTest)
    || foundation.localOutboxConsumerContractStatus !== 'verified_offline'
    || !nonEmpty(foundation.localOutboxConsumerModule)
    || !nonEmpty(foundation.localOutboxConsumerTest)
    || !nonEmpty(foundation.localOutboxConsumerRuntimeIsolationTest)
    || foundation.networkDeliveryAdapterContractStatus !== 'verified_offline'
    || !nonEmpty(foundation.networkDeliveryAdapterModule)
    || !nonEmpty(foundation.networkDeliveryAdapterTest)
    || !nonEmpty(foundation.networkDeliveryAdapterRuntimeIsolationTest)
    || foundation.networkAuthenticationEvidenceContractStatus !== 'verified_offline'
    || !nonEmpty(foundation.networkAuthenticationEvidenceModule)
    || !nonEmpty(foundation.networkAuthenticationEvidenceTest)
    || !nonEmpty(foundation.networkAuthenticationEvidenceRuntimeIsolationTest)
    || typeof foundation.runtimeConsumptionConnected !== 'boolean'
    || typeof foundation.businessApplyConnected !== 'boolean'
    || !Array.isArray(registry.entities)
    || registry.entities.length === 0) {
    throw new Error('Invalid canonical local-sync registry metadata.');
  }
  for (const [evidencePath, label] of [
    [foundation.schemaMigration, 'protocol schema migration'],
    [foundation.envelopeModule, 'protocol envelope module'],
    [foundation.schemaTest, 'protocol schema test'],
    [foundation.protocolTest, 'protocol logic test'],
    [foundation.inboxLifecycleMigration, 'inbox lifecycle migration'],
    [foundation.inboxLifecycleModule, 'inbox lifecycle module'],
    [foundation.inboxLifecycleSchemaTest, 'inbox lifecycle schema test'],
    [foundation.inboxLifecycleTest, 'inbox lifecycle logic test'],
    [foundation.outboxConversionModule, 'outbox conversion module'],
    [foundation.outboxConversionTest, 'outbox conversion test'],
    [foundation.businessApplyModule, 'business apply module'],
    [foundation.businessApplyTest, 'business apply test'],
    [foundation.businessCompletionTest, 'business completion test'],
    [foundation.sourceOutboxLifecycleMigration, 'source outbox lifecycle migration'],
    [foundation.sourceOutboxLifecycleModule, 'source outbox lifecycle module'],
    [foundation.sourceOutboxLifecycleTest, 'source outbox lifecycle test'],
    [foundation.offlineDeliveryModule, 'offline delivery module'],
    [foundation.offlineOrchestrationModule, 'offline orchestration module'],
    [foundation.offlineOrchestrationTest, 'offline orchestration test'],
    [foundation.disconnectedMultiEventRehearsalModule, 'disconnected multi-event rehearsal module'],
    [foundation.disconnectedMultiEventRehearsalTest, 'disconnected multi-event rehearsal test'],
    [foundation.terminalSemanticsDesign, 'terminal semantics design'],
    [foundation.terminalSemanticsTest, 'terminal semantics test'],
    [foundation.localOutboxConsumerModule, 'local outbox consumer module'],
    [foundation.localOutboxConsumerTest, 'local outbox consumer test'],
    [foundation.localOutboxConsumerRuntimeIsolationTest, 'local outbox consumer runtime-isolation test'],
    [foundation.networkDeliveryAdapterModule, 'network delivery adapter module'],
    [foundation.networkDeliveryAdapterTest, 'network delivery adapter test'],
    [foundation.networkDeliveryAdapterRuntimeIsolationTest, 'network delivery adapter runtime-isolation test'],
    [foundation.networkAuthenticationEvidenceModule, 'network authentication evidence module'],
    [foundation.networkAuthenticationEvidenceTest, 'network authentication evidence test'],
    [foundation.networkAuthenticationEvidenceRuntimeIsolationTest, 'network authentication evidence runtime-isolation test'],
  ] as const) readText(root, evidencePath, label);
  return registry as CanonicalSyncRegistry;
}

function assertMigrationEvidence(root: string, entity: CanonicalSyncEntityEntry): void {
  const migration = readText(root, entity.migrationPath, 'canonical sync migration');
  const tablePattern = new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+[\"\\[]?${entity.canonicalTable}[\"\\]]?\\s*\\(`, 'i');
  const publicIdPattern = new RegExp(`\\b${entity.publicIdColumn}\\b`, 'i');
  if (!tablePattern.test(migration) || !publicIdPattern.test(migration)) {
    throw new Error(`Missing canonical table/public-ID migration evidence for ${entity.entityType}.`);
  }
}

function assertOutboxEvidence(root: string, entity: CanonicalSyncEntityEntry): void {
  if (!entity.canonicalOutboxProduced) return;
  const source = readText(root, entity.outboxEvidencePath, 'canonical outbox evidence');
  if (!source.includes(entity.outboxEvidencePattern)) {
    throw new Error(`Missing canonical outbox production evidence for ${entity.entityType}.`);
  }
}

function assertTerminalSemanticsEvidence(root: string, entity: CanonicalSyncEntityEntry): void {
  const source = readText(root, entity.terminalSemanticsEvidencePath, 'canonical terminal semantics evidence');
  if (!source.includes(entity.terminalSemanticsEvidencePattern)) {
    throw new Error(`Missing terminal semantics evidence for ${entity.entityType}.`);
  }
}

function validateRegistry(root: string, registry: CanonicalSyncRegistry): void {
  const entityTypes = new Set<string>();
  for (const entity of registry.entities) {
    if (!entity || !TERMINAL_SEMANTICS_POLICIES.has(entity.terminalSemanticsPolicy)) {
      throw new Error('Canonical local-sync registry contains an unsupported terminal semantics policy.');
    }
    const invalid = !entity
      || !nonEmpty(entity.entityType)
      || entityTypes.has(entity.entityType)
      || !nonEmpty(entity.canonicalTable)
      || !nonEmpty(entity.publicIdColumn)
      || !nonEmpty(entity.migrationPath)
      || !nonEmpty(entity.outboxEvidencePath)
      || !nonEmpty(entity.outboxEvidencePattern)
      || !Array.isArray(entity.dependencies)
      || !Array.isArray(entity.externalDependencies)
      || entity.dependencies.some((dependency) => !nonEmpty(dependency))
      || entity.externalDependencies.some((dependency) => !nonEmpty(dependency))
      || !nonEmpty(entity.terminalSemanticsEvidencePath)
      || !nonEmpty(entity.terminalSemanticsEvidencePattern)
      || BOOLEAN_FIELDS.some((field) => typeof entity[field] !== 'boolean')
      || !nonEmpty(entity.implementationTask);
    if (invalid) throw new Error('Canonical local-sync registry requires a unique entityType and complete evidence fields.');
    entityTypes.add(entity.entityType);
  }

  for (const entity of registry.entities) {
    if (entity.terminalSemanticsPolicy === 'append_only_reversal' && entity.tombstoneSupport) {
      throw new Error(`Canonical sync entity ${entity.entityType} uses append-only reversal and cannot enable tombstone support.`);
    }
    if (
      entity.terminalSemanticsPolicy === 'tombstone'
      && entity.terminalSemanticsVerified
      && !entity.tombstoneSupport
    ) {
      throw new Error(`Canonical sync entity ${entity.entityType} has verified tombstone semantics without tombstone support.`);
    }
    for (const dependency of entity.dependencies) {
      if (!entityTypes.has(dependency)) {
        throw new Error(`Unknown canonical sync dependency ${dependency} for ${entity.entityType}.`);
      }
      if (dependency === entity.entityType) {
        throw new Error(`Canonical sync entity ${entity.entityType} cannot depend on itself.`);
      }
    }
    for (const dependency of entity.externalDependencies) {
      if (!EXTERNAL_DEPENDENCIES.has(dependency)) {
        throw new Error(`Unknown external canonical sync dependency ${dependency} for ${entity.entityType}.`);
      }
    }
    assertMigrationEvidence(root, entity);
    assertOutboxEvidence(root, entity);
    assertTerminalSemanticsEvidence(root, entity);
  }
}

function reasonsFor(entity: CanonicalSyncEntityEntry): CanonicalSyncReadinessReason[] {
  const reasons: CanonicalSyncReadinessReason[] = [];
  if (!entity.canonicalOutboxProduced) reasons.push('CANONICAL_OUTBOX_PRODUCTION_MISSING');
  if (!entity.localCanonicalOutboxConsumption) reasons.push('LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING');
  if (!entity.cloudCanonicalApply) reasons.push('CLOUD_CANONICAL_APPLY_MISSING');
  if (!entity.localCanonicalApply) reasons.push('LOCAL_CANONICAL_APPLY_MISSING');
  if (!entity.versionConflictPolicy) reasons.push('VERSION_CONFLICT_POLICY_MISSING');
  if (entity.terminalSemanticsPolicy === 'tombstone' && !entity.tombstoneSupport) {
    reasons.push('TOMBSTONE_SUPPORT_MISSING');
  }
  if (!entity.terminalSemanticsVerified) reasons.push('TERMINAL_SEMANTICS_MISSING');
  if (!entity.dependencyOrdering) reasons.push('DEPENDENCY_ORDERING_MISSING');
  return reasons;
}

function countDeclaredArray(source: string, constantName: string): number {
  const match = new RegExp(`${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`, 'm').exec(source)
    ?? new RegExp(`${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm').exec(source);
  if (!match) return 0;
  return [...match[1].matchAll(/['"][^'"]+['"]/g)].length;
}

function auditLegacyTransport(root: string): CanonicalLocalSyncReadiness['auditedLegacyBlockers'] {
  const syncSource = readText(root, 'src/routes/sync.ts', 'legacy sync route');
  const coverageSource = readText(root, 'src/lib/local-sync-coverage.ts', 'legacy sync coverage');
  return {
    genericEntityIdTransportPresent: /entityId\s*:\s*z\.string\s*\(/.test(syncSource),
    legacySnapshotSelectAllPresent: /SELECT\s+\*/i.test(syncSource),
    legacySnapshotReplaceApplyPresent: /INSERT\s+OR\s+REPLACE\s+INTO/i.test(syncSource),
    declaredCoreOutboxGapCount: countDeclaredArray(coverageSource, 'LOCAL_SERVER_CORE_OUTBOX_GAPS'),
    declaredEntityMappingGapCount: countDeclaredArray(coverageSource, 'LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS'),
  };
}

export function buildCanonicalLocalSyncReadiness(root: string): CanonicalLocalSyncReadiness {
  const resolvedRoot = resolve(root);
  const registry = parseRegistry(resolvedRoot);
  validateRegistry(resolvedRoot, registry);

  const readyEntities: string[] = [];
  const blockedEntities: CanonicalLocalSyncReadiness['blockedEntities'] = [];
  for (const entity of registry.entities) {
    const reasons = reasonsFor(entity);
    if (reasons.length === 0) {
      if (entity.blocker.trim().length > 0) {
        throw new Error(`Ready canonical sync entity ${entity.entityType} must not retain a blocker.`);
      }
      readyEntities.push(entity.entityType);
    } else {
      if (!nonEmpty(entity.blocker)) {
        throw new Error(`Blocked canonical sync entity ${entity.entityType} requires a blocker.`);
      }
      blockedEntities.push({ entityType: entity.entityType, reasons });
    }
  }

  readyEntities.sort((left, right) => left.localeCompare(right));
  blockedEntities.sort((left, right) => left.entityType.localeCompare(right.entityType));
  return {
    entityCount: registry.entities.length,
    readyEntityCount: readyEntities.length,
    blockedEntityCount: blockedEntities.length,
    protocolFoundation: {
      status: registry.protocolFoundation.status,
      inboxLifecycleStatus: registry.protocolFoundation.inboxLifecycleStatus,
      outboxConversionStatus: registry.protocolFoundation.outboxConversionStatus,
      businessApplyStatus: registry.protocolFoundation.businessApplyStatus,
      sourceOutboxLifecycleStatus: registry.protocolFoundation.sourceOutboxLifecycleStatus,
      offlineDeliveryOrchestrationStatus: registry.protocolFoundation.offlineDeliveryOrchestrationStatus,
      disconnectedMultiEventRehearsalStatus: registry.protocolFoundation.disconnectedMultiEventRehearsalStatus,
      terminalSemanticsPolicyStatus: registry.protocolFoundation.terminalSemanticsPolicyStatus,
      localOutboxConsumerContractStatus: registry.protocolFoundation.localOutboxConsumerContractStatus,
      networkDeliveryAdapterContractStatus: registry.protocolFoundation.networkDeliveryAdapterContractStatus,
      networkAuthenticationEvidenceContractStatus: registry.protocolFoundation.networkAuthenticationEvidenceContractStatus,
      runtimeConsumptionConnected: registry.protocolFoundation.runtimeConsumptionConnected,
      businessApplyConnected: registry.protocolFoundation.businessApplyConnected,
    },
    readyEntities,
    blockedEntities,
    auditedLegacyBlockers: auditLegacyTransport(resolvedRoot),
  };
}

function main(): void {
  const root = resolve(process.argv[2] ?? process.cwd());
  process.stdout.write(`${JSON.stringify(buildCanonicalLocalSyncReadiness(root), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

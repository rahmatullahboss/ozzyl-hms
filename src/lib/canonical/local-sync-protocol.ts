import { createRequestFingerprint, stableCanonicalJson } from './idempotency';

export type CanonicalSyncOperation = 'upsert' | 'tombstone';

export interface CanonicalSyncDependency {
  entityType: string;
  entityPublicId: string;
  minimumVersion: number;
}

export interface CreateCanonicalSyncEnvelopeInput {
  tenantId: string;
  eventPublicId: string;
  entityType: string;
  entityPublicId: string;
  eventType: string;
  aggregateVersion: number;
  operation: CanonicalSyncOperation;
  occurredAtUtc: string;
  sourceNodePublicId: string;
  payload: Record<string, unknown>;
  dependencies?: CanonicalSyncDependency[];
}

export interface CanonicalSyncEnvelope extends CreateCanonicalSyncEnvelopeInput {
  protocolVersion: 1;
  dependencies: CanonicalSyncDependency[];
  payloadSha256: string;
  idempotencyKey: string;
}

export interface CanonicalSyncEntityVersion {
  tenantId: string;
  entityType: string;
  entityPublicId: string;
  appliedVersion: number;
  lastEventPublicId: string | null;
  lastOperation: CanonicalSyncOperation | null;
  lastPayloadSha256: string | null;
}

export type CanonicalSyncBlockedReason = 'VERSION_GAP' | 'DEPENDENCY_MISSING';

export interface CanonicalSyncPlan {
  ready: CanonicalSyncEnvelope[];
  replay: CanonicalSyncEnvelope[];
  blocked: Array<{
    envelope: CanonicalSyncEnvelope;
    reasons: CanonicalSyncBlockedReason[];
  }>;
}

export class CanonicalSyncConflictError extends Error {
  readonly code = 'CANONICAL_SYNC_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'CanonicalSyncConflictError';
  }
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_SET = new Set<CanonicalSyncOperation>(['upsert', 'tombstone']);

function assertIdentifier(
  value: unknown,
  label: string,
  maxLength: number,
  options: { allowNumeric?: boolean } = {},
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  if (!options.allowNumeric && /^\d+$/.test(value.trim())) {
    throw new TypeError(`${label} must use a stable public identifier, not a raw numeric database ID`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function assertUtc(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid ISO-8601 UTC timestamp`);
  }
}

function dependencyKey(dependency: CanonicalSyncDependency): string {
  return `${dependency.entityType}\u0000${dependency.entityPublicId}`;
}

function entityKey(entityType: string, entityPublicId: string): string {
  return `${entityType}\u0000${entityPublicId}`;
}

function versionKey(entityType: string, entityPublicId: string, version: number): string {
  return `${entityType}\u0000${entityPublicId}\u0000${version}`;
}

function sortDependencies(
  dependencies: readonly CanonicalSyncDependency[],
  owner?: Pick<CreateCanonicalSyncEnvelopeInput, 'entityType' | 'entityPublicId'>,
): CanonicalSyncDependency[] {
  const seen = new Set<string>();
  const normalized = dependencies.map((dependency, index) => {
    if (!dependency || typeof dependency !== 'object') {
      throw new TypeError(`dependencies[${index}] must be an object`);
    }
    assertIdentifier(dependency.entityType, `dependencies[${index}].entityType`, 96);
    assertIdentifier(dependency.entityPublicId, `dependencies[${index}].entityPublicId`, 192);
    assertPositiveInteger(dependency.minimumVersion, `dependencies[${index}].minimumVersion`);
    if (
      owner
      && dependency.entityType === owner.entityType
      && dependency.entityPublicId === owner.entityPublicId
    ) {
      throw new TypeError('Canonical sync envelope cannot contain a self-dependency');
    }
    const key = dependencyKey(dependency);
    if (seen.has(key)) throw new TypeError(`Canonical sync envelope contains duplicate dependency ${key}`);
    seen.add(key);
    return {
      entityType: dependency.entityType,
      entityPublicId: dependency.entityPublicId,
      minimumVersion: dependency.minimumVersion,
    };
  });
  return normalized.sort((left, right) => (
    left.entityType.localeCompare(right.entityType)
    || left.entityPublicId.localeCompare(right.entityPublicId)
    || left.minimumVersion - right.minimumVersion
  ));
}

function assertPlainPayload(payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('payload must be a plain object');
  }
  const prototype = Object.getPrototypeOf(payload);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('payload must be a plain object');
  }
  stableCanonicalJson(payload);
}

async function createPayloadSha256(payload: Record<string, unknown>): Promise<string> {
  return createRequestFingerprint(payload);
}

async function createSyncIdempotencyKey(input: {
  protocolVersion: 1;
  tenantId: string;
  eventPublicId: string;
  entityType: string;
  entityPublicId: string;
  eventType: string;
  aggregateVersion: number;
  operation: CanonicalSyncOperation;
  occurredAtUtc: string;
  sourceNodePublicId: string;
  payloadSha256: string;
  dependencies: CanonicalSyncDependency[];
}): Promise<string> {
  return createRequestFingerprint(input);
}

function assertBaseEnvelopeFields(input: CreateCanonicalSyncEnvelopeInput): void {
  assertIdentifier(input.tenantId, 'tenantId', 128, { allowNumeric: true });
  assertIdentifier(input.eventPublicId, 'eventPublicId', 160);
  assertIdentifier(input.entityType, 'entityType', 96);
  assertIdentifier(input.entityPublicId, 'entityPublicId', 192);
  assertIdentifier(input.eventType, 'eventType', 160);
  assertPositiveInteger(input.aggregateVersion, 'aggregateVersion');
  if (!OPERATION_SET.has(input.operation)) throw new TypeError('operation must be upsert or tombstone');
  assertUtc(input.occurredAtUtc, 'occurredAtUtc');
  assertIdentifier(input.sourceNodePublicId, 'sourceNodePublicId', 192);
  assertPlainPayload(input.payload);
}

export async function createCanonicalSyncEnvelope(
  input: CreateCanonicalSyncEnvelopeInput,
): Promise<CanonicalSyncEnvelope> {
  assertBaseEnvelopeFields(input);
  const dependencies = sortDependencies(input.dependencies ?? [], input);
  const payloadSha256 = await createPayloadSha256(input.payload);
  const protocolVersion = 1 as const;
  const idempotencyKey = await createSyncIdempotencyKey({
    protocolVersion,
    tenantId: input.tenantId,
    eventPublicId: input.eventPublicId,
    entityType: input.entityType,
    entityPublicId: input.entityPublicId,
    eventType: input.eventType,
    aggregateVersion: input.aggregateVersion,
    operation: input.operation,
    occurredAtUtc: input.occurredAtUtc,
    sourceNodePublicId: input.sourceNodePublicId,
    payloadSha256,
    dependencies,
  });
  return {
    ...input,
    protocolVersion,
    dependencies,
    payloadSha256,
    idempotencyKey,
  };
}

export async function validateCanonicalSyncEnvelope(
  envelope: CanonicalSyncEnvelope,
): Promise<CanonicalSyncEnvelope> {
  if (!envelope || typeof envelope !== 'object' || envelope.protocolVersion !== 1) {
    throw new TypeError('Canonical sync envelope has an unsupported protocolVersion');
  }
  assertBaseEnvelopeFields(envelope);
  if (!HASH_PATTERN.test(envelope.payloadSha256)) {
    throw new TypeError('payloadSha256 must be a lowercase SHA-256 digest');
  }
  if (!HASH_PATTERN.test(envelope.idempotencyKey)) {
    throw new TypeError('idempotencyKey must be a lowercase SHA-256 digest');
  }
  const dependencies = sortDependencies(envelope.dependencies, envelope);
  if (stableCanonicalJson(dependencies) !== stableCanonicalJson(envelope.dependencies)) {
    throw new TypeError('Canonical sync dependencies must use deterministic sorted order');
  }
  const payloadSha256 = await createPayloadSha256(envelope.payload);
  if (payloadSha256 !== envelope.payloadSha256) {
    throw new CanonicalSyncConflictError('Canonical sync payload digest does not match payload');
  }
  const idempotencyKey = await createSyncIdempotencyKey({
    protocolVersion: 1,
    tenantId: envelope.tenantId,
    eventPublicId: envelope.eventPublicId,
    entityType: envelope.entityType,
    entityPublicId: envelope.entityPublicId,
    eventType: envelope.eventType,
    aggregateVersion: envelope.aggregateVersion,
    operation: envelope.operation,
    occurredAtUtc: envelope.occurredAtUtc,
    sourceNodePublicId: envelope.sourceNodePublicId,
    payloadSha256: envelope.payloadSha256,
    dependencies,
  });
  if (idempotencyKey !== envelope.idempotencyKey) {
    throw new CanonicalSyncConflictError('Canonical sync idempotency evidence does not match envelope semantics');
  }
  return envelope;
}

function assertCurrentVersion(version: CanonicalSyncEntityVersion, tenantId: string): void {
  if (!version || typeof version !== 'object') throw new TypeError('currentVersions entries must be objects');
  if (version.tenantId !== tenantId) throw new CanonicalSyncConflictError('Canonical sync current version tenant mismatch');
  assertIdentifier(version.entityType, 'currentVersions.entityType', 96);
  assertIdentifier(version.entityPublicId, 'currentVersions.entityPublicId', 192);
  if (!Number.isSafeInteger(version.appliedVersion) || version.appliedVersion < 0) {
    throw new RangeError('currentVersions.appliedVersion must be a non-negative safe integer');
  }
  if (version.appliedVersion === 0) {
    if (
      version.lastEventPublicId !== null
      || version.lastOperation !== null
      || version.lastPayloadSha256 !== null
    ) throw new CanonicalSyncConflictError('Version zero cannot contain applied event evidence');
    return;
  }
  assertIdentifier(version.lastEventPublicId, 'currentVersions.lastEventPublicId', 160);
  if (!version.lastOperation || !OPERATION_SET.has(version.lastOperation)) {
    throw new TypeError('currentVersions.lastOperation must be upsert or tombstone');
  }
  if (!version.lastPayloadSha256 || !HASH_PATTERN.test(version.lastPayloadSha256)) {
    throw new TypeError('currentVersions.lastPayloadSha256 must be a lowercase SHA-256 digest');
  }
}

function envelopeIdentity(envelope: CanonicalSyncEnvelope): string {
  return stableCanonicalJson(envelope);
}

function hasDependencyCycle(
  pending: readonly CanonicalSyncEnvelope[],
  appliedVersions: ReadonlyMap<string, number>,
): boolean {
  const actionable = pending.filter((envelope) => (
    envelope.aggregateVersion
    === (appliedVersions.get(entityKey(envelope.entityType, envelope.entityPublicId)) ?? 0) + 1
  ));
  const providers = new Map<string, CanonicalSyncEnvelope[]>();
  for (const envelope of actionable) {
    const key = entityKey(envelope.entityType, envelope.entityPublicId);
    const list = providers.get(key) ?? [];
    list.push(envelope);
    providers.set(key, list);
  }

  const adjacency = new Map<string, Set<string>>();
  for (const envelope of actionable) {
    const from = envelope.eventPublicId;
    const edges = adjacency.get(from) ?? new Set<string>();
    for (const dependency of envelope.dependencies) {
      const key = entityKey(dependency.entityType, dependency.entityPublicId);
      if ((appliedVersions.get(key) ?? 0) >= dependency.minimumVersion) continue;
      for (const provider of providers.get(key) ?? []) {
        if (provider.aggregateVersion >= dependency.minimumVersion) edges.add(provider.eventPublicId);
      }
    }
    adjacency.set(from, edges);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...adjacency.keys()].some(visit);
}

export async function planCanonicalSyncApply(input: {
  tenantId: string;
  envelopes: CanonicalSyncEnvelope[];
  currentVersions: CanonicalSyncEntityVersion[];
}): Promise<CanonicalSyncPlan> {
  assertIdentifier(input.tenantId, 'tenantId', 128, { allowNumeric: true });
  if (!Array.isArray(input.envelopes) || !Array.isArray(input.currentVersions)) {
    throw new TypeError('envelopes and currentVersions must be arrays');
  }

  const currentByEntity = new Map<string, CanonicalSyncEntityVersion>();
  for (const version of input.currentVersions) {
    assertCurrentVersion(version, input.tenantId);
    const key = entityKey(version.entityType, version.entityPublicId);
    if (currentByEntity.has(key)) {
      throw new CanonicalSyncConflictError(`Duplicate current version authority for ${key}`);
    }
    currentByEntity.set(key, version);
  }

  const uniqueEvents = new Map<string, CanonicalSyncEnvelope>();
  const idempotencyOwners = new Map<string, string>();
  const replay: CanonicalSyncEnvelope[] = [];
  for (const envelope of input.envelopes) {
    await validateCanonicalSyncEnvelope(envelope);
    if (envelope.tenantId !== input.tenantId) {
      throw new CanonicalSyncConflictError('Canonical sync envelope tenant mismatch');
    }
    const idempotencyOwner = idempotencyOwners.get(envelope.idempotencyKey);
    if (idempotencyOwner && idempotencyOwner !== envelope.eventPublicId) {
      throw new CanonicalSyncConflictError('Canonical sync idempotency key belongs to a different event');
    }
    idempotencyOwners.set(envelope.idempotencyKey, envelope.eventPublicId);

    const existing = uniqueEvents.get(envelope.eventPublicId);
    if (!existing) {
      uniqueEvents.set(envelope.eventPublicId, envelope);
    } else if (envelopeIdentity(existing) === envelopeIdentity(envelope)) {
      replay.push(envelope);
    } else {
      throw new CanonicalSyncConflictError(`Event ${envelope.eventPublicId} has conflicting semantics`);
    }
  }

  const unique = [...uniqueEvents.values()];
  const versionOwners = new Map<string, CanonicalSyncEnvelope>();
  for (const envelope of unique) {
    const key = versionKey(envelope.entityType, envelope.entityPublicId, envelope.aggregateVersion);
    const existing = versionOwners.get(key);
    if (existing && existing.eventPublicId !== envelope.eventPublicId) {
      throw new CanonicalSyncConflictError(`Entity version ${key} belongs to multiple events`);
    }
    versionOwners.set(key, envelope);
  }

  const pending: CanonicalSyncEnvelope[] = [];
  for (const envelope of unique) {
    const currentVersion = currentByEntity.get(entityKey(envelope.entityType, envelope.entityPublicId));
    if (currentVersion && envelope.aggregateVersion <= currentVersion.appliedVersion) {
      const matches = envelope.aggregateVersion === currentVersion.appliedVersion
        && envelope.eventPublicId === currentVersion.lastEventPublicId
        && envelope.operation === currentVersion.lastOperation
        && envelope.payloadSha256 === currentVersion.lastPayloadSha256;
      if (!matches) {
        throw new CanonicalSyncConflictError(
          `Historical event ${envelope.eventPublicId} conflicts with applied entity evidence`,
        );
      }
      replay.push(envelope);
    } else {
      pending.push(envelope);
    }
  }

  const appliedVersions = new Map<string, number>(
    [...currentByEntity.entries()].map(([key, value]) => [key, value.appliedVersion]),
  );
  const ready: CanonicalSyncEnvelope[] = [];
  let unresolved = [...pending];

  while (unresolved.length > 0) {
    const readyLevel = unresolved
      .filter((envelope) => {
        const key = entityKey(envelope.entityType, envelope.entityPublicId);
        if (envelope.aggregateVersion !== (appliedVersions.get(key) ?? 0) + 1) return false;
        return envelope.dependencies.every((dependency) => (
          (appliedVersions.get(entityKey(dependency.entityType, dependency.entityPublicId)) ?? 0)
          >= dependency.minimumVersion
        ));
      })
      .sort((left, right) => left.eventPublicId.localeCompare(right.eventPublicId));

    if (readyLevel.length === 0) break;
    const readyIds = new Set(readyLevel.map((envelope) => envelope.eventPublicId));
    for (const envelope of readyLevel) {
      ready.push(envelope);
      appliedVersions.set(
        entityKey(envelope.entityType, envelope.entityPublicId),
        envelope.aggregateVersion,
      );
    }
    unresolved = unresolved.filter((envelope) => !readyIds.has(envelope.eventPublicId));
  }

  if (unresolved.length > 0 && hasDependencyCycle(unresolved, appliedVersions)) {
    throw new CanonicalSyncConflictError('Canonical sync dependency cycle detected');
  }

  const blocked = unresolved
    .sort((left, right) => left.eventPublicId.localeCompare(right.eventPublicId))
    .map((envelope) => {
      const reasons: CanonicalSyncBlockedReason[] = [];
      const key = entityKey(envelope.entityType, envelope.entityPublicId);
      if (envelope.aggregateVersion > (appliedVersions.get(key) ?? 0) + 1) reasons.push('VERSION_GAP');
      if (envelope.dependencies.some((dependency) => (
        (appliedVersions.get(entityKey(dependency.entityType, dependency.entityPublicId)) ?? 0)
        < dependency.minimumVersion
      ))) reasons.push('DEPENDENCY_MISSING');
      return { envelope, reasons };
    });

  replay.sort((left, right) => left.eventPublicId.localeCompare(right.eventPublicId));
  return { ready, replay, blocked };
}

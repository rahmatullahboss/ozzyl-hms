import type { Env } from '../types';

export type LocalSyncOperation = 'create' | 'update' | 'delete' | 'upsert';

export type LocalSyncOutboxInput = {
  tenantId: string;
  entityType: string;
  entityId: string | number;
  operation: LocalSyncOperation;
  payload: Record<string, unknown>;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
}

export async function hashLocalSyncPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function buildIdempotencyKey(env: Env, input: LocalSyncOutboxInput, payloadHash: string): string {
  const serverId = env.LOCAL_SERVER_ID ?? 'local-server';
  return [
    serverId,
    input.tenantId,
    input.entityType,
    String(input.entityId),
    input.operation,
    payloadHash.slice(0, 24),
  ].join(':');
}

export async function buildLocalSyncOutboxStatement(
  env: Env,
  input: LocalSyncOutboxInput,
): Promise<D1PreparedStatement | null> {
  if (env.ENVIRONMENT !== 'local_server') return null;

  const payloadHash = await hashLocalSyncPayload(input.payload);
  const idempotencyKey = buildIdempotencyKey(env, input, payloadHash);

  return env.DB.prepare(`
    INSERT OR IGNORE INTO local_sync_outbox (
      tenant_id,
      entity_type,
      entity_id,
      operation,
      payload_hash,
      payload_json,
      schema_version,
      idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    input.tenantId,
    input.entityType,
    String(input.entityId),
    input.operation,
    payloadHash,
    JSON.stringify(input.payload),
    idempotencyKey,
  );
}

export async function buildLocalSyncPatientCreateOutboxStatement(
  env: Env,
  input: {
    tenantId: string;
    patientCode: string;
    payload: Record<string, unknown>;
  },
): Promise<D1PreparedStatement | null> {
  if (env.ENVIRONMENT !== 'local_server') return null;

  const payloadHash = await hashLocalSyncPayload(input.payload);
  const serverId = env.LOCAL_SERVER_ID ?? 'local-server';
  const idempotencyPrefix = `${serverId}:${input.tenantId}:patients:`;
  const idempotencySuffix = `:upsert:${payloadHash.slice(0, 24)}`;

  return env.DB.prepare(`
    INSERT OR IGNORE INTO local_sync_outbox (
      tenant_id,
      entity_type,
      entity_id,
      operation,
      payload_hash,
      payload_json,
      schema_version,
      idempotency_key
    )
    SELECT
      ?,
      'patients',
      CAST(p.id AS TEXT),
      'upsert',
      ?,
      ?,
      1,
      ? || CAST(p.id AS TEXT) || ?
    FROM patients p
    WHERE p.tenant_id = ? AND p.patient_code = ?
    LIMIT 1
  `).bind(
    input.tenantId,
    payloadHash,
    JSON.stringify(input.payload),
    idempotencyPrefix,
    idempotencySuffix,
    input.tenantId,
    input.patientCode,
  );
}

export async function recordLocalSyncOutboxEvent(
  env: Env,
  input: LocalSyncOutboxInput,
): Promise<void> {
  const statement = await buildLocalSyncOutboxStatement(env, input);
  if (!statement) return;
  await statement.run();
}

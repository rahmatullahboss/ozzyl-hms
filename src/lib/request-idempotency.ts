import type { D1Database } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';

type IdempotencyRow = {
  request_hash: string;
  status: string;
  source_id: string | null;
  response_json: string | null;
};

export type IdempotencyReplay = {
  responseBody: Record<string, unknown>;
};

export type MutationIdempotencyState = {
  requestHash: string;
  status: 'pending' | 'completed' | 'failed';
  sourceId: string | null;
  responseBody: Record<string, unknown> | null;
};

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const normalized = normalizeForHash((value as Record<string, unknown>)[key]);
        if (normalized !== undefined) acc[key] = normalized;
        return acc;
      }, {});
  }
  return value;
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForHash(value));
}

export async function createIdempotencyRequestHash(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(stableJsonStringify(value));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseResponseBody(responseJson: string | null): Record<string, unknown> | null {
  if (!responseJson) return null;
  return JSON.parse(responseJson) as Record<string, unknown>;
}

export async function readMutationIdempotencyState(
  db: D1Database,
  input: {
    tenantId: string;
    mutationType: string;
    idempotencyKey: string;
    requestHash?: string;
    mismatchMessage?: string;
  },
): Promise<MutationIdempotencyState | null> {
  const existing = await db.prepare(`
    SELECT request_hash, status, source_id, response_json
    FROM billing_mutation_idempotency_keys
    WHERE tenant_id = ? AND mutation_type = ? AND idempotency_key = ?
  `).bind(input.tenantId, input.mutationType, input.idempotencyKey).first<IdempotencyRow>();

  if (!existing) return null;
  if (input.requestHash && existing.request_hash !== input.requestHash) {
    throw new HTTPException(409, {
      message: input.mismatchMessage ?? 'This idempotency key was already used for a different request',
    });
  }
  if (!['pending', 'completed', 'failed'].includes(existing.status)) {
    throw new HTTPException(409, { message: `Unsupported idempotency status: ${existing.status}` });
  }

  return {
    requestHash: existing.request_hash,
    status: existing.status as MutationIdempotencyState['status'],
    sourceId: existing.source_id ?? null,
    responseBody: existing.status === 'completed' ? parseResponseBody(existing.response_json) : null,
  };
}

export async function reclaimFailedMutationIdempotencyKey(
  db: D1Database,
  input: {
    tenantId: string;
    mutationType: string;
    idempotencyKey: string;
    requestHash: string;
    createdBy: string | number;
  },
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE billing_mutation_idempotency_keys
    SET status = 'pending', source_id = NULL, response_json = NULL,
        created_by = ?, updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND mutation_type = ? AND idempotency_key = ?
      AND request_hash = ? AND status = 'failed' AND source_id IS NULL
  `).bind(
    String(input.createdBy),
    input.tenantId,
    input.mutationType,
    input.idempotencyKey,
    input.requestHash,
  ).run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function readMutationIdempotencyReplay(
  db: D1Database,
  input: {
    tenantId: string;
    mutationType: string;
    idempotencyKey: string;
    requestHash: string;
    mismatchMessage: string;
    conflictMessage: string;
  },
): Promise<IdempotencyReplay | null> {
  const existing = await readMutationIdempotencyState(db, input);
  if (!existing) return null;
  if (existing.status === 'completed' && existing.responseBody) {
    return { responseBody: existing.responseBody };
  }

  throw new HTTPException(409, { message: input.conflictMessage });
}

export async function reserveMutationIdempotencyKey(
  db: D1Database,
  input: {
    tenantId: string;
    mutationType: string;
    idempotencyKey: string;
    requestHash: string;
    createdBy: string | number;
    mismatchMessage: string;
    conflictMessage: string;
    retryFailedWithoutSource?: boolean;
  },
): Promise<IdempotencyReplay | null> {
  const result = await db.prepare(`
    INSERT OR IGNORE INTO billing_mutation_idempotency_keys
      (tenant_id, mutation_type, idempotency_key, request_hash, status, created_by)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).bind(
    input.tenantId,
    input.mutationType,
    input.idempotencyKey,
    input.requestHash,
    String(input.createdBy),
  ).run();

  if (Number(result.meta?.changes ?? 0) > 0) return null;

  const existing = await readMutationIdempotencyState(db, input);
  if (!existing) {
    throw new HTTPException(409, { message: input.conflictMessage });
  }
  if (existing.status === 'completed' && existing.responseBody) {
    return { responseBody: existing.responseBody };
  }

  if (input.retryFailedWithoutSource && existing.status === 'failed' && !existing.sourceId) {
    const reclaimed = await reclaimFailedMutationIdempotencyKey(db, input);
    if (reclaimed) return null;
  }

  throw new HTTPException(409, { message: input.conflictMessage });
}

export async function recordMutationIdempotencySource(
  db: D1Database,
  input: {
    tenantId: string;
    mutationType: string;
    idempotencyKey: string;
    sourceId: string | number;
  },
): Promise<void> {
  await db.prepare(`
    UPDATE billing_mutation_idempotency_keys
    SET source_id = ?, updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND mutation_type = ? AND idempotency_key = ?
      AND status = 'pending'
  `).bind(
    String(input.sourceId),
    input.tenantId,
    input.mutationType,
    input.idempotencyKey,
  ).run();
}

export async function completeMutationIdempotencyKey(
  db: D1Database,
  input: {
    tenantId: string;
    mutationType: string;
    idempotencyKey: string;
    sourceId: string | number;
    responseBody: Record<string, unknown>;
  },
): Promise<void> {
  await db.prepare(`
    UPDATE billing_mutation_idempotency_keys
    SET status = 'completed', source_id = ?, response_json = ?, updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND mutation_type = ? AND idempotency_key = ?
  `).bind(
    String(input.sourceId),
    JSON.stringify(input.responseBody),
    input.tenantId,
    input.mutationType,
    input.idempotencyKey,
  ).run();
}

export async function markMutationIdempotencyKeyFailed(
  db: D1Database,
  input: {
    tenantId: string;
    mutationType: string;
    idempotencyKey: string;
  },
): Promise<void> {
  await db.prepare(`
    UPDATE billing_mutation_idempotency_keys
    SET status = 'failed', updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND mutation_type = ? AND idempotency_key = ?
      AND status = 'pending'
  `).bind(input.tenantId, input.mutationType, input.idempotencyKey).run();
}

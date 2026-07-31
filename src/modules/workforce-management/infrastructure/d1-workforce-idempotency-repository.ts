import type { WorkforceTransaction } from '../application/ports';
import { WorkforceError } from '../domain/errors';
import { createRequestFingerprint } from '../../../lib/canonical/idempotency';

export type WorkforceMutationIdentity = {
  tenantId: string;
  mutationType: string;
  idempotencyKey: string;
  actorUserId: string;
};

export type WorkforceIdempotencyClaim<TResult> =
  | { kind: 'reserved' }
  | { kind: 'replay'; result: TResult };

export type WorkforceIdempotencyRecord<TResult> = WorkforceMutationIdentity & {
  requestHash: string;
  status: 'processing' | 'completed' | 'failed';
  result: TResult | null;
};

export interface WorkforceIdempotencyCoordinator<TStatement> {
  claim<TResult>(
    input: WorkforceMutationIdentity & { requestHash: string },
  ): Promise<WorkforceIdempotencyClaim<TResult>>;
  prepareComplete<TResult>(
    input: WorkforceMutationIdentity & { requestHash: string; result: TResult },
  ): TStatement;
  markFailed(input: WorkforceMutationIdentity & { requestHash: string }): Promise<void>;
  find<TResult>(identity: WorkforceMutationIdentity): Promise<WorkforceIdempotencyRecord<TResult> | null>;
}

export type WorkforceMutationPlan<TResult, TStatement> = {
  result: TResult;
  statements: TStatement[];
};

type D1IdempotencyRow = {
  tenant_id: number | string;
  mutation_type: string;
  idempotency_key: string;
  request_hash: string;
  status: 'processing' | 'completed' | 'failed';
  result_json: string | null;
  created_by: number | string;
};

function parseStoredResult<TResult>(row: D1IdempotencyRow): TResult | null {
  if (row.result_json === null) return null;
  try {
    return JSON.parse(row.result_json) as TResult;
  } catch (error) {
    throw new TypeError('Stored workforce idempotency result is not valid JSON', { cause: error });
  }
}

function serializeResult<TResult>(result: TResult): string {
  const json = JSON.stringify(result);
  if (json === undefined) {
    throw new TypeError('Workforce mutation result must be JSON serializable');
  }
  return json;
}

export async function hashWorkforceRequest(request: unknown): Promise<string> {
  return createRequestFingerprint(request);
}

export async function runIdempotentWorkforceMutation<TRequest, TResult, TStatement>(
  dependencies: {
    idempotency: WorkforceIdempotencyCoordinator<TStatement>;
    transaction: WorkforceTransaction<TStatement>;
  },
  identity: WorkforceMutationIdentity,
  request: TRequest,
  execute: (context: { requestHash: string }) => Promise<WorkforceMutationPlan<TResult, TStatement>>,
): Promise<TResult> {
  const requestHash = await hashWorkforceRequest(request);
  const claim = await dependencies.idempotency.claim<TResult>({ ...identity, requestHash });
  if (claim.kind === 'replay') return claim.result;

  try {
    const plan = await execute({ requestHash });
    const completion = dependencies.idempotency.prepareComplete({
      ...identity,
      requestHash,
      result: plan.result,
    });
    await dependencies.transaction.commit([...plan.statements, completion]);
    return plan.result;
  } catch (error) {
    await dependencies.idempotency.markFailed({ ...identity, requestHash });
    throw error;
  }
}

export function createD1WorkforceIdempotencyRepository(
  db: D1Database,
): WorkforceIdempotencyCoordinator<D1PreparedStatement> {
  async function find<TResult>(
    identity: WorkforceMutationIdentity,
  ): Promise<WorkforceIdempotencyRecord<TResult> | null> {
    const row = await db.prepare(`
      SELECT tenant_id, mutation_type, idempotency_key, request_hash,
             status, result_json, created_by
      FROM workforce_mutation_idempotency
      WHERE CAST(tenant_id AS TEXT) = ?
        AND mutation_type = ?
        AND idempotency_key = ?
      LIMIT 1
    `).bind(
      identity.tenantId,
      identity.mutationType,
      identity.idempotencyKey,
    ).first<D1IdempotencyRow>();

    if (!row) return null;
    return {
      tenantId: String(row.tenant_id),
      mutationType: row.mutation_type,
      idempotencyKey: row.idempotency_key,
      actorUserId: String(row.created_by),
      requestHash: row.request_hash,
      status: row.status,
      result: parseStoredResult<TResult>(row),
    };
  }

  async function claim<TResult>(
    input: WorkforceMutationIdentity & { requestHash: string },
  ): Promise<WorkforceIdempotencyClaim<TResult>> {
    const inserted = await db.prepare(`
      INSERT OR IGNORE INTO workforce_mutation_idempotency (
        tenant_id, mutation_type, idempotency_key, request_hash, status,
        result_json, created_by, created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, 'processing', NULL, ?,
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    `).bind(
      input.tenantId,
      input.mutationType,
      input.idempotencyKey,
      input.requestHash,
      input.actorUserId,
    ).run();

    const record = await find<TResult>(input);
    if (!record) throw new Error('Workforce idempotency reservation was not persisted');

    if (record.requestHash !== input.requestHash) {
      throw new WorkforceError(
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key was already used for a different workforce request',
        409,
      );
    }

    if (record.status === 'completed') {
      return { kind: 'replay', result: record.result as TResult };
    }

    if (record.status === 'failed') {
      await db.prepare(`
        UPDATE workforce_mutation_idempotency
        SET status = 'processing', result_json = NULL,
            updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE CAST(tenant_id AS TEXT) = ?
          AND mutation_type = ?
          AND idempotency_key = ?
          AND request_hash = ?
          AND status = 'failed'
      `).bind(
        input.tenantId,
        input.mutationType,
        input.idempotencyKey,
        input.requestHash,
      ).run();
      return { kind: 'reserved' };
    }

    if (Number(inserted.meta.changes ?? 0) > 0) {
      return { kind: 'reserved' };
    }

    throw new WorkforceError(
      'IDEMPOTENCY_CONFLICT',
      'This workforce mutation is already being processed',
      409,
      true,
    );
  }

  function prepareComplete<TResult>(
    input: WorkforceMutationIdentity & { requestHash: string; result: TResult },
  ): D1PreparedStatement {
    return db.prepare(`
      UPDATE workforce_mutation_idempotency
      SET status = 'completed', result_json = ?,
          updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE CAST(tenant_id AS TEXT) = ?
        AND mutation_type = ?
        AND idempotency_key = ?
        AND request_hash = ?
        AND status = 'processing'
    `).bind(
      serializeResult(input.result),
      input.tenantId,
      input.mutationType,
      input.idempotencyKey,
      input.requestHash,
    );
  }

  async function markFailed(
    input: WorkforceMutationIdentity & { requestHash: string },
  ): Promise<void> {
    await db.prepare(`
      UPDATE workforce_mutation_idempotency
      SET status = 'failed',
          updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE CAST(tenant_id AS TEXT) = ?
        AND mutation_type = ?
        AND idempotency_key = ?
        AND request_hash = ?
        AND status = 'processing'
    `).bind(
      input.tenantId,
      input.mutationType,
      input.idempotencyKey,
      input.requestHash,
    ).run();
  }

  return { claim, prepareComplete, markFailed, find };
}

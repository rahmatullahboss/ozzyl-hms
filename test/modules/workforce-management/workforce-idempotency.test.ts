import { describe, expect, it, vi } from 'vitest';
import { WorkforceError } from '../../../src/modules/workforce-management';
import {
  createD1WorkforceIdempotencyRepository,
  hashWorkforceRequest,
  runIdempotentWorkforceMutation,
  type WorkforceIdempotencyClaim,
  type WorkforceIdempotencyCoordinator,
  type WorkforceMutationIdentity,
} from '../../../src/modules/workforce-management/infrastructure/d1-workforce-idempotency-repository';
import { createWorkforceTransaction } from '../../../src/modules/workforce-management/infrastructure/workforce-transaction-adapter';
import type { WorkforceTransaction } from '../../../src/modules/workforce-management/application/ports';

type TestStatement = () => void;

type StoredRecord = {
  requestHash: string;
  status: 'processing' | 'completed' | 'failed';
  result: unknown;
};

class MemoryIdempotencyCoordinator implements WorkforceIdempotencyCoordinator<TestStatement> {
  private readonly records = new Map<string, StoredRecord>();

  private key(identity: WorkforceMutationIdentity): string {
    return `${identity.tenantId}:${identity.mutationType}:${identity.idempotencyKey}`;
  }

  async claim<TResult>(input: WorkforceMutationIdentity & { requestHash: string }): Promise<WorkforceIdempotencyClaim<TResult>> {
    const key = this.key(input);
    const existing = this.records.get(key);
    if (!existing) {
      this.records.set(key, { requestHash: input.requestHash, status: 'processing', result: null });
      return { kind: 'reserved' };
    }
    if (existing.requestHash !== input.requestHash) {
      throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'Key belongs to a different request', 409);
    }
    if (existing.status === 'completed') {
      return { kind: 'replay', result: existing.result as TResult };
    }
    if (existing.status === 'failed') {
      existing.status = 'processing';
      existing.result = null;
      return { kind: 'reserved' };
    }
    throw new WorkforceError('IDEMPOTENCY_CONFLICT', 'Mutation is already processing', 409, true);
  }

  prepareComplete<TResult>(input: WorkforceMutationIdentity & { requestHash: string; result: TResult }): TestStatement {
    return () => {
      const record = this.records.get(this.key(input));
      if (!record || record.requestHash !== input.requestHash) throw new Error('Missing idempotency reservation');
      record.status = 'completed';
      record.result = input.result;
    };
  }

  async markFailed(input: WorkforceMutationIdentity & { requestHash: string }): Promise<void> {
    const record = this.records.get(this.key(input));
    if (record?.requestHash === input.requestHash && record.status === 'processing') {
      record.status = 'failed';
    }
  }

  async find<TResult>(identity: WorkforceMutationIdentity) {
    const record = this.records.get(this.key(identity));
    return record
      ? { ...identity, requestHash: record.requestHash, status: record.status, result: record.result as TResult | null }
      : null;
  }
}

function createMemoryTransaction(): WorkforceTransaction<TestStatement> {
  return {
    async commit(statements) {
      statements.forEach((statement) => statement());
    },
  };
}

type D1StoredRecord = {
  tenant_id: string;
  mutation_type: string;
  idempotency_key: string;
  request_hash: string;
  status: 'processing' | 'completed' | 'failed';
  result_json: string | null;
  created_by: string;
};

function createStatefulIdempotencyDb() {
  const records = new Map<string, D1StoredRecord>();
  const batchSizes: number[] = [];

  const key = (tenantId: unknown, mutationType: unknown, idempotencyKey: unknown) =>
    `${tenantId}:${mutationType}:${idempotencyKey}`;

  const db = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async first() {
          return records.get(key(bindings[0], bindings[1], bindings[2])) ?? null;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO workforce_mutation_idempotency')) {
            const recordKey = key(bindings[0], bindings[1], bindings[2]);
            if (records.has(recordKey)) return { meta: { changes: 0 } };
            records.set(recordKey, {
              tenant_id: String(bindings[0]),
              mutation_type: String(bindings[1]),
              idempotency_key: String(bindings[2]),
              request_hash: String(bindings[3]),
              status: 'processing',
              result_json: null,
              created_by: String(bindings[4]),
            });
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET status = 'completed'")) {
            const record = records.get(key(bindings[1], bindings[2], bindings[3]));
            if (record?.request_hash === bindings[4] && record.status === 'processing') {
              record.status = 'completed';
              record.result_json = String(bindings[0]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          if (sql.includes("SET status = 'failed'")) {
            const record = records.get(key(bindings[0], bindings[1], bindings[2]));
            if (record?.request_hash === bindings[3] && record.status === 'processing') {
              record.status = 'failed';
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          if (sql.includes("SET status = 'processing'")) {
            const record = records.get(key(bindings[0], bindings[1], bindings[2]));
            if (record?.request_hash === bindings[3] && record.status === 'failed') {
              record.status = 'processing';
              record.result_json = null;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      batchSizes.push(statements.length);
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;

  return { db, batchSizes };
}

const identity: WorkforceMutationIdentity = {
  tenantId: '100',
  mutationType: 'roster.assign',
  idempotencyKey: 'roster:assign:21:2026-07-27:3',
  actorUserId: '44',
};

describe('workforce mutation idempotency', () => {
  it('hashes equivalent object keys identically', async () => {
    await expect(hashWorkforceRequest({ staffId: 21, shiftId: 3 }))
      .resolves.toBe(await hashWorkforceRequest({ shiftId: 3, staffId: 21 }));
  });

  it('returns the completed result for the same key and request hash', async () => {
    const idempotency = new MemoryIdempotencyCoordinator();
    const transaction = createMemoryTransaction();
    const execute = vi.fn(async () => ({ result: { rosterId: 501 }, statements: [] as TestStatement[] }));

    const first = await runIdempotentWorkforceMutation(
      { idempotency, transaction },
      identity,
      { staffId: 21, shiftId: 3, rosterDate: '2026-07-27' },
      execute,
    );
    const replay = await runIdempotentWorkforceMutation(
      { idempotency, transaction },
      identity,
      { rosterDate: '2026-07-27', shiftId: 3, staffId: 21 },
      execute,
    );

    expect(first).toEqual({ rosterId: 501 });
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('throws IDEMPOTENCY_CONFLICT when a key is reused with a different request', async () => {
    const idempotency = new MemoryIdempotencyCoordinator();
    const transaction = createMemoryTransaction();
    const execute = vi.fn(async () => ({ result: { rosterId: 501 }, statements: [] as TestStatement[] }));

    await runIdempotentWorkforceMutation(
      { idempotency, transaction },
      identity,
      { staffId: 21, shiftId: 3 },
      execute,
    );

    await expect(runIdempotentWorkforceMutation(
      { idempotency, transaction },
      identity,
      { staffId: 21, shiftId: 4 },
      execute,
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409 });
  });

  it('marks the reservation failed when required mutation work throws', async () => {
    const idempotency = new MemoryIdempotencyCoordinator();
    const transaction = createMemoryTransaction();

    await expect(runIdempotentWorkforceMutation(
      { idempotency, transaction },
      identity,
      { staffId: 21, shiftId: 3 },
      async () => {
        throw new Error('required statement failed');
      },
    )).rejects.toThrow('required statement failed');

    await expect(idempotency.find(identity)).resolves.toMatchObject({ status: 'failed' });
  });

  it('marks the reservation failed when the atomic transaction commit fails', async () => {
    const idempotency = new MemoryIdempotencyCoordinator();
    const transaction: WorkforceTransaction<TestStatement> = {
      async commit() {
        throw new Error('D1 batch failed');
      },
    };

    await expect(runIdempotentWorkforceMutation(
      { idempotency, transaction },
      identity,
      { staffId: 21, shiftId: 3 },
      async () => ({ result: { rosterId: 501 }, statements: [() => undefined] }),
    )).rejects.toThrow('D1 batch failed');

    await expect(idempotency.find(identity)).resolves.toMatchObject({ status: 'failed' });
  });

  it('persists a D1 completion receipt in the same batch and replays it', async () => {
    const { db, batchSizes } = createStatefulIdempotencyDb();
    const idempotency = createD1WorkforceIdempotencyRepository(db);
    const transaction = createWorkforceTransaction(db);
    const requestHash = await hashWorkforceRequest({ staffId: 21, shiftId: 3 });

    await expect(idempotency.claim<{ rosterId: number }>({ ...identity, requestHash }))
      .resolves.toEqual({ kind: 'reserved' });

    await transaction.commit([
      idempotency.prepareComplete({ ...identity, requestHash, result: { rosterId: 501 } }),
    ]);

    await expect(idempotency.claim<{ rosterId: number }>({ ...identity, requestHash }))
      .resolves.toEqual({ kind: 'replay', result: { rosterId: 501 } });
    expect(batchSizes).toEqual([1]);

    await expect(idempotency.claim({
      ...identity,
      requestHash: await hashWorkforceRequest({ staffId: 21, shiftId: 4 }),
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', httpStatus: 409 });
  });
});

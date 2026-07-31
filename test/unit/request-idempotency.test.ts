import { describe, expect, it } from 'vitest';
import {
  createIdempotencyRequestHash,
  readMutationIdempotencyState,
  reclaimFailedMutationIdempotencyKey,
  reserveMutationIdempotencyKey,
  stableJsonStringify,
} from '../../src/lib/request-idempotency';
import { createMockDB } from '../integration/helpers/mock-db';

describe('request idempotency helpers', () => {
  it('normalizes object key order before hashing', async () => {
    const first = { b: 2, a: { z: 9, y: 8 }, items: [{ id: 1, qty: 2 }] };
    const second = { items: [{ qty: 2, id: 1 }], a: { y: 8, z: 9 }, b: 2 };

    expect(stableJsonStringify(first)).toBe(stableJsonStringify(second));
    await expect(createIdempotencyRequestHash(first)).resolves.toBe(await createIdempotencyRequestHash(second));
  });

  it('does not include undefined fields in the hash payload', () => {
    expect(stableJsonStringify({ a: 1, b: undefined })).toBe(stableJsonStringify({ a: 1 }));
  });

  it('reads recoverable failed mutation state for the same request hash', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: 'hash-1',
              status: 'failed',
              source_id: null,
              response_json: null,
            },
          };
        }
        return null;
      },
    });

    await expect(readMutationIdempotencyState(mockDB.db, {
      tenantId: 'tenant-1',
      mutationType: 'patient_registration',
      idempotencyKey: 'attempt-123',
      requestHash: 'hash-1',
      mismatchMessage: 'Key payload mismatch',
    })).resolves.toEqual({
      requestHash: 'hash-1',
      status: 'failed',
      sourceId: null,
      responseBody: null,
    });
  });

  it('rejects reading a key that belongs to another request payload', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: 'other-hash',
              status: 'failed',
              source_id: null,
              response_json: null,
            },
          };
        }
        return null;
      },
    });

    await expect(readMutationIdempotencyState(mockDB.db, {
      tenantId: 'tenant-1',
      mutationType: 'patient_registration',
      idempotencyKey: 'attempt-123',
      requestHash: 'hash-1',
      mismatchMessage: 'Key payload mismatch',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('keeps failed keys blocked unless the caller explicitly opts into safe retry', async () => {
    const requestHash = await createIdempotencyRequestHash({ amount: 500 });
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('insert or ignore into billing_mutation_idempotency_keys')) {
          return { success: true, meta: { changes: 0 } };
        }
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'failed',
              response_json: null,
              source_id: null,
            },
            success: true,
            meta: {},
          };
        }
        return null;
      },
    });

    await expect(reserveMutationIdempotencyKey(mockDB.db, {
      tenantId: 'tenant-1',
      mutationType: 'payment',
      idempotencyKey: 'payment-retry-001',
      requestHash,
      createdBy: 1,
      mismatchMessage: 'mismatch',
      conflictMessage: 'pending',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('reclaims a failed key with no committed source for a safe retry', async () => {
    const requestHash = await createIdempotencyRequestHash({ name: 'Retry Patient' });
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('insert or ignore into billing_mutation_idempotency_keys')) {
          return { success: true, meta: { changes: 0 } };
        }
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'failed',
              response_json: null,
              source_id: null,
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('update billing_mutation_idempotency_keys') && normalized.includes("status = 'pending'")) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    await expect(reserveMutationIdempotencyKey(mockDB.db, {
      tenantId: 'tenant-1',
      mutationType: 'patient_registration_create',
      idempotencyKey: 'patient-retry-001',
      requestHash,
      createdBy: 1,
      mismatchMessage: 'mismatch',
      conflictMessage: 'pending',
      retryFailedWithoutSource: true,
    })).resolves.toBeNull();

    expect(mockDB.queries.some((query) =>
      query.sql.toLowerCase().includes('update billing_mutation_idempotency_keys')
      && query.sql.toLowerCase().includes("status = 'pending'")
      && query.sql.toLowerCase().includes('source_id is null')
    )).toBe(true);
  });

  it('reclaims only a failed row for the same request hash and no source', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.toLowerCase().trim().startsWith('update billing_mutation_idempotency_keys')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    await expect(reclaimFailedMutationIdempotencyKey(mockDB.db, {
      tenantId: 'tenant-1',
      mutationType: 'patient_registration',
      idempotencyKey: 'attempt-123',
      requestHash: 'hash-1',
      createdBy: 7,
    })).resolves.toBe(true);

    const update = mockDB.queries.find((query) => query.method === 'run');
    expect(update?.sql).toContain("status = 'pending'");
    expect(update?.sql).toContain("AND status = 'failed'");
    expect(update?.sql).toContain('AND source_id IS NULL');
    expect(update?.params).toEqual([
      '7',
      'tenant-1',
      'patient_registration',
      'attempt-123',
      'hash-1',
    ]);
  });
});

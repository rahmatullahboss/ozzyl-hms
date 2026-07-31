import { describe, expect, it } from 'vitest';
import {
  completeInventoryIssueOperation,
  failInventoryIssueOperation,
  markInventoryIssueOperationProcessing,
  reserveInventoryIssueOperation,
} from '../src/lib/inventory-issue-operation';

type Handler = {
  match: (sql: string, method: 'run' | 'first') => boolean;
  run?: (args: unknown[]) => unknown;
  first?: (args: unknown[]) => unknown;
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function fakeDb(handlers: Handler[]) {
  const calls: Array<{ method: 'run' | 'first'; sql: string; args: unknown[] }> = [];
  return {
    calls,
    prepare(sql: string) {
      const normalized = normalize(sql);
      return {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          this.args = args;
          return this;
        },
        async run() {
          calls.push({ method: 'run', sql: normalized, args: this.args });
          const handler = handlers.find((entry) => entry.run && entry.match(normalized, 'run'));
          if (!handler?.run) throw new Error(`Unhandled run query: ${normalized}`);
          return handler.run(this.args);
        },
        async first() {
          calls.push({ method: 'first', sql: normalized, args: this.args });
          const handler = handlers.find((entry) => entry.first && entry.match(normalized, 'first'));
          if (!handler?.first) throw new Error(`Unhandled first query: ${normalized}`);
          return handler.first(this.args);
        },
      };
    },
  };
}

const input = {
  tenantId: 'tenant-a',
  idempotencyKey: 'issue-key-0001',
  requestHash: 'hash-a',
  createdBy: '7',
};

describe('inventory issue operation journal', () => {
  it('reserves a new tenant-scoped operation', async () => {
    const db = fakeDb([{
      match: (sql, method) => method === 'run' && sql.includes('INSERT OR IGNORE INTO inventory_issue_operation'),
      run: (args) => {
        expect(args).toEqual(['tenant-a', 'issue-key-0001', 'hash-a', '7']);
        return { meta: { changes: 1 } };
      },
    }]);

    await expect(reserveInventoryIssueOperation(db as any, input)).resolves.toEqual({
      state: 'reserved',
      attemptNo: 1,
    });
  });

  it('rejects the same key with a different request hash', async () => {
    const db = fakeDb([
      {
        match: (sql, method) => method === 'run' && sql.includes('INSERT OR IGNORE INTO inventory_issue_operation'),
        run: () => ({ meta: { changes: 0 } }),
      },
      {
        match: (sql, method) => method === 'first' && sql.includes('FROM inventory_issue_operation'),
        first: (args) => {
          expect(args).toEqual(['tenant-a', 'issue-key-0001']);
          return { request_hash: 'hash-b', status: 'completed', response_json: null, attempt_no: 1 };
        },
      },
    ]);

    await expect(reserveInventoryIssueOperation(db as any, input)).rejects.toMatchObject({ status: 409 });
  });

  it('replays a completed operation response', async () => {
    const response = {
      message: 'Inventory issue recorded',
      ConsumptionId: 77,
      IssueNo: 'ISS-77',
      OperationKey: 'issue-key-0001',
      totalCost: 100,
      totalCharge: 0,
      billedLines: 0,
    };
    const db = fakeDb([
      {
        match: (sql, method) => method === 'run' && sql.includes('INSERT OR IGNORE INTO inventory_issue_operation'),
        run: () => ({ meta: { changes: 0 } }),
      },
      {
        match: (sql, method) => method === 'first' && sql.includes('FROM inventory_issue_operation'),
        first: () => ({ request_hash: 'hash-a', status: 'completed', response_json: JSON.stringify(response), attempt_no: 1 }),
      },
    ]);

    await expect(reserveInventoryIssueOperation(db as any, input)).resolves.toEqual({
      state: 'replay',
      responseBody: { ...response, replayed: true },
    });
  });

  it('recovers a completed core request when the operation journal is still processing', async () => {
    const db = fakeDb([
      {
        match: (sql, method) => method === 'run' && sql.includes('INSERT OR IGNORE INTO inventory_issue_operation'),
        run: () => ({ meta: { changes: 0 } }),
      },
      {
        match: (sql, method) => method === 'first' && sql.includes('FROM inventory_issue_operation'),
        first: () => ({ request_hash: 'hash-a', status: 'processing', response_json: null, attempt_no: 1 }),
      },
      {
        match: (sql, method) => method === 'first' && sql.includes('FROM InventoryConsumption IC'),
        first: (args) => {
          expect(args).toEqual(['tenant-a', 'issue-key-0001']);
          return {
            ConsumptionId: 88,
            ConsumptionNo: 'ISS-88',
            TotalCost: 50,
            TotalCharge: 0,
            OperationKey: 'issue-key-0001',
            billed_lines: 0,
          };
        },
      },
      {
        match: (sql, method) => method === 'run' && sql.includes("SET status = 'recovered'"),
        run: (args) => {
          expect(args.slice(-3)).toEqual(['tenant-a', 'issue-key-0001', 'hash-a']);
          return { meta: { changes: 1 } };
        },
      },
    ]);

    await expect(reserveInventoryIssueOperation(db as any, input)).resolves.toEqual({
      state: 'replay',
      responseBody: {
        message: 'Inventory issue recorded',
        ConsumptionId: 88,
        IssueNo: 'ISS-88',
        OperationKey: 'issue-key-0001',
        totalCost: 50,
        totalCharge: 0,
        billedLines: 0,
        replayed: true,
      },
    });
  });

  it('reopens a failed operation with the same request and increments attempts', async () => {
    const db = fakeDb([
      {
        match: (sql, method) => method === 'run' && sql.includes('INSERT OR IGNORE INTO inventory_issue_operation'),
        run: () => ({ meta: { changes: 0 } }),
      },
      {
        match: (sql, method) => method === 'first' && sql.includes('FROM inventory_issue_operation'),
        first: () => ({ request_hash: 'hash-a', status: 'failed', response_json: null, attempt_no: 2 }),
      },
      {
        match: (sql, method) => method === 'run' && sql.includes("SET status = 'pending'") && sql.includes('attempt_no = attempt_no + 1'),
        run: (args) => {
          expect(args).toEqual(['tenant-a', 'issue-key-0001', 'hash-a']);
          return { meta: { changes: 1 } };
        },
      },
    ]);

    await expect(reserveInventoryIssueOperation(db as any, input)).resolves.toEqual({
      state: 'reserved',
      attemptNo: 3,
    });
  });

  it('marks processing, completion and failure only inside the tenant', async () => {
    const db = fakeDb([
      {
        match: (sql, method) => method === 'run' && sql.includes("SET status = 'processing'"),
        run: (args) => {
          expect(args).toEqual(['tenant-a', 'issue-key-0001', 'hash-a']);
          return { meta: { changes: 1 } };
        },
      },
      {
        match: (sql, method) => method === 'run' && sql.includes("SET status = 'completed'"),
        run: (args) => {
          expect(args.slice(-3)).toEqual(['tenant-a', 'issue-key-0001', 'hash-a']);
          return { meta: { changes: 1 } };
        },
      },
      {
        match: (sql, method) => method === 'run' && sql.includes("SET status = 'failed'"),
        run: (args) => {
          expect(args).toEqual(['stock conflict', 'tenant-a', 'issue-key-0001', 'hash-a']);
          return { meta: { changes: 1 } };
        },
      },
    ]);

    await markInventoryIssueOperationProcessing(db as any, {
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    });
    await completeInventoryIssueOperation(db as any, {
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      consumptionId: 77,
      issueNo: 'ISS-77',
      responseBody: { ok: true },
    });
    await failInventoryIssueOperation(db as any, {
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      error: 'stock conflict',
    });
  });
});

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import { issueInvoice } from '../../src/lib/canonical/commands/issue-invoice';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((v) => v === undefined ? null : v) as SqlValue[]);
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      UNIQUE (tenant_id, source_id)
    );
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','svc-1','laboratory','Synthetic Service','service','active','${'a'.repeat(64)}');
    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,service_public_id,event_type,quantity,status,
      occurred_at_utc,source_evidence_sha256
    ) VALUES
      ('tenant-a','evt-1','svc-1','completed',2,'posted','2026-07-14T03:00:00.000Z','${'b'.repeat(64)}'),
      ('tenant-a','evt-2','svc-1','completed',1,'posted','2026-07-14T03:05:00.000Z','${'c'.repeat(64)}');
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    invoicePublicId: 'inv-1',
    invoiceNumber: 'INV-1',
    legacyPatientId: 101,
    currencyCode: 'BDT',
    issuedAtUtc: '2026-07-14T03:10:00.000Z',
    lines: [
      {
        linePublicId: 'line-service-1',
        lineType: 'service' as const,
        serviceEventPublicId: 'evt-1',
        quantity: 2,
        unitAmountMinor: 10000,
        sourceEvidenceSha256: 'd'.repeat(64),
      },
      {
        linePublicId: 'line-discount-1',
        lineType: 'discount' as const,
        adjustmentCode: 'MANUAL_DISCOUNT',
        quantity: 1,
        unitAmountMinor: -2000,
        sourceEvidenceSha256: 'e'.repeat(64),
      },
      {
        linePublicId: 'line-tax-1',
        lineType: 'tax' as const,
        adjustmentCode: 'VAT',
        quantity: 1,
        unitAmountMinor: 500,
        sourceEvidenceSha256: 'f'.repeat(64),
      },
    ],
    sourceType: 'runtime_invoice',
    sourcePublicId: 'runtime-invoice-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: '1'.repeat(64),
    idempotencyKey: 'issue-invoice-1',
    outboxEventPublicId: 'outbox-issue-invoice-1',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('issue canonical invoice command', () => {
  it('atomically posts exact typed lines, mappings, totals, and PHI-free outbox data', async () => {
    const { sqlite, db } = harness();
    try {
      expect(await issueInvoice(db, input())).toEqual({
        status: 'applied',
        result: {
          invoicePublicId: 'inv-1',
          status: 'posted',
          subtotalMinor: 20000,
          adjustmentTotalMinor: -1500,
          totalMinor: 18500,
        },
      });
      expect(sqlite.prepare(`SELECT subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,status FROM canonical_invoices`).get()).toEqual({
        subtotal_minor: 20000,
        adjustment_total_minor: -1500,
        total_minor: 18500,
        paid_minor: 0,
        due_minor: 18500,
        status: 'posted',
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_invoice_lines')).toBe(3);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='invoice'")).toBe(1);
      const outbox = sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events WHERE idempotency_key='issue-invoice-1'`).get() as { payload_json: string };
      expect(outbox.payload_json).not.toContain('legacyPatientId');
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        adjustmentTotalMinor: -1500,
        invoicePublicId: 'inv-1',
        status: 'posted',
        subtotalMinor: 20000,
        totalMinor: 18500,
      });
    } finally { sqlite.close(); }
  });

  it('replays safely and rejects semantic idempotency conflicts', async () => {
    const { sqlite, db } = harness();
    try {
      await issueInvoice(db, input());
      expect(await issueInvoice(db, input())).toMatchObject({ status: 'replayed' });
      await expect(issueInvoice(db, input({ invoiceNumber: 'INV-CHANGED' }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_invoices')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('rejects duplicate service-event billing and rolls back the second invoice', async () => {
    const { sqlite, db } = harness();
    try {
      await issueInvoice(db, input());
      await expect(issueInvoice(db, input({
        invoicePublicId: 'inv-2',
        invoiceNumber: 'INV-2',
        sourcePublicId: 'runtime-invoice-2',
        sourceEvidenceSha256: '2'.repeat(64),
        idempotencyKey: 'issue-invoice-2',
        outboxEventPublicId: 'outbox-issue-invoice-2',
      }))).rejects.toThrow(/UNIQUE constraint failed/);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_invoices')).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='issue-invoice-2'")).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rejects duplicate line ids and duplicate invoice numbers without partial state', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(issueInvoice(db, input({
        lines: [
          {
            linePublicId: 'line-duplicate',
            lineType: 'service',
            serviceEventPublicId: 'evt-1',
            quantity: 2,
            unitAmountMinor: 10000,
            sourceEvidenceSha256: '3'.repeat(64),
          },
          {
            linePublicId: 'line-duplicate',
            lineType: 'tax',
            adjustmentCode: 'VAT',
            quantity: 1,
            unitAmountMinor: 500,
            sourceEvidenceSha256: '4'.repeat(64),
          },
        ],
      }))).rejects.toThrow(/duplicate linePublicId/);
      await issueInvoice(db, input());
      await expect(issueInvoice(db, input({
        invoicePublicId: 'inv-2',
        sourcePublicId: 'runtime-invoice-2',
        sourceEvidenceSha256: '2'.repeat(64),
        idempotencyKey: 'issue-invoice-2',
        outboxEventPublicId: 'outbox-issue-invoice-2',
        lines: [{
          linePublicId: 'line-service-2',
          lineType: 'service',
          serviceEventPublicId: 'evt-2',
          quantity: 1,
          unitAmountMinor: 10000,
          sourceEvidenceSha256: '5'.repeat(64),
        }],
      }))).rejects.toThrow(/UNIQUE constraint failed/);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_invoices')).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='issue-invoice-2'")).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rejects cross-tenant service-event references atomically', async () => {
    const { sqlite, db } = harness();
    sqlite.exec(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
      ) VALUES ('tenant-b','svc-b','laboratory','Synthetic Service B','service','active','${'6'.repeat(64)}');
      INSERT INTO canonical_service_events (
        tenant_id,event_public_id,service_public_id,event_type,quantity,status,
        occurred_at_utc,source_evidence_sha256
      ) VALUES ('tenant-b','evt-b','svc-b','completed',1,'posted',
                '2026-07-14T03:00:00.000Z','${'7'.repeat(64)}');
    `);
    try {
      await expect(issueInvoice(db, input({
        lines: [{
          linePublicId: 'line-cross-tenant',
          lineType: 'service',
          serviceEventPublicId: 'evt-b',
          quantity: 1,
          unitAmountMinor: 10000,
          sourceEvidenceSha256: '8'.repeat(64),
        }],
      }))).rejects.toThrow(/FOREIGN KEY constraint failed/);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_invoices')).toBe(0);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('rejects missing service events and malformed adjustment signs without writing state', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(issueInvoice(db, input({
        lines: [{
          linePublicId: 'missing-event',
          lineType: 'service',
          serviceEventPublicId: 'evt-missing',
          quantity: 1,
          unitAmountMinor: 10000,
          sourceEvidenceSha256: '3'.repeat(64),
        }],
      }))).rejects.toThrow(/FOREIGN KEY constraint failed/);
      await expect(issueInvoice(db, input({
        lines: [{
          linePublicId: 'bad-discount',
          lineType: 'discount',
          adjustmentCode: 'BAD',
          quantity: 1,
          unitAmountMinor: 100,
          sourceEvidenceSha256: '4'.repeat(64),
        }],
      }))).rejects.toThrow(/discount must be negative/i);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_invoices')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('commits authoritative legacy invoice state and rolls it back on canonical failure', async () => {
    const { sqlite, db } = harness();
    try {
      await issueInvoice(db, input(), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id, source_id) VALUES (?, ?)')
            .bind('tenant-a', 'invoice-success'),
        ],
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);

      await expect(issueInvoice(db, input({
        invoicePublicId: 'inv-failure',
        invoiceNumber: 'INV-FAILURE',
        sourcePublicId: 'runtime-invoice-failure',
        sourceEvidenceSha256: '9'.repeat(64),
        idempotencyKey: 'issue-invoice-failure',
        outboxEventPublicId: 'outbox-issue-invoice-failure',
        lines: [{
          linePublicId: 'line-missing-event',
          lineType: 'service',
          serviceEventPublicId: 'missing-event',
          quantity: 1,
          unitAmountMinor: 1000,
          sourceEvidenceSha256: '8'.repeat(64),
        }],
      }), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_financial (tenant_id, source_id) VALUES (?, ?)')
            .bind('tenant-a', 'invoice-rollback'),
        ],
      })).rejects.toThrow(/FOREIGN KEY constraint failed/);

      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_financial')).toBe(1);
    } finally { sqlite.close(); }
  });
});

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import { buildLegacyLiveInvoiceSourceLineId } from '../../src/lib/canonical/live-invoice-line-identity';
import { prepareCanonicalBillingServiceMapping } from '../../src/lib/canonical/live-service-catalog-recovery';
import { createDeterministicSourceId } from '../../src/lib/canonical/source-mapping';
import {
  createReceptionVisitBilling,
  type CreateReceptionVisitBillingInput,
} from '../../src/lib/canonical/commands/create-reception-visit-billing';

type SqlValue = string | number | bigint | null | Uint8Array;
const NOW = '2026-07-24T03:00:00.000Z';
const DATE = '2026-07-24';
const HASH = 'a'.repeat(64);

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(options: { encounter?: 'mapped' | 'missing' | 'wrong-patient' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
    '0513_canonical_practitioner_compensation.sql',
    '0514_canonical_inventory_links.sql',
    '0515_canonical_accounting_outbox.sql',
    '0532_canonical_financial_batch_assertions.sql',
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));

  sqlite.exec(`
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      department_code TEXT NOT NULL,
      department_name TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      service_department_id INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      invoice_no TEXT NOT NULL
    );
    CREATE TABLE visit_services (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visit_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      description TEXT NOT NULL,
      service_item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      status TEXT NOT NULL,
      bill_id INTEGER
    );
    CREATE TABLE legacy_financial (
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL UNIQUE
    );

    INSERT INTO billing_service_departments VALUES
      (10, '100', 'OPD', 'Outpatient', 1),
      (11, '100', 'LAB', 'Laboratory', 1);
    INSERT INTO billing_service_items VALUES
      (20, '100', 10, 'CONSULT', 'Consultation', 500, 1),
      (21, '100', 11, 'CBC', 'Complete Blood Count', 300, 1);
    INSERT INTO bills VALUES (41, '100', 'INV-1');
    INSERT INTO visit_services VALUES
      (31, '100', 77, 501, 'doctor_visit', 'Consultation', 20, 1, 500, NULL, NULL, 'billed', 41),
      (32, '100', 77, 501, 'test', 'Complete Blood Count', 21, 1, 300, 'lab_order_item', 902, 'billed', 41);
  `);

  if (options.encounter !== 'missing') {
    const patientId = options.encounter === 'wrong-patient' ? 999 : 501;
    sqlite.exec(`
      INSERT INTO canonical_encounters (
        tenant_id, encounter_public_id, legacy_patient_id, encounter_type,
        status, started_at_utc, source_evidence_sha256
      ) VALUES (
        '100', 'enc-visit-77', ${patientId}, 'outpatient',
        'in_progress', '2026-07-24T02:00:00.000Z', '${HASH}'
      );
      INSERT INTO canonical_source_mappings (
        tenant_id, entity_type, canonical_public_id, source_type,
        source_public_id, source_table, mapping_status, mapping_version, evidence_sha256
      ) VALUES (
        '100', 'encounter', 'enc-visit-77', 'legacy_visit',
        '77', 'visits', 'mapped', 1, '${HASH}'
      );
    `);
  }

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
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

function baseInput(overrides: Partial<CreateReceptionVisitBillingInput> = {}): CreateReceptionVisitBillingInput {
  const base: CreateReceptionVisitBillingInput = {
    tenantId: '100',
    commandIdempotencyKey: 'reception-visit-billing:77:INV-1',
    invoiceNo: 'INV-1',
    legacyPatientId: 501,
    legacyVisitId: 77,
    issuedAtUtc: NOW,
    businessDate: DATE,
    billDiscountMinor: 10_000,
    lines: [
      {
        lineNumber: 1,
        visitServiceId: 31,
        billingServiceItemId: 20,
        serviceType: 'doctor_visit',
        description: 'Consultation',
        legacyReferenceId: 20,
        quantity: 1,
        lineTotalMinor: 50_000,
      },
      {
        lineNumber: 2,
        visitServiceId: 32,
        billingServiceItemId: 21,
        serviceType: 'test',
        description: 'Complete Blood Count',
        legacyReferenceId: 902,
        quantity: 1,
        lineTotalMinor: 30_000,
      },
    ],
  };
  return {
    ...base,
    ...overrides,
    lines: overrides.lines ?? base.lines,
  };
}

function authoritativeStatements(db: CanonicalBatchDatabase) {
  return [
    db.prepare("INSERT INTO legacy_financial (tenant_id, source_id) VALUES ('100', 'INV-1')"),
  ];
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number(
    (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
  );
}

describe('createReceptionVisitBilling', () => {
  it('atomically commits visit-service requests, accepted events, mappings and a discounted invoice', async () => {
    const { sqlite, db } = harness();
    try {
      const applied = await createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      });

      expect(applied.result).toMatchObject({
        invoiceNo: 'INV-1',
        encounterPublicId: 'enc-visit-77',
        subtotalMinor: 80_000,
        billDiscountMinor: 10_000,
        totalMinor: 70_000,
      });
      expect(count(sqlite, 'legacy_financial')).toBe(1);
      expect(count(sqlite, 'canonical_service_requests')).toBe(2);
      expect(count(sqlite, 'canonical_service_events')).toBe(2);
      expect(sqlite.prepare(`
        SELECT subtotal_minor, adjustment_total_minor, total_minor, paid_minor, due_minor
        FROM canonical_invoices
      `).get()).toEqual({
        subtotal_minor: 80_000,
        adjustment_total_minor: -10_000,
        total_minor: 70_000,
        paid_minor: 0,
        due_minor: 70_000,
      });
      expect(sqlite.prepare(`
        SELECT entity_type, source_public_id
        FROM canonical_source_mappings
        WHERE source_type = 'legacy_visit_service'
        ORDER BY entity_type, source_public_id
      `).all()).toEqual([
        { entity_type: 'service_event', source_public_id: '31' },
        { entity_type: 'service_event', source_public_id: '32' },
        { entity_type: 'service_request', source_public_id: '31' },
        { entity_type: 'service_request', source_public_id: '32' },
      ]);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('uses the exact legacy invoice source-line identity for each service line', async () => {
    const { sqlite, db } = harness();
    try {
      await createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      const expected = await Promise.all(baseInput().lines.map(async (line) => {
        const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
          lineNumber: line.lineNumber,
          itemCategory: line.serviceType,
          referenceId: line.legacyReferenceId,
        });
        return createDeterministicSourceId(
          'invline',
          '100',
          'legacy_live_bill_line',
          `INV-1:${sourceLineId}`,
        );
      }));
      const actual = sqlite.prepare(`
        SELECT line_public_id
        FROM canonical_invoice_lines
        WHERE line_type = 'service'
        ORDER BY id
      `).all().map((row) => String((row as { line_public_id: string }).line_public_id));
      expect(actual).toEqual(expected);
    } finally {
      sqlite.close();
    }
  });

  it('allows a fully discounted invoice with zero final total', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec("UPDATE bills SET invoice_no='INV-ZERO' WHERE id=41");
      const input = baseInput({
        commandIdempotencyKey: 'reception-visit-billing:77:INV-ZERO',
        invoiceNo: 'INV-ZERO',
        billDiscountMinor: 50_000,
        lines: [baseInput().lines[0]],
      });
      const result = await createReceptionVisitBilling(db, input);
      expect(result.result).toMatchObject({
        subtotalMinor: 50_000,
        billDiscountMinor: 50_000,
        totalMinor: 0,
      });
      expect(sqlite.prepare(`
        SELECT status, total_minor, due_minor FROM canonical_invoices
      `).get()).toEqual({ status: 'posted', total_minor: 0, due_minor: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('replays identical evidence and rejects changed financial evidence under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      const replay = await createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      expect(count(sqlite, 'canonical_invoices')).toBe(1);

      await expect(createReceptionVisitBilling(db, baseInput({
        lines: [{ ...baseInput().lines[0], lineTotalMinor: 51_000 }],
      }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back canonical facts when authoritative legacy SQL fails', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: [db.prepare('INSERT INTO missing_legacy_authority VALUES (1)')],
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_service_requests')).toBe(0);
      expect(count(sqlite, 'canonical_service_events')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails before authoritative writes when the live billing service is inactive', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec('UPDATE billing_service_items SET is_active=0 WHERE id=20');
      await expect(createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      })).rejects.toThrow(/active canonical service/i);
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_service_requests')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails before authoritative writes when an existing canonical service mapping is inactive', async () => {
    const { sqlite, db } = harness();
    try {
      const mapping = await prepareCanonicalBillingServiceMapping(db, {
        tenantId: '100',
        billingServiceItemId: 20,
      });
      await db.batch([...mapping.statements, ...mapping.reconciliationStatements]);
      sqlite.prepare(`
        UPDATE canonical_service_catalog_items
        SET status='inactive'
        WHERE tenant_id='100' AND service_public_id=?
      `).run(mapping.servicePublicId);
      await expect(createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      })).rejects.toThrow(/active canonical service/i);
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the command when a mapped canonical service becomes inactive inside the outer batch', async () => {
    const { sqlite, db } = harness();
    try {
      const mapping = await prepareCanonicalBillingServiceMapping(db, {
        tenantId: '100',
        billingServiceItemId: 20,
      });
      await db.batch([...mapping.statements, ...mapping.reconciliationStatements]);

      await expect(createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: [db.prepare(`
          UPDATE canonical_service_catalog_items
          SET status='inactive'
          WHERE tenant_id='100' AND service_public_id='${mapping.servicePublicId}'
        `)],
      })).rejects.toThrow();
      expect(sqlite.prepare(`
        SELECT status FROM canonical_service_catalog_items
        WHERE tenant_id='100' AND service_public_id=?
      `).get(mapping.servicePublicId)).toEqual({ status: 'active' });
      expect(count(sqlite, 'canonical_service_requests')).toBe(0);
      expect(count(sqlite, 'canonical_service_events')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when a visit service is not committed as billed to the matching invoice', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec("UPDATE visit_services SET status='billing', bill_id=NULL WHERE id=31");
      await expect(createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      })).rejects.toThrow();
      expect(count(sqlite, 'canonical_service_requests')).toBe(0);
      expect(count(sqlite, 'canonical_service_events')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it.each([
    ['missing', { encounter: 'missing' as const }, /encounter mapping/i],
    ['wrong patient', { encounter: 'wrong-patient' as const }, /patient/i],
  ])('fails before authoritative writes for a %s encounter', async (_label, options, message) => {
    const { sqlite, db } = harness(options);
    try {
      await expect(createReceptionVisitBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      })).rejects.toThrow(message);
      expect(count(sqlite, 'legacy_financial')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});

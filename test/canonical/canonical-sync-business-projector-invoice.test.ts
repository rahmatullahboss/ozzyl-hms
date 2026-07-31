import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { projectCanonicalSyncBusinessMutation } from '../../src/lib/canonical/local-sync-business-projector';

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SQLInputValue[] = []) {}
  bind(...params: unknown[]) {
    return new Statement(this.sqlite, this.sql, params.map((value) => value === undefined ? null : value) as SQLInputValue[]);
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE patients (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,sync_key TEXT);
    CREATE TABLE canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,currency_code TEXT NOT NULL,subtotal_minor INTEGER NOT NULL,
      adjustment_total_minor INTEGER NOT NULL,total_minor INTEGER NOT NULL,status TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,line_public_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,
      line_type TEXT NOT NULL,service_event_public_id TEXT,adjustment_code TEXT,
      quantity INTEGER NOT NULL,unit_amount_minor INTEGER NOT NULL,line_amount_minor INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_invoice_encounter_links (
      tenant_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,encounter_public_id TEXT NOT NULL,
      legacy_admission_id INTEGER NOT NULL,link_type TEXT NOT NULL,source_evidence_sha256 TEXT NOT NULL
    );
    CREATE TABLE canonical_encounter_admission_links (
      tenant_id TEXT NOT NULL,encounter_public_id TEXT NOT NULL,legacy_admission_id INTEGER NOT NULL,
      admission_no TEXT NOT NULL
    );
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_invoices VALUES (
      NULL,'100','invoice-1','INV-001',101,'BDT',1000,-100,900,'cancelled',
      '2026-07-25T01:30:00Z','${'a'.repeat(64)}'
    );
    INSERT INTO canonical_invoice_lines VALUES
      (NULL,'100','line-1','invoice-1','service','service-event-1',NULL,1,1000,1000,'${'b'.repeat(64)}'),
      (NULL,'100','line-2','invoice-1','discount',NULL,'DISC',1,-100,-100,'${'c'.repeat(64)}');
    INSERT INTO canonical_invoice_encounter_links VALUES (
      '100','invoice-1','encounter-1',501,'discharge_invoice','${'d'.repeat(64)}'
    );
    INSERT INTO canonical_encounter_admission_links VALUES ('100','encounter-1',501,'ADM-001');
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

function project(db: CanonicalBatchDatabase, event: Record<string, unknown> = {
  invoicePublicId: 'invoice-1',
  status: 'posted',
  subtotalMinor: 1000,
  adjustmentTotalMinor: -100,
  totalMinor: 900,
}) {
  return projectCanonicalSyncBusinessMutation(db, {
    tenantId: '100',
    entityType: 'invoice',
    entityPublicId: 'invoice-1',
    eventType: 'canonical.invoice.issued',
    occurredAtUtc: '2026-07-25T01:30:00Z',
    event,
  });
}

describe('canonical sync invoice business projection', () => {
  it('projects immutable issue-time header, ordered lines, patient identity, and IPD link', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db)).resolves.toEqual({
        kind: 'invoice_issued',
        entityPublicId: 'invoice-1',
        invoiceNumber: 'INV-001',
        patientSyncKey: 'uhid:P-001',
        currencyCode: 'BDT',
        subtotalMinor: 1000,
        adjustmentTotalMinor: -100,
        totalMinor: 900,
        issuedAtUtc: '2026-07-25T01:30:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
        encounterLink: {
          encounterPublicId: 'encounter-1',
          admissionNo: 'ADM-001',
          linkType: 'discharge_invoice',
          sourceEvidenceSha256: 'd'.repeat(64),
        },
        lines: [
          {
            linePublicId: 'line-1', lineType: 'service', serviceEventPublicId: 'service-event-1',
            adjustmentCode: null, quantity: 1, unitAmountMinor: 1000, lineAmountMinor: 1000,
            sourceEvidenceSha256: 'b'.repeat(64),
          },
          {
            linePublicId: 'line-2', lineType: 'discount', serviceEventPublicId: null,
            adjustmentCode: 'DISC', quantity: 1, unitAmountMinor: -100, lineAmountMinor: -100,
            sourceEvidenceSha256: 'c'.repeat(64),
          },
        ],
      });
    } finally { sqlite.close(); }
  });

  it('does not copy current invoice status into the historical issue mutation', async () => {
    const { sqlite, db } = harness();
    try {
      const mutation = await project(db);
      expect(mutation.kind).toBe('invoice_issued');
      expect(mutation).not.toHaveProperty('status');
      expect(mutation).not.toHaveProperty('paidMinor');
    } finally { sqlite.close(); }
  });

  it('fails closed for event/header mismatch or missing patient sync identity', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db, {
        invoicePublicId: 'invoice-1', status: 'posted', subtotalMinor: 999,
        adjustmentTotalMinor: -100, totalMinor: 899,
      })).rejects.toThrow(/event payload/i);
      sqlite.prepare(`UPDATE patients SET sync_key=NULL`).run();
      await expect(project(db)).rejects.toThrow(/patient sync identity/i);
    } finally { sqlite.close(); }
  });

  it('fails closed when the invoice encounter link cannot resolve stable admission identity', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`DELETE FROM canonical_encounter_admission_links`).run();
      await expect(project(db)).rejects.toThrow(/admission identity/i);
    } finally { sqlite.close(); }
  });
});

import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { claimCanonicalSyncInboxEvent, receiveCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-inbox';
import { completeCanonicalSyncBusinessEvent } from '../../src/lib/canonical/local-sync-business-apply';
import { createCanonicalSyncBusinessPayload } from '../../src/lib/canonical/local-sync-business-payload';
import { createCanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SQLInputValue[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.sqlite, this.sql, params.map((v) => v === undefined ? null : v) as SQLInputValue[]); }
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
    CREATE TABLE patients (id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,sync_key TEXT NOT NULL,UNIQUE(tenant_id,sync_key));
    CREATE TABLE canonical_service_events (tenant_id TEXT NOT NULL,event_public_id TEXT NOT NULL,PRIMARY KEY(tenant_id,event_public_id));
    CREATE TABLE canonical_encounter_admission_links (
      tenant_id TEXT NOT NULL,encounter_public_id TEXT NOT NULL,legacy_admission_id INTEGER NOT NULL,
      admission_no TEXT NOT NULL,link_status TEXT NOT NULL,PRIMARY KEY(tenant_id,encounter_public_id)
    );
    CREATE TABLE canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,legacy_patient_id INTEGER NOT NULL,currency_code TEXT NOT NULL,
      subtotal_minor INTEGER NOT NULL,adjustment_total_minor INTEGER NOT NULL,total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,due_minor INTEGER NOT NULL,credited_minor INTEGER NOT NULL,net_due_minor INTEGER NOT NULL,
      adjustment_projection_guard INTEGER NOT NULL,status TEXT NOT NULL,issued_at_utc TEXT NOT NULL,
      posted_at_utc TEXT,cancelled_at_utc TEXT,reversed_at_utc TEXT,source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,updated_at_utc TEXT NOT NULL,UNIQUE(tenant_id,invoice_public_id),UNIQUE(tenant_id,invoice_number)
    );
    CREATE TABLE canonical_invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,line_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,line_type TEXT NOT NULL,service_event_public_id TEXT,adjustment_code TEXT,
      quantity INTEGER NOT NULL,unit_amount_minor INTEGER NOT NULL,line_amount_minor INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,created_at_utc TEXT NOT NULL,updated_at_utc TEXT NOT NULL,
      UNIQUE(tenant_id,line_public_id)
    );
    CREATE TABLE canonical_invoice_encounter_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,
      encounter_public_id TEXT NOT NULL,legacy_admission_id INTEGER NOT NULL,link_type TEXT NOT NULL,
      source_evidence_sha256 TEXT NOT NULL,created_at_utc TEXT NOT NULL,updated_at_utc TEXT NOT NULL,
      UNIQUE(tenant_id,invoice_public_id)
    );
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_service_events VALUES ('100','service-event-1');
    INSERT INTO canonical_encounter_admission_links VALUES ('100','encounter-1',701,'ADM-001','active');
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, db };
}

async function invoiceEnvelope() {
  const event = { invoicePublicId: 'invoice-1', status: 'posted', subtotalMinor: 1000, adjustmentTotalMinor: -100, totalMinor: 900 };
  const mutation = {
    kind: 'invoice_issued', entityPublicId: 'invoice-1', invoiceNumber: 'INV-001', patientSyncKey: 'uhid:P-001',
    currencyCode: 'BDT', subtotalMinor: 1000, adjustmentTotalMinor: -100, totalMinor: 900,
    issuedAtUtc: '2026-07-25T01:30:00Z', sourceEvidenceSha256: 'a'.repeat(64),
    encounterLink: { encounterPublicId: 'encounter-1', admissionNo: 'ADM-001', linkType: 'discharge_invoice', sourceEvidenceSha256: 'd'.repeat(64) },
    lines: [
      { linePublicId: 'line-1', lineType: 'service', serviceEventPublicId: 'service-event-1', adjustmentCode: null, quantity: 1, unitAmountMinor: 1000, lineAmountMinor: 1000, sourceEvidenceSha256: 'b'.repeat(64) },
      { linePublicId: 'line-2', lineType: 'discount', serviceEventPublicId: null, adjustmentCode: 'DISC', quantity: 1, unitAmountMinor: -100, lineAmountMinor: -100, sourceEvidenceSha256: 'c'.repeat(64) },
    ],
  };
  return createCanonicalSyncEnvelope({
    tenantId: '100',eventPublicId: 'outbox-invoice-1',entityType: 'invoice',entityPublicId: 'invoice-1',
    eventType: 'canonical.invoice.issued',aggregateVersion: 1,operation: 'upsert',occurredAtUtc: '2026-07-25T01:30:00Z',
    sourceNodePublicId: 'node-local-1',payload: createCanonicalSyncBusinessPayload({ event, mutation }),
  });
}

async function apply(db: CanonicalBatchDatabase, envelope: Awaited<ReturnType<typeof invoiceEnvelope>>) {
  await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T03:00:00Z');
  const claim = await claimCanonicalSyncInboxEvent(db, {
    tenantId: '100',eventPublicId: envelope.eventPublicId,claimPublicId: 'claim-invoice-1',
    claimOwnerPublicId: 'worker-offline-1',claimedAtUtc: '2026-07-25T03:00:10Z',claimExpiresAtUtc: '2026-07-25T04:00:10Z',
  });
  return completeCanonicalSyncBusinessEvent(db, { envelope, claimPublicId: claim.claimPublicId, appliedAtUtc: '2026-07-25T03:00:20Z' });
}

describe('canonical sync invoice business apply', () => {
  it('applies posted initial header, deterministic lines, and encounter link atomically', async () => {
    const { sqlite, db } = harness();
    try {
      await apply(db, await invoiceEnvelope());
      expect(sqlite.prepare(`SELECT status,paid_minor,due_minor,credited_minor,net_due_minor FROM canonical_invoices`).get())
        .toEqual({ status: 'posted', paid_minor: 0, due_minor: 900, credited_minor: 0, net_due_minor: 900 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_invoice_lines`).get()).toEqual({ count: 2 });
      expect(sqlite.prepare(`SELECT encounter_public_id,legacy_admission_id,link_type FROM canonical_invoice_encounter_links`).get())
        .toEqual({ encounter_public_id: 'encounter-1', legacy_admission_id: 701, link_type: 'discharge_invoice' });
      expect(sqlite.prepare(`SELECT applied_version FROM canonical_sync_entity_versions WHERE entity_type='invoice'`).get())
        .toEqual({ applied_version: 1 });
    } finally { sqlite.close(); }
  });

  it('rolls back every layer when a service-event dependency is missing', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`DELETE FROM canonical_service_events`).run();
      const envelope = await invoiceEnvelope();
      await expect(apply(db, envelope)).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_invoices`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_invoice_lines`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_entity_versions`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-invoice-1'`).get())
        .toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });

  it('rolls back when stable admission identity does not match the encounter link', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE canonical_encounter_admission_links SET admission_no='ADM-OTHER'`).run();
      await expect(apply(db, await invoiceEnvelope())).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_invoices`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_invoice_encounter_links`).get()).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });
});

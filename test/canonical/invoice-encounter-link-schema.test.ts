import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

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
    '0535_canonical_invoice_encounter_links.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  return sqlite;
}

function seedEncounter(
  sqlite: DatabaseSync,
  tenantId: string,
  encounterPublicId: string,
  patientId: number,
): void {
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,'inpatient','in_progress','2026-07-20T00:00:00.000Z',?)
  `).run(tenantId, encounterPublicId, patientId, '1'.repeat(64));
}

function seedInvoice(
  sqlite: DatabaseSync,
  tenantId: string,
  invoicePublicId: string,
  invoiceNumber: string,
  patientId: number,
): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,status,issued_at_utc,
      posted_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,'BDT',10000,0,10000,'posted',?,?,?)
  `).run(
    tenantId,
    invoicePublicId,
    invoiceNumber,
    patientId,
    '2026-07-24T00:00:00.000Z',
    '2026-07-24T00:00:00.000Z',
    '2'.repeat(64),
  );
}

function link(
  sqlite: DatabaseSync,
  input: {
    tenantId: string;
    invoicePublicId: string;
    encounterPublicId: string;
    legacyAdmissionId: number;
    evidence?: string;
  },
): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoice_encounter_links (
      tenant_id,invoice_public_id,encounter_public_id,legacy_admission_id,
      link_type,source_evidence_sha256
    ) VALUES (?,?,?,?,'discharge_invoice',?)
  `).run(
    input.tenantId,
    input.invoicePublicId,
    input.encounterPublicId,
    input.legacyAdmissionId,
    input.evidence ?? '3'.repeat(64),
  );
}

describe('canonical invoice encounter link schema', () => {
  it('declares the discharge invoice authority columns', () => {
    const sqlite = harness();
    try {
      const columns = sqlite.prepare(`
        SELECT name FROM pragma_table_info('canonical_invoice_encounter_links') ORDER BY cid
      `).all().map((row) => String((row as { name: string }).name));
      expect(columns).toEqual(expect.arrayContaining([
        'tenant_id',
        'invoice_public_id',
        'encounter_public_id',
        'legacy_admission_id',
        'link_type',
        'source_evidence_sha256',
      ]));
    } finally {
      sqlite.close();
    }
  });

  it('accepts one tenant-consistent discharge invoice link', () => {
    const sqlite = harness();
    try {
      seedEncounter(sqlite, 'tenant-a', 'enc-a', 101);
      seedInvoice(sqlite, 'tenant-a', 'inv-a', 'INV-A', 101);
      link(sqlite, {
        tenantId: 'tenant-a',
        invoicePublicId: 'inv-a',
        encounterPublicId: 'enc-a',
        legacyAdmissionId: 501,
      });
      expect(sqlite.prepare(`
        SELECT tenant_id,invoice_public_id,encounter_public_id,legacy_admission_id,link_type
        FROM canonical_invoice_encounter_links
      `).get()).toEqual({
        tenant_id: 'tenant-a',
        invoice_public_id: 'inv-a',
        encounter_public_id: 'enc-a',
        legacy_admission_id: 501,
        link_type: 'discharge_invoice',
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects duplicate invoice and duplicate discharge encounter authority', () => {
    const sqlite = harness();
    try {
      seedEncounter(sqlite, 'tenant-a', 'enc-a', 101);
      seedInvoice(sqlite, 'tenant-a', 'inv-a', 'INV-A', 101);
      seedInvoice(sqlite, 'tenant-a', 'inv-b', 'INV-B', 101);
      link(sqlite, {
        tenantId: 'tenant-a',
        invoicePublicId: 'inv-a',
        encounterPublicId: 'enc-a',
        legacyAdmissionId: 501,
      });
      expect(() => link(sqlite, {
        tenantId: 'tenant-a',
        invoicePublicId: 'inv-a',
        encounterPublicId: 'enc-a',
        legacyAdmissionId: 501,
      })).toThrow(/UNIQUE constraint failed/i);
      expect(() => link(sqlite, {
        tenantId: 'tenant-a',
        invoicePublicId: 'inv-b',
        encounterPublicId: 'enc-a',
        legacyAdmissionId: 501,
      })).toThrow(/UNIQUE constraint failed/i);
    } finally {
      sqlite.close();
    }
  });

  it('rejects cross-tenant foreign keys and invalid evidence', () => {
    const sqlite = harness();
    try {
      seedEncounter(sqlite, 'tenant-b', 'enc-b', 202);
      seedInvoice(sqlite, 'tenant-a', 'inv-a', 'INV-A', 101);
      expect(() => link(sqlite, {
        tenantId: 'tenant-a',
        invoicePublicId: 'inv-a',
        encounterPublicId: 'enc-b',
        legacyAdmissionId: 501,
      })).toThrow(/FOREIGN KEY constraint failed/i);

      seedEncounter(sqlite, 'tenant-a', 'enc-a', 101);
      expect(() => link(sqlite, {
        tenantId: 'tenant-a',
        invoicePublicId: 'inv-a',
        encounterPublicId: 'enc-a',
        legacyAdmissionId: 501,
        evidence: 'bad',
      })).toThrow(/CHECK constraint failed/i);
    } finally {
      sqlite.close();
    }
  });
});

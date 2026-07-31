import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';
import {
  listLegacyReceivables,
  majorToMinor,
} from '../../../src/services/actionCenter/collections/legacyAdapter';
import { listCanonicalReceivables } from '../../../src/services/actionCenter/collections/canonicalAdapter';

function createPatients(sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite']): void {
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mobile TEXT
    );
  `);
}

function createLegacyBills(sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite']): void {
  sqlite.exec(`
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      invoice_no TEXT,
      total REAL,
      paid REAL,
      due REAL,
      status TEXT,
      created_at TEXT
    );
  `);
}

function createCanonicalSchema(sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite']): void {
  sqlite.exec(`
    CREATE TABLE canonical_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,
      due_minor INTEGER NOT NULL,
      credited_minor INTEGER NOT NULL,
      net_due_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,
      UNIQUE(tenant_id, invoice_public_id)
    );

    CREATE TABLE canonical_source_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_public_id TEXT,
      source_type TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      source_table TEXT NOT NULL,
      mapping_status TEXT NOT NULL
    );
  `);
}

describe('legacy receivable adapter', () => {
  it('converts legacy major-unit balances to integer minor units deterministically', () => {
    expect(majorToMinor(123.45)).toBe(12_345);
    expect(majorToMinor('10.005')).toBe(1_001);
    expect(majorToMinor('0.1')).toBe(10);
    expect(() => majorToMinor('not-money')).toThrow(/valid monetary value/);
    expect(() => majorToMinor('90071992547409.92')).toThrow(/safe integer/);
  });

  it('returns tenant-scoped legacy invoices with patient contact and stable source identity', async () => {
    const harness = createSqliteD1Harness();
    createPatients(harness.sqlite);
    createLegacyBills(harness.sqlite);

    harness.sqlite.exec(`
      INSERT INTO patients (id, tenant_id, name, mobile) VALUES
        (1, 'tenant-a', 'Alice Patient', '01700000001'),
        (2, 'tenant-b', 'Private Tenant B Patient', '01800000002');

      INSERT INTO bills (
        id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
      ) VALUES
        (101, 'tenant-a', 1, 'INV-101', 123.45, 23.44, 100.01, 'open', '2026-07-14 12:00:00'),
        (102, 'tenant-a', 1, 'INV-102', 10.00, 10.00, 0.00, 'paid', '2026-07-14 12:05:00'),
        (103, 'tenant-a', 1, 'INV-103', 20.00, 0.00, 20.00, 'cancelled', '2026-07-14 12:10:00'),
        (104, 'tenant-a', 1, 'INV-104', 30.00, 0.00, 30.00, 'refunded', '2026-07-14 12:15:00'),
        (105, 'tenant-a', 2, 'INV-105', 40.00, 0.00, 40.00, 'open', '2026-07-14T06:20:00.000Z'),
        (106, 'tenant-a', 1, 'INV-106', 50.00, 0.00, 50.00, 'draft', '2026-07-14 12:25:00'),
        (201, 'tenant-b', 2, 'INV-201', 999.00, 0.00, 999.00, 'open', '2026-07-14 12:30:00');
    `);

    const records = await listLegacyReceivables({
      db: harness.db,
      tenantId: 'tenant-a',
    });

    expect(records.map((record) => record.invoiceNumber)).toEqual([
      'INV-101',
      'INV-102',
      'INV-103',
      'INV-104',
      'INV-105',
    ]);
    expect(records[0]).toEqual({
      source: {
        sourceType: 'invoice',
        legacyBillId: 101,
      },
      invoiceNumber: 'INV-101',
      patientId: 1,
      patientName: 'Alice Patient',
      patientMobile: '01700000001',
      currencyCode: 'BDT',
      totalMinor: 12_345,
      paidMinor: 2_344,
      creditedMinor: 0,
      dueMinor: 10_001,
      issuedAtUtc: '2026-07-14T06:00:00.000Z',
      financialStatus: 'open',
    });
    expect(records[1].financialStatus).toBe('paid');
    expect(records[2].financialStatus).toBe('cancelled');
    expect(records[3].financialStatus).toBe('reversed');
    expect(records[4]).toMatchObject({
      patientName: 'Unknown',
      patientMobile: null,
      issuedAtUtc: '2026-07-14T06:20:00.000Z',
    });
    expect(records.some((record) => record.invoiceNumber === 'INV-201')).toBe(false);
  });
});

describe('canonical receivable adapter', () => {
  it('returns integer canonical projections and mapped legacy identity without recalculating balances', async () => {
    const harness = createSqliteD1Harness();
    createPatients(harness.sqlite);
    createCanonicalSchema(harness.sqlite);

    harness.sqlite.exec(`
      INSERT INTO patients (id, tenant_id, name, mobile) VALUES
        (1, 'tenant-a', 'Alice Patient', '01700000001'),
        (2, 'tenant-b', 'Tenant B Patient', '01800000002');

      INSERT INTO canonical_invoices (
        tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
        currency_code, total_minor, paid_minor, due_minor, credited_minor,
        net_due_minor, status, issued_at_utc
      ) VALUES
        ('tenant-a', 'cinv-001', 'CINV-001', 1, 'BDT', 15000, 5000, 10000, 2000, 8000, 'posted', '2026-07-14T06:00:00.000Z'),
        ('tenant-a', 'cinv-002', 'CINV-002', 1, 'BDT', 1000, 1000, 0, 0, 0, 'posted', '2026-07-14T06:05:00.000Z'),
        ('tenant-a', 'cinv-003', 'CINV-003', 1, 'BDT', 2000, 0, 2000, 0, 2000, 'cancelled', '2026-07-14T06:10:00.000Z'),
        ('tenant-a', 'cinv-004', 'CINV-004', 1, 'BDT', 3000, 0, 3000, 0, 3000, 'reversed', '2026-07-14T06:15:00.000Z'),
        ('tenant-a', 'cinv-005', 'CINV-005', 1, 'BDT', 4000, 0, 4000, 0, 4000, 'draft', '2026-07-14T06:20:00.000Z'),
        ('tenant-b', 'cinv-201', 'CINV-201', 2, 'BDT', 99900, 0, 99900, 0, 99900, 'posted', '2026-07-14T06:25:00.000Z');

      INSERT INTO canonical_source_mappings (
        tenant_id, entity_type, canonical_public_id, source_type,
        source_public_id, source_table, mapping_status
      ) VALUES
        ('tenant-a', 'invoice', 'cinv-001', 'legacy_bill', '101', 'bills', 'mapped'),
        ('tenant-b', 'invoice', 'cinv-201', 'legacy_bill', '201', 'bills', 'mapped');
    `);

    const records = await listCanonicalReceivables({
      db: harness.db,
      tenantId: 'tenant-a',
    });

    expect(records.map((record) => record.invoiceNumber)).toEqual([
      'CINV-001',
      'CINV-002',
      'CINV-003',
      'CINV-004',
    ]);
    expect(records[0]).toEqual({
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-001',
        legacyBillId: 101,
      },
      invoiceNumber: 'CINV-001',
      patientId: 1,
      patientName: 'Alice Patient',
      patientMobile: '01700000001',
      currencyCode: 'BDT',
      totalMinor: 15_000,
      paidMinor: 5_000,
      creditedMinor: 2_000,
      dueMinor: 8_000,
      issuedAtUtc: '2026-07-14T06:00:00.000Z',
      financialStatus: 'open',
    });
    expect(records[1].financialStatus).toBe('paid');
    expect(records[2].financialStatus).toBe('cancelled');
    expect(records[3].financialStatus).toBe('reversed');
    expect(records.some((record) => record.invoiceNumber === 'CINV-201')).toBe(false);
  });

  it('works without source mappings and never leaks another tenant patient', async () => {
    const harness = createSqliteD1Harness();
    createPatients(harness.sqlite);
    harness.sqlite.exec(`
      CREATE TABLE canonical_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        invoice_public_id TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        legacy_patient_id INTEGER NOT NULL,
        currency_code TEXT NOT NULL,
        total_minor INTEGER NOT NULL,
        paid_minor INTEGER NOT NULL,
        due_minor INTEGER NOT NULL,
        credited_minor INTEGER NOT NULL,
        net_due_minor INTEGER NOT NULL,
        status TEXT NOT NULL,
        issued_at_utc TEXT NOT NULL
      );

      INSERT INTO patients (id, tenant_id, name, mobile)
      VALUES (2, 'tenant-b', 'Private Tenant B Patient', '01800000002');

      INSERT INTO canonical_invoices (
        tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
        currency_code, total_minor, paid_minor, due_minor, credited_minor,
        net_due_minor, status, issued_at_utc
      ) VALUES (
        'tenant-a', 'cinv-unmapped', 'CINV-UNMAPPED', 2,
        'BDT', 5000, 0, 5000, 0, 5000, 'posted', '2026-07-14T07:00:00.000Z'
      );
    `);

    const records = await listCanonicalReceivables({
      db: harness.db,
      tenantId: 'tenant-a',
    });

    expect(records).toEqual([expect.objectContaining({
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-unmapped',
      },
      patientName: 'Unknown',
      patientMobile: null,
    })]);
  });

  it('keeps pure canonical receivables readable after the legacy patient table is retired', async () => {
    const harness = createSqliteD1Harness();
    createCanonicalSchema(harness.sqlite);
    harness.sqlite.exec(`
      INSERT INTO canonical_invoices (
        tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
        currency_code, total_minor, paid_minor, due_minor, credited_minor,
        net_due_minor, status, issued_at_utc
      ) VALUES (
        'tenant-a', 'cinv-canonical-only', 'CINV-CANONICAL-ONLY', 909,
        'BDT', 9000, 1000, 8000, 0, 8000, 'posted', '2026-07-14T08:00:00.000Z'
      );
    `);

    const records = await listCanonicalReceivables({
      db: harness.db,
      tenantId: 'tenant-a',
    });

    expect(records).toEqual([expect.objectContaining({
      source: {
        sourceType: 'invoice',
        canonicalInvoicePublicId: 'cinv-canonical-only',
      },
      patientId: 909,
      patientName: 'Unknown',
      patientMobile: null,
      dueMinor: 8000,
    })]);
  });
});

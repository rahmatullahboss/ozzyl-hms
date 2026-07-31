import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';
import { listCollectionCases } from '../../../src/services/actionCenter/collections/query';

const collectionMigration = readFileSync('migrations/0501_collection_cases.sql', 'utf8');

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

function createFeatureFlags(sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite']): void {
  sqlite.exec(`
    CREATE TABLE canonical_feature_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      UNIQUE(tenant_id, flag_key)
    );
  `);
}

function createCanonicalInvoices(
  sqlite: ReturnType<typeof createSqliteD1Harness>['sqlite'],
  options: { adjustments: boolean },
): void {
  const adjustmentColumns = options.adjustments
    ? ', credited_minor INTEGER NOT NULL DEFAULT 0, net_due_minor INTEGER NOT NULL DEFAULT 0'
    : '';
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
      status TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL
      ${adjustmentColumns},
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

function openLegacyHarness() {
  const harness = createSqliteD1Harness();
  createPatients(harness.sqlite);
  createLegacyBills(harness.sqlite);
  harness.sqlite.exec(collectionMigration);
  return harness;
}

function seedLegacyReceivables(harness: ReturnType<typeof openLegacyHarness>): void {
  harness.sqlite.exec(`
    INSERT INTO patients (id, tenant_id, name, mobile) VALUES
      (1, 'tenant-a', 'Patient One', '01700000001'),
      (2, 'tenant-a', 'Patient Two', '01700000002'),
      (3, 'tenant-a', 'Patient Three', '01700000003'),
      (4, 'tenant-a', 'Patient Four', '01700000004'),
      (5, 'tenant-a', 'Patient Five', '01700000005'),
      (20, 'tenant-b', 'Tenant B Patient', '01800000020');

    INSERT INTO bills (
      id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
    ) VALUES
      (1, 'tenant-a', 1, 'INV-001', 10, 0, 10, 'open', '2026-07-14 12:00:00'),
      (2, 'tenant-a', 2, 'INV-002', 20, 0, 20, 'open', '2026-07-05 12:00:00'),
      (3, 'tenant-a', 3, 'INV-003', 30, 0, 30, 'open', '2026-06-10 12:00:00'),
      (4, 'tenant-a', 4, 'INV-004', 40, 0, 40, 'open', '2026-04-01 12:00:00'),
      (5, 'tenant-a', 5, 'INV-005', 50, 0, 50, 'open', '2026-07-14 14:00:00'),
      (6, 'tenant-a', 1, 'INV-PAID', 60, 60, 0, 'paid', '2026-07-14 12:00:00'),
      (7, 'tenant-a', 1, 'INV-CANCELLED', 70, 0, 70, 'cancelled', '2026-07-14 12:00:00'),
      (8, 'tenant-a', 1, 'INV-REFUNDED', 80, 0, 80, 'refunded', '2026-07-14 12:00:00'),
      (9, 'tenant-a', 1, 'INV-DRAFT', 90, 0, 90, 'draft', '2026-07-14 12:00:00'),
      (20, 'tenant-b', 20, 'INV-B-020', 999, 0, 999, 'open', '2026-07-14 12:00:00');

    INSERT INTO collection_cases (
      tenant_id, legacy_bill_id, status, assigned_to, next_followup_at_utc,
      promise_date, promise_amount_minor, currency_code, latest_note
    ) VALUES
      ('tenant-a', 2, 'contacted', 7, NULL, NULL, NULL, NULL, 'Called patient'),
      ('tenant-a', 3, 'promised', 7, '2026-07-14T04:00:00.000Z', '2026-07-20', 1500, 'BDT', 'Promise recorded'),
      ('tenant-a', 4, 'disputed', 8, NULL, NULL, NULL, NULL, 'Invoice disputed');
  `);
}

describe('collection query service', () => {
  it('computes summary over the full filtered legacy dataset while paginating rows', async () => {
    const harness = openLegacyHarness();
    seedLegacyReceivables(harness);

    const result = await listCollectionCases({
      db: harness.db,
      tenantId: 'tenant-a',
      nowUtc: '2026-07-15T00:00:00.000Z',
      query: {
        status: 'active',
        sort: 'exposure',
        page: 1,
        limit: 2,
      },
    });

    expect(result.data).toHaveLength(2);
    expect(result.data.map((row) => row.invoiceNumber)).toEqual(['INV-005', 'INV-004']);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
    });
    expect(result.summary).toEqual({
      totalDueMinor: 15_000,
      totalInvoices: 5,
      currentMinor: 6_000,
      days30Minor: 2_000,
      days60Minor: 3_000,
      days90PlusMinor: 4_000,
      followupDue: 1,
      promisedAmountMinor: 1_500,
      disputedAmountMinor: 4_000,
      currencyCode: 'BDT',
      supportedSourceTypes: ['invoice'],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
      agingCounts: {
        '0-7': 2,
        '8-30': 1,
        '31-60': 1,
        '60+': 1,
      },
      amountsByCurrency: [{
        currencyCode: 'BDT',
        totalDueMinor: 15_000,
        totalInvoices: 5,
        currentMinor: 6_000,
        days30Minor: 2_000,
        days60Minor: 3_000,
        days90PlusMinor: 4_000,
        promisedAmountMinor: 1_500,
        disputedAmountMinor: 4_000,
      }],
    });
    expect(result.data[1]).toMatchObject({
      sourceKey: 'legacy-bill:4',
      collectionStatus: 'disputed',
      assignedTo: 8,
      dueMinor: 4_000,
    });
  });

  it('applies workflow, amount, age, assignee, follow-up, and search filters before totals', async () => {
    const harness = openLegacyHarness();
    seedLegacyReceivables(harness);

    const promised = await listCollectionCases({
      db: harness.db,
      tenantId: 'tenant-a',
      nowUtc: '2026-07-15T00:00:00.000Z',
      query: {
        status: 'promised',
        assignee: 7,
        followup: 'due',
        ageBucket: '31-60',
        minAmountMinor: 2_500,
        maxAmountMinor: 3_500,
        search: '01700000003',
        sort: 'oldest',
        page: 1,
        limit: 10,
      },
    });

    expect(promised.data).toHaveLength(1);
    expect(promised.data[0]).toMatchObject({
      invoiceNumber: 'INV-003',
      collectionStatus: 'promised',
      promiseAmountMinor: 1_500,
      nextFollowupAtUtc: '2026-07-14T04:00:00.000Z',
    });
    expect(promised.summary.totalDueMinor).toBe(3_000);
    expect(promised.summary.totalInvoices).toBe(1);

    const noMatch = await listCollectionCases({
      db: harness.db,
      tenantId: 'tenant-a',
      nowUtc: '2026-07-15T00:00:00.000Z',
      query: {
        status: 'promised',
        search: 'Tenant B Patient',
        page: 1,
        limit: 10,
      },
    });
    expect(noMatch.data).toEqual([]);
    expect(noMatch.summary.totalInvoices).toBe(0);
  });

  it('uses canonical net due projections and returns null currency for mixed currencies', async () => {
    const harness = createSqliteD1Harness();
    createPatients(harness.sqlite);
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, { adjustments: true });
    harness.sqlite.exec(collectionMigration);
    harness.sqlite.exec(`
      INSERT INTO canonical_feature_flags (
        tenant_id, flag_key, domain, mode, is_enabled
      ) VALUES ('tenant-a', 'billing.receivables', 'billing', 'canonical', 1);

      INSERT INTO patients (id, tenant_id, name, mobile) VALUES
        (1, 'tenant-a', 'Canonical Patient', '01700000001'),
        (2, 'tenant-a', 'USD Patient', '01700000002');

      INSERT INTO canonical_invoices (
        tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
        currency_code, total_minor, paid_minor, due_minor, credited_minor,
        net_due_minor, status, issued_at_utc
      ) VALUES
        ('tenant-a', 'cinv-001', 'CINV-001', 1, 'BDT', 10000, 2000, 8000, 1000, 7000, 'posted', '2026-07-14T06:00:00.000Z'),
        ('tenant-a', 'cinv-002', 'CINV-002', 2, 'USD', 5000, 0, 5000, 0, 5000, 'posted', '2026-07-13T06:00:00.000Z'),
        ('tenant-a', 'cinv-paid', 'CINV-PAID', 1, 'BDT', 2000, 2000, 0, 0, 0, 'posted', '2026-07-14T06:00:00.000Z'),
        ('tenant-a', 'cinv-cancelled', 'CINV-CANCELLED', 1, 'BDT', 3000, 0, 3000, 0, 3000, 'cancelled', '2026-07-14T06:00:00.000Z');
    `);

    const result = await listCollectionCases({
      db: harness.db,
      tenantId: 'tenant-a',
      nowUtc: '2026-07-15T00:00:00.000Z',
      query: {
        status: 'active',
        page: 1,
        limit: 10,
      },
    });

    expect(result.data.map((row) => row.invoiceNumber)).toEqual(['CINV-001', 'CINV-002']);
    expect(result.data[0]).toMatchObject({
      sourceKey: 'canonical-invoice:cinv-001',
      totalMinor: 10_000,
      paidMinor: 2_000,
      creditedMinor: 1_000,
      dueMinor: 7_000,
    });
    expect(result.summary).toMatchObject({
      totalDueMinor: null,
      currentMinor: null,
      days30Minor: null,
      days60Minor: null,
      days90PlusMinor: null,
      promisedAmountMinor: null,
      disputedAmountMinor: null,
      totalInvoices: 2,
      currencyCode: null,
      authorityMode: 'canonical',
      amountsByCurrency: [
        {
          currencyCode: 'BDT',
          totalDueMinor: 7_000,
          totalInvoices: 1,
          currentMinor: 7_000,
          days30Minor: 0,
          days60Minor: 0,
          days90PlusMinor: 0,
          promisedAmountMinor: 0,
          disputedAmountMinor: 0,
        },
        {
          currencyCode: 'USD',
          totalDueMinor: 5_000,
          totalInvoices: 1,
          currentMinor: 5_000,
          days30Minor: 0,
          days60Minor: 0,
          days90PlusMinor: 0,
          promisedAmountMinor: 0,
          disputedAmountMinor: 0,
        },
      ],
    });
  });

  it('serves legacy balances in shadow mode and reports mapped canonical mismatches', async () => {
    const harness = openLegacyHarness();
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, { adjustments: false });
    harness.sqlite.exec(`
      INSERT INTO canonical_feature_flags (
        tenant_id, flag_key, domain, mode, is_enabled
      ) VALUES ('tenant-a', 'billing.receivables', 'billing', 'shadow', 1);

      INSERT INTO patients (id, tenant_id, name, mobile) VALUES
        (1, 'tenant-a', 'Shadow Patient', '01700000001');

      INSERT INTO bills (
        id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
      ) VALUES
        (101, 'tenant-a', 1, 'LEG-101', 100, 20, 80, 'open', '2026-07-14 12:00:00'),
        (102, 'tenant-a', 1, 'LEG-102', 50, 0, 50, 'open', '2026-07-14 12:00:00');

      INSERT INTO canonical_invoices (
        tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
        currency_code, total_minor, paid_minor, due_minor, status, issued_at_utc
      ) VALUES
        ('tenant-a', 'cinv-101', 'CAN-101', 1, 'BDT', 10000, 2000, 8000, 'posted', '2026-07-14T06:00:00.000Z'),
        ('tenant-a', 'cinv-102', 'CAN-102', 1, 'BDT', 5000, 0, 4900, 'posted', '2026-07-14T06:00:00.000Z');

      INSERT INTO canonical_source_mappings (
        tenant_id, entity_type, canonical_public_id, source_type,
        source_public_id, source_table, mapping_status
      ) VALUES
        ('tenant-a', 'invoice', 'cinv-101', 'legacy_bill', '101', 'bills', 'mapped'),
        ('tenant-a', 'invoice', 'cinv-102', 'legacy_bill', '102', 'bills', 'mapped');
    `);

    const result = await listCollectionCases({
      db: harness.db,
      tenantId: 'tenant-a',
      nowUtc: '2026-07-15T00:00:00.000Z',
      query: {
        status: 'active',
        sort: 'exposure',
        page: 1,
        limit: 10,
      },
    });

    expect(result.data.map((row) => row.invoiceNumber)).toEqual(['LEG-101', 'LEG-102']);
    expect(result.summary).toMatchObject({
      totalDueMinor: 13_000,
      authorityMode: 'shadow',
      shadowMismatchCount: 1,
    });
  });

  it('prefers a canonical-linked workflow case over a legacy-only collision without duplicating the invoice', async () => {
    const harness = createSqliteD1Harness();
    createPatients(harness.sqlite);
    createFeatureFlags(harness.sqlite);
    createCanonicalInvoices(harness.sqlite, { adjustments: true });
    harness.sqlite.exec(collectionMigration);
    harness.sqlite.exec(`
      INSERT INTO canonical_feature_flags (
        tenant_id, flag_key, domain, mode, is_enabled
      ) VALUES ('tenant-a', 'billing.receivables', 'billing', 'canonical', 1);

      INSERT INTO patients (id, tenant_id, name, mobile)
      VALUES (1, 'tenant-a', 'Mapped Patient', '01700000001');

      INSERT INTO canonical_invoices (
        tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
        currency_code, total_minor, paid_minor, due_minor, credited_minor,
        net_due_minor, status, issued_at_utc
      ) VALUES (
        'tenant-a', 'cinv-101', 'CINV-101', 1,
        'BDT', 10000, 0, 10000, 0, 10000, 'posted', '2026-07-14T06:00:00.000Z'
      );

      INSERT INTO canonical_source_mappings (
        tenant_id, entity_type, canonical_public_id, source_type,
        source_public_id, source_table, mapping_status
      ) VALUES ('tenant-a', 'invoice', 'cinv-101', 'legacy_bill', '101', 'bills', 'mapped');

      INSERT INTO collection_cases (
        tenant_id, legacy_bill_id, status, latest_note
      ) VALUES ('tenant-a', 101, 'contacted', 'Legacy case');

      INSERT INTO collection_cases (
        tenant_id, canonical_invoice_public_id, status, latest_note
      ) VALUES ('tenant-a', 'cinv-101', 'disputed', 'Canonical case');
    `);

    const result = await listCollectionCases({
      db: harness.db,
      tenantId: 'tenant-a',
      nowUtc: '2026-07-15T00:00:00.000Z',
      query: {
        status: 'active',
        page: 1,
        limit: 10,
      },
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      invoiceNumber: 'CINV-101',
      collectionStatus: 'disputed',
      latestNote: 'Canonical case',
    });
  });
});

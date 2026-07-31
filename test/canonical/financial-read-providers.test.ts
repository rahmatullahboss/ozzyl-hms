import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';
import { buildProtectedCoreAuthorityContractFreeze } from '../../scripts/canonical/protected-core-authority-contract-freeze';
import {
  provideInvoiceRead,
  resolveInvoiceProviderMode,
} from '../../src/lib/canonical/contracts/invoice-provider';
import {
  providePaymentRead,
  resolvePaymentProviderMode,
} from '../../src/lib/canonical/contracts/payment-provider';
import {
  provideDepositRead,
  resolveDepositProviderMode,
} from '../../src/lib/canonical/contracts/deposit-provider';
import { runFinancialReadShadowBatch } from '../../src/lib/canonical/financial-read-consumer-adapters';

function harness() {
  const h = createSqliteD1Harness();
  h.sqlite.exec(`
    CREATE TABLE canonical_feature_flags (
      tenant_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      PRIMARY KEY (tenant_id, flag_key)
    );
    CREATE TABLE canonical_source_mappings (
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_public_id TEXT,
      source_type TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      source_table TEXT NOT NULL,
      mapping_status TEXT NOT NULL,
      mapping_version INTEGER NOT NULL,
      evidence_sha256 TEXT,
      PRIMARY KEY (tenant_id, entity_type, source_type, source_public_id)
    );
    CREATE TABLE canonical_reconciliation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      run_public_id TEXT NOT NULL,
      migration_run_id INTEGER,
      domain TEXT NOT NULL,
      reconciliation_type TEXT NOT NULL,
      status TEXT NOT NULL,
      scanned_count INTEGER NOT NULL,
      matched_count INTEGER NOT NULL,
      mismatch_count INTEGER NOT NULL,
      exception_count INTEGER NOT NULL,
      expected_total_minor INTEGER,
      actual_total_minor INTEGER,
      variance_minor INTEGER,
      currency_code TEXT,
      evidence_sha256 TEXT,
      result_summary_json TEXT,
      started_at_utc TEXT NOT NULL,
      completed_at_utc TEXT,
      created_at_utc TEXT,
      updated_at_utc TEXT,
      UNIQUE (tenant_id, run_public_id)
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      invoice_no TEXT,
      total REAL,
      paid REAL,
      due REAL,
      status TEXT NOT NULL,
      cancelled_at TEXT
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      status TEXT
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      receipt_no TEXT,
      date TEXT
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      transaction_type TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      reference_bill_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE canonical_invoices (
      tenant_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      paid_minor INTEGER NOT NULL,
      due_minor INTEGER NOT NULL,
      net_due_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, invoice_public_id)
    );
    CREATE TABLE canonical_invoice_lines (
      tenant_id TEXT NOT NULL,
      line_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id, line_public_id)
    );
    CREATE TABLE canonical_payment_receipts (
      tenant_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      allocated_total_minor INTEGER NOT NULL,
      unallocated_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, receipt_public_id)
    );
    CREATE TABLE canonical_payment_tenders (
      tenant_id TEXT NOT NULL,
      tender_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, tender_public_id)
    );
    CREATE TABLE canonical_payment_allocations (
      tenant_id TEXT NOT NULL,
      allocation_public_id TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, allocation_public_id)
    );
    CREATE TABLE canonical_deposits (
      tenant_id TEXT NOT NULL,
      deposit_public_id TEXT NOT NULL,
      deposit_number TEXT NOT NULL,
      receipt_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      applied_minor INTEGER NOT NULL,
      refunded_minor INTEGER NOT NULL,
      available_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, deposit_public_id)
    );
    CREATE TABLE canonical_deposit_applications (
      tenant_id TEXT NOT NULL,
      application_public_id TEXT NOT NULL,
      deposit_public_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, application_public_id)
    );

    INSERT INTO bills VALUES (10,'tenant-a',101,'INV-10',1200,700,500,'open',NULL);
    INSERT INTO invoice_items VALUES (1,'tenant-a',10,'active'),(2,'tenant-a',10,'active');
    INSERT INTO payments VALUES (20,'tenant-a',10,700,'RCPT-20','2026-07-29 10:00:00');
    INSERT INTO billing_deposits VALUES
      (30,'tenant-a',101,'DEP-30',1000,'deposit',1,NULL,'2026-07-29 09:00:00'),
      (31,'tenant-a',101,'DEP-30',200,'adjustment',1,NULL,'2026-07-29 11:00:00'),
      (32,'tenant-a',101,'DEP-30',100,'refund',1,NULL,'2026-07-29 12:00:00');
    INSERT INTO bills VALUES (11,'tenant-b',999,'INV-10',9999,0,9999,'open',NULL);

    INSERT INTO canonical_invoices VALUES ('tenant-a','inv-public-10','INV-10',101,'BDT',120000,70000,50000,50000,'posted');
    INSERT INTO canonical_invoice_lines VALUES
      ('tenant-a','line-1','inv-public-10'),('tenant-a','line-2','inv-public-10');
    INSERT INTO canonical_payment_receipts VALUES ('tenant-a','receipt-public-20','RCPT-20',101,'BDT',70000,70000,0,'posted');
    INSERT INTO canonical_payment_tenders VALUES ('tenant-a','tender-20','receipt-public-20',70000,'captured');
    INSERT INTO canonical_payment_allocations VALUES ('tenant-a','allocation-20','receipt-public-20','inv-public-10',70000,'active');
    INSERT INTO canonical_deposits VALUES ('tenant-a','deposit-public-30','DEP-30','receipt-dep-30',101,'BDT',100000,20000,10000,70000,'posted');
    INSERT INTO canonical_deposit_applications VALUES ('tenant-a','dep-app-30','deposit-public-30',20000,'active');

    INSERT INTO canonical_source_mappings VALUES
      ('tenant-a','invoice','inv-public-10','legacy_live_bill','INV-10','bills','mapped',1,'${'a'.repeat(64)}'),
      ('tenant-a','payment_receipt','receipt-public-20','legacy_live_payment','RCPT-20','payments','mapped',1,'${'b'.repeat(64)}'),
      ('tenant-a','deposit','deposit-public-30','legacy_live_deposit','DEP-30','billing_deposits','mapped',1,'${'c'.repeat(64)}');
  `);
  return h;
}

function flag(sqlite: ReturnType<typeof harness>['sqlite'], key: string, mode: string, enabled = 1) {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a',?,'finance',?,?, '2026-07-29T00:00:00.000Z','2026-07-29T00:00:00.000Z')
    ON CONFLICT(tenant_id,flag_key) DO UPDATE SET mode=excluded.mode,is_enabled=excluded.is_enabled
  `).run(key, mode, enabled);
}

const evidenceInput = {
  consumerId: 'billing-ui.invoice-detail',
  observedAtUtc: '2026-07-29T16:00:00.000Z',
  elapsedMs: 12,
  latencyBudgetMs: 100,
  buildSha: '4fc0271bb',
} as const;

describe('financial read providers', () => {
  it('defaults all missing or disabled provider flags to legacy', async () => {
    const h = harness();
    try {
      await expect(resolveInvoiceProviderMode(h.db, 'tenant-a')).resolves.toBe('legacy');
      await expect(resolvePaymentProviderMode(h.db, 'tenant-a')).resolves.toBe('legacy');
      await expect(resolveDepositProviderMode(h.db, 'tenant-a')).resolves.toBe('legacy');
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'canonical', 0);
      await expect(resolveInvoiceProviderMode(h.db, 'tenant-a')).resolves.toBe('legacy');
    } finally {
      h.sqlite.close();
    }
  });

  it('returns legacy projections in shadow mode and persists exact zero-variance evidence', async () => {
    const h = harness();
    try {
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'shadow');
      flag(h.sqlite, 'canonical_payment_provider_v1', 'shadow');
      flag(h.sqlite, 'canonical_deposit_provider_v1', 'shadow');

      const invoice = await provideInvoiceRead(h.db, {
        tenantId: 'tenant-a', invoiceNumber: 'INV-10', ...evidenceInput,
      });
      const payment = await providePaymentRead(h.db, {
        tenantId: 'tenant-a', receiptNumber: 'RCPT-20', ...evidenceInput,
        consumerId: 'billing-ui.payment-detail',
      });
      const deposit = await provideDepositRead(h.db, {
        tenantId: 'tenant-a', depositNumber: 'DEP-30', ...evidenceInput,
        consumerId: 'billing-ui.deposit-detail',
      });

      expect(invoice).toMatchObject({
        mode: 'shadow', selectedProvider: 'legacy',
        projection: { rowKey: 'bill:10', totalMinor: 120000, paidMinor: 70000, dueMinor: 50000, lineCount: 2 },
        canonical: { rowKey: 'inv-public-10' },
        shadowEvidence: { parity: true, varianceIds: [], rollbackMode: 'legacy' },
      });
      expect(payment).toMatchObject({
        mode: 'shadow', selectedProvider: 'legacy',
        projection: { rowKey: 'payment:20', totalMinor: 70000, allocatedMinor: 70000, unallocatedMinor: 0 },
        canonical: { rowKey: 'receipt-public-20', tenderCount: 1, allocationCount: 1 },
        shadowEvidence: { parity: true },
      });
      expect(deposit).toMatchObject({
        mode: 'shadow', selectedProvider: 'legacy',
        projection: { rowKey: 'deposit:30', amountMinor: 100000, appliedMinor: 20000, refundedMinor: 10000, availableMinor: 70000 },
        canonical: { rowKey: 'deposit-public-30', applicationCount: 1 },
        shadowEvidence: { parity: true },
      });

      const rows = h.sqlite.prepare(`
        SELECT domain,status,scanned_count,matched_count,mismatch_count,
               expected_total_minor,actual_total_minor,variance_minor,result_summary_json
        FROM canonical_reconciliation_runs ORDER BY domain
      `).all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.status === 'passed' && row.variance_minor === 0)).toBe(true);
      const summaries = rows.map((row) => JSON.parse(String(row.result_summary_json)));
      expect(summaries).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceRowKey: 'deposit:30', canonicalRowKey: 'deposit-public-30', rollbackMode: 'legacy' }),
        expect.objectContaining({ sourceRowKey: 'bill:10', canonicalRowKey: 'inv-public-10', rollbackMode: 'legacy' }),
        expect.objectContaining({ sourceRowKey: 'payment:20', canonicalRowKey: 'receipt-public-20', rollbackMode: 'legacy' }),
      ]));
      expect(JSON.stringify(summaries)).not.toMatch(/patient|name|mobile|address|diagnosis/i);
    } finally {
      h.sqlite.close();
    }
  });

  it('includes active deposit applications in exact legacy invoice settlement totals', async () => {
    const h = harness();
    try {
      h.sqlite.exec(`
        INSERT INTO bills VALUES (12,'tenant-a',101,'INV-12',1000,600,200,'open',NULL);
        INSERT INTO invoice_items VALUES (12,'tenant-a',12,'active');
        INSERT INTO billing_deposits VALUES
          (33,'tenant-a',101,'DEP-33',200,'adjustment',1,12,'2026-07-29 13:00:00');
        INSERT INTO canonical_invoices VALUES
          ('tenant-a','inv-public-12','INV-12',101,'BDT',100000,80000,20000,20000,'posted');
        INSERT INTO canonical_invoice_lines VALUES ('tenant-a','line-12','inv-public-12');
        INSERT INTO canonical_source_mappings VALUES
          ('tenant-a','invoice','inv-public-12','legacy_live_bill','INV-12','bills','mapped',1,'${'d'.repeat(64)}');
      `);
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'shadow');

      const invoice = await provideInvoiceRead(h.db, {
        tenantId: 'tenant-a', invoiceNumber: 'INV-12', ...evidenceInput,
      });

      expect(invoice).toMatchObject({
        selectedProvider: 'legacy',
        projection: { totalMinor: 100000, paidMinor: 80000, dueMinor: 20000 },
        shadowEvidence: { parity: true, varianceIds: [] },
      });
    } finally {
      h.sqlite.close();
    }
  });

  it('runs all six bounded consumer scopes through a real local zero-variance shadow batch', async () => {
    const h = harness();
    try {
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'shadow');
      flag(h.sqlite, 'canonical_payment_provider_v1', 'shadow');
      flag(h.sqlite, 'canonical_deposit_provider_v1', 'shadow');

      const batch = await runFinancialReadShadowBatch(h.db, {
        tenantId: 'tenant-a',
        observedAtUtc: '2026-07-30T00:30:00.000Z',
        latencyBudgetMs: 100,
        buildSha: 'cc5b5f41d',
        records: [
          { provider: 'invoice', consumerKind: 'billing_detail', sourcePublicId: 'INV-10', elapsedMs: 10 },
          { provider: 'invoice', consumerKind: 'report', sourcePublicId: 'INV-10', elapsedMs: 11 },
          { provider: 'payment', consumerKind: 'dashboard', sourcePublicId: 'RCPT-20', elapsedMs: 12 },
          { provider: 'payment', consumerKind: 'export', sourcePublicId: 'RCPT-20', elapsedMs: 13 },
          { provider: 'deposit', consumerKind: 'scheduled_job', sourcePublicId: 'DEP-30', elapsedMs: 14 },
          { provider: 'deposit', consumerKind: 'admin', sourcePublicId: 'DEP-30', elapsedMs: 15 },
        ],
      });

      expect(batch).toMatchObject({
        checkpoint: 'CDB-V1-040B', tenantId: 'tenant-a', buildSha: 'cc5b5f41d',
        recordCount: 6, parity: true, varianceIds: [], rollbackMode: 'legacy',
      });
      expect(batch.rows.map((row) => row.consumerId)).toEqual([
        'cdb040b.billing-detail',
        'cdb040b.report',
        'cdb040b.dashboard',
        'cdb040b.export',
        'cdb040b.scheduled-job',
        'cdb040b.admin',
      ]);
      expect(batch.rows.map((row) => [row.sourceRowKey, row.canonicalRowKey])).toEqual([
        ['bill:10', 'inv-public-10'],
        ['bill:10', 'inv-public-10'],
        ['payment:20', 'receipt-public-20'],
        ['payment:20', 'receipt-public-20'],
        ['deposit:30', 'deposit-public-30'],
        ['deposit:30', 'deposit-public-30'],
      ]);

      const evidenceRows = h.sqlite.prepare(`
        SELECT status,result_summary_json
        FROM canonical_reconciliation_runs
        ORDER BY run_public_id
      `).all() as Array<{ status: string; result_summary_json: string }>;
      expect(evidenceRows).toHaveLength(6);
      expect(evidenceRows.every((row) => row.status === 'passed')).toBe(true);
      const summaries = evidenceRows.map((row) => JSON.parse(row.result_summary_json));
      expect(summaries.every((summary) => summary.buildSha === 'cc5b5f41d' && summary.rollbackMode === 'legacy')).toBe(true);
      expect(JSON.stringify(summaries)).not.toMatch(/patient|mobile|address|diagnosis/i);
    } finally {
      h.sqlite.close();
    }
  });

  it('keeps shadow reads on legacy while recording deterministic money and status variance IDs', async () => {
    const h = harness();
    try {
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'shadow');
      h.sqlite.prepare(`UPDATE canonical_invoices SET paid_minor=71000,due_minor=49000,net_due_minor=49000 WHERE tenant_id='tenant-a'`).run();

      const first = await provideInvoiceRead(h.db, {
        tenantId: 'tenant-a', invoiceNumber: 'INV-10', ...evidenceInput,
      });
      const second = await provideInvoiceRead(h.db, {
        tenantId: 'tenant-a', invoiceNumber: 'INV-10', ...evidenceInput,
      });

      expect(first.selectedProvider).toBe('legacy');
      expect(first.projection.dueMinor).toBe(50000);
      expect(first.shadowEvidence).toMatchObject({ parity: false, criticalUnexplainedVarianceCount: 2 });
      expect(first.shadowEvidence?.varianceIds).toEqual(second.shadowEvidence?.varianceIds);
      const persisted = h.sqlite.prepare(`
        SELECT status,mismatch_count,variance_minor,result_summary_json
        FROM canonical_reconciliation_runs
      `).get() as Record<string, unknown>;
      expect(persisted).toMatchObject({ status: 'failed', mismatch_count: 1, variance_minor: -1000 });
      expect(JSON.parse(String(persisted.result_summary_json))).toMatchObject({
        legacyStatus: 'posted', canonicalStatus: 'posted', legacyTotalMinor: 120000, canonicalTotalMinor: 120000,
      });
    } finally {
      h.sqlite.close();
    }
  });

  it('selects Canonical projections only when explicitly enabled and fails closed on missing exact mappings', async () => {
    const h = harness();
    try {
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'canonical');
      const canonical = await provideInvoiceRead(h.db, {
        tenantId: 'tenant-a', invoiceNumber: 'INV-10', ...evidenceInput,
      });
      expect(canonical).toMatchObject({ mode: 'canonical', selectedProvider: 'canonical', projection: { rowKey: 'inv-public-10' } });

      h.sqlite.prepare(`DELETE FROM canonical_source_mappings WHERE tenant_id='tenant-a' AND entity_type='invoice'`).run();
      await expect(provideInvoiceRead(h.db, {
        tenantId: 'tenant-a', invoiceNumber: 'INV-10', ...evidenceInput,
      })).rejects.toThrow(/exact mapped canonical invoice/i);
    } finally {
      h.sqlite.close();
    }
  });

  it('rolls back immediately to legacy and never crosses tenant scope', async () => {
    const h = harness();
    try {
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'canonical');
      flag(h.sqlite, 'canonical_invoice_provider_v1', 'legacy');
      const rolledBack = await provideInvoiceRead(h.db, {
        tenantId: 'tenant-a', invoiceNumber: 'INV-10', ...evidenceInput,
      });
      expect(rolledBack).toMatchObject({ mode: 'legacy', selectedProvider: 'legacy', projection: { rowKey: 'bill:10', totalMinor: 120000 } });
      const otherTenant = await provideInvoiceRead(h.db, {
        tenantId: 'tenant-b', invoiceNumber: 'INV-10', ...evidenceInput,
      });
      expect(otherTenant).toMatchObject({
        mode: 'legacy', selectedProvider: 'legacy',
        projection: { rowKey: 'bill:11', totalMinor: 999900, paidMinor: 0, dueMinor: 999900 },
      });
    } finally {
      h.sqlite.close();
    }
  });

  it('registers the three finance providers as implemented but production-disabled boundaries', () => {
    const freeze = buildProtectedCoreAuthorityContractFreeze(process.cwd());
    const concepts = new Map(freeze.concepts.map((concept) => [concept.conceptId, concept]));

    for (const conceptId of [
      'invoice_document',
      'payment_receipt_tender_allocation',
      'patient_deposit_liability',
    ]) {
      const concept = concepts.get(conceptId);
      expect(concept?.providerBoundary).toMatchObject({
        implementationStatus: 'existing',
        supportedModes: ['legacy', 'shadow', 'canonical'],
        defaultMode: 'legacy',
        rollbackMode: 'legacy',
        productionEnabled: false,
        activationRequiresSeparateAuthorization: true,
      });
    }
    expect(freeze.summary.existingProviderBoundaryCount).toBe(10);
    expect(freeze.summary.contractOnlyProviderBoundaryCount).toBe(8);
  });
});

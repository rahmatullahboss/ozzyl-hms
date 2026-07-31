import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  getCanonicalDoctorPerformance,
  type CanonicalDoctorPerformanceDatabase,
  type CanonicalDoctorPerformancePreparedStatement,
} from '../../src/lib/canonical/reporting/doctor-performance';
import {
  getCanonicalTestPerformance,
} from '../../src/lib/canonical/reporting/test-performance';
import {
  buildCanonicalIpdFinanceReport,
  classifyCanonicalReportingDifference,
} from '../../src/lib/canonical/reporting/ipd-finance';
import {
  getCanonicalCollectionsReport,
} from '../../src/lib/canonical/reporting/collections';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalDoctorPerformancePreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

const MIGRATIONS = [
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
] as const;

const HASH = 'a'.repeat(64);
const TENANT = 'tenant-a';
const NOW = '2026-07-14T07:00:00.000Z';

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  const db: CanonicalDoctorPerformanceDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
  };
  seedReportingFacts(sqlite);
  return { sqlite, db };
}

function seedReportingFacts(sqlite: DatabaseSync): void {
  const practitioners = [
    ['pract-performer', 'Performer'],
    ['pract-referrer', 'Referrer'],
  ];
  for (const [id, name] of practitioners) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status
      ) VALUES (?,?, 'internal',?,'active')
    `).run(TENANT, id, name);
  }
  const services = [
    ['svc-lab', 'laboratory', 'CBC'],
    ['svc-rad', 'radiology', 'X-Ray'],
    ['svc-consult', 'consultation', 'Consultation'],
  ];
  for (const [id, kind, name] of services) {
    sqlite.prepare(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,
        status,source_evidence_sha256
      ) VALUES (?,?,?,?,?,'each','active',?)
    `).run(TENANT, id, kind, id.toUpperCase(), name, HASH);
  }
  sqlite.exec(`
    INSERT INTO canonical_service_requests (
      tenant_id,request_public_id,legacy_patient_id,service_public_id,
      requested_quantity,fulfilled_quantity,last_event_public_id,status,
      requested_at_utc,source_evidence_sha256
    ) VALUES
      ('${TENANT}','req-lab-1',101,'svc-lab',1,1,NULL,'fulfilled','2026-07-13T18:00:00.000Z','${HASH}'),
      ('${TENANT}','req-lab-2',102,'svc-lab',1,1,'evt-lab-referral','fulfilled','2026-07-14T01:00:00.000Z','${HASH}'),
      ('${TENANT}','req-rad-cancel',103,'svc-rad',1,0,'evt-rad-cancel','cancelled','2026-07-14T01:00:00.000Z','${HASH}'),
      ('${TENANT}','req-lab-next-day',104,'svc-lab',1,1,'evt-lab-next-day','fulfilled','2026-07-14T20:00:00.000Z','${HASH}');

    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,request_public_id,service_public_id,event_type,
      quantity,status,occurred_at_utc,cancelled_at_utc,source_evidence_sha256
    ) VALUES
      ('${TENANT}','evt-lab-accepted','req-lab-1','svc-lab','accepted',1,'posted','2026-07-13T18:30:00.000Z',NULL,'${HASH}'),
      ('${TENANT}','evt-lab-completed','req-lab-1','svc-lab','completed',1,'posted','2026-07-13T19:00:00.000Z',NULL,'${HASH}'),
      ('${TENANT}','evt-lab-referral','req-lab-2','svc-lab','completed',2,'posted','2026-07-14T02:00:00.000Z',NULL,'${HASH}'),
      ('${TENANT}','evt-rad-completed','req-rad-cancel','svc-rad','completed',1,'posted','2026-07-14T01:30:00.000Z',NULL,'${HASH}'),
      ('${TENANT}','evt-rad-cancel','req-rad-cancel','svc-rad','cancelled',1,'cancelled','2026-07-14T02:00:00.000Z','2026-07-14T03:00:00.000Z','${HASH}'),
      ('${TENANT}','evt-lab-next-day','req-lab-next-day','svc-lab','completed',1,'posted','2026-07-14T20:30:00.000Z',NULL,'${HASH}');

    INSERT INTO canonical_service_participants (
      tenant_id,request_public_id,event_public_id,practitioner_public_id,
      participant_role,evidence_type
    ) VALUES
      ('${TENANT}','req-lab-1',NULL,'pract-performer','performing','approved_manual'),
      ('${TENANT}','req-lab-1',NULL,'pract-referrer','referring','approved_manual'),
      ('${TENANT}','req-lab-2',NULL,'pract-referrer','referring','approved_manual'),
      ('${TENANT}','req-lab-2',NULL,'pract-performer','performing','approved_manual'),
      ('${TENANT}','req-rad-cancel',NULL,'pract-performer','performing','approved_manual'),
      ('${TENANT}','req-lab-next-day',NULL,'pract-performer','performing','approved_manual');
  `);

  sqlite.exec(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES
      ('${TENANT}','inv-1','INV-1',101,'BDT',5000,0,5000,5000,0,0,0,1,'posted','${NOW}','${NOW}','${HASH}'),
      ('${TENANT}','inv-2','INV-2',102,'BDT',10000,0,10000,7000,3000,1000,2000,1,'posted','${NOW}','${NOW}','${HASH}');

    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES
      ('${TENANT}','line-lab-1','inv-1','service','evt-lab-completed',NULL,1,5000,5000,'${HASH}'),
      ('${TENANT}','line-lab-2','inv-2','service','evt-lab-referral',NULL,2,5000,10000,'${HASH}');

    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,refunded_minor,
      net_received_minor,refund_projection_guard,source_evidence_sha256
    ) VALUES
      ('${TENANT}','receipt-1','RCP-1',101,'BDT',15000,12000,3000,'posted','${NOW}',
       '2026-07-14','${NOW}',1,2000,13000,1,'${HASH}');

    INSERT INTO canonical_payment_tenders (
      tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
      amount_minor,status,captured_at_utc,reversed_minor,remaining_minor,
      reversal_projection_guard,source_evidence_sha256
    ) VALUES
      ('${TENANT}','tender-cash','receipt-1','cash','cash',5000,'captured','${NOW}',0,5000,1,'${HASH}'),
      ('${TENANT}','tender-card','receipt-1','card','card',10000,'captured','${NOW}',2000,8000,1,'${HASH}');

    INSERT INTO canonical_payment_allocations (
      tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
      invoice_line_public_id,amount_minor,invoice_due_before_minor,
      invoice_due_after_minor,status,allocated_at_utc,reversed_at_utc,
      reversed_minor,remaining_minor,reversal_projection_guard,balance_guard,
      source_evidence_sha256
    ) VALUES
      ('${TENANT}','alloc-line','receipt-1','inv-2','line-lab-2',7000,10000,3000,'active','${NOW}',NULL,2000,5000,1,1,'${HASH}'),
      ('${TENANT}','alloc-invoice','receipt-1','inv-1',NULL,5000,5000,0,'active','${NOW}',NULL,0,5000,1,1,'${HASH}');

    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
      currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
      received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES
      ('${TENANT}','deposit-1','DEP-1','receipt-1',101,'BDT',3000,1000,500,1500,'posted',
       '${NOW}','2026-07-14','${NOW}',1,'${HASH}');

    INSERT INTO canonical_deposit_applications (
      tenant_id,application_public_id,deposit_public_id,invoice_public_id,
      invoice_line_public_id,amount_minor,deposit_available_before_minor,
      deposit_available_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
      invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
      invoice_net_due_after_minor,status,applied_at_utc,balance_guard,source_evidence_sha256
    ) VALUES
      ('${TENANT}','deposit-app-1','deposit-1','inv-2',NULL,1000,2500,1500,6000,7000,
       4000,3000,3000,2000,'active','${NOW}',1,'${HASH}');

    INSERT INTO canonical_credit_notes (
      tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
      legacy_patient_id,currency_code,reason_code,total_minor,
      invoice_credited_before_minor,invoice_credited_after_minor,
      invoice_net_due_before_minor,invoice_net_due_after_minor,status,
      issued_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES
      ('${TENANT}','credit-1','CN-1','inv-2',102,'BDT','billing_correction',1000,
       0,1000,3000,2000,'posted','${NOW}','2026-07-14','${NOW}',1,'${HASH}');

    INSERT INTO canonical_payment_reversals (
      tenant_id,reversal_public_id,receipt_public_id,tender_public_id,
      allocation_public_id,invoice_public_id,amount_minor,reason_code,status,
      reversed_at_utc,business_date,allocation_reversed_before_minor,
      allocation_reversed_after_minor,tender_reversed_before_minor,
      tender_reversed_after_minor,receipt_refunded_before_minor,
      receipt_refunded_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
      invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
      invoice_net_due_after_minor,compensation_guard,balance_guard,source_evidence_sha256
    ) VALUES
      ('${TENANT}','reversal-1','receipt-1','tender-card','alloc-line','inv-2',2000,
       'approved_reversal','posted','${NOW}','2026-07-14',0,2000,0,2000,0,2000,
       7000,5000,3000,5000,2000,4000,1,1,'${HASH}');

    INSERT INTO canonical_refunds (
      tenant_id,refund_public_id,source_type,deposit_public_id,receipt_public_id,
      tender_public_id,allocation_public_id,payment_reversal_public_id,amount_minor,
      tender_type,method_code,status,refunded_at_utc,business_date,reversed_at_utc,
      source_available_before_minor,source_available_after_minor,liability_guard,
      source_evidence_sha256
    ) VALUES
      ('${TENANT}','refund-deposit','deposit','deposit-1',NULL,NULL,NULL,NULL,500,
       'cash','cash','posted','${NOW}','2026-07-14',NULL,2000,1500,1,'${HASH}'),
      ('${TENANT}','refund-payment','payment',NULL,'receipt-1','tender-card','alloc-line',
       'reversal-1',2000,'card','card','posted','${NOW}','2026-07-14',NULL,NULL,NULL,1,'${HASH}');
  `);
}

function readRegistry(): { version: number; metrics: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync('docs/database/metric-registry.yaml', 'utf8')) as {
    version: number;
    metrics: Array<Record<string, unknown>>;
  };
}

describe('canonical reporting parity', () => {
  it('registers every canonical KPI with complete fact, date, role, lifecycle, unit, correction, drill-down, and owner semantics', () => {
    const registry = readRegistry();
    expect(registry.version).toBe(1);
    const requiredKeys = [
      'doctor.performance.performing',
      'doctor.performance.referring',
      'diagnostics.test.volume',
      'diagnostics.test.billed_minor',
      'collections.receipts.gross_minor',
      'collections.allocations.service_minor',
      'collections.deposit.applied_minor',
      'collections.refunds.minor',
      'ipd.finance.admission_balance_minor',
    ];
    expect(registry.metrics.map((metric) => metric.metric_key)).toEqual(expect.arrayContaining(requiredKeys));
    for (const metric of registry.metrics) {
      expect(metric).toEqual(expect.objectContaining({
        metric_key: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
        canonical_fact_source: expect.any(String),
        date_basis: expect.any(String),
        status_filter: expect.any(String),
        tenant_scope: expect.any(String),
        practitioner_role_semantics: expect.any(String),
        quantity_or_amount_expression: expect.any(String),
        refund_cancellation_reversal_rules: expect.any(String),
        drill_down_contract: expect.any(String),
        reconciliation_owner: expect.any(String),
      }));
    }
  });

  it('attributes doctor performance only through the requested explicit practitioner role and shares one row set with the card summary', async () => {
    const { sqlite, db } = harness();
    try {
      const performing = await getCanonicalDoctorPerformance(db, {
        tenantId: TENANT,
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        timeZone: 'Asia/Dhaka',
        practitionerRole: 'performing',
      });
      expect(performing.rows).toEqual([
        expect.objectContaining({
          practitionerPublicId: 'pract-performer',
          practitionerRole: 'performing',
          eventCount: 2,
          quantity: 3,
          billedMinor: 15000,
          currencyCode: 'BDT',
        }),
      ]);
      expect(performing.summary).toEqual({
        practitionerCount: performing.rows.length,
        eventCount: performing.rows.reduce((sum, row) => sum + row.eventCount, 0),
        quantity: performing.rows.reduce((sum, row) => sum + row.quantity, 0),
        billedByCurrency: { BDT: performing.rows.reduce((sum, row) => sum + row.billedMinor, 0) },
        compensationByCurrency: { BDT: 0 },
      });

      const referring = await getCanonicalDoctorPerformance(db, {
        tenantId: TENANT,
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        timeZone: 'Asia/Dhaka',
        practitionerRole: 'referring',
      });
      expect(referring.rows).toEqual([
        expect.objectContaining({ practitionerPublicId: 'pract-referrer', eventCount: 2, quantity: 3 }),
      ]);
      expect(referring.rows.some((row) => row.practitionerPublicId === 'pract-performer')).toBe(false);
    } finally { sqlite.close(); }
  });

  it('includes invoice-line-only compensation accruals after legacy billing cutover', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
          credited_minor,net_due_minor,adjustment_projection_guard,status,
          issued_at_utc,posted_at_utc,source_evidence_sha256
        ) VALUES ('${TENANT}','inv-live','INV-LIVE',106,'BDT',10000,-1000,9000,9000,0,
          0,0,1,'posted','2026-07-14T04:00:00.000Z','2026-07-14T04:00:00.000Z','${HASH}');
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES ('${TENANT}','line-live','inv-live','other_adjustment',NULL,
          'LEGACY_USG',1,10000,10000,'${HASH}');
        INSERT INTO canonical_compensation_rules (
          tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
          practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
          calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
          priority,effective_from,effective_to,status,source_evidence_sha256
        ) VALUES ('${TENANT}','rule-live',1,'all',NULL,NULL,'pract-referrer','referring',
          'commission','basis_points',2500,'remaining_after_performer','deduct','exclude',
          0,NULL,20,'2026-01-01',NULL,'active','${HASH}');
        INSERT INTO canonical_compensation_accruals (
          tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
          service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
          rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
          gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
          earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
          business_date,payable_projection_guard,source_evidence_sha256
        ) VALUES ('${TENANT}','acc-live','inv-live','line-live',NULL,'pract-referrer',
          'referring','commission','rule-live',1,'remaining_after_performer','basis_points',
          2500,'BDT',10000,1000,0,2000,7000,1750,0,0,1750,'accrued',
          '2026-07-14T04:00:00.000Z','2026-07-14',1,'${HASH}');
      `);

      const report = await getCanonicalDoctorPerformance(db, {
        tenantId: TENANT,
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        timeZone: 'Asia/Dhaka',
        practitionerRole: 'referring',
      });

      expect(report.rows).toEqual([
        expect.objectContaining({
          practitionerPublicId: 'pract-referrer',
          eventCount: 3,
          quantity: 4,
          billedMinor: 24000,
          compensationEarnedMinor: 1750,
          currencyCode: 'BDT',
        }),
      ]);
      expect(report.summary.compensationByCurrency).toEqual({ BDT: 1750 });
    } finally { sqlite.close(); }
  });

  it('counts a practitioner once when the same explicit role has multiple currency rows', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,service_public_id,event_type,
          quantity,status,occurred_at_utc,cancelled_at_utc,source_evidence_sha256
        ) VALUES ('${TENANT}','evt-usd',NULL,'svc-lab','completed',1,'posted',
          '2026-07-14T03:00:00.000Z',NULL,'${HASH}');
        INSERT INTO canonical_service_participants (
          tenant_id,request_public_id,event_public_id,practitioner_public_id,
          participant_role,evidence_type
        ) VALUES ('${TENANT}',NULL,'evt-usd','pract-performer','performing','approved_manual');
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
          credited_minor,net_due_minor,adjustment_projection_guard,status,
          issued_at_utc,posted_at_utc,source_evidence_sha256
        ) VALUES ('${TENANT}','inv-usd','INV-USD',105,'USD',1000,0,1000,0,1000,
          0,1000,1,'posted','${NOW}','${NOW}','${HASH}');
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES ('${TENANT}','line-usd','inv-usd','service','evt-usd',NULL,1,1000,1000,'${HASH}');
      `);
      const report = await getCanonicalDoctorPerformance(db, {
        tenantId: TENANT,
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        timeZone: 'Asia/Dhaka',
        practitionerRole: 'performing',
      });
      expect(report.rows).toHaveLength(2);
      expect(report.summary.practitionerCount).toBe(1);
      expect(report.summary.billedByCurrency).toEqual({ BDT: 15000, USD: 1000 });
    } finally { sqlite.close(); }
  });

  it('counts one latest posted diagnostic event per request, excludes cancelled and next-business-day facts, and keeps card/detail parity', async () => {
    const { sqlite, db } = harness();
    try {
      const report = await getCanonicalTestPerformance(db, {
        tenantId: TENANT,
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        timeZone: 'Asia/Dhaka',
      });
      expect(report.rows.map((row) => row.serviceEventPublicId)).toEqual([
        'evt-lab-completed',
        'evt-lab-referral',
      ]);
      expect(report.rows.every((row) => row.itemKind === 'laboratory' || row.itemKind === 'radiology')).toBe(true);
      expect(report.summary).toEqual({
        eventCount: report.rows.length,
        quantity: report.rows.reduce((sum, row) => sum + row.quantity, 0),
        billedByCurrency: { BDT: 15000 },
        unbilledQuantity: 0,
      });
    } finally { sqlite.close(); }
  });

  it('uses one receipt regardless of mixed tenders and reports only persisted service allocations without proportional reconstruction', async () => {
    const { sqlite, db } = harness();
    try {
      const report = await getCanonicalCollectionsReport(db, {
        tenantId: TENANT,
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        currencyCode: 'BDT',
        timeZone: 'Asia/Dhaka',
      });
      const receipt = report.rows.find((row) => row.contributionType === 'receipt');
      expect(receipt).toEqual(expect.objectContaining({
        contributionPublicId: 'receipt-1',
        grossReceivedMinor: 15000,
        unallocatedLiabilityMinor: 3000,
        tenderCount: 2,
      }));
      const allocations = report.rows.filter((row) => row.contributionType === 'allocation');
      expect(allocations).toEqual(expect.arrayContaining([
        expect.objectContaining({ contributionPublicId: 'alloc-line', allocatedMinor: 5000, serviceAllocatedMinor: 5000 }),
        expect.objectContaining({ contributionPublicId: 'alloc-invoice', allocatedMinor: 5000, serviceAllocatedMinor: 0 }),
      ]));
      expect(report.summary).toEqual({
        currencyCode: 'BDT',
        grossReceivedMinor: 15000,
        netReceivedMinor: 13000,
        allocatedMinor: 10000,
        serviceAllocatedMinor: 5000,
        invoiceOnlyAllocatedMinor: 5000,
        unallocatedLiabilityMinor: 3000,
        depositAppliedMinor: 1000,
        creditedMinor: 1000,
        refundedMinor: 2500,
        paymentReversedMinor: 2000,
      });
      expect(report.summary.grossReceivedMinor).toBe(
        report.rows.reduce((sum, row) => sum + row.grossReceivedMinor, 0),
      );
      expect(report.queryContract).toMatchObject({ proportionalAllocationUsed: false, readOnly: true });
    } finally { sqlite.close(); }
  });

  it('isolates tenant and currency and rejects unsafe aggregate overflow', async () => {
    const { sqlite, db } = harness();
    try {
      const empty = await getCanonicalCollectionsReport(db, {
        tenantId: 'tenant-b',
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        currencyCode: 'BDT',
        timeZone: 'Asia/Dhaka',
      });
      expect(empty.rows).toEqual([]);
      expect(empty.summary.grossReceivedMinor).toBe(0);

      sqlite.prepare(`
        UPDATE canonical_payment_receipts
        SET total_minor=?,allocated_total_minor=0,unallocated_minor=?,refunded_minor=0,net_received_minor=?
        WHERE tenant_id=? AND receipt_public_id='receipt-1'
      `).run(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, TENANT);
      sqlite.prepare(`
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,posted_at_utc,reconciliation_guard,refunded_minor,
          net_received_minor,refund_projection_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,1,0,1,'posted',?,?,?,1,0,1,1,?)
      `).run(TENANT, 'receipt-overflow', 'RCP-OVERFLOW', 105, 'BDT', NOW, '2026-07-14', NOW, HASH);
      await expect(getCanonicalCollectionsReport(db, {
        tenantId: TENANT,
        startDate: '2026-07-14',
        endDate: '2026-07-14',
        currencyCode: 'BDT',
        timeZone: 'Asia/Dhaka',
      })).rejects.toThrow(/safe integer|reconcile/i);
    } finally { sqlite.close(); }
  });

  it('builds IPD finance card and drill-down from the same admission projection rows and classifies legacy differences', () => {
    const rows = [
      {
        legacyAdmissionId: 1,
        admissionNo: 'ADM-1',
        encounterPublicId: 'enc-1',
        legacyPatientId: 101,
        status: 'in_progress',
        startedAtUtc: '2026-07-13T19:00:00.000Z',
        endedAtUtc: null,
        summary: {
          currencyCode: 'BDT',
          invoicedGrossMinor: 10000,
          invoicedPaidMinor: 3000,
          invoicedCreditedMinor: 1000,
          invoicedNetDueMinor: 6000,
          unInvoicedServiceMinor: 2000,
          admissionBalanceMinor: 8000,
          paymentAllocatedMinor: 2000,
          depositAppliedMinor: 1000,
          availableDepositMinor: 500,
          potentialAfterAvailableDepositMinor: 7500,
          paymentReversedMinor: 0,
          paymentRefundedMinor: 0,
          compensationEarnedMinor: 100,
          compensationSettledMinor: 0,
          compensationPayableMinor: 100,
        },
        issueCount: 0,
        legacyComparison: {
          legacyPendingMinor: 2500,
          legacyLedgerBalanceMinor: 8500,
          pendingVarianceMinor: 500,
          balanceVarianceMinor: 500,
          classification: 'different' as const,
        },
      },
    ];
    const report = buildCanonicalIpdFinanceReport(rows, {
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      timeZone: 'Asia/Dhaka',
      currencyCode: 'BDT',
    });
    expect(report.rows).toHaveLength(1);
    expect(report.summary.admissionBalanceMinor).toBe(
      report.rows.reduce((sum, row) => sum + row.summary.admissionBalanceMinor, 0),
    );
    expect(report.summary.legacyDifferentCount).toBe(1);
    expect(classifyCanonicalReportingDifference(8000, 8500)).toEqual({
      canonicalMinor: 8000,
      legacyMinor: 8500,
      varianceMinor: 500,
      classification: 'different',
    });
  });

  it('keeps existing active executive report routes unchanged until parity-approved integration', () => {
    const source = readFileSync('src/routes/tenant/reports.ts', 'utf8');
    expect(source).not.toMatch(/canonical\/reporting\/(doctor-performance|test-performance|ipd-finance|collections)/);
  });

  it('executes reporting through read-only database interfaces', async () => {
    const { sqlite, db } = harness();
    try {
      const before = sqlite.prepare(`SELECT total_changes() changes`).get() as { changes: number };
      await getCanonicalDoctorPerformance(db, {
        tenantId: TENANT,startDate: '2026-07-14',endDate: '2026-07-14',timeZone: 'Asia/Dhaka',practitionerRole: 'performing',
      });
      await getCanonicalTestPerformance(db, {
        tenantId: TENANT,startDate: '2026-07-14',endDate: '2026-07-14',timeZone: 'Asia/Dhaka',
      });
      await getCanonicalCollectionsReport(db, {
        tenantId: TENANT,startDate: '2026-07-14',endDate: '2026-07-14',currencyCode: 'BDT',timeZone: 'Asia/Dhaka',
      });
      const after = sqlite.prepare(`SELECT total_changes() changes`).get() as { changes: number };
      expect(after.changes).toBe(before.changes);
    } finally { sqlite.close(); }
  });
});

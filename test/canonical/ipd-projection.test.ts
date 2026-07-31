import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  CanonicalIpdAdmissionNotFoundError,
  listCanonicalIpdAdmissionSummaries,
  projectCanonicalIpdAdmission,
  type CanonicalIpdProjectionDatabase,
  type CanonicalIpdProjectionPreparedStatement,
} from '../../src/lib/canonical/ipd-projection';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalIpdProjectionPreparedStatement {
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
    '0513_canonical_practitioner_compensation.sql',
    '0535_canonical_invoice_encounter_links.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));

  sqlite.exec(`
    CREATE TABLE billing_provisional_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER,
      total_amount REAL NOT NULL,
      bill_status TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_id INTEGER NOT NULL,
      charge_amount REAL NOT NULL,
      is_billed INTEGER NOT NULL
    );
    CREATE TABLE ipd_ledger_entries (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_id INTEGER NOT NULL,
      debit_amount REAL NOT NULL,
      credit_amount REAL NOT NULL
    );
  `);

  const db: CanonicalIpdProjectionDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
  };
  return { sqlite, db };
}

function insertEncounter(
  sqlite: DatabaseSync,
  input: {
    tenantId?: string;
    encounterId?: string;
    admissionId?: number;
    admissionNo?: string;
    patientId?: number;
    status?: 'in_progress' | 'completed';
    encounterType?: 'inpatient' | 'emergency';
    endedAtUtc?: string | null;
  } = {},
): void {
  const tenantId = input.tenantId ?? 'tenant-a';
  const encounterId = input.encounterId ?? 'enc-ipd-1';
  const admissionId = input.admissionId ?? 501;
  const admissionNo = input.admissionNo ?? 'ADM-501';
  const patientId = input.patientId ?? 101;
  const status = input.status ?? 'in_progress';
  const encounterType = input.encounterType ?? 'inpatient';
  const endedAtUtc = input.endedAtUtc ?? null;
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,ended_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,'2026-07-10T02:00:00.000Z',?,?)
  `).run(tenantId, encounterId, patientId, encounterType, status, endedAtUtc, '1'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_encounter_admission_links (
      tenant_id,encounter_public_id,legacy_admission_id,admission_no,link_status,source_evidence_sha256
    ) VALUES (?,?,?,?,'active',?)
  `).run(tenantId, encounterId, admissionId, admissionNo, '2'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_bed_stays (
      tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
      legacy_admission_id,legacy_bed_id,started_at_utc,ended_at_utc,status,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,'2026-07-10T02:00:00.000Z',? ,?,?)
  `).run(
    tenantId,
    `bedstay-${admissionId}`,
    encounterId,
    7000 + admissionId,
    admissionId,
    40 + admissionId,
    endedAtUtc,
    endedAtUtc ? 'completed' : 'active',
    '3'.repeat(64),
  );
}

function insertService(
  sqlite: DatabaseSync,
  input: {
    eventId: string;
    serviceId: string;
    name: string;
    kind: 'laboratory' | 'radiology' | 'consultation' | 'procedure' | 'product' | 'bed';
    amountMinor?: number;
    eventType?: 'completed' | 'delivered' | 'dispensed' | 'occupied';
    encounterId?: string;
    tenantId?: string;
    status?: 'posted' | 'cancelled' | 'reversed';
    occurredAtUtc?: string;
    duplicatePrice?: boolean;
  },
): void {
  const tenantId = input.tenantId ?? 'tenant-a';
  const encounterId = input.encounterId ?? 'enc-ipd-1';
  const occurredAtUtc = input.occurredAtUtc ?? '2026-07-11T03:00:00.000Z';
  sqlite.prepare(`
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES (?,?,?,?, 'service','active',?)
  `).run(tenantId, input.serviceId, input.kind, input.name, '4'.repeat(64));
  if (input.amountMinor !== undefined) {
    const context = input.kind === 'product' ? 'sale' : input.kind === 'bed' ? 'bed_rate' : 'base';
    sqlite.prepare(`
      INSERT INTO canonical_service_prices (
        tenant_id,price_public_id,service_public_id,price_context_type,price_context_key,
        amount_minor,currency_code,valid_from_utc,valid_to_utc,status,source_evidence_sha256
      ) VALUES (?,?,?,?, '',?,'BDT','2026-01-01T00:00:00.000Z',NULL,'active',?)
    `).run(tenantId, `price-${input.eventId}`, input.serviceId, context, input.amountMinor, '5'.repeat(64));
    if (input.duplicatePrice) {
      sqlite.prepare(`
        INSERT INTO canonical_service_prices (
          tenant_id,price_public_id,service_public_id,price_context_type,price_context_key,
          amount_minor,currency_code,valid_from_utc,valid_to_utc,status,source_evidence_sha256
        ) VALUES (?,?,?,?, '',?,'BDT','2026-01-01T00:00:00.000Z',NULL,'active',?)
      `).run(tenantId, `price-duplicate-${input.eventId}`, input.serviceId, context, input.amountMinor + 1, '6'.repeat(64));
    }
  }
  const status = input.status ?? 'posted';
  const cancelledAt = status === 'posted' ? null : '2026-07-12T03:00:00.000Z';
  sqlite.prepare(`
    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,encounter_public_id,service_public_id,event_type,
      quantity,status,occurred_at_utc,cancelled_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,1,?,?,?,?)
  `).run(
    tenantId,
    input.eventId,
    encounterId,
    input.serviceId,
    input.eventType ?? (input.kind === 'product' ? 'dispensed' : input.kind === 'bed' ? 'occupied' : 'completed'),
    status,
    occurredAtUtc,
    cancelledAt,
    '7'.repeat(64),
  );
}

function insertInvoice(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','inv-ipd-1','INV-IPD-1',101,'BDT',5500,-500,5000,2000,3000,
              500,2500,1,'posted','2026-07-11T04:00:00.000Z','2026-07-11T04:00:00.000Z','${'8'.repeat(64)}');
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
    ) VALUES
      ('tenant-a','line-lab','inv-ipd-1','service','evt-lab',NULL,1,5500,5500,'${'9'.repeat(64)}'),
      ('tenant-a','line-discount','inv-ipd-1','discount',NULL,'DISCOUNT',1,-500,-500,'${'a'.repeat(64)}');
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,total_minor,
      allocated_total_minor,unallocated_minor,status,received_at_utc,business_date,posted_at_utc,
      refunded_minor,net_received_minor,refund_projection_guard,reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a','receipt-1','R-1',101,'BDT',1500,1200,300,'posted',
              '2026-07-11T05:00:00.000Z','2026-07-11','2026-07-11T05:00:00.000Z',
              300,1200,1,1,'${'b'.repeat(64)}');
    INSERT INTO canonical_payment_tenders (
      tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,amount_minor,status,
      captured_at_utc,reversed_minor,remaining_minor,reversal_projection_guard,source_evidence_sha256
    ) VALUES ('tenant-a','tender-1','receipt-1','cash','cash',1500,'captured',
              '2026-07-11T05:00:00.000Z',300,1200,1,'${'c'.repeat(64)}');
    INSERT INTO canonical_payment_allocations (
      tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,invoice_line_public_id,
      amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,allocated_at_utc,
      reversed_minor,remaining_minor,reversal_projection_guard,balance_guard,source_evidence_sha256
    ) VALUES ('tenant-a','alloc-1','receipt-1','inv-ipd-1',NULL,1500,5000,3500,'active',
              '2026-07-11T05:00:00.000Z',300,1200,1,1,'${'d'.repeat(64)}');
    INSERT INTO canonical_payment_reversals (
      tenant_id,reversal_public_id,receipt_public_id,tender_public_id,allocation_public_id,
      invoice_public_id,amount_minor,reason_code,status,reversed_at_utc,business_date,
      allocation_reversed_before_minor,allocation_reversed_after_minor,
      tender_reversed_before_minor,tender_reversed_after_minor,
      receipt_refunded_before_minor,receipt_refunded_after_minor,
      invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,invoice_due_after_minor,
      invoice_net_due_before_minor,invoice_net_due_after_minor,compensation_guard,balance_guard,
      source_evidence_sha256
    ) VALUES ('tenant-a','reversal-1','receipt-1','tender-1','alloc-1','inv-ipd-1',300,
              'PATIENT_REFUND','posted','2026-07-12T05:00:00.000Z','2026-07-12',0,300,0,300,
              0,300,2300,2000,2700,3000,2200,2500,1,1,'${'e'.repeat(64)}');
    INSERT INTO canonical_refunds (
      tenant_id,refund_public_id,source_type,receipt_public_id,tender_public_id,allocation_public_id,
      payment_reversal_public_id,amount_minor,tender_type,method_code,status,refunded_at_utc,
      business_date,liability_guard,source_evidence_sha256
    ) VALUES ('tenant-a','refund-payment-1','payment','receipt-1','tender-1','alloc-1',
              'reversal-1',300,'cash','cash','posted','2026-07-12T05:00:00.000Z','2026-07-12',1,'${'f'.repeat(64)}');
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,total_minor,
      allocated_total_minor,unallocated_minor,status,received_at_utc,business_date,posted_at_utc,
      refunded_minor,net_received_minor,refund_projection_guard,reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a','receipt-deposit-1','RD-1',101,'BDT',1500,0,1500,'posted',
              '2026-07-10T04:00:00.000Z','2026-07-10','2026-07-10T04:00:00.000Z',
              400,1100,1,1,'${'1'.repeat(64)}');
    INSERT INTO canonical_deposits (
      tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,currency_code,
      amount_minor,applied_minor,refunded_minor,available_minor,status,received_at_utc,business_date,
      posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a','deposit-1','DEP-1','receipt-deposit-1',101,'BDT',1500,800,400,300,
              'posted','2026-07-10T04:00:00.000Z','2026-07-10','2026-07-10T04:00:00.000Z',1,'${'2'.repeat(64)}');
    INSERT INTO canonical_deposit_applications (
      tenant_id,application_public_id,deposit_public_id,invoice_public_id,invoice_line_public_id,
      amount_minor,deposit_available_before_minor,deposit_available_after_minor,
      invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,invoice_due_after_minor,
      invoice_net_due_before_minor,invoice_net_due_after_minor,status,applied_at_utc,balance_guard,
      source_evidence_sha256
    ) VALUES ('tenant-a','dep-app-1','deposit-1','inv-ipd-1',NULL,800,1100,300,
              1200,2000,3800,3000,3300,2500,'active','2026-07-11T05:30:00.000Z',1,'${'3'.repeat(64)}');
    INSERT INTO canonical_credit_notes (
      tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,legacy_patient_id,
      currency_code,reason_code,total_minor,invoice_credited_before_minor,invoice_credited_after_minor,
      invoice_net_due_before_minor,invoice_net_due_after_minor,status,issued_at_utc,business_date,
      posted_at_utc,reconciliation_guard,source_evidence_sha256
    ) VALUES ('tenant-a','credit-1','CN-1','inv-ipd-1',101,'BDT','SERVICE_ADJUSTMENT',500,
              0,500,3000,2500,'posted','2026-07-11T06:00:00.000Z','2026-07-11',
              '2026-07-11T06:00:00.000Z',1,'${'4'.repeat(64)}');
  `);
}

function seedFullProjection(sqlite: DatabaseSync): void {
  insertEncounter(sqlite);
  insertService(sqlite, { eventId: 'evt-round', serviceId: 'svc-round', name: 'Doctor round', kind: 'consultation', amountMinor: 1000 });
  insertService(sqlite, { eventId: 'evt-lab', serviceId: 'svc-lab', name: 'CBC', kind: 'laboratory', amountMinor: 5500 });
  insertService(sqlite, { eventId: 'evt-radiology', serviceId: 'svc-radiology', name: 'X-Ray', kind: 'radiology', amountMinor: 3000 });
  insertService(sqlite, { eventId: 'evt-procedure', serviceId: 'svc-procedure', name: 'Procedure', kind: 'procedure', amountMinor: 4000 });
  insertService(sqlite, { eventId: 'evt-medicine', serviceId: 'svc-medicine', name: 'Medicine issue', kind: 'product', amountMinor: 500, eventType: 'dispensed' });
  insertService(sqlite, { eventId: 'evt-cancelled', serviceId: 'svc-cancelled', name: 'Cancelled test', kind: 'laboratory', amountMinor: 9000, status: 'cancelled' });
  insertInvoice(sqlite);
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('tenant-a','prac-round','internal','Round Doctor','active');
    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,priority,
      effective_from,effective_to,status,source_evidence_sha256
    ) VALUES ('tenant-a','rule-round',1,'service','svc-round',NULL,'prac-round','performing',
              'professional_fee','fixed',200,'gross','ignore','exclude',0,NULL,10,
              '2026-01-01',NULL,'active','${'5'.repeat(64)}');
    INSERT INTO canonical_compensation_accruals (
      tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,service_event_public_id,
      practitioner_public_id,practitioner_role,accrual_stage,rule_public_id,rule_version,
      calculation_basis,rate_type,rate_value,currency_code,gross_minor,discount_minor,tax_minor,
      performer_reserve_minor,eligible_base_minor,earned_minor,adjusted_minor,settled_minor,
      payable_minor,status,accrued_at_utc,business_date,payable_projection_guard,source_evidence_sha256
    ) VALUES ('tenant-a','comp-round','inv-ipd-1','line-lab','evt-round','prac-round','performing',
              'professional_fee','rule-round',1,'gross','fixed',200,'BDT',1000,0,0,0,1000,
              200,0,50,150,'partially_settled','2026-07-11T03:30:00.000Z','2026-07-11',1,'${'6'.repeat(64)}');
    INSERT INTO billing_provisional_items VALUES (1,'tenant-a',101,501,90,'provisional',1);
    INSERT INTO patient_bed_infos VALUES (1,'tenant-a',501,20,0);
    INSERT INTO ipd_ledger_entries VALUES (1,'tenant-a',501,120,10);
  `);
}

describe('canonical IPD projection', () => {
  it('includes an explicitly linked adjustment-only discharge invoice', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounter(sqlite);
      sqlite.exec(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
          subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
          credited_minor,net_due_minor,adjustment_projection_guard,status,
          issued_at_utc,posted_at_utc,source_evidence_sha256
        ) VALUES (
          'tenant-a','inv-discharge-linked','INV-DISCHARGE-LINKED',101,'BDT',10000,0,
          10000,0,10000,0,10000,1,'posted','2026-07-24T00:00:00.000Z',
          '2026-07-24T00:00:00.000Z','${'8'.repeat(64)}'
        );
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          adjustment_code,quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
        ) VALUES (
          'tenant-a','line-discharge-linked','inv-discharge-linked','other_adjustment',NULL,
          'IPD_DISCHARGE',1,10000,10000,'${'9'.repeat(64)}'
        );
        INSERT INTO canonical_invoice_encounter_links (
          tenant_id,invoice_public_id,encounter_public_id,legacy_admission_id,
          link_type,source_evidence_sha256
        ) VALUES (
          'tenant-a','inv-discharge-linked','enc-ipd-1',501,'discharge_invoice','${'a'.repeat(64)}'
        );
      `);

      const projection = await projectCanonicalIpdAdmission(db, {
        tenantId: 'tenant-a',
        legacyAdmissionId: 501,
        includeLegacyComparison: false,
      });

      expect(projection.invoices).toEqual([
        expect.objectContaining({
          invoicePublicId: 'inv-discharge-linked',
          invoiceNumber: 'INV-DISCHARGE-LINKED',
          totalMinor: 10000,
          netDueMinor: 10000,
        }),
      ]);
      expect(projection.summary).toMatchObject({
        currencyCode: 'BDT',
        invoicedGrossMinor: 10000,
        invoicedPaidMinor: 0,
        invoicedNetDueMinor: 10000,
        admissionBalanceMinor: 10000,
      });
      expect(projection.issues).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('projects an exact emergency-origin admission link as an IPD episode', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounter(sqlite, { encounterType: 'emergency' });
      const projection = await projectCanonicalIpdAdmission(db, {
        tenantId: 'tenant-a',
        legacyAdmissionId: 501,
        includeLegacyComparison: false,
      });
      expect(projection.admission).toMatchObject({
        legacyAdmissionId: 501,
        encounterPublicId: 'enc-ipd-1',
        status: 'in_progress',
      });
    } finally {
      sqlite.close();
    }
  });

  it('derives exact admission balance from canonical services and finance without treating available deposit as payment', async () => {
    const { sqlite, db } = harness();
    seedFullProjection(sqlite);
    try {
      const projection = await projectCanonicalIpdAdmission(db, {
        tenantId: 'tenant-a',
        legacyAdmissionId: 501,
      });

      expect(projection.admission).toMatchObject({
        legacyAdmissionId: 501,
        admissionNo: 'ADM-501',
        encounterPublicId: 'enc-ipd-1',
        legacyPatientId: 101,
        status: 'in_progress',
      });
      expect(projection.bedStays).toHaveLength(1);
      expect(projection.items.filter((item) => item.status === 'projected').map((item) => item.serviceEventPublicId)).toEqual([
        'evt-round',
        'evt-radiology',
        'evt-procedure',
        'evt-medicine',
      ]);
      expect(projection.items.filter((item) => item.status === 'invoiced').map((item) => item.serviceEventPublicId)).toEqual(['evt-lab']);
      expect(projection.summary).toMatchObject({
        currencyCode: 'BDT',
        invoicedGrossMinor: 5000,
        invoicedPaidMinor: 2000,
        invoicedCreditedMinor: 500,
        invoicedNetDueMinor: 2500,
        unInvoicedServiceMinor: 8500,
        admissionBalanceMinor: 11000,
        paymentAllocatedMinor: 1200,
        depositAppliedMinor: 800,
        availableDepositMinor: 300,
        potentialAfterAvailableDepositMinor: 10700,
        paymentReversedMinor: 300,
        paymentRefundedMinor: 300,
        compensationEarnedMinor: 200,
        compensationSettledMinor: 50,
        compensationPayableMinor: 150,
      });
      expect(projection.issues).toEqual([]);
      expect(projection.legacyComparison).toMatchObject({
        legacyPendingMinor: 11000,
        legacyLedgerBalanceMinor: 11000,
        pendingVarianceMinor: 2500,
        balanceVarianceMinor: 0,
        classification: 'different',
      });
    } finally { sqlite.close(); }
  });

  it('does not duplicate an invoiced event in the un-invoiced projection', async () => {
    const { sqlite, db } = harness();
    seedFullProjection(sqlite);
    try {
      const projection = await projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 });
      const labRows = projection.items.filter((item) => item.serviceEventPublicId === 'evt-lab');
      expect(labRows).toHaveLength(1);
      expect(labRows[0]).toMatchObject({ status: 'invoiced', amountMinor: 5500 });
    } finally { sqlite.close(); }
  });

  it('excludes cancelled and reversed service events', async () => {
    const { sqlite, db } = harness();
    insertEncounter(sqlite);
    insertService(sqlite, { eventId: 'evt-cancelled', serviceId: 'svc-cancelled', name: 'Cancelled', kind: 'laboratory', amountMinor: 1000, status: 'cancelled' });
    insertService(sqlite, { eventId: 'evt-reversed', serviceId: 'svc-reversed', name: 'Reversed', kind: 'procedure', amountMinor: 2000, status: 'reversed' });
    try {
      const projection = await projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 });
      expect(projection.items).toEqual([]);
      expect(projection.summary.unInvoicedServiceMinor).toBe(0);
    } finally { sqlite.close(); }
  });

  it('classifies missing or overlapping prices without guessing an amount', async () => {
    const { sqlite, db } = harness();
    insertEncounter(sqlite);
    insertService(sqlite, { eventId: 'evt-unpriced', serviceId: 'svc-unpriced', name: 'Unpriced', kind: 'procedure' });
    insertService(sqlite, { eventId: 'evt-ambiguous', serviceId: 'svc-ambiguous', name: 'Ambiguous', kind: 'laboratory', amountMinor: 1000, duplicatePrice: true });
    try {
      const projection = await projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 });
      expect(projection.summary.unInvoicedServiceMinor).toBe(0);
      expect(projection.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ serviceEventPublicId: 'evt-unpriced', status: 'unpriced', amountMinor: null }),
        expect.objectContaining({ serviceEventPublicId: 'evt-ambiguous', status: 'unpriced', amountMinor: null }),
      ]));
      expect(projection.issues.map((issue) => issue.code).sort()).toEqual([
        'IPD_SERVICE_PRICE_AMBIGUOUS',
        'IPD_SERVICE_PRICE_MISSING',
      ]);
    } finally { sqlite.close(); }
  });

  it('excludes a mixed-encounter invoice rather than attributing its full balance to one admission', async () => {
    const { sqlite, db } = harness();
    insertEncounter(sqlite);
    insertEncounter(sqlite, { encounterId: 'enc-other', admissionId: 502, admissionNo: 'ADM-502', patientId: 101 });
    insertService(sqlite, { eventId: 'evt-a', serviceId: 'svc-a', name: 'A', kind: 'laboratory', amountMinor: 1000 });
    insertService(sqlite, { eventId: 'evt-b', serviceId: 'svc-b', name: 'B', kind: 'procedure', amountMinor: 2000, encounterId: 'enc-other' });
    sqlite.exec(`
      INSERT INTO canonical_invoices (
        tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
        subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
        credited_minor,net_due_minor,adjustment_projection_guard,status,
        issued_at_utc,posted_at_utc,source_evidence_sha256
      ) VALUES ('tenant-a','inv-mixed','INV-MIXED',101,'BDT',3000,0,3000,0,3000,0,3000,1,
                'posted','2026-07-11T04:00:00.000Z','2026-07-11T04:00:00.000Z','${'7'.repeat(64)}');
      INSERT INTO canonical_invoice_lines (
        tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
        quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES
        ('tenant-a','line-a','inv-mixed','service','evt-a',1,1000,1000,'${'8'.repeat(64)}'),
        ('tenant-a','line-b','inv-mixed','service','evt-b',1,2000,2000,'${'9'.repeat(64)}');
    `);
    try {
      const projection = await projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 });
      expect(projection.invoices).toEqual([]);
      expect(projection.summary.invoicedNetDueMinor).toBe(0);
      expect(projection.summary.unInvoicedServiceMinor).toBe(1000);
      expect(projection.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'IPD_MIXED_ENCOUNTER_INVOICE', identity: 'inv-mixed' }),
      ]));
    } finally { sqlite.close(); }
  });

  it('keeps completed admission and exact discharge interval in the projection', async () => {
    const { sqlite, db } = harness();
    insertEncounter(sqlite, { status: 'completed', endedAtUtc: '2026-07-14T05:00:00.000Z' });
    try {
      const projection = await projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 });
      expect(projection.admission).toMatchObject({
        status: 'completed',
        endedAtUtc: '2026-07-14T05:00:00.000Z',
      });
      expect(projection.bedStays[0]).toMatchObject({ status: 'completed', endedAtUtc: '2026-07-14T05:00:00.000Z' });
    } finally { sqlite.close(); }
  });

  it('preserves a signed legacy ledger credit balance for comparison', async () => {
    const { sqlite, db } = harness();
    insertEncounter(sqlite);
    sqlite.prepare(`INSERT INTO ipd_ledger_entries VALUES (1,'tenant-a',501,0,10)`).run();
    try {
      const projection = await projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 });
      expect(projection.legacyComparison).toMatchObject({
        legacyLedgerBalanceMinor: -1000,
        balanceVarianceMinor: -1000,
        classification: 'different',
      });
    } finally { sqlite.close(); }
  });

  it('rejects cross-tenant or unknown admission identities', async () => {
    const { sqlite, db } = harness();
    insertEncounter(sqlite, { tenantId: 'tenant-b' });
    try {
      await expect(projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 }))
        .rejects.toBeInstanceOf(CanonicalIpdAdmissionNotFoundError);
    } finally { sqlite.close(); }
  });

  it('builds list cards from the same projection summary as drill-down', async () => {
    const { sqlite, db } = harness();
    seedFullProjection(sqlite);
    try {
      const list = await listCanonicalIpdAdmissionSummaries(db, { tenantId: 'tenant-a', includeCompleted: false });
      const detail = await projectCanonicalIpdAdmission(db, { tenantId: 'tenant-a', legacyAdmissionId: 501 });
      expect(list).toHaveLength(1);
      expect(list[0].summary).toEqual(detail.summary);
      expect(list[0].legacyAdmissionId).toBe(501);
    } finally { sqlite.close(); }
  });
});

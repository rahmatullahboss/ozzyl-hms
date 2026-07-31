import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

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
  '0533_canonical_credit_note_cash_refunds.sql',
] as const;

function harness(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  return sqlite;
}

const HASH = 'a'.repeat(64);
const NOW = '2026-07-23T11:00:00.000Z';
const DATE = '2026-07-23';

function seedAuthority(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
      credited_minor,net_due_minor,adjustment_projection_guard,status,
      issued_at_utc,posted_at_utc,source_evidence_sha256
    ) VALUES ('100','inv-1','INV-1',101,'BDT',10000,0,10000,8000,2000,0,2000,1,
      'posted',?,?,?)
  `).run(NOW, NOW, HASH);
  sqlite.prepare(`
    INSERT INTO canonical_credit_notes (
      tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
      legacy_patient_id,currency_code,reason_code,total_minor,
      invoice_credited_before_minor,invoice_credited_after_minor,
      invoice_net_due_before_minor,invoice_net_due_after_minor,status,
      issued_at_utc,business_date,posted_at_utc,reconciliation_guard,
      source_evidence_sha256
    ) VALUES ('100','credit-1','CN-1','inv-1',101,'BDT','approved_refund',5000,
      0,5000,5000,0,'posted',?,?,?,1,?)
  `).run(NOW, DATE, NOW, HASH);
  sqlite.prepare(`
    INSERT INTO canonical_payment_receipts (
      tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
      total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
      business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
      refunded_minor,net_received_minor,refund_projection_guard
    ) VALUES ('100','receipt-1','RCP-1',101,'BDT',8000,8000,0,'posted',?,?,?,1,?,0,8000,1)
  `).run(NOW, DATE, NOW, HASH);
  sqlite.prepare(`
    INSERT INTO canonical_payment_tenders (
      tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
      amount_minor,status,captured_at_utc,source_evidence_sha256,
      reversed_minor,remaining_minor,reversal_projection_guard
    ) VALUES ('100','tender-1','receipt-1','card','visa',8000,'captured',?,?,0,8000,1)
  `).run(NOW, HASH);
  sqlite.prepare(`
    INSERT INTO canonical_payment_allocations (
      tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
      amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,
      allocated_at_utc,balance_guard,source_evidence_sha256,
      reversed_minor,remaining_minor,reversal_projection_guard
    ) VALUES ('100','allocation-1','receipt-1','inv-1',8000,10000,2000,'active',?,1,?,0,8000,1)
  `).run(NOW, HASH);
}

function insertParent(sqlite: DatabaseSync, refundPublicId = 'credit-refund-1', creditNotePublicId = 'credit-1'): void {
  sqlite.prepare(`
    INSERT INTO canonical_credit_note_cash_refunds (
      tenant_id,refund_public_id,credit_note_public_id,invoice_public_id,
      amount_minor,payout_tender_type,payout_method_code,legacy_counter_id,
      legacy_counter_session_id,status,refunded_at_utc,business_date,
      reconciliation_guard,source_evidence_sha256
    ) VALUES ('100',?,?,'inv-1',3000,'cash','cash',12,34,'posted',?,?,1,?)
  `).run(refundPublicId, creditNotePublicId, NOW, DATE, HASH);
}

function insertSlices(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_credit_note_refund_receipts (
      tenant_id,receipt_slice_public_id,refund_public_id,receipt_public_id,
      amount_minor,receipt_refunded_before_minor,receipt_refunded_after_minor,
      receipt_net_received_before_minor,receipt_net_received_after_minor,
      balance_guard,source_evidence_sha256
    ) VALUES ('100','receipt-slice-1','credit-refund-1','receipt-1',3000,
      0,3000,8000,5000,1,?)
  `).run(HASH);
  sqlite.prepare(`
    INSERT INTO canonical_credit_note_refund_allocations (
      tenant_id,allocation_slice_public_id,refund_public_id,receipt_slice_public_id,
      receipt_public_id,allocation_public_id,amount_minor,
      allocation_reversed_before_minor,allocation_reversed_after_minor,
      allocation_remaining_before_minor,allocation_remaining_after_minor,
      balance_guard,source_evidence_sha256
    ) VALUES ('100','allocation-slice-1','credit-refund-1','receipt-slice-1',
      'receipt-1','allocation-1',3000,0,3000,8000,5000,1,?)
  `).run(HASH);
  sqlite.prepare(`
    INSERT INTO canonical_credit_note_refund_tender_attributions (
      tenant_id,tender_attribution_public_id,refund_public_id,receipt_slice_public_id,
      receipt_public_id,tender_public_id,amount_minor,original_tender_type,
      original_method_code,attributable_before_minor,attributable_after_minor,
      balance_guard,source_evidence_sha256
    ) VALUES ('100','tender-attribution-1','credit-refund-1','receipt-slice-1',
      'receipt-1','tender-1',3000,'card','visa',8000,5000,1,?)
  `).run(HASH);
}

describe('canonical credit-note cash refund schema', () => {
  it('creates four tenant-scoped tables and accepts one reconciled mixed-tender payout lineage', () => {
    const sqlite = harness();
    try {
      const tables = sqlite.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name IN (
          'canonical_credit_note_cash_refunds',
          'canonical_credit_note_refund_receipts',
          'canonical_credit_note_refund_allocations',
          'canonical_credit_note_refund_tender_attributions'
        ) ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'canonical_credit_note_cash_refunds',
        'canonical_credit_note_refund_allocations',
        'canonical_credit_note_refund_receipts',
        'canonical_credit_note_refund_tender_attributions',
      ]);

      seedAuthority(sqlite);
      insertParent(sqlite);
      insertSlices(sqlite);

      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_cash_refunds`).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_refund_receipts`).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_refund_allocations`).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_credit_note_refund_tender_attributions`).get() as { count: number }).count)).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('allows only one cash payout authority per canonical credit note', () => {
    const sqlite = harness();
    try {
      seedAuthority(sqlite);
      insertParent(sqlite);
      expect(() => insertParent(sqlite, 'credit-refund-2')).toThrow(/unique/i);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_credit_note_cash_refunds (
          tenant_id,refund_public_id,credit_note_public_id,invoice_public_id,
          amount_minor,payout_tender_type,payout_method_code,legacy_counter_id,
          legacy_counter_session_id,status,refunded_at_utc,business_date,
          reconciliation_guard,source_evidence_sha256
        ) VALUES ('100','credit-refund-card','credit-other','inv-1',1000,'card','visa',12,34,'posted',?,?,1,?)
      `).run(NOW, DATE, HASH)).toThrow(/check|foreign key/i);
    } finally {
      sqlite.close();
    }
  });

  it('rejects cross-tenant lineage and invalid receipt, allocation, or tender balance math', () => {
    const sqlite = harness();
    try {
      seedAuthority(sqlite);
      insertParent(sqlite);

      expect(() => sqlite.prepare(`
        INSERT INTO canonical_credit_note_refund_receipts (
          tenant_id,receipt_slice_public_id,refund_public_id,receipt_public_id,
          amount_minor,receipt_refunded_before_minor,receipt_refunded_after_minor,
          receipt_net_received_before_minor,receipt_net_received_after_minor,
          balance_guard,source_evidence_sha256
        ) VALUES ('other','receipt-slice-x','credit-refund-1','receipt-1',1000,
          0,1000,8000,7000,1,?)
      `).run(HASH)).toThrow(/foreign key/i);

      expect(() => sqlite.prepare(`
        INSERT INTO canonical_credit_note_refund_receipts (
          tenant_id,receipt_slice_public_id,refund_public_id,receipt_public_id,
          amount_minor,receipt_refunded_before_minor,receipt_refunded_after_minor,
          receipt_net_received_before_minor,receipt_net_received_after_minor,
          balance_guard,source_evidence_sha256
        ) VALUES ('100','receipt-slice-bad','credit-refund-1','receipt-1',1000,
          0,999,8000,7000,1,?)
      `).run(HASH)).toThrow(/check/i);

      sqlite.prepare(`
        INSERT INTO canonical_credit_note_refund_receipts (
          tenant_id,receipt_slice_public_id,refund_public_id,receipt_public_id,
          amount_minor,receipt_refunded_before_minor,receipt_refunded_after_minor,
          receipt_net_received_before_minor,receipt_net_received_after_minor,
          balance_guard,source_evidence_sha256
        ) VALUES ('100','receipt-slice-1','credit-refund-1','receipt-1',3000,
          0,3000,8000,5000,1,?)
      `).run(HASH);

      expect(() => sqlite.prepare(`
        INSERT INTO canonical_credit_note_refund_allocations (
          tenant_id,allocation_slice_public_id,refund_public_id,receipt_slice_public_id,
          receipt_public_id,allocation_public_id,amount_minor,
          allocation_reversed_before_minor,allocation_reversed_after_minor,
          allocation_remaining_before_minor,allocation_remaining_after_minor,
          balance_guard,source_evidence_sha256
        ) VALUES ('100','allocation-slice-bad','credit-refund-1','receipt-slice-1',
          'receipt-1','allocation-1',3000,0,3000,8000,4999,1,?)
      `).run(HASH)).toThrow(/check/i);

      expect(() => sqlite.prepare(`
        INSERT INTO canonical_credit_note_refund_tender_attributions (
          tenant_id,tender_attribution_public_id,refund_public_id,receipt_slice_public_id,
          receipt_public_id,tender_public_id,amount_minor,original_tender_type,
          original_method_code,attributable_before_minor,attributable_after_minor,
          balance_guard,source_evidence_sha256
        ) VALUES ('100','tender-attribution-bad','credit-refund-1','receipt-slice-1',
          'receipt-1','tender-1',3000,'card','visa',8000,4999,1,?)
      `).run(HASH)).toThrow(/check/i);
    } finally {
      sqlite.close();
    }
  });
});

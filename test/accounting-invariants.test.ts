import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { runAccountingInvariantChecks } from '../src/lib/accounting-invariants';

describe('accounting invariant checks', () => {
  it('returns failing checks when posting gaps or balance mismatches exist', async () => {
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as unbalanced_voucher_count')) return { first: { unbalanced_voucher_count: 1 } };
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 1000, total_credit: 900 } };
        }
        if (lower.includes('as pending_event_count')) return { first: { pending_event_count: 2 } };
        if (lower.includes('as failed_event_count')) return { first: { failed_event_count: 1 } };
        if (lower.includes('as source_without_voucher_count')) return { first: { source_without_voucher_count: 1 } };
        if (lower.includes('as bill_without_journal_count')) return { first: { bill_without_journal_count: 1 } };
        if (lower.includes('as payment_without_journal_count')) return { first: { payment_without_journal_count: 0 } };
        if (lower.includes('as deposit_without_journal_count')) return { first: { deposit_without_journal_count: 1 } };
        if (lower.includes('as commission_without_journal_count')) return { first: { commission_without_journal_count: 1 } };
        if (lower.includes('as patient_receivable_balance')) return { first: { patient_receivable_balance: 3000 } };
        if (lower.includes('as patient_due_balance')) return { first: { patient_due_balance: 2500 } };
        if (lower.includes('as deposit_liability_balance')) return { first: { deposit_liability_balance: 1500 } };
        if (lower.includes('as deposit_subledger_balance')) return { first: { deposit_subledger_balance: 1500 } };
        if (lower.includes('as doctor_payable_balance')) return { first: { doctor_payable_balance: 700 } };
        if (lower.includes('as doctor_commission_subledger_balance')) return { first: { doctor_commission_subledger_balance: 600 } };
        return { first: { count: 0 } };
      },
    });

    const result = await runAccountingInvariantChecks(db, 'tenant-1');

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.key === 'voucher_balance')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'pending_posting_events')?.count).toBe(2);
    expect(result.checks.find((check) => check.key === 'patient_receivable_reconciliation')?.difference).toBe(500);
    expect(result.checks.find((check) => check.key === 'deposit_liability_reconciliation')?.status).toBe('pass');
  });

  it('detects supplier payable posting and reconciliation gaps', async () => {
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as supplier_payment_without_journal_count')) {
          return { first: { supplier_payment_without_journal_count: 1 } };
        }
        if (lower.includes('as supplier_payable_balance')) {
          return { first: { supplier_payable_balance: 500 } };
        }
        if (lower.includes('as supplier_due_balance')) {
          return { first: { supplier_due_balance: 750 } };
        }
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 0, total_credit: 0 } };
        }
        return { first: { count: 0 } };
      },
    });

    const result = await runAccountingInvariantChecks(db, 'tenant-1');

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.key === 'supplier_payment_source_has_journal')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'supplier_payable_reconciliation')?.difference).toBe(-250);
  });

  it('detects credit notes without accounting vouchers', async () => {
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as credit_note_without_journal_count')) {
          return { first: { credit_note_without_journal_count: 1 } };
        }
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 0, total_credit: 0 } };
        }
        return { first: { count: 0 } };
      },
    });

    const result = await runAccountingInvariantChecks(db, 'tenant-1');

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.key === 'credit_note_source_has_journal')?.status).toBe('fail');
  });

  it('detects settlement discounts without accounting vouchers', async () => {
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as settlement_discount_without_journal_count')) {
          return { first: { settlement_discount_without_journal_count: 1 } };
        }
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 0, total_credit: 0 } };
        }
        return { first: { count: 0 } };
      },
    });

    const result = await runAccountingInvariantChecks(db, 'tenant-1');

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.key === 'settlement_discount_source_has_journal')?.status).toBe('fail');
  });

  it('detects database-level accounting integrity and duplicate-key risks', async () => {
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as orphan_journal_line_count')) return { first: { orphan_journal_line_count: 1 } };
        if (lower.includes('as duplicate_voucher_number_count')) return { first: { duplicate_voucher_number_count: 1 } };
        if (lower.includes('as missing_ledger_immutability_trigger_count')) return { first: { missing_ledger_immutability_trigger_count: 2 } };
        if (lower.includes('as duplicate_payment_receipt_count')) return { first: { duplicate_payment_receipt_count: 1 } };
        if (lower.includes('as duplicate_deposit_receipt_count')) return { first: { duplicate_deposit_receipt_count: 1 } };
        if (lower.includes('as duplicate_external_transaction_count')) return { first: { duplicate_external_transaction_count: 1 } };
        if (lower.includes('as invalid_journal_account_count')) return { first: { invalid_journal_account_count: 1 } };
        if (lower.includes('as inactive_account_posting_count')) return { first: { inactive_account_posting_count: 1 } };
        if (lower.includes('as invalid_journal_line_amount_count')) return { first: { invalid_journal_line_amount_count: 1 } };
        if (lower.includes('as negative_operational_amount_count')) return { first: { negative_operational_amount_count: 1 } };
        if (lower.includes('as deposit_payment_method_count')) return { first: { deposit_payment_method_count: 1 } };
        if (lower.includes('as active_manual_provisional_item_count')) return { first: { active_manual_provisional_item_count: 1 } };
        if (lower.includes('as discharged_pending_billing_count')) return { first: { discharged_pending_billing_count: 1 } };
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 0, total_credit: 0 } };
        }
        return { first: { count: 0 } };
      },
    });

    const result = await runAccountingInvariantChecks(db, 'tenant-1');

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.key === 'orphan_journal_lines')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'duplicate_voucher_numbers')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'ledger_immutability_triggers')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'duplicate_payment_receipts')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'duplicate_deposit_receipts')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'duplicate_external_transactions')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'invalid_journal_accounts')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'inactive_account_postings')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'invalid_journal_line_amounts')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'negative_operational_amounts')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'deposit_payment_method_rows')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'catalog_backed_provisional_items')?.status).toBe('fail');
    expect(result.checks.find((check) => check.key === 'discharged_pending_billing_items')?.status).toBe('fail');
  });

  it('only treats financially pending bed rows as discharged billing gaps', async () => {
    let dischargePendingSql = '';
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as discharged_pending_billing_count')) {
          dischargePendingSql = lower;
          return { first: { discharged_pending_billing_count: 0 } };
        }
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 0, total_credit: 0 } };
        }
        return { first: { count: 0 } };
      },
    });

    await runAccountingInvariantChecks(db, 'tenant-1');

    expect(dischargePendingSql).toContain('coalesce(pbi.charge_amount, 0) > 0');
    expect(dischargePendingSql).toContain('pbi.ended_on is null');
    expect(dischargePendingSql).toContain('coalesce(pbi.rate_per_day, 0) > 0');
  });

  it('allows controlled manual provisional charges while still flagging incomplete null-reference rows', async () => {
    let manualChargeSql = '';
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as active_manual_provisional_item_count')) {
          manualChargeSql = lower;
          return { first: { active_manual_provisional_item_count: 0 } };
        }
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 0, total_credit: 0 } };
        }
        return { first: { count: 0 } };
      },
    });

    await runAccountingInvariantChecks(db, 'tenant-1');

    expect(manualChargeSql).toContain('reference_id is null');
    expect(manualChargeSql).toContain('length(trim(coalesce(item_name');
    expect(manualChargeSql).toContain('length(trim(coalesce(item_category');
    expect(manualChargeSql).toContain('created_by is null');
    expect(manualChargeSql).toContain('coalesce(unit_price, 0) <= 0');
  });

  it('uses bill due/status as the patient receivable subledger truth', async () => {
    let patientDueSql = '';
    const { db } = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as patient_due_balance')) {
          patientDueSql = lower;
          return { first: { patient_due_balance: 0 } };
        }
        if (lower.includes('as total_debit') && lower.includes('as total_credit')) {
          return { first: { total_debit: 0, total_credit: 0 } };
        }
        return { first: { count: 0 } };
      },
    });

    await runAccountingInvariantChecks(db, 'tenant-1');

    expect(patientDueSql).toContain("coalesce(status, 'open') = 'paid' then 0");
    expect(patientDueSql).toContain('when coalesce(due, 0) > 0 then coalesce(due, 0)');
  });
});

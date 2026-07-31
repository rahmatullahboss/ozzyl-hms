import type { D1Database } from '@cloudflare/workers-types';
import { verifyVoucherChain } from './accounting-hardening';

export type AccountingInvariantStatus = 'pass' | 'warning' | 'fail';

export interface AccountingInvariantCheck {
  key: string;
  label: string;
  status: AccountingInvariantStatus;
  count?: number;
  amount?: number;
  expected?: number;
  actual?: number;
  difference?: number;
}

export interface AccountingInvariantReport {
  tenantId: string;
  ok: boolean;
  generatedAt: string;
  checks: AccountingInvariantCheck[];
}

async function firstNumber(
  db: D1Database,
  sql: string,
  params: unknown[],
  key: string,
): Promise<number> {
  const row = await db.prepare(sql).bind(...params).first<Record<string, unknown>>();
  return Number(row?.[key] ?? 0);
}

function countCheck(key: string, label: string, count: number, warningOnly = false): AccountingInvariantCheck {
  return {
    key,
    label,
    count,
    status: count === 0 ? 'pass' : (warningOnly ? 'warning' : 'fail'),
  };
}

function balanceCheck(key: string, label: string, actual: number, expected = 0): AccountingInvariantCheck {
  const difference = Number((actual - expected).toFixed(2));
  return {
    key,
    label,
    actual,
    expected,
    difference,
    status: Math.abs(difference) < 0.01 ? 'pass' : 'fail',
  };
}

export async function runAccountingInvariantChecks(
  db: D1Database,
  tenantId: string,
): Promise<AccountingInvariantReport> {
  const unbalancedVouchers = await firstNumber(db, `
    SELECT COUNT(*) AS unbalanced_voucher_count
    FROM (
      SELECT v.id
      FROM accounting_vouchers v
      JOIN accounting_journal_lines jl ON jl.voucher_id = v.id AND jl.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? AND v.status = 'verified'
      GROUP BY v.id
      HAVING ABS(ROUND(COALESCE(SUM(jl.debit_amount), 0) - COALESCE(SUM(jl.credit_amount), 0), 2)) >= 0.01
    )
  `, [tenantId], 'unbalanced_voucher_count');

  const glTotals = await db.prepare(`
    SELECT
      COALESCE(SUM(jl.debit_amount), 0) AS total_debit,
      COALESCE(SUM(jl.credit_amount), 0) AS total_credit
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ? AND v.status = 'verified'
  `).bind(tenantId).first<{ total_debit: number; total_credit: number }>();
  const totalDebit = Number(glTotals?.total_debit ?? 0);
  const totalCredit = Number(glTotals?.total_credit ?? 0);

  const pendingEvents = await firstNumber(db, `
    SELECT COUNT(*) AS pending_event_count
    FROM accounting_posting_events
    WHERE tenant_id = ? AND status = 'pending'
  `, [tenantId], 'pending_event_count');

  const failedEvents = await firstNumber(db, `
    SELECT COUNT(*) AS failed_event_count
    FROM accounting_posting_events
    WHERE tenant_id = ? AND status = 'failed'
  `, [tenantId], 'failed_event_count');

  const sourceWithoutVoucher = await firstNumber(db, `
    SELECT COUNT(*) AS source_without_voucher_count
    FROM accounting_posting_events e
    WHERE e.tenant_id = ?
      AND e.status = 'posted'
      AND NOT EXISTS (
        SELECT 1
        FROM accounting_vouchers v
        WHERE v.tenant_id = e.tenant_id
          AND v.source_event_key = e.source_event_key
      )
  `, [tenantId], 'source_without_voucher_count');

  const orphanJournalLines = await firstNumber(db, `
    SELECT COUNT(*) AS orphan_journal_line_count
    FROM accounting_journal_lines jl
    LEFT JOIN accounting_vouchers v
      ON v.id = jl.voucher_id
      AND v.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ?
      AND v.id IS NULL
  `, [tenantId], 'orphan_journal_line_count');

  const duplicateVoucherNumbers = await firstNumber(db, `
    SELECT COUNT(*) AS duplicate_voucher_number_count
    FROM (
      SELECT voucher_number
      FROM accounting_vouchers
      WHERE tenant_id = ?
      GROUP BY voucher_number
      HAVING COUNT(*) > 1
    )
  `, [tenantId], 'duplicate_voucher_number_count');

  const missingLedgerImmutabilityTriggers = await firstNumber(db, `
    SELECT 4 - COUNT(DISTINCT name) AS missing_ledger_immutability_trigger_count
    FROM sqlite_master
    WHERE ? IS NOT NULL
      AND type = 'trigger'
      AND name IN (
        'trg_accounting_vouchers_no_update_verified',
        'trg_accounting_vouchers_no_delete_verified',
        'trg_accounting_lines_no_update_verified',
        'trg_accounting_lines_no_delete_verified'
      )
  `, [tenantId], 'missing_ledger_immutability_trigger_count');

  const duplicatePaymentReceipts = await firstNumber(db, `
    SELECT COUNT(*) AS duplicate_payment_receipt_count
    FROM (
      SELECT receipt_no
      FROM payments
      WHERE tenant_id = ?
        AND receipt_no IS NOT NULL
        AND TRIM(receipt_no) <> ''
      GROUP BY receipt_no
      HAVING COUNT(*) > 1
    )
  `, [tenantId], 'duplicate_payment_receipt_count');

  const duplicateDepositReceipts = await firstNumber(db, `
    SELECT COUNT(*) AS duplicate_deposit_receipt_count
    FROM (
      SELECT deposit_receipt_no
      FROM billing_deposits
      WHERE tenant_id = ?
        AND deposit_receipt_no IS NOT NULL
        AND TRIM(deposit_receipt_no) <> ''
      GROUP BY deposit_receipt_no
      HAVING COUNT(*) > 1
    )
  `, [tenantId], 'duplicate_deposit_receipt_count');

  const duplicateExternalTransactions = await firstNumber(db, `
    SELECT COUNT(*) AS duplicate_external_transaction_count
    FROM (
      SELECT external_transaction_id
      FROM payments
      WHERE tenant_id = ?
        AND external_transaction_id IS NOT NULL
        AND TRIM(external_transaction_id) <> ''
      GROUP BY external_transaction_id
      HAVING COUNT(*) > 1
    )
  `, [tenantId], 'duplicate_external_transaction_count');

  const invalidJournalAccounts = await firstNumber(db, `
    SELECT COUNT(*) AS invalid_journal_account_count
    FROM accounting_journal_lines jl
    LEFT JOIN chart_of_accounts a
      ON a.id = jl.account_id
      AND a.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ?
      AND a.id IS NULL
  `, [tenantId], 'invalid_journal_account_count');

  const inactiveAccountPostings = await firstNumber(db, `
    SELECT COUNT(*) AS inactive_account_posting_count
    FROM accounting_journal_lines jl
    JOIN chart_of_accounts a
      ON a.id = jl.account_id
      AND a.tenant_id = jl.tenant_id
    JOIN accounting_vouchers v
      ON v.id = jl.voucher_id
      AND v.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND COALESCE(a.is_active, 1) = 0
  `, [tenantId], 'inactive_account_posting_count');

  const invalidJournalLineAmounts = await firstNumber(db, `
    SELECT COUNT(*) AS invalid_journal_line_amount_count
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v
      ON v.id = jl.voucher_id
      AND v.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND (
        COALESCE(jl.debit_amount, 0) < 0
        OR COALESCE(jl.credit_amount, 0) < 0
        OR (COALESCE(jl.debit_amount, 0) = 0 AND COALESCE(jl.credit_amount, 0) = 0)
        OR (COALESCE(jl.debit_amount, 0) > 0 AND COALESCE(jl.credit_amount, 0) > 0)
      )
  `, [tenantId], 'invalid_journal_line_amount_count');

  const negativeOperationalAmounts = await firstNumber(db, `
    SELECT
      (
        SELECT COUNT(*) FROM bills
        WHERE tenant_id = ?
          AND (
            COALESCE(total, 0) < 0
            OR COALESCE(total_amount, 0) < 0
            OR COALESCE(paid, 0) < 0
            OR COALESCE(paid_amount, 0) < 0
            OR COALESCE(discount, 0) < 0
          )
      )
      + (
        SELECT COUNT(*) FROM payments
        WHERE tenant_id = ? AND COALESCE(amount, 0) < 0
      )
      + (
        SELECT COUNT(*) FROM billing_deposits
        WHERE tenant_id = ? AND COALESCE(amount, 0) < 0
      )
      + (
        SELECT COUNT(*) FROM billing_credit_notes
        WHERE tenant_id = ?
          AND (
            COALESCE(total_amount, 0) < 0
            OR COALESCE(refund_amount, 0) < 0
          )
      )
      + (
        SELECT COUNT(*) FROM billing_settlements
        WHERE tenant_id = ?
          AND (
            COALESCE(payable_amount, 0) < 0
            OR COALESCE(paid_amount, 0) < 0
            OR COALESCE(deposit_deducted, 0) < 0
            OR COALESCE(discount_amount, 0) < 0
            OR COALESCE(returned_amount, 0) < 0
          )
      )
      AS negative_operational_amount_count
  `, [tenantId, tenantId, tenantId, tenantId, tenantId], 'negative_operational_amount_count');

  const depositPaymentMethodRows = await firstNumber(db, `
    SELECT COUNT(*) AS deposit_payment_method_count
    FROM payments
    WHERE tenant_id = ?
      AND LOWER(COALESCE(payment_method, payment_type, '')) = 'deposit'
      AND COALESCE(amount, 0) > 0
  `, [tenantId], 'deposit_payment_method_count');

  const activeManualProvisionalItems = await firstNumber(db, `
    SELECT COUNT(*) AS active_manual_provisional_item_count
    FROM billing_provisional_items
    WHERE tenant_id = ?
      AND is_active = 1
      AND bill_status = 'provisional'
      AND reference_id IS NULL
      AND COALESCE(total_amount, 0) > 0
      AND (
        LENGTH(TRIM(COALESCE(item_name, ''))) < 3
        OR LENGTH(TRIM(COALESCE(item_category, ''))) < 2
        OR created_by IS NULL
        OR COALESCE(unit_price, 0) <= 0
        OR COALESCE(quantity, 0) <= 0
      )
  `, [tenantId], 'active_manual_provisional_item_count');

  const dischargedPendingBillingItems = await firstNumber(db, `
    SELECT COUNT(*) AS discharged_pending_billing_count
    FROM admissions a
    WHERE a.tenant_id = ?
      AND a.status = 'discharged'
      AND (
        EXISTS (
          SELECT 1
          FROM billing_provisional_items pi
          WHERE pi.tenant_id = a.tenant_id
            AND pi.admission_id = a.id
            AND pi.is_active = 1
            AND pi.bill_status = 'provisional'
        )
        OR EXISTS (
          SELECT 1
          FROM patient_bed_infos pbi
          WHERE pbi.tenant_id = a.tenant_id
            AND pbi.admission_id = a.id
            AND COALESCE(pbi.is_billed, 0) = 0
            AND (
              COALESCE(pbi.charge_amount, 0) > 0
              OR (pbi.ended_on IS NULL AND COALESCE(pbi.rate_per_day, 0) > 0)
            )
        )
      )
  `, [tenantId], 'discharged_pending_billing_count');

  const billWithoutJournal = await firstNumber(db, `
    SELECT COUNT(*) AS bill_without_journal_count
    FROM bills b
    WHERE b.tenant_id = ?
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'draft')
      AND COALESCE(NULLIF(b.total, 0), b.total_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM accounting_vouchers v
        WHERE v.tenant_id = b.tenant_id
          AND v.source_type = 'billing'
          AND CAST(v.source_id AS REAL) = CAST(b.id AS REAL)
          AND v.event_type = 'bill_created'
      )
  `, [tenantId], 'bill_without_journal_count');

  const creditNoteWithoutJournal = await firstNumber(db, `
    SELECT COUNT(*) AS credit_note_without_journal_count
    FROM billing_credit_notes cn
    WHERE cn.tenant_id = ?
      AND cn.is_active = 1
      AND COALESCE(cn.total_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM accounting_vouchers v
        WHERE v.tenant_id = cn.tenant_id
          AND v.source_type = 'credit_note'
          AND v.source_id = CAST(cn.id AS TEXT)
          AND v.event_type = 'credit_note_issued'
      )
  `, [tenantId], 'credit_note_without_journal_count');

  const paymentWithoutJournal = await firstNumber(db, `
    SELECT COUNT(*) AS payment_without_journal_count
    FROM payments p
    WHERE p.tenant_id = ?
      AND COALESCE(p.amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM accounting_vouchers v
        WHERE v.tenant_id = p.tenant_id
          AND v.source_type = 'payment'
          AND v.source_id = COALESCE(p.receipt_no, 'PAY-' || p.id)
          AND v.event_type = 'payment_received'
      )
  `, [tenantId], 'payment_without_journal_count');

  const depositWithoutJournal = await firstNumber(db, `
    SELECT COUNT(*) AS deposit_without_journal_count
    FROM billing_deposits d
    WHERE d.tenant_id = ?
      AND d.is_active = 1
      AND COALESCE(d.amount, 0) > 0
      AND (
        (d.transaction_type = 'deposit' AND NOT EXISTS (
          SELECT 1 FROM accounting_vouchers v
          WHERE v.tenant_id = d.tenant_id
            AND v.source_type = 'patient_deposit'
            AND v.source_id = d.deposit_receipt_no
            AND v.event_type = 'patient_deposit_received'
        ))
        OR (d.transaction_type = 'refund' AND NOT EXISTS (
          SELECT 1 FROM accounting_vouchers v
          WHERE v.tenant_id = d.tenant_id
            AND v.source_type = 'patient_deposit_refund'
            AND v.source_id = d.deposit_receipt_no
            AND v.event_type = 'patient_deposit_refunded'
        ))
        OR (d.transaction_type = 'adjustment' AND NOT EXISTS (
          SELECT 1 FROM accounting_vouchers v
          WHERE v.tenant_id = d.tenant_id
            AND v.source_type = 'patient_deposit_adjustment'
            AND v.source_id = d.deposit_receipt_no
            AND v.event_type = 'patient_deposit_adjusted'
        ))
      )
  `, [tenantId], 'deposit_without_journal_count');

  const commissionWithoutJournal = await firstNumber(db, `
    SELECT COUNT(*) AS commission_without_journal_count
    FROM doctor_commission_accruals a
    WHERE a.tenant_id = ?
      AND a.status IN ('accrued', 'approved', 'paid')
      AND COALESCE(a.commission_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM accounting_vouchers v
        WHERE v.tenant_id = a.tenant_id
          AND v.source_type = 'doctor_commission_accrual'
          AND CAST(v.source_id AS REAL) = CAST(a.id AS REAL)
          AND v.event_type = 'commission_accrued'
      )
  `, [tenantId], 'commission_without_journal_count');

  const supplierPaymentWithoutJournal = await firstNumber(db, `
    SELECT COUNT(*) AS supplier_payment_without_journal_count
    FROM accounting_vendor_payments p
    WHERE p.tenant_id = ?
      AND p.status = 'posted'
      AND COALESCE(p.paid_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM accounting_vouchers v
        WHERE v.tenant_id = p.tenant_id
          AND v.source_type = 'vendor_payment'
          AND v.source_id = CAST(p.id AS TEXT)
          AND v.event_type = 'supplier_payment'
      )
  `, [tenantId], 'supplier_payment_without_journal_count');

  const settlementDiscountWithoutJournal = await firstNumber(db, `
    SELECT COUNT(*) AS settlement_discount_without_journal_count
    FROM billing_settlements s
    WHERE s.tenant_id = ?
      AND s.is_active = 1
      AND COALESCE(s.discount_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM accounting_vouchers v
        WHERE v.tenant_id = s.tenant_id
          AND v.source_type = 'settlement_discount'
          AND v.source_id LIKE s.settlement_receipt_no || '-DISC-%'
          AND v.event_type = 'settlement_discount'
      )
  `, [tenantId], 'settlement_discount_without_journal_count');

  const patientReceivableBalance = await firstNumber(db, `
    SELECT COALESCE(SUM(jl.debit_amount - jl.credit_amount), 0) AS patient_receivable_balance
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND m.mapping_key = 'accounts_receivable'
      AND m.is_active = 1
  `, [tenantId], 'patient_receivable_balance');

  const patientDueBalance = await firstNumber(db, `
    SELECT COALESCE(SUM(
      CASE
        WHEN COALESCE(status, 'open') = 'paid' THEN 0
        WHEN COALESCE(due, 0) > 0 THEN COALESCE(due, 0)
        WHEN COALESCE(NULLIF(total, 0), total_amount, 0) - COALESCE(NULLIF(paid, 0), paid_amount, 0) > 0
          THEN COALESCE(NULLIF(total, 0), total_amount, 0) - COALESCE(NULLIF(paid, 0), paid_amount, 0)
        ELSE 0
      END
    ), 0)
      AS patient_due_balance
    FROM bills
    WHERE tenant_id = ?
      AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  `, [tenantId], 'patient_due_balance');

  const depositLiabilityBalance = await firstNumber(db, `
    SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS deposit_liability_balance
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND m.mapping_key = 'patient_deposit_liability'
      AND m.is_active = 1
  `, [tenantId], 'deposit_liability_balance');

  const depositSubledgerBalance = await firstNumber(db, `
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0)
      AS deposit_subledger_balance
    FROM billing_deposits
    WHERE tenant_id = ? AND is_active = 1
  `, [tenantId], 'deposit_subledger_balance');

  const doctorPayableBalance = await firstNumber(db, `
    SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS doctor_payable_balance
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND m.mapping_key = 'doctor_commission_payable'
      AND m.is_active = 1
  `, [tenantId], 'doctor_payable_balance');

  const doctorCommissionSubledgerBalance = await firstNumber(db, `
    SELECT COALESCE(SUM(commission_amount), 0) AS doctor_commission_subledger_balance
    FROM doctor_commission_accruals
    WHERE tenant_id = ? AND status IN ('accrued', 'approved')
  `, [tenantId], 'doctor_commission_subledger_balance');

  const supplierPayableBalance = await firstNumber(db, `
    SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS supplier_payable_balance
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND m.mapping_key = 'accounts_payable'
      AND m.is_active = 1
  `, [tenantId], 'supplier_payable_balance');

  const supplierDueBalance = await firstNumber(db, `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN COALESCE(TotalAmount, 0) - COALESCE(PaidAmount, 0) > 0
          THEN COALESCE(TotalAmount, 0) - COALESCE(PaidAmount, 0)
          ELSE 0
        END
      ), 0) AS supplier_due_balance
    FROM InventoryGoodsReceipt
    WHERE tenant_id = ?
      AND COALESCE(IsCancelled, 0) = 0
      AND COALESCE(PaymentMode, 'credit') = 'credit'
  `, [tenantId], 'supplier_due_balance');

  const chainIntegrity = await verifyVoucherChain(db, tenantId);

  const checks: AccountingInvariantCheck[] = [
    countCheck('voucher_balance', 'Every verified accounting voucher is balanced', unbalancedVouchers),
    balanceCheck('general_ledger_balance', 'Total posted debits equal total posted credits', totalDebit, totalCredit),
    countCheck('pending_posting_events', 'No pending accounting posting events', pendingEvents, true),
    countCheck('failed_posting_events', 'No failed accounting posting events', failedEvents),
    countCheck('posted_event_has_voucher', 'Every posted event has a voucher', sourceWithoutVoucher),
    countCheck('orphan_journal_lines', 'No journal line exists without a parent voucher', orphanJournalLines),
    countCheck('duplicate_voucher_numbers', 'Voucher numbers are unique inside the tenant', duplicateVoucherNumbers),
    countCheck('ledger_immutability_triggers', 'Verified vouchers and journal lines are protected by database triggers', missingLedgerImmutabilityTriggers),
    countCheck('duplicate_payment_receipts', 'Payment receipt numbers are unique inside the tenant', duplicatePaymentReceipts),
    countCheck('duplicate_deposit_receipts', 'Deposit receipt numbers are unique inside the tenant', duplicateDepositReceipts),
    countCheck('duplicate_external_transactions', 'External payment transaction IDs are unique inside the tenant', duplicateExternalTransactions),
    countCheck('invalid_journal_accounts', 'Every journal line references an existing account', invalidJournalAccounts),
    countCheck('inactive_account_postings', 'No verified journal line posts to an inactive account', inactiveAccountPostings),
    countCheck('invalid_journal_line_amounts', 'Journal lines have exactly one positive side and no negative side', invalidJournalLineAmounts),
    countCheck('negative_operational_amounts', 'Operational billing/payment amounts are not negative', negativeOperationalAmounts),
    countCheck('deposit_payment_method_rows', 'Patient deposit deductions are recorded as deposit adjustments, not payments', depositPaymentMethodRows),
    countCheck('catalog_backed_provisional_items', 'Manual provisional billing items include controlled charge details', activeManualProvisionalItems),
    countCheck('discharged_pending_billing_items', 'Discharged admissions have no pending provisional or unbilled bed charges', dischargedPendingBillingItems),
    countCheck('bill_source_has_journal', 'Every posted bill has a bill-created voucher', billWithoutJournal),
    countCheck('credit_note_source_has_journal', 'Every credit note has a credit-note voucher', creditNoteWithoutJournal),
    countCheck('payment_source_has_journal', 'Every payment has a payment voucher', paymentWithoutJournal),
    countCheck('deposit_source_has_journal', 'Every deposit movement has a voucher', depositWithoutJournal),
    countCheck('commission_source_has_journal', 'Every commission accrual has an accrual voucher', commissionWithoutJournal),
    countCheck('supplier_payment_source_has_journal', 'Every supplier payment has a supplier-payment voucher', supplierPaymentWithoutJournal),
    countCheck('settlement_discount_source_has_journal', 'Every settlement discount has a discount voucher', settlementDiscountWithoutJournal),
    balanceCheck('patient_receivable_reconciliation', 'Patient receivable GL equals patient due subledger', patientReceivableBalance, patientDueBalance),
    balanceCheck('deposit_liability_reconciliation', 'Patient deposit liability GL equals deposit subledger', depositLiabilityBalance, depositSubledgerBalance),
    balanceCheck('doctor_payable_reconciliation', 'Doctor payable GL equals unpaid doctor commission subledger', doctorPayableBalance, doctorCommissionSubledgerBalance),
    balanceCheck('supplier_payable_reconciliation', 'Supplier payable GL equals supplier due subledger', supplierPayableBalance, supplierDueBalance),
    {
      key: 'hash_chain_integrity',
      label: 'Cryptographic hash-chain integrity of the ledger',
      status: chainIntegrity.valid ? 'pass' : 'fail',
      memo: chainIntegrity.error || chainIntegrity.warning || 'Ledger is immutable and un-tampered'
    } as any,
  ];

  return {
    tenantId,
    ok: checks.every((check) => check.status !== 'fail'),
    generatedAt: new Date().toISOString(),
    checks,
  };
}

import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import {
  ACCOUNTING_EVENT_TYPES,
  buildAgentCommissionAccruedLines,
  buildAgentCommissionCancelledLines,
  buildAgentCommissionSettledLines,
  buildBillCreatedLines,
  buildBillCancelledLines,
  buildBankDepositConfirmedLines,
  buildBankDepositCustodyLines,
  buildCashHandoverLines,
  buildCommissionAccruedLines,
  buildCommissionCancelledLines,
  buildCommissionSettledLines,
  buildDepositAdjustedLines,
  buildDepositReceivedLines,
  buildDepositRefundedLines,
  buildDirectExpensePaidLines,
  buildDirectIncomeReceivedLines,
  buildPaymentReceivedLines,
  buildCreditNoteIssuedLines,
  isBalancedJournal,
  postAccountingEventBySourceKey,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
  resolveAccountMappings,
  buildPharmacyPurchaseLines,
  buildPharmacySaleCogsLines,
  buildInventoryPurchaseLines,
  buildInventoryConsumptionLines,
  buildSupplierPaymentLines,
  buildProfitDistributionDeclaredLines,
  buildShareholderDividendPaidLines,
  buildSettlementDiscountLines,
  getPaymentAssetMappingKey,
  validateJournalLines,
} from '../src/lib/accounting-posting';

const tenantId = 'tenant-1';

const accountMappings = {
  cash: 1,
  bank: 2,
  card_clearing: 101,
  bkash_wallet: 102,
  nagad_wallet: 103,
  rocket_wallet: 104,
  bank_transfer_clearing: 105,
  cheque_clearing: 106,
  other_payment_clearing: 107,
  accounts_receivable: 3,
  lab_revenue: 4,
  doctor_visit_revenue: 5,
  admission_revenue: 6,
  operation_revenue: 7,
  pharmacy_revenue: 8,
  other_revenue: 9,
  discount_allowed: 10,
  doctor_commission_expense: 11,
  doctor_commission_payable: 12,
  agent_commission_expense: 16,
  agent_commission_payable: 17,
  patient_deposit_liability: 13,
  retained_earnings: 14,
  shareholder_payable: 15,
  withholding_payable: 18,
  doctor_advance_receivable: 19,
  doctor_settlement_adjustment: 20,
};

describe('accounting posting core', () => {
  it('validates balanced multi-line voucher lines', () => {
    const lines = buildBillCreatedLines({
      total: 900,
      discount: 100,
      testBill: 600,
      doctorVisitBill: 400,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
    }, accountMappings);

    expect(lines).toEqual([
      { accountId: 3, debit: 900, credit: 0, memo: 'Patient accounts receivable' },
      { accountId: 10, debit: 100, credit: 0, memo: 'Billing discount allowed' },
      { accountId: 4, debit: 0, credit: 600, memo: 'Laboratory revenue' },
      { accountId: 5, debit: 0, credit: 400, memo: 'Doctor visit revenue' },
    ]);
    expect(isBalancedJournal(lines)).toBe(true);
    expect(() => validateJournalLines(lines)).not.toThrow();
  });

  it('splits doctor commission waiver discount in bill-created double-entry lines', () => {
    const lines = buildBillCreatedLines({
      total: 700,
      discount: 300,
      testBill: 1000,
      doctorVisitBill: 0,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
      discountAllocations: [
        { allocationType: 'doctor_commission_waiver', amount: 200 },
        { allocationType: 'hospital_discount', amount: 100 },
      ],
    }, accountMappings);

    expect(lines).toEqual([
      { accountId: 3, debit: 700, credit: 0, memo: 'Patient accounts receivable' },
      { accountId: 10, debit: 100, credit: 0, memo: 'Billing discount allowed' },
      { accountId: 12, debit: 200, credit: 0, memo: 'Doctor commission waiver applied to patient bill' },
      { accountId: 4, debit: 0, credit: 1000, memo: 'Laboratory revenue' },
    ]);
    expect(isBalancedJournal(lines)).toBe(true);
  });

  it('rejects unbalanced voucher lines', () => {
    expect(() => validateJournalLines([
      { accountId: 1, debit: 1000, credit: 0, memo: 'Cash' },
      { accountId: 4, debit: 0, credit: 999, memo: 'Revenue' },
    ])).toThrow(/unbalanced/i);
  });

  it('resolves each payment method to its own asset or clearing mapping', () => {
    expect(getPaymentAssetMappingKey('cash')).toBe('cash');
    expect(getPaymentAssetMappingKey('card')).toBe('card_clearing');
    expect(getPaymentAssetMappingKey('bkash')).toBe('bkash_wallet');
    expect(getPaymentAssetMappingKey('nagad')).toBe('nagad_wallet');
    expect(getPaymentAssetMappingKey('rocket')).toBe('rocket_wallet');
    expect(getPaymentAssetMappingKey('bank_transfer')).toBe('bank_transfer_clearing');
    expect(getPaymentAssetMappingKey('cheque')).toBe('cheque_clearing');
    expect(getPaymentAssetMappingKey('unknown_gateway')).toBe('other_payment_clearing');
  });

  it('builds payment received by method against accounts receivable', () => {
    expect(buildPaymentReceivedLines({ amount: 500, paymentMethod: 'cash' }, accountMappings)).toEqual([
      { accountId: 1, debit: 500, credit: 0, memo: 'Cash receipt' },
      { accountId: 3, debit: 0, credit: 500, memo: 'Reduce patient accounts receivable' },
    ]);

    expect(buildPaymentReceivedLines({ amount: 500, paymentMethod: 'card' }, accountMappings)[0]).toMatchObject({
      accountId: 101,
      memo: 'Card receipt',
    });
  });

  it('builds commission accrual as expense against payable', () => {
    const lines = buildCommissionAccruedLines({ amount: 250 }, accountMappings);

    expect(lines).toEqual([
      { accountId: 11, debit: 250, credit: 0, memo: 'Doctor commission expense' },
      { accountId: 12, debit: 0, credit: 250, memo: 'Doctor commission payable' },
    ]);
    expect(isBalancedJournal(lines)).toBe(true);
  });

  it('builds commission settlement as payable clearance against cash or bank', () => {
    expect(buildCommissionSettledLines({ amount: 250, paymentMethod: 'cash' }, accountMappings)).toEqual([
      { accountId: 12, debit: 250, credit: 0, memo: 'Clear doctor commission payable' },
      { accountId: 1, debit: 0, credit: 250, memo: 'Cash commission payout' },
    ]);

    expect(buildCommissionSettledLines({ amount: 250, paymentMethod: 'bank' }, accountMappings)[1]).toMatchObject({
      accountId: 2,
      memo: 'Bank commission payout',
    });
  });

  it('posts doctor clawback recovery separately from net cash payout', () => {
    expect(buildCommissionSettledLines({
      amount: 900,
      grossCommissionAmount: 1000,
      clawbackDeduction: 100,
      netPaidAmount: 900,
      paymentMethod: 'cash',
    }, accountMappings)).toEqual([
      { accountId: 12, debit: 1000, credit: 0, memo: 'Clear doctor commission payable' },
      { accountId: 1, debit: 0, credit: 900, memo: 'Cash commission payout' },
      { accountId: 19, debit: 0, credit: 100, memo: 'Recover doctor commission clawback from settlement' },
    ]);
  });

  it('rejects an unbalanced doctor commission settlement payload', () => {
    expect(() => buildCommissionSettledLines({
      amount: 900,
      grossCommissionAmount: 1000,
      clawbackDeduction: 50,
      netPaidAmount: 900,
      paymentMethod: 'cash',
    }, accountMappings)).toThrow(/unbalanced/i);
  });

  it('builds commission cancellation as an accrual reversal', () => {
    expect(buildCommissionCancelledLines({ amount: 250 }, accountMappings)).toEqual([
      { accountId: 12, debit: 250, credit: 0, memo: 'Reverse doctor commission payable' },
      { accountId: 11, debit: 0, credit: 250, memo: 'Reverse doctor commission expense' },
    ]);
  });

  it('builds agent and referral commission accrual, settlement, and reversal entries', () => {
    expect(buildAgentCommissionAccruedLines({ amount: 300 }, accountMappings)).toEqual([
      { accountId: 16, debit: 300, credit: 0, memo: 'Agent/referral commission expense' },
      { accountId: 17, debit: 0, credit: 300, memo: 'Agent/referral commission payable' },
    ]);

    expect(buildAgentCommissionSettledLines({ amount: 300, paymentMethod: 'cash' }, accountMappings)).toEqual([
      { accountId: 17, debit: 300, credit: 0, memo: 'Clear agent/referral commission payable' },
      { accountId: 1, debit: 0, credit: 300, memo: 'Cash agent commission payout' },
    ]);

    expect(buildAgentCommissionCancelledLines({ amount: 300 }, accountMappings)).toEqual([
      { accountId: 17, debit: 300, credit: 0, memo: 'Reverse agent/referral commission payable' },
      { accountId: 16, debit: 0, credit: 300, memo: 'Reverse agent/referral commission expense' },
    ]);
  });

  it('builds patient deposit receive, adjustment, and refund entries', () => {
    expect(buildDepositReceivedLines({ amount: 1000, paymentMethod: 'cash' }, accountMappings)).toEqual([
      { accountId: 1, debit: 1000, credit: 0, memo: 'Cash patient deposit' },
      { accountId: 13, debit: 0, credit: 1000, memo: 'Patient deposit liability' },
    ]);

    expect(buildDepositAdjustedLines({ amount: 400 }, accountMappings)).toEqual([
      { accountId: 13, debit: 400, credit: 0, memo: 'Apply patient deposit liability' },
      { accountId: 3, debit: 0, credit: 400, memo: 'Reduce patient accounts receivable' },
    ]);

    expect(buildDepositRefundedLines({ amount: 300, paymentMethod: 'bank' }, accountMappings)).toEqual([
      { accountId: 13, debit: 300, credit: 0, memo: 'Refund patient deposit liability' },
      { accountId: 2, debit: 0, credit: 300, memo: 'Bank deposit refund' },
    ]);
  });

  it('builds bill cancellation as the exact reversal of bill creation', () => {
    const lines = buildBillCancelledLines({
      total: 900,
      discount: 100,
      testBill: 600,
      doctorVisitBill: 400,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
    }, accountMappings);

    expect(lines).toEqual([
      { accountId: 4, debit: 600, credit: 0, memo: 'Reverse laboratory revenue' },
      { accountId: 5, debit: 400, credit: 0, memo: 'Reverse doctor visit revenue' },
      { accountId: 3, debit: 0, credit: 900, memo: 'Reverse patient accounts receivable' },
      { accountId: 10, debit: 0, credit: 100, memo: 'Reverse billing discount allowed' },
    ]);
    expect(isBalancedJournal(lines)).toBe(true);
  });

  it('resolves required account mappings by semantic key', async () => {
    const { db } = createMockDB({
      tables: {
        accounting_account_mappings: [
          { tenant_id: tenantId, mapping_key: 'cash', account_id: 1, is_active: 1 },
          { tenant_id: tenantId, mapping_key: 'accounts_receivable', account_id: 3, is_active: 1 },
          { tenant_id: tenantId, mapping_key: 'lab_revenue', account_id: 4, is_active: 1 },
        ],
      },
    });

    await expect(resolveAccountMappings(db, tenantId, ['cash', 'accounts_receivable', 'lab_revenue']))
      .resolves.toEqual({ cash: 1, accounts_receivable: 3, lab_revenue: 4 });
  });

  it('fails clearly when a required account mapping is missing', async () => {
    const { db } = createMockDB({
      tables: {
        accounting_account_mappings: [
          { tenant_id: tenantId, mapping_key: 'cash', account_id: 1, is_active: 1 },
        ],
      },
    });

    await expect(resolveAccountMappings(db, tenantId, ['cash', 'accounts_receivable']))
      .rejects.toThrow(/Missing accounting account mapping: accounts_receivable/);
  });

  it('records idempotent posting events using source type and source id', async () => {
    const { db, queries } = createMockDB({});

    await recordAccountingPostingEvent(db, {
      tenantId,
      sourceType: 'billing',
      sourceId: 42,
      eventType: ACCOUNTING_EVENT_TYPES.billCreated,
      eventDate: '2026-05-08',
      createdBy: '7',
      payload: { billId: 42, total: 1000 },
    });

    const insert = queries.find((query) => query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events'));
    expect(insert?.params).toEqual([
      tenantId,
      'billing:42:bill_created',
      'billing',
      42,
      'bill_created',
      '2026-05-08',
      JSON.stringify({ billId: 42, total: 1000 }),
      '7',
    ]);
  });

  it('posts a pending billing event into a verified accounting voucher', async () => {
    const sourceEventKey = 'billing:42:bill_created';
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{
          id: 9,
          tenant_id: tenantId,
          source_event_key: sourceEventKey,
          source_type: 'billing',
          source_id: '42',
          event_type: ACCOUNTING_EVENT_TYPES.billCreated,
          event_date: '2026-05-08',
          payload_json: JSON.stringify({
            billId: 42,
            invoiceNo: 'INV-000042',
            patientId: 66,
            total: 900,
            discount: 100,
            testBill: 600,
            doctorVisitBill: 400,
            admissionBill: 0,
            operationBill: 0,
            medicineBill: 0,
          }),
          status: 'pending',
          attempts: 0,
          created_by: '7',
        }],
        accounting_vouchers: [],
        fiscal_years: [{
          id: 2,
          tenant_id: tenantId,
          fiscal_year_name: 'FY26',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_active: 1,
          is_closed: 0,
        }],
        voucher_types: [{ id: 3, tenant_id: tenantId, code: 'JV', name: 'Journal Voucher', is_active: 1 }],
        voucher_numbering: [{ id: 4, tenant_id: tenantId, voucher_type_id: 3, fiscal_year_id: 2, last_number: 11 }],
        accounting_account_mappings: [
          { tenant_id: tenantId, mapping_key: 'accounts_receivable', account_id: 3, is_active: 1 },
          { tenant_id: tenantId, mapping_key: 'discount_allowed', account_id: 10, is_active: 1 },
          { tenant_id: tenantId, mapping_key: 'lab_revenue', account_id: 4, is_active: 1 },
          { tenant_id: tenantId, mapping_key: 'doctor_visit_revenue', account_id: 5, is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from accounting_journal_lines')) {
          return { first: { line_count: 4, total_debit: 1000, total_credit: 1000 } };
        }
        return null;
      },
    });

    await expect(postAccountingEventBySourceKey(db, tenantId, sourceEventKey))
      .resolves.toMatchObject({ posted: true, voucherNumber: 'JV-FY26-012' });

    expect(queries.some((q) => /INSERT INTO accounting_vouchers/i.test(q.sql))).toBe(true);
    expect(queries.filter((q) => /INSERT INTO accounting_journal_lines/i.test(q.sql))).toHaveLength(4);
    expect(queries.find((q) => /INSERT INTO accounting_journal_lines/i.test(q.sql))?.sql)
      .toContain('patient_id');
    expect(queries.find((q) => /INSERT INTO accounting_journal_lines/i.test(q.sql))?.params)
      .toContain(66);
    expect(queries.some((q) => /UPDATE accounting_posting_events/i.test(q.sql) && /status = 'posted'/i.test(q.sql))).toBe(true);
  });

  it('retries period-closed failed events when pending posting is run again', async () => {
    const sourceEventKey = 'billing:42:bill_created';
    const eventRow = {
      id: 29,
      tenant_id: tenantId,
      source_event_key: sourceEventKey,
      source_type: 'billing',
      source_id: '42',
      event_type: ACCOUNTING_EVENT_TYPES.billCreated,
      event_date: '2026-05-08',
      payload_json: JSON.stringify({ billId: 42, total: 1000 }),
      status: 'failed',
      attempts: 1,
      last_error: 'Period is closed for this date',
      created_by: '7',
    };
    const { db } = createMockDB({
      tables: {
        accounting_posting_events: [eventRow],
        accounting_vouchers: [{
          id: 77,
          tenant_id: tenantId,
          source_event_key: sourceEventKey,
          voucher_number: 'JV-FY26-077',
        }],
        accounting_account_mappings: [
          { tenant_id: tenantId, mapping_key: 'accounts_receivable', account_id: 3, is_active: 1 },
          { tenant_id: tenantId, mapping_key: 'other_revenue', account_id: 9, is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select source_event_key, tenant_id')
          && normalized.includes('from accounting_posting_events')) {
          if (normalized.includes("last_error != 'period is closed for this date'")) {
            return { results: [] };
          }
          return { results: [{ source_event_key: sourceEventKey, tenant_id: tenantId }] };
        }
        if (normalized.includes('from accounting_journal_lines')) {
          return { first: { line_count: 2, total_debit: 1000, total_credit: 1000 } };
        }
        return null;
      },
    });

    const results = await postPendingAccountingEvents(db, tenantId, 10);

    expect(results).toEqual([{ posted: true, voucherId: 77, voucherNumber: 'JV-FY26-077' }]);
  });

  it('posts a pending patient deposit received event into a receipt voucher', async () => {
    const sourceEventKey = 'patient_deposit:DEP-001:patient_deposit_received';
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{
          id: 19,
          tenant_id: tenantId,
          source_event_key: sourceEventKey,
          source_type: 'patient_deposit',
          source_id: 'DEP-001',
          event_type: ACCOUNTING_EVENT_TYPES.patientDepositReceived,
          event_date: '2026-05-08',
          payload_json: JSON.stringify({
            depositId: 100,
            receiptNo: 'DEP-001',
            patientId: 1,
            amount: 1000,
            paymentMethod: 'cash',
          }),
          status: 'pending',
          attempts: 0,
          created_by: '7',
        }],
        accounting_vouchers: [],
        fiscal_years: [{
          id: 2,
          tenant_id: tenantId,
          fiscal_year_name: 'FY26',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_active: 1,
          is_closed: 0,
        }],
        voucher_types: [{ id: 3, tenant_id: tenantId, code: 'RCPT', name: 'Receipt Voucher', is_active: 1 }],
        voucher_numbering: [{ id: 4, tenant_id: tenantId, voucher_type_id: 3, fiscal_year_id: 2, last_number: 4 }],
        accounting_account_mappings: [
          { tenant_id: tenantId, mapping_key: 'cash', account_id: 1, is_active: 1 },
          { tenant_id: tenantId, mapping_key: 'patient_deposit_liability', account_id: 13, is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from accounting_journal_lines')) {
          return { first: { line_count: 2, total_debit: 1000, total_credit: 1000 } };
        }
        return null;
      },
    });

    await expect(postAccountingEventBySourceKey(db, tenantId, sourceEventKey))
      .resolves.toMatchObject({ posted: true, voucherNumber: 'RCPT-FY26-005' });

    expect(queries.filter((q) => /INSERT INTO accounting_journal_lines/i.test(q.sql))).toHaveLength(2);
  });

  describe('Module Line Builders', () => {
    const mappings: ResolvedAccountMappings = {
      ...accountMappings,
      admin_cash: 16,
      pharmacy_inventory: 20,
      pharmacy_cogs: 21,
      general_inventory: 22,
      inventory_expense: 23,
      accounts_payable: 24,
      general_expense: 25,
      expense_salary: 26,
      expense_medicine: 27,
      expense_rent: 28,
      expense_electricity: 29,
      expense_water: 30,
      expense_communication: 31,
      expense_maintenance: 32,
      expense_supplies: 33,
      expense_marketing: 34,
      expense_bank_charges: 35,
    };

    it('builds pharmacy purchase lines (cash)', () => {
      const lines = buildPharmacyPurchaseLines({
        totalAmount: 5000,
        supplierId: 1,
        paymentMethod: 'cash',
        isCredit: false
      }, mappings);

      expect(lines).toEqual([
        { accountId: 20, debit: 5000, credit: 0, memo: 'Pharmacy purchase inventory receipt' },
        { accountId: 1, debit: 0, credit: 5000, memo: 'Cash purchase payment' },
      ]);
    });

    it('builds pharmacy purchase lines (credit)', () => {
      const lines = buildPharmacyPurchaseLines({
        totalAmount: 5000,
        supplierId: 1,
        isCredit: true
      }, mappings);

      expect(lines).toEqual([
        { accountId: 20, debit: 5000, credit: 0, memo: 'Pharmacy purchase inventory receipt' },
        { accountId: 24, debit: 0, credit: 5000, memo: 'Supplier accounts payable' },
      ]);
    });

    it('builds pharmacy sale COGS lines', () => {
      const lines = buildPharmacySaleCogsLines({
        cogsAmount: 3500
      }, mappings);

      expect(lines).toEqual([
        { accountId: 21, debit: 3500, credit: 0, memo: 'Pharmacy cost of goods sold' },
        { accountId: 20, debit: 0, credit: 3500, memo: 'Reduce pharmacy inventory for sale' },
      ]);
    });

    it('builds general inventory purchase lines (credit)', () => {
      const lines = buildInventoryPurchaseLines({
        totalAmount: 2400,
        supplierId: 1,
        isCredit: true,
      }, mappings);

      expect(lines).toEqual([
        { accountId: 22, debit: 2400, credit: 0, memo: 'General inventory receipt' },
        { accountId: 24, debit: 0, credit: 2400, memo: 'Supplier accounts payable' },
      ]);
    });

    it('builds inventory consumption lines', () => {
      const lines = buildInventoryConsumptionLines({
        totalCost: 1200
      }, mappings);

      expect(lines).toEqual([
        { accountId: 23, debit: 1200, credit: 0, memo: 'General inventory consumption expense' },
        { accountId: 22, debit: 0, credit: 1200, memo: 'Reduce general inventory for consumption' },
      ]);
    });

    it('builds supplier payment lines as payable clearance against cash or bank', () => {
      expect(buildSupplierPaymentLines({
        amount: 1000,
        paymentMethod: 'bank',
      }, mappings)).toEqual([
        { accountId: 24, debit: 1000, credit: 0, memo: 'Clear supplier accounts payable' },
        { accountId: 2, debit: 0, credit: 1000, memo: 'Bank supplier payout' },
      ]);

      expect(buildSupplierPaymentLines({ amount: 750, paymentMethod: 'cash' }, mappings)[1])
        .toMatchObject({ accountId: 1, memo: 'Cash supplier payout' });
    });

    it('builds shareholder dividend declaration and payout lines', () => {
      expect(buildProfitDistributionDeclaredLines({ amount: 1500 }, mappings)).toEqual([
        { accountId: 14, debit: 1500, credit: 0, memo: 'Declare gross shareholder dividend from retained earnings' },
        { accountId: 15, debit: 0, credit: 1500, memo: 'Shareholder dividend payable net of withholding' },
      ]);

      expect(buildShareholderDividendPaidLines({ amount: 1500, paymentMethod: 'bank' }, mappings)).toEqual([
        { accountId: 15, debit: 1500, credit: 0, memo: 'Clear shareholder dividend payable' },
        { accountId: 2, debit: 0, credit: 1500, memo: 'Bank shareholder dividend payout' },
      ]);
    });

    it('builds direct income and expense lines against cash and mapped revenue/expense', () => {
      expect(buildDirectIncomeReceivedLines({ amount: 900, paymentMethod: 'cash' }, mappings)).toEqual([
        { accountId: 1, debit: 900, credit: 0, memo: 'Cash direct income' },
        { accountId: 9, debit: 0, credit: 900, memo: 'Direct other income' },
      ]);

      expect(buildDirectExpensePaidLines({ amount: 400, paymentMethod: 'bank', category: 'maintenance' }, mappings)).toEqual([
        { accountId: 32, debit: 400, credit: 0, memo: 'Direct maintenance expense' },
        { accountId: 2, debit: 0, credit: 400, memo: 'Bank expense payment' },
      ]);
    });

    it('builds credit note lines against receivable and cash refund', () => {
      const lines = buildCreditNoteIssuedLines({
        total: 500,
        testBill: 300,
        doctorVisitBill: 0,
        admissionBill: 0,
        operationBill: 0,
        medicineBill: 0,
        receivableReduction: 100,
        cashRefund: 400,
        paymentMethod: 'cash',
      }, mappings);

      expect(lines).toEqual([
        { accountId: 4, debit: 300, credit: 0, memo: 'Reverse laboratory revenue by credit note' },
        { accountId: 9, debit: 200, credit: 0, memo: 'Reverse other revenue by credit note' },
        { accountId: 3, debit: 0, credit: 100, memo: 'Reduce patient accounts receivable by credit note' },
        { accountId: 1, debit: 0, credit: 400, memo: 'Cash refund for credit note' },
      ]);
      expect(isBalancedJournal(lines)).toBe(true);
    });

    it('builds settlement discount lines as waiver expense against receivable', () => {
      expect(buildSettlementDiscountLines({ amount: 125 }, mappings)).toEqual([
        { accountId: 10, debit: 125, credit: 0, memo: 'Settlement discount allowed' },
        { accountId: 3, debit: 0, credit: 125, memo: 'Reduce patient accounts receivable for settlement discount' },
      ]);
    });

    it('splits doctor-funded settlement discounts through doctor commission payable', () => {
      const lines = buildSettlementDiscountLines({
        amount: 300,
        discountAllocations: [
          { allocationType: 'doctor_commission_waiver', amount: 200 },
          { allocationType: 'hospital_discount', amount: 100 },
        ],
      }, mappings);

      expect(lines).toEqual([
        { accountId: 10, debit: 100, credit: 0, memo: 'Settlement discount allowed' },
        { accountId: 12, debit: 200, credit: 0, memo: 'Doctor commission waiver applied to settlement discount' },
        { accountId: 3, debit: 0, credit: 300, memo: 'Reduce patient accounts receivable for settlement discount' },
      ]);
      expect(isBalancedJournal(lines)).toBe(true);
    });

    it('builds cash handover lines from cashier cash to admin cash', () => {
      const lines = buildCashHandoverLines({ amount: 600 }, mappings);

      expect(lines).toEqual([
        { accountId: 16, debit: 600, credit: 0, memo: 'Admin/main cash received from cashier' },
        { accountId: 1, debit: 0, credit: 600, memo: 'Cashier cash handed over' },
      ]);
      expect(isBalancedJournal(lines)).toBe(true);
    });

    it('builds bank deposit custody lines from counter cash to finance custody', () => {
      const lines = buildBankDepositCustodyLines({ amount: 25000 }, mappings);

      expect(lines).toEqual([
        { accountId: 16, debit: 25000, credit: 0, memo: 'Cash received into finance custody' },
        { accountId: 1, debit: 0, credit: 25000, memo: 'Cash removed from counter drawer' },
      ]);
      expect(isBalancedJournal(lines)).toBe(true);
    });

    it('builds confirmed bank deposit lines from finance custody to bank', () => {
      const lines = buildBankDepositConfirmedLines({ amount: 25000 }, mappings);

      expect(lines).toEqual([
        { accountId: 2, debit: 25000, credit: 0, memo: 'Bank deposit confirmed' },
        { accountId: 16, debit: 0, credit: 25000, memo: 'Finance custody cleared to bank' },
      ]);
      expect(isBalancedJournal(lines)).toBe(true);
    });
  });
});

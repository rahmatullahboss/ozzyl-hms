import { describe, expect, it } from 'vitest';
import { createMockDB } from '../integration/helpers/mock-db';
import {
  postAccountingEventBySourceKey,
  postPendingAccountingEvents,
  ACCOUNTING_EVENT_TYPES,
  type ResolvedAccountMappings,
} from '../../src/lib/accounting-posting';

const TENANT = 'tenant-1';
const SOURCE_KEY = 'billing:42:bill_created';

const mappings: ResolvedAccountMappings = {
  cash: 101,
  accounts_receivable: 201,
  lab_revenue: 301,
  doctor_visit_revenue: 302,
  admission_revenue: 303,
  operation_revenue: 304,
  pharmacy_revenue: 305,
  other_revenue: 306,
  discount_allowed: 401,
  doctor_commission_payable: 501,
  patient_deposit_liability: 601,
  accounts_payable: 701,
  doctor_commission_expense: 801,
  pharmacy_inventory: 901,
  general_inventory: 902,
};

const baseEvent = {
  id: 9001,
  tenant_id: TENANT,
  source_event_key: SOURCE_KEY,
  source_type: 'billing',
  source_id: '42',
  event_type: ACCOUNTING_EVENT_TYPES.billCreated,
  event_date: '2026-06-15',
  payload_json: JSON.stringify({
    invoiceNo: 'BL-042',
    patientId: 11,
    total: 1000,
    discount: 0,
    testBill: 0,
    doctorVisitBill: 0,
    admissionBill: 1000,
    operationBill: 0,
    medicineBill: 0,
  }),
  status: 'pending',
  attempts: null,
  created_by: 'user-1',
};

const baseFiscalYear = {
  id: 11,
  tenant_id: TENANT,
  fiscal_year_name: 'FY-2026',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  is_active: 1,
  is_closed: 0,
};

const baseVoucherType = {
  id: 21,
  tenant_id: TENANT,
  code: 'JV',
  name: 'Journal Voucher',
  is_active: 1,
};

const baseNumbering = {
  id: 31,
  tenant_id: TENANT,
  voucher_type_id: 21,
  fiscal_year_id: 11,
  last_number: 0,
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type RecordedQueryLike = { sql: string };

function getSql(q: RecordedQueryLike): string {
  return asString(q.sql);
}

function isBalanceCheck(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('from accounting_journal_lines')
    && lower.includes('count(*)')
    && lower.includes('sum(debit_amount)');
}

function isExistingVoucherLookup(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('from accounting_vouchers')
    && lower.includes('source_event_key')
    && !lower.includes('verification_hash');
}

function isPeriodCloseCheck(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('from accounting_period_closes');
}

function isMarkProcessing(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('update accounting_posting_events')
    && lower.includes("status = 'processing'");
}

function isMarkPosted(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('update accounting_posting_events')
    && lower.includes("status = 'posted'");
}

function isMarkFailed(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('update accounting_posting_events')
    && lower.includes("status = 'failed'");
}

function isMarkDeadLetter(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('update accounting_posting_events')
    && lower.includes("status = 'dead_letter'");
}

function isJournalLineInsert(q: RecordedQueryLike): boolean {
  return getSql(q).toLowerCase().includes('insert into accounting_journal_lines');
}

function isVoucherInsert(q: RecordedQueryLike): boolean {
  return getSql(q).toLowerCase().includes('insert into accounting_vouchers');
}

function isSubLedgerInsert(q: RecordedQueryLike): boolean {
  return getSql(q).toLowerCase().includes('insert into sub_ledger_transactions');
}

function isSubLedgerTransactionLookup(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('from sub_ledger_transactions')
    && lower.includes('voucher_id')
    && lower.includes('sub_ledger_id');
}

function isQueueSelect(q: RecordedQueryLike): boolean {
  const lower = getSql(q).toLowerCase();
  return lower.includes('from accounting_posting_events')
    && lower.includes('order by created_at asc')
    && lower.includes('limit ?');
}

describe('postAccountingEventBySourceKey — atomic posting', () => {
  it('marks event posted only after voucher and balanced journal lines are created', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent }],
        accounting_vouchers: [],
        accounting_journal_lines: [],
        fiscal_years: [{ ...baseFiscalYear }],
        voucher_types: [{ ...baseVoucherType }],
        voucher_numbering: [{ ...baseNumbering }],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 2, total_debit: 1000, total_credit: 1000 }] };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toMatchObject({ posted: true, voucherId: expect.any(Number), voucherNumber: expect.any(String) });

    const voucherInsert = queries.find(isVoucherInsert);
    expect(voucherInsert).toBeDefined();
    const journalInserts = queries.filter(isJournalLineInsert);
    expect(journalInserts.length).toBeGreaterThanOrEqual(2);
    const markProcessing = queries.find(isMarkProcessing);
    expect(markProcessing).toBeDefined();
    expect(markProcessing?.sql.toLowerCase()).not.toContain('coalesce(attempts, 0) + 1');
    expect(queries.find(isMarkPosted)).toBeDefined();
    expect(queries.find(isMarkFailed)).toBeUndefined();
  });

  it('uses a guarded processing claim and returns posted result when a no-op claim was already posted', async () => {
    let eventLookupCount = 0;
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [],
        accounting_vouchers: [],
        accounting_journal_lines: [],
      },
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select *') && lower.includes('from accounting_posting_events')) {
          eventLookupCount += 1;
          return {
            first: eventLookupCount === 1
              ? { ...baseEvent }
              : { ...baseEvent, status: 'posted', posted_voucher_id: 777 },
          };
        }
        if (isMarkProcessing({ sql })) {
          return { success: true, meta: { changes: 0 } };
        }
        if (lower.includes('from accounting_vouchers') && lower.includes('where tenant_id = ? and id = ?')) {
          return { first: { voucher_number: 'JV-FY-2026-005' } };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({
      posted: true,
      voucherId: 777,
      voucherNumber: 'JV-FY-2026-005',
    });
    const markProcessing = queries.find(isMarkProcessing);
    expect(markProcessing).toBeDefined();
    expect(markProcessing?.sql.toLowerCase()).toContain("status in ('pending', 'failed')");
    expect(markProcessing?.sql.toLowerCase()).toContain('coalesce(attempts, 0) < 5');
    expect(queries.find(isVoucherInsert)).toBeUndefined();
  });

  it('does not mark event posted when journal-line batch fails', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent }],
        accounting_vouchers: [],
        accounting_journal_lines: [],
        fiscal_years: [{ ...baseFiscalYear }],
        voucher_types: [{ ...baseVoucherType }],
        voucher_numbering: [{ ...baseNumbering }],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      batchError: 'simulated D1 batch failure',
    });

    await expect(
      postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY),
    ).rejects.toThrow('simulated D1 batch failure');

    expect(queries.find(isVoucherInsert)).toBeDefined();
    const markPosted = queries.find(isMarkPosted);
    expect(markPosted).toBeUndefined();
    const markProcessing = queries.find(isMarkProcessing);
    expect(markProcessing).toBeDefined();
    expect(markProcessing?.sql.toLowerCase()).not.toContain('coalesce(attempts, 0) + 1');
    const failedUpdates = queries.filter(isMarkFailed);
    expect(failedUpdates).toHaveLength(1);
    const markFailed = failedUpdates[0];
    expect(markFailed).toBeDefined();
    expect(markFailed.sql.toLowerCase()).toContain('coalesce(attempts, 0) + 1');
  });

  it('does not mark event posted when an existing voucher is partial or unbalanced', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent, status: 'failed', attempts: 1 }],
        accounting_vouchers: [{
          id: 555,
          tenant_id: TENANT,
          source_event_key: SOURCE_KEY,
          voucher_number: 'JV-FY-2026-001',
          status: 'verified',
        }],
        accounting_journal_lines: [{
          id: 1, tenant_id: TENANT, voucher_id: 555, account_id: 201,
          debit_amount: 1000, credit_amount: 0, line_no: 1, memo: 'partial',
        }],
        fiscal_years: [{ ...baseFiscalYear }],
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 1, total_debit: 1000, total_credit: 0 }] };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({ posted: false, skippedReason: 'partial_voucher' });
    expect(queries.find(isMarkPosted)).toBeUndefined();
    const markFailed = queries.find(isMarkFailed);
    expect(markFailed).toBeDefined();
    expect(markFailed?.params[0]).toContain('partial or unbalanced');
  });

  it('uses COALESCE-safe attempts increment when period is closed and attempts is NULL', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent, attempts: null }],
        accounting_vouchers: [],
        accounting_journal_lines: [],
        fiscal_years: [{ ...baseFiscalYear }],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isPeriodCloseCheck({ sql })) {
          return { results: [{ status: 'closed' }] };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({ posted: false, skippedReason: 'period_closed' });
    const markFailed = queries.find(isMarkFailed);
    expect(markFailed).toBeDefined();
    expect(markFailed?.sql.toLowerCase()).toContain('coalesce(attempts, 0) + 1');
    expect(markFailed?.params[0]).toBe('Period is closed for this date');
  });

  it('marks failed events with attempts >= 5 as dead_letter before skipping', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent, status: 'failed', attempts: 5 }],
        accounting_vouchers: [],
        accounting_journal_lines: [],
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({ posted: false, skippedReason: 'dead_letter' });
    expect(queries.find(isVoucherInsert)).toBeUndefined();
    expect(queries.find(isMarkProcessing)).toBeUndefined();
    expect(queries.find(isMarkPosted)).toBeUndefined();
    expect(queries.find(isMarkFailed)).toBeUndefined();
    const markDeadLetter = queries.find(isMarkDeadLetter);
    expect(markDeadLetter).toBeDefined();
    expect(markDeadLetter?.sql.toLowerCase()).toContain("status != 'dead_letter'");
  });

  it('does not duplicate the voucher on idempotent rerun', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent, status: 'pending' }],
        accounting_vouchers: [{
          id: 777,
          tenant_id: TENANT,
          source_event_key: SOURCE_KEY,
          voucher_number: 'JV-FY-2026-005',
          status: 'verified',
        }],
        accounting_journal_lines: [
          { id: 10, tenant_id: TENANT, voucher_id: 777, account_id: 201, debit_amount: 1000, credit_amount: 0, line_no: 1, memo: 'AR' },
          { id: 11, tenant_id: TENANT, voucher_id: 777, account_id: 303, debit_amount: 0, credit_amount: 1000, line_no: 2, memo: 'admission' },
        ],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 2, total_debit: 1000, total_credit: 1000 }] };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({
      posted: true,
      voucherId: 777,
      voucherNumber: 'JV-FY-2026-005',
    });
    expect(queries.find(isVoucherInsert)).toBeUndefined();
    const voucherLookups = queries.filter(isExistingVoucherLookup);
    expect(voucherLookups.length).toBeGreaterThanOrEqual(1);
  });

  it('repairs missing expected sub-ledger rows before marking an existing balanced voucher posted', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent, status: 'failed', attempts: 1 }],
        accounting_vouchers: [{
          id: 777,
          tenant_id: TENANT,
          source_event_key: SOURCE_KEY,
          voucher_number: 'JV-FY-2026-005',
          status: 'verified',
        }],
        accounting_journal_lines: [
          { id: 10, tenant_id: TENANT, voucher_id: 777, account_id: 201, debit_amount: 1000, credit_amount: 0, line_no: 1, memo: 'AR' },
          { id: 11, tenant_id: TENANT, voucher_id: 777, account_id: 303, debit_amount: 0, credit_amount: 1000, line_no: 2, memo: 'admission' },
        ],
        sub_ledgers: [{ id: 110, tenant_id: TENANT, code: '11', type: 'customer', is_active: 1 }],
        sub_ledger_transactions: [],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 2, total_debit: 1000, total_credit: 1000 }] };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({
      posted: true,
      voucherId: 777,
      voucherNumber: 'JV-FY-2026-005',
    });
    expect(queries.find(isVoucherInsert)).toBeUndefined();
    expect(queries.find(isSubLedgerTransactionLookup)).toBeDefined();
    const subLedgerInserts = queries.filter(isSubLedgerInsert);
    expect(subLedgerInserts).toHaveLength(1);
    expect(subLedgerInserts[0].params).toEqual([TENANT, 110, 1000, 0, 777]);
    const markPostedIndex = queries.findIndex(isMarkPosted);
    const subLedgerInsertIndex = queries.findIndex(isSubLedgerInsert);
    expect(subLedgerInsertIndex).toBeGreaterThanOrEqual(0);
    expect(markPostedIndex).toBeGreaterThan(subLedgerInsertIndex);
  });

  it('inserts only missing expected sub-ledger rows for an existing balanced voucher', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{
          ...baseEvent,
          status: 'failed',
          attempts: 1,
          payload_json: JSON.stringify({
            invoiceNo: 'BL-042',
            patientId: 11,
            doctorId: 22,
            total: 1000,
            discount: 0,
            testBill: 0,
            doctorVisitBill: 1000,
            admissionBill: 0,
            operationBill: 0,
            medicineBill: 0,
            appointmentDoctorPayable: 300,
          }),
        }],
        accounting_vouchers: [{
          id: 777,
          tenant_id: TENANT,
          source_event_key: SOURCE_KEY,
          voucher_number: 'JV-FY-2026-005',
          status: 'verified',
        }],
        accounting_journal_lines: [
          { id: 10, tenant_id: TENANT, voucher_id: 777, account_id: 201, debit_amount: 1000, credit_amount: 0, line_no: 1, memo: 'AR' },
          { id: 11, tenant_id: TENANT, voucher_id: 777, account_id: 302, debit_amount: 0, credit_amount: 1000, line_no: 2, memo: 'doctor visit' },
          { id: 12, tenant_id: TENANT, voucher_id: 777, account_id: 801, debit_amount: 300, credit_amount: 0, line_no: 3, memo: 'doctor commission' },
          { id: 13, tenant_id: TENANT, voucher_id: 777, account_id: 501, debit_amount: 0, credit_amount: 300, line_no: 4, memo: 'doctor payable' },
        ],
        sub_ledgers: [
          { id: 110, tenant_id: TENANT, code: '11', type: 'customer', is_active: 1 },
          { id: 220, tenant_id: TENANT, code: '22', type: 'consultant', is_active: 1 },
        ],
        sub_ledger_transactions: [{
          id: 1,
          tenant_id: TENANT,
          voucher_id: 777,
          sub_ledger_id: 110,
          dr_amount: 1000,
          cr_amount: 0,
        }],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 4, total_debit: 1300, total_credit: 1300 }] };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result.posted).toBe(true);
    const subLedgerInserts = queries.filter(isSubLedgerInsert);
    expect(subLedgerInserts).toHaveLength(1);
    expect(subLedgerInserts[0].params).toEqual([TENANT, 220, 0, 300, 777]);
  });

  it('returns posted result for an already-posted event even when attempts >= 5', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{
          ...baseEvent,
          status: 'posted',
          attempts: 5,
          posted_voucher_id: 777,
        }],
        accounting_vouchers: [{
          id: 777,
          tenant_id: TENANT,
          source_event_key: SOURCE_KEY,
          voucher_number: 'JV-FY-2026-005',
          status: 'verified',
        }],
        accounting_journal_lines: [],
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({
      posted: true,
      voucherId: 777,
      voucherNumber: 'JV-FY-2026-005',
    });
    expect(queries.find(isMarkDeadLetter)).toBeUndefined();
    expect(queries.find(isMarkPosted)).toBeUndefined();
  });

  it('returns posted_voucher_id for an already-posted event instead of the posting event id', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent, status: 'posted', posted_voucher_id: 777 }],
        accounting_vouchers: [{
          id: 777,
          tenant_id: TENANT,
          source_event_key: SOURCE_KEY,
          voucher_number: 'JV-FY-2026-005',
          status: 'verified',
        }],
        accounting_journal_lines: [],
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({
      posted: true,
      voucherId: 777,
      voucherNumber: 'JV-FY-2026-005',
    });
    expect(result.voucherId).not.toBe(baseEvent.id);
    expect(queries.find(isVoucherInsert)).toBeUndefined();
    expect(queries.find(isMarkProcessing)).toBeUndefined();
    expect(queries.find(isMarkFailed)).toBeUndefined();
  });

  it('does not repair or mark posted for an active processing event with an existing balanced voucher', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent, status: 'processing', attempts: 0 }],
        accounting_vouchers: [{
          id: 777,
          tenant_id: TENANT,
          source_event_key: SOURCE_KEY,
          voucher_number: 'JV-FY-2026-005',
          status: 'verified',
        }],
        accounting_journal_lines: [
          { id: 10, tenant_id: TENANT, voucher_id: 777, account_id: 201, debit_amount: 1000, credit_amount: 0, line_no: 1, memo: 'AR' },
          { id: 11, tenant_id: TENANT, voucher_id: 777, account_id: 303, debit_amount: 0, credit_amount: 1000, line_no: 2, memo: 'admission' },
        ],
        sub_ledgers: [{ id: 110, tenant_id: TENANT, code: '11', type: 'customer', is_active: 1 }],
        sub_ledger_transactions: [],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 2, total_debit: 1000, total_credit: 1000 }] };
        }
        return null;
      },
    });

    const result = await postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY);

    expect(result).toEqual({ posted: false, skippedReason: 'already_processing' });
    expect(queries.find(isMarkPosted)).toBeUndefined();
    expect(queries.find(isSubLedgerTransactionLookup)).toBeUndefined();
    expect(queries.find(isSubLedgerInsert)).toBeUndefined();
    expect(queries.find(isMarkFailed)).toBeUndefined();
  });

  it('does not mark event posted when voucher balance check fails', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [{ ...baseEvent }],
        accounting_vouchers: [],
        accounting_journal_lines: [],
        fiscal_years: [{ ...baseFiscalYear }],
        voucher_types: [{ ...baseVoucherType }],
        voucher_numbering: [{ ...baseNumbering }],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 2, total_debit: 1000, total_credit: 999 }] };
        }
        return null;
      },
    });

    await expect(
      postAccountingEventBySourceKey(db, TENANT, SOURCE_KEY),
    ).rejects.toThrow(/balance check/);

    expect(queries.find(isVoucherInsert)).toBeDefined();
    expect(queries.find(isMarkPosted)).toBeUndefined();
    const markFailed = queries.find(isMarkFailed);
    expect(markFailed).toBeDefined();
    expect(markFailed?.params[0]).toMatch(/balance check/);
  });
});

describe('postPendingAccountingEvents — queue recovery', () => {
  it('selects pending, retryable failed, and stale processing events', async () => {
    const { db, queries } = createMockDB({
      tables: {
        accounting_posting_events: [],
      },
    });

    const result = await postPendingAccountingEvents(db, TENANT);

    expect(result).toEqual([]);
    const queueSelect = queries.find(isQueueSelect);
    expect(queueSelect).toBeDefined();
    const sql = queueSelect?.sql.toLowerCase() ?? '';
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain('coalesce(attempts, 0) < 5');
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain("datetime('now', '+6 hours', '-15 minutes')");
  });

  it('keeps processing later events when one queued posting throws', async () => {
    const secondSourceKey = 'billing:43:bill_created';
    const { db } = createMockDB({
      tables: {
        accounting_posting_events: [
          { ...baseEvent, id: 9001, source_event_key: SOURCE_KEY, payload_json: '{bad json' },
          { ...baseEvent, id: 9002, source_event_key: secondSourceKey, source_id: '43' },
        ],
        accounting_vouchers: [],
        accounting_journal_lines: [],
        fiscal_years: [{ ...baseFiscalYear }],
        voucher_types: [{ ...baseVoucherType }],
        voucher_numbering: [{ ...baseNumbering }],
        accounting_account_mappings: Object.entries(mappings).map(([k, v]) => ({
          tenant_id: TENANT, mapping_key: k, account_id: v, is_active: 1,
        })),
      },
      queryOverride: (sql) => {
        if (isBalanceCheck({ sql })) {
          return { results: [{ line_count: 2, total_debit: 1000, total_credit: 1000 }] };
        }
        return null;
      },
    });

    const results = await postPendingAccountingEvents(db, TENANT);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ posted: false, skippedReason: 'posting_failed' });
    expect(results[1]).toMatchObject({ posted: true, voucherId: expect.any(Number) });
  });
});

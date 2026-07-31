import { describe, expect, it } from 'vitest';
import {
  loadCashLedgerBackfillDryRun,
  loadCashLedgerBalances,
  loadCashLedgerEvents,
  loadCashLedgerExceptions,
  loadCashLedgerOverview,
  loadCashLedgerReadiness,
  loadCashLedgerReconciliation,
  loadCashLedgerShadowIssues,
  loadCashLedgerShadowReconciliation,
} from '../../src/lib/cash-ledger-service';

type QueryResult = { results?: Record<string, unknown>[]; first?: Record<string, unknown> | null };
type QueryHandler = (sql: string, params: unknown[]) => QueryResult;

function createCashLedgerDb(handler: QueryHandler): D1Database {
  return {
    prepare(sql: string) {
      const state = { params: [] as unknown[] };
      return {
        bind(...params: unknown[]) {
          state.params = params;
          return this;
        },
        async all<T = Record<string, unknown>>() {
          const result = handler(sql, state.params);
          return { results: (result.results ?? []) as T[], success: true, meta: {} };
        },
        async first<T = Record<string, unknown>>() {
          const result = handler(sql, state.params);
          return (result.first ?? result.results?.[0] ?? null) as T | null;
        },
        async run() {
          return { success: true, meta: { last_row_id: 0, changes: 0, duration: 0 } };
        },
        async raw<T = unknown[]>() {
          return [] as T[];
        },
      };
    },
    async batch() { return []; },
    async dump() { return new ArrayBuffer(0); },
    async exec() { return { count: 0, duration: 0 }; },
  } as unknown as D1Database;
}

const TENANT_ID = '102';

function patientCareLikeDb(): D1Database {
  return createCashLedgerDb((sql) => {
    const normalized = sql.replace(/\s+/g, ' ').toLowerCase();

    if (normalized.includes('active_drawer_cash')) {
      return { first: { active_drawer_cash: 5900 } };
    }

    if (normalized.includes('from emp_cash_transactions ect')) {
      return {
        results: [
          {
            id: 1,
            employee_id: 119,
            counter_id: 9,
            counter_session_id: 8,
            transaction_type: 'CashSales',
            amount: 15800,
            reference_id: 'BILL-1',
            reference_type: 'bill',
            payment_method: 'cash',
            description: 'Patient bill cash collection',
            created_at: '2026-06-19 12:00:00',
            employee_name: 'Safaoat Ullah',
            counter_name: 'Reception 2',
            accounting_posting_status: 'posted',
            accounting_voucher_id: 10,
          },
          {
            id: 2,
            employee_id: 119,
            counter_id: 9,
            counter_session_id: 8,
            transaction_type: 'CollectionFromReceivable',
            amount: 8600,
            reference_id: 'DUE-1',
            reference_type: 'bill_due',
            payment_method: 'cash',
            description: 'Due collection',
            created_at: '2026-06-19 14:00:00',
            employee_name: 'Safaoat Ullah',
            counter_name: 'Reception 2',
            accounting_posting_status: 'posted',
            accounting_voucher_id: 11,
          },
        ],
      };
    }

    if (normalized.includes('from cash_drawer_movements m')) {
      // Linked cash_custody_transfer/expense drawer movements are intentionally
      // not returned here because the cash ledger service should avoid double counting
      // source documents that already explain the movement.
      return { results: [] };
    }

    if (normalized.includes('from billing_counter_cash_transfers t')) {
      return {
        results: [
          {
            id: 2,
            transfer_no: 'CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a',
            counter_session_id: 8,
            counter_id: 9,
            transfer_by: 119,
            transfer_to: 116,
            amount: 18450,
            received_amount: 0,
            due_amount: 18450,
            status: 'pending',
            destination_type: 'admin_custody',
            custody_label: 'Dr. Nazmus Sakib (hospital_admin)',
            note: null,
            receiver_note: null,
            accounting_voucher_id: null,
            created_at: '2026-06-19 22:23:36',
            received_at: null,
            from_user_name: 'Safaoat Ullah',
            to_user_name: 'Dr. Nazmus Sakib',
            to_user_role: 'hospital_admin',
            counter_name: 'Reception 2',
            accounting_posting_status: 'queued',
          },
        ],
      };
    }

    if (normalized.includes('from billing_handovers h')) {
      return { results: [] };
    }

    if (normalized.includes('from expenses e')) {
      return {
        results: [
          {
            id: 7051,
            amount: 50,
            category: 'Tea / staff refreshment',
            description: 'Reference Doctor Cha',
            counter_session_id: 8,
            cash_movement_id: 20,
            created_by: 119,
            executed_by: 119,
            date: '2026-06-19',
            created_at: '2026-06-19 22:00:58',
            user_name: 'Safaoat Ullah',
            counter_id: 9,
            counter_name: 'Reception 2',
            accounting_posting_status: 'posted',
          },
        ],
      };
    }

    if (normalized.includes('from doctor_commission_settlements s')) {
      return { results: [] };
    }

    if (normalized.includes('from bank_deposit_requests bdr')) {
      return { results: [] };
    }

    return { results: [], first: null };
  });
}

describe('cash-ledger-service — enterprise cash position', () => {
  it('separates active drawer cash from pending custody transfer without double counting', async () => {
    const db = patientCareLikeDb();

    const overview = await loadCashLedgerOverview(db, TENANT_ID, { includeResolved: true });

    expect(overview.activeDrawerCash).toBe(5900);
    expect(overview.pendingTransferCash).toBe(18450);
    expect(overview.expensePaidCash).toBe(50);
    expect(overview.adminCustodyCash).toBe(0);
    expect(overview.disputedCash).toBe(0);
    expect(overview.totalCashAccountedFor).toBe(24400);
    expect(overview.unresolvedCount).toBeGreaterThanOrEqual(1);
  });

  it('normalizes the Safaoat to Dr. Nazmus pending transfer as in-transit cash', async () => {
    const db = patientCareLikeDb();

    const events = await loadCashLedgerEvents(db, TENANT_ID, { includeResolved: true });
    const transfer = events.find((event) => event.sourceType === 'cash_custody_transfer');

    expect(transfer).toMatchObject({
      sourceId: '2',
      sourceNo: 'CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a',
      amount: 18450,
      dueAmount: 18450,
      status: 'pending',
      cashStatus: 'PENDING_RECEIVE',
      currentLocationType: 'in_transit',
      fromUserName: 'Safaoat Ullah',
      toUserName: 'Dr. Nazmus Sakib',
      counterName: 'Reception 2',
    });
  });

  it('uses Bangladesh-local emp cash timestamps for ledger filters and ordering', async () => {
    const queries: string[] = [];
    const db = createCashLedgerDb((sql) => {
      queries.push(sql);
      return { results: [] };
    });

    await loadCashLedgerEvents(db, TENANT_ID, { date: '2026-06-22', includeResolved: true });

    const empCashQuery = queries.find((sql) => sql.includes('FROM emp_cash_transactions ect'));
    expect(empCashQuery).toContain("date(datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours')) = date(?)");
    expect(empCashQuery).toContain("datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours') AS created_at");
    expect(empCashQuery).toContain("ORDER BY datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours') DESC");
  });

  it('surfaces pending transfers as exceptions until receiver confirmation', async () => {
    const db = patientCareLikeDb();

    const exceptions = await loadCashLedgerExceptions(db, TENANT_ID, { includeResolved: true });

    expect(exceptions.some((event) => event.sourceType === 'cash_custody_transfer' && event.currentLocationType === 'in_transit')).toBe(true);
  });

  it('returns cash-bank-book custody balance buckets from the unified ledger', async () => {
    const db = patientCareLikeDb();

    const balances = await loadCashLedgerBalances(db, TENANT_ID, { includeResolved: true });

    expect(balances).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'active_drawer_cash', amount: 5900 }),
      expect.objectContaining({ key: 'pending_transfer_cash', amount: 18450 }),
      expect.objectContaining({ key: 'expense_paid_cash', amount: 50 }),
      expect.objectContaining({ key: 'disputed_cash', amount: 0 }),
    ]));
  });

  it('produces reconciliation checks that guard enterprise cash invariants', async () => {
    const db = patientCareLikeDb();

    const report = await loadCashLedgerReconciliation(db, TENANT_ID, { includeResolved: true });

    expect(report.status).toBe('pass');
    expect(report.overview.activeDrawerCash).toBe(5900);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'no_unclassified_cash_out', status: 'pass' }),
      expect.objectContaining({ key: 'no_disputed_cash', status: 'pass' }),
      expect.objectContaining({ key: 'pending_exceptions_match', status: 'pass', expectedAmount: 18450, actualAmount: 18450 }),
      expect.objectContaining({ key: 'active_drawer_non_negative', status: 'pass' }),
    ]));
  });
});

describe('cash-ledger-service — bank deposit normalization', () => {
  it('treats confirmed bank deposit requests as banked even when request status is approved', async () => {
    const db = createCashLedgerDb((sql) => {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      if (normalized.includes('active_drawer_cash')) return { first: { active_drawer_cash: 0 } };
      if (normalized.includes('from emp_cash_transactions ect')) return { results: [] };
      if (normalized.includes('from cash_drawer_movements m')) return { results: [] };
      if (normalized.includes('from billing_counter_cash_transfers t')) return { results: [] };
      if (normalized.includes('from billing_handovers h')) return { results: [] };
      if (normalized.includes('from expenses e')) return { results: [] };
      if (normalized.includes('from doctor_commission_settlements s')) return { results: [] };
      if (normalized.includes('from bank_deposit_requests bdr')) {
        return { results: [{
          id: 55,
          request_no: 'BDR-55',
          counter_session_id: 8,
          counter_id: 9,
          requested_by: 119,
          requested_amount: 5000,
          proposed_bank_name: 'DBBL',
          request_note: 'Deposit request',
          status: 'approved',
          bank_transaction_id: 77,
          confirmed_bank_name: 'DBBL',
          confirmed_reference_no: 'BR-123',
          confirmed_date: '2026-06-19',
          confirmed_by: 116,
          confirmed_at: '2026-06-19 23:00:00',
          resolution_type: 'deposited',
          created_at: '2026-06-19 22:30:00',
          requested_by_name: 'Safaoat Ullah',
          confirmed_by_name: 'Dr. Nazmus Sakib',
          counter_name: 'Reception 2',
        }] };
      }
      return { results: [], first: null };
    });

    const events = await loadCashLedgerEvents(db, TENANT_ID, { includeResolved: true });
    const bankDeposit = events.find((event) => event.sourceType === 'bank_deposit_request');
    const overview = await loadCashLedgerOverview(db, TENANT_ID, { includeResolved: true });

    expect(bankDeposit).toMatchObject({
      sourceId: '55',
      status: 'approved',
      cashStatus: 'BANKED',
      currentLocationType: 'bank',
      receivedAmount: 5000,
      dueAmount: 0,
    });
    expect(overview.bankedCash).toBe(5000);
    expect(overview.bankDepositPendingCash).toBe(0);
  });
});


describe('cash-ledger-service — dry-run historical cash ledger report', () => {
  it('estimates missing historical rows without writing to cash_ledger_entries', async () => {
    const db = createCashLedgerDb((sql, params) => {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      const eventType = String(params[1] ?? '').toUpperCase();
      if (normalized.includes('from billing_counter_cash_transfers')) return { first: { count: 2, amount: 2000 } };
      if (normalized.includes('from expenses')) return { first: { count: 1, amount: 300 } };
      if (normalized.includes('from doctor_commission_settlements')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_deposits') && normalized.includes("transaction_type = 'deposit'")) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_deposits') && normalized.includes("transaction_type = 'refund'")) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from emp_cash_transactions')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_settlements')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from cash_ledger_entries')) {
        if (eventType === 'CASH_CUSTODY_TRANSFER_REQUESTED') return { first: { count: 1, amount: 1000 } };
        if (eventType === 'EXPENSE_PAID') return { first: { count: 1, amount: 300 } };
        return { first: { count: 0, amount: 0 } };
      }
      return { first: { count: 0, amount: 0 } };
    });

    const report = await loadCashLedgerBackfillDryRun(db, TENANT_ID, { includeResolved: true });

    expect(report.status).toBe('warning');
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'cash_transfer_requested', status: 'warning', missingCount: 1, missingAmount: 1000 }),
      expect.objectContaining({ key: 'expense_paid', status: 'ready', missingCount: 0, missingAmount: 0 }),
    ]));
    expect(report.totals.missingAmount).toBe(1000);
    expect(report.blockedFlows).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'pharmacy_payment' }),
      expect.objectContaining({ key: 'gateway_payment' }),
    ]));
  });
});

describe('cash-ledger-service — readiness', () => {
  it('reports attention when shadow flow decisions or historical rows remain', async () => {
    const db = createCashLedgerDb((sql, params) => {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      const eventType = String(params[1] ?? '').toUpperCase();
      if (normalized.includes('from billing_counter_cash_transfers')) return { first: { count: 1, amount: 1000 } };
      if (normalized.includes('from expenses')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from doctor_commission_settlements')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_deposits')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from emp_cash_transactions')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_settlements')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from cash_ledger_shadow_issues')) return { results: [] };
      if (normalized.includes('from cash_ledger_entries')) {
        if (eventType === 'CASH_CUSTODY_TRANSFER_REQUESTED') return { first: { count: 1, amount: 1000 } };
        return { first: { count: 0, amount: 0 } };
      }
      return { first: { count: 0, amount: 0 }, results: [] };
    });

    const report = await loadCashLedgerReadiness(db, TENANT_ID, { includeResolved: true });

    expect(report.status).toBe('attention');
    expect(report.ready).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'shadow_reconciliation', status: 'pass' }),
      expect.objectContaining({ key: 'shadow_log', status: 'pass' }),
      expect.objectContaining({ key: 'pending_items', status: 'warning' }),
    ]));
    expect(report.pendingItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'pharmacy_payment' }),
      expect.objectContaining({ key: 'gateway_payment' }),
    ]));
  });
});

describe('cash-ledger-service — shadow issue log', () => {
  it('loads recent shadow issue rows with parsed payload metadata', async () => {
    const db = createCashLedgerDb((sql, params) => {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      if (normalized.includes('from cash_ledger_shadow_issues')) {
        expect(params[0]).toBe(TENANT_ID);
        return {
          results: [{
            id: 7,
            tenant_id: TENANT_ID,
            source_type: 'settlement',
            source_id: '55',
            event_type: 'RECEIVABLE_COLLECTION_RECEIVED',
            idempotency_key: 'cash-ledger:settlement:55:collection',
            issue_message: 'table unavailable',
            payload_json: '{"amount":500,"cashStatus":"IN_DRAWER"}',
            created_at: '2026-06-21 05:10:00',
          }],
        };
      }
      return { results: [] };
    });

    const issues = await loadCashLedgerShadowIssues(db, TENANT_ID, { date: '2026-06-21', limit: 10 });

    expect(issues).toEqual([
      expect.objectContaining({
        id: 7,
        sourceType: 'settlement',
        sourceId: '55',
        eventType: 'RECEIVABLE_COLLECTION_RECEIVED',
        issueMessage: 'table unavailable',
        payload: expect.objectContaining({ amount: 500, cashStatus: 'IN_DRAWER' }),
      }),
    ]);
  });
});

describe('cash-ledger-service — shadow reconciliation monitoring', () => {
  it('compares source totals with cash_ledger_entries and lists blocked flows', async () => {
    const db = createCashLedgerDb((sql, params) => {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      const eventType = String(params[1] ?? '').toUpperCase();
      if (normalized.includes('from billing_counter_cash_transfers')) return { first: { count: 1, amount: 18450 } };
      if (normalized.includes('from expenses')) return { first: { count: 1, amount: 50 } };
      if (normalized.includes('from doctor_commission_settlements')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_deposits') && normalized.includes("transaction_type = 'deposit'")) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_deposits') && normalized.includes("transaction_type = 'refund'")) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from billing_settlements')) return { first: { count: 0, amount: 0 } };
      if (normalized.includes('from cash_ledger_entries')) {
        if (eventType === 'CASH_CUSTODY_TRANSFER_REQUESTED') return { first: { count: 1, amount: 18450 } };
        if (eventType === 'EXPENSE_PAID') return { first: { count: 0, amount: 0 } };
        return { first: { count: 0, amount: 0 } };
      }
      return { first: { count: 0, amount: 0 } };
    });

    const report = await loadCashLedgerShadowReconciliation(db, TENANT_ID, { includeResolved: true });

    expect(report.status).toBe('warning');
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'cash_transfer_requested', status: 'pass', sourceAmount: 18450, shadowAmount: 18450 }),
      expect.objectContaining({ key: 'expense_paid', status: 'warning', sourceAmount: 50, shadowAmount: 0 }),
    ]));
    expect(report.blockedFlows).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'pharmacy_payment' }),
      expect.objectContaining({ key: 'gateway_payment' }),
    ]));
  });
});

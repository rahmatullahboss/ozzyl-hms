import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMockDB } from '../integration/helpers/mock-db';
import {
  findPartialAccountingVouchers,
  markAccountingEventsDeadLetter,
  repairBillsMissingAccountingEvents,
} from '../../src/lib/accounting-recovery';

describe('accounting recovery helpers', () => {
  it('detects partial voucher risks', async () => {
    const { db, queries } = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('as line_count')) {
          return { results: [{
            voucher_id: 7,
            voucher_number: 'JV-007',
            source_event_key: 'billing:10:bill_created',
            event_status: 'failed',
            line_count: 1,
            total_debit: 1000,
            total_credit: 0,
          }] };
        }
        return null;
      },
    });

    const rows = await findPartialAccountingVouchers(db, 'tenant-1', 25);

    expect(rows[0]).toEqual(expect.objectContaining({
      voucherId: 7,
      sourceEventKey: 'billing:10:bill_created',
      lineCount: 1,
      totalDebit: 1000,
      totalCredit: 0,
    }));
    expect(queries[0].sql.toLowerCase()).toContain('v.source_event_key is not null');
    expect(queries[0].sql.toLowerCase()).toContain('having count(jl.id) < 2');
  });

  it('repairs missing bill-created posting events idempotently', async () => {
    const { db, queries } = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from bills b')) {
          return { results: [{
            bill_id: 10,
            invoice_no: 'BL-001',
            patient_id: 55,
            visit_id: null,
            created_by: 'user-1',
            event_date: '2026-06-15',
            subtotal: 1200,
            discount: 200,
            total: 1000,
            test_bill: 0,
            doctor_visit_bill: 0,
            admission_bill: 1000,
            operation_bill: 0,
            medicine_bill: 0,
            counter_id: 2,
            counter_session_id: 3,
          }] };
        }
        return null;
      },
    });

    const result = await repairBillsMissingAccountingEvents(db, 'tenant-1', 10);
    const insertQuery = queries.find((query) => query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events'));

    expect(result).toEqual(expect.objectContaining({
      scanned: 1,
      inserted: 1,
      sourceEventKeys: ['billing:10:bill_created'],
    }));
    expect(insertQuery?.params[1]).toBe('billing:10:bill_created');
    expect(insertQuery?.params[3]).toBe('bill_created');
    expect(JSON.parse(String(insertQuery?.params[5]))).toEqual(expect.objectContaining({
      billId: 10,
      invoiceNo: 'BL-001',
      recovered: true,
    }));
  });

  it('moves repeatedly failed posting events to dead letter status', async () => {
    // Override any UPDATE on accounting_posting_events to report 1 row changed
    // (the mock has no seeded tables, so the default UPDATE path returns 0).
    const { db, queries } = createMockDB({
      queryOverride: (sql) => {
        if (/UPDATE\s+accounting_posting_events/i.test(sql)) {
          return { results: [], success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const changed = await markAccountingEventsDeadLetter(db, 'tenant-1', 5);

    expect(changed).toBe(1);
    expect(queries[0].sql.toLowerCase()).toContain("set status = 'dead_letter'");
    expect(queries[0].sql.toLowerCase()).toContain('coalesce(attempts, 0) >= ?');
  });

  it('adds database guards so posting cannot silently go missing or falsely posted', () => {
    const sql = readFileSync('migrations/0300_accounting_posting_db_guards.sql', 'utf8').toLowerCase();

    expect(sql).toContain('create trigger if not exists trg_bills_insert_accounting_event');
    expect(sql).toContain("'billing:' || new.id || ':bill_created'");
    expect(sql).toContain('insert or ignore into accounting_posting_events');
    expect(sql).toContain('create trigger if not exists trg_accounting_event_posted_requires_balanced_voucher');
    expect(sql).toContain("new.status = 'posted'");
    expect(sql).toContain('count(*) >= 2');
    expect(sql).toContain('sum(jl.debit_amount)');
    expect(sql).toContain('idx_accounting_posting_events_retry_queue');
  });

  it('hardens recovery maintenance routes against accidental mutation and overexposure', () => {
    const route = readFileSync('src/routes/tenant/accountingRecovery.ts', 'utf8');

    expect(route).toContain("const RECOVERY_CONFIRMATION = 'RUN_ACCOUNTING_RECOVERY'");
    expect(route).toContain('body.confirm !== RECOVERY_CONFIRMATION');
    expect(route).toContain('markAccountingEventsDeadLetter');
    expect(route).toContain('await createAuditLog');
    expect(route).toContain('withOptionalItems(partialVouchers, includeItems)');
    expect(route).toContain('Detailed accounting recovery items require accounting/admin access');
  });
});

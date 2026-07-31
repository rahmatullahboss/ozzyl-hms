import { describe, expect, it } from 'vitest';
import dailyCollectionRoutes from '../../../src/routes/tenant/dailyCollection';
import billingHandoverRoutes from '../../../src/routes/tenant/billingHandover';
import expensesRoutes from '../../../src/routes/tenant/expenses';
import reportsRoutes from '../../../src/routes/tenant/reports';
import { createTestApp, jsonRequest } from '../helpers/test-app';

describe('collection and handover report reconciliation', () => {
  it('scopes receptionist daily collection reports to their own cash ledger rows', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'receptionist',
      userId: 7,
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as total_cash_sales')) {
          return {
            first: {
              total_cash_sales: 100,
              total_sales_return: 0,
              total_deposit_deduct: 0,
              total_deposit_return: 0,
              total_collection_from_receivable: 0,
              total_cash_discount_given: 0,
              total_cash_discount_received: 0,
            },
          };
        }
        if (lower.includes('group by employee_id')) return { results: [] };
        if (lower.includes('group by coalesce(payment_method')) return { results: [] };
        if (lower.includes('order by created_at')) return { results: [] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');

    expect(res.status).toBe(200);
    const cashQueries = mockDB.queries.filter((q) => q.sql.includes('FROM emp_cash_transactions'));
    expect(cashQueries.length).toBeGreaterThan(0);
    expect(cashQueries.every((q) => q.params[2] === 7 && q.params[3] === 7)).toBe(true);
  });

  it('scopes legacy paid-bill doctor collections to the requested employee and counter', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: () => ({ first: null, results: [] }),
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10&employee_id=7&counter_id=3');
    expect(res.status).toBe(200);

    const doctorCollectionQuery = mockDB.queries.find((query) => (
      query.sql.includes('WITH invoice_service_bases AS')
      && query.sql.includes('paid_bills AS')
    ));
    expect(doctorCollectionQuery?.sql).toContain('AND (? IS NULL OR b.created_by = ?)');
    expect(doctorCollectionQuery?.sql).toContain('AND (? IS NULL OR b.counter_id = ?)');
    expect(doctorCollectionQuery?.params.slice(8, 14)).toEqual(['tenant-1', '2026-05-10', 7, 7, 3, 3]);
  });

  it('normalizes cash-movement-backed expense details to paid status', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: () => ({ first: null, results: [] }),
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);

    const expenseDetailQuery = mockDB.queries.find((query) => (
      query.sql.includes('FROM expenses e')
      && query.sql.includes('line_status')
    ));
    expect(expenseDetailQuery?.sql).toContain("WHEN e.cash_movement_id IS NOT NULL THEN 'paid'");
  });

  it('blocks a receptionist from querying another employee daily collection report', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'receptionist',
      userId: 7,
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10&employee_id=8');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/own daily collection/i);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM emp_cash_transactions'))).toBe(false);
  });

  it('rejects invalid daily collection report dates before querying finance rows', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-13-40');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/valid date/i);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM emp_cash_transactions'))).toBe(false);
  });

  it('uses the matching payment date for daily collection bill timestamps in Bangladesh time', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as total_cash_sales')) {
          return { first: {}, results: [] };
        }
        return { first: null, results: [] };
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-06-24');
    expect(res.status).toBe(200);

    const detailQuery = mockDB.queries.find((q) => (
      q.sql.includes("COALESCE(b.invoice_no, ect.description, '') as description")
    ));
    expect(detailQuery?.sql).toContain("SELECT strftime('%Y-%m-%dT%H:%M:%S', p.date) || '+06:00'");
    expect(detailQuery?.sql).toContain("strftime('%Y-%m-%dT%H:%M:%S', ect.created_at, '+6 hours') || '+06:00'");
    expect(detailQuery?.sql).toContain('AS created_at');
    expect(detailQuery?.sql).toContain('ORDER BY CASE');

    const paymentFallbackQuery = mockDB.queries.find((q) => (
      q.sql.includes("'bill_payment' as reference_type")
    ));
    expect(paymentFallbackQuery?.sql).toContain("strftime('%Y-%m-%dT%H:%M:%S', p.date) || '+06:00'");
    expect(paymentFallbackQuery?.sql).toContain("strftime('%Y-%m-%dT%H:%M:%S', p.created_at, '+6 hours') || '+06:00'");
  });

  it('uses payments for payment method shares and signed cash ledger rows for employee summaries', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as total_cash_sales')) {
          return {
            first: {
              total_cash_sales: 1000,
              total_sales_return: 200,
              total_deposit_deduct: 300,
              total_deposit_return: 50,
              total_collection_from_receivable: 400,
              total_cash_discount_given: 25,
              total_cash_discount_received: 10,
            },
          };
        }
        if (lower.includes('group by ect.employee_id')) {
          return {
            results: [{
              employee_id: 1,
              cash_sales: 1000,
              sales_return: 200,
              deposit_deduct: 300,
              deposit_return: 50,
              collection_from_receivable: 400,
              cash_discount_given: 25,
              cash_discount_received: 10,
              net: 1150,
            }],
          };
        }
        if (lower.includes('from payments') && !lower.includes('left join bills b')) {
          if (lower.includes('group by') && lower.includes('payment_method')) {
            return {
              results: [{
                payment_method: 'cash',
                transaction_count: 7,
                gross_amount: 1150,
                net_amount: 1150,
                total_amount: 1150,
              }],
            };
          } else {
            return {
              first: {
                current_collection: 1000,
                due_collection: 400,
                cash_received: 1400,
                total_received: 1400,
              }
            };
          }
        }
        if (lower.includes("coalesce(b.invoice_no, ect.description, '') as description")) {
          return { results: [{ id: 1, transaction_type: 'SalesReturn', amount: 200, signed_amount: -200 }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      summary: { total_collection: number };
      finance_summary: { net_collection: number };
      by_employee: Array<{ net: number }>;
      by_payment_method: Array<{ total_amount: number; net_amount: number }>;
      details: Array<{ signed_amount: number }>;
    };

    expect(body.finance_summary.net_collection).toBe(1200);
    expect(body.by_employee[0].net).toBe(1150);
    expect(body.by_payment_method[0].total_amount).toBe(1150);
    expect(body.by_payment_method[0].net_amount).toBe(1150);
    expect(body.details[0].signed_amount).toBe(-200);

    const employeeSql = mockDB.queries.find((q) => q.sql.includes('GROUP BY ect.employee_id'))?.sql ?? '';
    const paymentSql = mockDB.queries.find((q) => q.sql.includes('FROM payments') && q.sql.includes('net_amount'))?.sql ?? '';
    expect(employeeSql).toContain('CollectionFromReceivable');
    expect(employeeSql).toContain('THEN -ect.amount');
    expect(paymentSql).toContain('net_amount');
    expect(paymentSql).toContain('FROM payments');
    expect(paymentSql).not.toContain('FROM emp_cash_transactions');
  });

  it('uses posted accounting events before operational payments for collection totals', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from accounting_posting_events') && lower.includes("event_type = 'payment_received'") && lower.includes('group by')) {
          return {
            results: [
              { payment_method: 'cash', transaction_count: 1, gross_amount: 700, net_amount: 700, total_amount: 700 },
              { payment_method: 'bkash', transaction_count: 1, gross_amount: 300, net_amount: 300, total_amount: 300 },
            ],
          };
        }
        if (lower.includes('from accounting_posting_events') && lower.includes("event_type = 'payment_received'")) {
          return {
            first: {
              current_collection: 700,
              due_collection: 300,
              cash_received: 700,
              total_received: 1000,
            },
          };
        }
        if (lower.includes('from payments') && lower.includes('group by') && lower.includes('payment_method')) {
          return {
            results: [{ payment_method: 'cash', transaction_count: 1, gross_amount: 999, net_amount: 999, total_amount: 999 }],
          };
        }
        if (lower.includes('from payments')) {
          return {
            first: {
              current_collection: 999,
              due_collection: 0,
              cash_received: 999,
              total_received: 999,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      finance_summary: {
        total_received: number;
        current_collection: number;
        due_collection: number;
        cash_received: number;
      };
      by_payment_method: Array<{ payment_method: string; total_amount: number }>;
    };

    expect(body.finance_summary.total_received).toBe(1000);
    expect(body.finance_summary.current_collection).toBe(700);
    expect(body.finance_summary.due_collection).toBe(300);
    expect(body.finance_summary.cash_received).toBe(700);
    expect(body.by_payment_method).toEqual([
      expect.objectContaining({ payment_method: 'cash', total_amount: 700 }),
      expect.objectContaining({ payment_method: 'bkash', total_amount: 300 }),
    ]);
  });

  it('normalizes payment method labels so duplicate cash rows collapse into one share', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payments') && lower.includes('group by') && lower.includes('payment_method')) {
          return {
            results: [
              { payment_method: 'cash', transaction_count: 2, gross_amount: 200, net_amount: 200, total_amount: 200 },
              { payment_method: 'bkash', transaction_count: 1, gross_amount: 50, net_amount: 50, total_amount: 50 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as { by_payment_method: Array<{ payment_method: string; total_amount: number }> };
    expect(body.by_payment_method.filter((row) => row.payment_method === 'cash')).toHaveLength(1);
    expect(body.by_payment_method).toContainEqual(expect.objectContaining({ payment_method: 'cash', total_amount: 200 }));
    expect(body.by_payment_method).toContainEqual(expect.objectContaining({ payment_method: 'bkash', total_amount: 50 }));
  });

  it('uses invoice test lines for KPI and doctor-wise test fallback when lab operational rows are missing', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('with invoice_service_bases as') && lower.includes('service_lines as')) {
          return {
            results: [{
              doctor_id: 5,
              doctor_name: 'Dr Invoice',
              visit_collection_amount: 0,
              test_collection_amount: 1500,
            }],
          };
        }

        // Primary visit query (visit_services JOIN doctors) — returns nothing
        if (lower.includes('from visit_services vs') && lower.includes("vs.service_type = 'doctor_visit'")) {
          return { results: [] };
        }
        // Appointment fallback — returns nothing
        if (lower.includes('from appointments a') && lower.includes('group by d.id, d.name')) {
          return { results: [] };
        }
        // Primary test query (doctor_commission_accruals JOIN lab_order_items) — returns nothing
        if (lower.includes('from doctor_commission_accruals dca') && lower.includes('join lab_order_items loi') && lower.includes('count(distinct')) {
          return { results: [] };
        }
        if (lower.includes('from lab_orders lo') && lower.includes('join lab_order_items loi') && lower.includes('coalesce(b.referring_doctor_id')) {
          return { results: [] };
        }

        if (lower.includes('from invoice_items ii') && lower.includes('test_collection_amount') && lower.includes('group by d.id, d.name')) {
          return {
            results: [{
              doctor_id: 5,
              doctor_name: 'Dr Invoice',
              test_count: 3,
              test_order_count: 2,
              test_collection_amount: 1500,
            }],
          };
        }

        if (lower.includes('from bills b') && lower.includes('doctor_visit_amount') && lower.includes('group by d.id, d.name')) {
          return { results: [] };
        }

        if (lower.includes('from invoice_items ii') && lower.includes('sum(case when ii.item_category =')) {
          return {
            first: {
              test_count: 3,
              test_amount: 1500,
            },
          };
        }

        if (lower.includes('commission_amount') && lower.includes('from doctor_commission_accruals dca')) {
          return { results: [] };
        }

        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      service_summary: { test_count: number; test_amount: number };
      doctor_summaries: Array<{
        doctor_id: number;
        doctor_name: string;
        patient_count: number;
        doctor_visit_count: number;
        doctor_visit_amount: number;
        test_count: number;
        test_order_count: number;
        test_collection_amount: number;
        commission_amount: number;
      }>;
    };

    expect(body.service_summary.test_count).toBe(3);
    expect(body.service_summary.test_amount).toBe(1500);
    expect(body.doctor_summaries).toHaveLength(1);
    const doc = body.doctor_summaries[0];
    expect(doc.doctor_id).toBe(5);
    expect(doc.doctor_name).toBe('Dr Invoice');
    expect(doc.patient_count).toBe(0);
    expect(doc.doctor_visit_count).toBe(0);
    expect(doc.doctor_visit_amount).toBe(0);
    expect(doc.test_count).toBe(3);
    expect(doc.test_order_count).toBe(2);
    expect(doc.test_collection_amount).toBe(1500);
    expect(doc.commission_amount).toBe(0);
  });

  it('uses invoice consultation lines for doctor-wise visits when visit operational rows are missing', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('with invoice_service_bases as') && lower.includes('service_lines as')) {
          return {
            results: [{
              doctor_id: 5,
              doctor_name: 'Dr Visit',
              visit_collection_amount: 300,
              test_collection_amount: 0,
            }],
          };
        }
        if (lower.includes('from visit_services vs') && lower.includes("vs.service_type = 'doctor_visit'")) {
          return { results: [] };
        }
        if (lower.includes('from appointments a') && lower.includes('group by d.id, d.name')) {
          return { results: [] };
        }
        if (lower.includes('from bills b') && lower.includes('doctor_visit_amount') && lower.includes('group by d.id, d.name')) {
          return {
            results: [{
              doctor_id: 5,
              doctor_name: 'Dr Visit',
              patient_count: 1,
              doctor_visit_count: 1,
              doctor_visit_amount: 300,
            }],
          };
        }
        if (lower.includes('from doctor_commission_accruals dca') && lower.includes('count(distinct')) {
          return { results: [] };
        }
        if (lower.includes('from lab_orders lo') && lower.includes('join lab_order_items loi')) {
          return { results: [] };
        }
        if (lower.includes('from invoice_items ii') && lower.includes('test_collection_amount')) {
          return { results: [] };
        }
        if (lower.includes('from invoice_items ii') && lower.includes('sum(case when ii.item_category =')) {
          return { first: { test_count: 0, test_amount: 0 } };
        }
        if (lower.includes('commission_amount') && lower.includes('from doctor_commission_accruals dca')) {
          return { results: [] };
        }

        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      doctor_summaries: Array<{
        doctor_id: number;
        doctor_name: string;
        patient_count: number;
        doctor_visit_count: number;
        doctor_visit_amount: number;
      }>;
    };

    expect(body.doctor_summaries).toHaveLength(1);
    expect(body.doctor_summaries[0]).toMatchObject({
      doctor_id: 5,
      doctor_name: 'Dr Visit',
      patient_count: 1,
      doctor_visit_count: 1,
      doctor_visit_amount: 300,
    });
  });

  it('does not create doctor-wise operational activity from orphan commission accruals', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from visit_services vs') && lower.includes("vs.service_type = 'doctor_visit'")) return { results: [] };
        if (lower.includes('from appointments a') && lower.includes('group by d.id, d.name')) return { results: [] };
        if (lower.includes('from doctor_commission_accruals dca') && lower.includes('count(distinct')) return { results: [] };
        if (lower.includes('from lab_orders lo') && lower.includes('join lab_order_items loi')) return { results: [] };
        if (lower.includes('from invoice_items ii')) return lower.includes('group by d.id') ? { results: [] } : { first: { test_count: 0, test_amount: 0 } };
        if (lower.includes('commission_amount') && lower.includes('from doctor_commission_accruals dca')) return { results: [] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as { doctor_summaries: unknown[] };
    expect(body.doctor_summaries).toHaveLength(0);
    expect(mockDB.queries.some((q) => q.sql.includes('COUNT(DISTINCT dca.patient_id)'))).toBe(false);
  });

  it('builds report delivery and doctor test fallback from lab orders by Bangladesh report date', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('with invoice_service_bases as') && lower.includes('service_lines as')) {
          return {
            results: [{
              doctor_id: 9,
              doctor_name: 'Dr Lab',
              visit_collection_amount: 0,
              test_collection_amount: 700,
            }],
          };
        }
        if (lower.includes('from doctor_commission_accruals') && lower.includes("source_type = 'lab_test'")) {
          return { results: [] };
        }
        if (lower.includes('from invoice_items ii') && lower.includes("ii.item_category = 'test'")) {
          return { results: [] };
        }
        if (lower.includes('from lab_orders lo') && lower.includes('join lab_order_items loi') && lower.includes('coalesce(b.referring_doctor_id')) {
          return {
            results: [{
              doctor_id: 9,
              doctor_name: 'Dr Lab',
              test_count: 2,
              test_order_count: 1,
              test_collection_amount: 700,
            }],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as { doctor_summaries: Array<{ doctor_id: number; test_count: number; test_collection_amount: number }> };
    expect(body.doctor_summaries).toContainEqual(expect.objectContaining({
      doctor_id: 9,
      test_count: 2,
      test_collection_amount: 700,
    }));

    const labDateQueries = mockDB.queries.filter((q) => q.sql.includes('FROM lab_orders lo'));
    expect(labDateQueries.some((q) => q.sql.includes("'+6 hours'"))).toBe(true);
  });

  it('allocates mixed-invoice payments across services without counting the same receipt twice', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payment_allocations')) {
          return {
            first: {
              doctor_visit_collection: 60,
              test_collection: 40,
              ipd_collection: 0,
              ot_collection: 0,
              pharmacy_collection: 0,
              radiology_collection: 0,
              uncategorized_collection: 0,
              total_collection: 100,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      service_collection_summary: {
        doctor_visit_collection: number;
        test_collection: number;
        ipd_collection: number;
        ot_collection: number;
        pharmacy_collection: number;
        radiology_collection: number;
        uncategorized_collection: number;
        other_collection: number;
        total_collection: number;
      };
    };

    expect(body.service_collection_summary).toEqual({
      doctor_visit_collection: 60,
      test_collection: 40,
      ipd_collection: 0,
      ot_collection: 0,
      pharmacy_collection: 0,
      radiology_collection: 0,
      uncategorized_collection: 0,
      other_collection: 0,
      total_collection: 100,
    });
    expect(
      body.service_collection_summary.doctor_visit_collection
      + body.service_collection_summary.test_collection
      + body.service_collection_summary.ipd_collection
      + body.service_collection_summary.ot_collection
      + body.service_collection_summary.pharmacy_collection
      + body.service_collection_summary.radiology_collection
      + body.service_collection_summary.uncategorized_collection,
    ).toBe(body.service_collection_summary.total_collection);

    const allocationSql = mockDB.queries.find((query) => query.sql.includes('payment_allocations'))?.sql ?? '';
    expect(allocationSql).toContain('payment_base AS');
    expect(allocationSql).toContain('refunds_by_bill AS');
    expect(allocationSql).toContain('payment_allocations AS');
    expect(allocationSql).toContain('allocation_base');
    expect(allocationSql).toContain('1.0 * pb.amount * ai.line_amount / bit.allocation_base');
    expect(allocationSql).toContain("WHEN pb.admission_id IS NOT NULL THEN 'IPD'");
    expect(allocationSql).not.toContain("CASE WHEN COALESCE(b.doctor_visit_bill, 0) > 0 THEN p.amount");
  });

  it('keeps discharge deposit refunds out of the income net collection figure', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from accounting_posting_events') && lower.includes("event_type = 'payment_received'") && !lower.includes('group by')) {
          return {
            first: {
              current_collection: 36_979,
              due_collection: 0,
              cash_received: 2_450,
              total_received: 36_979,
            },
          };
        }
        if (lower.includes('from payments') && !lower.includes('group by')) {
          return {
            first: {
              current_collection: 36_979,
              due_collection: 0,
              cash_received: 2_450,
              total_received: 36_979,
            },
          };
        }
        if (lower.includes('from emp_cash_transactions') && lower.includes('as total_deposit_return')) {
          return {
            first: {
              total_cash_sales: 72_079,
              total_sales_return: 0,
              total_deposit_deduct: 0,
              total_deposit_return: 498_248,
              total_collection_from_receivable: 0,
              total_cash_discount_given: 0,
              total_cash_discount_received: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      finance_summary: { total_received: number; total_returns: number; net_collection: number };
    };

    expect(body.finance_summary.total_received).toBe(36_979);
    expect(body.finance_summary.total_returns).toBe(498_248);
    expect(body.finance_summary.net_collection).toBe(36_979);
  });

  it('keeps unassigned invoice test sales visible in the all-doctor report', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('with invoice_service_bases as') && lower.includes('service_lines as')) {
          return {
            results: [
              { doctor_id: 122, doctor_name: 'Dr. Linked', visit_collection_amount: 0, test_collection_amount: 1_050 },
              { doctor_id: 0, doctor_name: 'Unassigned / No Doctor', visit_collection_amount: 0, test_collection_amount: 371_750 },
            ],
          };
        }
        if (lower.includes('from visit_services vs') && lower.includes("vs.service_type = 'doctor_visit'")) return { results: [] };
        if (lower.includes('from appointments a') && lower.includes('group by d.id, d.name')) return { results: [] };
        if (lower.includes('from doctor_commission_accruals dca') && lower.includes('count(distinct')) return { results: [] };
        if (lower.includes('from lab_orders lo') && lower.includes('join lab_order_items loi')) return { results: [] };
        if (lower.includes('from invoice_items ii') && lower.includes('unassigned / no doctor')) {
          return {
            results: [{
              doctor_id: 0,
              doctor_name: 'Unassigned / No Doctor',
              test_count: 11,
              test_order_count: 2,
              test_collection_amount: 371_750,
            }],
          };
        }
        if (lower.includes('from invoice_items ii') && lower.includes('test_collection_amount')) {
          return {
            results: [{
              doctor_id: 122,
              doctor_name: 'Dr. Linked',
              test_count: 3,
              test_order_count: 1,
              test_collection_amount: 1_050,
            }],
          };
        }
        if (lower.includes('from invoice_items ii') && lower.includes('sum(case when ii.item_category =')) {
          return { first: { test_count: 14, test_amount: 372_800 } };
        }
        if (lower.includes('commission_amount') && lower.includes('from doctor_commission_accruals dca')) return { results: [] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      service_summary: { test_count: number; test_amount: number };
      doctor_summaries: Array<{ doctor_id: number; doctor_name: string; test_count: number; test_collection_amount: number }>;
    };

    expect(body.service_summary.test_count).toBe(14);
    expect(body.service_summary.test_amount).toBe(372_800);
    expect(body.doctor_summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ doctor_id: 122, test_count: 3, test_collection_amount: 1_050 }),
      expect.objectContaining({ doctor_id: 0, doctor_name: 'Unassigned / No Doctor', test_count: 11, test_collection_amount: 371_750 }),
    ]));
  });

  it('resolves visit invoice doctors from consultation invoice items when the bill has no visit doctor link', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as total_cash_sales')) {
          return { first: {}, results: [] };
        }
        return { first: null, results: [] };
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-06-22');
    expect(res.status).toBe(200);

    const invoiceSummaryQuery = mockDB.queries.find((q) => (
      q.sql.toLowerCase().includes('from bills b') && q.sql.toLowerCase().includes('end as source')
    ));
    expect(invoiceSummaryQuery?.sql).toContain('doctor_visit_item_doctors');
    expect(invoiceSummaryQuery?.sql).toContain('COALESCE(b.referring_doctor_id, v.doctor_id, doctor_visit_item_doctors.doctor_id)');
  });

  it('includes reference names and commission percentages in doctor test invoice detail queries', async () => {
    const { app, mockDB } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as total_cash_sales')) {
          return { first: {}, results: [] };
        }
        return { first: null, results: [] };
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-06-22');
    expect(res.status).toBe(200);

    const invoiceDetailsQuery = mockDB.queries.find((q) => {
      const lower = q.sql.toLowerCase();
      return lower.includes('from invoice_items ii')
        && lower.includes('group_concat')
        && lower.includes('test_commission_amount');
    });

    expect(invoiceDetailsQuery?.sql).toContain("COALESCE(NULLIF(b.referred_by_name, ''), d.name, 'Unassigned / No Doctor') as reference_name");
    expect(invoiceDetailsQuery?.sql).toContain('test_commission_percent');
    expect(invoiceDetailsQuery?.sql).toContain('COALESCE(comm.test_commission_amount, 0) * 100.0');
    expect(invoiceDetailsQuery?.sql).toContain("NULLIF(SUM(CASE WHEN ii.item_category = 'test' THEN COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)");
    expect(invoiceDetailsQuery?.sql).not.toContain('MAX(COALESCE(dca.commission_rate_bps, 0)) as commission_rate_bps');
    expect(invoiceDetailsQuery?.sql).not.toContain('WHEN COALESCE(dca.commission_rate_bps, 0) > 0 THEN dca.commission_rate_bps');
    expect(invoiceDetailsQuery?.sql).toContain("COALESCE(b.status, 'open') = 'paid'");
    expect(invoiceDetailsQuery?.sql).toContain('payable_commission_amount');
    expect(invoiceDetailsQuery?.sql).toContain('reversed_amount');
    expect(invoiceDetailsQuery?.sql).toContain('clawback_amount');
    expect(invoiceDetailsQuery?.sql).not.toContain('SUM(dca.commission_amount), 0) * 100.0');

    const commissionSummaryQuery = mockDB.queries.find((q) => {
      const lower = q.sql.toLowerCase();
      return lower.includes('from doctor_commission_accruals dca')
        && lower.includes('consultation_commission_amount')
        && lower.includes('referral_commission_amount');
    });
    expect(commissionSummaryQuery?.sql).toContain("COALESCE(b.status, 'open') = 'paid'");
    expect(commissionSummaryQuery?.sql).toContain('test_commission_percent');
    expect(commissionSummaryQuery?.sql).toContain('payable_commission_amount');
    expect(commissionSummaryQuery?.sql).toContain('reversed_amount');
    expect(commissionSummaryQuery?.sql).toContain('clawback_amount');
    expect(commissionSummaryQuery?.sql).not.toContain('COALESCE(SUM(dca.commission_amount), 0) as commission_amount');
  });

  it('allows reception to record approved cash expenses against the active drawer', async () => {
    const { app, mockDB } = createTestApp({
      route: expensesRoutes,
      routePath: '/expenses',
      role: 'reception',
      userId: 7,
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from billing_counter_sessions s') && lower.includes('join billing_counters')) {
          return {
            first: {
              id: 17,
              counter_id: 3,
              counter_name: 'Reception',
              counter_code: 'REC',
              counter_type: 'reception',
              opening_cash: 1000,
              opened_at: '2026-05-10 09:00:00',
            },
          };
        }
        if (lower.includes('from billing_counter_sessions s') && lower.includes('cash_in')) {
          return {
            first: {
              opening_cash: 1000,
              cash_in: 500,
              cash_out: 0,
              manual_cash_in: 0,
              manual_cash_out: 0,
              appointment_cash: 0,
              test_cash: 0,
              total_discount: 0,
              free_appointment_count: 0,
              doctor_payable_total: 0,
              commission_payable_total: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/expenses', {
      method: 'POST',
      body: {
        date: '2026-05-10',
        category: 'MISC',
        amount: 120,
        description: 'Tea for waiting patients',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('approved');
    const movementInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'));
    expect(movementInsert?.sql).toContain("'cash_out'");
    expect(movementInsert?.params).toContain(120);
    expect(movementInsert?.params).toContain('Tea for waiting patients');
  });

  it('builds handover difference from cash ledger movements instead of bill totals', async () => {
    const { app, mockDB } = createTestApp({
      route: billingHandoverRoutes,
      routePath: '/handover',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from emp_cash_transactions')) {
          return { first: { total_in: 1000, total_out: 200, total_collection: 800 } };
        }
        if (lower.includes('from billing_handovers')) {
          return { first: { total_handover: 700 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/handover/report/daily?date=2026-05-10&staff_id=1');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      total_in: number;
      total_out: number;
      total_collection: number;
      total_handover: number;
      difference: number;
    };

    expect(body.total_in).toBe(1000);
    expect(body.total_out).toBe(200);
    expect(body.total_collection).toBe(800);
    expect(body.total_handover).toBe(700);
    expect(body.difference).toBe(100);

    const collectionSql = mockDB.queries.find((q) => q.sql.includes('total_collection'))?.sql ?? '';
    expect(collectionSql).toContain('FROM emp_cash_transactions');
    expect(collectionSql).not.toContain('FROM bills');
    expect(collectionSql).not.toContain('DepositDeduct');
  });

  it('shows category-wise collection sources and never collapses IPD or unmapped money into Other Services', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as uncategorized_collection') && lower.includes('from payment_allocations')) {
          return {
            first: {
              doctor_visit_collection: 500,
              test_collection: 600,
              ipd_collection: 700,
              ot_collection: 200,
              pharmacy_collection: 100,
              radiology_collection: 75,
              uncategorized_collection: 25,
              total_collection: 2200,
            },
          };
        }
        if (lower.includes('from payments') && lower.includes('as current_collection') && !lower.includes('payment_allocations')) {
          return {
            first: {
              current_collection: 2200,
              due_collection: 0,
              cash_received: 2200,
              total_received: 2200,
            },
          };
        }
        if (lower.includes('from billing_deposits') && lower.includes('as deposit_collection')) {
          return {
            first: {
              deposit_collection: 300,
              cash_deposit_collection: 300,
              deposit_count: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      collection_sources: Array<{ department: string; amount: number }>;
      summary: { total_collection: number; total_deposit: number };
    };

    expect(body.summary.total_collection).toBe(2500);
    expect(body.summary.total_deposit).toBe(300);
    expect(body.collection_sources).toEqual([
      { department: 'Doctor Visit / Consultation', amount: 500 },
      { department: 'Diagnostic / Laboratory', amount: 600 },
      { department: 'Admission / IPD', amount: 700 },
      { department: 'Operation Theatre / Procedures', amount: 200 },
      { department: 'Pharmacy / Medicines', amount: 100 },
      { department: 'Radiology / Imaging', amount: 75 },
      { department: 'Uncategorized Services', amount: 25 },
      { department: 'Deposits / Advances', amount: 300 },
    ]);
    expect(body.collection_sources.some((row) => row.department === 'Other Services')).toBe(false);
  });

  it('returns the Daily Cash Closing Report structure on daily collection API', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('with refund_totals as')) {
          return { first: { total_sales_return: 200, cash_sales_return: 200 } };
        }
        if (lower.includes('refund_amount') && lower.includes("transaction_type = 'salesreturn'") && lower.includes('group by')) {
          return { results: [{ payment_method: 'cash', transaction_count: 1, refund_amount: 200 }] };
        }
        if (lower.includes('as total_cash_sales')) {
          return {
            first: {
              total_cash_sales: 1000,
              total_sales_return: 200,
              total_deposit_deduct: 300,
              total_deposit_return: 50,
              total_collection_from_receivable: 400,
            },
          };
        }
        if (lower.includes('from payments')) {
          if (lower.includes('group by') && lower.includes('payment_method')) {
            return {
              results: [{
                payment_method: 'cash',
                transaction_count: 7,
                gross_amount: 1150,
                net_amount: 1150,
                total_amount: 1150,
              }],
            };
          } else {
            return {
              first: {
                current_collection: 1150,
                due_collection: 0,
                cash_received: 1150,
                total_received: 1150,
              }
            };
          }
        }
        if (lower.includes('from bills') && lower.includes('total_billed')) {
          return {
            first: {
              bill_count: 10,
              patient_count: 8,
              total_billed: 2000,
              total_paid: 1500,
              total_due: 500,
              total_discount: 0,
              test_amount: 1200,
              doctor_visit_amount: 800,
              doctor_visit_count: 4,
            }
          };
        }
        if (lower.includes('from billing_counter_sessions') && lower.includes('opening_cash')) {
          return {
            first: {
              total_opening_cash: 500
            }
          };
        }
        if (lower.includes('as physical_cash_out')) {
          return { first: { physical_cash_out: 100 } };
        }
        if (lower.includes('from expenses') && lower.includes('approved')) {
          return {
            results: [
              { expense_head: 'MISC', amount: 100 }
            ]
          };
        }
        return null;
      }
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.summary.total_bill).toBe(2000);
    expect(body.summary.total_collection).toBe(950);
    expect(body.summary.total_due).toBe(500);

    expect(body.collection_sources).toContainEqual(expect.objectContaining({ department: 'Doctor Visit / Consultation' }));
    expect(body.payment_methods).toContainEqual(expect.objectContaining({ method: 'Cash', amount: 950 }));

    expect(body.expenses).toContainEqual(expect.objectContaining({ expense_head: 'MISC', amount: 100 }));

    expect(body.cash_closing.opening_cash).toBe(500);
    expect(body.cash_closing.cash_collection).toBe(900);
    expect(body.cash_closing.expense).toBe(100);
    expect(body.cash_closing.cash_in_hand).toBe(1300);
    expect(body.cash_closing.handover_amount).toBe(1300);
  });

  it('returns the Daily Discount Report with summaries and details', async () => {
    const { app, mockDB } = createTestApp({
      route: reportsRoutes,
      routePath: '/reports',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from bill_discount_allocations')) {
          return {
            results: [
              {
                invoice_no: 'INV-1001',
                patient_name: 'John Doe',
                created_at: '2026-05-10 10:30:00',
                service: 'Diagnostic / Laboratory',
                gross_amount: 1000,
                discount_amount: 150,
                discount_percent: 15,
                reason: 'Waiver',
                approved_by: 'Admin User',
                given_by: 'Dr. Smith',
                user: 'Receptionist A',
                counter: 'Main Counter'
              }
            ]
          };
        }
        return null;
      }
    });

    const res = await jsonRequest(app, '/reports/daily-discount?startDate=2026-05-10&endDate=2026-05-10');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      items: Array<{ invoice_no: string; discount_amount: number }>;
      summary: { total_discount_given: number; discounted_bills_count: number; average_discount: number };
    };

    expect(body.items).toHaveLength(1);
    expect(body.items[0].invoice_no).toBe('INV-1001');
    expect(body.items[0].discount_amount).toBe(150);
    expect(body.summary.total_discount_given).toBe(150);
    expect(body.summary.discounted_bills_count).toBe(1);
    expect(body.summary.average_discount).toBe(150);
  });
  it('reconciles collection, deposit liability, paid expenses, and doctor payouts without double counting', async () => {
    const { app } = createTestApp({
      route: dailyCollectionRoutes,
      routePath: '/daily-collection',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        // 1. Opening cash float query
        if (lower.includes('billing_counter_sessions') && lower.includes('opening_cash')) {
          return { first: { total_opening_cash: 2000 } };
        }
        // 2. Expenses Query
        if (lower.includes('from expenses')) {
          if (lower.includes('group by')) {
            return {
              results: [
                { expense_head: 'MISC', amount: 960 }
              ]
            };
          } else {
            return {
              results: [
                {
                  id: 2,
                  employee_id: 1,
                  counter_id: null,
                  transaction_type: 'Expense',
                  amount: -960,
                  reference_id: 2,
                  reference_type: 'expense',
                  payment_method: 'Cash',
                  invoice_no: null,
                  description: 'MISC - Electrolyte purchase',
                  category: 'MISC',
                  line_details: 'Electrolyte purchase',
                  line_status: 'paid',
                  signed_amount: -960,
                  transaction_date: '2026-05-10 10:00:00',
                  created_at: '2026-05-10 10:00:00'
                }
              ]
            };
          }
        }
        // 3. Physical drawer cash-out (cash expenses + doctor payout only).
        if (lower.includes('as physical_cash_out')) {
          return { first: { physical_cash_out: 1100 } };
        }
        // 4. Doctor payout summary/details
        if (lower.includes('from cash_drawer_movements') && lower.includes('doctor_commission_settlement')) {
          if (lower.includes('group by')) {
            return { results: [{ expense_head: 'Doctor payouts', amount: 300 }] };
          }
          return {
            results: [{
              id: 77,
              employee_id: 1,
              counter_id: 1,
              transaction_type: 'DoctorPayout',
              amount: -300,
              reference_id: 'settlement-77',
              reference_type: 'doctor_payout',
              payment_method: 'cash',
              invoice_no: null,
              description: 'Dr A payout',
              category: 'Doctor payouts',
              line_details: 'Dr A',
              line_status: 'paid',
              signed_amount: -300,
              transaction_date: '2026-05-10 09:30:00',
              created_at: '2026-05-10 09:30:00',
            }],
          };
        }
        // 4. Payments Query
        if (lower.includes('from payments') && !lower.includes('emp_cash_transactions')) {
          return {
            first: {
              current_collection: 13500,
              due_collection: 0,
              cash_received: 13500,
              total_received: 13500
            },
            results: [
              { payment_method: 'cash', transaction_count: 5, gross_amount: 13500, net_amount: 13500, total_amount: 13500 }
            ]
          };
        }
        // 4. Deposits Query
        if (lower.includes('from billing_deposits')) {
          return {
            first: {
              deposit_collection: 700,
              cash_deposit_collection: 700,
              deposit_count: 1
            },
            results: [
              { payment_method: 'cash', transaction_count: 1, gross_amount: 700, net_amount: 700, total_amount: 700 }
            ]
          };
        }
        // 5. Daily return summary (income return, not operating expense)
        if (lower.includes('from emp_cash_transactions') && lower.includes('total_sales_return')) {
          return {
            first: {
              total_cash_sales: 13500,
              total_sales_return: 100,
              total_deposit_deduct: 0,
              total_deposit_return: 0,
              total_collection_from_receivable: 0,
              total_cash_discount_given: 0,
              total_cash_discount_received: 0,
            },
          };
        }
        // 6. emp_cash_transactions query for ledgerDetails
        if (lower.includes('from emp_cash_transactions')) {
          return {
            results: [
              {
                id: 1,
                employee_id: 1,
                counter_id: 1,
                transaction_type: 'CashSales',
                amount: 13500,
                reference_id: 1,
                reference_type: 'bill_payment',
                payment_method: 'cash',
                invoice_no: 'INV-1001',
                description: 'INV-1001',
                signed_amount: 13500,
                transaction_date: '2026-05-10 11:00:00',
                created_at: '2026-05-10 11:00:00'
              }
            ]
          };
        }
        return { first: null, results: [] };
      }
    });

    const res = await jsonRequest(app, '/daily-collection?date=2026-05-10');
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    // Management Total Collection includes patient deposits received.
    expect(body.summary.total_collection).toBe(14100);
    expect(body.summary.total_deposit).toBe(700);
    expect(body.summary.total_expense).toBe(1260);
    // Net Income is Total Collection minus the complete paid expense total.
    expect(body.summary.net_income).toBe(12840);
    expect(body.summary.net_cash).toBe(13000);
    expect(body.cash_closing.expense).toBe(1100);
    expect(body.cash_closing.accounting_expense).toBe(1260);

    // Detail list contains receipt, operating expense, and doctor payout.
    expect(body.details).toHaveLength(3);
    const cashSalesItem = body.details.find((d: any) => d.transaction_type === 'CashSales');
    const expenseItem = body.details.find((d: any) => d.transaction_type === 'Expense');
    const payoutItem = body.details.find((d: any) => d.transaction_type === 'DoctorPayout');
    expect(cashSalesItem).toBeDefined();
    expect(expenseItem).toBeDefined();
    expect(payoutItem).toBeDefined();
    expect(expenseItem.amount).toBe(-960);
    expect(payoutItem.amount).toBe(-300);

    expect(body.expense_details).toEqual([
      expect.objectContaining({ category: 'MISC', details: 'Electrolyte purchase', amount: 960, payment_method: 'Cash', status: 'paid' }),
      expect.objectContaining({ category: 'Doctor payouts', details: 'Dr A', amount: 300, payment_method: 'cash', status: 'paid' }),
    ]);
  });
});

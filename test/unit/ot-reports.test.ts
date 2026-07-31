import { describe, expect, it } from 'vitest';
import {
  generateDailyReport,
  generateFinancialReport,
  generateInventoryReport,
  generateUtilizationReport,
} from '../../src/lib/ot-reports';

/**
 * Tests for OT Reports service.
 *
 * Each report is a pure function that takes a D1 client + params
 * and returns a structured report object.
 *
 * We test with mock D1 that returns predefined rows.
 */

function makeMockD1(rows: Record<string, unknown>[][] = []) {
  let callIndex = 0;
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all<T>() {
              const result = rows[callIndex] ?? [];
              callIndex++;
              return { results: result as T[], success: true, meta: {} };
            },
            async first<T>() {
              const result = rows[callIndex]?.[0] ?? null;
              callIndex++;
              return result as T | null;
            },
          };
        },
      };
    },
  };
}

describe('generateDailyReport', () => {
  it('returns a daily report with correct structure', async () => {
    const db = makeMockD1([
      // total scheduled
      [{ total: 10 }],
      // completed
      [{ count: 7 }],
      // cancelled
      [{ count: 1 }],
      // emergency
      [{ count: 2 }],
      // in_progress
      [{ count: 0 }],
      // room utilization
      [{ room_name: 'OT-1', bookings: 5, utilization_pct: 62.5 }],
      // surgeon cases
      [{ surgeon_name: 'Dr. Hasan', cases: 4 }],
      // procedure cases
      [{ surgery_type: 'Appendectomy', cases: 3 }],
    ]);
    const report = await generateDailyReport(db as unknown as D1Database, '1', '2026-06-05');
    expect(report.date).toBe('2026-06-05');
    expect(report.total_scheduled).toBe(10);
    expect(report.completed).toBe(7);
    expect(report.cancelled).toBe(1);
    expect(report.emergency).toBe(2);
    expect(report.room_utilization.length).toBe(1);
    expect(report.surgeon_cases.length).toBe(1);
    expect(report.procedure_cases.length).toBe(1);
  });
});

describe('generateFinancialReport', () => {
  it('returns a financial report with correct structure', async () => {
    const db = makeMockD1([
      // bill totals
      [{ total_revenue: 500000, total_discount: 25000, net_revenue: 475000 }],
      // charge head breakdown
      [
        { charge_head: 'surgery', total: 300000 },
        { charge_head: 'medicines', total: 50000 },
        { charge_head: 'implant', total: 100000 },
      ],
      // surgeon commission
      [{ total: 45000 }],
      // anesthetist commission
      [{ total: 20000 }],
    ]);
    const report = await generateFinancialReport(db as unknown as D1Database, '1', '2026-06-01', '2026-06-30');
    expect(report.date_from).toBe('2026-06-01');
    expect(report.date_to).toBe('2026-06-30');
    expect(report.total_revenue).toBe(500000);
    expect(report.surgery_charges).toBe(300000);
    expect(report.medicine_charges).toBe(50000);
    expect(report.implant_charges).toBe(100000);
    expect(report.surgeon_commission).toBe(45000);
    expect(report.anesthetist_commission).toBe(20000);
    expect(report.total_discount).toBe(25000);
    expect(report.net_revenue).toBe(475000);
  });
});

describe('generateInventoryReport', () => {
  it('returns an inventory report with correct structure', async () => {
    const db = makeMockD1([
      // totals
      [{ total_items: 50, total_value: 75000 }],
      // by source
      [
        { source: 'ot_sub_store', items: 30, value: 45000 },
        { source: 'central_pharmacy', items: 20, value: 30000 },
      ],
      // by charge head
      [
        { charge_head: 'consumables', items: 25, value: 25000 },
        { charge_head: 'medicines', items: 15, value: 30000 },
        { charge_head: 'implant', items: 10, value: 20000 },
      ],
      // wastage
      [{ items: 3, value: 2500 }],
      // returned
      [{ items: 5, value: 5000 }],
    ]);
    const report = await generateInventoryReport(db as unknown as D1Database, '1', '2026-06-01', '2026-06-30');
    expect(report.total_items_used).toBe(50);
    expect(report.total_value).toBe(75000);
    expect(report.by_source.length).toBe(2);
    expect(report.by_charge_head.length).toBe(3);
    expect(report.wastage.items).toBe(3);
    expect(report.returned.items).toBe(5);
  });
});

describe('generateUtilizationReport', () => {
  it('returns a utilization report with correct structure', async () => {
    const db = makeMockD1([
      // room utilization
      [
        { room_name: 'OT-1', total_bookings: 20, avg_duration_min: 90, utilization_pct: 75 },
        { room_name: 'OT-2', total_bookings: 15, avg_duration_min: 120, utilization_pct: 60 },
      ],
      // avg surgery duration
      [{ avg_duration: 95 }],
      // avg cleaning duration
      [{ avg_duration: 35 }],
      // delay reasons (empty for now)
      [],
    ]);
    const report = await generateUtilizationReport(db as unknown as D1Database, '1', '2026-06-01', '2026-06-30');
    expect(report.room_utilization.length).toBe(2);
    expect(report.room_utilization[0].room_name).toBe('OT-1');
    expect(report.avg_surgery_duration_min).toBe(95);
    expect(report.avg_cleaning_duration_min).toBe(35);
  });
});

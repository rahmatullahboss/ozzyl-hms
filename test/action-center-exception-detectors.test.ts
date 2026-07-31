import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCEPTION_DETECTORS,
  EXCEPTION_RULES,
  detectExceptionObservations,
  detectHighDiscountBills,
  detectMissingDiscountReferences,
  detectLowStockMedicines,
  detectSameDayBillCancellations,
  detectStaleHandovers,
} from '../src/services/actionCenter/exceptions/detectors';

interface QueryRecord {
  sql: string;
  binds: unknown[];
}

type ResultMap = Record<string, Array<Record<string, unknown>>>;

function createDetectorDb(results: ResultMap, failMarker?: string): {
  db: D1Database;
  queries: QueryRecord[];
} {
  const queries: QueryRecord[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          queries.push({ sql, binds });
          return {
            async all() {
              if (failMarker && sql.includes(failMarker)) {
                throw new Error('detector query failed');
              }
              const marker = Object.keys(results).find((key) => sql.includes(key));
              return { results: marker ? results[marker] : [] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, queries };
}

const context = (db: D1Database) => ({
  db,
  tenantId: 'tenant-example',
  now: '2026-07-14 12:00:00',
});

describe('exception detector contracts', () => {
  it('exports the approved rule keys and default detector set', () => {
    expect(EXCEPTION_RULES).toEqual({
      staleHandover: 'cash.stale_handover',
      highDiscount: 'billing.high_discount',
      missingDiscountReference: 'billing.missing_discount_reference',
      billCancellation: 'billing.same_day_cancellation',
      lowStock: 'inventory.low_stock',
    });
    expect(DEFAULT_EXCEPTION_DETECTORS).toHaveLength(5);
  });

  it('detects pending handovers older than 24 hours, including zero-amount handovers', async () => {
    const { db, queries } = createDetectorDb({
      'exception:stale-handover': [
        {
          id: 42,
          handover_amount: 0,
          handover_by_name: 'Reception A',
          created_at: '2026-07-13 08:00:00',
        },
      ],
    });

    const observations = await detectStaleHandovers(context(db));

    expect(observations).toEqual([
      expect.objectContaining({
        ruleKey: EXCEPTION_RULES.staleHandover,
        fingerprint: 'handover:42',
        sourceType: 'cash_handover',
        sourceId: '42',
        module: 'cash',
        severity: 'warning',
        sourceHref: '/cash/handover/42',
        autoResolvable: true,
        allowRecurrence: true,
        metadata: expect.objectContaining({
          amount: 0,
          sourceTimestamp: '2026-07-13 08:00:00',
        }),
      }),
    ]);
    expect(observations[0]?.description).toContain('৳0');
    expect(queries).toHaveLength(1);
    expect(queries[0]?.binds).toEqual(['tenant-example', '2026-07-14 12:00:00']);
    expect(queries[0]?.sql).toContain("h.status = 'pending'");
    expect(queries[0]?.sql).toContain("datetime(?, '-24 hours')");
  });

  it('normalizes high discounts, same-day cancellations, and low stock with stable fingerprints and source links', async () => {
    const { db, queries } = createDetectorDb({
      'exception:high-discount': [
        {
          id: 7,
          invoice_no: 'INV-7',
          subtotal: 1000,
          total: 750,
          discount: 250,
          discount_pct: 25,
          created_at: '2026-07-14 09:30:00',
        },
      ],
      'exception:missing-discount-reference': [
        {
          id: 6,
          invoice_no: 'INV-6',
          total: 800,
          discount: 200,
          created_at: '2026-07-14 09:00:00',
        },
      ],
      'exception:same-day-cancellation': [
        {
          id: 8,
          invoice_no: 'INV-8',
          total: 1200,
          cancel_reason: 'Duplicate',
          cancelled_at: '2026-07-14 10:15:00',
        },
      ],
      'exception:low-stock': [
        {
          id: 9,
          name: 'Paracetamol',
          quantity: 3,
        },
      ],
    });

    const [discounts, missingReferences, cancellations, lowStock] = await Promise.all([
      detectHighDiscountBills(context(db)),
      detectMissingDiscountReferences(context(db)),
      detectSameDayBillCancellations(context(db)),
      detectLowStockMedicines(context(db)),
    ]);

    expect(discounts[0]).toEqual(expect.objectContaining({
      ruleKey: EXCEPTION_RULES.highDiscount,
      fingerprint: 'bill:7:discount',
      sourceHref: '/cash/discounts?billId=7',
      severity: 'warning',
      autoResolvable: false,
      allowRecurrence: false,
    }));
    expect(missingReferences[0]).toEqual(expect.objectContaining({
      ruleKey: EXCEPTION_RULES.missingDiscountReference,
      fingerprint: 'bill:6:discount-reference',
      sourceHref: '/cash/discounts?billId=6',
      severity: 'critical',
      autoResolvable: false,
      allowRecurrence: false,
    }));
    expect(cancellations[0]).toEqual(expect.objectContaining({
      ruleKey: EXCEPTION_RULES.billCancellation,
      fingerprint: 'bill:8:cancel',
      sourceHref: '/billing-cancellation?billId=8',
      severity: 'critical',
      autoResolvable: false,
      allowRecurrence: false,
    }));
    expect(lowStock[0]).toEqual(expect.objectContaining({
      ruleKey: EXCEPTION_RULES.lowStock,
      fingerprint: 'medicine:9:low-stock',
      sourceHref: '/pharmacy/items?medicineId=9',
      severity: 'info',
      autoResolvable: true,
      allowRecurrence: true,
    }));

    expect(queries.every((query) => query.binds[0] === 'tenant-example')).toBe(true);
    expect(queries.filter((query) => query.sql.includes('date(?)')).every(
      (query) => query.binds.includes('2026-07-14 12:00:00'),
    )).toBe(true);
  });

  it('deduplicates repeated source rows across the combined detector run', async () => {
    const duplicate = {
      id: 42,
      handover_amount: 100,
      handover_by_name: 'Reception A',
      created_at: '2026-07-13 08:00:00',
    };
    const { db } = createDetectorDb({
      'exception:stale-handover': [duplicate, duplicate],
      'exception:high-discount': [],
      'exception:missing-discount-reference': [],
      'exception:same-day-cancellation': [],
      'exception:low-stock': [],
    });

    const observations = await detectExceptionObservations(context(db));

    expect(observations).toHaveLength(1);
    expect(observations[0]?.fingerprint).toBe('handover:42');
  });

  it('propagates detector query failures to the synchronization caller', async () => {
    const { db } = createDetectorDb({}, 'exception:low-stock');

    await expect(detectLowStockMedicines(context(db))).rejects.toThrow('detector query failed');
  });
});

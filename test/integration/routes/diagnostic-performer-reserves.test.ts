import { describe, expect, it } from 'vitest';
import { createMockDB } from '../helpers/mock-db';
import {
  createBillDiagnosticPerformerReserves,
  hydrateDiagnosticPerformerPreviewReserves,
  loadCanonicalBillPerformerItems,
} from '../../../src/lib/diagnostic-performer-reserve';

const tenantId = 'tenant-1';

function createReserveDb(options: {
  items: Record<string, unknown>[];
  rules?: Record<string, unknown>[];
  allocations?: Record<string, unknown>[];
  persisted?: Record<string, unknown>[];
  commissionEligibility?: Record<string, unknown>[];
}) {
  return createMockDB({
    queryOverride: (sql) => {
      if (/FROM\s+invoice_items\s+ii/i.test(sql)) return { results: options.items };
      if (/FROM\s+lab_test_catalog/i.test(sql) && /is_commissionable/i.test(sql)) return { results: options.commissionEligibility ?? [] };
      if (/FROM\s+bill_discount_allocations/i.test(sql)) return { results: options.allocations ?? [] };
      if (/FROM\s+diagnostic_performer_payout_rules/i.test(sql)) return { results: options.rules ?? [] };
      if (/FROM\s+diagnostic_performer_reserves/i.test(sql)) return { results: options.persisted ?? [] };
      if (/INSERT INTO diagnostic_performer_reserves/i.test(sql)) return { success: true, meta: { changes: 1 } };
      return null;
    },
  });
}

function diagnosticItem(overrides: Record<string, unknown> = {}) {
  return {
    patient_id: 10,
    visit_id: 20,
    bill_discount: 0,
    invoice_item_id: 301,
    item_category: 'test',
    description: 'USG Whole Abdomen',
    quantity: 1,
    line_total: 1000,
    gross_service_amount: 1000,
    tax_amount: 0,
    reference_id: 501,
    billing_service_item_id: 501,
    diagnostic_kind: 'radiology',
    lab_test_id: null,
    radiology_imaging_item_id: 71,
    test_code: 'RAD-USG-WA',
    test_name: 'USG Whole Abdomen',
    ...overrides,
  };
}

function flatRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    billing_service_item_id: 501,
    diagnostic_kind: 'radiology',
    rate_type: 'flat',
    rate_value: 200,
    effective_from: '2026-07-01',
    effective_to: null,
    ...overrides,
  };
}

describe('diagnostic performer preview reserve hydration', () => {
  it('hydrates a flat performer reserve from the effective service-item rule', async () => {
    const mock = createReserveDb({
      items: [],
      rules: [flatRule()],
    });

    const [item] = await hydrateDiagnosticPerformerPreviewReserves(mock.db, {
      tenantId,
      billDate: '2026-07-25',
      items: [{
        itemCategory: 'test',
        lineTotal: 900,
        grossLineTotal: 1000,
        quantity: 1,
        referenceId: 501,
      }],
    });

    expect(item.performerReserveAmount).toBe(200);
  });

  it('hydrates a quantity-aware percentage reserve and preserves an explicit authoritative reserve', async () => {
    const mock = createReserveDb({
      items: [],
      rules: [flatRule({ rate_type: 'percent', rate_value: 1500 })],
    });

    const items = await hydrateDiagnosticPerformerPreviewReserves(mock.db, {
      tenantId,
      billDate: '2026-07-25',
      items: [
        {
          itemCategory: 'test',
          lineTotal: 1800,
          grossLineTotal: 2000,
          quantity: 2,
          referenceId: 501,
        },
        {
          itemCategory: 'test',
          lineTotal: 900,
          grossLineTotal: 1000,
          quantity: 1,
          referenceId: 501,
          performerReserveAmount: 123.45,
        },
      ],
    });

    expect(items[0].performerReserveAmount).toBe(270);
    expect(items[1].performerReserveAmount).toBe(123.45);
  });
});

describe('diagnostic performer reserve creation', () => {
  it('loads both the post-discount line total and pre-discount service gross', async () => {
    const mock = createReserveDb({
      items: [diagnosticItem({ line_total: 800, gross_service_amount: 1000, bill_discount: 200 })],
    });

    const items = await loadCanonicalBillPerformerItems(mock.db, { tenantId, billId: 1001 });

    expect(items[0]).toMatchObject({
      lineTotal: 800,
      grossServiceAmount: 1000,
    });
    expect(mock.queries[0].sql).toContain('ii.unit_price');
  });

  it('creates an immutable flat reserve with separate gross, discount, and net authority', async () => {
    const persisted = [{
      id: 701,
      invoice_item_id: 301,
      net_unit_service_amount: 900,
      reserved_amount: 200,
      status: 'reserved',
    }];
    const mock = createReserveDb({
      items: [diagnosticItem({ line_total: 900, tax_amount: 0, bill_discount: 100 })],
      rules: [flatRule()],
      persisted,
    });

    const result = await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-13',
    });

    expect(result.get(301)).toEqual({
      billItemId: 301,
      netServiceAmount: 900,
      performerReserveAmount: 200,
      commissionBaseAmount: 700,
      reserveIds: [701],
    });
    const insert = mock.queries.find((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql));
    expect(insert?.sql).toContain('ON CONFLICT(tenant_id, invoice_item_id, unit_sequence) DO NOTHING');
    expect(insert?.params).toEqual(expect.arrayContaining([
      tenantId, 91, 1001, 301, 10, 20, 501, 'radiology', 1, 1000, 100, 900, 'flat', 200, 200, 7,
    ]));
  });

  it('creates one reserve statement per invoice quantity unit', async () => {
    const mock = createReserveDb({
      items: [diagnosticItem({ quantity: 2, line_total: 2000 })],
      rules: [flatRule()],
      persisted: [
        { id: 711, invoice_item_id: 301, net_unit_service_amount: 1000, reserved_amount: 200, status: 'reserved' },
        { id: 712, invoice_item_id: 301, net_unit_service_amount: 1000, reserved_amount: 200, status: 'reserved' },
      ],
    });

    const result = await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-13',
    });

    const inserts = mock.queries.filter((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params).toContain(1);
    expect(inserts[1].params).toContain(2);
    expect(result.get(301)?.performerReserveAmount).toBe(400);
    expect(result.get(301)?.reserveIds).toEqual([711, 712]);
  });

  it('persists percentage rule snapshots in basis points', async () => {
    const mock = createReserveDb({
      items: [diagnosticItem({ line_total: 900, bill_discount: 100 })],
      rules: [flatRule({ rate_type: 'percent', rate_value: 1500 })],
      persisted: [{ id: 721, invoice_item_id: 301, net_unit_service_amount: 900, reserved_amount: 135, status: 'reserved' }],
    });

    const result = await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-13',
    });

    const insert = mock.queries.find((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql));
    expect(insert?.params).toEqual(expect.arrayContaining(['percent', 1500, 135]));
    expect(result.get(301)?.commissionBaseAmount).toBe(765);
  });

  it('derives audit discount from gross minus the already-net invoice line', async () => {
    const mock = createReserveDb({
      items: [
        diagnosticItem({ line_total: 950, bill_discount: 100 }),
        {
          patient_id: 10,
          visit_id: 20,
          bill_discount: 100,
          invoice_item_id: 302,
          item_category: 'consultation',
          description: 'Consultation',
          quantity: 1,
          line_total: 950,
          tax_amount: 0,
          reference_id: 81,
          billing_service_item_id: null,
          diagnostic_kind: null,
          lab_test_id: null,
          radiology_imaging_item_id: null,
          test_code: null,
          test_name: null,
        },
      ],
      rules: [flatRule()],
      persisted: [{ id: 731, invoice_item_id: 301, net_unit_service_amount: 950, reserved_amount: 200, status: 'reserved' }],
    });

    const result = await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-13',
    });

    const insert = mock.queries.find((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql));
    expect(insert?.params).toEqual(expect.arrayContaining([1000, 50, 950]));
    expect(result.get(301)?.commissionBaseAmount).toBe(750);
  });

  it('ignores legacy allocation rows while preserving gross-minus-net discount authority', async () => {
    const mock = createReserveDb({
      items: [diagnosticItem({ line_total: 900, bill_discount: 100 })],
      allocations: [{ bill_item_id: 301, allocated_amount: 60 }],
      rules: [flatRule()],
      persisted: [{ id: 741, invoice_item_id: 301, net_unit_service_amount: 900, reserved_amount: 200, status: 'reserved' }],
    });

    await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-13',
    });

    const insert = mock.queries.find((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql));
    expect(insert?.params).toEqual(expect.arrayContaining([1000, 100, 900]));
  });

  it('creates the full flat performer reserve when the invoice line is fully discounted', async () => {
    const mock = createReserveDb({
      items: [diagnosticItem({ line_total: 0, bill_discount: 700 })],
      rules: [flatRule()],
      persisted: [{ id: 751, invoice_item_id: 301, net_unit_service_amount: 0, reserved_amount: 200, status: 'reserved' }],
    });

    const result = await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-13',
    });

    const insert = mock.queries.find((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql));
    expect(insert?.params).toEqual(expect.arrayContaining([0, 0, 0, 'flat', 200, 200]));
    expect(result.get(301)).toEqual({
      billItemId: 301,
      netServiceAmount: 0,
      performerReserveAmount: 200,
      commissionBaseAmount: 0,
      reserveIds: [751],
    });
  });

  it('creates no reserve for a non-commissionable lab test even when a payout rule exists', async () => {
    const mock = createReserveDb({
      items: [diagnosticItem({
        description: 'Cross Matching',
        diagnostic_kind: 'lab',
        lab_test_id: 44,
        radiology_imaging_item_id: null,
        test_code: 'CROSS-MATCH',
        test_name: 'Cross Matching',
      })],
      commissionEligibility: [{ id: 44, is_commissionable: 0 }],
      rules: [flatRule({ diagnostic_kind: 'lab' })],
      persisted: [],
    });

    const result = await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-21',
    });

    expect(result.size).toBe(0);
    expect(mock.queries.some((query) => /FROM\s+diagnostic_performer_payout_rules/i.test(query.sql))).toBe(false);
    expect(mock.queries.some((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql))).toBe(false);
  });

  it('creates no reserve for a diagnostic item without an effective rule', async () => {
    const mock = createReserveDb({ items: [diagnosticItem()], rules: [], persisted: [] });

    const result = await createBillDiagnosticPerformerReserves(mock.db, {
      tenantId,
      userId: 7,
      billId: 1001,
      billDate: '2026-07-13',
    });

    expect(result.size).toBe(0);
    expect(mock.queries.some((query) => /INSERT INTO diagnostic_performer_reserves/i.test(query.sql))).toBe(false);
  });
});

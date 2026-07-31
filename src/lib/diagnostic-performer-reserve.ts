import { HTTPException } from 'hono/http-exception';
import { roundMoney } from './discount_allocation';
import {
  calculateDiagnosticLinePayoutSplit,
  type NormalizedPerformerRule,
  type PerformerPayoutRateType,
} from './diagnostic-performer-payout';
import { buildLegacyLiveInvoiceSourceLineId } from './canonical/live-invoice-line-identity';
import { executeLivePerformerReserveAccrual } from './canonical/live-performer-reserve';
import { loadLabTestCommissionEligibility } from './lab-test-commission-policy';
import { getTodayGMT6 } from './date-utils';
import { cancelPerformerReservesWithCanonicalAdjustment } from './canonical/compensation-accrual-route-integration';

export type CanonicalBillPerformerItem = {
  patientId: number | null;
  visitId: number | null;
  billDiscount: number;
  billItemId: number;
  itemCategory: string;
  description: string | null;
  quantity: number;
  lineTotal: number;
  grossServiceAmount: number;
  taxAmount: number;
  referenceId: number | null;
  billingServiceItemId: number | null;
  diagnosticKind: 'lab' | 'radiology' | null;
  labTestId: number | null;
  radiologyImagingItemId: number | null;
  testCode: string | null;
  testName: string | null;
};

export type BillItemPerformerReserveSummary = {
  billItemId: number;
  netServiceAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
  reserveIds: number[];
};

type CanonicalBillItemRow = {
  patient_id: number | null;
  visit_id: number | null;
  bill_discount: number | null;
  invoice_item_id: number;
  item_category: string;
  description: string | null;
  quantity: number;
  line_total: number;
  gross_service_amount: number;
  tax_amount: number | null;
  reference_id: number | null;
  billing_service_item_id: number | null;
  diagnostic_kind: 'lab' | 'radiology' | null;
  lab_test_id: number | null;
  radiology_imaging_item_id: number | null;
  test_code: string | null;
  test_name: string | null;
};

type PerformerRuleRow = {
  id: number;
  billing_service_item_id: number;
  diagnostic_kind: 'lab' | 'radiology';
  rate_type: PerformerPayoutRateType;
  rate_value: number;
  effective_from: string;
  effective_to: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
};

type PersistedReserveRow = {
  id: number;
  invoice_item_id: number;
  net_unit_service_amount: number;
  reserved_amount: number;
  status: string;
};

function toNullablePositiveInt(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toMoney(value: unknown): number {
  return Math.max(0, roundMoney(Number(value ?? 0)));
}

export async function loadCanonicalBillPerformerItems(
  db: D1Database,
  input: { tenantId: string; billId: number },
): Promise<CanonicalBillPerformerItem[]> {
  const { results } = await db.prepare(`
    WITH source_items AS (
      SELECT
        b.patient_id,
        b.visit_id,
        COALESCE(b.discount, 0) AS bill_discount,
        ii.id AS invoice_item_id,
        ii.item_category,
        ii.description,
        COALESCE(ii.quantity, 1) AS quantity,
        COALESCE(ii.line_total, 0) AS line_total,
        ROUND(COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1), 2) AS gross_service_amount,
        COALESCE(ii.tax_amount, 0) AS tax_amount,
        ii.reference_id,
        COALESCE(
          CASE WHEN lo.id IS NOT NULL THEN lt_order.billing_service_item_id END,
          CASE WHEN rr.id IS NOT NULL THEN ri_req.billing_service_item_id END,
          si_direct.id
        ) AS billing_service_item_id,
        CASE WHEN lo.id IS NOT NULL THEN lt_order.id ELSE lt_direct.id END AS lab_test_id,
        CASE WHEN rr.id IS NOT NULL THEN ri_req.id ELSE ri_direct.id END AS radiology_imaging_item_id,
        COALESCE(
          CASE WHEN lo.id IS NOT NULL THEN lt_order.code END,
          CASE WHEN rr.id IS NOT NULL THEN ri_req.procedure_code END,
          lt_direct.code,
          ri_direct.procedure_code,
          si_direct.item_code
        ) AS test_code,
        COALESCE(
          CASE WHEN lo.id IS NOT NULL THEN lt_order.name END,
          CASE WHEN rr.id IS NOT NULL THEN ri_req.name END,
          lt_direct.name,
          ri_direct.name,
          si_direct.item_name,
          ii.description
        ) AS test_name
      FROM invoice_items ii
      JOIN bills b
        ON b.id = ii.bill_id
       AND b.tenant_id = ii.tenant_id
      LEFT JOIN lab_order_items loi
        ON loi.id = ii.reference_id
       AND loi.tenant_id = ii.tenant_id
      LEFT JOIN lab_orders lo
        ON lo.id = loi.lab_order_id
       AND lo.tenant_id = ii.tenant_id
       AND lo.bill_id = b.id
      LEFT JOIN lab_test_catalog lt_order
        ON lt_order.id = loi.lab_test_id
       AND lt_order.tenant_id = ii.tenant_id
       AND lo.id IS NOT NULL
      LEFT JOIN radiology_requisitions rr
        ON rr.id = ii.reference_id
       AND rr.tenant_id = ii.tenant_id
       AND rr.bill_id = b.id
      LEFT JOIN radiology_imaging_items ri_req
        ON ri_req.id = rr.imaging_item_id
       AND ri_req.tenant_id = ii.tenant_id
      LEFT JOIN billing_service_items si_direct
        ON si_direct.id = ii.reference_id
       AND si_direct.tenant_id = ii.tenant_id
       AND lo.id IS NULL
       AND rr.id IS NULL
      LEFT JOIN lab_test_catalog lt_direct
        ON lt_direct.billing_service_item_id = si_direct.id
       AND lt_direct.tenant_id = ii.tenant_id
       AND COALESCE(lt_direct.is_active, 1) = 1
      LEFT JOIN radiology_imaging_items ri_direct
        ON ri_direct.billing_service_item_id = si_direct.id
       AND ri_direct.tenant_id = ii.tenant_id
       AND COALESCE(ri_direct.is_active, 1) = 1
      WHERE ii.tenant_id = ?
        AND ii.bill_id = ?
        AND COALESCE(ii.status, 'active') = 'active'
    )
    SELECT
      s.*,
      CASE sd.department_code
        WHEN 'LAB' THEN 'lab'
        WHEN 'RAD' THEN 'radiology'
      END AS diagnostic_kind
    FROM source_items s
    LEFT JOIN billing_service_items bsi
      ON bsi.id = s.billing_service_item_id
     AND bsi.tenant_id = ?
     AND COALESCE(bsi.is_active, 1) = 1
    LEFT JOIN billing_service_departments sd
      ON sd.id = bsi.service_department_id
     AND sd.tenant_id = bsi.tenant_id
     AND COALESCE(sd.is_active, 1) = 1
    ORDER BY s.invoice_item_id ASC
  `).bind(input.tenantId, input.billId, input.tenantId).all<CanonicalBillItemRow>();

  return (results ?? []).map((row) => ({
    patientId: toNullablePositiveInt(row.patient_id),
    visitId: toNullablePositiveInt(row.visit_id),
    billDiscount: toMoney(row.bill_discount),
    billItemId: Number(row.invoice_item_id),
    itemCategory: String(row.item_category ?? ''),
    description: row.description ?? null,
    quantity: Number(row.quantity ?? 1),
    lineTotal: toMoney(row.line_total),
    grossServiceAmount: toMoney(row.gross_service_amount),
    taxAmount: toMoney(row.tax_amount),
    referenceId: toNullablePositiveInt(row.reference_id),
    billingServiceItemId: toNullablePositiveInt(row.billing_service_item_id),
    diagnosticKind: row.diagnostic_kind === 'lab' || row.diagnostic_kind === 'radiology'
      ? row.diagnostic_kind
      : null,
    labTestId: toNullablePositiveInt(row.lab_test_id),
    radiologyImagingItemId: toNullablePositiveInt(row.radiology_imaging_item_id),
    testCode: row.test_code?.trim() || null,
    testName: row.test_name?.trim() || row.description?.trim() || null,
  }));
}

async function loadEffectiveRules(
  db: D1Database,
  input: { tenantId: string; billDate: string; serviceItemIds: number[] },
): Promise<Map<number, {
  id: number;
  diagnosticKind: 'lab' | 'radiology';
  rule: NormalizedPerformerRule;
  source: PerformerRuleRow;
}>> {
  const ids = Array.from(new Set(input.serviceItemIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(`
    SELECT id, billing_service_item_id, diagnostic_kind, rate_type, rate_value,
           effective_from, effective_to, is_active, created_at, updated_at
    FROM diagnostic_performer_payout_rules
    WHERE tenant_id = ?
      AND billing_service_item_id IN (${placeholders})
      AND is_active = 1
      AND date(effective_from) <= date(?)
      AND (effective_to IS NULL OR date(effective_to) >= date(?))
    ORDER BY billing_service_item_id ASC, effective_from DESC, id DESC
  `).bind(input.tenantId, ...ids, input.billDate, input.billDate).all<PerformerRuleRow>();

  const rules = new Map<number, {
    id: number;
    diagnosticKind: 'lab' | 'radiology';
    rule: NormalizedPerformerRule;
    source: PerformerRuleRow;
  }>();
  for (const row of results ?? []) {
    const serviceItemId = Number(row.billing_service_item_id);
    if (rules.has(serviceItemId)) continue;
    if (row.diagnostic_kind !== 'lab' && row.diagnostic_kind !== 'radiology') continue;
    if (row.rate_type !== 'flat' && row.rate_type !== 'percent') continue;
    rules.set(serviceItemId, {
      id: Number(row.id),
      diagnosticKind: row.diagnostic_kind,
      rule: {
        rateType: row.rate_type,
        rateValue: toMoney(row.rate_value),
      },
      source: row,
    });
  }
  return rules;
}

export type DiagnosticPerformerPreviewItem = {
  itemCategory: string;
  description?: string | null;
  lineTotal: number;
  grossLineTotal?: number | null;
  performerReserveAmount?: number | null;
  referenceId?: number | null;
  labTestId?: number | null;
  quantity?: number | null;
};

function isDiagnosticPreviewCategory(itemCategory: string): boolean {
  return /^(test|lab|laboratory|diagnostic|radiology|imaging|usg|xray|x-ray|pathology)$/i.test(
    String(itemCategory ?? '').trim(),
  );
}

export async function hydrateDiagnosticPerformerPreviewReserves<T extends DiagnosticPerformerPreviewItem>(
  db: D1Database,
  input: { tenantId: string; billDate: string; items: T[] },
): Promise<Array<T & { performerReserveAmount?: number | null }>> {
  const rules = await loadEffectiveRules(db, {
    tenantId: input.tenantId,
    billDate: input.billDate,
    serviceItemIds: input.items.flatMap((item) => {
      const serviceItemId = toNullablePositiveInt(item.referenceId);
      return serviceItemId && isDiagnosticPreviewCategory(item.itemCategory) ? [serviceItemId] : [];
    }),
  });

  return input.items.map((item) => {
    if (item.performerReserveAmount != null) {
      return { ...item, performerReserveAmount: toMoney(item.performerReserveAmount) };
    }
    const serviceItemId = toNullablePositiveInt(item.referenceId);
    const resolvedRule = serviceItemId ? rules.get(serviceItemId) : null;
    if (!resolvedRule || !isDiagnosticPreviewCategory(item.itemCategory)) return item;

    const quantity = Number(item.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity <= 0) return item;
    const lineTotal = toMoney(item.lineTotal);
    const grossLineTotal = Math.max(lineTotal, toMoney(item.grossLineTotal ?? lineTotal));
    const split = calculateDiagnosticLinePayoutSplit({
      serviceAmountExcludingTax: grossLineTotal,
      discountAmount: roundMoney(Math.max(0, grossLineTotal - lineTotal)),
      quantity,
      rule: resolvedRule.rule,
    });
    return { ...item, performerReserveAmount: split.performerReserveAmount };
  });
}

export async function createBillDiagnosticPerformerReserves(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string | number;
    billId: number;
    invoiceNo?: string;
    billDate: string;
    accruedAtUtc?: string;
    canonicalItems?: CanonicalBillPerformerItem[];
  },
): Promise<Map<number, BillItemPerformerReserveSummary>> {
  const items = input.canonicalItems ?? await loadCanonicalBillPerformerItems(db, input);
  if (items.length === 0) return new Map();

  const commissionEligibility = await loadLabTestCommissionEligibility(
    db,
    input.tenantId,
    items.map((item) => item.labTestId),
  );
  const commissionableItems = items.filter((item) => (
    !item.labTestId || (commissionEligibility.get(item.labTestId) ?? true)
  ));
  if (commissionableItems.length === 0) return new Map();

  // invoice_items.line_total is post-discount and includes tax. Canonical reserve
  // authority keeps the original service gross and the allocated discount separate.
  const netServiceAmounts = commissionableItems.map((item) => Math.max(0, roundMoney(item.lineTotal - item.taxAmount)));
  const grossServiceAmounts = commissionableItems.map((item) => Math.max(0, roundMoney(item.grossServiceAmount)));
  const discountAmounts = commissionableItems.map((item, index) => roundMoney(Math.max(
    0,
    grossServiceAmounts[index] - netServiceAmounts[index],
  )));

  const rules = await loadEffectiveRules(db, {
    tenantId: input.tenantId,
    billDate: input.billDate,
    serviceItemIds: commissionableItems.flatMap((item) => (
      item.diagnosticKind && item.billingServiceItemId ? [item.billingServiceItemId] : []
    )),
  });
  if (rules.size === 0) return new Map();

  const legacyStatements: D1PreparedStatement[] = [];
  for (const [index, item] of commissionableItems.entries()) {
    if (!item.billingServiceItemId || !item.diagnosticKind || !item.testName) continue;
    const resolvedRule = rules.get(item.billingServiceItemId);
    if (!resolvedRule || resolvedRule.diagnosticKind !== item.diagnosticKind) continue;
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) continue;

    const lineGrossAmount = grossServiceAmounts[index];
    const split = calculateDiagnosticLinePayoutSplit({
      serviceAmountExcludingTax: lineGrossAmount,
      discountAmount: discountAmounts[index],
      quantity: item.quantity,
      rule: resolvedRule.rule,
    });
    const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
      lineNumber: index + 1,
      itemCategory: item.itemCategory,
      referenceId: item.referenceId ?? item.billingServiceItemId,
    });

    for (const unit of split.units) {
      const sourceKey = `bill:${input.billId}:line:${sourceLineId}:rule:${resolvedRule.id}:unit:${unit.unitSequence}:performer-reserve`;
      const legacyStatement = db.prepare(`
        INSERT INTO diagnostic_performer_reserves (
          tenant_id, rule_id, bill_id, invoice_item_id, patient_id, visit_id,
          billing_service_item_id, diagnostic_kind, lab_test_id, radiology_imaging_item_id,
          test_code, test_name, unit_sequence, unit_service_amount, unit_discount_amount,
          net_unit_service_amount, rule_rate_type, rule_rate_value, reserved_amount,
          canonical_source_key, status, created_by, reserved_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'reserved', ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
        ON CONFLICT(tenant_id, invoice_item_id, unit_sequence) DO NOTHING
      `).bind(
        input.tenantId,
        resolvedRule.id,
        input.billId,
        item.billItemId,
        item.patientId,
        item.visitId,
        item.billingServiceItemId,
        item.diagnosticKind,
        item.labTestId,
        item.radiologyImagingItemId,
        item.testCode,
        item.testName,
        unit.unitSequence,
        unit.unitServiceAmount,
        unit.unitDiscountAmount,
        unit.netUnitServiceAmount,
        resolvedRule.rule.rateType,
        resolvedRule.rule.rateValue,
        unit.reservedAmount,
        sourceKey,
        Number(input.userId),
      );

      if (input.invoiceNo && input.accruedAtUtc) {
        await executeLivePerformerReserveAccrual(db, {
          tenantId: input.tenantId,
          legacyStatement,
          legacyReserveSourceKey: sourceKey,
          billId: input.billId,
          billItemId: item.billItemId,
          invoiceNo: input.invoiceNo,
          invoiceSourceLineId: sourceLineId,
          unitSequence: unit.unitSequence,
          rule: {
            id: resolvedRule.id,
            billingServiceItemId: item.billingServiceItemId,
            diagnosticKind: item.diagnosticKind,
            rateType: resolvedRule.rule.rateType,
            rateValue: resolvedRule.rule.rateValue,
            effectiveFrom: resolvedRule.source.effective_from,
            effectiveTo: resolvedRule.source.effective_to,
            isActive: Number(resolvedRule.source.is_active ?? 1) === 1,
            createdAt: resolvedRule.source.created_at ?? null,
            updatedAt: resolvedRule.source.updated_at ?? null,
          },
          lineGrossAmount,
          lineNetAmount: netServiceAmounts[index],
          grossAmount: unit.unitServiceAmount,
          discountAmount: unit.unitDiscountAmount,
          netAmount: unit.netUnitServiceAmount,
          reservedAmount: unit.reservedAmount,
          accruedAtUtc: input.accruedAtUtc,
          businessDate: input.billDate,
          reportingContext: {
            sourceKind: 'performer_reserve',
            incentiveType: 'performer',
            legacyInvoiceItemId: item.billItemId,
            detailName: item.testName,
            sourceReference: input.invoiceNo,
          },
        });
      } else {
        legacyStatements.push(legacyStatement);
      }
    }
  }

  if (legacyStatements.length > 0) await db.batch(legacyStatements);

  const { results: persistedRows } = await db.prepare(`
    SELECT id, invoice_item_id, net_unit_service_amount, reserved_amount, status
    FROM diagnostic_performer_reserves
    WHERE tenant_id = ?
      AND bill_id = ?
      AND status IN ('reserved', 'paid', 'reversed')
    ORDER BY invoice_item_id ASC, unit_sequence ASC, id ASC
  `).bind(input.tenantId, input.billId).all<PersistedReserveRow>();

  const summaries = new Map<number, BillItemPerformerReserveSummary>();
  for (const row of persistedRows ?? []) {
    const billItemId = Number(row.invoice_item_id);
    const current = summaries.get(billItemId) ?? {
      billItemId,
      netServiceAmount: 0,
      performerReserveAmount: 0,
      commissionBaseAmount: 0,
      reserveIds: [],
    };
    current.netServiceAmount = roundMoney(current.netServiceAmount + toMoney(row.net_unit_service_amount));
    current.performerReserveAmount = roundMoney(current.performerReserveAmount + toMoney(row.reserved_amount));
    current.reserveIds.push(Number(row.id));
    summaries.set(billItemId, current);
  }

  for (const summary of summaries.values()) {
    summary.commissionBaseAmount = roundMoney(Math.max(0, summary.netServiceAmount - summary.performerReserveAmount));
  }
  return summaries;
}

const PAID_PERFORMER_RESERVE_MESSAGE = 'This bill includes a paid performer payout. Reverse the doctor payout before cancelling or refunding the linked test.';

function normalizePositiveIds(ids?: number[]): number[] {
  return Array.from(new Set((ids ?? []).filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
}

export async function assertNoPaidPerformerReserves(
  db: D1Database,
  tenantId: string,
  input: { billId: number; invoiceItemIds?: number[] },
): Promise<void> {
  const invoiceItemIds = normalizePositiveIds(input.invoiceItemIds);
  let sql = `
    SELECT id, settlement_id
    FROM diagnostic_performer_reserves
    WHERE tenant_id = ?
      AND bill_id = ?
      AND status = 'paid'
  `;
  const params: Array<string | number> = [tenantId, input.billId];
  if (invoiceItemIds.length > 0) {
    sql += ` AND invoice_item_id IN (${invoiceItemIds.map(() => '?').join(',')})`;
    params.push(...invoiceItemIds);
  }
  sql += ' LIMIT 1';

  const paid = await db.prepare(sql).bind(...params).first<{ id: number; settlement_id: number | null }>();
  if (paid?.id) throw new HTTPException(409, { message: PAID_PERFORMER_RESERVE_MESSAGE });
}

export async function cancelUnpaidPerformerReserves(
  db: D1Database,
  tenantId: string,
  input: {
    billId: number;
    invoiceItemIds?: number[];
    reason: string;
    userId: string | number;
  },
): Promise<number> {
  return cancelPerformerReservesWithCanonicalAdjustment(
    db as D1Database & import('./canonical/command-batch').CanonicalBatchDatabase,
    {
      tenantId,
      billId: input.billId,
      invoiceItemIds: normalizePositiveIds(input.invoiceItemIds),
      reason: input.reason,
      userId: input.userId,
      cancelledAtUtc: new Date().toISOString(),
      businessDate: getTodayGMT6(),
    },
  );
}

export async function cancelUnpaidPerformerReserveQuantities(
  db: D1Database,
  tenantId: string,
  input: {
    billId: number;
    items: Array<{ invoiceItemId: number; quantity: number }>;
    reason: string;
    userId: string | number;
  },
): Promise<number> {
  const quantities = input.items.flatMap((item) => {
    const invoiceItemId = Number(item.invoiceItemId);
    const quantity = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
    return Number.isInteger(invoiceItemId) && invoiceItemId > 0 && quantity > 0
      ? [{ invoiceItemId, quantity }]
      : [];
  });
  if (quantities.length === 0) return 0;
  return cancelPerformerReservesWithCanonicalAdjustment(
    db as D1Database & import('./canonical/command-batch').CanonicalBatchDatabase,
    {
      tenantId,
      billId: input.billId,
      quantities,
      reason: input.reason,
      userId: input.userId,
      cancelledAtUtc: new Date().toISOString(),
      businessDate: getTodayGMT6(),
    },
  );
}

import type {
  ExceptionDetector,
  ExceptionDetectorContext,
  ExceptionObservation,
} from './types';

export const EXCEPTION_RULES = {
  staleHandover: 'cash.stale_handover',
  highDiscount: 'billing.high_discount',
  missingDiscountReference: 'billing.missing_discount_reference',
  billCancellation: 'billing.same_day_cancellation',
  lowStock: 'inventory.low_stock',
} as const;

interface StaleHandoverRow {
  id: number | string;
  handover_amount?: number | string | null;
  handover_by_name?: string | null;
  created_at?: string | null;
}

interface DiscountBillRow {
  id: number | string;
  invoice_no?: string | null;
  subtotal?: number | string | null;
  total?: number | string | null;
  discount?: number | string | null;
  discount_pct?: number | string | null;
  discount_by_name?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
}

interface CancelledBillRow {
  id: number | string;
  invoice_no?: string | null;
  total?: number | string | null;
  discount?: number | string | null;
  cancel_reason?: string | null;
  cancelled_by_name?: string | null;
  cancelled_at?: string | null;
}

interface LowStockRow {
  id: number | string;
  name?: string | null;
  quantity?: number | string | null;
}

function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sourceId(value: number | string): string {
  return String(value);
}

function formatAmount(value: unknown): string {
  return numberValue(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function dedupeObservations(observations: ExceptionObservation[]): ExceptionObservation[] {
  const unique = new Map<string, ExceptionObservation>();
  for (const observation of observations) {
    unique.set(`${observation.ruleKey}:${observation.fingerprint}`, observation);
  }
  return [...unique.values()];
}

export const detectStaleHandovers: ExceptionDetector = async ({ db, tenantId, now }) => {
  const result = await db.prepare(`
    /* exception:stale-handover */
    SELECT
      h.id,
      h.handover_amount,
      h.created_at,
      u.name AS handover_by_name
    FROM billing_handovers h
    LEFT JOIN users u
      ON u.id = h.handover_by
     AND u.tenant_id = h.tenant_id
    WHERE h.tenant_id = ?
      AND h.status = 'pending'
      AND datetime(h.created_at) < datetime(?, '-24 hours')
    ORDER BY h.created_at ASC, h.id ASC
  `).bind(tenantId, now).all<StaleHandoverRow>();

  return dedupeObservations((result.results ?? []).map((row) => {
    const id = sourceId(row.id);
    const amount = numberValue(row.handover_amount);
    const operator = String(row.handover_by_name ?? '').trim() || 'Unknown operator';
    return {
      ruleKey: EXCEPTION_RULES.staleHandover,
      fingerprint: `handover:${id}`,
      sourceType: 'cash_handover',
      sourceId: id,
      module: 'cash',
      severity: 'warning',
      title: 'Stale cash handover',
      description: `Pending handover from ${operator} for ৳${formatAmount(amount)} is older than 24 hours.`,
      sourceHref: `/cash/handover/${encodeURIComponent(id)}`,
      metadata: {
        amount,
        operator,
        sourceTimestamp: row.created_at ?? null,
      },
      autoResolvable: true,
      allowRecurrence: true,
    } satisfies ExceptionObservation;
  }));
};

export const detectHighDiscountBills: ExceptionDetector = async ({ db, tenantId, now }) => {
  const result = await db.prepare(`
    /* exception:high-discount */
    WITH bill_subtotals AS (
      SELECT
        b.id,
        COALESCE(
          NULLIF(SUM(COALESCE(ii.quantity, 1) * COALESCE(ii.unit_price, 0)), 0),
          MAX(COALESCE(b.total, 0) + COALESCE(b.discount, 0) - COALESCE(b.tax_total, 0)),
          MAX(COALESCE(b.total, 0) + COALESCE(b.discount, 0)),
          0
        ) AS subtotal
      FROM bills b
      LEFT JOIN invoice_items ii
        ON ii.bill_id = b.id
       AND ii.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND date(b.created_at) = date(?)
      GROUP BY b.id
    )
    SELECT
      b.id,
      b.invoice_no,
      b.total,
      bs.subtotal,
      b.discount,
      CASE
        WHEN bs.subtotal > 0 THEN ROUND((b.discount * 100.0 / bs.subtotal), 1)
        ELSE 0
      END AS discount_pct,
      NULLIF(TRIM(COALESCE(b.discount_by_name, '')), '') AS discount_by_name,
      u.name AS created_by_name,
      b.created_at
    FROM bills b
    JOIN bill_subtotals bs ON bs.id = b.id
    LEFT JOIN users u
      ON u.id = b.created_by
     AND u.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
      AND date(b.created_at) = date(?)
      AND b.discount > 0
      AND bs.subtotal > 0
      AND (b.discount * 100.0 / bs.subtotal) > 20
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    ORDER BY discount_pct DESC, b.id ASC
  `).bind(tenantId, now, tenantId, now).all<DiscountBillRow>();

  return dedupeObservations((result.results ?? []).map((row) => {
    const id = sourceId(row.id);
    const discount = numberValue(row.discount);
    const subtotal = numberValue(row.subtotal) || numberValue(row.total) + discount;
    const percentage = numberValue(row.discount_pct)
      || (subtotal > 0 ? Number(((discount * 100) / subtotal).toFixed(1)) : 0);
    const invoiceNo = String(row.invoice_no ?? '').trim() || `Bill ${id}`;
    return {
      ruleKey: EXCEPTION_RULES.highDiscount,
      fingerprint: `bill:${id}:discount`,
      sourceType: 'bill',
      sourceId: id,
      module: 'billing',
      severity: 'warning',
      title: 'High discount bill',
      description: `${invoiceNo} has a ${percentage}% discount (৳${formatAmount(discount)}).`,
      sourceHref: `/cash/discounts?billId=${encodeURIComponent(id)}`,
      metadata: {
        invoiceNo,
        discount,
        subtotal,
        percentage,
        discountBy: row.discount_by_name ?? null,
        createdBy: row.created_by_name ?? null,
        sourceTimestamp: row.created_at ?? null,
      },
      autoResolvable: false,
      allowRecurrence: false,
    } satisfies ExceptionObservation;
  }));
};

export const detectMissingDiscountReferences: ExceptionDetector = async ({ db, tenantId, now }) => {
  const result = await db.prepare(`
    /* exception:missing-discount-reference */
    SELECT
      b.id,
      b.invoice_no,
      b.total,
      b.discount,
      u.name AS created_by_name,
      b.created_at
    FROM bills b
    LEFT JOIN users u
      ON u.id = b.created_by
     AND u.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
      AND date(b.created_at) = date(?)
      AND COALESCE(b.discount, 0) > 0
      AND NULLIF(TRIM(COALESCE(b.discount_by_name, '')), '') IS NULL
      AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    ORDER BY b.created_at ASC, b.id ASC
  `).bind(tenantId, now).all<DiscountBillRow>();

  return dedupeObservations((result.results ?? []).map((row) => {
    const id = sourceId(row.id);
    const invoiceNo = String(row.invoice_no ?? '').trim() || `Bill ${id}`;
    const discount = numberValue(row.discount);
    return {
      ruleKey: EXCEPTION_RULES.missingDiscountReference,
      fingerprint: `bill:${id}:discount-reference`,
      sourceType: 'bill',
      sourceId: id,
      module: 'billing',
      severity: 'critical',
      title: 'Missing discount reference',
      description: `${invoiceNo} has a ৳${formatAmount(discount)} discount without a recorded reference.`,
      sourceHref: `/cash/discounts?billId=${encodeURIComponent(id)}`,
      metadata: {
        invoiceNo,
        discount,
        total: numberValue(row.total),
        createdBy: row.created_by_name ?? null,
        sourceTimestamp: row.created_at ?? null,
      },
      autoResolvable: false,
      allowRecurrence: false,
    } satisfies ExceptionObservation;
  }));
};

export const detectSameDayBillCancellations: ExceptionDetector = async ({ db, tenantId, now }) => {
  const result = await db.prepare(`
    /* exception:same-day-cancellation */
    SELECT
      b.id,
      b.invoice_no,
      b.total,
      b.discount,
      b.cancel_reason,
      b.cancelled_at,
      u.name AS cancelled_by_name
    FROM bills b
    LEFT JOIN users u
      ON u.id = b.cancelled_by
     AND u.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
      AND date(b.cancelled_at) = date(?)
    ORDER BY b.cancelled_at DESC, b.id ASC
  `).bind(tenantId, now).all<CancelledBillRow>();

  return dedupeObservations((result.results ?? []).map((row) => {
    const id = sourceId(row.id);
    const invoiceNo = String(row.invoice_no ?? '').trim() || `Bill ${id}`;
    const total = numberValue(row.total);
    return {
      ruleKey: EXCEPTION_RULES.billCancellation,
      fingerprint: `bill:${id}:cancel`,
      sourceType: 'bill',
      sourceId: id,
      module: 'billing',
      severity: 'critical',
      title: 'Same-day bill cancellation',
      description: `${invoiceNo} was cancelled today${row.cancel_reason ? `: ${row.cancel_reason}` : '.'}`,
      sourceHref: `/billing-cancellation?billId=${encodeURIComponent(id)}`,
      metadata: {
        invoiceNo,
        total,
        discount: numberValue(row.discount),
        reason: row.cancel_reason ?? null,
        cancelledBy: row.cancelled_by_name ?? null,
        sourceTimestamp: row.cancelled_at ?? null,
      },
      autoResolvable: false,
      allowRecurrence: false,
    } satisfies ExceptionObservation;
  }));
};

export const detectLowStockMedicines: ExceptionDetector = async ({ db, tenantId }) => {
  const result = await db.prepare(`
    /* exception:low-stock */
    SELECT id, name, quantity
    FROM medicines
    WHERE tenant_id = ?
      AND quantity < 10
      AND quantity >= 0
    ORDER BY quantity ASC, id ASC
  `).bind(tenantId).all<LowStockRow>();

  return dedupeObservations((result.results ?? []).map((row) => {
    const id = sourceId(row.id);
    const name = String(row.name ?? '').trim() || `Medicine ${id}`;
    const quantity = numberValue(row.quantity);
    return {
      ruleKey: EXCEPTION_RULES.lowStock,
      fingerprint: `medicine:${id}:low-stock`,
      sourceType: 'medicine',
      sourceId: id,
      module: 'inventory',
      severity: 'info',
      title: 'Low medicine stock',
      description: `${name} has ${quantity} unit${quantity === 1 ? '' : 's'} remaining.`,
      sourceHref: `/pharmacy/items?medicineId=${encodeURIComponent(id)}`,
      metadata: {
        name,
        quantity,
      },
      autoResolvable: true,
      allowRecurrence: true,
    } satisfies ExceptionObservation;
  }));
};

export const DEFAULT_EXCEPTION_DETECTORS: readonly ExceptionDetector[] = [
  detectStaleHandovers,
  detectHighDiscountBills,
  detectMissingDiscountReferences,
  detectSameDayBillCancellations,
  detectLowStockMedicines,
];

export async function detectExceptionObservations(
  context: ExceptionDetectorContext,
  detectors: readonly ExceptionDetector[] = DEFAULT_EXCEPTION_DETECTORS,
): Promise<ExceptionObservation[]> {
  const batches = await Promise.all(detectors.map((detector) => detector(context)));
  return dedupeObservations(batches.flat());
}

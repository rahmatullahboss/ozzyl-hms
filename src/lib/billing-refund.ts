export type RefundSelectionInput = {
  invoiceItemId: number;
  returnQuantity: number;
};

export type RefundableInvoiceItem = {
  invoiceItemId: number;
  description: string;
  itemCategory: string;
  quantity: number;
  approvedReturnedQuantity: number;
  pendingReservedQuantity: number;
  availableQuantity: number;
  refundableUnitAmount: number;
  clinicalStatus: string | null;
  eligible: boolean;
  blockReason: string | null;
  referenceId?: number | null;
  unitPrice?: number;
  lineTotal?: number;
};

export type RefundCalculation = {
  items: Array<RefundableInvoiceItem & {
    returnQuantity: number;
    refundAmount: number;
  }>;
  totalRefund: number;
};

export type RefundAllocationSource = 'auto' | 'requester_adjusted';

export type RefundAllocationItem = {
  invoiceItemId: number;
  description: string;
  itemCategory: string;
  lineAmount: number;
  approvedCreditAmount: number;
  pendingAllocatedAmount: number;
  refundableBalance: number;
  referenceId: number | null;
  lineIndex: number;
};

export type RefundAllocationInput = {
  invoiceItemId: number;
  allocatedRefundAmount: number;
  allocationSource?: RefundAllocationSource;
};

export type RefundAllocatedItem = RefundAllocationItem & {
  allocatedRefundAmount: number;
  allocationSource: RefundAllocationSource;
};

export type RefundAllocationResult = {
  items: RefundAllocatedItem[];
  totalRefund: number;
};

export function roundRefundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function refundMinor(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('Refund amount must be a finite number');
  return Math.round((amount + Number.EPSILON) * 100);
}

function assertRequestedRefundAmount(requestedAmount: number): number {
  const requestedMinor = refundMinor(requestedAmount);
  if (requestedMinor <= 0) throw new Error('Refund amount must be greater than zero');
  return requestedMinor;
}

function eligibleAllocationItems(items: RefundAllocationItem[]): RefundAllocationItem[] {
  return items.filter((item) => Number.isInteger(item.invoiceItemId)
    && item.invoiceItemId > 0
    && refundMinor(item.refundableBalance) > 0);
}

export function calculateProportionalRefundAllocation(
  items: RefundAllocationItem[],
  requestedAmount: number,
): RefundAllocatedItem[] {
  const requestedMinor = assertRequestedRefundAmount(requestedAmount);
  const eligible = eligibleAllocationItems(items);
  if (eligible.length === 0) throw new Error('No refundable item balance remains');
  const totalBalanceMinor = eligible.reduce((sum, item) => sum + refundMinor(item.refundableBalance), 0);
  if (requestedMinor > totalBalanceMinor) throw new Error('Refund amount exceeds the refundable bill balance');

  const allocatedMinor = eligible.map((item) => Math.round(
    requestedMinor * refundMinor(item.refundableBalance) / totalBalanceMinor,
  ));
  let difference = requestedMinor - allocatedMinor.reduce((sum, value) => sum + value, 0);
  const remainderOrder = eligible
    .map((item, index) => ({ item, index }))
    .sort((a, b) => refundMinor(b.item.refundableBalance) - refundMinor(a.item.refundableBalance)
      || a.item.invoiceItemId - b.item.invoiceItemId);

  let cursor = 0;
  while (difference !== 0) {
    const target = remainderOrder[cursor % remainderOrder.length];
    const direction = difference > 0 ? 1 : -1;
    if (direction > 0 || allocatedMinor[target.index] > 0) {
      allocatedMinor[target.index] += direction;
      difference -= direction;
    }
    cursor += 1;
  }

  const byId = new Map(eligible.map((item, index) => [item.invoiceItemId, allocatedMinor[index]]));
  return items.map((item) => ({
    ...item,
    allocatedRefundAmount: roundRefundMoney((byId.get(item.invoiceItemId) ?? 0) / 100),
    allocationSource: 'auto' as const,
  }));
}

export function validateRefundAllocation(
  items: RefundAllocationItem[],
  requestedAmount: number,
  supplied: RefundAllocationInput[],
): RefundAllocationResult {
  const requestedMinor = assertRequestedRefundAmount(requestedAmount);
  if (!Array.isArray(supplied) || supplied.length === 0) {
    throw new Error('At least one refund allocation item is required');
  }

  const itemMap = new Map(items.map((item) => [item.invoiceItemId, item]));
  const seen = new Set<number>();
  const normalized: RefundAllocatedItem[] = [];
  let totalMinor = 0;

  for (const allocation of supplied) {
    const invoiceItemId = Number(allocation.invoiceItemId);
    if (!Number.isInteger(invoiceItemId) || invoiceItemId <= 0) {
      throw new Error('Refund allocation contains an invalid invoice item');
    }
    if (seen.has(invoiceItemId)) throw new Error(`Duplicate refund allocation item ${invoiceItemId}`);
    seen.add(invoiceItemId);

    const item = itemMap.get(invoiceItemId);
    if (!item) throw new Error(`Invoice item ${invoiceItemId} is not available for refund allocation`);
    const allocatedMinor = refundMinor(allocation.allocatedRefundAmount);
    if (allocatedMinor < 0) throw new Error(`Refund allocation for ${item.description} cannot be negative`);
    if (allocatedMinor > refundMinor(item.refundableBalance)) {
      throw new Error(`Refund allocation for ${item.description} exceeds its refundable balance`);
    }
    totalMinor += allocatedMinor;
    normalized.push({
      ...item,
      allocatedRefundAmount: roundRefundMoney(allocatedMinor / 100),
      allocationSource: 'requester_adjusted',
    });
  }

  if (totalMinor !== requestedMinor) {
    throw new Error('Refund allocation total must equal the requested refund amount');
  }
  if (!normalized.some((item) => item.allocatedRefundAmount > 0)) {
    throw new Error('At least one refund allocation must be greater than zero');
  }

  return { items: normalized, totalRefund: roundRefundMoney(totalMinor / 100) };
}

export type RefundFinancialImpact = {
  newTotal: number;
  newPaid: number;
  newDue: number;
  cashRefund: number;
  receivableReduction: number;
};

export function calculateRefundFinancialImpact(input: {
  originalTotal: number;
  originalPaid: number;
  totalCredit: number;
}): RefundFinancialImpact {
  const originalTotal = roundRefundMoney(Math.max(0, Number(input.originalTotal ?? 0)));
  const originalPaid = roundRefundMoney(Math.min(originalTotal, Math.max(0, Number(input.originalPaid ?? 0))));
  const totalCredit = roundRefundMoney(Math.max(0, Number(input.totalCredit ?? 0)));
  if (totalCredit > originalTotal) throw new Error('Refund credit exceeds the bill total');

  const newTotal = roundRefundMoney(Math.max(0, originalTotal - totalCredit));
  const newPaid = roundRefundMoney(Math.min(originalPaid, newTotal));
  const cashRefund = roundRefundMoney(Math.max(0, originalPaid - newPaid));
  const receivableReduction = roundRefundMoney(Math.max(0, totalCredit - cashRefund));
  const newDue = roundRefundMoney(Math.max(0, newTotal - newPaid));

  return { newTotal, newPaid, newDue, cashRefund, receivableReduction };
}

export function tryCalculateRefundFinancialImpact(input: {
  originalTotal: number;
  originalPaid: number;
  totalCredit: number;
}): RefundFinancialImpact | null {
  const originalTotal = roundRefundMoney(Math.max(0, Number(input.originalTotal ?? 0)));
  const totalCredit = roundRefundMoney(Math.max(0, Number(input.totalCredit ?? 0)));
  if (totalCredit > originalTotal) return null;
  return calculateRefundFinancialImpact(input);
}

export function calculateRefundSelection(
  items: RefundableInvoiceItem[],
  selections: RefundSelectionInput[],
): RefundCalculation {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('Select at least one refundable item');
  }

  const itemMap = new Map(items.map((item) => [item.invoiceItemId, item]));
  const seen = new Set<number>();
  const calculated: RefundCalculation['items'] = [];

  for (const selection of selections) {
    if (seen.has(selection.invoiceItemId)) {
      throw new Error(`Duplicate refund item ${selection.invoiceItemId}`);
    }
    seen.add(selection.invoiceItemId);

    const item = itemMap.get(selection.invoiceItemId);
    if (!item) throw new Error(`Invoice item ${selection.invoiceItemId} is not refundable`);
    if (!item.eligible) throw new Error(item.blockReason || `${item.description} is not refundable`);
    if (!Number.isInteger(selection.returnQuantity) || selection.returnQuantity <= 0) {
      throw new Error(`Refund quantity for ${item.description} must be a positive whole number`);
    }
    if (selection.returnQuantity > item.availableQuantity) {
      throw new Error(`Only ${item.availableQuantity} of ${item.description} is available for refund`);
    }

    const refundAmount = roundRefundMoney(item.refundableUnitAmount * selection.returnQuantity);
    calculated.push({ ...item, returnQuantity: selection.returnQuantity, refundAmount });
  }

  return {
    items: calculated,
    totalRefund: roundRefundMoney(calculated.reduce((sum, item) => sum + item.refundAmount, 0)),
  };
}

function parseRequestData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toPositiveInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeClinicalStatus(status: unknown): string | null {
  const value = String(status ?? '').trim().toLowerCase();
  return value || null;
}

const TERMINAL_DIAGNOSTIC_STATUSES = new Set([
  'completed',
  'verified',
  'reported',
  'scanned',
  'cancelled',
]);

export async function loadRefundableInvoiceItems(
  db: D1Database,
  tenantId: string,
  billId: number,
  options: { excludeApprovalRequestId?: number } = {},
): Promise<RefundableInvoiceItem[]> {
  const { results: rows } = await db.prepare(`
    SELECT
      ii.id,
      ii.description,
      ii.item_category,
      ii.quantity,
      ii.unit_price,
      ii.line_total,
      ii.reference_id,
      COALESCE(ii.status, 'active') AS invoice_status,
      COALESCE((
        SELECT SUM(cni.return_quantity)
        FROM billing_credit_note_items cni
        JOIN billing_credit_notes cn
          ON cn.id = cni.credit_note_id
         AND cn.tenant_id = cni.tenant_id
        WHERE cni.tenant_id = ii.tenant_id
          AND cni.invoice_item_id = ii.id
          AND cn.is_active = 1
          AND cn.status = 'approved'
      ), 0) AS approved_returned_qty,
      COALESCE((
        SELECT SUM(cni.return_quantity)
        FROM billing_credit_note_items cni
        JOIN billing_credit_notes cn
          ON cn.id = cni.credit_note_id
         AND cn.tenant_id = cni.tenant_id
        WHERE cni.tenant_id = ii.tenant_id
          AND cni.invoice_item_id = ii.id
          AND cn.is_active = 1
          AND cn.status IN ('pending', 'ready_for_payout')
      ), 0) AS pending_credit_note_qty
    FROM invoice_items ii
    WHERE ii.tenant_id = ?
      AND ii.bill_id = ?
      AND COALESCE(ii.status, 'active') != 'cancelled'
    ORDER BY ii.id
  `).bind(tenantId, billId).all<any>();

  const pendingByItem = new Map<number, number>();
  const { results: pendingRequests } = await db.prepare(`
    SELECT id, request_data
    FROM approval_requests
    WHERE tenant_id = ?
      AND type = 'refund'
      AND entity_id = ?
      AND status = 'pending'
  `).bind(tenantId, billId).all<any>();

  for (const request of pendingRequests ?? []) {
    if (options.excludeApprovalRequestId && Number(request.id) === options.excludeApprovalRequestId) continue;
    const requestData = parseRequestData(request.request_data);
    const selections = Array.isArray(requestData.items) ? requestData.items : [];
    for (const raw of selections) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const invoiceItemId = toPositiveInt(item.invoiceItemId ?? item.invoice_item_id);
      const quantity = toPositiveInt(item.returnQuantity ?? item.return_quantity);
      if (invoiceItemId && quantity) pendingByItem.set(invoiceItemId, (pendingByItem.get(invoiceItemId) ?? 0) + quantity);
    }
  }

  const invoiceItemIds = Array.from(new Set((rows ?? []).map((row: any) => toPositiveInt(row.id)).filter(Boolean)));
  const referenceIds = Array.from(new Set((rows ?? []).map((row: any) => toPositiveInt(row.reference_id)).filter(Boolean)));
  const labStatusByReference = new Map<number, string>();
  const labLinkByInvoiceItem = new Map<number, {
    labOrderItemId: number;
    status: string;
    ambiguous: boolean;
  }>();
  const radiologyStatusByReference = new Map<number, string>();
  if (referenceIds.length > 0) {
    const placeholders = referenceIds.map(() => '?').join(',');
    try {
      const { results: labRows } = await db.prepare(`
        SELECT loi.id, loi.status
        FROM lab_order_items loi
        JOIN lab_orders lo
          ON lo.id = loi.lab_order_id
         AND lo.tenant_id = loi.tenant_id
         AND lo.bill_id = ?
        WHERE loi.tenant_id = ?
          AND loi.id IN (${placeholders})
      `).bind(billId, tenantId, ...referenceIds).all<any>();
      for (const row of labRows ?? []) {
        const status = normalizeClinicalStatus(row.status);
        if (status) labStatusByReference.set(Number(row.id), status);
      }
    } catch {
      // Older/focused tenant schemas may not include the lab tables.
    }

    try {
      const { results: radiologyRows } = await db.prepare(`
        SELECT id, order_status AS status
        FROM radiology_requisitions
        WHERE tenant_id = ?
          AND bill_id = ?
          AND id IN (${placeholders})
      `).bind(tenantId, billId, ...referenceIds).all<any>();
      for (const row of radiologyRows ?? []) {
        const status = normalizeClinicalStatus(row.status);
        if (status) radiologyStatusByReference.set(Number(row.id), status);
      }
    } catch {
      // Radiology is optional for some tenant schemas.
    }
  }

  if (invoiceItemIds.length > 0) {
    const invoiceItemPlaceholders = invoiceItemIds.map(() => '?').join(',');
    try {
      const { results: mappedLabRows } = await db.prepare(`
        SELECT ii.id AS invoice_item_id, loi.id AS lab_order_item_id, loi.status
        FROM invoice_items ii
        JOIN lab_test_catalog ltc
          ON ltc.tenant_id = ii.tenant_id
         AND ltc.billing_service_item_id = ii.reference_id
        JOIN lab_order_items loi
          ON loi.tenant_id = ii.tenant_id
         AND loi.lab_test_id = ltc.id
        JOIN lab_orders lo
          ON lo.id = loi.lab_order_id
         AND lo.tenant_id = loi.tenant_id
         AND lo.bill_id = ii.bill_id
        WHERE ii.tenant_id = ?
          AND ii.bill_id = ?
          AND ii.id IN (${invoiceItemPlaceholders})
      `).bind(tenantId, billId, ...invoiceItemIds).all<any>();
      for (const row of mappedLabRows ?? []) {
        const invoiceItemId = Number(row.invoice_item_id);
        const labOrderItemId = Number(row.lab_order_item_id);
        const status = normalizeClinicalStatus(row.status);
        if (!Number.isInteger(invoiceItemId) || invoiceItemId <= 0
          || !Number.isInteger(labOrderItemId) || labOrderItemId <= 0
          || !status) continue;
        const existing = labLinkByInvoiceItem.get(invoiceItemId);
        if (!existing) {
          labLinkByInvoiceItem.set(invoiceItemId, { labOrderItemId, status, ambiguous: false });
        } else if (existing.labOrderItemId !== labOrderItemId || existing.status !== status) {
          labLinkByInvoiceItem.set(invoiceItemId, { ...existing, status: 'ambiguous', ambiguous: true });
        }
      }
    } catch {
      // Some older tenant schemas do not expose catalog-to-lab linkage.
    }
  }

  return (rows ?? []).map((row: any) => {
    const quantity = Math.max(1, Number(row.quantity ?? 1));
    const approvedReturnedQuantity = Math.max(0, Number(row.approved_returned_qty ?? 0));
    const pendingReservedQuantity = Math.max(0, Number(row.pending_credit_note_qty ?? 0)) + (pendingByItem.get(Number(row.id)) ?? 0);
    const availableQuantity = Math.max(0, quantity - approvedReturnedQuantity - pendingReservedQuantity);
    const hasLineTotal = row.line_total !== null && row.line_total !== undefined && row.line_total !== '';
    const lineTotal = hasLineTotal ? Number(row.line_total) : Number(row.unit_price ?? 0) * quantity;
    const unitPrice = Number(row.unit_price ?? 0);
    const refundableUnitAmount = roundRefundMoney(hasLineTotal ? lineTotal / quantity : unitPrice);
    const invoiceItemId = Number(row.id);
    const referenceId = toPositiveInt(row.reference_id) || null;
    const directLabStatus = referenceId ? (labStatusByReference.get(referenceId) ?? null) : null;
    const mappedLabLink = labLinkByInvoiceItem.get(invoiceItemId) ?? null;
    const mappedLabStatus = mappedLabLink?.status ?? null;
    const conflictingLabLink = Boolean(
      mappedLabLink?.ambiguous
      || (directLabStatus && mappedLabLink && referenceId !== mappedLabLink.labOrderItemId)
      || (directLabStatus && mappedLabStatus && directLabStatus !== mappedLabStatus),
    );
    const labStatus = conflictingLabLink ? 'ambiguous' : (directLabStatus ?? mappedLabStatus);
    const radiologyStatus = referenceId ? (radiologyStatusByReference.get(referenceId) ?? null) : null;
    const ambiguousDiagnosticLink = labStatus === 'ambiguous' || Boolean(labStatus && radiologyStatus);
    const clinicalStatus = ambiguousDiagnosticLink ? 'ambiguous' : (labStatus ?? radiologyStatus);
    const diagnostic = String(row.item_category ?? '').toLowerCase() === 'test';

    let blockReason: string | null = null;
    if (availableQuantity <= 0) blockReason = 'No refundable quantity remains';
    else if (refundableUnitAmount <= 0) blockReason = 'No refundable amount remains';
    else if (diagnostic && ambiguousDiagnosticLink) {
      blockReason = 'Service linkage is ambiguous; use manual review';
    } else if (diagnostic && clinicalStatus && TERMINAL_DIAGNOSTIC_STATUSES.has(clinicalStatus)) {
      blockReason = clinicalStatus === 'cancelled'
        ? 'This service has already been cancelled'
        : 'Completed or verified services cannot be refunded';
    }

    return {
      invoiceItemId: Number(row.id),
      description: String(row.description ?? `Item #${row.id}`),
      itemCategory: String(row.item_category ?? 'other'),
      quantity,
      approvedReturnedQuantity,
      pendingReservedQuantity,
      availableQuantity,
      refundableUnitAmount,
      clinicalStatus,
      eligible: blockReason === null,
      blockReason,
      referenceId,
      unitPrice,
      lineTotal,
    };
  });
}

function allocationAmountFromRequestItem(raw: unknown): { invoiceItemId: number; amount: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const invoiceItemId = toPositiveInt(item.invoiceItemId ?? item.invoice_item_id);
  const directAmount = Number(
    item.allocatedRefundAmount
      ?? item.allocated_refund_amount
      ?? item.calculatedAmount
      ?? item.calculated_amount
      ?? 0,
  );
  if (!invoiceItemId || !Number.isFinite(directAmount) || directAmount <= 0) return null;
  return { invoiceItemId, amount: roundRefundMoney(directAmount) };
}

export async function loadRefundAllocationItems(
  db: D1Database,
  tenantId: string,
  billId: number,
  options: { excludeApprovalRequestId?: number } = {},
): Promise<RefundAllocationItem[]> {
  const { results: rows } = await db.prepare(`
    SELECT
      ii.id,
      ii.description,
      ii.item_category,
      ii.quantity,
      ii.unit_price,
      ii.line_total,
      ii.reference_id,
      COALESCE((
        SELECT SUM(cni.total_amount)
        FROM billing_credit_note_items cni
        JOIN billing_credit_notes cn
          ON cn.id = cni.credit_note_id
         AND cn.tenant_id = cni.tenant_id
        WHERE cni.tenant_id = ii.tenant_id
          AND cni.invoice_item_id = ii.id
          AND cn.is_active = 1
          AND cn.status = 'approved'
      ), 0) AS approved_credit_amount
    FROM invoice_items ii
    WHERE ii.tenant_id = ?
      AND ii.bill_id = ?
      AND COALESCE(ii.status, 'active') != 'cancelled'
    ORDER BY ii.id
  `).bind(tenantId, billId).all<any>();

  const pendingByItem = new Map<number, number>();
  const { results: pendingRequests } = await db.prepare(`
    SELECT id, request_data
    FROM approval_requests
    WHERE tenant_id = ?
      AND type = 'refund'
      AND entity_id = ?
      AND status IN ('pending', 'partially_approved')
  `).bind(tenantId, billId).all<any>();

  for (const request of pendingRequests ?? []) {
    if (options.excludeApprovalRequestId && Number(request.id) === options.excludeApprovalRequestId) continue;
    const requestData = parseRequestData(request.request_data);
    const allocations = Array.isArray(requestData.items) ? requestData.items : [];
    for (const raw of allocations) {
      const allocation = allocationAmountFromRequestItem(raw);
      if (!allocation) continue;
      pendingByItem.set(
        allocation.invoiceItemId,
        roundRefundMoney((pendingByItem.get(allocation.invoiceItemId) ?? 0) + allocation.amount),
      );
    }
  }

  return (rows ?? []).map((row: any, index: number) => {
    const quantity = Math.max(1, Number(row.quantity ?? 1));
    const lineAmount = roundRefundMoney(
      row.line_total !== null && row.line_total !== undefined && row.line_total !== ''
        ? Number(row.line_total)
        : Number(row.unit_price ?? 0) * quantity,
    );
    const approvedCreditAmount = roundRefundMoney(Math.max(0, Number(row.approved_credit_amount ?? 0)));
    const pendingAllocatedAmount = roundRefundMoney(Math.max(0, pendingByItem.get(Number(row.id)) ?? 0));
    return {
      invoiceItemId: Number(row.id),
      description: String(row.description ?? `Item #${row.id}`),
      itemCategory: String(row.item_category ?? 'other'),
      lineAmount,
      approvedCreditAmount,
      pendingAllocatedAmount,
      refundableBalance: roundRefundMoney(Math.max(0, lineAmount - approvedCreditAmount - pendingAllocatedAmount)),
      referenceId: toPositiveInt(row.reference_id) || null,
      lineIndex: index + 1,
    };
  });
}

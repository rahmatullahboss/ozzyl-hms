type UnknownRow = Record<string, unknown>;

export type RefundRequestItemSummary = {
  invoiceItemId: number;
  returnQuantity: number;
  allocatedRefundAmount: number;
  description: string | null;
};

export type RefundRequestSummary = {
  id: number;
  billId: number;
  invoiceNo: string | null;
  status: string;
  executionStatus: string;
  createdAt: string | null;
  refundKind: string;
  requestedRefundAmount: number;
  cashRefundAmount: number;
  receivableReduction: number;
  itemCount: number;
  items: RefundRequestItemSummary[];
};

function roundMoney(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function positiveInt(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function parseRequestData(value: unknown): UnknownRow {
  if (value && typeof value === 'object') return value as UnknownRow;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as UnknownRow : {};
  } catch {
    return {};
  }
}

export function summarizeRefundApprovalRequests(rows: UnknownRow[]): RefundRequestSummary[] {
  return rows.map((row) => {
    const requestData = parseRequestData(row.request_data);
    const rawItems = Array.isArray(requestData.items) ? requestData.items : [];
    const items = rawItems.map((raw): RefundRequestItemSummary | null => {
      if (!raw || typeof raw !== 'object') return null;
      const item = raw as UnknownRow;
      const invoiceItemId = positiveInt(item.invoiceItemId ?? item.invoice_item_id);
      if (!invoiceItemId) return null;
      return {
        invoiceItemId,
        returnQuantity: Math.max(0, Number(item.returnQuantity ?? item.return_quantity ?? 0) || 0),
        allocatedRefundAmount: roundMoney(item.allocatedRefundAmount ?? item.allocated_refund_amount ?? item.calculatedAmount),
        description: typeof item.description === 'string' ? item.description : null,
      };
    }).filter((item): item is RefundRequestItemSummary => Boolean(item));
    const requestedRefundAmount = roundMoney(
      requestData.requestedRefundAmount
      ?? requestData.requested_refund_amount
      ?? items.reduce((sum, item) => sum + item.allocatedRefundAmount, 0),
    );
    return {
      id: positiveInt(row.id),
      billId: positiveInt(row.entity_id ?? row.bill_id),
      invoiceNo: row.entity_no == null ? null : String(row.entity_no),
      status: String(row.status ?? 'pending'),
      executionStatus: String(row.execution_status ?? 'pending'),
      createdAt: row.created_at == null ? null : String(row.created_at),
      refundKind: String(requestData.refundKind ?? requestData.refund_kind ?? 'refund'),
      requestedRefundAmount,
      cashRefundAmount: roundMoney(requestData.cashRefundAmount ?? requestData.cash_refund_amount),
      receivableReduction: roundMoney(requestData.receivableReduction ?? requestData.receivable_reduction),
      itemCount: items.length,
      items,
    };
  });
}

function requestIsPending(request: RefundRequestSummary): boolean {
  return ['pending', 'partially_approved'].includes(request.status.toLowerCase());
}

export function annotateInvoiceItemsWithRefunds(
  invoiceItems: UnknownRow[],
  creditRows: UnknownRow[],
  refundRequests: RefundRequestSummary[],
): UnknownRow[] {
  const creditByItem = new Map<number, { quantity: number; amount: number; creditNoteNos: string | null }>();
  for (const row of creditRows) {
    const invoiceItemId = positiveInt(row.invoice_item_id);
    if (!invoiceItemId) continue;
    creditByItem.set(invoiceItemId, {
      quantity: Math.max(0, Number(row.refunded_quantity ?? 0) || 0),
      amount: Math.max(0, roundMoney(row.refunded_amount)),
      creditNoteNos: row.credit_note_nos == null ? null : String(row.credit_note_nos),
    });
  }

  const pendingItemIds = new Set<number>();
  for (const request of refundRequests) {
    if (!requestIsPending(request)) continue;
    request.items.forEach((item) => pendingItemIds.add(item.invoiceItemId));
  }

  return invoiceItems.map((item) => {
    const itemId = positiveInt(item.id);
    const quantity = Math.max(0, Number(item.quantity ?? 0) || 0);
    const unitPrice = Math.max(0, roundMoney(item.unit_price));
    const grossLineAmount = roundMoney(quantity * unitPrice);
    const originalLineAmount = Math.max(0, grossLineAmount > 0
      ? grossLineAmount
      : roundMoney(item.line_total));
    const credit = creditByItem.get(itemId) ?? { quantity: 0, amount: 0, creditNoteNos: null };
    const refundedAmount = Math.min(originalLineAmount, credit.amount);
    const pending = pendingItemIds.has(itemId);
    const refundStatus = refundedAmount > 0
      ? pending ? 'refunded_pending_approval' : 'refunded'
      : pending ? 'refund_requested' : null;

    return {
      ...item,
      original_line_amount: originalLineAmount,
      refunded_quantity: credit.quantity,
      refunded_amount: refundedAmount,
      net_line_amount: Math.max(0, roundMoney(originalLineAmount - refundedAmount)),
      refund_status: refundStatus,
      credit_note_nos: credit.creditNoteNos,
    };
  });
}

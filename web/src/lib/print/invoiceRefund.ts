import type { InvoicePrintItem } from '../../components/invoice/types';

export function getInvoiceItemOriginalAmount(item: InvoicePrintItem): number {
  const grossLineAmount = Number(item.quantity ?? 0) * Number(item.unit_price ?? 0);
  const fallback = grossLineAmount > 0 ? grossLineAmount : Number(item.line_total ?? 0);
  const amount = Number(item.original_line_amount ?? fallback);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100) / 100) : 0;
}

export function getInvoiceItemNetAmount(item: InvoicePrintItem): number {
  const original = getInvoiceItemOriginalAmount(item);
  const explicit = Number(item.net_line_amount);
  if (item.net_line_amount !== null && item.net_line_amount !== undefined && Number.isFinite(explicit)) {
    return Math.max(0, Math.round(explicit * 100) / 100);
  }
  const refunded = Number(item.refunded_amount ?? 0);
  return Math.max(0, Math.round((original - (Number.isFinite(refunded) ? refunded : 0)) * 100) / 100);
}

export function getInvoiceItemDisplayAmount(item: InvoicePrintItem): number {
  const quantity = Math.max(0, Number(item.quantity ?? 0) || 0);
  const refundedQuantity = Math.max(0, Number(item.refunded_quantity ?? 0) || 0);
  const refundedAmount = Math.max(0, Number(item.refunded_amount ?? 0) || 0);
  const fullyReturned = refundedAmount > 0 && quantity > 0 && refundedQuantity >= quantity;
  return fullyReturned ? 0 : getInvoiceItemNetAmount(item);
}

export function getInvoiceItemRefundLabel(
  item: InvoicePrintItem,
  labels: { requested: string; pendingApproval: string; refunded: string },
): string | null {
  if (item.refund_status === 'refunded_pending_approval') return labels.pendingApproval;
  if (item.refund_status === 'refunded') return labels.refunded;
  if (item.refund_status === 'refund_requested') return labels.requested;
  return null;
}

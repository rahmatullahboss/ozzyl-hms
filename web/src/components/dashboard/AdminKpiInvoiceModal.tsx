import InvoiceInspector from '../invoice-inspector/InvoiceInspector';

/**
 * @deprecated Compatibility adapter for existing KPI consumers.
 * New dashboard surfaces should drive InvoiceInspector through URL-backed invoiceId state.
 */
export default function AdminKpiInvoiceModal({
  billId,
  onClose,
}: {
  billId: number;
  onClose: () => void;
}) {
  return <InvoiceInspector billId={billId} onClose={onClose} />;
}

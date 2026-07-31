import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';

import { Printer, ArrowLeft, Loader2 } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';

interface InvoiceItem {
  id: number;
  item_name: string;
  generic_name?: string;
  batch_no?: string;
  expiry_date?: string;
  quantity: number;
  unit_price: number;
  discount_pct?: number;
  line_total: number;
}

interface Invoice {
  id: number;
  invoice_no: number;
  patient_id?: number;
  patient_name?: string;
  patient_code?: string;
  patient_mobile?: string;
  prescriber_name?: string;
  total_qty: number;
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  credit_amount: number;
  payment_mode: string;
  status: string;
  print_count: number;
  remarks?: string;
  created_at: string;
}

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d: string) =>
  new Date(d).toLocaleString('en-BD', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

export default function InvoiceReceipt({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);

  const token = () => localStorage.getItem('hms_token');

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(`/api/pharmacy/invoices/${id}/receipt`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        setInvoice(data.invoice);
        setItems(data.items ?? []);
      } catch {
        toast.error(t('pharmacy.failed_to_load_invoice_receipt'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handlePrint = async () => {
    // Increment print count on server
    try {
      await axios.put(`/api/pharmacy/invoices/${id}/print-count`, {}, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      setInvoice(prev => prev ? { ...prev, print_count: prev.print_count + 1 } : prev);
    } catch { /* non-blocking */ }
    window.print();
  };

  if (loading) {
    return (
      <DashboardLayout role={role}>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!invoice) {
    return (
      <DashboardLayout role={role}>
        <div className="text-center py-20 text-gray-400">Invoice not found</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={role}>
      {/* Action bar — hides on print */}
      <div className="print:hidden flex items-center gap-3 mb-6">
        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </button>
        <div className="flex-1" />
        <span className="text-sm text-gray-500">Printed {invoice.print_count} time(s)</span>
        <button className="btn btn-primary" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" /> Print Receipt
        </button>
      </div>

      {/* Receipt — this section prints */}
      <div ref={printRef} className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8 print:shadow-none print:border-none print:p-4">

        {/* Hospital Header */}
        <div className="text-center border-b border-gray-200 pb-4 mb-4">
          <h1 className="text-xl font-bold text-gray-900">Ozzyl Health Pharmacy</h1>
          <p className="text-sm text-gray-500 mt-1">Phone: — | Email: —</p>
        </div>

        {/* Receipt Title */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-700">Sales Invoice</h2>
            <p className="text-sm text-gray-500 mt-1">
              Invoice #: <span className="font-mono font-medium">{invoice.invoice_no}</span>
            </p>
            <p className="text-sm text-gray-500">Date: {fmtDate(invoice.created_at)}</p>
          </div>
          <div className="text-right">
            {invoice.patient_name ? (
              <>
                <p className="text-sm font-medium text-gray-700">{invoice.patient_name}</p>
                <p className="text-xs text-gray-500">{invoice.patient_code}</p>
                <p className="text-xs text-gray-500">{invoice.patient_mobile}</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">Cash Patient</p>
            )}
            {invoice.prescriber_name && (
              <p className="text-xs text-gray-500 mt-1">Dr. {invoice.prescriber_name}</p>
            )}
          </div>
        </div>

        {/* Items Table */}
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="text-left py-2 font-semibold text-gray-600">#</th>
              <th className="text-left py-2 font-semibold text-gray-600">Item</th>
              <th className="text-center py-2 font-semibold text-gray-600">Qty</th>
              <th className="text-right py-2 font-semibold text-gray-600">Price</th>
              <th className="text-right py-2 font-semibold text-gray-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="py-1.5 text-gray-400 pr-2">{idx + 1}</td>
                <td className="py-1.5">
                  <p className="font-medium text-gray-800">{item.item_name}</p>
                  {item.generic_name && <p className="text-xs text-gray-400">{item.generic_name}</p>}
                  {item.batch_no && <p className="text-xs text-gray-400">Batch: {item.batch_no}</p>}
                </td>
                <td className="py-1.5 text-center">{item.quantity}</td>
                <td className="py-1.5 text-right">{fmt(item.unit_price)}</td>
                <td className="py-1.5 text-right font-medium">{fmt(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex flex-col items-end space-y-1 text-sm border-t border-gray-200 pt-3">
          <div className="flex justify-between w-48">
            <span className="text-gray-500">Subtotal</span>
            <span>{fmt(invoice.subtotal)}</span>
          </div>
          {invoice.discount_amount > 0 && (
            <div className="flex justify-between w-48 text-red-500">
              <span>Discount</span>
              <span>- {fmt(invoice.discount_amount)}</span>
            </div>
          )}
          {invoice.vat_amount > 0 && (
            <div className="flex justify-between w-48">
              <span className="text-gray-500">VAT</span>
              <span>{fmt(invoice.vat_amount)}</span>
            </div>
          )}
          <div className="flex justify-between w-48 border-t border-gray-300 pt-1 font-bold text-base">
            <span>Total</span>
            <span>{fmt(invoice.total_amount)}</span>
          </div>
          <div className="flex justify-between w-48 text-green-600">
            <span>Paid ({invoice.payment_mode})</span>
            <span>{fmt(invoice.paid_amount)}</span>
          </div>
          {invoice.credit_amount > 0 && (
            <div className="flex justify-between w-48 text-orange-500">
              <span>Credit</span>
              <span>{fmt(invoice.credit_amount)}</span>
            </div>
          )}
        </div>

        {/* Remarks */}
        {invoice.remarks && (
          <p className="mt-4 text-xs text-gray-400 border-t border-gray-100 pt-3">
            Note: {invoice.remarks}
          </p>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-gray-400 border-t border-gray-200 pt-3">
          <p>Thank you for choosing our pharmacy</p>
          <p className="mt-1">This is a computer-generated receipt · Print #{invoice.print_count}</p>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print\\:shadow-none, .print\\:shadow-none * { visibility: visible; }
          .print\\:shadow-none { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </DashboardLayout>
  );
}

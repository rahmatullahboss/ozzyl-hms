import { printHtml, formatMoney, formatDate, escapeHtml } from './printUtils';
import { getInvoiceBannerLabel } from './invoiceCategory';

export interface InvoiceData {
  invoiceNo: string;
  createdAt: string;
  patient: {
    name: string;
    patientCode?: string;
    mobile?: string;
    address?: string;
    age?: string;
    gender?: string;
  };
  items: Array<{
    itemCategory: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discount: number;
  discountByName?: string | null;
  totalAmount: number;
  paidAmount: number;
  paymentMethod?: string;
  receivedBy?: string;
  hospital?: { name: string; address?: string; phone?: string; logoUrl?: string };
}

export function printInvoice(inv: InvoiceData): void {
  const outstanding = inv.totalAmount - inv.paidAmount;
  const bannerLabel = getInvoiceBannerLabel(
    inv.items.map((i) => ({ item_category: i.itemCategory })),
    'en',
  );
  const status = outstanding <= 0 ? 'paid' : inv.paidAmount > 0 ? 'partially-paid' : 'unpaid';

  const itemRows = inv.items.map((item) => `
    <tr>
      <td>${item.description || item.itemCategory}</td>
      <td class="amount">${item.quantity}</td>
      <td class="amount">${formatMoney(item.unitPrice)}</td>
      <td class="amount">${formatMoney(item.quantity * item.unitPrice)}</td>
    </tr>`).join('');

  const html = `
    <div class="flex-between">
      <div style="display:flex;align-items:center;gap:10px">
        ${inv.hospital?.logoUrl ? `<img src="${inv.hospital.logoUrl}" alt="Logo" style="height:48px;width:48px;object-fit:contain" />` : ''}
        <div>
          <h1>${inv.hospital?.name ?? 'Hospital Management System'}</h1>
          ${inv.hospital?.address ? `<div class="text-sm">${inv.hospital.address}</div>` : ''}
          ${inv.hospital?.phone ? `<div class="text-sm">📞 ${inv.hospital.phone}</div>` : ''}
        </div>
      </div>
      <div class="text-right">
         <div class="text-sm">No: <strong>${inv.invoiceNo}</strong></div>
        <div class="text-xs">Date: ${formatDate(inv.createdAt?.split('T')[0])}</div>
      </div>
    </div>
    <hr />
    ${bannerLabel ? `<div class="invoice-banner" aria-label="Invoice type: ${bannerLabel.replace(/"/g, '&quot;')}">${escapeHtml(bannerLabel)}</div>` : ''}
    <div class="info-grid">
      <div>
        <h3>Bill To</h3>
        <div class="info-row"><span class="info-label">Patient:</span><span>${inv.patient.name}</span></div>
        ${inv.patient.patientCode ? `<div class="info-row"><span class="info-label">Patient Code:</span><span>${inv.patient.patientCode}</span></div>` : ''}
        ${inv.patient.mobile ? `<div class="info-row"><span class="info-label">Mobile:</span><span>${inv.patient.mobile}</span></div>` : ''}
        ${(inv.patient.age || inv.patient.gender) ? `<div class="info-row"><span class="info-label">Age/Sex:</span><span>${[inv.patient.age, inv.patient.gender].filter(Boolean).join(' / ')}</span></div>` : ''}
        ${inv.patient.address ? `<div class="info-row"><span class="info-label">Address:</span><span>${inv.patient.address}</span></div>` : ''}
      </div>
      <div class="text-right">
        <span class="badge badge-${status === 'paid' ? 'paid' : 'unpaid'}" style="font-size:13px">
          ${status === 'paid' ? '✓ PAID' : status === 'partially-paid' ? '⚠ PARTIAL' : '✗ UNPAID'}
        </span>
      </div>
    </div>
    <table style="margin-top:12px">
      <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="totals-block">
      <table class="totals-table">
        <tr><td>Subtotal</td><td class="amount">${formatMoney(inv.subtotal)}</td></tr>
        ${inv.discount > 0 ? `<tr><td>Discount</td><td class="amount">- ${formatMoney(inv.discount)}</td></tr>` : ''}
        <tr class="grand-total"><td>Total</td><td class="amount">${formatMoney(inv.totalAmount)}</td></tr>
        ${inv.paidAmount > 0 ? `<tr><td>Paid</td><td class="amount">${formatMoney(inv.paidAmount)}</td></tr>` : ''}
        ${outstanding > 0 ? `<tr><td style="color:#dc2626">Outstanding</td><td class="amount" style="color:#dc2626">${formatMoney(outstanding)}</td></tr>` : ''}
      </table>
    </div>
    ${(inv.paymentMethod || inv.receivedBy) ? `
    <div style="margin-top:12px">
      <table class="totals-table">
        ${inv.paymentMethod ? `<tr><td>Payment Method</td><td class="amount">${escapeHtml(inv.paymentMethod)}</td></tr>` : ''}
        ${inv.receivedBy ? `<tr><td>Received By</td><td class="amount">${escapeHtml(inv.receivedBy)}</td></tr>` : ''}
      </table>
    </div>` : ''}
    <div class="double-line" style="margin-top:24px"></div>
    <div class="text-center text-xs">Thank you for choosing our services. — ${inv.hospital?.name ?? 'HMS'}</div>`;

  printHtml(html, `Invoice ${inv.invoiceNo}`);
}

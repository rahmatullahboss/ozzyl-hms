import { printHtml, formatMoney, formatDate } from './printUtils';

export interface ReceiptData {
  receiptNo: string;
  paidAt: string;
  amount: number;
  paymentMethod?: string;
  type?: string;
  invoiceNo: string;
  patient: { name: string; patientCode?: string; mobile?: string };
  hospital?: { name: string; address?: string; phone?: string };
}

export function printReceipt(r: ReceiptData): void {
  const html = `
    <div class="text-center">
      <h1>${r.hospital?.name ?? 'Hospital Management System'}</h1>
      ${r.hospital?.address ? `<div class="text-sm">${r.hospital.address}</div>` : ''}
      ${r.hospital?.phone ? `<div class="text-sm">📞 ${r.hospital.phone}</div>` : ''}
    </div>
    <div class="double-line"></div>
    <h2 class="text-center" style="letter-spacing:2px;margin:8px 0">PAYMENT RECEIPT</h2>
    <hr />
    <div class="info-grid">
      <div>
        <div class="info-row"><span class="info-label">Receipt No:</span><span><strong>${r.receiptNo}</strong></span></div>
        <div class="info-row"><span class="info-label">Invoice No:</span><span>${r.invoiceNo}</span></div>
        <div class="info-row"><span class="info-label">Date:</span><span>${formatDate(r.paidAt?.split('T')[0])}</span></div>
      </div>
      <div>
        <div class="info-row"><span class="info-label">Patient:</span><span>${r.patient.name}</span></div>
        ${r.patient.patientCode ? `<div class="info-row"><span class="info-label">Patient ID:</span><span>${r.patient.patientCode}</span></div>` : ''}
        ${r.patient.mobile ? `<div class="info-row"><span class="info-label">Mobile:</span><span>${r.patient.mobile}</span></div>` : ''}
      </div>
    </div>
    <hr />
    <table>
      <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>
        <tr>
          <td>Payment received — ${r.type === 'fire_service' ? 'Fire Service' : r.type === 'due' ? 'Due Collection' : 'Cash Payment'}</td>
          <td class="amount"><strong>${formatMoney(r.amount)}</strong></td>
        </tr>
        ${r.paymentMethod ? `<tr><td>Payment Method</td><td class="amount">${r.paymentMethod}</td></tr>` : ''}
      </tbody>
    </table>
    <div class="double-line" style="margin-top: 16px;"></div>
    <div style="display:flex; justify-content:space-between; margin-top:32px">
      <div class="text-center text-xs" style="min-width:120px">
        <hr style="margin-bottom:4px"/>Cashier's Signature
      </div>
      <div class="text-center text-xs" style="min-width:120px">
        <hr style="margin-bottom:4px"/>Patient / Receiver
      </div>
    </div>
    <div class="text-center text-xs" style="margin-top:16px">This is a computer-generated receipt. — ${r.hospital?.name ?? 'HMS'}</div>`;

  printHtml(html, `Receipt ${r.receiptNo}`);
}

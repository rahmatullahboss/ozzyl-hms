import { printHtml, formatDate, escapeHtml } from './printUtils';

export interface DepositReceiptData {
  receiptNo: string;
  date: string;
  patientName: string;
  patientCode?: string;
  amount: number;
  paymentMethod: string;
  remarks?: string;
  hospital?: { name: string; address?: string; phone?: string };
}

export function printDepositReceipt(data: DepositReceiptData): void {
  const html = `
    <div class="flex-between">
      <div>
        <h1>${escapeHtml(data.hospital?.name ?? 'Hospital')}</h1>
        ${data.hospital?.address ? `<div class="text-sm">${escapeHtml(data.hospital.address)}</div>` : ''}
        ${data.hospital?.phone ? `<div class="text-sm">Phone: ${escapeHtml(data.hospital.phone)}</div>` : ''}
      </div>
      <div class="text-right">
        <h2>DEPOSIT RECEIPT</h2>
        <div class="text-sm">Receipt No: <strong>${escapeHtml(data.receiptNo)}</strong></div>
        <div class="text-xs">Date: ${formatDate(data.date?.split('T')[0])}</div>
      </div>
    </div>
    <div class="double-line"></div>

    <h3 style="margin-top:10px">Patient Information</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Patient Name:</span><span><strong>${escapeHtml(data.patientName)}</strong></span></div>
      ${data.patientCode ? `<div class="info-row"><span class="info-label">Patient ID:</span><span>${escapeHtml(data.patientCode)}</span></div>` : ''}
    </div>

    <hr />
    <h3>Deposit Details</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Amount Received:</span><span style="font-size:14px;font-weight:700">৳ ${data.amount.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
      <div class="info-row"><span class="info-label">Payment Method:</span><span style="text-transform:capitalize">${escapeHtml(data.paymentMethod.replace('_', ' '))}</span></div>
      ${data.remarks ? `<div class="info-row" style="grid-column:1/-1"><span class="info-label">Remarks:</span><span>${escapeHtml(data.remarks)}</span></div>` : ''}
    </div>

    <div style="margin-top:40px; display:flex; justify-content:space-between">
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Received By</div>
      </div>
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Patient/Guardian Signature</div>
      </div>
    </div>

    <div style="margin-top:30px; text-align:center; font-size:10px; color:#666">
      This is a computer-generated receipt and does not require a physical signature.
    </div>
  `;

  printHtml(html, `Deposit Receipt — ${data.receiptNo}`);
}

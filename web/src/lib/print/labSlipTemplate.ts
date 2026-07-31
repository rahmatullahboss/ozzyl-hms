import { printHtml, formatMoney, formatDate } from './printUtils';

export interface LabOrderPrintData {
  orderNo: string;
  orderDate: string;
  patient: { name: string; patientCode?: string; mobile?: string; age?: number };
  tests: Array<{ testName: string; code?: string; category?: string; unitPrice: number; result?: string; status: string }>;
  hospital?: { name: string; address?: string; phone?: string };
}

export function printLabSlip(data: LabOrderPrintData): void {
  const testRows = data.tests.map((t) => `
    <tr>
      <td>${t.testName}${t.code ? ` <span class="text-xs">[${t.code}]</span>` : ''}</td>
      <td>${t.category ?? '—'}</td>
      <td class="amount">${formatMoney(t.unitPrice)}</td>
      <td>${t.result ? t.result : `<span class="badge badge-unpaid">Pending</span>`}</td>
    </tr>`).join('');

  const html = `
    <div class="flex-between">
      <div>
        <h1>${data.hospital?.name ?? 'HMS Laboratory'}</h1>
        ${data.hospital?.address ? `<div class="text-sm">${data.hospital.address}</div>` : ''}
        ${data.hospital?.phone ? `<div class="text-sm">📞 ${data.hospital.phone}</div>` : ''}
      </div>
      <div class="text-right">
        <h2>LAB TEST SLIP</h2>
        <div class="text-sm">Order: <strong>${data.orderNo}</strong></div>
        <div class="text-xs">Date: ${formatDate(data.orderDate)}</div>
      </div>
    </div>
    <hr />
    <div class="info-grid">
      <div class="info-row"><span class="info-label">Patient Name:</span><span>${data.patient.name}</span></div>
      ${data.patient.patientCode ? `<div class="info-row"><span class="info-label">Patient ID:</span><span>${data.patient.patientCode}</span></div>` : ''}
      ${data.patient.mobile ? `<div class="info-row"><span class="info-label">Mobile:</span><span>${data.patient.mobile}</span></div>` : ''}
      ${data.patient.age ? `<div class="info-row"><span class="info-label">Age:</span><span>${data.patient.age} yrs</span></div>` : ''}
    </div>
    <table style="margin-top:12px">
      <thead><tr><th>Test Name</th><th>Category</th><th style="text-align:right">Price</th><th>Result</th></tr></thead>
      <tbody>${testRows}</tbody>
    </table>
    <div class="double-line" style="margin-top:24px"></div>
    <div style="display:flex; justify-content:space-between; margin-top:40px">
      <div class="text-center text-xs" style="min-width:120px">
        <hr style="margin-bottom:4px"/>Lab Technician
      </div>
      <div class="text-center text-xs" style="min-width:120px">
        <hr style="margin-bottom:4px"/>Doctor's Signature
      </div>
    </div>`;

  printHtml(html, `Lab Slip ${data.orderNo}`);
}

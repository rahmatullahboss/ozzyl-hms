import { printHtml, formatMoney, formatDate } from './printUtils';

export interface SalarySlipData {
  month: string;
  paidAt: string;
  staff: { name: string; position: string; bankAccount?: string; mobile?: string };
  baseSalary: number;
  bonus: number;
  deduction: number;
  netSalary: number;
  paymentMethod?: string;
  referenceNo?: string;
  hospital?: { name: string; address?: string; phone?: string };
}

export function printSalarySlip(s: SalarySlipData): void {
  const html = `
    <div class="text-center">
      <h1>${s.hospital?.name ?? 'Hospital Management System'}</h1>
      ${s.hospital?.address ? `<div class="text-sm">${s.hospital.address}</div>` : ''}
      ${s.hospital?.phone ? `<div class="text-sm">📞 ${s.hospital.phone}</div>` : ''}
    </div>
    <div class="double-line"></div>
    <h2 class="text-center" style="letter-spacing:2px;margin:8px 0">SALARY SLIP</h2>
    <hr />
    <div class="info-grid">
      <div>
        <div class="info-row"><span class="info-label">Employee:</span><span><strong>${s.staff.name}</strong></span></div>
        <div class="info-row"><span class="info-label">Position:</span><span>${s.staff.position}</span></div>
        ${s.staff.mobile ? `<div class="info-row"><span class="info-label">Mobile:</span><span>${s.staff.mobile}</span></div>` : ''}
      </div>
      <div>
        <div class="info-row"><span class="info-label">Pay Month:</span><span><strong>${s.month}</strong></span></div>
        <div class="info-row"><span class="info-label">Pay Date:</span><span>${formatDate(s.paidAt?.split('T')[0])}</span></div>
        ${s.staff.bankAccount ? `<div class="info-row"><span class="info-label">Bank A/C:</span><span>${s.staff.bankAccount}</span></div>` : ''}
      </div>
    </div>
    <table style="margin-top:12px">
      <thead><tr><th>Earnings</th><th style="text-align:right">Amount</th><th>Deductions</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>
        <tr>
          <td>Basic Salary</td>
          <td class="amount">${formatMoney(s.baseSalary)}</td>
          <td>Deductions</td>
          <td class="amount">${s.deduction > 0 ? formatMoney(s.deduction) : '—'}</td>
        </tr>
        <tr>
          <td>Bonus / Allowance</td>
          <td class="amount">${s.bonus > 0 ? formatMoney(s.bonus) : '—'}</td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
    <div class="totals-block">
      <table class="totals-table">
        <tr><td>Gross Earnings</td><td class="amount">${formatMoney(s.baseSalary + s.bonus)}</td></tr>
        <tr><td>Total Deductions</td><td class="amount">- ${formatMoney(s.deduction)}</td></tr>
        <tr class="grand-total"><td>Net Salary</td><td class="amount">${formatMoney(s.netSalary)}</td></tr>
      </table>
    </div>
    ${s.paymentMethod || s.referenceNo ? `
    <hr style="margin-top:12px"/>
    <div class="text-sm" style="margin-top:4px">
      ${s.paymentMethod ? `Payment Method: <strong>${s.paymentMethod}</strong>` : ''}
      ${s.referenceNo ? `  |  Reference: <strong>${s.referenceNo}</strong>` : ''}
    </div>` : ''}
    <div class="double-line" style="margin-top:24px;"></div>
    <div style="display:flex; justify-content:space-between; margin-top:40px">
      <div class="text-center text-xs" style="min-width:140px">
        <hr style="margin-bottom:4px"/>Authorized Signatory
      </div>
      <div class="text-center text-xs" style="min-width:140px">
        <hr style="margin-bottom:4px"/>Employee Signature
      </div>
    </div>
    <div class="text-center text-xs" style="margin-top:16px">This is a computer-generated salary slip.</div>`;

  printHtml(html, `Salary Slip — ${s.staff.name} ${s.month}`);
}

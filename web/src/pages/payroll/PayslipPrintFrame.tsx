import { useEffect, useRef } from 'react';
import { X, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';

interface Payslip {
  id: number; staff_id: number; staff_name: string; position: string; bank_account: string | null;
  total_earning: number; total_deduction: number; net_pay: number;
  overtime_hours: number; overtime_amount: number; leave_deduction: number; payable_days: number;
  breakdown_json: string | null; attendance_summary_json: string | null;
}

interface AttendanceSummary {
  present: number; late: number; absent: number; leave: number; half_day: number;
  payable_days: number; leave_deduction: number;
}

interface BreakdownComponent { head: string; type: 'earning' | 'deduction'; amount: number; }

interface Props { runId: number; staffId: number; payslip: Payslip | null; onClose: () => void; }

export default function PayslipPrintFrame({ runId, staffId, payslip, onClose }: Props) {
  const { t, i18n } = useTranslation(['hr', 'common']);
  const { fmtCurrency } = useFmt();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const breakdown: BreakdownComponent[] = (() => {
    if (!payslip?.breakdown_json) return [];
    try { return (JSON.parse(payslip.breakdown_json) as { components?: BreakdownComponent[] }).components ?? []; }
    catch { return []; }
  })();
  const attendance: AttendanceSummary | null = (() => {
    if (!payslip?.attendance_summary_json) return null;
    try { return JSON.parse(payslip.attendance_summary_json); } catch { return null; }
  })();

  useEffect(() => {
    // Auto-print after mount
    const id = setTimeout(() => iframeRef.current?.contentWindow?.print(), 300);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col print:hidden" data-run-id={runId} data-staff-id={staffId}>
      <div className="flex justify-end gap-2 p-3">
        <button onClick={() => iframeRef.current?.contentWindow?.print()} className="btn-secondary gap-2">
          <Printer className="w-4 h-4" /> {t('common:print')}
        </button>
        <button onClick={onClose} className="btn-secondary gap-2">
          <X className="w-4 h-4" /> {t('hr:payroll.print.close')}
        </button>
      </div>
      <iframe
        ref={iframeRef}
        title={t('hr:payroll.print.iframeTitle') as string}
        className="flex-1 w-full bg-white"
        srcDoc={buildPayslipHtml({ payslip, breakdown, attendance, lang: i18n.language, t: (k: string) => t(k) as string, fmtCurrency })}
      />
    </div>
  );
}

function buildPayslipHtml(args: {
  payslip: Payslip | null; breakdown: BreakdownComponent[]; attendance: AttendanceSummary | null;
  lang: string; t: (k: string) => string; fmtCurrency: (n: number) => string;
}): string {
  if (!args.payslip) return '<html><body><p>No payslip</p></body></html>';
  const p = args.payslip;
  const rows = args.breakdown.map((c) =>
    `<tr><td>${escape(c.head)}</td><td style="text-align:right">${args.fmtCurrency(c.amount)}</td></tr>`
  ).join('');
  return `<!doctype html><html lang="${args.lang}"><head><meta charset="utf-8"><title>Payslip</title>
<style>
  body { font-family: 'Figtree', system-ui, sans-serif; padding: 24px; color: #111; }
  h1 { margin: 0 0 4px 0; font-size: 22px; }
  h2 { font-size: 14px; margin: 16px 0 6px 0; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; font-size: 14px; }
  .right { text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .total { font-size: 18px; font-weight: 700; padding: 10px; background: #f4f4f5; border-radius: 6px; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style></head><body>
  <h1>${escape(args.t('hr:payroll.print.payslipFor').replace('{{month}}', String(p.id)))}</h1>
  <div class="grid">
    <div><b>${escape(args.t('hr:payroll.print.employee'))}:</b> ${escape(p.staff_name)}<br/>
      <b>${escape(args.t('hr:payroll.print.position'))}:</b> ${escape(p.position ?? '')}<br/>
      <b>${escape(args.t('hr:payroll.print.bank'))}:</b> ${escape(p.bank_account ?? '—')}</div>
  </div>
  <h2>${escape(args.t('hr:payroll.print.earnings'))}</h2>
  <table>${rows || `<tr><td colspan="2">—</td></tr>`}</table>
  <h2>${escape(args.t('hr:payroll.print.deductions'))}</h2>
  <table>${args.breakdown.filter((b) => b.type === 'deduction').map((c) =>
    `<tr><td>${escape(c.head)}</td><td style="text-align:right">${args.fmtCurrency(c.amount)}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}</table>
  ${args.attendance ? `<h2>${escape(args.t('hr:payroll.print.attendance'))}</h2>
  <table>
    <tr><td>${escape(args.t('hr:payroll.print.presentDays'))}</td><td class="right">${args.attendance.present}</td>
        <td>${escape(args.t('hr:payroll.print.absentDays'))}</td><td class="right">${args.attendance.absent}</td></tr>
    <tr><td>${escape(args.t('hr:payroll.print.leaveDays'))}</td><td class="right">${args.attendance.leave}</td>
        <td>${escape(args.t('hr:payroll.print.halfDays'))}</td><td class="right">${args.attendance.half_day}</td></tr>
    <tr><td>${escape(args.t('hr:payroll.print.lateDays'))}</td><td class="right">${args.attendance.late}</td>
        <td>${escape(args.t('hr:payroll.print.leaveDeduction'))}</td><td class="right">${args.fmtCurrency(args.attendance.leave_deduction)}</td></tr>
  </table>` : ''}
  ${p.overtime_hours > 0 ? `<h2>${escape(args.t('hr:payroll.print.overtimeHours'))}</h2>
  <table><tr><td>${escape(args.t('hr:payroll.print.overtimeHours'))}</td><td class="right">${p.overtime_hours}</td>
  <td>${escape(args.t('hr:payroll.print.overtimeAmount'))}</td><td class="right">${args.fmtCurrency(p.overtime_amount)}</td></tr></table>` : ''}
  <div class="total">${escape(args.t('hr:payroll.print.netPay'))}: ${args.fmtCurrency(p.net_pay)}</div>
</body></html>`;
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

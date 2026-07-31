import { formatDate, escapeHtml } from './printUtils';

export type RunningBillPaperSize = 'a5' | 'a4';

export interface RunningBillData {
  admission: { id: number; admission_no: string; admission_date: string; admission_type?: string | null; status?: string | null; provisional_diagnosis?: string | null };
  patient: { id: number; name: string; patient_code?: string | null; mobile?: string | null; address?: string | null; age?: string | null; gender?: string | null };
  doctor: { name?: string | null };
  bed: { ward_name?: string | null; bed_number?: string | null; bed_type?: string | null };
  items: Array<{ item_category?: string | null; item_name: string; department?: string | null; quantity: number; unit_price: number; discount_percent?: number | null; total_amount: number; created_at?: string | null }>;
  bed_charges: Array<{ ward_name?: string | null; bed_number?: string | null; bed_type?: string | null; rate_per_day: number; days: number; charge_amount: number; started_on?: string | null; ended_on?: string | null }>;
  payments?: Array<{ type?: string | null; description?: string | null; amount: number; payment_method?: string | null; receipt_no?: string | null; received_by_name?: string | null; created_at?: string | null }>;
  summary: { provisional_total: number; package_total?: number; bed_total: number; grand_total: number; deposit_balance: number; deposit_total?: number; deposit_used?: number; net_payable: number; current_balance?: number };
  hospital: { name?: string | null; tagline?: string | null; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; logo_url?: string | null; footer_text?: string | null };
  generated_at: string;
}

interface RunningBillHtmlOptions {
  paperSize?: RunningBillPaperSize;
  includeScreenActions?: boolean;
}

const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value: unknown) => `৳${n(value).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (value: unknown, fallback = '—') => {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text) : fallback;
};
const titleCase = (value: unknown) => String(value ?? 'service').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function chargeRows(data: RunningBillData): string {
  let sl = 1;
  const rows = (data.items ?? []).map((item) => `
    <tr>
      <td class="c">${sl++}</td>
      <td><b>${safe(item.item_name, 'Charge')}</b>${item.department || item.created_at ? `<small>${safe([item.department, item.created_at ? fmtDateTime(item.created_at) : ''].filter(Boolean).join(' • '))}</small>` : ''}</td>
      <td><span class="pill">${safe(titleCase(item.item_category))}</span></td>
      <td class="r">${n(item.quantity).toLocaleString('en-BD')}</td>
      <td class="r">${money(item.unit_price)}</td>
      <td class="r">${n(item.discount_percent).toLocaleString('en-BD')}%</td>
      <td class="r b">${money(item.total_amount)}</td>
    </tr>`);

  for (const bed of data.bed_charges ?? []) {
    const bedName = `${bed.ward_name || 'Ward'} — Bed ${bed.bed_number || '-'}${bed.bed_type ? ` (${bed.bed_type})` : ''}`;
    const period = [bed.started_on ? formatDate(String(bed.started_on).split('T')[0]) : '', bed.ended_on ? formatDate(String(bed.ended_on).split('T')[0]) : 'Running'].filter(Boolean).join(' to ');
    rows.push(`
      <tr class="bed-row">
        <td class="c">${sl++}</td>
        <td><b>${safe(bedName)}</b><small>${safe(period)}</small></td>
        <td><span class="pill amber">Bed</span></td>
        <td class="r">${n(bed.days).toLocaleString('en-BD')} days</td>
        <td class="r">${money(bed.rate_per_day)}/day</td>
        <td class="r">0%</td>
        <td class="r b">${money(bed.charge_amount)}</td>
      </tr>`);
  }

  return rows.join('') || '<tr><td colspan="7" class="empty">No running charges have been added yet.</td></tr>';
}

function paymentRows(payments?: RunningBillData['payments']): string {
  const rows = (payments ?? []).slice(0, 5).map((p) => `
    <tr>
      <td>${p.created_at ? formatDate(String(p.created_at).split('T')[0]) : '—'}</td>
      <td>${safe(p.payment_method || p.type)}</td>
      <td>${safe(p.received_by_name || p.description)}</td>
      <td class="r b">${money(p.amount)}</td>
    </tr>`);
  return rows.join('') || '<tr><td colspan="4" class="empty">No advance/payment history found.</td></tr>';
}

export function getRunningBillPreviewWidth(paperSize: RunningBillPaperSize = 'a5'): string {
  return paperSize === 'a4' ? '210mm' : '148mm';
}

export function buildRunningBillHtml(data: RunningBillData, options: RunningBillHtmlOptions = {}): string {
  const paperSize = options.paperSize ?? 'a5';
  const isA4 = paperSize === 'a4';
  const due = Math.max(0, n(data.summary.net_payable));
  const refund = Math.max(0, n(data.summary.current_balance));
  const count = (data.items?.length ?? 0) + (data.bed_charges?.length ?? 0);
  const wardBed = `${data.bed.ward_name || ''}${data.bed.bed_number ? ` / Bed ${data.bed.bed_number}` : ''}${data.bed.bed_type ? ` (${data.bed.bed_type})` : ''}`;
  const contact = [data.hospital.address, data.hospital.phone ? `Phone: ${data.hospital.phone}` : '', data.hospital.email, data.hospital.website].filter(Boolean).map((part) => safe(part)).join(' | ');
  const paperRule = isA4 ? 'A4 portrait' : 'A5 portrait';
  const width = isA4 ? '210mm' : '148mm';
  const height = isA4 ? '297mm' : '210mm';
  const pagePadding = isA4 ? '10mm' : '5.5mm';
  const printPadding = isA4 ? '9mm' : '4.5mm';
  const minInnerHeight = isA4 ? '277mm' : '198mm';
  const printInnerHeight = isA4 ? '279mm' : '201mm';
  const fontScaleClass = isA4 ? 'rb-a4' : 'rb-a5';

  return `
    <style>
      :root{--rb-primary:#0f766e;--rb-primary-dark:#115e59;--rb-muted:#64748b;--rb-border:#dbe7ef;--rb-warn:#fff7ed;--rb-danger:#dc2626}
      .rb-print-root,.rb-print-root *{box-sizing:border-box}.rb-print-root{color:#0f172a;font-family:Inter,"Noto Sans Bengali",Arial,sans-serif;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.rb-page{width:${width};min-height:${height};margin:0 auto;padding:${pagePadding};background:#fff;position:relative}.rb{position:relative;overflow:hidden;background:#fff;color:#0f172a;border:1px solid var(--rb-border);border-radius:10px;min-height:${minInnerHeight};display:flex;flex-direction:column}.wm{position:absolute;top:${isA4 ? '116mm' : '82mm'};left:50%;transform:translateX(-50%) rotate(-24deg);color:rgba(15,118,110,.055);font-size:${isA4 ? '76px' : '52px'};font-weight:900;letter-spacing:.08em;pointer-events:none;z-index:0}.rb>*:not(.wm){position:relative;z-index:1}
      .head{display:flex;justify-content:space-between;gap:${isA4 ? '16px' : '10px'};padding:${isA4 ? '14px 20px 12px' : '8px 10px 7px'};background:linear-gradient(135deg,var(--rb-primary),var(--rb-primary-dark));color:#fff}.brand{display:flex;align-items:center;gap:${isA4 ? '13px' : '9px'};min-width:0}.logo{display:grid;place-items:center;flex:0 0 auto;width:${isA4 ? '48px' : '34px'};height:${isA4 ? '48px' : '34px'};border-radius:50%;background:#fff;color:var(--rb-primary-dark);font-weight:900;font-size:${isA4 ? '16px' : '12px'}}.logo img{width:100%;height:100%;object-fit:contain;border-radius:50%}h1{margin:0;font-size:${isA4 ? '20px' : '16.5px'};line-height:1.1}.brand p{margin:2px 0 0;color:#d1fae5;font-size:${isA4 ? '11.5px' : '9.5px'};line-height:1.25}.badge{min-width:${isA4 ? '132px' : '96px'};align-self:flex-start;background:#fff;color:var(--rb-primary-dark);border-radius:${isA4 ? '10px' : '8px'};text-align:center;padding:${isA4 ? '9px 11px' : '6px 7px'}}.badge b{display:block;font-size:${isA4 ? '16.5px' : '11.5px'}}.badge span{display:block;margin-top:2px;color:var(--rb-danger);font-size:${isA4 ? '9px' : '7px'};font-weight:800}
      .meta{display:flex;justify-content:space-between;gap:8px;padding:${isA4 ? '10px 20px 0' : '6px 10px 0'};font-size:${isA4 ? '11.5px' : '9.8px'}}.grid{display:grid;grid-template-columns:1fr 1fr;gap:${isA4 ? '12px' : '7px'};padding:${isA4 ? '11px 20px 0' : '7px 10px 0'}}.card{border:1px solid var(--rb-border);border-radius:${isA4 ? '10px' : '8px'};background:#f8fafc;padding:${isA4 ? '11px' : '7px'};min-height:${isA4 ? '72px' : '46px'}}.card h3,.mini h3{margin:0 0 ${isA4 ? '8px' : '5px'};color:var(--rb-primary-dark);font-size:${isA4 ? '12.5px' : '10.5px'};text-transform:uppercase;letter-spacing:.03em}.row{display:grid;grid-template-columns:${isA4 ? '90px' : '62px'} 1fr;gap:${isA4 ? '7px' : '5px'};margin:${isA4 ? '5px' : '2.5px'} 0;font-size:${isA4 ? '11px' : '9.8px'};line-height:1.22}.row span{color:var(--rb-muted)}.row b{overflow-wrap:anywhere}.section{display:flex;justify-content:space-between;margin:${isA4 ? '13px 20px 0' : '8px 10px 0'};padding:${isA4 ? '9px 12px' : '5px 7px'};border-radius:${isA4 ? '9px' : '7px'};background:#ecfdf5;color:var(--rb-primary-dark);font-size:${isA4 ? '13.5px' : '11.2px'};font-weight:900}.section small{font-size:${isA4 ? '10px' : '8px'}}.wrap{padding:${isA4 ? '9px 20px 0' : '6px 10px 0'}}
      table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:${isA4 ? '10.5px' : '9.4px'};line-height:1.2}th{padding:${isA4 ? '7px 5px' : '5px 3px'};background:var(--rb-primary-dark);color:white;text-align:left;text-transform:uppercase;font-size:${isA4 ? '9.2px' : '8.3px'}}th:first-child{border-radius:5px 0 0 0;text-align:center}th:last-child{border-radius:0 5px 0 0;text-align:right}td{padding:${isA4 ? '6px 5px' : '4.6px 3px'};border-bottom:1px solid #e2e8f0;vertical-align:top;overflow-wrap:anywhere}td small{display:block;margin-top:1.5px;color:var(--rb-muted);font-size:${isA4 ? '8.6px' : '7.8px'}}.c{text-align:center}.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.b{font-weight:900}.pill{display:inline-block;max-width:100%;padding:${isA4 ? '2px 6px' : '1px 4px'};border-radius:999px;background:#dbeafe;color:#1e40af;font-size:${isA4 ? '8.4px' : '6.8px'};font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.amber{background:#fef3c7;color:#92400e}.bed-row{background:#fff7ed}.empty{text-align:center;color:var(--rb-muted);padding:8px!important}
      .settlement{margin-top:auto;break-inside:avoid;page-break-inside:avoid}.note{margin:${isA4 ? '10px 20px 0' : '7px 10px 0'};padding:${isA4 ? '8px 10px' : '5px 7px'};border:1px solid #fed7aa;border-radius:6px;background:var(--rb-warn);color:#92400e;font-size:${isA4 ? '10px' : '8px'}}.bottom{display:grid;grid-template-columns:1.22fr .78fr;gap:${isA4 ? '12px' : '7px'};padding:${isA4 ? '11px 20px 0' : '7px 10px 0'}}.mini{border:1px solid var(--rb-border);border-radius:${isA4 ? '10px' : '8px'};background:#f8fafc;padding:${isA4 ? '11px' : '7px'}}.pay th{background:#e2e8f0;color:#0f172a}.sum{display:flex;justify-content:space-between;gap:7px;padding:${isA4 ? '5px 0' : '2.8px 0'};border-bottom:1px dashed #e2e8f0;color:var(--rb-muted);font-size:${isA4 ? '11px' : '8.8px'}}.sum b{color:#0f172a}.due{margin-top:4px;padding-top:${isA4 ? '8px' : '5px'};border-top:2px solid #cbd5e1;border-bottom:0;color:#0f172a;font-size:${isA4 ? '13.5px' : '10.2px'};font-weight:900}.due b{color:var(--rb-danger);font-size:${isA4 ? '15.5px' : '11.5px'}}.status{margin-top:5px;padding:${isA4 ? '7px' : '4.5px'};border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:var(--rb-danger);font-size:${isA4 ? '10px' : '8px'};font-weight:900;text-align:center}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:${isA4 ? '24px' : '16px'};margin:${isA4 ? '16px 20px 0' : '10px 10px 0'} 0 0;padding:${isA4 ? '18px 0 0' : '12px 0 0'};font-size:${isA4 ? '10px' : '8px'};break-inside:avoid;page-break-inside:avoid}.sign div{border-top:1px solid #cbd5e1;padding-top:4px;text-align:center;font-weight:800}.foot{display:flex;justify-content:space-between;gap:8px;margin:${isA4 ? '15px 20px 0' : '9px 10px 0'};padding:${isA4 ? '9px 0 12px' : '6px 0 7px'};border-top:1px solid #e2e8f0;color:var(--rb-muted);font-size:${isA4 ? '9px' : '7.3px'}}
      @page{size:${paperRule};margin:0}.rb-print-actions{display:none}@media screen{.rb-print-actions{display:${options.includeScreenActions ? 'flex' : 'none'};position:sticky;top:0;z-index:50;justify-content:center;gap:8px;padding:9px;background:#0f172a}.rb-print-actions button{border:0;border-radius:8px;padding:8px 13px;font-weight:700;cursor:pointer}.rb-print-actions .primary{background:#2563eb;color:white}.rb-print-actions .secondary{background:white;color:#334155}.rb-page{margin:16px auto;box-shadow:0 18px 45px rgba(15,23,42,.16)}}
      @media print{body *{visibility:hidden!important}.rb-print-root,.rb-print-root *{visibility:visible!important}.rb-print-root{position:absolute!important;inset:0 auto auto 0!important;width:${width}!important;background:white!important}.rb-print-actions{display:none!important}.rb-page{width:${width};min-height:${height};margin:0!important;padding:${printPadding}!important;box-shadow:none!important}.rb{border:0;border-radius:0;min-height:${printInnerHeight}}.head,.section,th,.pill,.note,.status{print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}}
    </style>
    <div class="rb-print-root ${fontScaleClass}">
      <div class="rb-print-actions"><button class="primary" onclick="window.print()">Print / Save PDF</button><button class="secondary" onclick="history.length > 1 ? history.back() : window.close()">Go Back</button></div>
      <main class="rb-page"><div class="rb"><div class="wm">RUNNING</div>
        <div class="head"><div class="brand"><div class="logo">${data.hospital.logo_url ? `<img src="${safe(data.hospital.logo_url)}" alt="Logo"/>` : 'H+'}</div><div><h1>${safe(data.hospital.name,'Hospital Management System')}</h1>${data.hospital.tagline ? `<p>${safe(data.hospital.tagline)}</p>` : ''}${contact ? `<p>${contact}</p>` : ''}</div></div><div class="badge"><b>RUNNING BILL</b></div></div>
        <div class="meta"><div>Bill No: <b>${safe(`RB-${data.admission.admission_no || data.admission.id}`)}</b></div><div>Print Date: <b>${fmtDateTime(data.generated_at)}</b></div></div>
        <div class="grid"><div class="card"><h3>Patient Information</h3><div class="row"><span>Patient Name</span><b>${safe(data.patient.name)}</b></div><div class="row"><span>Patient ID</span><b>${safe(data.patient.patient_code)}</b></div><div class="row"><span>Age / Gender</span><b>${safe([data.patient.age,data.patient.gender].filter(Boolean).join(' / '))}</b></div><div class="row"><span>Mobile</span><b>${safe(data.patient.mobile)}</b></div>${data.patient.address ? `<div class="row"><span>Address</span><b>${safe(data.patient.address)}</b></div>` : ''}</div><div class="card"><h3>Admission Information</h3><div class="row"><span>Admission ID</span><b>${safe(data.admission.admission_no || data.admission.id)}</b></div><div class="row"><span>Ward / Bed</span><b>${safe(wardBed)}</b></div><div class="row"><span>Admitted On</span><b>${fmtDateTime(data.admission.admission_date)}</b></div><div class="row"><span>Consultant</span><b>${safe(data.doctor.name)}</b></div>${data.admission.provisional_diagnosis ? `<div class="row"><span>Diagnosis</span><b>${safe(data.admission.provisional_diagnosis)}</b></div>` : ''}</div></div>
        <div class="section"><span>IPD Running Charge Summary</span><small>${count.toLocaleString('en-BD')} charge item${count === 1 ? '' : 's'}</small></div>
        <div class="wrap"><table><thead><tr><th style="width:${isA4 ? '32px' : '24px'}">SL</th><th>Charge Head / Details</th><th style="width:${isA4 ? '70px' : '50px'}">Category</th><th class="r" style="width:${isA4 ? '58px' : '44px'}">Qty</th><th class="r" style="width:${isA4 ? '78px' : '58px'}">Rate</th><th class="r" style="width:${isA4 ? '44px' : '34px'}">Disc</th><th class="r" style="width:${isA4 ? '88px' : '66px'}">Amount</th></tr></thead><tbody>${chargeRows(data)}</tbody></table></div>
        <div class="note"><b>Note:</b> This is a running bill. Final payable amount may change after discharge, return, approval or adjustment.</div>
        <div class="settlement">
          <div class="bottom"><div class="mini"><h3>Deposit / Advance History</h3><table class="pay"><thead><tr><th>Date</th><th>Method</th><th>Recorded By</th><th class="r">Amount</th></tr></thead><tbody>${paymentRows(data.payments)}</tbody></table><div class="status">Approval Status: Pending final review</div></div><div class="mini"><h3>Bill Summary</h3><div class="sum"><span>Provisional Total</span><b>${money(data.summary.provisional_total)}</b></div>${n(data.summary.package_total) > 0 ? `<div class="sum"><span>Package Charges</span><b>${money(data.summary.package_total)}</b></div>` : ''}<div class="sum"><span>Bed Charges</span><b>${money(data.summary.bed_total)}</b></div><div class="sum"><span>Grand Total</span><b>${money(data.summary.grand_total)}</b></div><div class="sum"><span>Advance / Deposit Balance</span><b>${money(data.summary.deposit_balance)}</b></div>${refund > 0 ? `<div class="sum"><span>Refund Available</span><b>${money(refund)}</b></div>` : ''}<div class="sum due"><span>Current Due</span><b>${money(due)}</b></div></div></div>
          <div class="sign"><div>Prepared By</div><div>Checked By</div><div>Accounts / Cash</div></div>
        </div>
        <div class="foot"><span>${safe(data.hospital.footer_text,'Printed from HMS IP Billing Module • Running bill, not a final invoice')}</span><span>Admission: ${safe(data.admission.admission_no)} | Status: ${safe(data.admission.status)}</span></div>
        </div>
      </div></main>
    </div>`;
}

export function printRunningBill(data: RunningBillData, paperSize: RunningBillPaperSize = 'a5'): void {
  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) {
    window.print();
    return;
  }
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${safe(`Running Bill - ${data.patient.name || data.admission.admission_no}`)}</title></head><body>${buildRunningBillHtml(data, { paperSize, includeScreenActions: false })}</body></html>`);
  win.document.close();
  const startPrint = () => {
    const images = Array.from(win.document.images);
    Promise.all(images.map((image) => image.decode?.().catch(() => undefined))).finally(() => {
      win.focus();
      win.print();
    });
  };
  if (win.document.readyState === 'complete') startPrint();
  else win.addEventListener('load', startPrint, { once: true });
}

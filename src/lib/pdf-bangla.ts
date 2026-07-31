/**
 * Bangla (Bengali) PDF-ready HTML template generator for HMS.
 *
 * Strategy: Generate HTML with embedded Bangla font (Noto Sans Bengali from Google Fonts)
 * and a print-only CSS. The browser renders and prints as PDF via window.print().
 * The Worker exposes GET endpoints that return text/html — the frontend opens these
 * in a new tab and the user presses Ctrl+P (or the frontend triggers window.print()).
 *
 * Why not a server-side PDF lib?
 * - PDFKit / jsPDF / puppeteer all require Node APIs not available on Workers.
 * - HTML print is the fastest, most Bangla-friendly approach.
 * - Fonts load from CDN — no R2 storage required.
 */

export interface InvoiceData {
  invoiceNo: string;
  date: string;
  patientName: string;
  patientMobile?: string;
  patientCode?: string;
  hospitalName: string;
  hospitalAddress?: string;
  hospitalPhone?: string;
  items: Array<{
    description: string;        // English or Bangla
    descriptionBn?: string;     // Bangla label (optional)
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  discount?: number;
  discountByName?: string | null;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  notes?: string;
}

export interface PatientCardData {
  patientCode: string;
  name: string;
  nameBn?: string;            // Bangla name (optional)
  dateOfBirth?: string;
  gender?: string;
  mobile: string;
  address?: string;
  bloodGroup?: string;
  registrationDate: string;
  hospitalName: string;
  emergencyContact?: string;
}

// ─── XSS protection: escape user-controlled strings before HTML interpolation ─
function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Common HTML boilerplate ───────────────────────────────────────────────────
function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', 'Noto Sans Bengali', sans-serif;
      font-size: 13px;
      color: #111;
      background: #fff;
      padding: 24px;
    }

    .bn { font-family: 'Noto Sans Bengali', sans-serif; }

    /* Print styles */
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      @page { margin: 15mm; size: A4; }
    }

    /* Print button */
    .print-btn {
      position: fixed;
      top: 16px;
      right: 16px;
      background: #0f766e;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      z-index: 999;
    }
    @media print { .print-btn { display: none; } }

    /* Layout helpers */
    .flex { display: flex; }
    .between { justify-content: space-between; }
    .col { flex-direction: column; }
    .gap-4 { gap: 4px; }
    .gap-8 { gap: 8px; }
    .mt-4 { margin-top: 4px; }
    .mt-8 { margin-top: 8px; }
    .mt-16 { margin-top: 16px; }
    .mt-24 { margin-top: 24px; }
    .bold { font-weight: 700; }
    .semibold { font-weight: 600; }
    .small { font-size: 11px; }
    .muted { color: #6b7280; }
    .right { text-align: right; }
    .center { text-align: center; }
    .teal { color: #0f766e; }
    .red { color: #dc2626; }
    .green { color: #16a34a; }
    .border-top { border-top: 1px solid #e5e7eb; padding-top: 8px; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save PDF</button>
  ${body}
  <script>
    // Auto-prompt print after fonts load
    document.fonts.ready.then(() => {
      if (new URLSearchParams(location.search).get('autoprint') === '1') {
        setTimeout(() => window.print(), 800);
      }
    });
  </script>
</body>
</html>`;
}

// ─── Invoice / Bill HTML ──────────────────────────────────────────────────────
export function renderInvoiceHtml(data: InvoiceData): string {
  const itemRows = data.items.map(item => `
    <tr>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;">
        <div>${escapeHtml(item.description)}</div>
        ${item.descriptionBn ? `<div class="bn small muted">${escapeHtml(item.descriptionBn)}</div>` : ''}
      </td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:center;">${item.quantity}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:right;">৳${item.unitPrice.toLocaleString()}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #f3f4f6;text-align:right;">৳${item.total.toLocaleString()}</td>
    </tr>`).join('');

  const body = `
    <!-- Header -->
    <div class="flex between" style="border-bottom:2px solid #0f766e;padding-bottom:16px;margin-bottom:16px;">
      <div class="flex col gap-4">
        <div class="bold" style="font-size:20px;color:#0f766e;">${escapeHtml(data.hospitalName)}</div>
        ${data.hospitalAddress ? `<div class="small muted">${escapeHtml(data.hospitalAddress)}</div>` : ''}
        ${data.hospitalPhone ? `<div class="small muted">📞 ${escapeHtml(data.hospitalPhone)}</div>` : ''}
      </div>
      <div class="flex col gap-4 right">
         <div class="small muted">#${escapeHtml(data.invoiceNo)}</div>
        <div class="small muted">তারিখ: ${escapeHtml(data.date)}</div>
      </div>
    </div>

    <!-- Patient Info -->
    <div class="flex between mt-8" style="background:#f9fafb;border-radius:6px;padding:12px 16px;">
      <div class="flex col gap-4">
        <div class="small muted">রোগীর নাম / Patient</div>
        <div class="semibold">${escapeHtml(data.patientName)}</div>
        ${data.patientCode ? `<div class="small muted">ID: ${escapeHtml(data.patientCode)}</div>` : ''}
      </div>
      ${data.patientMobile ? `
      <div class="flex col gap-4 right">
        <div class="small muted">মোবাইল / Mobile</div>
        <div class="semibold">${escapeHtml(data.patientMobile)}</div>
      </div>` : ''}
    </div>

    <!-- Items Table -->
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <thead>
        <tr style="background:#0f766e;color:white;">
          <th style="padding:8px;text-align:left;">বিবরণ / Description</th>
          <th style="padding:8px;text-align:center;">পরিমাণ</th>
          <th style="padding:8px;text-align:right;">একক মূল্য</th>
          <th style="padding:8px;text-align:right;">মোট</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <!-- Totals -->
    <div class="flex" style="justify-content:flex-end;margin-top:12px;">
      <div style="min-width:240px;">
        <div class="flex between" style="padding:6px 0;border-bottom:1px solid #e5e7eb;">
          <span class="muted">উপমোট / Subtotal</span>
          <span>৳${data.subtotal.toLocaleString()}</span>
        </div>
        ${data.discount ? `
        <div class="flex between" style="padding:6px 0;border-bottom:1px solid #e5e7eb;">
          <span class="muted">ছাড় / Discount</span>
          <span class="green">-৳${data.discount.toLocaleString()}</span>
        </div>` : ''}
        <div class="flex between bold" style="padding:10px 0;border-bottom:2px solid #0f766e;font-size:15px;">
          <span>মোট / Total</span>
          <span class="teal">৳${data.totalAmount.toLocaleString()}</span>
        </div>
        <div class="flex between" style="padding:6px 0;">
          <span class="muted">পরিশোধিত / Paid</span>
          <span class="green">৳${data.paidAmount.toLocaleString()}</span>
        </div>
        <div class="flex between bold" style="padding:8px 0;${data.dueAmount > 0 ? 'color:#dc2626;' : 'color:#16a34a;'}">
          <span>বাকি / Due</span>
          <span>৳${data.dueAmount.toLocaleString()}</span>
        </div>
      </div>
    </div>

    ${data.notes ? `
    <div style="margin-top:24px;background:#fef9c3;border-radius:6px;padding:12px;">
      <div class="small semibold" style="margin-bottom:4px;">নোট / Notes</div>
      <div class="small">${escapeHtml(data.notes)}</div>
    </div>` : ''}

    <!-- Footer -->
    <div class="center muted small" style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">
      <span class="bn">ধন্যবাদ আপনার সুস্বাস্থ্য আমাদের লক্ষ্য।</span><br>
      Thank you for choosing ${escapeHtml(data.hospitalName)}. Stay healthy!
    </div>
  `;

  return htmlShell(`Invoice #${escapeHtml(data.invoiceNo)} — ${escapeHtml(data.hospitalName)}`, body);
}

// ─── Patient ID Card HTML ─────────────────────────────────────────────────────
export function renderPatientCardHtml(data: PatientCardData): string {
  const body = `
    <div style="max-width:380px;margin:0 auto;border:2px solid #0f766e;border-radius:12px;overflow:hidden;">
      <!-- Card Header -->
      <div style="background:#0f766e;color:white;padding:16px 20px;">
        <div class="bold" style="font-size:16px;">${escapeHtml(data.hospitalName)}</div>
        <div class="small" style="opacity:0.85;margin-top:2px;">রোগী পরিচয়পত্র / Patient ID Card</div>
      </div>

      <!-- Card Body -->
      <div style="padding:16px 20px;background:#fff;">
        <div class="flex between" style="margin-bottom:12px;">
          <div>
            <div class="bold" style="font-size:17px;">${escapeHtml(data.name)}</div>
            ${data.nameBn ? `<div class="bn bold" style="font-size:16px;color:#0f766e;">${escapeHtml(data.nameBn)}</div>` : ''}
          </div>
          <div class="right">
            <div class="small muted">Patient ID</div>
            <div class="bold semibold" style="font-size:16px;color:#0f766e;">${escapeHtml(data.patientCode)}</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
          ${data.dateOfBirth ? `
          <div>
            <div class="muted">জন্ম তারিখ / DOB</div>
            <div class="semibold">${escapeHtml(data.dateOfBirth)}</div>
          </div>` : ''}
          ${data.gender ? `
          <div>
            <div class="muted">লিঙ্গ / Gender</div>
            <div class="semibold">${data.gender === 'Male' ? 'পুরুষ / Male' : data.gender === 'Female' ? 'মহিলা / Female' : escapeHtml(data.gender)}</div>
          </div>` : ''}
          ${data.bloodGroup ? `
          <div>
            <div class="muted">রক্তের গ্রুপ / Blood</div>
            <div class="bold red">${escapeHtml(data.bloodGroup)}</div>
          </div>` : ''}
          <div>
            <div class="muted">মোবাইল / Mobile</div>
            <div class="semibold">${escapeHtml(data.mobile)}</div>
          </div>
          ${data.emergencyContact ? `
          <div style="grid-column:1/-1;">
            <div class="muted">জরুরি যোগাযোগ / Emergency</div>
            <div class="semibold">${escapeHtml(data.emergencyContact)}</div>
          </div>` : ''}
          ${data.address ? `
          <div style="grid-column:1/-1;">
            <div class="muted">ঠিকানা / Address</div>
            <div class="semibold">${escapeHtml(data.address)}</div>
          </div>` : ''}
        </div>

        <div class="small muted border-top" style="margin-top:12px;text-align:center;">
          নিবন্ধন তারিখ / Registered: ${data.registrationDate}
        </div>
      </div>
    </div>
  `;

  return htmlShell(`Patient Card — ${escapeHtml(data.patientCode)}`, body);
}

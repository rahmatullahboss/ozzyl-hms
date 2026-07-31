export interface PrintableHealthCardInput {
  name: string;
  patientCode?: string | null;
  uhid?: string | null;
  age?: number | null;
  gender?: string | null;
  mobile?: string | null;
  address?: string | null;
  bloodGroup?: string | null;
  guardianMobile?: string | null;
  qrSvg?: string | null;
  issuedAt?: Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return escapeHtml(String(value));
}

function formatIssuedDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function buildPrintableHealthCardHtml(input: PrintableHealthCardInput): string {
  const issuedAt = input.issuedAt ?? new Date();
  const ageGender = [
    input.age ? `${input.age} yrs` : null,
    input.gender ?? null,
  ].filter(Boolean).join(' / ') || '-';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Health Card - ${display(input.name)}</title>
<style>
@page{size:86mm 54mm;margin:0}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;width:86mm;min-height:54mm;background:#ffffff;color:#111827;font-family:Inter,Arial,sans-serif;overflow:visible}
body{display:flex;align-items:center;justify-content:center;padding:1mm}
.card{width:84mm;min-height:52mm;border:1mm solid #1746a2;border-radius:4mm;background:#fff;overflow:visible;padding:2.5mm 3mm;display:flex;flex-direction:column;gap:1.5mm}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:2mm;border-bottom:0.3mm solid #dbeafe;padding-bottom:1.2mm}
.brand{min-width:0;flex:1}
.eyebrow{font-size:5pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#1746a2}
.title{font-size:11pt;line-height:1.05;font-weight:900;color:#111827;letter-spacing:.01em;margin-top:.5mm;overflow:visible;word-break:break-word}
.subtitle{font-size:4.5pt;color:#64748b;margin-top:.4mm}
.issued{font-size:4.5pt;color:#475569;text-align:right;white-space:nowrap}
.main{display:grid;grid-template-columns:1fr 14mm;gap:2mm;align-items:stretch;min-height:15mm}
.identity{min-width:0;display:flex;flex-direction:column;gap:1.2mm;justify-content:center}
.label{font-size:4.2pt;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748b;margin-bottom:.3mm}
.value{font-size:6.5pt;line-height:1.1;font-weight:800;color:#111827;overflow:visible;word-break:break-word}
.line{display:grid;grid-template-columns:1.2fr 1fr;gap:1.5mm}
.muted{font-size:5.5pt;line-height:1.1;color:#334155;overflow:visible;word-break:break-word}
.blood{border:.4mm solid #ef4444;border-radius:2.5mm;background:#fff5f5;display:flex;flex-direction:column;align-items:center;justify-content:center;height:14mm;padding:.8mm;text-align:center;align-self:center}
.blood-value{font-size:13pt;line-height:.9;font-weight:900;color:#dc2626}
.blood-label{font-size:4.2pt;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#991b1b;margin-top:.8mm}
.ids{display:grid;grid-template-columns:1fr 1fr;gap:1.2mm;margin-top:auto}
.id-box{border:.3mm solid #cbd5e1;border-radius:1.8mm;padding:1mm 1.2mm;background:#f8fafc;min-width:0}
.id-label{font-size:4.2pt;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#475569;margin-bottom:.3mm}
.id-value{font-size:6.2pt;font-weight:900;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:visible;word-break:break-word}
.footer{border-top:.3mm solid #dbeafe;padding-top:1mm;display:grid;grid-template-columns:1fr 11mm;align-items:center;gap:1.2mm;margin-top:auto}
.hint{font-size:4.2pt;line-height:1.1;color:#475569;min-width:0}
.qr{width:11mm;height:11mm;border:.3mm solid #cbd5e1;border-radius:1mm;padding:.4mm;background:#fff;display:flex;align-items:center;justify-content:center}
.qr svg{width:100%;height:100%;display:block}
.qr-fallback{font-size:4.2pt;font-weight:900;color:#1746a2;text-align:center}
@media print{html,body{background:#fff}.card{box-shadow:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<section class="card" aria-label="Patient health card">
  <header class="top">
    <div class="brand">
      <div class="eyebrow">Patient Health Card</div>
      <div class="title">${display(input.name)}</div>
      <div class="subtitle">Hospital Management System</div>
    </div>
    <div class="issued">Issued<br><strong>${escapeHtml(formatIssuedDate(issuedAt))}</strong></div>
  </header>

  <main class="main">
    <div class="identity">
      <div>
        <div class="label">Age / Gender</div>
        <div class="value">${display(ageGender)}</div>
      </div>
      <div class="line">
        <div>
          <div class="label">Mobile</div>
          <div class="value">${display(input.mobile)}</div>
        </div>
        <div>
          <div class="label">Emergency</div>
          <div class="value">${display(input.guardianMobile)}</div>
        </div>
      </div>
      <div>
        <div class="label">Address</div>
        <div class="muted">${display(input.address)}</div>
      </div>
    </div>
    <aside class="blood">
      <div class="blood-value">${display(input.bloodGroup)}</div>
      <div class="blood-label">Blood</div>
    </aside>
  </main>

  <section class="ids">
    <div class="id-box">
      <div class="id-label">Global ID</div>
      <div class="id-value">${display(input.uhid)}</div>
    </div>
    <div class="id-box">
      <div class="id-label">Hospital MRN</div>
      <div class="id-value">${display(input.patientCode)}</div>
    </div>
  </section>

  <footer class="footer">
    <div class="hint">Global ID is the patient portal identity. Hospital MRN is tenant-specific.</div>
    <div class="qr" aria-label="Patient card QR code">${input.qrSvg || '<span class="qr-fallback">OZZYL</span>'}</div>
  </footer>
</section>
</body>
</html>`;
}

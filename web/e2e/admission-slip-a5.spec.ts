import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const admissionSlipSource = readFileSync(resolve(__dirname, '../src/pages/AdmissionSlipPrint.tsx'), 'utf8');

function extractA5AdmissionSlipStyles() {
  const match = admissionSlipSource.match(
    /function getAdmissionSlipStyles\(pageRule: string, margin: string\): string \{\s*return `([\s\S]*?)`;\s*\}/,
  );
  expect(match, 'Admission slip styles should be extractable for print regression testing').not.toBeNull();
  return match![1]
    .replaceAll('${pageRule}', 'A5 portrait')
    .replaceAll('${margin}', '0');
}

async function countPdfPages(pdf: Buffer) {
  const document = await getDocument({ data: new Uint8Array(pdf), disableWorker: true }).promise;
  return document.numPages;
}

function detail(label: string, value: string, wide = false) {
  return `<div class="admission-detail${wide ? ' admission-detail-wide' : ''}"><span>${label}</span><strong>${value}</strong></div>`;
}

test('A5 admission slip keeps all sections on one printable page', async ({ page }) => {
  const styles = extractA5AdmissionSlipStyles();
  await page.emulateMedia({ media: 'print' });
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body { margin: 0; padding: 0; background: white; }
          ${styles}
        </style>
      </head>
      <body>
        <article class="admission-slip-sheet invoice-paper-a5" data-testid="sheet">
          <header class="invoice-brand-header">
            <div class="invoice-brand-identity">
              <div class="invoice-brand-logo"></div>
              <div>
                <h1>City Care General Hospital &amp; Diagnostic Center</h1>
                <p class="invoice-brand-tagline">Complete healthcare under one roof</p>
                <p class="invoice-brand-contact">456 Billing Avenue, Barguna · 01801717508</p>
              </div>
            </div>
            <div class="invoice-identity">
              <h2 class="invoice-title">ADMISSION SLIP</h2>
              <div class="invoice-number-pill">ADM-20260727-13099</div>
              <div class="invoice-header-meta"><div><span>Admission Date</span><strong>27 Jul 2026, 05:58 AM</strong></div></div>
            </div>
          </header>
          <div class="invoice-type-ribbon">Inpatient Admission</div>

          <div class="admission-slip-body">
            <div class="admission-highlight">
              <div><span>Patient</span><strong>Md. Shakil Ahmed</strong></div>
              <div><span>Patient ID</span><strong>PT-00013099</strong></div>
              <div><span>Ward / Cabin</span><strong>E2E Ward</strong></div>
              <div><span>Bed No.</span><strong>B-1773663109166 (general)</strong></div>
            </div>

            <section class="admission-section">
              <h2 class="admission-section-title">Patient Information</h2>
              <div class="admission-details-grid">
                ${detail('Mobile', '01801717508')}
                ${detail('Gender', 'female')}
                ${detail('Age', '35 years')}
                ${detail('Date of Birth', '27 Jul 1991')}
                ${detail('Blood Group', 'B+')}
                ${detail('Address', '456 Billing Avenue, Barguna Sadar, Barguna', true)}
              </div>
            </section>

            <section class="admission-section">
              <h2 class="admission-section-title">Admission Details</h2>
              <div class="admission-details-grid">
                ${detail('Admission Date & Time', '27 Jul 2026, 05:58 AM')}
                ${detail('Admission Type', 'planned')}
                ${detail('Admit Source', 'walk in')}
                ${detail('Emergency', 'No')}
                ${detail('Department', 'General Medicine')}
                ${detail('Ward / Cabin', 'E2E Ward')}
                ${detail('Bed', 'B-1773663109166 (general)')}
                ${detail('Attending Doctor', 'Dr. Aminul Islam — General Medicine')}
                ${detail('Referral Doctor', 'Dr. Referral Doctor')}
                ${detail('Admission Reason', 'Fever, weakness and observation', true)}
                ${detail('Provisional Diagnosis', 'Acute febrile illness under evaluation', true)}
              </div>
            </section>

            <section class="admission-section" data-testid="guardian-section">
              <h2 class="admission-section-title">Guardian / Care-of Person</h2>
              <div class="admission-details-grid">
                ${detail('Name', 'Md. Rahim Uddin')}
                ${detail('Relation', 'Father')}
                ${detail('Phone', '01700000000')}
              </div>
            </section>

            <div class="admission-signatures">
              <div class="admission-signature">Patient / Guardian Signature</div>
              <div class="admission-signature">Reception User · Admitting Officer</div>
              <div class="admission-signature">Authorized Signature</div>
            </div>
          </div>

          <footer class="invoice-footer" data-testid="footer">
            <div class="invoice-footer-grid">
              <div><span>Hotline</span><strong>01801717508</strong></div>
              <div><span>Address</span><strong>456 Billing Avenue, Barguna</strong></div>
              <div><span>Website</span><strong>citycare.example</strong></div>
              <div><span>Email</span><strong>care@citycare.example</strong></div>
              <div><span>Registration</span><strong>REG-2026-013099</strong></div>
              <div><span>BIN / TIN</span><strong>123456789</strong></div>
            </div>
            <p class="invoice-footer-message">Please preserve this admission slip for hospital services.</p>
            <div class="invoice-thank-you"><strong>Thank you for choosing City Care General Hospital</strong><span>Complete healthcare under one roof</span></div>
          </footer>
        </article>
      </body>
    </html>
  `);

  const metrics = await page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>('[data-testid="sheet"]')!;
    const footer = document.querySelector<HTMLElement>('[data-testid="footer"]')!;
    const signatures = document.querySelector<HTMLElement>('.admission-signatures')!;
    const detailLabel = document.querySelector<HTMLElement>('.admission-detail span')!;
    const detailValue = document.querySelector<HTMLElement>('.admission-detail strong')!;
    return {
      sheetHeight: sheet.getBoundingClientRect().height,
      scrollHeight: sheet.scrollHeight,
      clientHeight: sheet.clientHeight,
      signaturesBottom: signatures.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      footerBottom: footer.getBoundingClientRect().bottom,
      sheetBottom: sheet.getBoundingClientRect().bottom,
      labelFontSize: Number.parseFloat(getComputedStyle(detailLabel).fontSize),
      valueFontSize: Number.parseFloat(getComputedStyle(detailValue).fontSize),
    };
  });
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 2);
  expect(metrics.signaturesBottom).toBeLessThanOrEqual(metrics.footerTop);
  expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.sheetBottom + 2);
  expect(metrics.labelFontSize).toBeGreaterThanOrEqual(8.5);
  expect(metrics.valueFontSize).toBeGreaterThanOrEqual(10);

  const pdf = await page.pdf({
    format: 'A5',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await expect(countPdfPages(pdf)).resolves.toBe(1);

  const noGuardianMetrics = await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-testid="guardian-section"]')?.remove();
    const sheet = document.querySelector<HTMLElement>('[data-testid="sheet"]')!;
    const footer = document.querySelector<HTMLElement>('[data-testid="footer"]')!;
    const signatures = document.querySelector<HTMLElement>('.admission-signatures')!;
    return {
      scrollHeight: sheet.scrollHeight,
      clientHeight: sheet.clientHeight,
      signatureFooterGap: footer.getBoundingClientRect().top - signatures.getBoundingClientRect().bottom,
    };
  });
  expect(noGuardianMetrics.scrollHeight).toBeLessThanOrEqual(noGuardianMetrics.clientHeight + 2);
  expect(noGuardianMetrics.signatureFooterGap).toBeGreaterThanOrEqual(0);
  expect(noGuardianMetrics.signatureFooterGap).toBeLessThanOrEqual(18);

  const noGuardianPdf = await page.pdf({
    format: 'A5',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await expect(countPdfPages(noGuardianPdf)).resolves.toBe(1);
});

# Category-Aware A5/A4 Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build polished tenant-branded doctor consultation and diagnostic test invoice layouts with remembered A5/A4 portrait selection.

**Architecture:** Keep `/api/billing/:id` and `/api/settings` as the data sources. Add pure helpers for category classification and paper preference, extend the billing response with appointment/doctor display fields, and split the print UI into focused invoice sections while preserving the generic fallback.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, lucide-react, Vitest, Hono, Cloudflare D1.

---

## File Structure

**Create**

- `web/src/lib/print/invoicePaper.ts` — paper-size type, storage parsing, and CSS page metrics.
- `web/src/lib/print/invoicePaper.test.ts` — paper preference tests.
- `web/src/components/invoice/InvoiceBrandHeader.tsx` — shared tenant branding and invoice identity.
- `web/src/components/invoice/InvoiceTotalsPayment.tsx` — shared totals, payment, and status panels.
- `web/src/components/invoice/ConsultationInvoiceBody.tsx` — appointment-focused patient/details/table body.
- `web/src/components/invoice/DiagnosticInvoiceBody.tsx` — test-focused metadata/table body.
- `web/src/components/invoice/InvoiceFooter.tsx` — conditional hospital contact and footer information.
- `web/src/components/invoice/types.ts` — shared print-only data contracts.

**Modify**

- `web/src/lib/print/invoiceCategory.ts` — expose category-aware layout selection.
- `web/src/lib/print/invoiceCategory.test.ts` — cover consultation, diagnostic, and generic classification.
- `src/routes/tenant/billing.ts` — return appointment and doctor display fields.
- `test/billing-invoice-print.test.ts` — verify the extended billing response contract.
- `web/src/pages/BillPrint.tsx` — compose category layouts and A5/A4 print behavior.
- `web/src/pages/BillPrint.test.ts` — cover layout composition, settings fields, and paper controls.

## Task 1: Add invoice layout classification

**Files:**

- Modify: `web/src/lib/print/invoiceCategory.ts`
- Test: `web/src/lib/print/invoiceCategory.test.ts`

- [ ] **Step 1: Write failing layout-key tests**

Add imports and assertions:

```ts
import { getInvoiceBannerLabel, getInvoiceLayout } from './invoiceCategory';

describe('getInvoiceLayout', () => {
  it('selects consultation for doctor-only categories', () => {
    expect(getInvoiceLayout([
      { item_category: 'doctor_visit' },
      { item_category: 'consultation' },
    ])).toBe('consultation');
  });

  it('selects diagnostic for lab and radiology categories', () => {
    expect(getInvoiceLayout([
      { item_category: 'test' },
      { item_category: 'radiology' },
    ])).toBe('diagnostic');
  });

  it('selects generic for mixed consultation and diagnostic items', () => {
    expect(getInvoiceLayout([
      { item_category: 'doctor_visit' },
      { item_category: 'test' },
    ])).toBe('generic');
  });

  it('selects generic for empty or unsupported categories', () => {
    expect(getInvoiceLayout([])).toBe('generic');
    expect(getInvoiceLayout([{ item_category: 'medicine' }])).toBe('generic');
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm --dir web exec vitest run src/lib/print/invoiceCategory.test.ts
```

Expected: FAIL because `getInvoiceLayout` is not exported.

- [ ] **Step 3: Implement the minimal classifier**

Add:

```ts
export type InvoiceLayout = 'consultation' | 'diagnostic' | 'generic';

const CONSULTATION_CATEGORIES = new Set(['doctor_visit', 'consultation', 'opd', 'visit']);
const DIAGNOSTIC_CATEGORIES = new Set(['test', 'lab', 'laboratory', 'radiology', 'scan', 'imaging']);

export function getInvoiceLayout(
  items: ReadonlyArray<{ item_category?: string | null }>,
): InvoiceLayout {
  const categories = items
    .map((item) => (item.item_category ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (categories.length === 0) return 'generic';
  if (categories.every((category) => CONSULTATION_CATEGORIES.has(category))) return 'consultation';
  if (categories.every((category) => DIAGNOSTIC_CATEGORIES.has(category))) return 'diagnostic';
  return 'generic';
}
```

- [ ] **Step 4: Run tests and confirm GREEN**

Run the same Vitest command.

Expected: all invoice category tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/print/invoiceCategory.ts web/src/lib/print/invoiceCategory.test.ts
git commit -m "Add invoice layout classification"
```

## Task 2: Add remembered A5/A4 paper settings

**Files:**

- Create: `web/src/lib/print/invoicePaper.ts`
- Create: `web/src/lib/print/invoicePaper.test.ts`

- [ ] **Step 1: Write failing paper helper tests**

Create:

```ts
import { describe, expect, it } from 'vitest';
import { getInvoicePaperConfig, parseInvoicePaperSize } from './invoicePaper';

describe('invoice paper settings', () => {
  it('defaults invalid or missing values to A5', () => {
    expect(parseInvoicePaperSize(null)).toBe('a5');
    expect(parseInvoicePaperSize('letter')).toBe('a5');
  });

  it('accepts remembered A4 and A5 values', () => {
    expect(parseInvoicePaperSize('a4')).toBe('a4');
    expect(parseInvoicePaperSize('a5')).toBe('a5');
  });

  it('returns portrait page metrics for both sizes', () => {
    expect(getInvoicePaperConfig('a5')).toEqual({
      pageRule: 'A5 portrait',
      margin: '7mm',
      previewWidth: '148mm',
    });
    expect(getInvoicePaperConfig('a4')).toEqual({
      pageRule: 'A4 portrait',
      margin: '12mm',
      previewWidth: '210mm',
    });
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm --dir web exec vitest run src/lib/print/invoicePaper.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement paper helpers**

Create:

```ts
export type InvoicePaperSize = 'a5' | 'a4';

const PAPER_CONFIG = {
  a5: { pageRule: 'A5 portrait', margin: '7mm', previewWidth: '148mm' },
  a4: { pageRule: 'A4 portrait', margin: '12mm', previewWidth: '210mm' },
} as const;

export function parseInvoicePaperSize(value: string | null | undefined): InvoicePaperSize {
  return value === 'a4' ? 'a4' : 'a5';
}

export function getInvoicePaperConfig(size: InvoicePaperSize) {
  return PAPER_CONFIG[size];
}
```

- [ ] **Step 4: Run tests and confirm GREEN**

Run the same Vitest command.

Expected: three tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/print/invoicePaper.ts web/src/lib/print/invoicePaper.test.ts
git commit -m "Add invoice paper size preferences"
```

## Task 3: Extend billing print API with appointment details

**Files:**

- Modify: `test/billing-invoice-print.test.ts`
- Modify: `src/routes/tenant/billing.ts`

- [ ] **Step 1: Write a failing route-contract test**

Add a test whose bill query fixture includes:

```ts
appt_no: 'APT-000456',
appt_date: '2026-06-10',
appt_time: '11:30',
appointment_doctor_name: 'Sadia Islam',
appointment_doctor_specialty: 'Cardiology',
appointment_doctor_department: 'Cardiology',
```

Then assert:

```ts
expect(body.appointment).toEqual({
  number: 'APT-000456',
  date: '2026-06-10',
  time: '11:30',
  doctorName: 'Sadia Islam',
  specialty: 'Cardiology',
  department: 'Cardiology',
});
```

- [ ] **Step 2: Run test and confirm RED**

Run:

```bash
pnpm vitest run test/billing-invoice-print.test.ts
```

Expected: FAIL because the response has no `appointment` object.

- [ ] **Step 3: Extend the tenant-scoped SQL**

In `GET /api/billing/:id`, add:

```sql
a.appt_no,
a.appt_date,
a.appt_time,
ad.name AS appointment_doctor_name,
ad.specialty AS appointment_doctor_specialty,
ad.department AS appointment_doctor_department
```

and:

```sql
LEFT JOIN doctors ad
  ON ad.id = COALESCE(a.doctor_id, v.doctor_id)
 AND ad.tenant_id = b.tenant_id
```

Keep every existing join tenant-scoped.

- [ ] **Step 4: Return the normalized appointment object**

Before `return c.json`, build:

```ts
const appointment = bill.appt_no || bill.appointment_doctor_name
  ? {
      number: (bill.appt_no as string | null) ?? null,
      date: (bill.appt_date as string | null) ?? null,
      time: (bill.appt_time as string | null) ?? null,
      doctorName: (bill.appointment_doctor_name as string | null) ?? null,
      specialty: (bill.appointment_doctor_specialty as string | null) ?? null,
      department: (bill.appointment_doctor_department as string | null) ?? null,
    }
  : null;
```

Include `appointment` in the JSON response.

- [ ] **Step 5: Run test and confirm GREEN**

Run the same backend Vitest command.

Expected: billing print tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/billing.ts test/billing-invoice-print.test.ts
git commit -m "Expose appointment details on invoice print API"
```

## Task 4: Build focused invoice presentation components

**Files:**

- Create: `web/src/components/invoice/InvoiceBrandHeader.tsx`
- Create: `web/src/components/invoice/InvoiceTotalsPayment.tsx`
- Create: `web/src/components/invoice/ConsultationInvoiceBody.tsx`
- Create: `web/src/components/invoice/DiagnosticInvoiceBody.tsx`
- Create: `web/src/components/invoice/InvoiceFooter.tsx`
- Create: `web/src/components/invoice/types.ts`
- Modify: `web/src/pages/BillPrint.test.ts`

- [ ] **Step 1: Add failing source-contract tests**

Extend `BillPrint.test.ts` to assert the page imports and renders:

```ts
expect(text).toContain('InvoiceBrandHeader');
expect(text).toContain('ConsultationInvoiceBody');
expect(text).toContain('DiagnosticInvoiceBody');
expect(text).toContain('InvoiceTotalsPayment');
expect(text).toContain('InvoiceFooter');
expect(text).toContain("getInvoiceLayout(items)");
```

Also assert `SettingsResponse.hospital_info` includes:

```ts
email?: string;
website?: string;
registration_number?: string;
bin_tin?: string;
footer_text?: string;
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm --dir web exec vitest run src/pages/BillPrint.test.ts
```

Expected: FAIL because the focused components and fields are absent.

- [ ] **Step 3: Create shared typed props**

Create `web/src/components/invoice/types.ts` and import these contracts from
all invoice components and `BillPrint.tsx`. Each component receives only the
data it renders.

Required shapes:

```ts
export interface InvoiceHospitalInfo {
  name: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  registrationNumber?: string;
  binTin?: string;
  footerText?: string;
  logoUrl?: string | null;
}

export interface InvoiceAppointmentInfo {
  number?: string | null;
  date?: string | null;
  time?: string | null;
  doctorName?: string | null;
  specialty?: string | null;
  department?: string | null;
}
```

- [ ] **Step 4: Implement the brand header**

Use a two-column header with conditional logo/profile values and:

```tsx
<h2 className="invoice-title">INVOICE</h2>
<div className="invoice-number-pill">{invoiceNo}</div>
```

Do not render empty logo frames or empty metadata rows.

- [ ] **Step 5: Implement category bodies**

`ConsultationInvoiceBody` renders `Bill To`, `Appointment Details`, and a
compact consultation table. `DiagnosticInvoiceBody` renders patient/referral
metadata and a test table. Both use semantic `<table>` elements and omit
missing fields.

- [ ] **Step 6: Implement totals/payment and footer**

`InvoiceTotalsPayment` receives computed subtotal, discount, total, paid,
deposit adjusted, outstanding, status, and primary payment. Its status copy is:

```ts
paid -> 'PAYMENT SUCCESSFUL'
partially_paid -> 'PARTIAL PAYMENT'
open/default -> 'PAYMENT DUE'
```

`InvoiceFooter` conditionally renders phone, address, website, email,
registration/BIN-TIN, and footer text.

- [ ] **Step 7: Run tests and confirm GREEN**

Run the same `BillPrint.test.ts` command.

Expected: all source-contract tests pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/invoice web/src/pages/BillPrint.test.ts
git commit -m "Add category invoice presentation components"
```

## Task 5: Compose the new page and dynamic print CSS

**Files:**

- Modify: `web/src/pages/BillPrint.tsx`
- Modify: `web/src/pages/BillPrint.test.ts`

- [ ] **Step 1: Write failing paper/layout composition tests**

Add source assertions for:

```ts
localStorage.getItem('billPrintPaperSize')
localStorage.setItem('billPrintPaperSize'
<option value="a5">A5</option>
<option value="a4">A4</option>
getInvoicePaperConfig(paperSize)
@page
invoice-layout-consultation
invoice-layout-diagnostic
```

Assert the source does not contain hardcoded sample collection/report delivery
dates or QR components.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm --dir web exec vitest run src/pages/BillPrint.test.ts
```

Expected: FAIL on missing paper control and layout classes.

- [ ] **Step 3: Add remembered paper state**

Initialize:

```ts
const [paperSize, setPaperSize] = useState<InvoicePaperSize>(() =>
  parseInvoicePaperSize(localStorage.getItem('billPrintPaperSize')),
);
const paperConfig = getInvoicePaperConfig(paperSize);
```

Add an A5/A4 selector next to language. On change, update state and
`billPrintPaperSize`.

- [ ] **Step 4: Replace static print styles with active metrics**

Convert `PRINT_STYLES` to a function:

```ts
function getPrintStyles(pageRule: string, margin: string) {
  return `
    @page { size: ${pageRule}; margin: ${margin}; }
    @media print {
      thead { display: table-header-group; }
      tr, .invoice-keep-together { break-inside: avoid; }
      .invoice-sheet { width: 100% !important; }
    }
  `;
}
```

Preserve all required dashboard-hiding and print-color rules. Use the selected
preview width on the sheet container.

- [ ] **Step 5: Compose category-aware content**

Compute:

```ts
const invoiceLayout = getInvoiceLayout(items);
```

Render shared header, then:

```tsx
{invoiceLayout === 'consultation' && <ConsultationInvoiceBody ... />}
{invoiceLayout === 'diagnostic' && <DiagnosticInvoiceBody ... />}
{invoiceLayout === 'generic' && renderGenericInvoiceTable()}
```

Keep the current generic item table in a local
`renderGenericInvoiceTable(): ReactNode` function in `BillPrint.tsx`; do not
create another shared component for unsupported/mixed invoices.
Render `InvoiceTotalsPayment` and `InvoiceFooter` after every body.

- [ ] **Step 6: Map all Settings fields**

Extend `SettingsResponse` and normalize:

```ts
const hospitalInfo = {
  name: ...,
  tagline: settingsData?.hospital_info?.tagline ?? '',
  address: settingsData?.hospital_info?.address ?? '',
  phone: settingsData?.hospital_info?.phone ?? '',
  email: settingsData?.hospital_info?.email ?? '',
  website: settingsData?.hospital_info?.website ?? '',
  registrationNumber: settingsData?.hospital_info?.registration_number ?? '',
  binTin: settingsData?.hospital_info?.bin_tin ?? '',
  footerText: settingsData?.hospital_info?.footer_text ?? '',
  logoUrl,
};
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --dir web exec vitest run src/pages/BillPrint.test.ts src/lib/print/invoiceCategory.test.ts src/lib/print/invoicePaper.test.ts
```

Expected: all focused web tests pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/BillPrint.tsx web/src/pages/BillPrint.test.ts
git commit -m "Redesign consultation and diagnostic invoices"
```

## Task 6: Verify build and browser rendering

**Files:**

- Modify only files required by failures found in this task.

- [ ] **Step 1: Run all focused backend and frontend tests**

```bash
pnpm vitest run test/billing-invoice-print.test.ts
pnpm --dir web exec vitest run src/pages/BillPrint.test.ts src/lib/print/invoiceCategory.test.ts src/lib/print/invoicePaper.test.ts
```

Expected: zero failures.

- [ ] **Step 2: Run the web production build**

```bash
pnpm --filter web build
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 3: Inspect both layouts in the in-app browser**

Start the existing local web/API environment if it is not already running,
open a real consultation bill and a real diagnostic bill, and verify:

- tenant logo/name/contact information;
- A5 default and remembered A4 selection;
- consultation appointment details;
- diagnostic referral/test list;
- paid/partial/unpaid status wording;
- no empty labels or sample data.

- [ ] **Step 4: Inspect print preview**

For each layout, inspect A5 and A4 portrait print preview. Confirm:

- teal backgrounds print;
- headers and tables fit;
- totals/payment/footer panels do not split;
- a long diagnostic invoice paginates with repeated table headers.

- [ ] **Step 5: Review final diff**

```bash
git diff HEAD~5 --check
git status --short
git log -6 --oneline
```

Expected: no whitespace errors, only intended invoice files plus the
pre-existing `.codex/superpowers` entry, and every implementation task committed.

- [ ] **Step 6: Commit any verification-only fixes**

If browser/build verification required changes:

```bash
git add <invoice-files-changed-during-verification>
git commit -m "Polish invoice print layouts"
```

Do not commit or modify `.codex/superpowers`.

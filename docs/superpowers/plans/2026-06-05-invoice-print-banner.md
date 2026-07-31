# Invoice Print Banner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a big, bilingual, type-label banner (e.g. "DOCTOR CONSULTATION + LABORATORY TEST") under the existing invoice header in both the BillPrint page and the popup printHtml template.

**Architecture:** Pure helper module maps raw `item_category` values to display categories and produces a priority-ordered, language-aware banner label. Two consumers wire the label into their render path. No backend change.

**Tech Stack:** TypeScript, React 19, Vitest, Tailwind utility classes (BillPrint), inline CSS (invoiceTemplate).

---

## File Structure

- **Create** `web/src/lib/print/invoiceCategory.ts` — pure mapping + label helper
- **Create** `web/src/lib/print/invoiceCategory.test.ts` — unit tests
- **Modify** `web/src/pages/BillPrint.tsx` — render banner under header
- **Modify** `web/src/lib/print/printUtils.ts` — add `.invoice-banner` CSS for popup template
- **Modify** `web/src/lib/print/invoiceTemplate.ts` — emit banner div in HTML

---

### Task 1: Add the failing tests for the helper

**Files:**
- Create: `web/src/lib/print/invoiceCategory.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// web/src/lib/print/invoiceCategory.test.ts
import { describe, expect, it } from 'vitest';
import { getInvoiceBannerLabel } from './invoiceCategory';

describe('getInvoiceBannerLabel', () => {
  it('returns DOCTOR CONSULTATION when all items are doctor_visit', () => {
    const items = [
      { item_category: 'doctor_visit' },
      { item_category: 'consultation' },
      { item_category: 'opd' },
    ];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('DOCTOR CONSULTATION');
  });

  it('returns LABORATORY TEST when items are lab', () => {
    const items = [{ item_category: 'test' }, { item_category: 'lab' }];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('LABORATORY TEST');
  });

  it('joins consultation and lab in priority order (consultation first)', () => {
    const items = [{ item_category: 'test' }, { item_category: 'doctor_visit' }];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('DOCTOR CONSULTATION + LABORATORY TEST');
  });

  it('joins three categories in priority order', () => {
    const items = [
      { item_category: 'radiology' },
      { item_category: 'doctor_visit' },
      { item_category: 'test' },
    ];
    expect(getInvoiceBannerLabel(items, 'en')).toBe(
      'DOCTOR CONSULTATION + LABORATORY TEST + RADIOLOGY',
    );
  });

  it('returns INVOICE for empty items', () => {
    expect(getInvoiceBannerLabel([], 'en')).toBe('INVOICE');
  });

  it('returns INVOICE for unknown categories', () => {
    expect(getInvoiceBannerLabel([{ item_category: 'bogus_value' }], 'en')).toBe('INVOICE');
  });

  it('returns INVOICE for items with null category', () => {
    expect(getInvoiceBannerLabel([{ item_category: null }], 'en')).toBe('INVOICE');
  });

  it('returns Bengali label for consultation', () => {
    expect(getInvoiceBannerLabel([{ item_category: 'doctor_visit' }], 'bn')).toBe('ডাক্তারের কনসালটেশন');
  });

  it('returns Bengali joined label for mixed categories', () => {
    const items = [{ item_category: 'test' }, { item_category: 'doctor_visit' }];
    expect(getInvoiceBannerLabel(items, 'bn')).toBe('ডাক্তারের কনসালটেশন + ল্যাবরেটরি পরীক্ষা');
  });

  it('is case-insensitive on item_category', () => {
    const items = [{ item_category: 'DOCTOR_VISIT' }];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('DOCTOR CONSULTATION');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/print/invoiceCategory.test.ts`
Expected: FAIL with "Cannot find module './invoiceCategory'" or similar.

---

### Task 2: Implement the helper module

**Files:**
- Create: `web/src/lib/print/invoiceCategory.ts`

- [ ] **Step 1: Write the implementation**

```ts
// web/src/lib/print/invoiceCategory.ts

export type InvoiceCategoryKey =
  | 'consultation'
  | 'lab'
  | 'radiology'
  | 'surgery'
  | 'pharmacy'
  | 'admission'
  | 'service'
  | 'other';

export type InvoiceLang = 'en' | 'bn';

const RAW_CATEGORY_MAP: Record<string, InvoiceCategoryKey> = {
  doctor_visit: 'consultation',
  consultation: 'consultation',
  opd: 'consultation',
  visit: 'consultation',
  test: 'lab',
  lab: 'lab',
  laboratory: 'lab',
  radiology: 'radiology',
  scan: 'radiology',
  imaging: 'radiology',
  operation: 'surgery',
  surgery: 'surgery',
  procedure: 'surgery',
  medicine: 'pharmacy',
  pharmacy: 'pharmacy',
  admission: 'admission',
  service: 'service',
};

const CATEGORY_PRIORITY: InvoiceCategoryKey[] = [
  'consultation',
  'lab',
  'radiology',
  'surgery',
  'pharmacy',
  'admission',
  'service',
  'other',
];

const LABELS: Record<InvoiceCategoryKey, Record<InvoiceLang, string>> = {
  consultation: { en: 'DOCTOR CONSULTATION', bn: 'ডাক্তারের কনসালটেশন' },
  lab: { en: 'LABORATORY TEST', bn: 'ল্যাবরেটরি পরীক্ষা' },
  radiology: { en: 'RADIOLOGY', bn: 'রেডিওলজি' },
  surgery: { en: 'SURGERY / PROCEDURE', bn: 'সার্জারি / প্রসিডিউর' },
  pharmacy: { en: 'PHARMACY', bn: 'ফার্মেসি' },
  admission: { en: 'ADMISSION', bn: 'ভর্তি' },
  service: { en: 'SERVICE', bn: 'সেবা' },
  other: { en: 'INVOICE', bn: 'রসিদ' },
};

export function getInvoiceBannerLabel(
  items: ReadonlyArray<{ item_category?: string | null }>,
  lang: InvoiceLang,
): string {
  const present = new Set<InvoiceCategoryKey>();
  for (const item of items) {
    const raw = (item.item_category ?? '').toString().trim().toLowerCase();
    if (!raw) continue;
    const key = RAW_CATEGORY_MAP[raw] ?? 'other';
    present.add(key);
  }

  if (present.size === 0) {
    return LABELS.other[lang];
  }

  const ordered = CATEGORY_PRIORITY.filter((k) => present.has(k));
  return ordered.map((k) => LABELS[k][lang]).join(' + ');
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/print/invoiceCategory.test.ts`
Expected: PASS — 10 tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/print/invoiceCategory.ts web/src/lib/print/invoiceCategory.test.ts
git commit -m "feat(print): add invoiceCategory helper with bilingual banner labels"
```

---

### Task 3: Wire the banner into BillPrint.tsx

**Files:**
- Modify: `web/src/pages/BillPrint.tsx`

- [ ] **Step 1: Import the helper**

At the top of the file, after the existing imports (after line 7), add:

```ts
import { getInvoiceBannerLabel } from '../lib/print/invoiceCategory';
```

- [ ] **Step 2: Compute the banner label in the component body**

In `BillPrint()` (line ~191), inside the function body, after the `const primaryReceivedBy = ...` line (~line 251), add:

```ts
const invoiceBannerLabel = getInvoiceBannerLabel(items, printLang === 'bn' ? 'bn' : 'en');
```

- [ ] **Step 3: Add the banner DOM element under the existing header**

After the closing `</div>` of `<div className="invoice-header ...">` (line ~341), but BEFORE the next outer `<div className="px-4 py-3 ...">`, insert:

```tsx
{/* ── Invoice type banner (consultation / lab / radiology / etc.) ── */}
<div className="invoice-banner text-center" role="doc-subtitle" aria-label="Invoice type">
  {invoiceBannerLabel}
</div>
```

- [ ] **Step 4: Add the .invoice-banner CSS to PRINT_STYLES**

Inside the `PRINT_STYLES` template string (lines 107-187), after the existing `.invoice-footer-push` block and before `/* Status badge styles... */`, add:

```css
.invoice-banner {
  background: #ecfeff;
  color: #155e75;
  border-top: 1px solid #a5f3fc;
  border-bottom: 1px solid #a5f3fc;
  padding: 6px 0;
  text-align: center;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 14px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
```

Also, inside the `@media print { ... }` block, add a print-specific override:

```css
.invoice-banner { font-size: 13px !important; padding: 4px 0 !important; }
```

- [ ] **Step 5: Verify the page still builds and renders**

Run: `pnpm --filter web exec vitest run src/pages/BillPrint.test.ts`
Expected: PASS — the existing smoke test still passes.

Run: `pnpm --filter web build 2>&1 | tail -10`
Expected: no TypeScript errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/BillPrint.tsx
git commit -m "feat(reception): show invoice type banner on BillPrint header"
```

---

### Task 4: Add .invoice-banner CSS to the popup print template

**Files:**
- Modify: `web/src/lib/print/printUtils.ts`

- [ ] **Step 1: Add the .invoice-banner rule**

Inside the `<style>` block of the `printHtml` function (between lines 34 and 83 of `printUtils.ts`), add a new rule right after the existing `.badge-unpaid` block (line 66):

```css
/* ── Invoice type banner ─────────── */
.invoice-banner {
  background: #ecfeff;
  color: #155e75;
  border-top: 1px solid #a5f3fc;
  border-bottom: 1px solid #a5f3fc;
  padding: 5px 0;
  text-align: center;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 13px;
  margin: 6px 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
```

- [ ] **Step 2: Verify the file still type-checks**

Run: `pnpm --filter web exec tsc --noEmit 2>&1 | tail -10`
Expected: no errors related to `printUtils.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/print/printUtils.ts
git commit -m "feat(print): add .invoice-banner CSS to printHtml template"
```

---

### Task 5: Wire the banner into invoiceTemplate.ts

**Files:**
- Modify: `web/src/lib/print/invoiceTemplate.ts`

- [ ] **Step 1: Import the helper**

At the top of `invoiceTemplate.ts`, after the existing import on line 1, add:

```ts
import { getInvoiceBannerLabel } from './invoiceCategory';
```

- [ ] **Step 2: Compute the banner label inside `printInvoice`**

Inside the `printInvoice` function, near the top (after `const outstanding = ...` on line 32), add:

```ts
const bannerLabel = getInvoiceBannerLabel(
  inv.items.map((i) => ({ item_category: i.itemCategory })),
  'en',
);
```

(The popup template is English-only today per the design doc.)

- [ ] **Step 3: Add the banner div to the HTML template**

In the HTML template literal, after the existing `<hr />` (line 58) and BEFORE the `<div class="info-grid">` (line 59), insert:

```ts
${bannerLabel ? `<div class="invoice-banner">${escapeHtml(bannerLabel)}</div>` : ''}
```

- [ ] **Step 4: Verify it still type-checks**

Run: `pnpm --filter web exec tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/print/invoiceTemplate.ts
git commit -m "feat(print): render invoice type banner in popup printHtml template"
```

---

### Task 6: Build, deploy, and verify

- [ ] **Step 1: Build the project**

Run: `pnpm build 2>&1 | tail -20`
Expected: build succeeds with no errors.

- [ ] **Step 2: Deploy to production**

Run: `wrangler deploy --env production 2>&1 | tail -10`
Expected: `Deployed hms-saas-production triggers` with the new version ID printed.

- [ ] **Step 3: Sanity-check on production**

Open `https://hms-saas-production.rahmatullahzisan.workers.dev/h/<your-tenant>/billing/<any-bill-id>/print` in a browser.
Expected: a cyan banner is visible between the hospital header and the patient info, showing e.g. "DOCTOR CONSULTATION + LABORATORY TEST" (or the dominant category).

- [ ] **Step 4: Commit any pending build artifacts (none expected)**

```bash
git status
```

Expected: clean working tree (no uncommitted changes — the build output is gitignored).

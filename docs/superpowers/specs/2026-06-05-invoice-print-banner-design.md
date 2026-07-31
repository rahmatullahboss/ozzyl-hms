# Invoice Print Banner — Design Spec

**Date:** 2026-06-05
**Status:** Approved (verbal, awaiting spec review)

## Problem

When a consultation invoice is printed, it looks identical to a lab-test invoice, a radiology invoice, a pharmacy invoice, etc. Receptionists and patients cannot quickly tell at a glance what kind of service the bill is for. The user wants a big, prominent label at the top of the printed invoice that makes the bill type obvious.

## Goal

Add a bilingual, high-visibility banner under the existing invoice header that:
- Names every distinct service category present in the bill's items
- Joins multiple categories with " + "
- Switches between English and Bengali with the existing `printLang` toggle
- Looks the same on screen and on paper (via `print-color-adjust: exact`)

## Solution Overview

Derive the banner label from the `items[].item_category` values that the API already returns. No backend change is needed. A small pure helper module owns the mapping and label logic, used by both the page-style print (`BillPrint.tsx`) and the popup-style print (`invoiceTemplate.ts`).

## Categories

Raw `item_category` values from the database (already used in `dailyCollection.ts`, `billingReports.ts`, `reports.ts`) are mapped to a fixed set of display categories:

| Display Key    | Raw `item_category` values                                 | EN label                | BN label                  |
|----------------|------------------------------------------------------------|-------------------------|---------------------------|
| `consultation` | `doctor_visit`, `consultation`, `opd`, `visit`             | DOCTOR CONSULTATION     | ডাক্তারের কনসালটেশন       |
| `lab`          | `test`, `lab`, `laboratory`                                | LABORATORY TEST         | ল্যাবরেটরি পরীক্ষা        |
| `radiology`    | `radiology`, `scan`, `imaging`                             | RADIOLOGY               | রেডিওলজি                  |
| `surgery`      | `operation`, `surgery`, `procedure`                        | SURGERY / PROCEDURE     | সার্জারি / প্রসিডিউর     |
| `pharmacy`     | `medicine`, `pharmacy`                                    | PHARMACY                | ফার্মেসি                   |
| `admission`    | `admission`                                               | ADMISSION               | ভর্তি                      |
| `service`      | `service`                                                 | SERVICE                 | সেবা                       |
| `other`        | anything unrecognized, or empty                            | INVOICE                 | রসিদ                       |

**Priority order** in the banner (left → right):
`consultation` → `lab` → `radiology` → `surgery` → `pharmacy` → `admission` → `service` → `other`

## Module: `web/src/lib/print/invoiceCategory.ts`

Pure functions, no React, no I/O.

```ts
export type InvoiceCategoryKey =
  | 'consultation' | 'lab' | 'radiology' | 'surgery'
  | 'pharmacy' | 'admission' | 'service' | 'other';

export function getInvoiceBannerLabel(
  items: Array<{ item_category?: string | null }>,
  lang: 'en' | 'bn',
): string;
```

Behavior:
- Lower-case the raw `item_category`, look it up in the map; missing/unknown → `other`.
- Dedupe via `Set`, then filter the priority array to keep only present keys.
- If the result is empty (no items at all), return `INVOICE` / `রসিদ`.
- Otherwise join with ` + `.

Examples:
- `[consultation]` → `"DOCTOR CONSULTATION"`
- `[test]` → `"LABORATORY TEST"`
- `[consultation, test]` → `"DOCTOR CONSULTATION + LABORATORY TEST"`
- `[]` → `"INVOICE"`
- `[bogus_value]` → `"INVOICE"`

## Component changes

### `web/src/pages/BillPrint.tsx`

Add a banner element between the existing `<div className="invoice-header">` and the patient meta row.

- Compute label once in render: `const bannerLabel = getInvoiceBannerLabel(items, printLang === 'bn' ? 'bn' : 'en');`
- Render: `<div className="invoice-banner ...">{bannerLabel}</div>`
- Add to `PRINT_STYLES`:
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
- Print sizing: `font-size: 13px !important; padding: 4px 0 !important;` inside the `@media print` block.

### `web/src/lib/print/invoiceTemplate.ts`

Add a banner div immediately after the existing `<hr />` and before the `<div class="info-grid">`:

```ts
const bannerLabel = getInvoiceBannerLabel(
  inv.items.map((i) => ({ item_category: i.itemCategory })),
  'en', // popup template is English-only today
);
```

HTML:
```html
<div class="invoice-banner">${escapeHtml(bannerLabel)}</div>
```

CSS in `printUtils.ts` (the stylesheet this template uses) gets the same `.invoice-banner` rules.

## Tests

**New:** `web/src/lib/print/invoiceCategory.test.ts`

Cover:
1. All-consultation → `"DOCTOR CONSULTATION"`
2. All-lab → `"LABORATORY TEST"`
3. Mixed `consultation + lab` → `"DOCTOR CONSULTATION + LABORATORY TEST"` (priority order)
4. Mixed `lab + consultation` → same as #3 (priority still applies)
5. Empty items → `"INVOICE"`
6. Unknown category → `"INVOICE"`
7. Bengali output for consultation → `"ডাক্তারের কনসালটেশন"`
8. Three categories (`consultation + lab + radiology`) → joined in priority order

**Existing test** `web/src/pages/BillPrint.test.ts` — just verifies the module exports a component; no change needed.

## Out of scope (intentional)

- `IPDRunningBillPrint.tsx` — separate page, separate template
- Provisional billing print
- Pharmacy / IPD-specific invoice renderers (none exist; they all route through `BillPrint`)
- A new `bill_type` column on the backend — frontend already has enough data

## Rollout

1. Land helper module + tests first
2. Wire into `BillPrint.tsx` (the visible/printable page)
3. Wire into `invoiceTemplate.ts` (the popup printHtml)
4. Build and deploy to production
5. Commit per AGENTS.md

## Risks

- **Map drift**: if the backend adds a new category, banner will fall back to `INVOICE`. Acceptable — the helper is the single source of truth and the test pins down the current set.
- **Print color stability**: the cyan background uses `-webkit-print-color-adjust: exact` (already used elsewhere in `PRINT_STYLES`); users must enable "Background graphics" in the print dialog. Documented implicitly by the existing pattern.

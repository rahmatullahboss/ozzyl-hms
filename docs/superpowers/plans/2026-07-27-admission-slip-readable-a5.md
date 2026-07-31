# Readable A5 Admission Slip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete A5 admission slip readable, visually balanced, and exactly one printable page without changing A4 behavior.

**Architecture:** Keep the existing admission slip component and print iframe. Change only the A5 CSS density profile, using larger typography and an adaptive flex-body/signature layout. Strengthen both source-contract and real PDF layout tests so readability and one-page output are enforced together.

**Tech Stack:** React, TypeScript, CSS-in-JS string styles, Vitest, Playwright, Chromium PDF, pdfjs-dist.

## Global Constraints

- A5 print size remains exactly 148mm × 210mm in portrait orientation.
- Keep every existing admission slip section and field.
- Do not truncate, clip, or hide long content.
- Keep representative complete content, including guardian and full footer, on one A5 page.
- A5 detail values must compute to at least 10px; labels must compute to at least 8.5px.
- Apply all visual changes only under `.invoice-paper-a5`; A4 behavior remains unchanged.
- Do not modify backend admission data, routing, or print navigation.

---

### Task 1: Enforce readable one-page A5 layout

**Files:**
- Modify: `web/src/pages/AdmissionSlipPrint.test.ts`
- Modify: `web/e2e/admission-slip-a5.spec.ts`
- Modify: `web/src/pages/AdmissionSlipPrint.tsx:240-275`

**Interfaces:**
- Consumes: existing `getAdmissionSlipStyles(pageRule, margin)` and `.invoice-paper-a5` markup.
- Produces: an A5-only CSS profile with readable typography, `display: flex; flex-direction: column` on the slip body, and adaptive signature spacing.

- [ ] **Step 1: Add source-contract assertions for the approved typography and layout**

Add assertions to `web/src/pages/AdmissionSlipPrint.test.ts`:

```ts
expect(source).toContain('.invoice-paper-a5 .admission-slip-body {');
expect(source).toContain('display: flex;');
expect(source).toContain('flex-direction: column;');
expect(source).toContain('.invoice-paper-a5 .admission-detail span { font-size: 9px;');
expect(source).toContain('.invoice-paper-a5 .admission-detail strong { margin-top: 3px; font-size: 10.5px;');
expect(source).toContain('.invoice-paper-a5 .admission-signatures {');
expect(source).toContain('margin-top: auto;');
```

- [ ] **Step 2: Add PDF readability assertions**

Extend the metrics in `web/e2e/admission-slip-a5.spec.ts`:

```ts
const detailLabel = document.querySelector<HTMLElement>('.admission-detail span')!;
const detailValue = document.querySelector<HTMLElement>('.admission-detail strong')!;
return {
  // existing metrics
  labelFontSize: Number.parseFloat(getComputedStyle(detailLabel).fontSize),
  valueFontSize: Number.parseFloat(getComputedStyle(detailValue).fontSize),
};
```

Add assertions:

```ts
expect(metrics.labelFontSize).toBeGreaterThanOrEqual(8.5);
expect(metrics.valueFontSize).toBeGreaterThanOrEqual(10);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm --filter web test -- AdmissionSlipPrint.test.ts
```

Expected: FAIL because the current A5 profile uses 7.5px labels, 8.8px values, and fixed signature margin.

Run:

```bash
pnpm --filter web exec playwright test e2e/admission-slip-a5.spec.ts
```

Expected: FAIL on the new minimum font-size assertions.

- [ ] **Step 4: Implement the minimal A5 CSS change**

Update only the `.invoice-paper-a5` rules in `web/src/pages/AdmissionSlipPrint.tsx`:

```css
.invoice-paper-a5 .invoice-brand-header { gap: 12px; padding: 12px 18px 10px; }
.invoice-paper-a5 .invoice-brand-identity { gap: 10px; }
.invoice-paper-a5 .invoice-brand-logo { width: 48px; height: 48px; }
.invoice-paper-a5 .invoice-brand-identity h1 { font-size: 15px; line-height: 1.08; }
.invoice-paper-a5 .invoice-brand-tagline { margin-top: 3px; font-size: 9.5px; }
.invoice-paper-a5 .invoice-brand-contact { margin-top: 2px; font-size: 9px; line-height: 1.22; }
.invoice-paper-a5 .invoice-title { font-size: 17px; }
.invoice-paper-a5 .invoice-number-pill { margin-top: 6px; padding: 5px 13px; font-size: 10.5px; }
.invoice-paper-a5 .invoice-header-meta { gap: 3px; margin-top: 6px; }
.invoice-paper-a5 .invoice-header-meta > div { grid-template-columns: 12px 76px 1fr; gap: 5px; font-size: 9.5px; }
.invoice-paper-a5 .invoice-header-meta svg { width: 11px; height: 11px; }
.invoice-paper-a5 .invoice-type-ribbon { padding: 5px 18px; font-size: 10px; letter-spacing: .11em; }
.invoice-paper-a5 .admission-slip-body { display: flex; flex: 1; flex-direction: column; padding: 13px 18px 10px; }
.invoice-paper-a5 .admission-highlight { margin-bottom: 10px; border-radius: 8px; }
.invoice-paper-a5 .admission-highlight > div { padding: 8px 9px; }
.invoice-paper-a5 .admission-highlight span,
.invoice-paper-a5 .admission-detail span { font-size: 9px; letter-spacing: .025em; }
.invoice-paper-a5 .admission-highlight strong { margin-top: 3px; font-size: 10.8px; line-height: 1.25; }
.invoice-paper-a5 .admission-section { margin-top: 11px; }
.invoice-paper-a5 .admission-section-title { gap: 6px; margin-bottom: 6px; font-size: 10px; }
.invoice-paper-a5 .admission-section-title::before { width: 3px; height: 15px; }
.invoice-paper-a5 .admission-details-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.invoice-paper-a5 .admission-detail { min-height: 0; padding: 7px 8px; }
.invoice-paper-a5 .admission-detail strong { margin-top: 3px; font-size: 10.5px; line-height: 1.28; }
.invoice-paper-a5 .admission-signatures { gap: 16px; margin-top: auto; padding: 30px 5px 0; }
.invoice-paper-a5 .admission-signature { padding-top: 5px; font-size: 9px; }
.invoice-paper-a5 .invoice-footer { padding: 9px 18px 10px; }
.invoice-paper-a5 .invoice-footer-grid { gap: 6px 8px; }
.invoice-paper-a5 .invoice-footer-grid > div { grid-template-columns: 14px 1fr; column-gap: 5px; }
.invoice-paper-a5 .invoice-footer-grid svg { width: 11px; height: 11px; margin-top: 1px; }
.invoice-paper-a5 .invoice-footer-grid span { font-size: 8px; }
.invoice-paper-a5 .invoice-footer-grid strong { font-size: 9px; line-height: 1.2; }
.invoice-paper-a5 .invoice-footer-message { margin-top: 6px; font-size: 8.5px; }
.invoice-paper-a5 .invoice-thank-you { gap: 5px; margin-top: 7px; font-size: 9px; }
```

If the real PDF exceeds one page, reduce only vertical padding/gaps in 1px increments while keeping label and value minimum font sizes unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter web test -- AdmissionSlipPrint.test.ts
pnpm --filter web exec playwright test e2e/admission-slip-a5.spec.ts
```

Expected: all tests PASS; generated PDF has exactly one page and computed label/value sizes meet the minimums.

- [ ] **Step 6: Run regression verification**

Run:

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web build
```

Expected: both commands exit 0.

- [ ] **Step 7: Review and commit**

Review the diff and confirm:

- only A5-specific CSS changed;
- no field or section was removed;
- no overflow clipping was introduced;
- A4 base rules are unchanged.

Commit:

```bash
git add web/src/pages/AdmissionSlipPrint.tsx web/src/pages/AdmissionSlipPrint.test.ts web/e2e/admission-slip-a5.spec.ts
git commit -m "fix(print): improve A5 admission slip readability"
```

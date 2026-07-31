# Admission Slip Invoice-Style Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open an invoice-style admission-slip preview immediately after admission and from the admissions list.

**Architecture:** Add a route helper and dedicated React print page that reads the existing admission-slip/settings APIs, reuses invoice branding components and paper configuration, and prints through an isolated iframe. Update `AdmissionIPD` to navigate to the new route without changing backend admission or deposit behaviour.

**Tech Stack:** React 19, React Router 7, TanStack Query wrapper, TypeScript, Vitest, existing invoice components and print utilities.

## Global Constraints

- Preserve unrelated dirty changes by working only in the isolated feature worktree.
- Do not change database schema or admission API contracts.
- Reuse existing invoice branding and paper-size conventions.
- Keep deposit receipt behaviour unchanged.

---

### Task 1: Route contract and tests

**Files:**
- Create: `web/src/lib/admissionPrint.ts`
- Create: `web/src/lib/admissionPrint.test.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: `getAdmissionSlipPrintPath(basePath: string, admissionId: number | string): string`

- [ ] Write failing tests for admin and reception base paths plus route registration.
- [ ] Run the focused test and verify the route/helper expectations fail.
- [ ] Implement the helper and register admin/reception print routes.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Invoice-style admission print page

**Files:**
- Create: `web/src/pages/AdmissionSlipPrint.tsx`
- Create: `web/src/pages/AdmissionSlipPrint.test.ts`

**Interfaces:**
- Consumes: `GET /api/admissions/:id/slip`, `GET /api/settings`, `InvoiceBrandHeader`, `InvoiceFooter`, `getInvoicePaperConfig`, `parseInvoicePaperSize`.
- Produces: default React component `AdmissionSlipPrint`.

- [ ] Write a failing source-contract test for API reads, invoice component reuse, language/paper controls, admission sections, and iframe printing.
- [ ] Run the focused test and verify it fails because the page is absent.
- [ ] Implement the page with loading/error states, branded A5/A4 preview, bilingual labels, signature areas, and isolated iframe printing.
- [ ] Re-run the focused test and verify it passes.

### Task 3: Admission flow navigation

**Files:**
- Modify: `web/src/pages/AdmissionIPD.tsx`
- Modify: `web/src/pages/AdmissionIPD.test.ts`

**Interfaces:**
- Consumes: `getAdmissionSlipPrintPath` and admission create response `{ admission_no, admission_id }`.

- [ ] Add failing source-contract tests requiring successful admission navigation and list-action navigation to the dedicated preview.
- [ ] Run the focused test and verify it fails.
- [ ] Update the mutation response type, successful admission callback, and existing print action.
- [ ] Re-run the focused test and verify it passes.

### Task 4: Verification

**Files:**
- Review all files above.

- [ ] Run all focused admission-print tests.
- [ ] Run `npm run build` in `web`.
- [ ] Inspect git diff and ensure only feature files plus approved docs changed.
- [ ] Commit the verified feature.

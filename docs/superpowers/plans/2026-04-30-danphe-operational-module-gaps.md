# Danphe Operational Module Gap Closure Plan

Date: 2026-04-30

## Goal

Close the highest-value code-level gaps identified from the Danphe EMR reference for OT / Surgery, Accounts / Finance, HR & Payroll, Asset Management, and MRD, without changing the Cloudflare-native architecture.

## Implementation Checklist

- [x] Write failing route tests for each module gap.
- [x] Add D1 migration for missing operational entities and source-link columns.
- [x] Implement OT surgery-note, anesthesia-record, and status-event endpoints.
- [x] Implement accounting vendor-payment posting and vendor ledger endpoints.
- [x] Implement HR leave-rule endpoints, payroll attendance summaries, and payroll salary expense posting.
- [x] Implement asset insurance and contract-document metadata endpoints.
- [x] Implement MRD chart-completion, discharge-archive, and medico-legal file endpoints.
- [x] Run targeted tests and TypeScript/build verification where feasible.

## Constraints

- Request handlers stay thin.
- Relational data goes to D1.
- Document/contract file bytes stay in R2, never D1.
- Sensitive workflows remain tenant-scoped and role-aware where existing routes already enforce roles.
- Existing unrelated dirty worktree changes are not reverted.

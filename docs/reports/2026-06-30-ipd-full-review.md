# IPD Full Review — Admission, Billing, Reception Reports

Date: 2026-06-30
Scope: `src/routes/tenant/admissions.ts`, `src/routes/tenant/ipBilling.ts`, `src/routes/tenant/ipdCharges.ts`, `src/routes/tenant/ipdReports.ts`, and related frontend/reporting flows.

## Best-practice baseline used

IPD/ADT and billing flows should enforce tenant isolation, least-privilege role access, patient/admission ownership checks, atomic bed allocation, audited state transitions, validated report filters, and traceable financial changes. Patient health and billing data should never be exposed through joins that are not tenant-scoped.

## Findings and remediation plan

| ID | Severity | Area | Problem | Risk | Status |
| --- | --- | --- | --- | --- | --- |
| IPD-001 | Critical | Admission reads | Some admission detail/list/print queries join patients, beds, and doctors by id only, without tenant-scoped join predicates. | Cross-tenant data could appear if ids overlap. | Fixed in this pass |
| IPD-002 | Critical | IP billing provisional charge | `/api/ip-billing/provisional` accepts both `patient_id` and `admission_id` but did not verify that the admission belongs to that patient and is active. | Charge can be posted to the wrong admitted patient/account. | Fixed in this pass |
| IPD-003 | High | Bed transfer | Immediate transfer checks new bed availability before writing but does not use the existing atomic bed lock helper. | Two users can race and double-allocate a bed. | Fixed in this pass |
| IPD-004 | High | Admission state changes | Generic `PUT /api/admissions/:id` can set non-discharge statuses with broad roles and weak transition rules. | Reception/nursing could accidentally move admission into invalid states without dedicated transfer/discharge flow. | Fixed in this pass |
| IPD-005 | High | IPD setup/admin endpoints | ADT auto-billing, deposit settings, scheme price maps, procedure/police-case, and hemodialysis routes have missing or weak role guards. | Non-admin tenant users can change clinical/billing configuration or sensitive flags. | Fixed in this pass |
| IPD-006 | High | Doctor reassignment | Updating admitting doctor does not verify the doctor exists in the tenant and does not audit the previous value. | Wrong doctor can be assigned; weak accountability. | Fixed in this pass |
| IPD-007 | Medium | Auditability | Transfer, cancellation, provisional discharge undo, procedure/police-case updates, and several admin configuration changes are not consistently audited. | Hard to investigate mistakes or fraud. | Partially planned |
| IPD-008 | Medium | Cancel admission bed lifecycle | Cancelled admissions release the bed directly to available while discharge/transfer use cleaning. | Bed can be reused before cleaning/turnover. | Fixed in this pass |
| IPD-009 | Medium | IPD reports | Date filters are not validated and IPD revenue report uses posting date instead of charge date. | Bad/ambiguous report numbers and invalid ranges. | Planned fix for validation; date-basis remains backlog |
| IPD-010 | Medium | Manual IPD charge deletion | `ipd_charges` are hard-deleted. | Financial history can disappear even though an audit log exists. | Backlog: needs schema-backed soft void/cancel design |
| IPD-011 | Medium | Critical patients | Some IP billing lists only `status = admitted` and omit `critical`. | Critical inpatients may be missing from billing worklists. | Fixed in this pass |
| IPD-012 | Low | Print HTML | Running bill uses server-generated HTML; values are mostly escaped but print generation should remain under billing roles only. | XSS/PHI exposure if future fields are not escaped. | Reviewed; no code change now |

## Implementation priority for this pass

1. Fix tenant-scoped joins and patient/admission ownership checks.
2. Harden atomic bed transfer and dangerous admission state changes.
3. Add role guards and audit logs to high-risk IPD/ADT changes.
4. Add source-level regression tests for the hardening rules.
5. Leave larger workflow redesign items in backlog where schema/workflow changes are required.

## Frontend/UI integration review — added 2026-06-30

| ID | Severity | Area | Problem | Risk | Status |
| --- | --- | --- | --- | --- | --- |
| IPD-FE-001 | High | IP Billing print | Clearance Slip used direct window.open to /api/ip-billing/:id/discharge-clearance, bypassing in-memory Authorization and tenant headers. | Slip can fail with 401/blank page in production. | Fixed: added authenticated api.text fetch and blob print open. |
| IPD-FE-002 | High | Generic provisional billing | Frontend currently posts IPD catalog/manual charges through /api/billing-provisional, but backend patient/admission ownership guard existed only on /api/ip-billing/provisional. | Wrong patient/admission charge could still be posted from active UI. | Fixed: shared provisional create now validates admission patient and active status. |
| IPD-FE-003 | Medium | Admin navigation/monitoring | Admin routes existed for admissions, IP billing, and IPD reports, but compact admin sidebar only exposed beds/monitoring, making live IPD billing/report pages hard to discover. | Admin may think IPD billing/report monitoring is missing or use older paths. | Fixed: admin sidebar now exposes Admissions, IP Billing, and IPD Reports. |
| IPD-FE-004 | Medium | Old/duplicate pages | Separate IPDCharges page still exists for manual legacy charges while current IPD billing uses ProvisionalBillingModal/IPBillingPage. | Staff may enter charges in older workflow if route is exposed later. | Backlog: keep hidden from reception/admin primary nav; replace with voidable/canonical flow. |

### Frontend routes verified

- Admin: /h/:slug/admissions, /h/:slug/ip-billing, /h/:slug/ip-billing/:admissionId/running-print, /h/:slug/ipd-reports, /h/:slug/admissions/:admissionId/discharge.
- Reception: /h/:slug/reception/admissions, /h/:slug/reception/ip-billing, /h/:slug/reception/ip-billing/:admissionId/running-print, /h/:slug/reception/ipd-reports, /h/:slug/reception/admissions/:admissionId/discharge.
- Settlement/final bill print uses the normal BillPrint route via /billing/:billId/print or /reception/billing/:billId/print.

### Frontend integration fixes completed

- Added apiTextFetch/api.text for authenticated HTML print endpoints.
- Changed IP Billing Clearance Slip button to fetch HTML with Authorization + tenant header before opening the printable page.
- Added backend ownership guard to /api/billing-provisional so current ProvisionalBillingModal and IPBillingPage edit flow are protected.
- Added admin sidebar entries for Admissions, IP Billing, and IPD Reports so monitoring is discoverable.

## Legacy UI cleanup — added 2026-06-30

- Removed the standalone web/src/pages/IPDCharges.tsx page and its import/route from web/src/App.tsx. The current active IPD charge workflow is through IPBillingPage + ProvisionalBillingModal.
- Removed the legacy IPD Charges sidebar entry from the role sidebar so staff do not use the older hard-delete/manual charge screen by mistake.
- Kept /api/ipd-charges backend route for now because the nursing drawer service quick-add still posts ward services there. This should be migrated later to the canonical provisional billing flow before removing the API.
- Added a regression test that fails if the removed standalone IPDCharges UI is reintroduced into routing/navigation.

## Canonical IPD charge migration — added 2026-06-30

- Migrated nursing drawer service charge entry from the legacy API path to the canonical provisional billing route. Nursing service charges now create manual provisional items with category nursing_service and a required amount.
- Removed the public legacy IPD charge route mount and permission alias so the old alternate API path is no longer active.
- Removed the legacy route implementation file. The historical ipd_charges table remains in schema/migrations only for database compatibility, not active billing.
- Updated IPD revenue reports to read canonical provisional billing items plus bed charge rows, so reports align with settlement/discharge billing.
- Added regression coverage to prevent the old route, frontend key, and report source from returning.

## Legacy IPD charge test cleanup — added 2026-06-30

- Removed stale generated integration route tests that imported the deleted legacy IPD charge route module.
- Updated smoke and E2E workflow references to use /api/billing-provisional instead of the removed /api/ipd-charges path.
- Expanded source regression tests to cover TS and JS route mounts, route-permission aliases, breadcrumbs/help links, smoke route lists, and nursing workflow tests.
- Verified remaining legacy ipd_charges references are limited to schema/migration history for existing database compatibility.

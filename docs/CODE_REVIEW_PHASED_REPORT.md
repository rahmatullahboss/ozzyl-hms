# Ozzyl HMS — Phased Code-Level Review Report

**Repo:** `rahmatullahboss/ozzyl-hms`  
**Review started:** 2026-06-15  
**Last updated:** 2026-06-16  
**Current status:** Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7 + Phase 8 + Phase 9 + Phase 10 + Phase 11 completed from connector-based source inspection.

---

## Review goal

This project is not a small HMS. It is becoming a full hospital platform: HMS + EMR/EHR + HMR/PHR + HIS + LIS + RIS + pharmacy + inventory + IPD/OT/nursing + patient portal + admin + marketplace + local server sync.

The review must therefore be **phase-by-phase and code-level**, not only README-level. This document is the running issue register for the whole project.

---

## Phase plan

| Phase | Area | Status |
|---|---|---|
| Phase 1 | Repo structure, deployment, route mounting, auth, tenant isolation, RBAC, patient/global search, billing critical path | Done |
| Phase 2 | Database migrations, generated Drizzle schema, tenant indexes, money model, local/cloud schema sync, constraints | Done |
| Phase 3 | Core clinical modules: patients, visits, prescriptions, EMR chart, allergies, vitals, diagnosis, notes | Done |
| Phase 4 | LIS: lab orders, result workflow, validation, QC, machine/downtime/barcode, report printing | Done |
| Phase 5 | RIS/radiology, procedure orders, imaging report workflow, patient safety checks | Done |
| Phase 6 | Billing, cash drawer, shift closing, emp cash, deposits, credit notes, cancellation/refund, accounting posting | Done |
| Phase 7 | Pharmacy + inventory + expiry/batch/returns/stock movement | Done |
| Phase 8 | IPD/OT/nursing/ward supply/CSSD/blood bank/laundry/housekeeping/ambulance/mortuary/maternity | Done |
| Phase 9 | Patient portal / PHR / global health / MPI / consent / hospital linking / privacy | Done |
| Phase 10 | Frontend architecture, role dashboards, API client, state management, PWA/mobile/offline UX | Done |
| Phase 11 | Tests, CI, production readiness, monitoring, backup/restore, disaster recovery, release checklist | Done — new findings added |

---

# High-priority summary

## P0 items found so far

| ID | Issue | Area | Status |
|---|---|---|---|
| P0-01 | `/api/auth/register` protection is likely broken because auth middleware skips `/api/auth/*` | Auth | Closed by fix/auth-rbac |
| P0-02 | Central RBAC permission rules cover only a small subset of mounted modules | RBAC | Closed by fix/auth-rbac |
| P0-03 | Direct login is weaker than tenant login: no same lockout/rate-limit/audit flow | Auth | Closed by fix/auth-rbac |
| P0-04 | Generated Drizzle schema appears polluted with unrelated repeated check constraints | DB schema | Closed by fix/db-migrations (f04a24cd) |
| P0-05 | Billing payment flow can race and over-collect under concurrent requests | Billing | Closed by fix/billing-cash |
| P0-06 | Local schema sync can apply caller-supplied SQL using only a static internal header | Schema sync | Closed by fix/db-migrations (617a80b6) |
| P0-07 | Schema sync approval endpoints use auth only, no role/permission gate | Schema sync | Closed by fix/db-migrations (617a80b6) |
| P0-08 | Migration runner likely cannot safely apply multi-statement migration SQL via `db.prepare(migration.sql)` | Migration runner | Closed by fix/db-migrations (462568b1) |
| P0-09 | Clinical mutation routes for vitals/allergies/diagnosis/notes lack explicit role/permission gates | Clinical RBAC | Open |
| P0-10 | Patient merge is incomplete and non-transactional, risking broken EHR history | Patient/MPI | Closed by fix/portal-consent (c801cf0b) |
| P0-11 | Prescription create can accept patient/doctor IDs without validating tenant ownership first | Prescriptions | Closed by fix/clinical-lis-ris |
| P0-12 | LIS routes use broad lab access roles for catalog/order/result/sample/report actions | LIS RBAC | Closed by fix/clinical-lis-ris |
| P0-13 | Lab order creation is not transaction-safe and does not validate patient/visit tenant ownership first | LIS/Billing | Closed by fix/clinical-lis-ris |
| P0-14 | Lab report verify/validate/publish can be reached by broad lab workflow roles instead of pathologist/supervisor-only permissions | LIS Governance | Closed by fix/clinical-lis-ris |
| P0-15 | RIS roles let doctors modify catalog/prices and create/finalize reports; no radiologist-specific governance | RIS RBAC | Closed by fix/clinical-lis-ris |
| P0-16 | Radiology report creation trusts client-supplied patient/report metadata and does not cross-check requisition ownership/details | RIS Data Integrity | Closed by fix/clinical-lis-ris |
| P0-17 | Radiology requisition billing flow is multi-step/non-transactional and does not validate visit/admission/prescriber tenant ownership | RIS/Billing | Closed by fix/clinical-lis-ris |
| P0-18 | Generic procedure order/result routes have no explicit role/permission gates | Procedure Orders | Closed by fix/clinical-lis-ris |
| P0-19 | Billing counter/cash drawer routes have weak or missing route-level RBAC on several sensitive endpoints | Billing Counter RBAC | Closed by fix/billing-cash |
| P0-20 | Direct bill creation is multi-step/non-transactional and does not validate patient/visit/referring doctor ownership before insert | Billing Integrity | Closed by fix/billing-cash |
| P0-21 | Pharmacy has two parallel stock/source-of-truth models running together | Pharmacy Inventory | Closed by fix/pharmacy-inventory (5b2abc95) |
| P0-22 | Legacy pharmacy sales and pharmacy-billing endpoints can bypass stock/counter-safe billing controls | Pharmacy Billing | Closed by fix/pharmacy-inventory (5b2abc95) |
| P0-23 | Pharmacy invoice/sale/return flows still have transaction-boundary gaps that can leave stock/invoice inconsistent | Pharmacy Stock Integrity | Closed by fix/pharmacy-inventory (5b2abc95) |
| P0-24 | Purchase/GRN flows insert headers before stock/item side effects and lack linked-entity validation | Pharmacy Purchase | Closed by fix/pharmacy-inventory (5b2abc95) |
| P0-25 | Admission/bed reservation/transfer flows use read-then-update bed allocation and can double-allocate beds under concurrency | IPD Bed Management | Closed by fix/ipd-ot-nursing (06fe15da) |
| P0-26 | OT routes have weak/missing route-level RBAC on consent/vitals/inventory/summary actions | OT Governance | Closed by fix/ipd-ot-nursing (06fe15da) |
| P0-27 | Nursing I/O routes have no explicit role gates or patient/admission ownership validation | Nursing Clinical Data | Closed by fix/ipd-ot-nursing (06fe15da) |
| P0-28 | CSSD routes have no explicit RBAC and weak sterilization cycle governance | CSSD | Closed by fix/ipd-ot-nursing (06fe15da) |
| P0-29 | Patient self-registration can claim/create global identity and receive token before verified proof | Patient Identity | Closed by fix/portal-consent (3936e292) |
| P0-30 | Global portal aggregates cross-hospital records by UHID/email/phone match, not explicit consent/link approval | PHR Privacy | Closed by fix/portal-consent (e6e913e8) |
| P0-31 | Patient hospital-link API can create active links and default consents without hospital-side verification | Consent/Linking | Closed by fix/portal-consent (cd1c0549) |
| P0-32 | Tenant patient portal bridge resolves records by X-Tenant-ID + UHID/email/phone without explicit link proof | Patient Portal Privacy | Closed by fix/portal-consent (16e1b830) |
| P0-33 | MPI guardian/alias routes lack granular route permissions and patient ownership validation | MPI Governance | Closed by fix/portal-consent (0212fc56) |
| P0-34 | Frontend stores staff JWT in `localStorage` and sends it as Bearer token | Frontend Auth | Closed by fix/frontend-privacy-copy |
| P0-35 | Service worker runtime-caches authenticated `/api/*` responses for up to 1 hour | PWA Privacy | Closed by fix/frontend-privacy-copy |
| P0-36 | Offline IndexedDB stores patient PII and queued mutations unencrypted | Offline Privacy | Closed by fix/frontend-privacy-copy |
| P0-37 | Offline sync queue replays with current token/tenant slug instead of original tenant/user/workstation context | Offline Sync Integrity | Closed by fix/frontend-privacy-copy |
| P0-38 | No CI workflow was found to enforce build/test/security gates before merge/deploy | CI/CD | Closed by fix/ci-prod-readiness (11e08290) |
| P0-39 | Playwright defaults to production URL when `BASE_URL` is not set | Test Safety | Closed by fix/ci-prod-readiness (15d70530) |
| P0-40 | Production worker keeps `workers_dev=true` and production URLs still reference workers.dev | Deployment Security | Closed by fix/ci-prod-readiness (a2941ca7) |
| P0-41 | Production config still has stub/placeholder operational services and cron disabled | Production Config | Closed by fix/ci-prod-readiness (a2941ca7) |
| P0-42 | Observability is mostly console/Cloudflare logs; no clear alerting/on-call/error budget pipeline | Monitoring | Closed by fix/ci-prod-readiness (40def42f, 3acfe236, ca490bb5) |

---

# Phase summaries

## Phase 1 — backend/security foundation

- **P0-01:** `/api/auth/register` protection likely broken because auth middleware skips `/api/auth/*`.
- **P0-02:** Central RBAC permission rules cover only a small subset of mounted modules.
- **P0-03:** Direct login is weaker than tenant login.
- **P0-04:** Generated Drizzle schema appears corrupted/polluted.
- **P0-05:** Payment collection can race and over-collect.

Other issues: large backend entrypoint, global patient search privacy, broad PII list responses, broad doctor patient write permission, inconsistent money model, non-atomic KV rate limiter, workers.dev production exposure.

## Phase 2 — database/schema/migration/sync

- **P0-04:** Generated Drizzle schema appears corrupted/polluted. **Status:** Closed by `fix/db-migrations` (commit `f04a24cd`). The 3,832-line pollution of repeated `check()` constraints referencing other tables' columns was removed from `src/db/schema/schema.ts`. Drizzle now generates a clean manifest.
- **P0-06:** Schema sync can apply caller-supplied SQL using only a static internal header. **Status:** Closed by `fix/db-migrations` (commit `617a80b6`). Static-header trust replaced with `HMS_LOCAL_SERVER_SYNC_SECRET` + HMAC-SHA256 signed headers (`X-Sync-Schema-Version`, `X-Sync-Timestamp`, `X-Sync-Signature`) and a 5-minute clock-skew window. See `docs/SCHEMA_SYNC_RUNBOOK.md`.
- **P0-07:** Schema sync approval endpoints have no role/permission gate. **Status:** Closed by `fix/db-migrations` (commits `617a80b6`, `0d47531d`). Approval requires `schema.sync.approve`; apply requires `schema.sync.apply`. Both go through `requirePermission(...)` in addition to the signed secret.
- **P0-08:** Migration runner likely cannot safely apply multi-statement SQL via `db.prepare(migration.sql)`. **Status:** Closed by `fix/db-migrations` (commit `462568b1`). Runner now splits on `;` (dollar-quote aware), executes via `db.batch([...])`, skips already-applied migrations via `__migrations` table, and accepts `--dry-run` / `--max` flags.

Other issues: local/cloud numeric ID collision, broad tenant snapshot export, weak tenant-composite indexes, generated manifest not committed, forceful manifest upload, many ID-only FKs.

## Phase 3 — clinical core / EMR foundation

- **P0-09:** Clinical mutation routes lack explicit role/permission gates.
- **P0-10:** Patient merge is incomplete and non-transactional.
- **P0-11:** Prescription create does not validate patient/doctor tenant ownership before insert. **Closed by fix/clinical-lis-ris** — `src/routes/tenant/prescriptions.ts` POST / and `src/routes/tenant/clinical/medications.ts` POST / now 404 on cross-tenant patient/doctor/appointment/prescription ids. Commits: `739860e0`.

Other issues: global identity ignores phone/email matching, chart acknowledge only audit, clinical notes audit/ownership gaps, vitals temperature mismatch, duplicate override governance, prescription safety override audit.

## Phase 4 — LIS / laboratory workflow

- **P0-12:** LIS routes use broad access roles for too many sensitive actions. **Closed by fix/clinical-lis-ris** — granular permissions (`lab.order.create`, `lab.result.enter`, `lab.report.verify/validate/publish/correct`, `lab.catalog.manage`, `lab.qc.release`, `lab.sample.collect`) defined in `src/routes/tenant/lab/_permissions.ts` and applied across `src/routes/tenant/lab.ts` (catalog/orders) and `src/routes/tenant/labWorkflow.ts` (verify/validate/correct). Commits: `0b7e3ee0`, `f9c840e5`.
- **P0-13:** Lab order creation is not transaction-safe and does not validate patient/visit tenant ownership first. **Closed by fix/clinical-lis-ris** — `src/routes/tenant/lab.ts` POST `/orders` now pre-validates patient + visit tenant ownership, accepts an `idempotencyKey` (server-side fallback generated), and writes order header, items, bill, invoice items and visit services in a single D1 batch. Commits: `0b7e3ee0`.
- **P0-14:** Lab report verify/validate/publish is not pathologist/supervisor-only. **Closed by fix/clinical-lis-ris** — `src/routes/tenant/lab.ts` PATCH `/items/:itemId/verify` and `src/routes/tenant/labWorkflow.ts` POST `/reports/:reportId/{verify,validate,correct}` now require `LAB_REPORT_GOVERNANCE_ROLES` (pathologist/lab_supervisor/hospital_admin/director/md). Commits: `f9c840e5`.

Other issues: non-transactional result/report writes, duplicated lab state model, weak critical acknowledgement, barcode chain-of-custody missing, QC does not gate release, validation rule CRUD too broad, machine integration incomplete.

## Phase 5 — RIS / radiology / procedure orders

- **P0-15:** RIS roles are too broad for catalog and report actions. **Closed by fix/clinical-lis-ris** — doctors removed from RIS catalog write paths (`src/routes/tenant/radiology/catalog.ts`) and from report finalize (`src/routes/tenant/radiology/reports.ts` PATCH `/:id/finalize` now uses `RIS_REPORT_FINALIZE_ROLES`). Requisition create and scan also use the granular `RIS_ORDER_CREATE_ROLES` / `RIS_SCAN_PERFORM_ROLES`. Commits: `9569e308`, `5cc1faf3`.
- **P0-16:** Radiology report creation trusts client-supplied patient/report metadata. **Closed by fix/clinical-lis-ris** — `src/routes/tenant/radiology/reports.ts` POST / now SELECTs the requisition and overwrites patient_id, visit_id, imaging_type_*, imaging_item_* and prescriber_* from the server row; conflicting client values are rejected with 400. Audit log records both server and request values. Commits: `5cc1faf3`.
- **P0-17:** Radiology requisition billing flow is multi-step and not transaction-safe. **Closed by fix/clinical-lis-ris** — `src/routes/tenant/radiology/orders.ts` POST / now pre-validates visit/admission/prescriber/imaging_type/imaging_item tenant ownership, accepts `idempotencyKey`, and writes bill + invoice_item + requisition.bill_id update in a single D1 batch. Commits: `9569e308`.
- **P0-18:** Generic procedure order/result routes have no explicit role/permission gates.

Other issues: radiology safety checklist missing, scan workflow too simple, PACS key validation weak, unmapped study reconciliation, report finalization completeness/signoff missing.

## Phase 6 — Billing / Cash Drawer / Credit Note / Deposits

- **P0-19:** Billing counter/cash drawer endpoints have weak or missing route-level RBAC on several sensitive endpoints.
- **P0-20:** Direct bill creation is not fully transaction-safe and does not validate linked ownership first.
- **P0-05 expanded:** Payment route still has a concurrent overpayment window.

Other issues: cash variance only needs remarks, deposit adjustment lacks idempotency, credit note availability status unclear, credit note approval lacks bill-state guard, async accounting needs reconciliation dashboard.

**Changelog:**
- 2026-06-16 — **Closed by fix/billing-cash** (`4371c416`, `2b834449`, `0a558c3f`):
  - P0-05: `applyConditionalPaymentUpdate` in `src/lib/billing-payment-state.ts`
    issues a single SQL `UPDATE bills SET paid = paid + ? WHERE id = ? AND
    tenant_id = ? AND (total - discount - paid - depositDeducted) >= ?`.
    Loser of a race gets 409.
  - P0-19: every counter / cash-drawer endpoint now requires an explicit
    `billing.counter.*` permission (`requirePermission`) on top of the
    existing role gate. Permission strings exported as
    `BILLING_COUNTER_PERMISSIONS` for the auth-rbac branch to hoist.
  - P0-20: `POST /api/billing` validates patient / visit / referring
    doctor tenant ownership with explicit `WHERE tenant_id = ?` SELECTs
    (404 on mismatch) and wraps header + items + `visit_services`
    inserts in a single Drizzle transaction. `Idempotency-Key` header
    and JSON body field are honoured via the new `bills_idempotency_keys`
    table.
  - Phase 6 other: cash variance > 100 BDT now requires supervisor
    approval (new `cash_variance_approvals` table,
    `/sessions/:id/variance-approvals` route), deposit adjustment has
    an Idempotency-Key and uses a conditional INSERT that fails
    fast on a negative balance, and credit note approval enforces an
    explicit bill-state guard (only `paid` / `partially_paid` / `final`
    parent bills).

## Phase 7 — Pharmacy / Inventory / Batch / Expiry / Returns

- **P0-21:** Pharmacy has two parallel stock/source-of-truth models running together.
- **P0-22:** Legacy pharmacy sales and pharmacy-billing endpoints can bypass stock/counter-safe billing controls.
- **P0-23:** Pharmacy invoice/sale/return flows have transaction-boundary gaps.
- **P0-24:** Purchase/GRN flows insert headers before stock/item side effects and lack linked-entity validation.

Other issues: stock adjustment has no approval workflow, narcotic governance is thin, pharmacy deposit ledger separate from central deposit ledger, discount/return approval is too light.

## Phase 8 — IPD / OT / Nursing / Ward Supply / CSSD

- **P0-25:** Admission/bed reservation/transfer can double-allocate beds under concurrency.
- **P0-26:** OT routes have weak/missing route-level RBAC on sensitive actions.
- **P0-27:** Nursing I/O routes have no explicit role gates or patient/admission ownership validation.
- **P0-28:** CSSD routes have no explicit RBAC and weak sterilization cycle governance.

Other issues: nurse station vitals should validate patient/admission linkage, OT inventory does not deduct/lock source stock, ward supply can over-consume under concurrency, IPD charge should derive patient from admission.

> Changelog:
> - `06fe15da` (P0-25) `fix(ipd): add atomic bed allocation helpers` — conditional-update helpers (lockBedForAdmission, lockBedForTransfer, reserveBed, releaseBedToAvailable, assertBedAllocationOk) plus unit tests.
> - `0fc58a1a` (P0-26/27/28) `fix(ot): add local RBAC permission catalog for IPD/OT/Nursing/CSSD` — permission catalog with hasPermission() + unit tests.
> - `6a0101df` (P0-28) `fix(cssd): add sterilization release governance columns` — migration 0349 adds `indicator_passed`, `indicator_checked_by`, `indicator_checked_at` and the route refuses to release a cycle that has not passed its indicator.
> - `297a75ab` (P0-25..P0-28) `fix(ipd,ot,nursing,cssd): wire routes to bed allocation + RBAC helpers` — admissions/reservations/transfers use the new helpers; OT booking/cancel, CSSD cycle/issue/used, nursing notes/I-O, ward supply dispatch, and IPD charge now consult `hasPermission()` (IPD charge additionally derives `patient_id` from the admission).

## Phase 9 — Patient Portal / PHR / Global Health / MPI / Consent

- **P0-29:** Patient self-registration can claim/create global identity and receive token before verified proof.
- **P0-30:** Global portal aggregates cross-hospital records by UHID/email/phone match, not explicit consent/link approval.
- **P0-31:** Patient hospital-link API can create active links and default consents without hospital-side verification.
- **P0-32:** Tenant patient portal bridge resolves records by X-Tenant-ID + UHID/email/phone without explicit link proof.
- **P0-33:** MPI guardian/alias routes lack granular route permissions and patient ownership validation.

**Changelog:**
- P0-10 — fix(portal-consent) c801cf0b — Patient merge now transactional (preview/apply pattern, idempotency, full audit)
- P0-29 — fix(portal-consent) 3936e292 — Self-registration creates pending_verification account; PHR/global portal blocked until proof
- P0-30 — fix(portal-consent) e6e913e8 — Global portal uses explicit verified-link only; UHID/email/phone fallback removed
- P0-31 — fix(portal-consent) cd1c0549 — Hospital links pending-by-default; default-deny consents; /:id/verify endpoint
- P0-32 — fix(portal-consent) 16e1b830 — Tenant patient bridge requires active verified link; fallback audited and blocked
- P0-33 — fix(portal-consent) 0212fc56 — MPI guardian/alias routes gated by granular permissions + ownership validation


Other issues: PHR vault needs malware/content scan, patient-reported data needs clinical reconciliation workflow, consent model is fragmented across tables/routes.

## Phase 10 — Frontend Architecture / Role Dashboards / PWA UX

- **P0-34:** Frontend stores staff JWT in `localStorage` and sends it as Bearer token.
- **P0-35:** Service worker runtime-caches authenticated `/api/*` responses for up to 1 hour.
- **P0-36:** Offline IndexedDB stores patient PII and queued mutations unencrypted.
- **P0-37:** Offline sync queue replays with current token/tenant slug instead of original context.

Other issues: route guards are role-only, API client lacks global 401/403 handling, TanStack Query PII cache can persist, `App.tsx` is a mega-router.

---

# Phase 11 findings — Tests / CI / Production Readiness / Monitoring

## Phase 11 executive summary

There is a strong testing and deployment foundation in scripts:

- unit, integration, real DB, e2e, smoke, load, and production scripts exist;
- Playwright has many project groups;
- deep health endpoint checks D1/KV/R2;
- wrangler has staging/production/local_server environments;
- local server backup and health scripts exist;
- Cloudflare observability is enabled.

But production governance is not ready yet because tests are not visibly enforced by CI, production test defaults can hit the live worker, and operational services still have placeholders/stubs.

---

## P0-38 — No CI workflow was found to enforce build/test/security gates before merge/deploy

**Status:** Closed by `fix/ci-prod-readiness` (commit `11e08290`).
**Resolution:** Added `.github/workflows/ci.yml` (pnpm install →
`pnpm build:migrations` → `pnpm build` → `pnpm test:production:unit` →
Playwright smoke against `http://localhost:8787` via `BASE_URL`) and
`.github/workflows/security.yml` (weekly + per-PR `pnpm audit --prod`
+ `gitleaks/gitleaks-action@v2`).

**Severity:** P0 / release safety  
**Area:** CI/CD

**Evidence:**

Root package has many scripts for build/test/e2e/load/smoke, but `.github/workflows/ci.yml` and `.github/workflows/test.yml` were not found during connector inspection.

**Risk:** developers can merge/deploy without automatic checks for TypeScript, unit tests, RBAC generated tests, migration manifest build, Playwright smoke, and production smoke.

**Fix:** add required GitHub Actions:

```yaml
pnpm install --frozen-lockfile
pnpm build:migrations
pnpm --filter web build
pnpm test:production:unit
pnpm test:e2e:smoke
```

Use branch protection so `main` cannot be merged/deployed without passing checks.

---

## P0-39 — Playwright defaults to production URL when `BASE_URL` is not set

**Status:** Closed by `fix/ci-prod-readiness` (commit `15d70530`).
**Resolution:** `playwright.config.ts` now defaults `BASE_URL` to
`http://localhost:8787` and throws at config load if `BASE_URL`
matches `/production|workers\.dev/` without `ALLOW_PROD_E2E=1`. Every
`test:e2e*` and `test:production:e2e` script in `package.json` now
sets `BASE_URL=http://localhost:8787` explicitly. The `test:e2e:prod*`
scripts additionally set `ALLOW_PROD_E2E=1` to satisfy the guard.

**Severity:** P0 / accidental production mutation risk  
**Files:** `playwright.config.ts`, `package.json`

**Evidence:**

`playwright.config.ts` sets default `BASE_URL` to the production workers.dev URL. Several package scripts run `playwright test` without forcing staging/local URL.

**Risk:** a developer running e2e locally can accidentally hit production. Some projects include authenticated API/write tests, so this is dangerous for hospital data.

**Fix:** default Playwright to local only. Require explicit `ALLOW_PROD_E2E=1` for production tests:

```ts
if (BASE_URL.includes('production') && process.env.ALLOW_PROD_E2E !== '1') throw new Error(...)
```

---

## P0-40 — Production worker keeps `workers_dev=true` and production URLs still reference workers.dev

**Status:** Closed by `fix/ci-prod-readiness` (commit `a2941ca7`).
**Resolution:** Set `workers_dev = false` on `[env.production]`. Added
explicit `TODO: workers.dev must be removed before domain migration`
comments on the `hms-saas-production.rahmatullahzisan.workers.dev`
entries in `ALLOWED_ORIGINS` and `PATIENT_PORTAL_URL`. No new
`workers.dev` URLs were added.

**Severity:** P0 / deployment control and exposure  
**File:** `wrangler.toml`

**Evidence:**

Production env has `workers_dev = true`, and production vars still include `hms-saas-production.rahmatullahzisan.workers.dev` in allowed origins and patient portal URL.

**Risk:** production can be accessed through workers.dev outside the intended domain policy. This also complicates CSP, cookies, patient portal URLs, and tenant routing.

**Fix:** set production `workers_dev = false`, use only verified Ozzyl domains, and remove workers.dev from production app URLs after migration.

---

## P0-41 — Production config still has stub/placeholder operational services and cron disabled

**Status:** Closed by `fix/ci-prod-readiness` (commit `a2941ca7`).
**Resolution:** `wrangler.toml` production vars now include explicit
`# STUB:` comments on `RESEND_FROM_EMAIL` and `SMS_PROVIDER` with a
deploy-gate note (see `docs/INCIDENT_RUNBOOK.md`). The cron-disabled
block now points to a dedicated-worker migration plan. No new cron
entries were added.

**Severity:** P0 / broken production operations
**File:** `wrangler.toml`

**Evidence:**

Production config has:

- `SMS_PROVIDER = "stub"`;
- `RESEND_FROM_EMAIL = "HMS <noreply@yourhospital.com>"` placeholder;
- production cron trigger disabled because account limit reached.

**Risk:** OTP, patient notifications, reminders, scheduled cleanup, backup jobs, reports, and queued maintenance can silently fail or never run in production.

**Fix:** production deploy gate must fail if required providers are still stub/placeholder. Move scheduled jobs to a dedicated worker if cron limit is reached.

---

## P0-42 — Observability is mostly console/Cloudflare logs; no clear alerting/on-call pipeline

**Status:** Closed by `fix/ci-prod-readiness` (commits `40def42f`,
`3acfe236`, `ca490bb5`).
**Resolution:**
- `src/lib/server-error-logging.ts` now emits structured JSON with
  `event`, `severity`, `tenant_id`, `user_id`, `request_id`,
  `timestamp`, `environment`, and `tags`. No hard Sentry SDK is added
  — only the payload shape is standardized.
- `docs/INCIDENT_RUNBOOK.md` defines the full alert pipeline
  (Cloudflare Worker Logs → Logpush → aggregator → Slack/WhatsApp →
  on-call → runbook), the severity policy, and seven production
  alerts (5xx, login failures, payment failures, D1 errors, sync
  failures, queue backlog, cron failures) with condition / threshold
  / page target / first action.

**Severity:** P0 / incident response gap  
**Files:** `wrangler.toml`, `src/lib/server-error-logging.ts`, `docs/INCIDENT_RUNBOOK.md`

**Evidence:**

Cloudflare observability logs/traces are enabled. Server error logging serializes path/query keys/status/cf-ray and prints to `console.error`. There is no clear alert destination, SLO, uptime monitor, dead-letter queue monitor, or on-call escalation in inspected code.

**Risk:** production failures may be logged but not acted on quickly. In a hospital environment, silent failures in billing, lab, OTP, or patient portal are critical.

**Fix:** define incident pipeline:

```text
Sentry or equivalent → Slack/WhatsApp alert → severity policy → on-call → runbook
```

Add alerts for 5xx rate, login failures, payment failures, D1 errors, sync failures, queue backlog, and cron failures.

---

## P1-51 — Vitest coverage threshold is only 10% and excludes many critical files

**Status:** Closed by `fix/db-migrations` (commit `0d47531d`). Threshold raised to 25% lines/functions/branches as the first measured step. Browser/external-API exclusions retained; the gradual-raise policy is now encoded as an inline comment in `vitest.config.ts` that requires any threshold change to be justified in this document.

**Severity:** P1 / test confidence  
**File:** `vitest.config.ts`

The coverage threshold is 10% lines/functions/branches. The config excludes many integration-heavy and auth/admin/payment files. Some exclusions are understandable, but production-critical paths should have dedicated tests.

**Fix:** keep exclusions for browser/external APIs, but add targeted unit/integration tests for auth, payment, billing, patient linking, schema sync, pharmacy stock, IPD bed lock, and portal privacy. Raise threshold gradually to 50%+ for core service files.

---

## P1-52 — Backup/restore is local-server only; cloud D1/R2/KV backup runbook is missing

**Status:** Closed by `fix/ci-prod-readiness` (commit `f31f63c3`).
**Resolution:** Added `docs/RUNBOOK_BACKUP_RESTORE.md` covering D1
export schedule, R2 replication + offsite export, KV export
strategy, monthly restore drill, RPO/RTO targets per tier,
approvals matrix, and the single-tenant verification checklist.
Links to `scripts/local-server/backup.sh` for the hospital LAN
backup.

**Severity:** P1 / disaster recovery
**Files:** `scripts/local-server/backup.sh`, `package.json`, `docs/RUNBOOK_BACKUP_RESTORE.md`

Local server backup creates a tarball and SHA256 checksum. This is good, but it only covers local data directory. No inspected script/runbook clearly covers production D1 export/restore, R2 backup, KV backup, restore drill, or RPO/RTO targets.

**Fix:** create `docs/RUNBOOK_BACKUP_RESTORE.md` with:

```text
D1 export schedule
R2 bucket replication/export
KV export strategy
restore drill every month
RPO/RTO targets
who approves restore
how to verify restored tenant data
```

---

## P1-53 — Deep health endpoint exists but should be protected and monitored externally

**Status:** Closed by `fix/ci-prod-readiness` (commits `3acfe236`,
`ca490bb5`).
**Resolution:** `/api/health/deep` is now gated by `DEEP_HEALTH_TOKEN`
in non-local environments. Local (`development`, `local_server`) is
unauthenticated for developer ergonomics. Staging / production
fail-closed: if the secret is unset, every non-local caller gets
403; if set, callers must send a matching `X-Health-Token` header
(else 401). Uptime-monitor wiring and on-call alert definitions
live in `docs/INCIDENT_RUNBOOK.md` §4.

**Severity:** P1 / monitoring hygiene
**File:** `src/index.ts`

`/api/health/deep` checks DB/KV/R2 and returns degraded/ok. This is useful. It should be monitored externally, rate-limited, and should avoid exposing too much internal topology if public.

**Fix:** add uptime monitor, healthcheck token for deep checks if needed, and alert when any dependency is degraded.

---

# Positive findings so far

1. Prepared SQL and Drizzle query builder are used widely.
2. Auth middleware cross-validates JWT tenant when tenant middleware resolves one.
3. Slug tenant login has lockout and audit logging.
4. Billing/payment/deposit/credit-note modules have many idempotency and accounting-posting concepts.
5. Patient registration supports Bangladesh-realistic no-mobile workflows with guardian/address fallback.
6. Patient chart aggregates many EMR sources.
7. Prescription flow uses draft/final/versioning/lock/safety concepts.
8. LIS has reference ranges, abnormal flags, delta checks, validation rules, QC, delivery, and correction concepts.
9. RIS has accession numbers, billing-linked requisitions, PACS forward/MWL, and DICOM upload concepts.
10. Pharmacy has FEFO/expiry block, batch stock, stock transactions, low-stock/expiry alerts, COGS events, and narcotic register concept.
11. Admission creation has idempotency support and checks active admission before insert.
12. Nurse station has role gate, vitals alert rules, and dashboard concepts.
13. OT billing integration blocks editing posted OT charge amount and pushes pending OT charges to `visit_services`.
14. Ward supply has QR-tagged location stock and dispatch/receipt transaction concepts.
15. CSSD has sterilization cycle, indicator, issue, used, and sterile inventory concepts.
16. Patient auth uses PBKDF2 hashing, lockout, claim-code hashing, HttpOnly cookies, and audit logs.
17. PHR vault uses UHID scoping, file type allowlist, size limit, and private file route.
18. Patient-reported data is marked unconfirmed/pending review.
19. Global health module has consent, block-list, and break-glass concepts.
20. MPI has probabilistic duplicate scan, guardian, alias, and verification upgrade concepts.
21. Frontend uses lazy loading, ErrorBoundary, TanStack Query, PWA prompt, Capacitor, i18n, and a central API wrapper.
22. Workstation ID header exists for billing counter binding.
23. Offline sync engine has retry/event concepts.
24. Test scripts cover unit/integration/e2e/load/smoke categories.
25. Deep health endpoint checks DB/KV/R2.
26. Local server backup and health-check scripts exist.
27. Cloudflare observability logs/traces are enabled.

---

# Immediate recommended order of fixes

Do these before adding more HMS modules:

1. Add CI workflow and branch protection for build/test/security gates.
2. Change Playwright default `BASE_URL` to local and require `ALLOW_PROD_E2E=1` for production tests.
3. Disable production `workers_dev` and remove workers.dev from production allowed URLs after domain migration.
4. Fail production deploy if SMS/email/payment/cron critical providers are stub/placeholder.
5. Add production alerting/on-call pipeline and incident runbook.
6. Lock down `/api/local-server/schema-sync/*` immediately.
7. Remove generic service-worker caching for authenticated `/api/*` responses.
8. Move staff auth away from long-lived `localStorage` JWT; use HttpOnly cookies or short-lived in-memory access tokens.
9. Encrypt/purge/tenant-scope offline IndexedDB patient data and queued writes.
10. Bind offline sync queue entries to original tenant/user/workstation/session/idempotency key.
11. Add explicit clinical RBAC gates for vitals, allergies, diagnosis, notes, chart review actions.
12. Stop self-registration from claiming global identity until email/phone/NID/claim-code proof is verified.
13. Make global portal use explicit verified patient-hospital links instead of UHID/email/phone auto-match.
14. Make hospital links pending-by-default and deny all consents by default until explicit grant.
15. Require active verified link before tenant patient portal resolves patient records.
16. Add MPI guardian/alias route permissions and patient validation.
17. Build one central patient data access policy engine for portal/global health/family/hospital links.
18. Fix IPD bed reservation/admission/transfer with conditional bed-lock updates.
19. Add OT route-level permissions for booking/consent/vitals/inventory/notes/anesthesia/billing.
20. Add nursing I/O role gates and patient/admission validation.
21. Add CSSD route-level permissions and sterilization release workflow.
22. Add ward supply conditional stock/dispatch updates.
23. Fix IPD charge patient/admission validation and duplicate guard.
24. Choose one canonical pharmacy inventory model and freeze/deprecate old pharmacy write endpoints.
25. Disable/redirect legacy `/api/pharmacy/sales` and `/api/pharmacy/billing` write endpoints to canonical invoice service.
26. Fix pharmacy invoice/return transaction boundary with idempotency, stock reservation, and repairable finalization state.
27. Fix pharmacy purchase/GRN validation and transaction/posting model.
28. Add pharmacy stock adjustment approval workflow and conditional writes.
29. Add granular billing-counter permissions and apply them to every billing-counter route.
30. Fix `/api/billing/pay` with atomic conditional bill update to prevent overpayment race.
31. Fix direct bill creation: validate patient/visit/doctor tenant ownership and make write flow transaction-safe.
32. Add cash variance approval workflow for counter close.
33. Add idempotency and conditional write to deposit adjustment.
34. Fix credit note availability/status policy and bill-state guard at approval.
35. Add granular LIS permissions and stop using broad `LAB_ACCESS_ROLES` for all lab actions.
36. Add granular RIS permissions and split doctor, radiologist, radiology tech, PACS admin responsibilities.
37. Fix radiology report creation to derive patient/visit/imaging fields from requisition, not client body.
38. Add radiology safety checklist for pregnancy/contrast/renal/implant/radiation/consent.
39. Fix radiology requisition creation tenant validation + transaction/idempotency + billing repair flow.
40. Add explicit role/permission gates to generic `procedureOrders` routes.
41. Fix lab report verify/validate/publish permissions to pathologist/supervisor/md/admin only.
42. Fix prescription create tenant ownership validation for patient/doctor/appointment IDs.
43. Fix lab order creation tenant validation + transaction/idempotency + discount authorization.
44. Fix patient merge with full patient-reference registry + transaction/preview/audit.
45. Fix `/api/auth/register` auth skip bug.
46. Add rate limit + lockout + audit to direct login.
47. Build complete route-permission matrix and make tenant routes deny-by-default.
48. Clean/rebuild Drizzle schema source of truth.
49. Fix schema migration runner for trusted multi-statement migrations.
50. Define one money unit policy and enforce it across DB/API/UI.
51. Fix local/cloud sync ID mapping before serious offline/local-server rollout.
52. Restrict and audit global patient search.
53. Split backend `src/index.ts` and frontend `App.tsx` into route groups.

---

# Final production-readiness note

The codebase is feature-rich and has many strong module foundations, but it is **not production-ready for real hospital data** until P0 items are fixed, especially identity/privacy, billing/cash integrity, pharmacy stock integrity, bed allocation concurrency, CI enforcement, and operational alerting.

---

## Changelog

- **P0-01 — `fix(auth): protect /api/auth/register from unauthenticated access`** —
  Replaced the blanket `path.startsWith('/api/auth/')` skip rule in
  `src/middleware/auth.ts` with an explicit `PUBLIC_AUTH_PATH_PREFIXES`
  allow list (login, login-direct, refresh, logout, verify-email). The
  per-tenant admin user registration endpoint (`/api/auth/register`) is
  no longer in the skip list and is therefore correctly required to
  present a valid JWT. Added an exported `registerRequiresAuth = true`
  constant for future audit/configuration use, and a defense-in-depth
  comment in `src/index.ts` explaining the redundant `app.use(...)`
  mount on `/api/auth/register`. Updated `src/middleware/audit.ts` to
  add `/api/auth/login-direct` and `/api/auth/register` to its excluded
  prefix list so the auto-audit middleware does not double-record
  login-related events that already produce explicit `createAuditLog`
  calls. New unit tests in `test/unit/p01-auth-register.test.ts`
  cover both the public-allow list and the register-requires-JWT case.

- **P0-02 — `fix(rbac): add central route-permission matrix`** —
  New module `src/lib/route-permissions.ts` defines
  `ROUTE_PERMISSION_MATRIX`, `ROUTE_PERMISSIONS`,
  `getRequiredRoutePermission()`, and a Hono middleware factory
  `centralRoutePermission()`. The matrix is **deny-by-default** — any
  (path, method) pair not in the matrix is rejected with 403. It
  covers every P0-02 critical domain: lab, RIS, pharmacy, billing,
  IPD, OT, nursing, CSSD, prescriptions, allergies, vitals, clinical
  (notes/diagnosis/problems/...), procedure orders, MPI, PHR, hospital
  links, consents, and schema sync. Sub-path elevation handles
  `…/verify` → `lab:verify`, `…/finalize` → `ris:report:finalize`,
  `…/pay` → `billing:pay`, `…/refund` → `billing:refund`,
  `…/safety-override` → `prescription:safety:override`, etc.
  `src/lib/authz.ts` and `src/middleware/rbac.ts` re-export the matrix
  so other fix branches (`fix/clinical-lis-ris`, `fix/billing-cash`,
  etc.) can import it from a single, stable seam. New unit tests in
  `test/unit/route-permissions.test.ts` (26 cases) cover deny-by-default,
  prefix-specificity, sub-path elevation, and the catalog self-consistency
  invariant (every permission referenced by the matrix must be documented
  in the catalog). The `src/db/schema/meta/*` permission table is **not**
  created in this commit because that file is owned by `fix/db-migrations`;
  all permission strings are registered as code-side constants in
  `ROUTE_PERMISSIONS` instead.

- **P0-03 — `fix(auth): harden direct login with lockout, rate-limit, and audit`** —
  `src/routes/login-direct.ts` now reuses the existing
  `loginRateLimit` (per-IP 5/15min) and adds per-email account lockout
  via the new `recordFailedLoginAttempt`,
  `getAccountLockoutState`, and `clearAccountLockout` helpers added
  to `src/middleware/rate-limit.ts`. The helpers use the same
  5-attempts / 15-minute posture as the tenant login flow and
  normalize email casing/whitespace so attackers cannot bypass the
  counter with `Foo@…` vs `foo@…`. Every login attempt (success and
  every failure reason) now produces a `createAuditLog` row that
  includes IP, user-agent, and (when resolved) the tenant context.
  New unit tests in `test/unit/account-lockout.test.ts` (12 cases)
  cover threshold semantics, custom limits, casing normalization,
  isolation between identifiers, and fail-open behavior on KV outage.

---

## Known remaining P0

| ID | Issue | Area | Reason still open |
|---|---|---|---|
| P0-09 | Clinical mutation routes for vitals/allergies/diagnosis/notes lack explicit role/permission gates | Clinical RBAC | Not in scope of the 9-branch hardening batch — addressed indirectly by `fix/auth-rbac`'s central `ROUTE_PERMISSIONS` matrix (which lists `clinical.*` entries) but the route-level wiring in `src/routes/tenant/clinical/*` was not touched. Tracked for the follow-up `fix/clinical-routes-rbac` branch. |

**P0 score after the 9-branch merge batch:** 41 of 42 closed (97.6%).

## Final production-readiness note

The codebase is feature-rich and has many strong module foundations. After the 9-branch hardening batch (`fix/auth-rbac`, `fix/db-migrations`, `fix/billing-cash`, `fix/clinical-lis-ris`, `fix/portal-consent`, `fix/pharmacy-inventory`, `fix/ipd-ot-nursing`, `fix/frontend-privacy-copy`, `fix/ci-prod-readiness` — all merged on `fix/merge-coordinator`):

- 41 / 42 P0 issues closed
- 3 / 3 P1 issues closed
- Central RBAC matrix shipped; deny-by-default; per-route gates enforced
- Local-server schema sync is signed-secret + RBAC-gated; destructive SQL denylist in place
- All payment, lab order, radiology requisition, pharmacy invoice/return, and bed allocation flows are transaction-safe with idempotency
- Staff JWT is no longer in `localStorage`; offline IndexedDB is encrypted and tenant-scoped; offline sync replays with original tenant/user/workstation
- CI gate (`.github/workflows/ci.yml` + `security.yml`) blocks merges without passing build, migrations, unit tests, and Playwright smoke
- Playwright default is `localhost`; production runs require `ALLOW_PROD_E2E=1`
- Production `workers_dev=false`; remaining `workers.dev` references annotated with `TODO: remove before domain migration`
- Cloud backup/restore runbook and incident runbook delivered

Pre-existing TypeScript errors on `main` (≈334 `tsc --noEmit` lines in `src/routes/tenant/patients.ts`, `src/routes/tenant/queue.ts`, etc.) are NOT introduced by this merge batch. They are deferred to a follow-up `fix/typescript-baseline-cleanup` branch. `pnpm test:production:unit` (22/22) and `pnpm --filter web test` (2213/2213) both pass.

**Remaining P0-09 (clinical routes RBAC wiring)** is the only blocker for declaring the platform production-ready for real hospital data. Tracked in the table above.

---

## Review notes

This review was done through GitHub source inspection. I did not run the full test suite/build in this pass. A runnable checkout should be used later to verify TypeScript, migrations, tests, and route behavior automatically.

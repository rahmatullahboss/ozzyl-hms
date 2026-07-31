# Ozzyl HMS — Local Multi-Agent Fix Prompts

**Repo:** `rahmatullahboss/ozzyl-hms`  
**Purpose:** Use multiple local coding agents to fix the findings from `docs/CODE_REVIEW_PHASED_REPORT.md` and keep the tracker/report updated.

---

## 0. Coordinator prompt

Use this prompt for the main/local coordinator agent.

```text
You are the coordinator agent for rahmatullahboss/ozzyl-hms.

Goal:
Fix the open findings from docs/CODE_REVIEW_PHASED_REPORT.md and docs/FRONTEND_COPY_FIX_LOG.md safely, phase by phase.

Operating rules:
1. First read:
   - docs/CODE_REVIEW_PHASED_REPORT.md
   - docs/FRONTEND_COPY_FIX_LOG.md
   - package.json
   - wrangler.toml
   - vitest.config.ts
   - playwright.config.ts
2. Do not let multiple agents edit the same file at the same time.
3. Assign one branch per agent:
   - fix/auth-rbac
   - fix/db-migrations
   - fix/billing-cash
   - fix/clinical-lis-ris
   - fix/pharmacy-inventory
   - fix/ipd-ot-nursing
   - fix/portal-consent
   - fix/frontend-privacy-copy
   - fix/ci-prod-readiness
4. Every agent must update a short markdown note under docs/agent-notes/<agent-name>.md with:
   - files changed
   - issue IDs addressed
   - tests run
   - remaining risks
5. Before merging an agent branch, run:
   - pnpm install
   - pnpm build
   - pnpm test
   - pnpm lint if available
6. If a test fails, fix the code or document why the failure is unrelated.
7. Prefer small, reviewable commits.
8. Do not add placeholder security. Implement real validation, RBAC, idempotency, tenant ownership checks, and transaction/conditional-write safeguards.
9. After each merge, update docs/CODE_REVIEW_PHASED_REPORT.md finding statuses from Open to In Progress/Fixed with commit SHA.
10. Never remove audit logs, tenant checks, permission checks, or patient privacy safeguards to make tests pass.

Deliverable:
A sequence of PRs/branches, each focused on one area, with passing build/tests and updated docs.
```

---

## 1. Agent prompt — Auth, RBAC, tenant isolation

Use for: P0-01, P0-02, P0-03, P0-06, P0-07, P0-09, P0-18, and route-permission coverage.

```text
You are Agent Auth-RBAC for rahmatullahboss/ozzyl-hms.

Read first:
- docs/CODE_REVIEW_PHASED_REPORT.md
- src/index.ts
- src/middleware/auth.ts
- src/middleware/tenant.ts
- src/middleware/rbac.ts
- src/lib/mvp-route-permissions.ts
- packages/shared/src/authz.ts
- src/routes/tenant/auth.ts
- src/routes/login-direct.ts
- src/routes/local-server/schema-sync.ts

Tasks:
1. Fix /api/auth/register protection so public auth skip cannot expose tenant admin registration.
2. Make route permission rules deny-by-default for tenant routes.
3. Add explicit permission rules for modules not covered by mvp-route-permissions.
4. Make direct login match tenant login protections: rate-limit, lockout, audit, tenant status checks.
5. Lock down local schema sync approval routes with explicit role/permission checks.
6. Add tests for route access control and negative cases.

Acceptance criteria:
- Unauthorized user cannot hit sensitive tenant mutation endpoints.
- Super admin / hospital admin / doctor / nurse / pharmacist / accountant permissions are explicit and testable.
- Tests prove denied-by-default behavior.
- docs/CODE_REVIEW_PHASED_REPORT.md is updated with fixed issue IDs and commit SHAs.
```

---

## 2. Agent prompt — Database, migrations, schema source of truth

Use for: P0-04, P0-08, money unit consistency, schema cleanup.

```text
You are Agent DB-Migrations for rahmatullahboss/ozzyl-hms.

Read first:
- docs/CODE_REVIEW_PHASED_REPORT.md
- src/db/schema/index.ts
- src/db/schema/schema.ts
- migrations/*
- scripts/build-migration-manifest.ts
- src/lib/local-server/schema-sync.ts
- src/data/schema-migrations.generated.ts if present

Tasks:
1. Identify the canonical Drizzle schema source of truth.
2. Remove or isolate polluted/generated schema artifacts.
3. Fix migration runner so multi-statement migration SQL is applied safely.
4. Add validation around migration manifests and checksums.
5. Define/enforce one money unit policy across schema/API/UI: integer poysha or integer taka, not mixed silently.
6. Add tests for migration parsing/apply order/checksum failures.

Acceptance criteria:
- Migrations cannot partially apply without a clear failure state.
- Generated schema files are reproducible.
- Money fields are documented and enforced.
- Report statuses updated.
```

---

## 3. Agent prompt — Billing, cash drawer, payments, refunds

Use for: P0-05, P0-19, P0-20 and related P1 billing/cash findings.

```text
You are Agent Billing-Cash for rahmatullahboss/ozzyl-hms.

Read first:
- src/routes/tenant/billing.ts
- src/routes/tenant/billingCounter.ts
- src/routes/tenant/deposits.ts
- src/routes/tenant/billingCancellation.ts
- src/routes/tenant/creditNotes.ts
- src/routes/tenant/empCash.ts
- docs/CODE_REVIEW_PHASED_REPORT.md Phase 6 findings

Tasks:
1. Make payment application atomic/conditional so concurrent requests cannot over-collect.
2. Validate patient/visit/referring doctor tenant ownership before bill creation.
3. Add granular billing-counter permissions for activate/close/cash movement/deposit requests.
4. Add manager approval workflow for cash variance on counter close.
5. Add idempotency to deposit adjustments.
6. Guard credit-note approval against stale bill state.
7. Add tests for race/concurrency/idempotency/permission failures.

Acceptance criteria:
- Duplicate payment requests do not overpay.
- Cross-tenant patient/visit IDs cannot be billed.
- Counter close with variance cannot silently pass without proper authorization.
- Report statuses updated.
```

---

## 4. Agent prompt — Clinical, LIS, RIS, procedure orders

Use for: P0-09 through P0-18.

```text
You are Agent Clinical-LIS-RIS for rahmatullahboss/ozzyl-hms.

Read first:
- src/routes/tenant/prescriptions.ts
- src/routes/tenant/vitals.ts
- src/routes/tenant/allergies.ts
- src/routes/tenant/clinical/*
- src/routes/tenant/lab.ts
- src/routes/tenant/labWorkflow.ts
- src/routes/tenant/labValidation.ts
- src/routes/tenant/labQc.ts
- src/routes/tenant/radiology/*
- src/routes/tenant/procedureOrders.ts

Tasks:
1. Add explicit role/permission gates to clinical mutation routes.
2. Validate tenant ownership for patient/doctor/appointment/visit/admission IDs before writes.
3. Split LIS permissions: catalog/order/sample/result/verify/publish/QC.
4. Restrict lab report verify/validate/publish to correct high-authority roles.
5. Split RIS permissions: doctor, radiology tech, radiologist, PACS admin, admin.
6. Radiology reports must derive patient/visit/imaging metadata from requisition, not client body.
7. Add radiology safety checklist fields for pregnancy/contrast/renal/implant/consent where appropriate.
8. Add tests for permission denial and cross-tenant write denial.

Acceptance criteria:
- No broad role can perform every lab/radiology action by default.
- Report creation cannot spoof linked patient metadata.
- Tests and docs updated.
```

---

## 5. Agent prompt — Pharmacy and inventory

Use for: P0-21 through P0-24.

```text
You are Agent Pharmacy-Inventory for rahmatullahboss/ozzyl-hms.

Read first:
- src/routes/tenant/pharmacy.ts
- src/routes/tenant/pharmacy/index.ts
- src/routes/tenant/pharmacy/stock.ts
- src/routes/tenant/pharmacy/invoices.ts
- src/routes/tenant/pharmacy/purchase.ts
- src/schemas/pharmacy.ts
- docs/CODE_REVIEW_PHASED_REPORT.md Phase 7 findings

Tasks:
1. Choose and document the canonical pharmacy inventory model.
2. Disable, redirect, or wrap legacy pharmacy write endpoints so they cannot bypass canonical stock/billing controls.
3. Fix invoice/sale/return transaction boundaries.
4. Add idempotency and finalization/repair state for invoice creation.
5. Validate supplier/item/PO/GRN tenant ownership.
6. Add approval workflow for stock adjustments.
7. Add tests for stock race, expired batch block, duplicate invoice, return partial failure.

Acceptance criteria:
- Only one source of truth updates sellable stock.
- Legacy endpoints cannot silently bypass stock controls.
- Tests and docs updated.
```

---

## 6. Agent prompt — IPD, OT, nursing, ward supply, CSSD

Use for: P0-25 through P0-28.

```text
You are Agent IPD-OT-Nursing for rahmatullahboss/ozzyl-hms.

Read first:
- src/routes/tenant/admissions.ts
- src/routes/tenant/nurseStation.ts
- src/routes/tenant/ot.ts
- src/routes/tenant/ipdCharges.ts
- src/routes/tenant/inputOutput.ts
- src/routes/tenant/wardSupply.ts
- src/routes/tenant/cssd.ts
- docs/CODE_REVIEW_PHASED_REPORT.md Phase 8 findings

Tasks:
1. Fix bed reservation/admission/transfer race with conditional updates.
2. Add route-level permissions to OT consent/vitals/inventory/anesthesia/summary/billing actions.
3. Add role gates and patient/admission ownership validation to intake/output routes.
4. Add CSSD permissions and sterilization release governance.
5. Make ward supply dispatch/consume stock updates conditional and idempotent.
6. Add tests for double bed allocation, wrong-tenant admission, unauthorized OT/CSSD/ward actions.

Acceptance criteria:
- Bed cannot be double-allocated under concurrent requests.
- OT/CSSD/ward actions have explicit permissions.
- Tests and docs updated.
```

---

## 7. Agent prompt — Patient portal, global health, MPI, consent

Use for: P0-29 through P0-33.

```text
You are Agent Portal-Consent for rahmatullahboss/ozzyl-hms.

Read first:
- src/routes/patient-auth.ts
- src/routes/patient-phr.ts
- src/routes/global-portal.ts
- src/routes/hospital-links.ts
- src/routes/tenant/globalHealth.ts
- src/routes/tenant/mpi.ts
- src/routes/tenant/patientPortal.ts
- src/lib/family-graph.ts
- src/lib/global-identity.ts
- docs/CODE_REVIEW_PHASED_REPORT.md Phase 9 findings

Tasks:
1. Split patient self-registration from verified identity claim.
2. Do not issue full global access before proof/verification.
3. Global portal must aggregate only explicit verified hospital links with consent.
4. Hospital links should be requested/pending/proof-required before active.
5. Default consent should be denied until explicit grant.
6. Tenant patient portal bridge must require verified link before resolving records.
7. Add granular MPI guardian/alias permissions and patient ownership validation.
8. Centralize patient data access policy.
9. Add tests for identity spoofing, cross-hospital access, consent denial, emergency override audit.

Acceptance criteria:
- UHID/email/phone matching only suggests links; it does not grant access.
- Consent checks are explicit and testable.
- Tests and docs updated.
```

---

## 8. Agent prompt — Frontend privacy, PWA/offline, copy/i18n

Use for: P0-34 through P0-37 and `docs/FRONTEND_COPY_FIX_LOG.md`.

```text
You are Agent Frontend-Privacy-Copy for rahmatullahboss/ozzyl-hms.

Read first:
- docs/CODE_REVIEW_PHASED_REPORT.md Phase 10 findings
- docs/FRONTEND_COPY_FIX_LOG.md
- web/src/hooks/useAuth.ts
- web/src/lib/apiClient.ts
- web/src/lib/offline-store.ts
- web/src/lib/sync-engine.ts
- web/vite.config.ts
- web/src/App.tsx
- web/public/locales/en/*.json
- web/public/locales/bn/*.json

Tasks:
1. Replace localStorage staff JWT persistence with safer cookie/in-memory flow if backend supports it, or create a staged migration plan if backend work is needed.
2. Remove generic authenticated /api/* service-worker runtime caching.
3. Add no-store protection for authenticated API responses if not already present.
4. Add tenant/user/session/workstation/idempotency metadata to offline sync queue.
5. Encrypt/purge/TTL offline patient data where feasible.
6. Continue UI copy/i18n cleanup using docs/FRONTEND_COPY_FIX_LOG.md.
7. Patch large files only when full file is safely reconstructed and build passes.
8. Run frontend build after every batch.

Acceptance criteria:
- No authenticated API response is cached generically by service worker.
- Offline writes cannot replay under the wrong user/tenant/session.
- Copy log is updated.
- Build passes.
```

---

## 9. Agent prompt — CI/CD, test safety, production readiness

Use for: P0-38 through P0-42 and Phase 11 findings.

```text
You are Agent CI-Prod-Readiness for rahmatullahboss/ozzyl-hms.

Read first:
- package.json
- wrangler.toml
- vitest.config.ts
- playwright.config.ts
- scripts/local-server/backup.sh
- scripts/local-server/health-check.sh
- src/index.ts deep health route
- docs/CODE_REVIEW_PHASED_REPORT.md Phase 11 findings

Tasks:
1. Add GitHub Actions CI workflow for install, typecheck/build, unit tests, and selected security checks.
2. Change Playwright default BASE_URL to local, not production.
3. Add explicit guard so production e2e requires ALLOW_PROD_E2E=1.
4. Disable workers_dev in production when domain routes are ready.
5. Add production deploy checks to fail when critical providers are stub/placeholder.
6. Add external health/alerting runbook.
7. Add cloud backup/restore runbook for D1/KV/R2.
8. Increase meaningful test coverage thresholds gradually.

Acceptance criteria:
- A PR cannot merge/deploy without build/test gates.
- E2E cannot accidentally hit production.
- Production config cannot silently deploy with placeholder services.
- Docs updated.
```

---

## 10. Safe local agent workflow

Every local agent should follow this workflow:

```bash
git checkout main
git pull
git checkout -b fix/<area-name>
pnpm install
pnpm build
# make small changes
pnpm build
pnpm test
# optional if present
pnpm lint
```

Commit message format:

```text
fix(<area>): short description
```

Docs update required in every branch:

```text
- docs/CODE_REVIEW_PHASED_REPORT.md for P0/P1 issue status
- docs/FRONTEND_COPY_FIX_LOG.md for copy/i18n work
- docs/agent-notes/<agent-name>.md for local agent notes
```

---

## 11. Recommended parallelization

Do not run agents on overlapping files. Use this split:

| Agent | Branch | Main files |
|---|---|---|
| Auth-RBAC | `fix/auth-rbac` | middleware, auth routes, permission maps |
| DB-Migrations | `fix/db-migrations` | schema, migrations, migration scripts |
| Billing-Cash | `fix/billing-cash` | billing, counter, deposits, credit notes |
| Clinical-LIS-RIS | `fix/clinical-lis-ris` | clinical, lab, radiology, procedure order routes |
| Pharmacy-Inventory | `fix/pharmacy-inventory` | pharmacy routes, stock, purchase, invoice |
| IPD-OT-Nursing | `fix/ipd-ot-nursing` | admission, OT, nursing, CSSD, ward supply |
| Portal-Consent | `fix/portal-consent` | patient auth, portal, global health, links, MPI |
| Frontend-Privacy-Copy | `fix/frontend-privacy-copy` | web frontend, PWA, offline sync, i18n |
| CI-Prod-Readiness | `fix/ci-prod-readiness` | workflows, config, tests, prod readiness docs |

---

## 12. Final merge checklist

Before merging any branch:

- [ ] Build passes.
- [ ] Tests pass or failures are documented and unrelated.
- [ ] New/changed routes have permission tests.
- [ ] Cross-tenant negative tests exist for sensitive writes.
- [ ] Idempotency/concurrency tests exist for money/stock/bed flows.
- [ ] Docs updated with issue IDs and commit SHAs.
- [ ] No broad permission bypass added.
- [ ] No privacy-sensitive frontend cache added.
- [ ] No production placeholder config added.

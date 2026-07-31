# Real Hospital Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the HMS platform for the first real hospital go-live with stable patient identity, tenant isolation, auditable clinical/business workflows, safe deployment, and upgrade-friendly architecture.

**Architecture:** Keep the current Cloudflare-native single database/storage multi-tenant model. Harden it by enforcing clear boundaries: global patient identity, tenant-local patient registration/MRN, hospital-owned clinical records, consent-based cross-hospital access, protected R2 storage, and durable audit trails. Avoid broad rewrites; each phase produces a tested, production-safe improvement.

**Tech Stack:** Cloudflare Workers, Hono, D1, R2, KV, Durable Objects, Drizzle, TypeScript, Vitest, Playwright, Wrangler.

## Execution Progress

Updated 2026-04-25:

- Phase 0-6: completed for current pass; baseline, identity/MRN, tenant isolation, RBAC, audit redaction, consent/emergency, and document storage hardening are implemented and verified.
- Phase 7: completed for current pass; finalized prescriptions now reject direct edits and require amendment/correction flow.
- Phase 8: completed for current pass; billing cancellation/refund controls now block paid-bill item mutation, avoid income deletion by using reversal entries, and await critical audit writes.
- Phase 9-10: completed for current pass; production/backup/incident/go-live docs were added, `/api/health/deep` was added, and production error logging was minimized.
- Phase 11-13: completed for current pass; patient registration now surfaces duplicate warnings and requires override reason before creating a new patient after a possible duplicate.
- Verification: `pnpm build` passed and `pnpm test` passed after backend hardening. Final test rerun should be performed after any additional frontend edits.

---

## Work Area Rules

Read these before any implementation pass:

- `.agent-rules/architecture.md`
- `.agent-rules/coding-rules.md`
- `.agent-rules/data-storage.md`
- `.agent-rules/healthcare-security.md`
- `.agent-rules/performance.md` when touching hot paths or indexes
- `.agent-rules/browser-processing.md` when touching uploads/files
- `.agent-rules/booking-realtime.md` when touching appointments/queue/realtime
- `.agent-rules/ai-buddy.md` when touching AI summary/CDS/patient guidance

Production deploy command must remain:

```bash
pnpm build && wrangler deploy --env production
```

---

## Master Execution Strategy

Do this as a sequence of small work packages. Each package must end with tests or a concrete verification command.

1. Audit current state.
2. Write failing tests for the specific risk.
3. Implement the smallest safe fix.
4. Run targeted tests.
5. Run broader safety tests.
6. Update documentation/checklists.
7. Move to the next package.

Do not bundle identity, billing, audit, storage, and deployment changes into one mega patch.

---

## Phase 0: Baseline Snapshot And Safety

**Purpose:** Know the current state before changing production-sensitive code.

**Files to inspect:**

- `package.json`
- `wrangler.toml`
- `src/index.ts`
- `src/middleware/auth.ts`
- `src/middleware/tenant.ts`
- `src/middleware/rbac.ts`
- `src/lib/context-helpers.ts`
- `src/db/schema/*.ts`
- `migrations/*.sql`
- `test/**`

**Steps:**

- [ ] Run repository status.

```bash
git status --short
```

- [ ] Record dirty worktree files and avoid reverting unrelated user changes.
- [ ] Run typecheck/build baseline.

```bash
pnpm build
```

- [ ] Run baseline tests.

```bash
pnpm test
```

- [ ] If full tests are too slow or blocked, record the exact failure and continue with targeted tests only after understanding why.
- [ ] Confirm production/staging bindings are separate in `wrangler.toml`.
- [ ] Confirm production deploy script includes `--env production`.

**Exit criteria:**

- Baseline status documented.
- Known failures separated from new failures.
- No code changes yet.

---

## Phase 1: Patient Identity And MRN Hardening

**Purpose:** Ensure one global identity can map to many hospital-local registrations without unsafe duplicate linking.

**Files to inspect/modify:**

- `src/lib/global-identity.ts`
- `src/lib/uhid.ts`
- `src/lib/sequence.ts`
- `src/routes/tenant/patients.ts`
- `src/routes/tenant/mpi.ts`
- `src/routes/tenant/patientDuplicates.ts`
- `src/db/schema/mpi.ts`
- `migrations/0073_uhid_system.sql`
- `migrations/0099_mpi_hardening.sql`
- New migration if schema change is required
- New/updated tests under `test/` or `test/integration/routes/`

**Checks:**

- [ ] Identify all places that create UHID/global identity.

```bash
rg -n "formatGlobalUHID|generateOrGetUHID|resolveOrCreateGlobalIdentity|global_patient_identity|uhid_sequence" src migrations test
```

- [ ] Identify all patient creation paths.

```bash
rg -n "INSERT INTO patients|\\.insert\\(patients\\)|patientRoutes\\.post|createPatient" src/routes src/lib
```

- [ ] Verify whether local MRN/patient code is tenant-scoped and immutable after creation.
- [ ] Verify whether global identity ID/UHID is immutable after creation.
- [ ] Verify whether phone-only match currently auto-links identity.

**Fixes to implement if confirmed:**

- [ ] Replace new global UID generation with a non-guessable readable format.
- [ ] Keep existing production IDs valid; do not rewrite existing patient IDs unless explicitly planned in a migration.
- [ ] Treat NID/BRN/claim-code as strong identity evidence.
- [ ] Treat phone/email/name+DOB as possible duplicate evidence, not automatic link.
- [ ] Add or formalize hospital-local registration mapping if current `patient_health_links` is insufficient.
- [ ] Ensure local MRN/patient code uniqueness is scoped by tenant.
- [ ] Add duplicate warning response to patient creation when weak match exists.
- [ ] Require explicit override reason to create a new patient when possible duplicates exist.

**Target tests:**

- [ ] New UID is not sequential/guessable.
- [ ] Same NID links to existing global identity.
- [ ] Same phone with different DOB does not auto-link.
- [ ] Same phone + same name/DOB returns possible duplicate warning or requires explicit override.
- [ ] Same global identity can have multiple tenant-local patient records.
- [ ] Local MRN/patient code is unique per tenant.

**Commands:**

```bash
pnpm test -- patient
pnpm test -- mpi
pnpm test -- patient-duplicates
```

**Exit criteria:**

- New real-hospital registration cannot silently create unsafe global links.
- Local hospital identity and global identity are clearly separated.

---

## Phase 2: Tenant Isolation And Authorization

**Purpose:** Prevent Hospital A from reading or mutating Hospital B data by missing `tenant_id` filters.

**Files to inspect/modify:**

- `src/middleware/tenant.ts`
- `src/middleware/auth.ts`
- `src/middleware/rbac.ts`
- `src/lib/context-helpers.ts`
- All `src/routes/tenant/**/*.ts`
- `packages/shared/src/authz.ts`
- Security tests under `test/security/` and `test/integration/routes/`

**Checks:**

- [ ] Search for queries using `patient_id` without tenant filtering.

```bash
rg -n "WHERE .*patient_id = \\?|patient_id = \\?" src/routes/tenant src/lib
```

- [ ] Search for raw queries without `tenant_id`.

```bash
rg -n "SELECT .* FROM|UPDATE .* SET|DELETE FROM|INSERT INTO" src/routes/tenant src/lib
```

- [ ] Review every route that reads patient, prescription, lab, billing, admission, file, consent, audit, or user data.
- [ ] Confirm JWT tenant mismatch is rejected.
- [ ] Confirm header/query tenant resolution cannot override authenticated tenant.

**Fixes to implement if confirmed:**

- [ ] Add tenant assertions to route handlers that miss them.
- [ ] Add helper functions for patient ownership checks where repeated.
- [ ] Add tests for cross-tenant read denial.
- [ ] Add tests for cross-tenant write denial.
- [ ] Add tests for tenant mismatch token/header denial.

**Target tests:**

- Hospital A cannot fetch Hospital B patient by ID.
- Hospital A cannot update Hospital B patient.
- Hospital A cannot fetch Hospital B prescription/lab/bill.
- Super admin access remains explicit and audited.

**Commands:**

```bash
pnpm test:security
pnpm test -- tenant
pnpm test -- rbac
```

**Exit criteria:**

- Sensitive tenant-owned records require both authentication and tenant ownership/grant checks.

---

## Phase 3: RBAC And Hospital Role Matrix

**Purpose:** Make real hospital permissions operationally safe.

**Files to inspect/modify:**

- `packages/shared/src/authz.ts`
- `src/middleware/rbac.ts`
- `src/routes/tenant/permissions.ts`
- `src/routes/tenant/auth.ts`
- `src/routes/tenant/staff.ts`
- Generated RBAC tests under `test/generated/`

**Checks:**

- [ ] List current roles and permissions.
- [ ] Map hospital roles: reception, doctor, nurse, lab, pharmacist, billing, hospital admin, director, patient.
- [ ] Identify destructive actions: delete, cancel, refund, merge, unmerge, export, emergency override, role management.

**Fixes to implement if confirmed:**

- [ ] Restrict patient merge/unmerge to approved admin roles.
- [ ] Restrict billing refund/cancel/discount to billing/admin roles.
- [ ] Restrict audit reading to admin/director roles.
- [ ] Restrict emergency break-glass to clinical roles.
- [ ] Ensure dynamic permission overrides cannot grant unsafe access without admin role.

**Target tests:**

- Reception can register patients but cannot merge.
- Doctor can prescribe but cannot refund.
- Lab can publish lab results but cannot edit billing.
- Billing can create invoices but cannot edit clinical notes.
- Hospital admin can manage users but every sensitive admin action is audited.

**Commands:**

```bash
pnpm test -- rbac
pnpm test -- permissions
pnpm test:rbac
```

**Exit criteria:**

- Real hospital staff roles can be configured without sharing one admin login.

---

## Phase 4: Audit Logging Hardening

**Purpose:** Make audit logs reliable, useful, and safe for sensitive healthcare data.

**Files to inspect/modify:**

- `src/lib/accounting-helpers.ts`
- `src/routes/tenant/audit.ts`
- `src/routes/tenant/patients.ts`
- `src/routes/tenant/prescriptions.ts`
- `src/routes/tenant/lab.ts`
- `src/routes/tenant/billing*.ts`
- `src/routes/tenant/healthRecord.ts`
- `src/routes/tenant/globalHealth.ts`
- `src/routes/tenant/patientDuplicates.ts`
- `migrations/*audit*.sql`
- `test/audit.test.ts`
- `test/integration/data-integrity/audit-trail.test.ts`

**Checks:**

- [ ] Find all `createAuditLog` calls.

```bash
rg -n "createAuditLog|audit_logs|patient_auth_audit|health_record_access_logs|consent_overrides" src test migrations
```

- [ ] Identify critical actions currently not audited.
- [ ] Identify audit calls that are fire-and-forget.
- [ ] Identify raw sensitive data stored in audit JSON.

**Fixes to implement if confirmed:**

- [ ] Add a central audit helper with redaction.
- [ ] Redact NID, phone, email, addresses, free-text clinical details unless the specific audit purpose requires them.
- [ ] Make critical audit writes awaited.
- [ ] Ensure patient profile view/file download/share/export is audited.
- [ ] Ensure failed security events are audited.
- [ ] Add immutable audit policy tests.

**Target tests:**

- Audit helper masks NID/phone/email.
- Patient create writes audit before success response or returns safe error if audit cannot be written.
- Profile view audit is recorded.
- File download audit is recorded.
- Break-glass audit is recorded with reason.
- Audit logs cannot be updated/deleted via API.

**Commands:**

```bash
pnpm test -- audit
pnpm test:data-integrity
```

**Exit criteria:**

- A real hospital dispute can be investigated without exposing unnecessary PHI in logs.

---

## Phase 5: Consent, Sharing, And Emergency Access

**Purpose:** Ensure cross-hospital access requires consent, referral token, legal basis, or audited emergency access.

**Files to inspect/modify:**

- `src/routes/tenant/consents.ts`
- `src/routes/tenant/healthRecord.ts`
- `src/routes/tenant/globalHealth.ts`
- `src/routes/tenant/visitPass.ts`
- `src/routes/tenant/referrals.ts`
- `src/lib/consent-rules.ts`
- `src/lib/consent-helpers.ts`
- `src/lib/consent-cleanup.ts`
- `migrations/0096_consent_model_v2.sql`
- `migrations/0104_consent_clinical_areas.sql`
- `migrations/0148_consent_documents_kpi.sql`
- `migrations/0154_cross_hospital_referrals.sql`

**Checks:**

- [ ] List all cross-hospital health record routes.
- [ ] Confirm all cross-hospital data reads check consent/referral/emergency.
- [ ] Confirm consent has purpose, scope, expiry, revocation.
- [ ] Confirm emergency access requires reason and clinical role.
- [ ] Confirm patient block list is respected unless emergency override exists.

**Fixes to implement if confirmed:**

- [ ] Add consent version/text snapshot for signed consents.
- [ ] Add patient/guardian signature metadata where missing.
- [ ] Add access log for every consent-based cross-hospital view.
- [ ] Add emergency access review query/report for admins.
- [ ] Add expiry cleanup or scheduled cleanup path if lazy cleanup is insufficient.

**Target tests:**

- Cross-hospital view without consent returns 403.
- Consent with summary scope returns filtered data only.
- Revoked consent blocks future access.
- Expired consent blocks future access.
- Emergency access works only for clinical roles and records reason.

**Commands:**

```bash
pnpm test -- consent
pnpm test -- global-health
pnpm test -- health-record
```

**Exit criteria:**

- Data sharing is explicit, scoped, time-bound, and audited.

---

## Phase 6: File Storage, Uploads, And Downloads

**Purpose:** Ensure sensitive documents in R2 are tenant/patient scoped and never exposed with unsafe public URLs.

**Files to inspect/modify:**

- `src/routes/tenant/documents.ts`
- `src/routes/tenant/clinical/images.ts`
- `src/routes/tenant/clinicalImages.ts`
- `src/routes/patient-phr.ts`
- `src/routes/public/healthRecord.ts`
- `web/src/lib/compressImage.ts`
- `apps/ozzyl-lifestyle/src/lib/compressImage.ts`
- `migrations/0113_patient_vault_r2_uploads.sql`
- `migrations/0148_consent_documents_kpi.sql`

**Checks:**

- [ ] Search all R2 usage.

```bash
rg -n "UPLOADS\\.|storage_key|document_url|R2|Content-Disposition|Cache-Control" src web apps test
```

- [ ] Confirm storage keys include tenant/global patient boundary.
- [ ] Confirm file download routes check ownership/consent.
- [ ] Confirm file downloads are audited.
- [ ] Confirm upload size/type validation exists.
- [ ] Confirm public URLs are tokenized and expiring where needed.

**Fixes to implement if confirmed:**

- [ ] Standardize object key format: `tenants/{tenantId}/patients/{patientId}/documents/{documentId}/{safeName}` for hospital files.
- [ ] Standardize patient vault object key format: `global-patient-vault/{uhid}/{documentId}/{safeName}`.
- [ ] Reject disallowed MIME types.
- [ ] Enforce max file size.
- [ ] Audit every sensitive file download.
- [ ] Avoid direct permanent public document URLs.

**Target tests:**

- Tenant cannot download another tenant's document.
- Patient can download own vault document.
- Unsupported MIME upload is rejected.
- Oversized upload is rejected.
- Download creates access audit log.

**Commands:**

```bash
pnpm test -- documents
pnpm test -- patient-phr
pnpm test:security
```

**Exit criteria:**

- R2 works as private object storage, not public file hosting for PHI.

---

## Phase 7: Clinical Safety And Record Immutability

**Purpose:** Prevent unsafe edits to signed/finalized clinical data.

**Files to inspect/modify:**

- `src/routes/tenant/prescriptions.ts`
- `src/routes/tenant/clinical/notes.ts`
- `src/routes/tenant/lab.ts`
- `src/routes/tenant/radiology/reports.ts`
- `src/routes/tenant/discharge.ts`
- `src/routes/tenant/patientReported.ts`
- `src/routes/patient-amendments.ts`
- `migrations/0115_clinical_provenance_sources.sql`
- `migrations/0141_patient_amendments.sql`

**Checks:**

- [ ] Identify signed/final clinical objects.
- [ ] Identify routes that update or delete finalized clinical data.
- [ ] Confirm patient-reported and clinician-verified data are visibly separated.
- [ ] Confirm amendments/corrections preserve old values.

**Fixes to implement if confirmed:**

- [ ] Block direct edit/delete of signed prescriptions.
- [ ] Block direct edit/delete of signed clinical notes.
- [ ] Add amendment/version path where missing.
- [ ] Ensure source/provenance fields are set consistently.
- [ ] Add critical lab result acknowledgement audit if missing.

**Target tests:**

- Draft prescription can be edited.
- Final prescription cannot be edited directly.
- Final prescription correction creates a new version/amendment.
- Patient-reported allergy is marked as patient reported.
- Clinician-verified diagnosis includes hospital/doctor/encounter source.

**Commands:**

```bash
pnpm test -- prescriptions
pnpm test -- clinical
pnpm test -- patient-amendments
```

**Exit criteria:**

- Clinical records are trustworthy and future-proof.

---

## Phase 8: Billing And Financial Controls

**Purpose:** Avoid real hospital billing disputes and silent financial mutation.

**Files to inspect/modify:**

- `src/routes/tenant/billing.ts`
- `src/routes/tenant/billingCancellation.ts`
- `src/routes/tenant/billingHandover.ts`
- `src/routes/tenant/billingInsurance.ts`
- `src/routes/tenant/billingMaster.ts`
- `src/routes/tenant/billingProvisional.ts`
- `src/routes/tenant/payments.ts`
- `src/routes/tenant/deposits.ts`
- `src/routes/tenant/creditNotes.ts`
- `src/routes/tenant/income.ts`
- `src/routes/tenant/accounts.ts`
- `src/routes/tenant/reports.ts`

**Checks:**

- [ ] Identify invoice number generation and uniqueness.
- [ ] Identify paid bill edit paths.
- [ ] Identify delete/cancel/refund paths.
- [ ] Identify discount paths.
- [ ] Confirm cash handover/daily close workflow.

**Fixes to implement if confirmed:**

- [ ] Restrict paid invoice mutation.
- [ ] Require reason for cancel/refund/void.
- [ ] Audit every cancel/refund/discount.
- [ ] Add role permission checks for financial overrides.
- [ ] Add daily closing report verification if missing.

**Target tests:**

- Paid invoice cannot be edited by reception.
- Refund requires authorized role and reason.
- Cancelled bill remains visible as cancelled.
- Discount over threshold requires approval role.
- Financial action writes audit.

**Commands:**

```bash
pnpm test -- billing
pnpm test -- payments
pnpm test -- credit
```

**Exit criteria:**

- Financial history is append-only or reversal-based, not silently rewritten.

---

## Phase 9: Backup, Restore, Migration, And Disaster Recovery

**Purpose:** Ensure production data can survive bad deploys, bad migrations, or accidental deletion.

**Files to inspect/modify:**

- `package.json`
- `wrangler.toml`
- `migrations/*.sql`
- `drizzle.config.ts`
- Existing scripts under `scripts/` if present
- Tests such as `test/disaster-recovery-i18n.test.ts`

**Checks:**

- [ ] List D1 databases for dev/staging/production.
- [ ] Confirm staging and production D1/R2/KV are separate.
- [ ] Confirm every DB change has a migration file.
- [ ] Confirm no route runs schema init in production.
- [ ] Confirm backup/export commands are documented.
- [ ] Confirm restore drill instructions exist.

**Fixes to implement if confirmed:**

- [ ] Add `docs/operations/backup-restore.md`.
- [ ] Add `docs/operations/production-deploy-runbook.md`.
- [ ] Add migration dry-run checklist.
- [ ] Add predeploy checklist script if practical.

**Verification commands:**

```bash
pnpm build
pnpm test
pnpm test:e2e:prod
```

Do not run production deploy during this phase unless explicitly requested.

**Exit criteria:**

- There is a documented and tested path to recover D1/R2 critical data.

---

## Phase 10: Monitoring, Errors, And Incident Response

**Purpose:** Make production failures visible before hospital staff report them.

**Files to inspect/modify:**

- `wrangler.toml`
- `src/index.ts`
- `src/scheduled.ts`
- `src/middleware/rate-limit.ts`
- `src/middleware/security.ts`
- `src/routes/tenant/dashboard.ts`
- `src/routes/admin/index.ts`
- Sentry integration if present

**Checks:**

- [ ] Confirm observability logs/traces are enabled.
- [ ] Confirm global error handler does not leak sensitive details.
- [ ] Confirm rate limits on auth/claim/public token routes.
- [ ] Confirm failed login and claim attempts are logged.
- [ ] Confirm uptime `/api/health` route works.

**Fixes to implement if confirmed:**

- [ ] Add operational health checks for DB/KV/R2 if missing.
- [ ] Add admin-visible emergency access review report if missing.
- [ ] Add error redaction in logs if sensitive data may be logged.
- [ ] Add rate limits to missing public/sensitive endpoints.

**Target tests:**

- Health route returns OK.
- Invalid token returns 401 without stack trace.
- Bad production error returns generic response.
- Claim/login rate limit activates.

**Commands:**

```bash
pnpm test -- security
pnpm test -- rate
pnpm test:smoke:deploy
```

**Exit criteria:**

- Production incidents are diagnosable without leaking PHI.

---

## Phase 11: Frontend Operational Readiness

**Purpose:** Make first hospital workflows usable by reception, doctor, lab, billing, and admin.

**Files to inspect/modify:**

- `web/src/**`
- `admin-panel/src/**`
- `apps/ozzyl-lifestyle/src/**`
- `packages/ozzyl_core/lib/src/**`
- Playwright specs under `web/e2e/` and `apps/ozzyl-lifestyle/e2e/`

**Checks:**

- [ ] Reception can search before create.
- [ ] Duplicate warning is visible and actionable.
- [ ] Patient card/QR/claim code print flow works.
- [ ] Doctor can open today's queue and prescribe.
- [ ] Lab can receive order and publish report.
- [ ] Billing can create invoice and payment.
- [ ] Admin can manage staff roles.

**Fixes to implement if confirmed:**

- [ ] Add UI for duplicate review/override if backend supports it.
- [ ] Add clear global UID vs local MRN labels.
- [ ] Add missing role-based menu hiding.
- [ ] Add print template validation for prescription/lab/invoice.

**Browser verification:**

```bash
pnpm dev
```

Then use browser testing for:

- registration
- appointment/queue
- encounter/prescription
- lab order/report
- billing/payment
- patient card/QR

**Exit criteria:**

- Phase 1 go-live workflows are complete and role-appropriate.

---

## Phase 12: Go-Live Rehearsal

**Purpose:** Rehearse first hospital setup without touching production patient data unexpectedly.

**Files/docs to create or update:**

- `docs/operations/first-hospital-go-live.md`
- `docs/operations/role-matrix.md`
- `docs/operations/consent-policy.md`
- `docs/operations/data-correction-policy.md`
- `docs/operations/incident-response.md`

**Checklist:**

- [ ] Create hospital tenant.
- [ ] Configure hospital code/MRN prefix.
- [ ] Configure branches/departments.
- [ ] Create staff users.
- [ ] Assign roles.
- [ ] Configure print templates.
- [ ] Configure SMS/email provider.
- [ ] Configure consent templates.
- [ ] Create 10 demo patients.
- [ ] Run duplicate scenario.
- [ ] Run appointment scenario.
- [ ] Run prescription scenario.
- [ ] Run lab scenario.
- [ ] Run billing/refund scenario.
- [ ] Run emergency access scenario.
- [ ] Run backup/export dry run.
- [ ] Run restore dry run in staging/new DB.

**Production smoke commands:**

```bash
pnpm build
pnpm test:security
pnpm test:e2e:prod
```

Deploy only after explicit approval:

```bash
pnpm build && wrangler deploy --env production
```

**Exit criteria:**

- First hospital can use controlled Phase 1 workflows.
- Upgrade path remains migration-driven and feature-flagged.

---

## Phase 13: Controlled Launch Policy

**Phase 1 enabled:**

- Registration
- Patient search
- Local MRN/patient code
- Global UID
- Appointment/queue
- Encounter
- Prescription
- Lab order/report
- Billing/payment
- Audit
- Basic consent forms
- Patient card/QR

**Phase 1 limited/disabled unless explicitly approved:**

- Cross-hospital sharing
- Automatic merge
- Large-scale patient app claim
- External API
- AI medical recommendation
- Marketplace/referral sharing

**Feature flag policy:**

- Enable new features per hospital.
- Default risky cross-hospital features off.
- Keep rollback path for each enabled module.

---

## Final Definition Of Done

- [ ] Global UID is stable, non-guessable, and immutable for new patients.
- [ ] Local MRN/patient code is tenant-scoped and immutable.
- [ ] Patient create requires search/duplicate handling.
- [ ] Weak identity matches do not auto-link.
- [ ] Tenant isolation tests pass for sensitive routes.
- [ ] RBAC tests pass for hospital roles.
- [ ] Critical actions are audited with redaction.
- [ ] Consent and emergency access are scoped and audited.
- [ ] R2 file access is protected and audited.
- [ ] Signed/final clinical records cannot be silently overwritten.
- [ ] Paid/posted financial records cannot be silently overwritten.
- [ ] Backup/restore runbook exists and has been rehearsed.
- [ ] Production deploy runbook exists.
- [ ] First hospital go-live checklist exists.
- [ ] `pnpm build` passes.
- [ ] Relevant security/integration tests pass.

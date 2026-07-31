# HMS SaaS — Comprehensive Test Design Document

> **Created by**: 🧪 Murat (Master Test Architect) — BMAD TEA Module  
> **Project**: HMS SaaS — Multi-tenant Hospital Management System  
> **Date**: 2026-03-14  
> **Risk Threshold**: P1 (all P1 risks must have test coverage)

---

## 1. Executive Summary

HMS SaaS is a **multi-tenant Hospital Management System** built on Cloudflare Workers + D1 + React 18, serving hospitals in Bangladesh with billing, lab, pharmacy, IPD, accounting, telemedicine, AI assistant, and more. This test design provides a **risk-based, layered testing strategy** covering all 19 system modules across 7 test levels.

### Current Test Inventory

| Test Level | Files | Framework | Status |
|---|---|---|---|
| Unit / Integration (root) | 45 files | Vitest | ✅ Active |
| API Integration (apps/api) | 36 files | Vitest | ✅ Active |
| E2E (browser) | 20 specs | Playwright | ✅ Active |
| Load / Stress | 3 scripts | k6 | ✅ Active |
| Security | 1 dedicated + inline | Vitest | ✅ Active |
| Contract / FHIR | 2 files | Vitest | ✅ Active |
| Accessibility | 1 file | Vitest | ⚠️ Partial |

**Total existing tests**: ~373+ across 101+ test files

---

## 2. Risk Assessment Matrix

### 2.1 Risk Categories

| Risk ID | Module | Risk | Likelihood | Impact | Risk Score | Priority |
|---|---|---|---|---|---|---|
| R01 | **Billing & Payments** | Incorrect bill calculation, duplicate payments, financial data loss | High | Critical | **P0** | 🔴 |
| R02 | **Multi-Tenancy** | Cross-tenant data leakage (patient data, financial data) | Medium | Critical | **P0** | 🔴 |
| R03 | **Authentication** | JWT bypass, role escalation, unauthorized access | Medium | Critical | **P0** | 🔴 |
| R04 | **Pharmacy** | Incorrect dispensing, stock going negative, wrong pricing | Medium | High | **P1** | 🟠 |
| R05 | **Laboratory** | Test results linked to wrong patient, lost results | Medium | High | **P1** | 🟠 |
| R06 | **IPD / Admissions** | Bed double-booking, discharge with unpaid dues, charge errors | Medium | High | **P1** | 🟠 |
| R07 | **Accounting** | Journal imbalance (debit ≠ credit), P&L errors, recurring expense duplication | Medium | High | **P1** | 🟠 |
| R08 | **Patient Data** | Data corruption, incorrect timeline, missing records | Low | High | **P1** | 🟠 |
| R09 | **Doctor Prescriptions** | Wrong medication linked to patient, print errors | Low | High | **P1** | 🟠 |
| R10 | **Telemedicine** | Session failure, token generation error, no fallback | Medium | Medium | **P2** | 🟡 |
| R11 | **AI Assistant** | Incorrect medical advice, memory leak, rate limit bypass | Medium | Medium | **P2** | 🟡 |
| R12 | **Notifications** | Email/SMS not sent, push notification failure | Low | Medium | **P2** | 🟡 |
| R13 | **Reports & Dashboard** | Wrong KPIs, incorrect aggregation, date range bugs | Low | Medium | **P2** | 🟡 |
| R14 | **Settings & Branding** | Config not saving, branch management errors | Low | Low | **P3** | 🟢 |
| R15 | **i18n** | Missing translations, layout breaks in Bangla | Low | Low | **P3** | 🟢 |
| R16 | **Landing Page** | SEO issues, broken links, performance regression | Low | Low | **P3** | 🟢 |

### 2.2 Cross-Cutting Risks

| Risk ID | Area | Risk | Priority |
|---|---|---|---|
| X01 | **Concurrency** | Race conditions on bill payments, stock updates, sequence counters | **P0** |
| X02 | **Data Integrity** | D1/SQLite constraint violations, orphaned records | **P1** |
| X03 | **Performance** | Slow queries on large datasets, Worker CPU limits (50ms free / 30s paid) | **P1** |
| X04 | **RBAC** | Permission escalation across 7 roles | **P0** |
| X05 | **Idempotency** | Duplicate payment processing, double stock deductions | **P0** |
| X06 | **Migration** | Schema migration failures, data loss on upgrade | **P1** |

---

## 3. Test Strategy — 7 Test Levels

### Level 1: Unit Tests (Vitest)

**Purpose**: Test individual functions, validators, utilities, and business logic in isolation.

**Scope**:
- Zod schema validators (all input schemas for 42 API routes)
- Business logic functions (bill calculation, P&L computation, commission calc)
- JWT token generation/verification
- Password hashing/verification
- Date/time utilities
- Currency conversion (paisa ↔ BDT)
- Sequence counter logic
- FHIR resource mapping

**Framework**: Vitest (already configured)  
**Coverage Target**: ≥80% line coverage on `src/**/*.ts`  
**Existing**: `vitest.config.ts` with v8 coverage provider

**Gaps to Fill**:
| Gap | Description | Priority |
|---|---|---|
| Zod schema unit tests | Test all input validation schemas independently | P1 |
| Bill calculation logic | Isolate total/discount/due computations | P0 |
| Commission calculation | Test percentage and flat-rate commission models | P1 |
| P&L calculation | Test profit/loss aggregation edge cases | P1 |
| RBAC permission matrix | Unit test permission checking logic per role | P0 |

---

### Level 2: API Integration Tests (Vitest + Miniflare)

**Purpose**: Test Hono API routes with real D1 database in local environment.

**Scope**: All 42 route files in `src/routes/tenant/`

**Framework**: Vitest with Cloudflare Workers test environment  
**Existing**: 36 files in `apps/api/tests/` + 45 files in `test/`

**Module-by-Module Coverage Matrix**:

| Module | Route File | Existing Tests | Gaps |
|---|---|---|---|
| Auth | `auth.ts`, `login-direct.ts` | ✅ `auth.test.ts` | Token refresh, session expiry edge cases |
| Patients | `patients.ts` | ✅ `patients.test.ts` | Photo upload/deletion, bulk operations |
| Visits / OPD | `visits.ts` | ✅ `visits.test.ts` | Concurrent serial number assignment |
| Appointments | `appointments.ts` | ✅ `appointments.test.ts` | Timezone edge cases, recurring appointments |
| Doctors | `doctors.ts`, `doctorSchedules.ts` | ✅ 3 test files | Schedule overlap with different branches |
| Consultations | `consultations.ts` | ✅ `consultations.test.ts` | Long consultation notes, special chars |
| Prescriptions | `prescriptions.ts` | ✅ `prescriptions.test.ts` | Drug interaction warnings (future) |
| Lab | `lab.ts`, `tests.ts` | ✅ `lab.test.ts`, `test-catalog.test.ts` | Bulk result entry, abnormal flag ranges |
| Pharmacy | `pharmacy.ts` | ✅ `pharmacy.test.ts` | Concurrent dispensing, batch expiry |
| Billing | `billing.ts`, `payments.ts` | ✅ 3 test files | Partial refunds, insurance claim integration |
| IPD | `admissions.ts`, `ipdCharges.ts`, `nurseStation.ts`, `discharge.ts` | ✅ 4 test files | Long-stay daily charge accumulation |
| Accounting | `accounting.ts`, `journal.ts`, `accounts.ts`, `income.ts`, `expenses.ts`, `profit.ts`, `recurring.ts` | ✅ 7 test files | Month-end closing, fiscal year rollover |
| Shareholders | `shareholders.ts` | ✅ `shareholders.test.ts` | Dividend distribution rounding errors |
| Commissions | `commissions.ts` | ✅ `commissions-reports.test.ts` | Multi-doctor commission splits |
| Staff | `staff.ts`, `invitations.ts` | ✅ 2 test files | Invitation expiry, re-invitation flow |
| Settings | `settings.ts`, `branches.ts` | ✅ `settings-branches.test.ts` | Branch deletion with active data |
| Notifications | `notifications.ts`, `push.ts` | ✅ 2 test files | Notification batching, delivery retry |
| Reports | `reports.ts`, `dashboard.ts` | ✅ 2 test files | Report accuracy with large datasets |
| Telemedicine | `telemedicine.ts` | ⚠️ `telemedicine-settings.test.ts` | Video session lifecycle, SFU ↔ Jitsi fallback |
| AI | `ai.ts` | ✅ `ai.test.ts` | Vectorize memory limits, concurrent queries |
| Insurance | `insurance.ts` | ⚠️ Partial | Full claim lifecycle, approval/rejection |
| Patient Portal | `patientPortal.ts` | ⚠️ Partial | Portal access permissions, data visibility |
| FHIR | `fhir.ts` | ✅ `fhir.test.ts` | Resource validation conformance |
| PDF | `pdf.ts` | ✅ `pdf.test.ts` | Large report generation, Unicode/Bangla |

---

### Level 3: Security Tests

**Purpose**: Validate authentication, authorization, data isolation, and attack resistance.

**Framework**: Vitest (dedicated security suite)  
**Existing**: `test/security.test.ts`, `test/rbac-authorization.test.ts`, `test/tenant.test.ts`, `test/compliance.test.ts`

**Test Categories**:

#### 3a. Authentication Security
| Test Case | Priority | Status |
|---|---|---|
| JWT token validation (valid/expired/malformed) | P0 | ✅ Exists |
| Brute force login protection (rate limit: 5/min) | P0 | ✅ Exists |
| Password complexity enforcement | P1 | ⚠️ Check |
| Session fixation prevention | P1 | 🆕 New |
| Token reuse after logout | P1 | 🆕 New |

#### 3b. Authorization (RBAC)
| Test Case | Priority | Status |
|---|---|---|
| 7-role permission matrix (full matrix) | P0 | ✅ Exists |
| Vertical privilege escalation (reception → admin) | P0 | ✅ Exists |
| Horizontal privilege escalation (doctor A → doctor B data) | P0 | 🆕 New |
| API endpoint protection (all 42 routes) | P0 | ⚠️ Partial |

#### 3c. Multi-Tenant Isolation
| Test Case | Priority | Status |
|---|---|---|
| Cross-tenant data access blocked | P0 | ✅ Exists |
| Tenant ID spoofing via header manipulation | P0 | 🆕 New |
| Shared resource isolation (KV, R2) | P1 | 🆕 New |
| Tenant deletion data cleanup | P1 | 🆕 New |

#### 3d. Input Security
| Test Case | Priority | Status |
|---|---|---|
| SQL injection via all input fields | P0 | ✅ Exists (parameterized) |
| XSS via patient name, notes, consultation | P1 | 🆕 New |
| CSRF protection on state-changing endpoints | P1 | 🆕 New |
| File upload validation (photo, PDF) | P1 | 🆕 New |
| Path traversal in file operations | P1 | 🆕 New |

---

### Level 4: End-to-End Tests (Playwright)

**Purpose**: Validate complete user workflows through the browser UI.

**Framework**: Playwright (Chromium, expandable to Firefox/WebKit)  
**Existing**: 20 spec files in `web/e2e/`

**Critical User Journeys**:

| Journey | Personas | Steps | Priority | Status |
|---|---|---|---|---|
| **Patient Registration → Visit → Bill → Payment** | Reception | Register patient → Create visit → Generate bill → Collect payment → Print receipt | P0 | ⚠️ Partial |
| **Lab Order → Result Entry → Report Print** | Reception + Lab | Create bill with tests → Lab sees order → Enter results → Print report | P0 | ✅ `laboratory.spec.ts` |
| **Doctor Consultation → Prescription → Print** | Doctor | See queue → Open patient → Write notes → Create Rx → Print | P0 | ✅ `clinical.spec.ts` |
| **IPD Admission → Daily Charges → Discharge** | Reception + Nurse | Admit patient → Assign bed → Enter vitals → Add charges → Discharge → Final bill | P1 | ⚠️ `ipd-beds.spec.ts` |
| **Pharmacy Dispensing** | Pharmacist | View Rx → Check stock → Dispense → Update inventory → Generate bill | P1 | ✅ `pharmacy.spec.ts` |
| **Accounting Workflow** | Accountant | Record income → Record expense → Create journal → View P&L | P1 | ✅ `accounting.spec.ts` |
| **Staff Invitation → Accept → Login** | Admin | Send invitation → Email received → Accept → Set password → Login | P1 | ⚠️ Partial |
| **Multi-Branch Admin** | Director | Switch branches → View analytics → Compare KPIs | P2 | 🆕 New |
| **Telemedicine Session** | Doctor + Patient | Create session → Join room → End session → View summary | P2 | 🆕 New |
| **AI Medical Chat** | Doctor | Open assistant → Ask question → Get response → Give feedback | P2 | 🆕 New |
| **Insurance Claim Flow** | Reception + Admin | Create claim → Submit → Approve/Reject → Settle bill | P2 | 🆕 New |
| **Director Executive Dashboard** | Director/MD | Login → View KPIs → Revenue reports → Shareholder data | P2 | ✅ `directors.spec.ts` |

**Cross-Browser Matrix** (future):

| Browser | Desktop | Mobile Viewport |
|---|---|---|
| Chromium | ✅ Active | ✅ `responsive.spec.ts` |
| Firefox | ⬜ Planned | ⬜ Planned |
| WebKit (Safari) | ⬜ Planned | ⬜ Planned |

---

### Level 5: Performance & Load Tests (k6)

**Purpose**: Ensure system meets performance SLOs under realistic and extreme load.

**Framework**: k6  
**Existing**: 3 scripts in `load-tests/`

**Performance SLOs**:

| Metric | Target | Measurement |
|---|---|---|
| API response time (p95) | < 500ms | k6 metrics |
| API response time (p99) | < 2s | k6 metrics |
| Login latency (p95) | < 1s | k6 metrics |
| Page load (LCP) | < 2.5s | Lighthouse / Playwright |
| Worker CPU time | < 50ms (free) / < 30s (paid) | Cloudflare Analytics |
| Error rate under load | < 0.1% | k6 metrics |
| D1 query latency (p95) | < 100ms | Custom instrumentation |

**Test Scenarios**:

| Scenario | VUs | Duration | Script | Status |
|---|---|---|---|---|
| **Smoke** | 5 | 1 min | `k6-smoke.js` | ✅ Exists |
| **Normal Load** | 50 | 10 min (staged) | `k6-load.js` | ✅ Exists |
| **Stress** | 300 | 19 min (staged) | `k6-stress.js` | ✅ Exists |
| **Spike** | 0→500→0 | 5 min | 🆕 `k6-spike.js` | 🆕 New |
| **Soak / Endurance** | 30 | 1 hour | 🆕 `k6-soak.js` | 🆕 New |
| **Concurrent Payments** | 100 | 3 min | 🆕 `k6-payments.js` | 🆕 New |

**Scenarios to Add**:
- **Spike test**: Sudden traffic burst (simulates viral sharing of results portal)
- **Soak test**: Sustained load to detect memory/connection leaks over time
- **Payment concurrency**: 100 concurrent payment attempts to verify idempotency

---

### Level 6: Contract & Compliance Tests

**Purpose**: Ensure API contracts, data formats, and regulatory compliance.

**Existing**: `test/api-contract.test.ts`, `test/fhir.test.ts`, `test/compliance.test.ts`

| Category | Scope | Priority | Status |
|---|---|---|---|
| API response schemas | All endpoints return documented shapes | P1 | ✅ Partial |
| FHIR R4 conformance | Patient, Observation, DiagnosticReport resources | P2 | ✅ Exists |
| HIPAA data handling | PHI encryption at rest, access logging | P1 | ⚠️ Check |
| Bangladesh medical regulations | Prescription format, lab report format | P2 | 🆕 New |
| GDPR-style data rights | Patient data export, deletion | P2 | 🆕 New |
| Audit trail completeness | All sensitive operations logged | P1 | ✅ Exists |

---

### Level 7: Resilience & Disaster Recovery Tests

**Purpose**: Validate system behavior under failure conditions.

**Existing**: `test/resilience.test.ts`, `test/disaster-recovery-i18n.test.ts`, `test/migration.test.ts`

| Scenario | Description | Priority | Status |
|---|---|---|---|
| D1 database unavailable | Graceful error handling, not 500 | P1 | ✅ Exists |
| KV namespace unavailable | Rate limiting degrades gracefully | P1 | 🆕 New |
| R2 storage failure | Photo upload shows user-friendly error | P2 | 🆕 New |
| AI service (OpenRouter) timeout | Chat shows fallback message | P2 | 🆕 New |
| Vectorize unavailable | AI memory degrades, chat still works | P2 | 🆕 New |
| Schema migration rollback | Can revert to previous schema version | P1 | ⚠️ Partial |
| Data backup/restore | D1 → R2 export, PITR via Time Travel | P1 | 🆕 New |
| Worker cold start | First request latency acceptable | P2 | 🆕 New |

---

## 4. Test Environment Strategy

### 4.1 Environments

| Environment | Backend | Database | Use Case |
|---|---|---|---|
| **Local Dev** | `wrangler dev` (localhost:8787) | D1 local SQLite | Unit + Integration |
| **CI (GitHub Actions)** | Miniflare / Worker test env | In-memory D1 | Automated PR checks |
| **Staging** | `hms-saas-staging.workers.dev` | Separate D1 + KV + R2 | E2E + Load tests |
| **Production** | `hms-saas-production.workers.dev` | Production D1 | Smoke tests only |

### 4.2 Test Data Strategy

| Data Type | Strategy | Location |
|---|---|---|
| Seed data | SQL seed scripts (demo hospital) | `migrations/seed_demo.sql` |
| Test fixtures | In-test factory functions | `tests/helpers/` |
| Tenant isolation data | Two demo tenants for cross-tenant tests | Test setup |
| Performance data | Generated 10K patients, 50K bills | k6 setup phase |

---

## 5. CI/CD Integration Plan

### 5.1 Pipeline Stages

```
PR Created / Push
    │
    ├── 🔵 Stage 1: Lint + Type Check (< 30s)
    │     ├── TypeScript strict compile (tsc --noEmit)
    │     └── ESLint
    │
    ├── 🟢 Stage 2: Unit Tests (< 2 min)
    │     ├── vitest run (45 files in test/)
    │     └── Coverage report (v8 → lcov)
    │
    ├── 🟡 Stage 3: API Integration Tests (< 5 min)
    │     ├── vitest run (apps/api/tests/ — 36 files)
    │     └── Coverage merge
    │
    ├── 🟠 Stage 4: Security Tests (< 2 min)
    │     ├── RBAC matrix validation
    │     ├── Tenant isolation checks
    │     └── Input sanitization
    │
    ├── 🔴 Stage 5: E2E Tests (< 10 min) [on staging deploy]
    │     ├── Playwright (20 specs, Chromium)
    │     └── Screenshot artifacts on failure
    │
    └── ⚫ Stage 6: Performance (nightly / manual)
          ├── k6 smoke (5 VUs, 1 min)
          └── k6 load (50 VUs, 10 min) [on release branch]
```

### 5.2 Quality Gates

| Gate | Criteria | Blocks Merge? |
|---|---|---|
| Unit test pass | 100% pass rate | ✅ Yes |
| Coverage threshold | ≥ 80% line coverage | ✅ Yes |
| API integration pass | 100% pass rate | ✅ Yes |
| Security tests pass | 100% pass rate | ✅ Yes |
| E2E pass (staging) | ≥ 95% pass rate | ✅ Yes |
| Performance (smoke) | p95 < 2s, 0 errors | ⚠️ Warning only |
| Performance (load) | p95 < 3s, error rate < 0.1% | ⚠️ Warning only |

---

## 6. Test Implementation Priority Roadmap

### Phase 1 — Critical (Week 1-2) 🔴

| # | Action | Files | Risk Coverage |
|---|---|---|---|
| 1 | Add Zod schema unit tests for all 42 routes | `test/validators/*.test.ts` | R01-R09 |
| 2 | Horizontal privilege escalation tests | `test/security.test.ts` | R03, X04 |
| 3 | Concurrent payment stress test | `test/concurrency.test.ts` | R01, X01, X05 |
| 4 | Tenant ID spoofing tests | `test/tenant.test.ts` | R02 |
| 5 | Bill calculation edge cases (rounding, discount > total, negative quantities) | `test/billing.test.ts` | R01 |
| 6 | Complete RBAC matrix coverage (all 42 endpoints × 7 roles) | `test/rbac-authorization.test.ts` | X04 |

### Phase 2 — High Priority (Week 3-4) 🟠

| # | Action | Files | Risk Coverage |
|---|---|---|---|
| 7 | E2E: Full patient journey (register → bill → pay → receipt) | `web/e2e/full-journey.spec.ts` | R01, R08 |
| 8 | E2E: IPD full lifecycle | `web/e2e/ipd-lifecycle.spec.ts` | R06 |
| 9 | Pharmacy concurrent dispensing tests | `test/pharmacy.test.ts` | R04, X01 |
| 10 | Journal balance validation (debit == credit always) | `test/accounting.test.ts` | R07 |
| 11 | k6 spike test script | `load-tests/k6-spike.js` | X03 |
| 12 | k6 payment concurrency script | `load-tests/k6-payments.js` | R01, X01, X05 |
| 13 | Insurance claim lifecycle integration tests | `test/insurance.test.ts` | R01 |

### Phase 3 — Medium Priority (Week 5-6) 🟡

| # | Action | Files | Risk Coverage |
|---|---|---|---|
| 14 | E2E: Telemedicine session (SFU + Jitsi fallback) | `web/e2e/telemedicine.spec.ts` | R10 |
| 15 | AI assistant boundary tests (rate limits, memory limits) | `test/ai.test.ts` | R11 |
| 16 | Resilience: KV/R2/AI service failure graceful degradation | `test/resilience.test.ts` | Level 7 |
| 17 | k6 soak test (1 hour endurance) | `load-tests/k6-soak.js` | X03 |
| 18 | Cross-browser E2E (Firefox + WebKit) | `playwright.config.ts` update | Level 4 |
| 19 | API response contract validation for all endpoints | `test/api-contract.test.ts` | Level 6 |
| 20 | Notification delivery verification (email, push) | `test/notifications.test.ts` | R12 |

### Phase 4 — Low Priority (Week 7-8) 🟢

| # | Action | Files | Risk Coverage |
|---|---|---|---|
| 21 | i18n completeness test (all keys in EN exist in BN) | `test/i18n.test.ts` | R15 |
| 22 | Landing page Lighthouse CI test | `.github/workflows/lighthouse.yml` | R16 |
| 23 | Patient data export/deletion (GDPR) | `test/compliance.test.ts` | Level 6 |
| 24 | Bangladesh regulation format compliance | `test/compliance.test.ts` | Level 6 |
| 25 | Visual regression tests (Playwright screenshots) | `web/e2e/visual/*.spec.ts` | Level 4 |
| 26 | Backup/restore verification | `test/disaster-recovery.test.ts` | Level 7 |

---

## 7. Test Naming Conventions

```
test/
├── unit/                    # Level 1: Pure unit tests
│   ├── validators/          # Zod schema tests
│   ├── utils/               # Utility function tests
│   └── logic/               # Business logic tests
├── integration/             # Level 2: API integration (existing test/ files)
├── security/                # Level 3: Security-specific
├── resilience/              # Level 7: Failure/recovery
└── compliance/              # Level 6: Contract/regulatory

web/e2e/                     # Level 4: Browser E2E
├── journeys/                # Full user journeys
├── modules/                 # Per-module E2E (existing specs)
└── visual/                  # Visual regression

load-tests/                  # Level 5: Performance
├── k6-smoke.js             # Quick validation
├── k6-load.js              # Normal load
├── k6-stress.js            # Breaking point
├── k6-spike.js             # Sudden burst
├── k6-soak.js              # Endurance
└── k6-payments.js          # Concurrency-specific
```

---

## 8. Tools & Framework Summary

| Tool | Purpose | Config Location |
|---|---|---|
| **Vitest** | Unit + Integration tests | `vitest.config.ts`, `apps/api/vitest.config.ts` |
| **Playwright** | E2E browser tests | `web/playwright.config.ts` |
| **k6** | Load/stress/spike testing | `load-tests/` |
| **v8 Coverage** | Code coverage reporting | `vitest.config.ts` → coverage |
| **GitHub Actions** | CI/CD automation | `.github/workflows/` |
| **Sentry** | Error tracking in staging/prod | `toucan-js` integration |
| **Cloudflare Analytics** | Production performance monitoring | Wrangler observability config |

---

## 9. Success Criteria

| Metric | Current | Target |
|---|---|---|
| Total test files | ~101 | ~130+ |
| Unit test coverage | Unknown | ≥ 80% |
| RBAC coverage | Partial | 100% (42 routes × 7 roles) |
| E2E critical journeys | 5 partial | 8 complete |
| Load test scenarios | 3 | 6 |
| Security test coverage | Good | Complete (all categories) |
| CI pipeline time | N/A configured | < 15 min for PR |
| Mean time to detect regression | Unknown | < 30 min (via CI) |

---

## 10. Recommendations

> [!IMPORTANT]
> **Highest priority**: Complete RBAC matrix testing (all endpoints × all roles) and concurrent payment idempotency testing. These cover the most critical financial and security risks.

> [!TIP]
> **Quick wins**: Add Zod schema unit tests — they are fast to write, catch many input validation bugs, and significantly boost coverage metrics.

> [!NOTE]
> **TEA workflow continuity**: After this Test Design, proceed with:
> 1. `bmad-tea-testarch-framework` — Set up any missing test infrastructure
> 2. `bmad-tea-testarch-ci` — Configure the CI/CD pipeline
> 3. `bmad-tea-testarch-atdd` — Write acceptance tests (TDD red phase)
> 4. `bmad-tea-testarch-automate` — Expand automation coverage
> 5. `bmad-tea-testarch-test-review` — Quality audit with scoring
> 6. `bmad-tea-testarch-trace` — Traceability matrix and quality gate

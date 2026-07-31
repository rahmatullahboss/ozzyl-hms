# HMS Production Correctness Testing — Design Spec

> Date: 2026-04-22
> Timeline: 2-4 weeks
> Approach: Hybrid (Gap-Fill + Permission Matrix Generation)
> Scope: All modules, all roles, all risk categories

## Context

Hospital Management System deploying to a real hospital. Full suite active from day one: OPD, IPD, billing, pharmacy, lab, radiology, nursing, emergency, inventory, accounting, queue management. All 8+ roles active with custom permission overrides per tenant and per user.

### Current State

- 409 existing test files (152 unit, 79 integration routes, 46 E2E Playwright, 5 middleware, 39 component)
- Vitest (unit/integration) + Playwright (E2E) + Testing Library (components)
- CI/CD: 6-stage GitHub Actions pipeline (lint → test → build → deploy → smoke → E2E)
- Test infrastructure: fixtures, mock-db, test-app factory, auth helpers
- 400+ REST endpoints across 138 route files
- 120+ database tables, 51 Zod schemas
- 3-tier RBAC: static defaults → tenant overrides → user overrides

### Gaps Identified

- No systematic RBAC permission boundary testing across all endpoints
- No cross-module golden path workflow tests
- No data integrity tests (concurrent writes, double-submit, referential constraints)
- No security/OWASP testing
- No load/stress testing (k6 config exists but unused)
- Limited edge case coverage at Zod schema boundaries

## Architecture: 7 Test Layers

### Layer 1: RBAC Permission Matrix (Generated)

Auto-generate tests from route definitions to verify every role against every endpoint.

**Mechanism:**
1. A generator script scans `src/routes/tenant/*.ts` and extracts:
   - Route path and HTTP method
   - `requireRole()` / `requirePermission()` middleware arguments
2. Produces a matrix: `{ endpoint, method, allowedRoles[], deniedRoles[] }`
3. Generates Vitest test file: `test/generated/rbac-matrix.test.ts`
4. Also produces reference doc: `docs/rbac-permission-matrix.md`

**Coverage:**
- Every tenant endpoint tested with all 8 roles + super_admin
- Authorized → 200/201, Unauthorized → 403
- Tenant isolation: Role from Tenant A cannot access Tenant B data
- 3-tier override chain:
  - Test 1: Static default permissions behave correctly
  - Test 2: Tenant-level override grants permission that default denies → now allowed
  - Test 3: Tenant-level override revokes permission that default allows → now denied
  - Test 4: User-level override grants permission that tenant denies → now allowed
  - Test 5: User-level override revokes permission that tenant allows → now denied
- Horizontal escalation: User A (doctor) cannot access User B's (doctor) patient panel in same tenant
- super_admin and hospital_admin bypass all checks

**Estimated tests:** 800-1200 (generated, not hand-written)
**Location:** `test/generated/rbac-matrix.test.ts`, generator at `tools/generate-rbac-tests.ts`

### Layer 2: Golden Path E2E Workflows

Cross-module integration tests following real hospital workflows end-to-end. Playwright API tests (not browser) for speed.

**Workflows:**

1. **OPD Flow** (`test/e2e/workflows/opd-flow.spec.ts`)
   - Register patient → Add to queue → Create appointment → Doctor starts visit → Record vitals + chief complaint → Write prescription → Pharmacy dispenses → Generate bill → Accept payment
   - Assertions at each step: patient status changes, queue position updates, stock decrements after dispense, bill amount matches prescription items

2. **IPD Flow** (`test/e2e/workflows/ipd-flow.spec.ts`)
   - Emergency registration → Triage → Admit to bed → Assign doctor → Nursing: record vitals, administer medication (MAR) → Order lab tests → Receive lab results → Order radiology → Receive radiology report → Doctor writes progress notes → Discharge → Final bill with itemized charges
   - Assertions: bed status changes (available → occupied → available), MAR records medication administration times, lab results linked to correct patient visit

3. **Lab Flow** (`test/e2e/workflows/lab-flow.spec.ts`)
   - Doctor orders test → Lab tech receives order → Sample collection recorded → Machine sends result (HL7/ASTM payload) → Result parsed and stored → Tech verifies result → Report generated → Notification sent to ordering doctor
   - Assertions: HL7 OBX fields decoded correctly, abnormal flags set, result linked to correct order

4. **Billing Flow** (`test/e2e/workflows/billing-flow.spec.ts`)
   - Create invoice → Add line items (consultation, lab, pharmacy, bed charges) → Apply discount → Submit insurance claim → Record partial payment → Record remaining payment → Generate receipt → Cancel invoice → Process refund
   - Assertions: running total accuracy, payment balance decrements, refund restores balance, cancelled invoice excluded from reports

5. **Pharmacy Flow** (`test/e2e/workflows/pharmacy-flow.spec.ts`)
   - Doctor creates prescription → Pharmacist reviews → Check drug interactions → Dispense medication → Stock deducted → Stock falls below reorder level → Reorder alert generated → New PO created → GR received → Stock replenished
   - Assertions: stock count accuracy at each step, drug interaction flag raised, reorder threshold triggers alert

**Estimated tests:** 50-75
**Location:** `test/e2e/workflows/`

### Layer 3: Data Integrity Tests

Verify data correctness under concurrent and edge conditions.

**Test categories:**

1. **Double-submit prevention**
   - Submit same bill payment twice simultaneously → only one charge created
   - Dispense same prescription twice simultaneously → only one stock deduction
   - Book same appointment slot twice simultaneously → only one booking succeeds

2. **Concurrent edit handling**
   - Two nurses update same patient vitals simultaneously → last write wins, both writes audited
   - Two pharmacists dispense same prescription → only one succeeds, other gets conflict error

3. **Soft delete consistency**
   - Delete a patient → GET returns 404
   - Deleted patient excluded from search results, dashboard counts, reports
   - Admin can restore → patient reappears with all history intact
   - Cascade behavior: deleting a visit soft-deletes associated prescriptions, lab orders

4. **Referential integrity**
   - Cannot delete patient with active admission
   - Cannot delete doctor with future appointments
   - Cannot delete medicine with pending prescriptions
   - Cannot delete bed currently occupied

5. **Audit trail completeness**
   - Every POST/PUT/DELETE operation creates audit log entry
   - Audit entry contains: user_id, tenant_id, action, entity, entity_id, timestamp, before/after values

6. **Financial accuracy**
   - Billing totals calculated with proper decimal precision (no floating point drift)
   - Inventory stock counts: sum of all transactions equals current stock
   - Pharmacy: dispensed quantity never exceeds prescribed quantity
   - Accounting: debits equal credits for every transaction

**Estimated tests:** 40-60
**Location:** `test/integration/data-integrity/*.test.ts`

### Layer 4: Edge Case & Error Handling

Boundary testing at system interfaces.

**Categories:**

1. **Zod schema boundaries**
   - Every schema tested with: min values, max values, empty strings, null, undefined, wrong types, extra fields
   - Focus on clinical fields: dosage amounts, vital sign ranges, lab result values

2. **Workflow interruption**
   - What happens if admission is created but bed assignment fails midway?
   - What happens if payment recorded but receipt generation fails?
   - Verify partial state is either rolled back or recoverable

3. **Rate limiting**
   - Login endpoint: 5 failures → lockout behavior verified
   - API burst: 100 requests in 1 second → rate limit response (429)

4. **Subscription/tenant edge cases**
   - Expired subscription → appropriate features disabled
   - Suspended tenant → all endpoints return 403 with suspension message
   - Inactive tenant → cannot create new records

5. **Missing/malformed data**
   - API calls with missing required fields → proper 400 error with field-level messages
   - Oversized payloads (100KB clinical note) → handled gracefully
   - Unicode/RTL text in patient names → stored and retrieved correctly

**Estimated tests:** 60-80
**Location:** `test/integration/edge-cases/*.test.ts`

### Layer 5: Existing Tests (Preserved)

All 409 existing tests remain. No modifications unless a gap is found during implementation.

- 152 unit tests
- 79 integration route tests
- 46 E2E Playwright tests
- 5 middleware tests
- 39 component tests
- 88 other (real-db, fixtures, helpers)

### Layer 6: Security / OWASP Testing

**Attack vectors tested:**

1. **SQL Injection**
   - All text input fields tested with: `'; DROP TABLE--`, `' OR '1'='1`, `UNION SELECT`, nested injection in JSON
   - Drizzle ORM parameterizes queries, but we verify at the Zod validation boundary and at the response level

2. **Authentication bypass**
   - Expired JWT → 401
   - Tampered JWT (modified payload, wrong signature) → 401
   - Missing Authorization header → 401
   - JWT from Tenant A used against Tenant B endpoint → 403
   - Revoked/rotated token → 401

3. **Broken access control**
   - Horizontal: Doctor A accessing Doctor B's patient list → 403
   - Vertical: Receptionist calling `/admin/` endpoints → 403
   - IDOR: Incrementing entity IDs to access other tenant's data → 403 or 404

4. **XSS (Stored)**
   - Patient name: `<script>alert('xss')</script>` → stored sanitized, returned escaped
   - Clinical notes with HTML/script tags → sanitized
   - Address fields with event handlers → stripped

5. **Mass assignment**
   - POST/PUT with extra fields: `role`, `tenant_id`, `is_admin` → ignored or rejected
   - Verify Zod `.strict()` or `.strip()` behavior on all schemas

6. **Sensitive data exposure**
   - No password hashes in any API response
   - No JWT secrets or internal tokens in error messages
   - Patient data not leaked in error stack traces

7. **CORS validation**
   - Requests from unauthorized origins → rejected
   - Preflight OPTIONS requests → correct allowed methods/headers

**Estimated tests:** 40-50
**Location:** `test/security/*.test.ts`

### Layer 7: Load & Stress Testing

Using k6 targeting production or staging URL.

**Scenarios:**

1. **Baseline (10 concurrent users, 2 minutes)**
   - Top 20 endpoints by usage frequency
   - Pass: p95 < 500ms for CRUD, p95 < 2s for reports/search

2. **Concurrent operations (50 users, 5 minutes)**
   - 50 simultaneous appointment bookings
   - 50 simultaneous billing submissions
   - 50 simultaneous pharmacy dispenses
   - Pass: zero data corruption, no duplicate records

3. **Spike test (10 → 100 users in 30 seconds)**
   - Simulates morning rush (all staff logging in, patients arriving)
   - Pass: no 5xx errors, graceful degradation if rate-limited

4. **Endurance (20 users, 30 minutes)**
   - Steady load over time
   - Pass: no memory leaks, no connection pool exhaustion, consistent response times

5. **Database stress**
   - Complex queries under load: patient search with 10+ filters, billing reports spanning 6 months, lab result aggregation
   - Pass: p95 < 3s for complex queries

**Estimated scripts:** 10-15
**Location:** `test/load/*.js`
**CI integration:** Manual gate before production release (not in automated CI — too slow)

## File Structure

```
test/
├── generated/
│   └── rbac-matrix.test.ts          # Auto-generated from routes
├── integration/
│   ├── routes/                       # Existing 79 files
│   ├── middleware/                    # Existing 5 files
│   ├── data-integrity/
│   │   ├── concurrent-operations.test.ts
│   │   ├── soft-delete.test.ts
│   │   ├── referential-integrity.test.ts
│   │   ├── audit-trail.test.ts
│   │   └── financial-accuracy.test.ts
│   └── edge-cases/
│       ├── schema-boundaries.test.ts
│       ├── workflow-interruption.test.ts
│       ├── rate-limiting.test.ts
│       ├── tenant-states.test.ts
│       └── malformed-input.test.ts
├── security/
│   ├── sql-injection.test.ts
│   ├── auth-bypass.test.ts
│   ├── access-control.test.ts
│   ├── xss.test.ts
│   ├── mass-assignment.test.ts
│   ├── data-exposure.test.ts
│   └── cors.test.ts
├── e2e/
│   ├── workflows/
│   │   ├── opd-flow.spec.ts
│   │   ├── ipd-flow.spec.ts
│   │   ├── lab-flow.spec.ts
│   │   ├── billing-flow.spec.ts
│   │   └── pharmacy-flow.spec.ts
│   └── ...existing e2e tests
├── load/
│   ├── baseline.js
│   ├── concurrent-operations.js
│   ├── spike.js
│   ├── endurance.js
│   └── database-stress.js
└── ...existing test files

tools/
└── generate-rbac-tests.ts            # RBAC matrix generator

docs/
└── rbac-permission-matrix.md         # Generated reference doc
```

## CI/CD Changes

Extend existing `.github/workflows/ci-cd.yml`:

```
Stage 2 (existing, extended):
  pnpm test                            # Unit + integration (existing)
  pnpm test:integration                # Route + middleware (existing)
  + pnpm test -- test/integration/data-integrity/
  + pnpm test -- test/integration/edge-cases/
  + pnpm test -- test/security/
  + pnpm test -- test/generated/

Stage 5 (existing): Post-deploy smoke tests

Stage 6 (existing, extended):
  + playwright test --project=workflows  # Golden path E2E

Manual (pre-release):
  k6 run test/load/baseline.js
  k6 run test/load/concurrent-operations.js
```

## Implementation Order

| Phase | Layer | Duration | Dependencies |
|-------|-------|----------|-------------|
| 1 | RBAC Matrix Generator + Tests | 3-4 days | Route scanning, existing test infra |
| 2 | Golden Path E2E Workflows | 3-4 days | Working production/staging deploy |
| 3 | Data Integrity Tests | 2-3 days | MockDB, existing fixtures |
| 4 | Edge Case Tests | 2-3 days | Zod schemas, existing test-app |
| 5 | Security/OWASP Tests | 2 days | Existing test-app, JWT lib |
| 6 | Load/Stress Tests | 1-2 days | k6, production/staging URL |
| **Total** | | **14-18 days** | |

## Success Criteria

- All RBAC matrix tests pass (every role × every endpoint)
- All 5 golden path workflows pass end-to-end
- Zero data corruption under concurrent operations
- All security tests pass (no injection, no bypass, no data leak)
- Load tests meet p95 thresholds
- Existing 409 tests still passing (no regressions)
- CI pipeline completes in under 20 minutes (excluding load tests)

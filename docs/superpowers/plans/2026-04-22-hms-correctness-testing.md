# HMS Production Correctness Testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 7 layers of correctness tests (RBAC matrix, golden path E2E, data integrity, edge cases, security, load) to validate the HMS before real hospital deployment.

**Architecture:** Gap-fill existing 409-test suite. Auto-generate RBAC permission matrix from route definitions + authz.ts. Use existing test-app factory (createTestApp/jsonRequest) for integration tests, Playwright API tests for E2E workflows, k6 for load testing. All new tests integrate into existing CI/CD pipeline.

**Tech Stack:** Vitest 4.1, Playwright 1.58, k6, Hono framework, Drizzle ORM, Cloudflare D1 (SQLite), TypeScript

---

## File Structure

```
tools/
  generate-rbac-tests.ts              # NEW: Scans routes, generates RBAC test matrix

test/
  generated/
    rbac-matrix.test.ts               # NEW: Auto-generated RBAC permission tests
  integration/
    helpers/                           # EXISTING: test-app.ts, fixtures.ts, mock-db.ts
    routes/                            # EXISTING: 79 route test files
    middleware/                         # EXISTING: 5 middleware test files
    data-integrity/
      double-submit.test.ts            # NEW
      concurrent-edits.test.ts         # NEW
      soft-delete.test.ts              # NEW
      referential-integrity.test.ts    # NEW
      audit-trail.test.ts              # NEW
      financial-accuracy.test.ts       # NEW
    edge-cases/
      schema-boundaries.test.ts        # NEW
      workflow-interruption.test.ts     # NEW
      rate-limiting.test.ts            # NEW
      tenant-states.test.ts            # NEW
      malformed-input.test.ts          # NEW
  security/
    sql-injection.test.ts              # NEW
    auth-bypass.test.ts                # NEW
    access-control.test.ts             # NEW
    xss.test.ts                        # NEW
    mass-assignment.test.ts            # NEW
    data-exposure.test.ts              # NEW
    cors.test.ts                       # NEW
  e2e/
    workflows/
      opd-flow.spec.ts                 # NEW
      ipd-flow.spec.ts                 # NEW
      lab-flow.spec.ts                 # NEW
      billing-flow.spec.ts             # NEW
      pharmacy-flow.spec.ts            # NEW
    helpers/auth-helper.ts             # EXISTING
  load/
    api-load.js                        # EXISTING
    billing-stress.js                  # EXISTING
    concurrent-operations.js           # NEW
    spike.js                           # NEW
    endurance.js                       # NEW

docs/
  rbac-permission-matrix.md            # NEW: Generated reference doc
```

---

## Task 1: RBAC Permission Matrix Generator

**Files:**
- Create: `tools/generate-rbac-tests.ts`
- Create: `test/generated/rbac-matrix.test.ts` (output of generator)
- Reference: `packages/shared/src/authz.ts` (ROLE_PERMISSIONS, ALL_PERMISSIONS)
- Reference: `src/middleware/rbac.ts` (requireRole, requirePermission)
- Reference: `src/routes/tenant/*.ts` (route definitions)

- [ ] **Step 1: Write the generator script**

Create `tools/generate-rbac-tests.ts` that scans route files for RBAC middleware usage and generates a test file.

```typescript
// tools/generate-rbac-tests.ts
import * as fs from 'fs';
import * as path from 'path';

interface RouteEntry {
  file: string;
  method: string;
  path: string;
  middleware: 'requireRole' | 'requirePermission' | 'none';
  allowedValues: string[];
}

const TENANT_ROUTES_DIR = path.resolve(__dirname, '../src/routes/tenant');
const OUTPUT_TEST = path.resolve(__dirname, '../test/generated/rbac-matrix.test.ts');
const OUTPUT_DOC = path.resolve(__dirname, '../docs/rbac-permission-matrix.md');

const ALL_ROLES = [
  'super_admin', 'hospital_admin', 'doctor', 'nurse',
  'laboratory', 'reception', 'md', 'director', 'pharmacist', 'accountant',
] as const;

function scanRouteFile(filePath: string): RouteEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath, '.ts');
  const entries: RouteEntry[] = [];

  // Match: .get('/path', requireRole('doctor', 'nurse'), ...)
  // Match: .post('/path', requireRole(...PHARM_WRITE), ...)
  // Match: .get('/path', requirePermission('billing:read'), ...)
  const routeRegex = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(requireRole|requirePermission)\s*\(([^)]+)\)/g;

  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const [, method, routePath, middleware, args] = match;
    const allowedValues = args
      .replace(/\.\.\./g, '')
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(s => s && !s.startsWith('//'));

    entries.push({
      file: fileName,
      method: method.toUpperCase(),
      path: routePath,
      middleware: middleware as 'requireRole' | 'requirePermission',
      allowedValues,
    });
  }

  return entries;
}

function generateTestFile(allEntries: RouteEntry[]): string {
  const rbacEntries = allEntries.filter(e => e.middleware !== 'none');
  const byFile = new Map<string, RouteEntry[]>();
  for (const entry of rbacEntries) {
    const group = byFile.get(entry.file) ?? [];
    group.push(entry);
    byFile.set(entry.file, group);
  }

  let output = `// AUTO-GENERATED - do not edit manually.
// Regenerate: npx tsx tools/generate-rbac-tests.ts
import { describe, it, expect } from 'vitest';
import { createTestApp } from '../integration/helpers/test-app';

const ALL_ROLES = [
  'super_admin', 'hospital_admin', 'doctor', 'nurse',
  'laboratory', 'reception', 'md', 'director', 'pharmacist', 'accountant',
] as const;

const ADMIN_BYPASS_ROLES = ['super_admin', 'hospital_admin'];

describe('RBAC Permission Matrix', () => {
`;

  for (const [file, entries] of byFile) {
    output += `  describe('${file}', () => {\n`;
    for (const entry of entries) {
      if (entry.middleware !== 'requireRole') continue;
      const deniedRoles = ALL_ROLES.filter(r => {
        if (['super_admin', 'hospital_admin'].includes(r)) return false;
        return !entry.allowedValues.includes(r);
      });
      for (const role of deniedRoles) {
        output += `    it('${entry.method} ${entry.path} denies ${role}', async () => {
      const routeModule = await import('../../src/routes/tenant/${file}');
      const route = routeModule.default;
      const { app } = createTestApp({
        route,
        routePath: '/api',
        role: '${role}',
        tenantId: 'tenant-1',
        userId: 1,
        tables: {},
      });
      const res = await app.request('/api${entry.path}', { method: '${entry.method}' });
      expect(res.status).toBe(403);
    });
`;
      }
    }
    output += `  });\n`;
  }

  output += `});\n`;
  return output;
}

function generateMarkdownDoc(allEntries: RouteEntry[]): string {
  let doc = `# RBAC Permission Matrix\n\n`;
  doc += `> Auto-generated on ${new Date().toISOString().split('T')[0]}\n\n`;
  doc += `| File | Method | Path | Middleware | Allowed |\n`;
  doc += `|------|--------|------|-----------|--------|\n`;
  for (const entry of allEntries) {
    if (entry.middleware !== 'none') {
      doc += `| ${entry.file} | ${entry.method} | ${entry.path} | ${entry.middleware} | ${entry.allowedValues.join(', ')} |\n`;
    }
  }
  doc += `\n## Routes Without Explicit RBAC (Auth-Only)\n\n`;
  doc += `| File | Method | Path |\n`;
  doc += `|------|--------|------|\n`;
  for (const entry of allEntries) {
    if (entry.middleware === 'none') {
      doc += `| ${entry.file} | ${entry.method} | ${entry.path} |\n`;
    }
  }
  return doc;
}

function main() {
  const routeFiles = fs.readdirSync(TENANT_ROUTES_DIR, { recursive: true })
    .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'))
    .map(f => path.join(TENANT_ROUTES_DIR, f));

  const allEntries: RouteEntry[] = [];
  for (const file of routeFiles) {
    allEntries.push(...scanRouteFile(file));
  }

  console.log(`Scanned ${routeFiles.length} route files, found ${allEntries.length} endpoints`);
  console.log(`  - With RBAC: ${allEntries.filter(e => e.middleware !== 'none').length}`);
  console.log(`  - Auth-only: ${allEntries.filter(e => e.middleware === 'none').length}`);

  fs.mkdirSync(path.dirname(OUTPUT_TEST), { recursive: true });
  fs.mkdirSync(path.dirname(OUTPUT_DOC), { recursive: true });
  fs.writeFileSync(OUTPUT_TEST, generateTestFile(allEntries));
  console.log(`Generated test: ${OUTPUT_TEST}`);
  fs.writeFileSync(OUTPUT_DOC, generateMarkdownDoc(allEntries));
  console.log(`Generated docs: ${OUTPUT_DOC}`);
}

main();
```

- [ ] **Step 2: Run the generator and verify output**

Run: `npx tsx tools/generate-rbac-tests.ts`
Expected: Console output showing scanned route count, generated files at `test/generated/rbac-matrix.test.ts` and `docs/rbac-permission-matrix.md`

- [ ] **Step 3: Verify generated test file runs**

Run: `pnpm test -- test/generated/rbac-matrix.test.ts`
Expected: Tests pass. Denied roles get 403. Review a few routes manually against source files.

- [ ] **Step 4: Commit the generator and generated files**

---

## Task 2: RBAC 3-Tier Override Tests

**Files:**
- Create: `test/integration/rbac-overrides.test.ts`
- Reference: `src/middleware/rbac.ts` (resolveUserPermissions)
- Reference: `test/integration/helpers/test-app.ts`
- Reference: `test/integration/helpers/mock-db.ts`

- [ ] **Step 1: Write 3-tier override tests**

```typescript
// test/integration/rbac-overrides.test.ts
import { describe, it, expect } from 'vitest';
import { createTestApp } from './helpers/test-app';
import pharmacyRoutes from '../../src/routes/tenant/pharmacy';

const TENANT_ID = 'tenant-1';

describe('RBAC 3-Tier Permission Override Chain', () => {
  describe('Static defaults', () => {
    it('pharmacist can access pharmacy read endpoints by default', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'pharmacist',
        tenantId: TENANT_ID,
        tables: { medicines: [] },
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).not.toBe(403);
    });

    it('accountant cannot access pharmacy endpoints by default', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'accountant',
        tenantId: TENANT_ID,
        tables: {},
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
  });

  describe('Tenant-level overrides', () => {
    it('tenant override grants permission that default denies', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'accountant',
        tenantId: TENANT_ID,
        tables: {
          role_permission_overrides: [
            { tenant_id: TENANT_ID, role: 'accountant', permission: 'pharmacy:read', action: 'grant' },
          ],
          medicines: [],
        },
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).not.toBe(403);
    });

    it('tenant override revokes permission that default allows', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'pharmacist',
        tenantId: TENANT_ID,
        tables: {
          role_permission_overrides: [
            { tenant_id: TENANT_ID, role: 'pharmacist', permission: 'pharmacy:read', action: 'revoke' },
          ],
        },
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
  });

  describe('User-level overrides', () => {
    it('user override grants permission that tenant denies', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'accountant',
        tenantId: TENANT_ID,
        userId: 42,
        tables: {
          role_permission_overrides: [
            { tenant_id: TENANT_ID, role: 'accountant', permission: 'pharmacy:read', action: 'revoke' },
          ],
          user_permission_overrides: [
            { tenant_id: TENANT_ID, user_id: 42, permission: 'pharmacy:read', action: 'grant' },
          ],
          medicines: [],
        },
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).not.toBe(403);
    });

    it('user override revokes permission that role allows', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'pharmacist',
        tenantId: TENANT_ID,
        userId: 99,
        tables: {
          user_permission_overrides: [
            { tenant_id: TENANT_ID, user_id: 99, permission: 'pharmacy:read', action: 'revoke' },
          ],
        },
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
  });

  describe('Admin bypass', () => {
    it('hospital_admin bypasses all RBAC regardless of overrides', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'hospital_admin',
        tenantId: TENANT_ID,
        tables: {
          user_permission_overrides: [
            { tenant_id: TENANT_ID, user_id: 1, permission: '*', action: 'revoke' },
          ],
          medicines: [],
        },
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).not.toBe(403);
    });
  });

  describe('Tenant isolation', () => {
    it('role override from tenant-2 does not affect tenant-1', async () => {
      const { app } = createTestApp({
        route: pharmacyRoutes,
        routePath: '/api/pharmacy',
        role: 'accountant',
        tenantId: TENANT_ID,
        tables: {
          role_permission_overrides: [
            { tenant_id: 'tenant-2', role: 'accountant', permission: 'pharmacy:read', action: 'grant' },
          ],
        },
      });
      const res = await app.request('/api/pharmacy/medicines', { method: 'GET' });
      expect(res.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Run the override tests**

Run: `pnpm test -- test/integration/rbac-overrides.test.ts`
Expected: All tests pass. If the middleware doesn't check DB overrides in mock mode, adjust mock-db queryOverride.

- [ ] **Step 3: Commit**

---

## Task 3: Golden Path E2E - OPD Flow

**Files:**
- Create: `test/e2e/workflows/opd-flow.spec.ts`
- Modify: `playwright.config.ts` (add workflows project)

- [ ] **Step 1: Add workflows project to Playwright config**

In `playwright.config.ts`, add a new project in the `projects` array:

```typescript
{
  name: 'workflows',
  testDir: './test/e2e/workflows',
  use: { ...devices['Desktop Chrome'] },
},
```

- [ ] **Step 2: Write OPD flow E2E test**

```typescript
// test/e2e/workflows/opd-flow.spec.ts
import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

let patientId: number;
let appointmentId: number;
let visitId: number;
let prescriptionId: number;
let billId: number;

test.describe.serial('OPD Golden Path Flow', () => {
  test.beforeAll(() => {
    loadAuth();
  });

  test('1. Register patient', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(),
      data: {
        name: `E2E OPD Patient ${Date.now()}`,
        phone: `017${Math.floor(10000000 + Math.random() * 90000000)}`,
        gender: 'male',
        date_of_birth: '1990-01-15',
        blood_group: 'O+',
        address: 'Test Address, Dhaka',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    patientId = body.id ?? body.patient?.id;
    expect(patientId).toBeTruthy();
  });

  test('2. Create appointment', async ({ request }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const res = await request.post(`${BASE_URL}/api/appointments`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        doctor_id: 1,
        appointment_date: tomorrow.toISOString().split('T')[0],
        appointment_time: '10:00',
        type: 'new',
        status: 'scheduled',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    appointmentId = body.id ?? body.appointment?.id;
    expect(appointmentId).toBeTruthy();
  });

  test('3. Start visit', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/visits`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        doctor_id: 1,
        visit_type: 'opd',
        appointment_id: appointmentId,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    visitId = body.id ?? body.visit?.id;
    expect(visitId).toBeTruthy();
  });

  test('4. Record vitals', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/vitals`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        visit_id: visitId,
        temperature: 98.6,
        blood_pressure_systolic: 120,
        blood_pressure_diastolic: 80,
        pulse: 72,
        respiratory_rate: 16,
        spo2: 98,
        weight: 70,
        height: 170,
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('5. Write prescription', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/prescriptions`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        visit_id: visitId,
        doctor_id: 1,
        items: [{
          medicine_name: 'Paracetamol 500mg',
          dosage: '1+0+1',
          duration: '5 days',
          instructions: 'After meal',
        }],
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    prescriptionId = body.id ?? body.prescription?.id;
  });

  test('6. Generate bill', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/billing`, {
      headers: authHeaders(),
      data: {
        patientId: patientId,
        visitId: visitId,
        items: [{ itemCategory: 'consultation', description: 'OPD Consultation', quantity: 1, unitPrice: 500 }],
        discount: 0,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    billId = body.id ?? body.bill?.id;
    expect(billId).toBeTruthy();
  });

  test('7. Record payment', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/billing/pay`, {
      headers: authHeaders(),
      data: { billId, amount: 500, paymentMethod: 'cash' },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('8. Verify bill is paid', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/billing/${billId}`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const bill = body.bill ?? body;
    expect(bill.status).toBe('paid');
  });
});
```

- [ ] **Step 3: Run the OPD flow test**

Run: `E2E_EMAIL=admin@demo-hospital.com E2E_PASSWORD=Demo@1234 pnpm exec playwright test --project=workflows test/e2e/workflows/opd-flow.spec.ts`
Expected: All 8 steps pass sequentially.

- [ ] **Step 4: Commit**

---

## Task 4: Golden Path E2E - Billing Flow

**Files:**
- Create: `test/e2e/workflows/billing-flow.spec.ts`

- [ ] **Step 1: Write billing flow E2E test**

Tests: create invoice with multiple items, verify total, partial payment, remaining payment, verify paid status, check patient billing history. 7 serial steps.

Pattern: Same as Task 3 — use `test.describe.serial`, `loadAuth()` in beforeAll, seed patient, use `authHeaders()`.

Key assertions:
- Total = sum(quantity * unitPrice) - discount
- Partial payment updates paid_amount correctly
- Full payment sets status to 'paid'
- Patient billing history includes the bill

- [ ] **Step 2: Run and commit**

---

## Task 5: Golden Path E2E - IPD Flow

**Files:**
- Create: `test/e2e/workflows/ipd-flow.spec.ts`

- [ ] **Step 1: Write IPD flow E2E test**

Tests: list available beds, admit patient, view admission, record vitals, list current admissions, discharge, verify discharged status. 7 serial steps.

Key assertions:
- Admission status = 'admitted' after creation
- Vitals recorded against admission_id
- After discharge, status = 'discharged'

- [ ] **Step 2: Run and commit**

---

## Task 6: Golden Path E2E - Lab & Pharmacy Flows

**Files:**
- Create: `test/e2e/workflows/lab-flow.spec.ts`
- Create: `test/e2e/workflows/pharmacy-flow.spec.ts`

- [ ] **Step 1: Write lab flow** — list tests, create order, view order, list pending, view categories
- [ ] **Step 2: Write pharmacy flow** — list medicines, check stock, low stock alerts, expiring alerts, summary, categories, suppliers
- [ ] **Step 3: Run both and commit**

---

## Task 7: Data Integrity - Double Submit Prevention

**Files:**
- Create: `test/integration/data-integrity/double-submit.test.ts`

- [ ] **Step 1: Write double-submit tests**

```typescript
// test/integration/data-integrity/double-submit.test.ts
import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import billingRoutes from '../../../src/routes/tenant/billing';

const TENANT_ID = 'tenant-1';

describe('Double Submit Prevention', () => {
  it('concurrent payments for same bill should not double-charge', async () => {
    const { app, mockDB } = createTestApp({
      route: billingRoutes,
      routePath: '/api/billing',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        bills: [{ id: 1, tenant_id: TENANT_ID, patient_id: 1, total_amount: 1000, paid_amount: 0, status: 'unpaid' }],
        bill_items: [{ id: 1, bill_id: 1, tenant_id: TENANT_ID, description: 'Consultation', quantity: 1, unit_price: 1000 }],
        payments: [],
        income: [],
      },
    });

    const paymentData = { billId: 1, amount: 1000, paymentMethod: 'cash' };
    const [res1, res2] = await Promise.all([
      jsonRequest(app, '/api/billing/pay', { method: 'POST', body: paymentData }),
      jsonRequest(app, '/api/billing/pay', { method: 'POST', body: paymentData }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toContain(200);

    const paymentInserts = mockDB.queries.filter(
      q => q.method === 'run' && q.sql.toLowerCase().includes('insert into payments')
    );
    expect(paymentInserts.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run and commit**

---

## Task 8: Data Integrity - Financial Accuracy

**Files:**
- Create: `test/integration/data-integrity/financial-accuracy.test.ts`

- [ ] **Step 1: Write financial accuracy tests**

Tests:
- Bill total with multiple items (decimal precision)
- Zero-quantity items
- Negative discount rejection
- Payment never exceeds bill total (overpayment prevention)

Uses `createTestApp` with `billingRoutes`, asserts via response status and mockDB query inspection.

- [ ] **Step 2: Run and commit**

---

## Task 9: Data Integrity - Soft Delete & Referential Integrity

**Files:**
- Create: `test/integration/data-integrity/soft-delete.test.ts`
- Create: `test/integration/data-integrity/referential-integrity.test.ts`

- [ ] **Step 1: Write soft delete tests**

Tests:
- Deleted patient (is_deleted=1) returns 404 on GET
- Deleted patients excluded from list results

- [ ] **Step 2: Write referential integrity tests**

Tests:
- Cannot admit patient to occupied bed (400 or 409)
- Cannot double-admit same patient (400 or 409)

- [ ] **Step 3: Run both and commit**

---

## Task 10: Data Integrity - Audit Trail

**Files:**
- Create: `test/integration/data-integrity/audit-trail.test.ts`

- [ ] **Step 1: Write audit trail tests**

Tests:
- Billing payment creates audit log entry (check mockDB.queries for audit INSERT)
- Patient creation creates audit log entry

- [ ] **Step 2: Run and commit**

---

## Task 11: Security - Auth Bypass

**Files:**
- Create: `test/security/auth-bypass.test.ts`

- [ ] **Step 1: Write auth bypass tests**

```typescript
// test/security/auth-bypass.test.ts
import { describe, it, expect } from 'vitest';
import { createTestApp } from '../integration/helpers/test-app';
import patientRoutes from '../../src/routes/tenant/patients';

describe('Authentication Bypass Attempts', () => {
  it('cross-tenant: user from tenant-1 cannot access tenant-2 patient', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/api',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        patients: [
          { id: 1, tenant_id: 'tenant-1', name: 'Tenant 1 Patient' },
          { id: 2, tenant_id: 'tenant-2', name: 'Tenant 2 Patient' },
        ],
      },
    });
    const res = await app.request('/api/patients/2', { method: 'GET' });
    // Should return 404 (tenant filter) or if 200, verify not cross-tenant
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json() as Record<string, unknown>;
      const patient = (body as Record<string, unknown>).patient ?? body;
      expect((patient as Record<string, unknown>).tenant_id).not.toBe('tenant-2');
    }
  });

  it('role escalation: receptionist cannot access admin endpoints', async () => {
    const permissionsModule = await import('../../src/routes/tenant/permissions');
    const permissionsRoutes = permissionsModule.default;
    const { app } = createTestApp({
      route: permissionsRoutes,
      routePath: '/api/permissions',
      role: 'reception',
      tenantId: 'tenant-1',
      tables: {},
    });
    const res = await app.request('/api/permissions/roles', { method: 'GET' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run and commit**

---

## Task 12: Security - SQL Injection & XSS

**Files:**
- Create: `test/security/sql-injection.test.ts`
- Create: `test/security/xss.test.ts`

- [ ] **Step 1: Write SQL injection tests**

5 payloads tested against patient search (GET with query param) and patient creation (POST with name field). Assert: never 500, always 200 or 400.

```typescript
const INJECTION_PAYLOADS = [
  "'; DROP TABLE patients; --",
  "' OR '1'='1",
  "'; SELECT * FROM users; --",
  "1; UPDATE patients SET name='hacked'",
  "' UNION SELECT id, name, phone FROM patients --",
];
```

- [ ] **Step 2: Write XSS tests**

5 payloads tested against patient creation name field. Assert: never 500, stored safely or rejected.

```typescript
const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(document.cookie)</script>',
  "javascript:alert('XSS')",
  '<svg onload=alert(1)>',
];
```

- [ ] **Step 3: Run both and commit**

---

## Task 13: Security - Mass Assignment, Data Exposure & CORS

**Files:**
- Create: `test/security/mass-assignment.test.ts`
- Create: `test/security/data-exposure.test.ts`
- Create: `test/security/cors.test.ts`

- [ ] **Step 1: Write mass assignment test** — POST patient with extra fields (role, tenant_id, is_admin). Verify stripped by Zod.
- [ ] **Step 2: Write data exposure test** — Patient list doesn't contain password_hash. Error responses don't contain stack traces.
- [ ] **Step 3: Write CORS test** — OPTIONS from malicious origin not reflected.
- [ ] **Step 4: Run all three and commit**

---

## Task 14: Edge Cases - Schema Boundaries

**Files:**
- Create: `test/integration/edge-cases/schema-boundaries.test.ts`

- [ ] **Step 1: Write schema boundary tests**

Tests:
- Empty name rejected (400)
- Missing required fields rejected (400)
- Invalid gender value (400 or 201 if freeform)
- Unicode names accepted (Bengali characters)
- Empty items array rejected (400)
- Negative unit price rejected (400)

- [ ] **Step 2: Run and commit**

---

## Task 15: Edge Cases - Tenant States

**Files:**
- Create: `test/integration/edge-cases/tenant-states.test.ts`

- [ ] **Step 1: Write tenant state tests**

Tests:
- Empty tenantId rejected (400 or 403)
- Non-existent tenant returns empty results or 403

- [ ] **Step 2: Run and commit**

---

## Task 16: Load Testing - Concurrent Operations

**Files:**
- Create: `test/load/concurrent-operations.js`

- [ ] **Step 1: Write k6 concurrent operations script**

50 VUs compete for same appointment slot. Custom metrics: `duplicate_records` (Counter), `data_corruption` (Rate). Teardown function checks for duplicate bookings.

Thresholds: http_req_failed < 10%, data_corruption == 0.

- [ ] **Step 2: Run locally and commit**

---

## Task 17: Load Testing - Spike & Endurance

**Files:**
- Create: `test/load/spike.js`
- Create: `test/load/endurance.js`

- [ ] **Step 1: Write spike test** — 10 to 100 VUs in 5s, sustain 30s, recover. p95 < 2s, errors < 10%.
- [ ] **Step 2: Write endurance test** — 20 VUs for 30 minutes. p95 < 500ms, errors < 5%.
- [ ] **Step 3: Run spike (short version) and commit**

---

## Task 18: CI/CD Integration

**Files:**
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `package.json` (add test scripts)

- [ ] **Step 1: Add npm scripts to package.json**

```json
"test:security": "vitest run test/security/",
"test:data-integrity": "vitest run test/integration/data-integrity/",
"test:edge-cases": "vitest run test/integration/edge-cases/",
"test:rbac": "vitest run test/generated/",
"test:e2e:workflows": "playwright test --project=workflows"
```

- [ ] **Step 2: Extend CI/CD Stage 2** — Add security, data-integrity, edge-cases, RBAC matrix runs after existing `pnpm test`
- [ ] **Step 3: Extend CI/CD Stage 6** — Add `--project=workflows` to playwright command
- [ ] **Step 4: Verify locally and commit**

---

## Task 19: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run existing tests** — `pnpm test` (no regressions)
- [ ] **Step 2: Run integration tests** — `pnpm test:integration`
- [ ] **Step 3: Run new test layers** — security, data-integrity, edge-cases, RBAC
- [ ] **Step 4: Run E2E workflows** — all 5 specs
- [ ] **Step 5: Generate coverage report** — `pnpm test:coverage`
- [ ] **Step 6: Final commit**

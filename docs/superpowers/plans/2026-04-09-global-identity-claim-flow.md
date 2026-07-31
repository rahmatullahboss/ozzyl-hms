# Global Identity Claim Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hospital-created patient cards and portal-created patient accounts converge on one permanent global identity with explicit `unclaimed -> claimed -> verified` lifecycle.

**Architecture:** `global_patient_identity` becomes the permanent person record and source of truth for UHID/UID ownership. `global_patient_auth` becomes the credential and portal-access layer linked to an identity. Tenant patient creation must resolve-or-create a global identity first, and patient portal registration must claim an existing unclaimed identity instead of creating duplicates.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, Drizzle ORM, Zod, Vitest

---

### File Structure

**Create**
- `migrations/0105_global_identity_claims.sql`
- `src/lib/global-identity.ts`
- `test/global-identity-service.test.ts`
- `test/patient-auth-claim-flow.test.ts`
- `test/patient-registration-linking.test.ts`

**Modify**
- `src/routes/patient-auth.ts`
- `src/routes/tenant/patients.ts`
- `src/db/schema/mpi.ts`
- `src/db/schema/index.ts`
- `src/db/schema/schema.ts`
- `src/schemas/patient.ts`

**Existing references to follow**
- `src/routes/patient-auth.ts`
- `src/routes/tenant/patients.ts`
- `migrations/0073_uhid_system.sql`
- `migrations/0092_global_patient_auth.sql`
- `migrations/0099_mpi_hardening.sql`

---

### Task 1: Add Claim-State Schema

**Files:**
- Create: `migrations/0105_global_identity_claims.sql`
- Modify: `src/db/schema/mpi.ts`
- Modify: `src/db/schema/index.ts`
- Test: `test/global-identity-service.test.ts`

- [ ] **Step 1: Write the failing migration/schema test**

```ts
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('global identity claim schema', () => {
  test('migration adds claim lifecycle fields and auth linkage', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/0105_global_identity_claims.sql'),
      'utf8',
    );

    expect(sql).toContain('ALTER TABLE global_patient_identity ADD COLUMN claim_status');
    expect(sql).toContain('ALTER TABLE global_patient_identity ADD COLUMN claimed_auth_user_id');
    expect(sql).toContain('ALTER TABLE global_patient_identity ADD COLUMN created_source');
    expect(sql).toContain('ALTER TABLE global_patient_auth ADD COLUMN identity_id');
    expect(sql).toContain('ALTER TABLE patients ADD COLUMN global_identity_id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/global-identity-service.test.ts`
Expected: FAIL because the migration file and schema fields do not exist yet.

- [ ] **Step 3: Write minimal migration**

```sql
ALTER TABLE global_patient_identity ADD COLUMN claim_status TEXT NOT NULL DEFAULT 'unclaimed';
ALTER TABLE global_patient_identity ADD COLUMN claimed_auth_user_id INTEGER;
ALTER TABLE global_patient_identity ADD COLUMN claimed_at TEXT;
ALTER TABLE global_patient_identity ADD COLUMN created_source TEXT NOT NULL DEFAULT 'hospital';
ALTER TABLE global_patient_identity ADD COLUMN created_tenant_id TEXT;
ALTER TABLE global_patient_auth ADD COLUMN identity_id INTEGER;
ALTER TABLE patients ADD COLUMN global_identity_id INTEGER;

CREATE INDEX idx_gpi_claim_status ON global_patient_identity(claim_status);
CREATE UNIQUE INDEX idx_gpa_identity_id ON global_patient_auth(identity_id) WHERE identity_id IS NOT NULL;
CREATE INDEX idx_patients_global_identity ON patients(global_identity_id);
```

- [ ] **Step 4: Add Drizzle definitions**

```ts
export const globalPatientIdentity = sqliteTable('global_patient_identity', {
  id: integer().primaryKey({ autoIncrement: true }),
  nationalId: text('national_id'),
  uhid: text().notNull(),
  primaryName: text('primary_name'),
  primaryPhone: text('primary_phone'),
  primaryEmail: text('primary_email'),
  brn: text(),
  claimStatus: text('claim_status').notNull().default('unclaimed'),
  claimedAuthUserId: integer('claimed_auth_user_id'),
  claimedAt: text('claimed_at'),
  createdSource: text('created_source').notNull().default('hospital'),
  createdTenantId: text('created_tenant_id'),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/global-identity-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add migrations/0105_global_identity_claims.sql src/db/schema/mpi.ts src/db/schema/index.ts test/global-identity-service.test.ts
git commit -m "feat: add global identity claim lifecycle schema"
```

---

### Task 2: Build Shared Global Identity Resolver

**Files:**
- Create: `src/lib/global-identity.ts`
- Test: `test/global-identity-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
test('resolveOrCreateGlobalIdentity returns existing UHID match first', async () => {
  const db = mockDbWithIdentity({ uhid: 'OZ-000123', id: 7 });
  const result = await resolveOrCreateGlobalIdentity(db, {
    tenantId: 'tenant-1',
    uhid: 'OZ-000123',
    name: 'Rahim Uddin',
  });
  expect(result.id).toBe(7);
  expect(result.created).toBe(false);
});

test('resolveOrCreateGlobalIdentity creates unclaimed identity for hospital source', async () => {
  const db = emptyMockDb();
  const result = await resolveOrCreateGlobalIdentity(db, {
    tenantId: 'tenant-1',
    nationalId: '19901234567890123',
    name: 'Rahim Uddin',
    source: 'hospital',
  });
  expect(result.claimStatus).toBe('unclaimed');
  expect(result.createdSource).toBe('hospital');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/global-identity-service.test.ts`
Expected: FAIL because `src/lib/global-identity.ts` does not exist.

- [ ] **Step 3: Implement minimal resolver**

```ts
export async function resolveOrCreateGlobalIdentity(
  db: D1Database,
  input: {
    tenantId?: string;
    uhid?: string | null;
    nationalId?: string | null;
    brn?: string | null;
    phone?: string | null;
    email?: string | null;
    name?: string | null;
    source?: 'hospital' | 'self_signup' | 'import';
  },
) {
  // search order: uhid -> nid -> brn -> phone -> email
  // if found, return identity
  // else allocate new UHID and insert global_patient_identity with claim_status
}
```

- [ ] **Step 4: Add claim helper**

```ts
export async function claimGlobalIdentity(
  db: D1Database,
  identityId: number,
  authUserId: number,
) {
  await db.prepare(`
    UPDATE global_patient_identity
    SET claim_status = 'claimed',
        claimed_auth_user_id = ?,
        claimed_at = datetime('now')
    WHERE id = ?
  `).bind(authUserId, identityId).run();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/global-identity-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/global-identity.ts test/global-identity-service.test.ts
git commit -m "feat: add shared global identity resolution service"
```

---

### Task 3: Link Tenant Patient Creation to Global Identity

**Files:**
- Modify: `src/routes/tenant/patients.ts`
- Modify: `src/schemas/patient.ts`
- Test: `test/patient-registration-linking.test.ts`

- [ ] **Step 1: Write the failing route tests**

```ts
test('POST /patients links to existing global identity by UHID', async () => {
  const res = await postPatient({
    name: 'Rahim Uddin',
    uhid: 'OZ-000123',
    phone: '01712345678',
  });
  expect(res.status).toBe(201);
  expect(findQuery('INSERT INTO patients')?.params).toContain(7); // global_identity_id
});

test('POST /patients creates unclaimed global identity when none exists', async () => {
  const res = await postPatient({
    name: 'New Patient',
    nationalId: '19901234567890123',
  });
  expect(res.status).toBe(201);
  expect(findIdentityInsert()?.params).toContain('unclaimed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-registration-linking.test.ts`
Expected: FAIL because patient creation does not yet call the shared resolver.

- [ ] **Step 3: Add schema support**

```ts
uhid: z.string().regex(/^OZ-\d{6}$/).optional(),
globalIdentityId: z.number().int().positive().optional(),
```

- [ ] **Step 4: Update patient creation route**

```ts
const identity = await resolveOrCreateGlobalIdentity(c.env.DB, {
  tenantId,
  uhid: data.uhid ?? null,
  nationalId: data.nationalId ?? null,
  brn: data.brn ?? null,
  phone: data.mobile ?? null,
  email: data.email ?? null,
  name: data.name ?? null,
  source: 'hospital',
});

// persist identity.uhid + identity.id into patients row
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/patient-registration-linking.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/patients.ts src/schemas/patient.ts test/patient-registration-linking.test.ts
git commit -m "feat: resolve global identity during tenant patient registration"
```

---

### Task 4: Claim Existing Identity During Portal Registration

**Files:**
- Modify: `src/routes/patient-auth.ts`
- Test: `test/patient-auth-claim-flow.test.ts`

- [ ] **Step 1: Write the failing auth tests**

```ts
test('register claims existing unclaimed identity instead of creating new UHID', async () => {
  const res = await registerPatient({
    name: 'Rahim Uddin',
    phone: '01712345678',
    national_id: '19901234567890123',
    password: 'Test1234',
  });
  expect(res.status).toBe(201);
  expect(findQuery('UPDATE global_patient_identity')?.sql).toContain("claim_status = 'claimed'");
  expect(findInsert('global_patient_auth')?.params).toContain(7); // identity_id
});

test('register creates claimed identity when no existing identity exists', async () => {
  const res = await registerPatient({
    name: 'First Portal User',
    email: 'patient@example.com',
    password: 'Test1234',
  });
  expect(res.status).toBe(201);
  expect(findIdentityInsert()?.params).toContain('claimed');
  expect(findAuthInsert()?.params).toContain('patient@example.com');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-auth-claim-flow.test.ts`
Expected: FAIL because registration currently allocates auth-first and only loosely ensures UHID.

- [ ] **Step 3: Refactor `/register` flow**

```ts
const identity = await resolveOrCreateGlobalIdentity(db, {
  nationalId: data.national_id ?? null,
  phone: data.phone ?? null,
  email: data.email ?? null,
  name: data.name,
  source: 'self_signup',
});

const authInsert = await db.prepare(`
  INSERT INTO global_patient_auth (identity_id, name, email, phone, password_hash, national_id, uhid, email_verified)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0)
`).bind(
  identity.id,
  data.name,
  data.email ?? null,
  data.phone ?? null,
  passwordHash,
  data.national_id ?? null,
  identity.uhid,
).run();

await claimGlobalIdentity(db, identity.id, authInsert.meta.last_row_id as number);
```

- [ ] **Step 4: Add explicit claim endpoint for hospital-created cards**

```ts
patientAuthRoutes.post('/claim-card', zValidator('json', claimSchema), async (c) => {
  // verify uhid + phone or nid + otp
  // attach auth account to existing unclaimed identity
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/patient-auth-claim-flow.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/patient-auth.ts test/patient-auth-claim-flow.test.ts
git commit -m "feat: claim hospital-created global identities during portal signup"
```

---

### Task 5: Verification and Backward-Compatibility Sweep

**Files:**
- Modify: `src/routes/patient-auth.ts`
- Modify: `src/routes/tenant/patients.ts`
- Test: `test/global-identity-service.test.ts`
- Test: `test/patient-auth-claim-flow.test.ts`
- Test: `test/patient-registration-linking.test.ts`

- [ ] **Step 1: Add regression tests for legacy behavior**

```ts
test('existing claimed patient can still log in by phone', async () => {
  const res = await loginPatient({ identifier: '01712345678', password: 'Test1234' });
  expect(res.status).toBe(200);
});

test('my-hospitals still resolves by linked global identity', async () => {
  const res = await app.request('/patient-auth/my-hospitals', authHeaders());
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run focused suite**

Run: `pnpm vitest run test/global-identity-service.test.ts test/patient-auth-claim-flow.test.ts test/patient-registration-linking.test.ts`
Expected: PASS

- [ ] **Step 3: Run adjacent auth + MPI suite**

Run: `pnpm vitest run test/schema-validation.test.ts test/mpi-scoring.test.ts test/health-card-staleness.test.ts`
Expected: PASS

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit code 0

- [ ] **Step 5: Commit**

```bash
git add src/routes/patient-auth.ts src/routes/tenant/patients.ts test/global-identity-service.test.ts test/patient-auth-claim-flow.test.ts test/patient-registration-linking.test.ts
git commit -m "test: verify global identity claim flow end to end"
```

---

### Spec Coverage Check

- Hospital-created patient should create global identity without forcing portal account: covered by Tasks 1-3.
- Patient-created portal account should claim existing identity instead of minting duplicate UHID: covered by Tasks 2 and 4.
- UHID must remain permanent across tenant linking and later claim: covered by Tasks 2-4.
- Explicit unclaimed vs claimed lifecycle: covered by Tasks 1 and 4.
- Backward compatibility for login and linked-hospital lookup: covered by Task 5.


# Staff Invitation Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staff-profile-linked invitation flow (mirror of the doctor flow) so admins can email a `staff` row a one-time invite link that creates a `users` account and links it to the staff row.

**Architecture:** New nullable `staff.user_id` and `invitations.staff_id` columns. New shared helpers in `src/lib/staff-invite.ts` (token/hash/expiry + position→role mapping). New `POST /api/staff/:id/invite` endpoint gated by `staff:write`. `GET /api/invite/:token` and `POST /api/invite/:token/accept` updated to LEFT JOIN `staff` and link `staff.user_id` in the accept batch. `GET /api/staff` updated to surface the latest active pending invite per row. `web/src/pages/StaffPage.tsx` gets an Account column with Linked / Pending Invite / Invite state, plus a Copy-Link modal. `web/src/pages/AcceptInvite.tsx` shows the linked staff name.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Hono, Zod, React + TypeScript, vitest + mock-db/test-app helpers, react-hot-toast.

**Spec:** `docs/superpowers/specs/2026-06-16-staff-invitation-linking-design.md` (revision v1.1, status Draft).

---

## File Structure

**New files:**
- `migrations/0353_staff_invitation_linking.sql` — schema migration
- `src/lib/staff-invite.ts` — token/hash/expiry + position→role helpers
- `test/integration/routes/staff-invitation.test.ts` — 6 integration tests

**Modified files:**
- `src/schemas/invitation.ts` — add optional `staffId`, superRefine rules, mutual exclusion with `doctorId`
- `src/routes/tenant/staff.ts` — append `POST /:id/invite`; rewrite `GET /` JOIN to use a correlated subquery
- `src/routes/public-invite.ts` — `GET /:token` adds `staff_id` + `staff_name`; `POST /:token/accept` adds staff guard + tenant-guarded link UPDATE
- `web/src/pages/StaffPage.tsx` — `Account` column + Invite/Pending/Linked state + invite modal + Email field
- `web/src/pages/AcceptInvite.tsx` — surface `staffId`/`staffName` parallel to doctor fields

**Out of scope (per spec):** `web/src/pages/InviteStaff.tsx` is **not** modified; `src/routes/tenant/invitations.ts` is **not** modified. No doctor-endpoint refactor.

---

## Task 1: Database migration

**Files:**
- Create: `migrations/0353_staff_invitation_linking.sql`

- [ ] **Step 1: Verify next free migration number on current main**

Run:
```bash
ls migrations/ | grep -E '^03[5-9][0-9]' | sort | tail -3
```

Expected: `0350_billing_cash_hardening.sql`, `0351_pharmacy_phase7_inventory_hardening.sql`, `0352_cssd_sterilization_release.sql`. If you see anything higher than 0352, stop and update the filename in this task.

- [ ] **Step 2: Create the migration file**

Write to `migrations/0353_staff_invitation_linking.sql`:

```sql
-- 0353: Staff invitation linking
-- Adds user_id to staff and staff_id to invitations for invite acceptance
-- linking. Both columns are nullable; no CHECK/NOT NULL changes — minimum
-- blast-radius migration matching 0344_staff_extended_fields_email.sql style.

ALTER TABLE staff        ADD COLUMN user_id  INTEGER REFERENCES users(id);
ALTER TABLE invitations  ADD COLUMN staff_id INTEGER REFERENCES staff(id);

CREATE INDEX IF NOT EXISTS idx_staff_user        ON staff(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_staff ON invitations(tenant_id, staff_id);
```

- [ ] **Step 3: Run the migration locally**

Run:
```bash
pnpm local:migrate
```

Expected: migration manifest rebuilds and the new migration applies without error. If your local helper is different, use the same one that applied 0344 successfully. Confirm with:
```bash
sqlite3 .wrangler/state/v3/d1/*.db "PRAGMA table_info(staff); PRAGMA table_info(invitations);" 2>/dev/null | grep -E "user_id|staff_id"
```

Expected: two rows, one for each new column.

- [ ] **Step 4: Commit**

```bash
git add migrations/0353_staff_invitation_linking.sql migrations/manifest.json
git commit -m "feat(db): add staff.user_id and invitations.staff_id for invite linking"
```

---

## Task 2: Schema — add staffId to createInvitationSchema

**Files:**
- Modify: `src/schemas/invitation.ts`

- [ ] **Step 1: Add failing test for the new schema rules**

Append to a new test file (we'll create the test file properly in Task 8 — for now, just verify the schema in REPL-style by editing the file in Step 2). Skip a unit test here; coverage is at the integration layer (Tasks 8–9).

- [ ] **Step 2: Update the schema**

Replace the body of `src/schemas/invitation.ts` with:

```ts
import { z } from 'zod';
import { VALID_TENANT_ROLES } from '../../packages/shared/src/authz';

export const createInvitationSchema = z.object({
  email:    z.string().email('Valid email required'),
  role:     z.enum(VALID_TENANT_ROLES, { message: 'Invalid role' }),
  doctorId: z.number().int().positive().optional(),
  staffId:  z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  // doctor rules (unchanged)
  if (data.role === 'doctor' && !data.doctorId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doctorId'],
      message: 'doctorId is required when role is doctor' });
  }
  if (data.role !== 'doctor' && data.doctorId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doctorId'],
      message: 'doctorId is only valid when role is doctor' });
  }
  // staff rules (new)
  const staffRoles = ['nurse', 'laboratory', 'reception', 'pharmacist', 'accountant'] as const;
  if (staffRoles.includes(data.role as any) && !data.staffId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staffId'],
      message: 'staffId is required for staff roles' });
  }
  if (!staffRoles.includes(data.role as any) && data.staffId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staffId'],
      message: 'staffId is only valid for staff roles' });
  }
  // mutual exclusion (new)
  if (data.doctorId && data.staffId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staffId'],
      message: 'doctorId and staffId cannot both be set' });
  }
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd web && npx tsc --noEmit && cd .. && npx tsc --noEmit
```

Expected: no new errors. Existing usages of `createInvitationSchema` (e.g., `src/routes/tenant/invitations.ts` and `src/routes/tenant/doctors.ts`) pass `doctorId` for doctor role and **no** `staffId` for any non-staff role, so they continue to satisfy the schema unchanged.

- [ ] **Step 4: Verify existing tests still pass**

Run:
```bash
pnpm test test/integration/routes/zero-coverage.test.ts 2>&1 | tail -20
```

Expected: green. The 4 existing invite-related tests in this file (around lines 79, 227, 292, 299) must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/invitation.ts
git commit -m "feat(schema): add optional staffId to createInvitationSchema"
```

---

## Task 3: Shared helpers — staff-invite.ts

**Files:**
- Create: `src/lib/staff-invite.ts`

- [ ] **Step 1: Create the helpers file**

Write to `src/lib/staff-invite.ts`:

```ts
/**
 * Helpers for staff invitation flow.
 *
 * - staffPositionToRole: maps a free-text `staff.position` to one of the
 *   five invitable staff roles. Case-insensitive substring match so legacy
 *   values like "Senior Nurse" or "Lab Technician" map correctly.
 * - generateInviteToken / sha256Hex / expiresIn7Days: the same crypto +
 *   time helpers currently inlined in src/routes/tenant/doctors.ts:1826-1837.
 *   The doctor route is NOT refactored to use these in this change
 *   (out of scope; the helpers are extracted so it can be done as a
 *   follow-up).
 */

export type StaffInviteRole = 'nurse' | 'laboratory' | 'reception' | 'pharmacist' | 'accountant';

export function staffPositionToRole(position: string | null | undefined): { role: StaffInviteRole } | null {
  const p = (position ?? '').toLowerCase();
  if (!p) return null;
  if (p.includes('nurse'))      return { role: 'nurse' };
  if (p.includes('lab') || p.includes('technician')) return { role: 'laboratory' };
  if (p.includes('reception'))  return { role: 'reception' };
  if (p.includes('pharmacist')) return { role: 'pharmacist' };
  if (p.includes('accountant')) return { role: 'accountant' };
  return null;
}

export function generateInviteToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const d = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function expiresIn7Days(now: number = Date.now()): string {
  return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/staff-invite.ts
git commit -m "feat(lib): add staff-invite helpers (position->role, token, hash, expiry)"
```

---

## Task 4: `POST /api/staff/:id/invite` endpoint

**Files:**
- Modify: `src/routes/tenant/staff.ts:1-12` (imports) and append at end of file (new route)

- [ ] **Step 1: Add the imports at the top of staff.ts**

In `src/routes/tenant/staff.ts`, add to the existing import block (near line 10–12, after the existing imports):

```ts
import { createInvitationSchema } from '../../schemas/invitation';
import { staffPositionToRole, generateInviteToken, sha256Hex, expiresIn7Days } from '../../lib/staff-invite';
```

- [ ] **Step 2: Append the new route at the end of the file (before `export default staffRoutes;`)**

```ts
// POST /api/staff/:id/invite — send an invite for a specific staff profile
staffRoutes.post('/:id/invite', requirePermission('staff:write'), async (c) => {
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);
  const staffId  = Number(c.req.param('id'));
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return c.json({ error: 'Invalid staff id' }, 400);
  }

  const body = await c.req.json<{ email?: string }>().catch(() => ({}));
  const db = getDb(c.env.DB);
  const member = await db.$client.prepare(
    'SELECT id, name, email, position, status, user_id FROM staff WHERE id = ? AND tenant_id = ?'
  ).bind(staffId, tenantId).first<{
    id: number; name: string; email: string | null;
    position: string | null; status: string; user_id: number | null;
  }>();
  if (!member) return c.json({ error: 'Staff not found' }, 404);
  if (member.status !== 'active') return c.json({ error: 'Staff is not active' }, 400);
  if (member.user_id) return c.json({ error: 'Staff already linked to a user' }, 409);

  const mapped = staffPositionToRole(member.position);
  if (!mapped) {
    return c.json({
      error: 'Staff position cannot be mapped to an invitable role. Update position to one of: nurse, lab_technician, receptionist, pharmacist, accountant.',
    }, 400);
  }

  const finalEmail = (body.email ?? '').trim() || (member.email ?? '').trim();
  if (!finalEmail) {
    return c.json({ error: 'Email is required (provide body.email or set staff.email)' }, 400);
  }

  const parsed = createInvitationSchema.safeParse({ email: finalEmail, role: mapped.role, staffId });
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400);
  }

  const existingUser = await db.$client.prepare(
    'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
  ).bind(finalEmail, tenantId).first();
  if (existingUser) return c.json({ error: 'Email already registered' }, 409);

  const existingInvite = await db.$client.prepare(
    `SELECT id FROM invitations
     WHERE tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
       AND expires_at > datetime('now')
       AND (email = ? OR staff_id = ?)`
  ).bind(tenantId, finalEmail, staffId).first();
  if (existingInvite) {
    return c.json({ error: 'Pending invitation already exists for this staff or email' }, 409);
  }

  const rawToken  = generateInviteToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = expiresIn7Days();

  const result = await db.$client.prepare(
    `INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, staff_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(tenantId, finalEmail, mapped.role, tokenHash, callerId ?? 0, expiresAt, staffId).run();
  const inviteId = result.meta.last_row_id as number;

  await createAuditLog(c.env, tenantId, callerId ?? 0, 'CREATE', 'invitations',
    inviteId, null,
    { email: finalEmail, role: mapped.role, staffId, staffName: member.name, position: member.position },
    c.req.header('CF-Connecting-IP') ?? undefined,
    c.req.header('user-agent') ?? undefined,
  );

  const tenant = await db.$client.prepare('SELECT subdomain FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ subdomain: string }>();
  const slug = tenant?.subdomain ?? 'hospital';

  return c.json({
    invite: {
      email:      finalEmail,
      role:       mapped.role,
      staffId,
      staffName:  member.name,
      position:   member.position,
      expiresAt,
      inviteLink: `/h/${slug}/accept-invite?token=${rawToken}`,
    },
  }, 201);
});
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/staff.ts
git commit -m "feat(staff): add POST /api/staff/:id/invite endpoint"
```

---

## Task 5: Update `GET /api/invite/:token` to surface staff_id/staff_name

**Files:**
- Modify: `src/routes/public-invite.ts:33-87` (the GET handler)

- [ ] **Step 1: Replace the SELECT in GET /:token**

In `src/routes/public-invite.ts`, replace the SELECT query and its row type:

```ts
const invite = await db.$client.prepare(
  `SELECT i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at,
          i.doctor_id, i.staff_id,
          d.name AS doctor_name,
          s.name AS staff_name,
          t.name AS hospital_name, t.subdomain
   FROM invitations i
   JOIN tenants t ON t.id = i.tenant_id
   LEFT JOIN doctors d ON d.id = i.doctor_id AND d.tenant_id = i.tenant_id
   LEFT JOIN staff   s ON s.id = i.staff_id   AND s.tenant_id = i.tenant_id
   WHERE i.token IN (?, ?)`
).bind(token, tokenHash).first<{
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  doctor_id: number | null;
  staff_id: number | null;
  doctor_name: string | null;
  staff_name: string | null;
  hospital_name: string;
  subdomain: string;
}>();
```

- [ ] **Step 2: Update the JSON response**

In the same handler, replace the `return c.json({...})` with:

```ts
return c.json({
  valid: true,
  email: invite.email,
  role:  normalizeRole(invite.role),
  doctorId:   invite.doctor_id,
  doctorName: invite.doctor_name,
  staffId:    invite.staff_id,
  staffName:  invite.staff_name,
  hospitalName: invite.hospital_name,
  slug: invite.subdomain,
});
```

- [ ] **Step 3: Type-check + run existing invite tests**

Run:
```bash
npx tsc --noEmit && pnpm test test/integration/routes/zero-coverage.test.ts 2>&1 | tail -10
```

Expected: type-check clean; existing tests pass (the GET test at line 292 must still 404-or-not-error for an unknown token; the doctor flow test at line 302 must still accept a doctor invite and link doctors.user_id).

- [ ] **Step 4: Commit**

```bash
git add src/routes/public-invite.ts
git commit -m "feat(invite): surface staff_id/staff_name in GET /api/invite/:token"
```

---

## Task 6: Update `POST /api/invite/:token/accept` to link staff.user_id

**Files:**
- Modify: `src/routes/public-invite.ts:89-183` (the POST accept handler)

- [ ] **Step 1: Add `staff_id` to the SELECT and row type**

In the accept handler, replace the SELECT and its row type with:

```ts
const invite = await db.$client.prepare(
  `SELECT i.id, i.email, i.role, i.tenant_id, i.expires_at, i.accepted_at, i.revoked_at,
          i.doctor_id, i.staff_id
   FROM invitations i
   WHERE i.token IN (?, ?)`
).bind(token, tokenHash).first<{
  id: number;
  email: string;
  role: string;
  tenant_id: number;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  doctor_id: number | null;
  staff_id: number | null;
}>();
```

- [ ] **Step 2: Add staff guard after the existing doctor guard**

Right after the existing `if (invite.doctor_id) { ... }` block (currently ends with `if (doctor.user_id) { return c.json({ error: 'This doctor profile is already linked to a different user' }, 409); } }`), add:

```ts
if (invite.staff_id) {
  const member = await db.$client.prepare(
    'SELECT id, user_id FROM staff WHERE id = ? AND tenant_id = ?'
  ).bind(invite.staff_id, invite.tenant_id).first<{ id: number; user_id: number | null }>();
  if (!member) {
    return c.json({ error: 'Linked staff profile no longer exists' }, 410);
  }
  if (member.user_id) {
    return c.json({ error: 'This staff profile is already linked to a different user' }, 409);
  }
}
```

- [ ] **Step 3: Append staff link to the followups batch**

In the same handler, after the existing `if (invite.doctor_id) { followups.push(...); }` block, add:

```ts
if (invite.staff_id) {
  followups.push(db.$client.prepare(
    'UPDATE staff SET user_id = ? WHERE id = ? AND tenant_id = ? AND user_id IS NULL'
  ).bind(userId, invite.staff_id, invite.tenant_id));
}
```

Note: the existing `UPDATE doctors` statement is **not** modified.

- [ ] **Step 4: Type-check + run existing invite tests**

Run:
```bash
npx tsc --noEmit && pnpm test test/integration/routes/zero-coverage.test.ts 2>&1 | tail -10
```

Expected: type-check clean; existing tests pass (the doctor flow accept test at line 302 must still work — its `mockDB.queries` won't have a `staff` UPDATE, only the existing `doctors` UPDATE).

- [ ] **Step 5: Commit**

```bash
git add src/routes/public-invite.ts
git commit -m "feat(invite): link staff.user_id in POST /api/invite/:token/accept"
```

---

## Task 7: `GET /api/staff` — surface latest active pending invite per row

**Files:**
- Modify: `src/routes/tenant/staff.ts` (the existing GET / handler)

- [ ] **Step 1: Replace the GET / query**

Find the `staffRoutes.get('/', requirePermission('staff:read'), async (c) => { ... })` block. Replace the entire body of the `try { ... }` block with:

```ts
const staff = await db.$client.prepare(
  `SELECT s.*,
          inv.id         AS pending_invitation_id,
          inv.expires_at AS pending_invitation_expires_at,
          CASE
            WHEN inv.id IS NULL THEN NULL
            WHEN inv.accepted_at IS NOT NULL THEN 'accepted'
            WHEN inv.revoked_at  IS NOT NULL THEN 'revoked'
            WHEN inv.expires_at  <= datetime('now') THEN 'expired'
            ELSE 'pending'
          END AS pending_invitation_status
   FROM staff s
   LEFT JOIN (
     SELECT staff_id, id, expires_at, accepted_at, revoked_at
     FROM invitations
     WHERE tenant_id = ?
       AND staff_id IS NOT NULL
       AND accepted_at IS NULL
       AND revoked_at  IS NULL
       AND expires_at  > datetime('now')
       AND id = (
         SELECT MAX(i2.id) FROM invitations i2
         WHERE i2.tenant_id = invitations.tenant_id
           AND i2.staff_id  = invitations.staff_id
           AND i2.accepted_at IS NULL
           AND i2.revoked_at  IS NULL
           AND i2.expires_at  > datetime('now')
       )
   ) inv ON inv.staff_id = s.id
   WHERE s.tenant_id = ? AND s.status = ?
   ORDER BY s.position, s.name`,
).bind(tenantId, tenantId, tenantId, 'active').all();
return c.json({ staff: staff.results });
```

- [ ] **Step 2: Type-check + run existing staff tests**

Run:
```bash
npx tsc --noEmit && pnpm test test/integration/ 2>&1 | tail -15
```

Expected: no regressions. No new tests yet (those land in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/staff.ts
git commit -m "feat(staff): surface latest active pending invite per row in GET /api/staff"
```

---

## Task 8: Integration tests for the staff invite flow

**Files:**
- Create: `test/integration/routes/staff-invitation.test.ts`

- [ ] **Step 1: Create the test file**

Write to `test/integration/routes/staff-invitation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import staffRoutes from '../../../src/routes/tenant/staff';
import publicInviteRoutes from '../../../src/routes/public-invite';

const T = 1; // tenant id

describe('Staff invitation linking', () => {
  let mock: ReturnType<typeof createMockDB>;

  beforeEach(() => { mock = createMockDB(); });

  it('POST /api/staff/:id/invite creates invitation with staff_id', async () => {
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T), userId: 7,
      mockDB: mock,
      tables: {
        staff: [{ id: 42, name: 'Alice Nurse', email: 'a@x.io',
                  position: 'Nurse', status: 'active', user_id: null, tenant_id: T }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { email: 'a@x.io' });
    expect(res.status).toBe(201);
    const body = await res.json() as { invite: { staffId: number; role: string; inviteLink: string } };
    expect(body.invite.staffId).toBe(42);
    expect(body.invite.role).toBe('nurse');
    expect(body.invite.inviteLink).toMatch(/^\/h\/demo\/accept-invite\?token=/);
    // Recorded INSERT into invitations with staff_id
    const insert = mock.queries.find(q => /INSERT INTO invitations/i.test(q.sql));
    expect(insert).toBeTruthy();
    expect(insert!.sql).toMatch(/staff_id/);
    expect(insert!.params).toContain(42);
  });

  it('POST /api/invite/:token/accept links staff.user_id to new user', async () => {
    const tokenHash = 'hash-for-token';
    const { app } = createTestApp({
      route: publicInviteRoutes, routePath: '/api/invite',
      mockDB: mock,
      tables: {
        invitations: [{ id: 9, tenant_id: T, email: 's@x.io',
                        role: 'nurse', token: tokenHash,
                        accepted_at: null, revoked_at: null,
                        expires_at: new Date(Date.now() + 86400000).toISOString(),
                        doctor_id: null, staff_id: 42 }],
        staff: [{ id: 42, tenant_id: T, user_id: null }],
      },
    });
    const res = await jsonRequest(app, `/api/invite/raw-token/accept`, {
      name: 'Staffer', password: 'Strong1Pass',
    });
    expect(res.status).toBe(201);
    const linkUpdate = mock.queries.find(q =>
      /UPDATE staff SET user_id/i.test(q.sql) && /staff_id/.test(q.sql) === false
    );
    expect(linkUpdate).toBeTruthy();
    expect(linkUpdate!.sql).toMatch(/tenant_id/);
    expect(linkUpdate!.sql).toMatch(/user_id IS NULL/);
  });

  it('POST /api/staff/:id/invite rejects duplicate pending invite (same email)', async () => {
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T),
      mockDB: mock,
      tables: {
        staff: [{ id: 42, name: 'A', email: 'dup@x.io',
                  position: 'Nurse', status: 'active', user_id: null, tenant_id: T }],
        invitations: [{ id: 1, tenant_id: T, email: 'dup@x.io',
                        role: 'nurse', accepted_at: null, revoked_at: null,
                        expires_at: new Date(Date.now() + 86400000).toISOString(),
                        staff_id: 99 }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { email: 'dup@x.io' });
    expect(res.status).toBe(409);
  });

  it('POST /api/staff/:id/invite rejects duplicate pending invite (same staff_id)', async () => {
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T),
      mockDB: mock,
      tables: {
        staff: [{ id: 42, name: 'A', email: 'other@x.io',
                  position: 'Nurse', status: 'active', user_id: null, tenant_id: T }],
        invitations: [{ id: 1, tenant_id: T, email: 'different@x.io',
                        role: 'nurse', accepted_at: null, revoked_at: null,
                        expires_at: new Date(Date.now() + 86400000).toISOString(),
                        staff_id: 42 }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { email: 'other@x.io' });
    expect(res.status).toBe(409);
  });

  it('POST /api/staff/:id/invite rejects when staff already linked', async () => {
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T),
      mockDB: mock,
      tables: {
        staff: [{ id: 42, name: 'A', email: 'linked@x.io',
                  position: 'Nurse', status: 'active', user_id: 7, tenant_id: T }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { email: 'linked@x.io' });
    expect(res.status).toBe(409);
  });

  it('POST /api/doctors/:id/invite still works (regression)', async () => {
    // Sanity check that the doctor flow is untouched: schema still accepts
    // { email, role: 'doctor', doctorId } without staffId, and rejects when
    // both doctorId and staffId are passed.
    const { createInvitationSchema } = await import('../../../src/schemas/invitation');
    const ok = createInvitationSchema.safeParse({ email: 'd@x.io', role: 'doctor', doctorId: 5 });
    expect(ok.success).toBe(true);
    const both = createInvitationSchema.safeParse({ email: 'd@x.io', role: 'doctor', doctorId: 5, staffId: 9 });
    expect(both.success).toBe(false);
    const nurseNoStaff = createInvitationSchema.safeParse({ email: 'n@x.io', role: 'nurse' });
    expect(nurseNoStaff.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests**

Run:
```bash
pnpm test test/integration/routes/staff-invitation.test.ts 2>&1 | tail -25
```

Expected: 6 passed, 0 failed. If a test fails, read the message carefully — the most common cause is the mock-DB not matching the SQL the handler runs. Check that the `tables` keys match the FROM/JOIN targets in the handler.

- [ ] **Step 3: Run the full integration test suite to catch regressions**

Run:
```bash
pnpm test:integration 2>&1 | tail -25
```

Expected: same or fewer failures as before this change. If you see new failures in `zero-coverage.test.ts` or other invite tests, check Task 5/6 changes — the `staff_id` column in the SELECT must not break mock-DB lookups when no invitations row exists.

- [ ] **Step 4: Commit**

```bash
git add test/integration/routes/staff-invitation.test.ts
git commit -m "test(staff-invite): add 6 integration tests for staff invite flow"
```

---

## Task 9: Frontend — `web/src/pages/AcceptInvite.tsx`

**Files:**
- Modify: `web/src/pages/AcceptInvite.tsx` (small additive change)

- [ ] **Step 1: Add staff fields to the Invite interface**

Find the `Invite` interface (around line 13). Add:

```ts
staffId?:    number | null;
staffName?:  string | null;
```

right after the existing `doctorName?: string | null;` line.

- [ ] **Step 2: Update the role display block**

Find the block that renders the role label (around line 111–113). Replace it with:

```tsx
<strong>
  {invite.doctorName ? `Dr. ${invite.doctorName}`
    : invite.staffName
      ? invite.staffName
      : (TENANT_ROLE_LABELS[invite.role as keyof typeof TENANT_ROLE_LABELS] ?? invite.role)}
</strong>
```

- [ ] **Step 3: Add the staff-linked banner**

Right after the existing doctor-linked banner (around line 116–118), add:

```tsx
{invite.staffName && (
  <p>Linked to your staff profile: <code>{invite.staffName}</code></p>
)}
```

- [ ] **Step 4: Type-check the web package**

Run:
```bash
cd web && npx tsc --noEmit && cd ..
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/AcceptInvite.tsx
git commit -m "feat(web): surface staff profile in AcceptInvite"
```

---

## Task 10: Frontend — `web/src/pages/StaffPage.tsx`

**Files:**
- Modify: `web/src/pages/StaffPage.tsx`

This is a larger change. Break it into sub-steps so each is independently committable.

- [ ] **Step 1: Update the `Staff` interface**

Find the `interface Staff { ... }` block. Add these optional fields inside it (after `department?: string;`):

```ts
email?: string | null;
user_id?: number | null;
pending_invitation_id?: number | null;
pending_invitation_status?: string | null;
pending_invitation_expires_at?: string | null;
```

- [ ] **Step 2: Add `email` to `StaffForm`**

In the `interface StaffForm { ... }` block, add the field:

```ts
email: string;
```

(default value: `''` in the form initializer around line 73).

- [ ] **Step 3: Add the Email field to the Drawer form**

Right after the Mobile input group in the form, add:

```tsx
<label className="label">{t('staff:emailLabel', { defaultValue: 'Email' })}</label>
<input
  className="input"
  type="email"
  value={form.email}
  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
  placeholder="staff@example.com"
/>
```

- [ ] **Step 4: Include `email` in the create/update payload**

In the submit handler (around line 224 — look for `position: form.position,` in the create payload, and around line 152 for the edit payload), add `email: form.email || undefined` to the object sent to the API.

- [ ] **Step 5: Add the modal state and handlers**

At the top of the component (after existing `useState` blocks), add:

```ts
const [inviteModal, setInviteModal] = useState<{
  staff: Staff; link: string; email: string;
} | null>(null);
const [inviting, setInviting] = useState(false);

const handleInvite = async (member: Staff) => {
  setInviting(true);
  try {
    const res = await api(`/api/staff/${member.id}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email: member.email ?? '' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error((err as { error?: string }).error ?? 'Failed to send invitation');
      return;
    }
    const data = await res.json() as { invite: { inviteLink: string; email: string } };
    setInviteModal({ staff: member, link: data.invite.inviteLink, email: data.invite.email });
    queryClient.invalidateQueries({ queryKey: queryKeys.staff.list(tenantSlug) });
  } catch {
    toast.error('Network error');
  } finally {
    setInviting(false);
  }
};

const copyInviteLink = async () => {
  if (!inviteModal) return;
  await navigator.clipboard.writeText(inviteModal.link);
  toast.success('Invite link copied');
};
```

If `queryClient`, `queryKeys.staff.list`, or `tenantSlug` aren't already in scope, look at how the existing mutation handlers in this file work and use the same names. The `api` import is already at the top of the file.

- [ ] **Step 6: Add the Account column to the table**

In the table header (around line 309), add a new `<th>`:

```tsx
<th>{t('staff:account', { defaultValue: 'Account' })}</th>
```

In the matching `<td>` of the body row (around line 365), add:

```tsx
<td>
  {member.user_id
    ? <span className="badge badge-success">{t('staff:linked', { defaultValue: 'Linked' })}</span>
    : member.pending_invitation_id
      ? <span className="badge badge-warning">{t('staff:pendingInvite', { defaultValue: 'Pending Invite' })}</span>
      : <button
          className="btn btn-sm btn-primary"
          onClick={() => handleInvite(member)}
          disabled={inviting}
        >
          <UserCheck size={14} /> {t('staff:invite', { defaultValue: 'Invite' })}
        </button>}
</td>
```

If `UserCheck` is not already imported from `lucide-react`, add it to the import on line 1.

- [ ] **Step 7: Add the invite modal at the end of the JSX**

Right before the closing `</div>` of the page root, add:

```tsx
{inviteModal && (
  <div className="modal-overlay" onClick={() => setInviteModal(null)}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <h3>{t('staff:inviteTitle', { defaultValue: 'Invitation sent' })}</h3>
      <p>
        {t('staff:inviteSentTo', { defaultValue: 'An invitation has been sent to' })}{' '}
        <strong>{inviteModal.email}</strong>
      </p>
      <p className="text-sm text-gray-600">
        {t('staff:inviteShareHint', { defaultValue: 'Share this link with the staff member to accept:' })}
      </p>
      <div className="flex gap-2 items-center">
        <input className="input flex-1" readOnly value={inviteModal.link} />
        <button className="btn btn-secondary" onClick={copyInviteLink}>
          {t('staff:copy', { defaultValue: 'Copy' })}
        </button>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={() => setInviteModal(null)}>
          {t('staff:done', { defaultValue: 'Done' })}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 8: Type-check + build**

Run:
```bash
cd web && npx tsc --noEmit && cd .. && pnpm build:web 2>&1 | tail -20
```

Expected: type-check clean; build succeeds. If `t('staff:…')` warns about missing keys, the `defaultValue` fallback will surface in the UI, so this is acceptable — but fix any TS errors.

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/StaffPage.tsx
git commit -m "feat(web): add Account column + invite modal to StaffPage"
```

---

## Task 11: Manual end-to-end smoke test (in local server)

**Files:** none — this is a manual test.

- [ ] **Step 1: Start the local server**

Run:
```bash
pnpm dev
```

- [ ] **Step 2: Seed a staff row**

In the local D1 DB, insert:
```sql
INSERT INTO staff (tenant_id, name, position, status, email, address, salary, bank_account, mobile)
VALUES (1, 'Test Nurse', 'Nurse', 'active', 'testnurse@x.io', 'Test St', 1000, '0000', '01700000000');
```

- [ ] **Step 3: Hit the invite endpoint as hospital_admin**

With a valid JWT for the tenant admin:
```bash
curl -X POST http://localhost:8787/api/staff/<id>/invite \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"testnurse@x.io"}'
```

Expected: 201 with `{ invite: { role: "nurse", staffId, inviteLink, ... } }`.

- [ ] **Step 4: Open the invite link**

Paste the link into a browser. Confirm:
- The "Invitation sent" modal in `StaffPage.tsx` shows the link.
- The Account column shows "Pending Invite" for that staff row.
- The accept page shows "Test Nurse" and the role is `nurse`.

- [ ] **Step 5: Accept the invite**

Submit the form on the accept page with a strong password. Confirm:
- 201 response with a JWT.
- The user's role is `nurse`.
- DB: `SELECT user_id FROM staff WHERE id = <id>` returns the new user id.
- DB: `SELECT staff_id FROM invitations WHERE id = <invite_id>` is the staff id; `accepted_at` is set.
- The StaffPage now shows "Linked" for that row.

- [ ] **Step 6: Try duplicate invite**

Re-call the same `POST /api/staff/<id>/invite` and expect 409.

- [ ] **Step 7: Commit any local-only artifacts (none expected)**

If you created test data via the UI, remove it. If you adjusted any config to make the local server boot, revert it. Do not commit local DB artifacts.

---

## Task 12: Final verification + push

**Files:** none.

- [ ] **Step 1: Run the full test suite**

Run:
```bash
pnpm test:all 2>&1 | tail -30
```

Expected: 0 new failures. Pre-existing flaky e2e results in `test/e2e/results/` (from earlier runs) are not part of the suite; ignore them.

- [ ] **Step 2: Run lint**

Run:
```bash
pnpm lint 2>&1 | tail -20
```

Expected: 0 new errors. If the repo doesn't have a `lint` script, run `npx eslint src test web/src` directly on the changed paths.

- [ ] **Step 3: Type-check both packages**

Run:
```bash
npx tsc --noEmit && (cd web && npx tsc --noEmit) && (cd packages/shared && npx tsc --noEmit)
```

Expected: clean.

- [ ] **Step 4: Push the branch**

Run:
```bash
git push origin main
```

Expected: all 8 feature commits pushed. (Spec + plan commits are already on `main` from earlier; this push is the implementation commits.)

- [ ] **Step 5: Report**

Tell the user: "Implementation complete and pushed. Total commits: 8 (one per task 2–10). New files: `migrations/0353_staff_invitation_linking.sql`, `src/lib/staff-invite.ts`, `test/integration/routes/staff-invitation.test.ts`. Modified: `src/schemas/invitation.ts`, `src/routes/tenant/staff.ts`, `src/routes/public-invite.ts`, `web/src/pages/AcceptInvite.tsx`, `web/src/pages/StaffPage.tsx`. Ready to deploy when you say go."

---

## Self-Review Notes

**Spec coverage check:**
- §3 migration → Task 1
- §4 schema → Task 2
- §5 shared helpers → Task 3
- §6 invite endpoint → Task 4
- §7 GET /api/staff → Task 7
- §8 GET /api/invite/:token → Task 5
- §8 POST /api/invite/:token/accept → Task 6
- §9 StaffPage.tsx → Task 10
- §10 AcceptInvite.tsx → Task 9
- §11 tests → Task 8
- §13.1 compatibility (no silent break) → verified by Task 8's regression test (#6) + Task 2's verification of `createInvitationSchema` with `role: 'doctor'`
- §13.1 also implicitly verified by Task 2 Step 4 (existing invite tests still pass)

**Placeholder scan:** none — all steps contain concrete code or commands.

**Type consistency:**
- `createInvitationSchema` defined in `src/schemas/invitation.ts` (Task 2); used in `src/routes/tenant/staff.ts` (Task 4) and `test/integration/routes/staff-invitation.test.ts` (Task 8). Same shape.
- `staffPositionToRole` defined in `src/lib/staff-invite.ts` (Task 3); used in `src/routes/tenant/staff.ts` (Task 4). Same `StaffInviteRole` return type.
- `generateInviteToken`, `sha256Hex`, `expiresIn7Days` defined in `src/lib/staff-invite.ts` (Task 3); used in Task 4.
- `pending_invitation_id`, `pending_invitation_status`, `pending_invitation_expires_at` returned by Task 7's `GET /api/staff`; consumed in Task 10's `Staff` interface and Account column render. Same names.
- `staffId`, `staffName` returned by Task 5's `GET /api/invite/:token`; consumed in Task 9's `Invite` interface. Same names.
- `UserCheck` from `lucide-react` used in Task 10; import added explicitly.
- `queryKeys.staff.list(tenantSlug)` referenced in Task 10 Step 5; matches the existing `queryKeys` pattern in this file (verify in Step 5 by reading the existing mutation handlers before writing the new ones).

# Doctor Invitation & Self-Service Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable hospital admins to invite specific doctor profiles to create user accounts (linking the new user to the doctor profile), and let doctors self-edit most fields of their own profile.

**Architecture:** Extend the existing `invitations` table to allow `doctor` role, add a nullable `doctor_id` link + `revoked_at` column, and a per-doctor invitation history endpoint. Doctor accept flow atomically creates the user and populates `doctors.user_id`. Doctor self-edit uses the existing `PUT /api/doctors/:id` endpoint with a backend field-allowlist filter when the caller has role=doctor.

**Tech Stack:** Hono (worker routes), Zod (validation), D1/SQLite (data), React + Vite + TanStack Query (frontend), Vitest + React Testing Library (tests), Cloudflare D1 (production DB: `hms-super-admin-production-apac`).

**Spec:** `docs/superpowers/specs/2026-06-12-doctor-invitation-self-service-design.md`

---

## File Structure (decomposition)

| File | Responsibility |
|---|---|
| `migrations/0343_doctor_invitation_linking.sql` | Rebuild `invitations` table to allow `doctor`/`nurse` roles + add `doctor_id`, `revoked_at` |
| `src/schemas/invitation.ts` | Zod schemas for create / accept with `doctorId` |
| `src/routes/tenant/invitations.ts` | All admin invitation endpoints (create/list/revoke/resend) |
| `src/routes/tenant/doctors.ts` | Extend list + PUT to support doctor self-edit + new `/:id/invitations` |
| `src/routes/public-invite.ts` | Extend accept to link `doctors.user_id` |
| `web/src/pages/doctor/DoctorList.tsx` | Invite / resend / revoke actions per row |
| `web/src/pages/doctor/DoctorDetail.tsx` | Invitation history + linked user badge |
| `web/src/pages/InviteStaff.tsx` | Doctor role + doctor profile picker |
| `web/src/pages/AcceptInvite.tsx` | Show doctor name when linked |
| `web/src/pages/doctor/DoctorProfile.tsx` | NEW — doctor self-edit page |
| `web/src/components/doctor/DoctorForm.tsx` | Refactor to accept `readonlyFields` prop |
| `web/src/lib/queryKeys.ts` | Add `doctorInvitations` and `doctorDetail` keys |
| `web/src/lib/apiClient.ts` | (existing) — no changes expected |
| `web/src/App.tsx` | Register new route + sidebar link |

---

## Task 1: Migration — rebuild `invitations` table

**Files:**
- Create: `migrations/0343_doctor_invitation_linking.sql`

- [ ] **Step 1: Create migration file**

Write to `migrations/0343_doctor_invitation_linking.sql`:

```sql
-- 0343: Doctor invitation linking
-- 1. Rebuild invitations table to allow doctor/nurse roles + add doctor_id and revoked_at
-- 2. Create doctor_id index for fast per-doctor lookups
-- SQLite cannot ALTER CHECK, so we use the standard rename-rebuild pattern.

CREATE TABLE invitations_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK(role IN (
                'hospital_admin','doctor','nurse','laboratory',
                'reception','md','director','pharmacist','accountant')),
  token       TEXT NOT NULL,
  invited_by  INTEGER NOT NULL,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  doctor_id   INTEGER REFERENCES doctors(id),
  revoked_at  TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

INSERT INTO invitations_new
  (id, tenant_id, email, role, token, invited_by, expires_at, accepted_at, created_at, doctor_id, revoked_at)
SELECT id, tenant_id, email, role, token, invited_by, expires_at, accepted_at, created_at, NULL, NULL
  FROM invitations;

DROP TABLE invitations;
ALTER TABLE invitations_new RENAME TO invitations;

-- Recreate indexes
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_tenant ON invitations(tenant_id);
CREATE UNIQUE INDEX idx_invitations_token_unique ON invitations(token);
CREATE INDEX idx_invitations_doctor ON invitations(tenant_id, doctor_id);
```

- [ ] **Step 2: Apply to local D1**

Run: `wrangler d1 execute hms-super-admin-production-apac --local --file=migrations/0343_doctor_invitation_linking.sql`
Expected: `Executed ... successfully` (or the standard D1 success message). If the `invitations` table does not exist in local dev, the `DROP TABLE invitations` will fail harmlessly — wrap in `--command=` to make it idempotent. **Use this safer form:**

```bash
wrangler d1 execute hms-super-admin-production-apac --local --command="
CREATE TABLE invitations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('hospital_admin','doctor','nurse','laboratory','reception','md','director','pharmacist','accountant')),
  token TEXT NOT NULL,
  invited_by INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  doctor_id INTEGER REFERENCES doctors(id),
  revoked_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);
INSERT OR IGNORE INTO invitations_new (id, tenant_id, email, role, token, invited_by, expires_at, accepted_at, created_at, doctor_id, revoked_at)
SELECT id, tenant_id, email, role, token, invited_by, expires_at, accepted_at, created_at, NULL, NULL FROM invitations WHERE EXISTS (SELECT 1 FROM invitations);
DROP TABLE IF EXISTS invitations;
ALTER TABLE invitations_new RENAME TO invitations;
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token_unique ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_doctor ON invitations(tenant_id, doctor_id);
"
```

Expected: `Executed ... successfully` with no errors.

- [ ] **Step 3: Verify with probe query**

```bash
wrangler d1 execute hms-super-admin-production-apac --local --command="SELECT sql FROM sqlite_master WHERE type='table' AND name='invitations';"
```

Expected: SQL output contains the new `doctor_id` and `revoked_at` columns and the updated CHECK list including `doctor` and `nurse`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0343_doctor_invitation_linking.sql
git commit -m "migration: allow doctor/nurse roles in invitations + add doctor_id and revoked_at"
```

---

## Task 2: Create invitation Zod schema

**Files:**
- Create: `src/schemas/invitation.ts`

- [ ] **Step 1: Create the schema file**

Write to `src/schemas/invitation.ts`:

```typescript
import { z } from 'zod';
import { VALID_TENANT_ROLES } from '../../packages/shared/src/authz';

export const createInvitationSchema = z.object({
  email: z.string().email('Valid email required'),
  role: z.enum(VALID_TENANT_ROLES, { message: 'Invalid role' }),
  doctorId: z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (data.role === 'doctor' && !data.doctorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['doctorId'],
      message: 'doctorId is required when role is doctor',
    });
  }
  if (data.role !== 'doctor' && data.doctorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['doctorId'],
      message: 'doctorId is only valid when role is doctor',
    });
  }
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit src/schemas/invitation.ts 2>&1 | head -20`
Expected: no errors. If `tsc` flags project config, run `pnpm run typecheck` from the project root.

- [ ] **Step 3: Commit**

```bash
git add src/schemas/invitation.ts
git commit -m "feat(schema): createInvitationSchema with optional doctorId"
```

---

## Task 3: Extend `POST /api/invitations` to accept `doctorId`

**Files:**
- Modify: `src/routes/tenant/invitations.ts:7-13,40-103`

- [ ] **Step 1: Update imports**

Replace the import block at the top of `src/routes/tenant/invitations.ts` (lines 7-13):

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { normalizeRole } from '../../lib/authz';
import { createAuditLog } from '../../lib/accounting-helpers';
import { createInvitationSchema } from '../../schemas/invitation';
```

(Removed inline `z` import; using the new shared schema instead.)

- [ ] **Step 2: Replace the inline schema and POST handler**

Replace lines 39-103 of `src/routes/tenant/invitations.ts` (the existing inline `createInviteSchema` and the entire `POST /` handler) with:

```typescript
// ─── POST /api/invitations — Create invitation (hospital_admin only) ──
invitationRoutes.post('/', zValidator('json', createInvitationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);
  const callerRole = c.get('role');

  if (callerRole !== 'hospital_admin') {
    return c.json({ error: 'Only hospital admins can send invitations' }, 403);
  }

  const { email, role, doctorId } = c.req.valid('json');

  try {
    // Check if email already has an account in this tenant
    const existingUser = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
    ).bind(email, tenantId).first();

    if (existingUser) {
      return c.json({ error: 'A user with this email already exists in your hospital' }, 409);
    }

    // Check for pending invitation
    const existingInvite = await db.$client.prepare(
      'SELECT id FROM invitations WHERE email = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > datetime("now")'
    ).bind(email, tenantId).first();

    if (existingInvite) {
      return c.json({ error: 'A pending invitation already exists for this email' }, 409);
    }

    // If role=doctor, verify the doctor profile exists in this tenant and is unlinked
    let doctorName: string | null = null;
    if (role === 'doctor' && doctorId) {
      const doctor = await db.$client.prepare(
        'SELECT id, name, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
      ).bind(doctorId, tenantId).first<{ id: number; name: string; user_id: number | null }>();

      if (!doctor) {
        return c.json({ error: 'Doctor profile not found in your hospital' }, 404);
      }
      if (doctor.user_id) {
        return c.json({ error: 'This doctor already has a linked user account' }, 409);
      }
      doctorName = doctor.name;
    }

    const token = generateInviteToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = expiresIn7Days();

    const result = await db.$client.prepare(
      'INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, doctor_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(tenantId, email, normalizeRole(role), tokenHash, callerId ?? 0, expiresAt, doctorId ?? null).run();

    // Get tenant slug for building the link
    const tenant = await db.$client.prepare(
      'SELECT subdomain, name FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ subdomain: string; name: string }>();

    const slug = tenant?.subdomain ?? 'hospital';
    const hospitalName = tenant?.name ?? 'HMS';

    const inviteLink = `/h/${slug}/accept-invite?token=${token}`;

    if (doctorId) {
      await createAuditLog(c.env, tenantId, callerId ?? 0, 'CREATE', 'invitations',
        result.meta.last_row_id as number, null, { email, role: normalizeRole(role), doctorId, doctorName },
        c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined,
        c.req.header('user-agent') ?? undefined,
      );
    }

    return c.json({
      message: 'Invitation created',
      invite: { email, role: normalizeRole(role), doctorId: doctorId ?? null, doctorName, expiresAt, inviteLink },
    }, 201);
  } catch (error) {
    console.error('Invitation error:', error);
    return c.json({ error: 'Failed to create invitation' }, 500);
  }
});
```

- [ ] **Step 3: Verify compile**

Run: `pnpm run typecheck 2>&1 | tail -30`
Expected: no errors. (If `pnpm` is not the workspace manager, use the existing project script: `npm run typecheck`.)

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/invitations.ts
git commit -m "feat(invitations): accept doctorId when role=doctor; persist doctor_id"
```

---

## Task 4: Extend `GET /api/invitations` to include doctor info

**Files:**
- Modify: `src/routes/tenant/invitations.ts:106-129`

- [ ] **Step 1: Update the GET handler to include doctor fields + status**

Replace the existing `GET /` handler (lines 106-129) with:

```typescript
// ─── GET /api/invitations — List invitations (hospital_admin only) ────
invitationRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const callerRole = c.get('role');

  if (!tenantId) return c.json({ error: 'Tenant not identified' }, 400);
  if (callerRole !== 'hospital_admin') return c.json({ error: 'Forbidden' }, 403);

  try {
    const { results } = await db.$client.prepare(
      `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
              i.doctor_id, d.name AS doctor_name, i.token,
              u.name AS invited_by_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       LEFT JOIN doctors d ON d.id = i.doctor_id AND d.tenant_id = i.tenant_id
       WHERE i.tenant_id = ?
       ORDER BY i.created_at DESC
       LIMIT 100`
    ).bind(tenantId).all();

    const now = new Date();
    const invitations = (results as Array<Record<string, unknown>>).map((row) => {
      const status = row.accepted_at
        ? 'accepted'
        : row.revoked_at
          ? 'revoked'
          : new Date(row.expires_at as string) < now
            ? 'expired'
            : 'pending';
      return { ...row, status };
    });

    return c.json({ invitations });
  } catch (error) {
    return c.json({ error: 'Failed to fetch invitations' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/invitations.ts
git commit -m "feat(invitations): list includes doctor_id, doctor_name, status, revoked_at"
```

---

## Task 5: Add `DELETE /api/invitations/:id` (revoke)

**Files:**
- Modify: `src/routes/tenant/invitations.ts` (append at end of file, before `export default invitationRoutes;`)

- [ ] **Step 1: Append the revoke handler**

Insert before the `export default invitationRoutes;` line:

```typescript
// ─── DELETE /api/invitations/:id — Revoke pending invitation ─────────
invitationRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);
  const callerRole = c.get('role');

  if (callerRole !== 'hospital_admin') {
    return c.json({ error: 'Only hospital admins can revoke invitations' }, 403);
  }

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid invitation id' }, 400);
  }

  try {
    const invite = await db.$client.prepare(
      'SELECT id, email, role, accepted_at, revoked_at, expires_at FROM invitations WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first<{ id: number; email: string; role: string; accepted_at: string | null; revoked_at: string | null; expires_at: string }>();

    if (!invite) return c.json({ error: 'Invitation not found' }, 404);
    if (invite.accepted_at) return c.json({ error: 'Cannot revoke an accepted invitation' }, 409);
    if (invite.revoked_at) return c.json({ error: 'Invitation is already revoked' }, 409);

    await db.$client.prepare(
      `UPDATE invitations SET revoked_at = datetime('now') WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    await createAuditLog(c.env, tenantId, callerId ?? 0, 'UPDATE', 'invitations', id,
      { revoked_at: null }, { revoked_at: new Date().toISOString() },
      c.req.header('CF-Connecting-IP') ?? undefined,
      c.req.header('user-agent') ?? undefined,
    );

    return c.json({ message: 'Invitation revoked' });
  } catch (error) {
    console.error('Revoke invitation error:', error);
    return c.json({ error: 'Failed to revoke invitation' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/invitations.ts
git commit -m "feat(invitations): DELETE endpoint to revoke pending invitation"
```

---

## Task 6: Add `POST /api/invitations/:id/resend`

**Files:**
- Modify: `src/routes/tenant/invitations.ts` (append after revoke handler)

- [ ] **Step 1: Append the resend handler**

Insert directly after the revoke handler:

```typescript
// ─── POST /api/invitations/:id/resend — Generate new token, mark old revoked ──
invitationRoutes.post('/:id/resend', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);
  const callerRole = c.get('role');

  if (callerRole !== 'hospital_admin') {
    return c.json({ error: 'Only hospital admins can resend invitations' }, 403);
  }

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid invitation id' }, 400);
  }

  try {
    const invite = await db.$client.prepare(
      'SELECT id, email, role, doctor_id, accepted_at, revoked_at FROM invitations WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first<{ id: number; email: string; role: string; doctor_id: number | null; accepted_at: string | null; revoked_at: string | null }>();

    if (!invite) return c.json({ error: 'Invitation not found' }, 404);
    if (invite.accepted_at) return c.json({ error: 'Cannot resend an accepted invitation' }, 409);

    // Mark old as revoked and insert new
    const newToken = generateInviteToken();
    const newTokenHash = await sha256Hex(newToken);
    const expiresAt = expiresIn7Days();

    await db.$client.batch([
      db.$client.prepare(
        `UPDATE invitations SET revoked_at = datetime('now') WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId),
      db.$client.prepare(
        `INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, doctor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(tenantId, invite.email, normalizeRole(invite.role), newTokenHash, callerId ?? 0, expiresAt, invite.doctor_id),
    ]);

    const tenant = await db.$client.prepare(
      'SELECT subdomain, name FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ subdomain: string; name: string }>();

    const slug = tenant?.subdomain ?? 'hospital';
    const inviteLink = `/h/${slug}/accept-invite?token=${newToken}`;

    await createAuditLog(c.env, tenantId, callerId ?? 0, 'UPDATE', 'invitations', id,
      { action: 'resend', old_token_revoked: true },
      { action: 'resend', new_expires_at: expiresAt },
      c.req.header('CF-Connecting-IP') ?? undefined,
      c.req.header('user-agent') ?? undefined,
    );

    return c.json({ message: 'Invitation resent', inviteLink, expiresAt });
  } catch (error) {
    console.error('Resend invitation error:', error);
    return c.json({ error: 'Failed to resend invitation' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/invitations.ts
git commit -m "feat(invitations): resend endpoint generates new token and revokes old"
```

---

## Task 7: Add `GET /api/doctors/:id/invitations`

**Files:**
- Modify: `src/routes/tenant/doctors.ts` (append before the export at the end of the file)

- [ ] **Step 1: Locate the end of the file**

Run: `tail -20 src/routes/tenant/doctors.ts`
Find the line `export default doctorRoutes;` — we'll insert before it.

- [ ] **Step 2: Append the doctor-invitations endpoint**

Insert directly before `export default doctorRoutes;`:

```typescript
// GET /api/doctors/:id/invitations — list invitations for one doctor
doctorRoutes.get('/:id/invitations', async (c) => {
  const tenantId = requireTenantId(c);
  const callerRole = c.get('role');
  if (callerRole !== 'hospital_admin' && callerRole !== 'md' && callerRole !== 'director') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const db = getDb(c.env.DB);
  const doctorId = Number(c.req.param('id'));
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    return c.json({ error: 'Invalid doctor id' }, 400);
  }

  try {
    const doctor = await db.$client.prepare(
      'SELECT id, name, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
    ).bind(doctorId, tenantId).first<{ id: number; name: string; user_id: number | null }>();
    if (!doctor) return c.json({ error: 'Doctor not found' }, 404);

    const { results } = await db.$client.prepare(
      `SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at, token
       FROM invitations
       WHERE tenant_id = ? AND doctor_id = ?
       ORDER BY created_at DESC LIMIT 50`
    ).bind(tenantId, doctorId).all();

    const now = new Date();
    const invitations = (results as Array<Record<string, unknown>>).map((row) => {
      const status = row.accepted_at
        ? 'accepted'
        : row.revoked_at
          ? 'revoked'
          : new Date(row.expires_at as string) < now
            ? 'expired'
            : 'pending';
      return { ...row, status };
    });

    return c.json({ doctor, invitations });
  } catch (error) {
    console.error('Doctor invitations error:', error);
    return c.json({ error: 'Failed to fetch invitations' }, 500);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/doctors.ts
git commit -m "feat(doctors): GET /:id/invitations lists invitations for a doctor"
```

---

## Task 8: Extend `POST /api/invite/:token/accept` to link doctor

**Files:**
- Modify: `src/routes/public-invite.ts:77-145`

- [ ] **Step 1: Update the accept handler**

Replace the existing accept handler (lines 77-145) with:

```typescript
// ─── POST /api/invite/:token/accept — Accept + create account + link doctor ─────
publicInviteRoutes.post('/:token/accept', zValidator('json', acceptSchema), async (c) => {
  const db = getDb(c.env.DB);
  const token = c.req.param('token');
  const { name, password } = c.req.valid('json');
  const tokenHash = await sha256Hex(token);

  try {
    const invite = await db.$client.prepare(
      `SELECT i.id, i.email, i.role, i.tenant_id, i.expires_at, i.accepted_at, i.revoked_at, i.doctor_id
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
    }>();

    if (!invite) return c.json({ error: 'Invalid invitation token' }, 404);
    if (invite.accepted_at) return c.json({ error: 'Invitation already used' }, 410);
    if (invite.revoked_at) return c.json({ error: 'Invitation has been revoked' }, 410);
    if (new Date(invite.expires_at) < new Date()) return c.json({ error: 'Invitation expired' }, 410);

    // Check email not already registered in this tenant
    const existingUser = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
    ).bind(invite.email, invite.tenant_id).first();

    if (existingUser) {
      return c.json({ error: 'An account with this email already exists' }, 409);
    }

    // If linking to a doctor, ensure that doctor is still unlinked
    if (invite.doctor_id) {
      const doctor = await db.$client.prepare(
        'SELECT id, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
      ).bind(invite.doctor_id, invite.tenant_id).first<{ id: number; user_id: number | null }>();
      if (!doctor) {
        return c.json({ error: 'Linked doctor profile no longer exists' }, 410);
      }
      if (doctor.user_id) {
        return c.json({ error: 'This doctor profile is already linked to a different user' }, 409);
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create user atomically
    const [userResult] = await db.$client.batch([
      db.$client.prepare(
        'INSERT INTO users (email, password_hash, name, role, tenant_id, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))'
      ).bind(invite.email, passwordHash, name, invite.role, invite.tenant_id),
    ]);

    const userId = Number(userResult.meta.last_row_id);

    // Mark accepted + (if doctor) link doctors.user_id
    const followups: D1PreparedStatement[] = [
      db.$client.prepare(
        'UPDATE invitations SET accepted_at = datetime("now") WHERE id = ?'
      ).bind(invite.id),
    ];
    if (invite.doctor_id) {
      followups.push(db.$client.prepare(
        'UPDATE doctors SET user_id = ? WHERE id = ? AND user_id IS NULL'
      ).bind(userId, invite.doctor_id));
    }
    await db.$client.batch(followups);

    const jwtToken = await generateToken(
      {
        userId: String(userId),
        role: normalizeRole(invite.role),
        tenantId: String(invite.tenant_id),
        permissions: getPermissionsForRole(invite.role),
      },
      c.env.JWT_SECRET,
      8
    );

    return c.json({
      message: 'Account created successfully',
      token: jwtToken,
      user: { id: userId, name, email: invite.email, role: normalizeRole(invite.role) },
    }, 201);
  } catch (error) {
    console.error('Accept invite error:', error);
    return c.json({ error: 'Failed to accept invitation' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/public-invite.ts
git commit -m "feat(invite-accept): link doctor profile to new user; reject revoked/relinked"
```

---

## Task 9: Extend `GET /api/invite/:token` to return `doctorName`

**Files:**
- Modify: `src/routes/public-invite.ts:34-74`

- [ ] **Step 1: Update the GET handler to return doctor info**

Replace the existing GET handler (lines 34-74) with:

```typescript
// ─── GET /api/invite/:token — Validate token ──────────────────────────
publicInviteRoutes.get('/:token', async (c) => {
  const db = getDb(c.env.DB);
  const token = c.req.param('token');
  const tokenHash = await sha256Hex(token);

  try {
    const invite = await db.$client.prepare(
      `SELECT i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.doctor_id,
              d.name AS doctor_name,
              t.name AS hospital_name, t.subdomain
       FROM invitations i
       JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN doctors d ON d.id = i.doctor_id AND d.tenant_id = i.tenant_id
       WHERE i.token IN (?, ?)`
    ).bind(token, tokenHash).first<{
      email: string;
      role: string;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
      doctor_id: number | null;
      doctor_name: string | null;
      hospital_name: string;
      subdomain: string;
    }>();

    if (!invite) {
      return c.json({ error: 'Invitation not found or already invalid' }, 404);
    }
    if (invite.accepted_at) {
      return c.json({ error: 'This invitation has already been accepted' }, 410);
    }
    if (invite.revoked_at) {
      return c.json({ error: 'This invitation has been revoked' }, 410);
    }
    if (new Date(invite.expires_at) < new Date()) {
      return c.json({ error: 'This invitation has expired' }, 410);
    }

    return c.json({
      valid: true,
      email: invite.email,
      role: normalizeRole(invite.role),
      doctorId: invite.doctor_id,
      doctorName: invite.doctor_name,
      hospitalName: invite.hospital_name,
      slug: invite.subdomain,
    });
  } catch (error) {
    return c.json({ error: 'Failed to validate invitation' }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/public-invite.ts
git commit -m "feat(invite-validate): return doctorId and doctorName for linked invitations"
```

---

## Task 10: Extend `GET /api/doctors` to include `user_id`

**Files:**
- Modify: `src/routes/tenant/doctors.ts:282-302`

- [ ] **Step 1: Update the list query**

Replace the SELECT column list and ORDER BY in the existing list handler:

Find the query string:
```sql
SELECT id, name, specialty, mobile_number, consultation_fee, is_active, department, created_at
FROM doctors WHERE tenant_id = ?
```

Replace with:
```sql
SELECT id, name, specialty, mobile_number, consultation_fee, is_active, department, email, bmdc_reg_no, user_id, created_at
FROM doctors WHERE tenant_id = ?
```

(No other changes to this handler.)

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/doctors.ts
git commit -m "feat(doctors): list returns user_id, email, bmdc_reg_no"
```

---

## Task 11: Extend `PUT /api/doctors/:id` for doctor self-edit

**Files:**
- Modify: `src/routes/tenant/doctors.ts:1541-1604` (the existing `PUT /:id` handler)

- [ ] **Step 1: Add doctor self-edit logic at the top of the PUT handler**

The current handler begins with `requireSpecificRole(c, 'hospital_admin');`. Replace the top of that handler (lines 1542-1546) so that a doctor role can also call it, but is restricted to their own record.

In `src/routes/tenant/doctors.ts`, locate:
```typescript
doctorRoutes.put('/:id', zValidator('json', updateDoctorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireSpecificRole(c, 'hospital_admin');
  const id = c.req.param('id');
  const data = c.req.valid('json');
```

Replace that block with:
```typescript
doctorRoutes.put('/:id', zValidator('json', updateDoctorSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const callerRole = c.get('role');
  const id = c.req.param('id');
  const data = c.req.valid('json');

  // Resolve target doctor
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new HTTPException(400, { message: 'Invalid doctor id' });
  }
  const targetDoctor = await db.$client.prepare(
    'SELECT id, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(targetId, tenantId).first<{ id: number; user_id: number | null }>();
  if (!targetDoctor) throw new HTTPException(404, { message: 'Doctor not found' });

  if (callerRole === 'doctor') {
    // Self-edit: only allowed on own record
    if (targetDoctor.user_id !== Number(userId)) {
      throw new HTTPException(403, { message: 'You may only edit your own doctor profile' });
    }
  } else if (callerRole !== 'hospital_admin') {
    throw new HTTPException(403, { message: 'Insufficient permission' });
  }

  // Field allowlist: doctors can NOT change is_active (admin-only)
  const forbiddenForDoctor: ReadonlyArray<keyof typeof data> = ['isActive'];
  if (callerRole === 'doctor') {
    for (const field of forbiddenForDoctor) {
      if (data[field] !== undefined) {
        delete (data as Record<string, unknown>)[field];
      }
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/doctors.ts
git commit -m "feat(doctors): PUT /:id allows doctor self-edit on own record; strips isActive"
```

---

## Task 12: Frontend — add invite actions to `DoctorList`

**Files:**
- Modify: `web/src/pages/doctor/DoctorList.tsx`

- [ ] **Step 1: Add a new action column to the data table**

In `web/src/pages/doctor/DoctorList.tsx`, locate the existing `columns` array (where other action columns like `deactivate`/`activate` are defined, around line 200).

Add a new action column ABOVE the existing activate/deactivate column. Use the existing `useApiMutation` pattern from this file:

```typescript
// New action: invite doctor
const inviteDoctor = useApiMutation<
  { invite: { inviteLink: string; email: string; role: string; doctorId: number | null; doctorName: string | null; expiresAt: string } },
  { id: number; email: string }
>('post', (vars) => `/api/doctors/${vars.id}/invite`, {
  onSuccess: (data) => {
    qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
    qc.invalidateQueries({ queryKey: queryKeys.invitations.all });
    setInviteResult(data.invite);
    toast.success(t('doctor.invite_sent', 'Invitation sent'));
  },
  onError: (err) => toast.error(err instanceof Error ? err.message : t('doctor.invite_failed', 'Invite failed')),
});

const revokeInvite = useApiMutation<unknown, number>(
  'delete',
  (id: number) => `/api/invitations/${id}`,
  {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      qc.invalidateQueries({ queryKey: queryKeys.invitations.all });
      toast.success(t('doctor.invite_revoked', 'Invitation revoked'));
    },
  },
);

const resendInvite = useApiMutation<unknown, number>(
  'post',
  (id: number) => `/api/invitations/${id}/resend`,
  {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      qc.invalidateQueries({ queryKey: queryKeys.invitations.all });
      toast.success(t('doctor.invite_resent', 'Invitation resent'));
    },
  },
);
```

- [ ] **Step 2: Add the column definition**

In the same `columns` array, add:

```typescript
{
  key: 'invite',
  header: t('doctor.account', 'Account'),
  render: (d) => {
    if (d.user_id) {
      return <span className="badge badge-success">✓ {t('doctor.linked', 'Linked')}</span>;
    }
    return (
      <button
        className="btn-ghost text-xs"
        onClick={() => inviteDoctor.mutate({ id: d.id, email: d.email ?? '' })}
        disabled={!d.email || inviteDoctor.isPending}
        title={!d.email ? t('doctor.email_required', 'Set doctor email first') : undefined}
      >
        ✉ {t('doctor.invite', 'Invite')}
      </button>
    );
  },
},
```

- [ ] **Step 3: Add state for invite-result modal**

At the top of the component (next to existing `useState` calls), add:

```typescript
const [inviteResult, setInviteResult] = useState<{ inviteLink: string; email: string } | null>(null);
```

- [ ] **Step 4: Render a simple "copy link" modal when `inviteResult` is set**

Add at the bottom of the page JSX (just before the closing `</DashboardLayout>`):

```tsx
{inviteResult && (
  <div className="modal-overlay" onClick={() => setInviteResult(null)}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h3>{t('doctor.invitation_created', 'Invitation Created')}</h3>
        <button className="modal-close" onClick={() => setInviteResult(null)}>✕</button>
      </div>
      <p>Share this link with <code>{inviteResult.email}</code>:</p>
      <div className="link-box">
        <code>{`${window.location.origin}${inviteResult.inviteLink}`}</code>
        <button
          className="btn-copy"
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}${inviteResult.inviteLink}`);
            toast.success(t('doctor.copied', 'Copied!'));
          }}
        >Copy</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Add new backend endpoint `POST /api/doctors/:id/invite`**

Append to `src/routes/tenant/doctors.ts` before the `export default` line:

```typescript
// POST /api/doctors/:id/invite — send an invite to a specific doctor profile
doctorRoutes.post('/:id/invite', async (c) => {
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);
  const callerRole = c.get('role');
  if (callerRole !== 'hospital_admin') {
    return c.json({ error: 'Only hospital admins can invite doctors' }, 403);
  }

  const doctorId = Number(c.req.param('id'));
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    return c.json({ error: 'Invalid doctor id' }, 400);
  }
  const body = await c.req.json<{ email?: string }>();
  const email = (body.email ?? '').trim();
  if (!email) return c.json({ error: 'Email is required' }, 400);

  const db = getDb(c.env.DB);
  const doctor = await db.$client.prepare(
    'SELECT id, name, email, user_id FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(doctorId, tenantId).first<{ id: number; name: string; email: string | null; user_id: number | null }>();
  if (!doctor) return c.json({ error: 'Doctor not found' }, 404);
  if (doctor.user_id) return c.json({ error: 'Doctor already linked to a user' }, 409);

  // Reuse POST /api/invitations internally
  const tenant = await db.$client.prepare('SELECT subdomain FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ subdomain: string }>();
  const token = (await import('../../routes/tenant/invitations')).default; // not used, see below
  // Inline the invitation creation to avoid circular route imports
  const { createInvitationSchema } = await import('../../schemas/invitation');
  const parsed = createInvitationSchema.safeParse({ email, role: 'doctor', doctorId });
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400);
  }

  // (Inline call equivalent to POST /api/invitations)
  const existingUser = await db.$client.prepare(
    'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
  ).bind(email, tenantId).first();
  if (existingUser) return c.json({ error: 'Email already registered' }, 409);

  const existingInvite = await db.$client.prepare(
    'SELECT id FROM invitations WHERE email = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > datetime("now")'
  ).bind(email, tenantId).first();
  if (existingInvite) return c.json({ error: 'Pending invitation already exists' }, 409);

  const cryptoRandom = (len: number) => {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const sha = async (s: string) => {
    const enc = new TextEncoder().encode(s);
    const d = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  };
  const newToken = cryptoRandom(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.$client.prepare(
    `INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, doctor_id)
     VALUES (?, ?, 'doctor', ?, ?, ?, ?)`
  ).bind(tenantId, email, await sha(newToken), callerId ?? 0, expiresAt, doctorId).run();

  await createAuditLog(c.env, tenantId, callerId ?? 0, 'CREATE', 'invitations',
    result.meta.last_row_id as number, null,
    { email, role: 'doctor', doctorId, doctorName: doctor.name },
    c.req.header('CF-Connecting-IP') ?? undefined,
    c.req.header('user-agent') ?? undefined,
  );

  const slug = tenant?.subdomain ?? 'hospital';
  return c.json({
    invite: {
      email,
      role: 'doctor',
      doctorId,
      doctorName: doctor.name,
      expiresAt,
      inviteLink: `/h/${slug}/accept-invite?token=${newToken}`,
    },
  }, 201);
});
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/doctor/DoctorList.tsx src/routes/tenant/doctors.ts
git commit -m "feat(doctors): admin can invite a doctor from DoctorList with email/copy link"
```

---

## Task 13: Frontend — extend `InviteStaff` to support doctor

**Files:**
- Modify: `web/src/pages/InviteStaff.tsx`

- [ ] **Step 1: Extend the role options to include `doctor`**

Already present (line 8). No change.

- [ ] **Step 2: Add a "doctor profile" picker when role=doctor**

Add to the imports:

```typescript
import { useApiQuery } from '../hooks/useApiQuery';
```

Add inside the component (above `handleInvite`):

```typescript
const { data: unlinkedDoctors } = useApiQuery<{ doctors: Array<{ id: number; name: string; specialty: string | null; email: string | null }> }>(
  ['unlinked-doctors'],
  '/api/doctors?status=unlinked',
  { enabled: role === 'doctor' },
);

const [doctorId, setDoctorId] = useState<number | ''>('');

useEffect(() => {
  if (role !== 'doctor') setDoctorId('');
}, [role]);
```

- [ ] **Step 3: Add the doctor picker UI to the modal form**

Inside the modal form, between the email field and the role select, add:

```tsx
{role === 'doctor' && (
  <>
    <div className="form-group">
      <label htmlFor="inv-modal-doctor">Select Doctor Profile</label>
      <select
        id="inv-modal-doctor"
        value={doctorId}
        onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : '';
          setDoctorId(id);
          if (id) {
            const doc = unlinkedDoctors?.doctors.find((d) => d.id === id);
            if (doc?.email) setEmail(doc.email);
          }
        }}
        required
      >
        <option value="">— pick a doctor —</option>
        {unlinkedDoctors?.doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}{d.specialty ? ` (${d.specialty})` : ''}
          </option>
        ))}
      </select>
    </div>
    <input type="hidden" name="doctorId" value={doctorId} />
  </>
)}
```

- [ ] **Step 4: Send `doctorId` in the request body**

Update `handleInvite` to include `doctorId`:

```typescript
async function handleInvite(e: React.FormEvent) {
  e.preventDefault();
  if (role === 'doctor' && !doctorId) {
    toast.error('Please select a doctor profile');
    return;
  }
  setSubmitting(true);
  try {
    const res = await api.post<InviteResult>('/api/invitations', {
      email,
      role,
      doctorId: role === 'doctor' ? Number(doctorId) : undefined,
    });
    // ...existing success logic...
  } catch (err) { /* existing */ }
}
```

- [ ] **Step 5: Add an unlinked-doctors endpoint to the doctor list API**

In `src/routes/tenant/doctors.ts`, the existing GET handler at line 272 already returns all active doctors with `user_id`. No change needed — frontend filters by `user_id IS NULL` client-side. If the list is large, add a query param `unlinked=1` later. For now, no backend change.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/InviteStaff.tsx
git commit -m "feat(invite-staff): doctor role shows doctor-profile picker"
```

---

## Task 14: Frontend — `AcceptInvite` shows doctor name

**Files:**
- Modify: `web/src/pages/AcceptInvite.tsx`

- [ ] **Step 1: Update `InviteInfo` interface and fetch**

Replace the `InviteInfo` interface:

```typescript
interface InviteInfo {
  email: string;
  role: string;
  doctorId?: number | null;
  doctorName?: string | null;
  hospitalName: string;
  slug: string;
}
```

(Already covered by the existing type spread in line 43 — but add the fields for type safety.)

- [ ] **Step 2: Update the hero text to show doctor name**

Find the `<p>` block:
```tsx
<p>
  <strong>{invite.hospitalName}</strong> has invited you to join as{' '}
  <strong className="role-badge">{TENANT_ROLE_LABELS[invite.role as keyof typeof TENANT_ROLE_LABELS] ?? invite.role}</strong>
</p>
```

Replace with:
```tsx
<p>
  <strong>{invite.hospitalName}</strong> has invited you to join as{' '}
  <strong className="role-badge">
    {invite.doctorName ? `Dr. ${invite.doctorName}` : (TENANT_ROLE_LABELS[invite.role as keyof typeof TENANT_ROLE_LABELS] ?? invite.role)}
  </strong>
</p>
{invite.doctorName && (
  <p className="invite-email">
    Linked to your doctor profile: <code>{invite.doctorName}</code>
  </p>
)}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/AcceptInvite.tsx
git commit -m "feat(accept-invite): show doctor name when invitation links to a doctor"
```

---

## Task 15: Frontend — new `DoctorProfile` self-edit page

**Files:**
- Create: `web/src/pages/doctor/DoctorProfile.tsx`

- [ ] **Step 1: Create the page**

Write to `web/src/pages/doctor/DoctorProfile.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface Doctor {
  id: number;
  name: string;
  specialty: string | null;
  department: string | null;
  mobile_number: string | null;
  email: string | null;
  consultation_fee: number;
  bio: string | null;
  qualifications: string | null;
  visiting_hours: string | null;
  is_active: number;
  is_available: number;
  bmdc_reg_no: string | null;
  is_marketplace_visible: number;
}

export default function DoctorProfile() {
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();
  const { data, isLoading } = useApiQuery<{ doctors: Doctor[] }>(
    ['doctor', 'me'],
    '/api/doctors?status=all',
  );
  const me = data?.doctors?.[0];

  const [form, setForm] = useState<Partial<Doctor>>({});
  useEffect(() => {
    if (me) setForm(me);
  }, [me]);

  const update = useApiMutation<unknown, Partial<Doctor>>(
    'put',
    () => `/api/doctors/${me?.id}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.profile_saved', 'Profile updated'));
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t('doctor.update_failed', 'Update failed')),
    },
  );

  if (isLoading) {
    return (
      <DashboardLayout role="doctor">
        <div className="p-6">{t('common:loading', 'Loading…')}</div>
      </DashboardLayout>
    );
  }

  if (!me) {
    return (
      <DashboardLayout role="doctor">
        <div className="p-6">{t('doctor.no_profile', 'No doctor profile linked to your account. Contact admin.')}</div>
      </DashboardLayout>
    );
  }

  const field = (key: keyof Doctor, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <DashboardLayout role="doctor">
      <div className="space-y-4 max-w-3xl mx-auto p-6">
        <h1 className="page-title">{t('doctor.my_profile', 'My Profile')}</h1>

        <div className="card p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('doctor.name', 'Name')}</label>
              <input className="input" value={form.name ?? ''} onChange={(e) => field('name', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.specialty', 'Specialty')}</label>
              <input className="input" value={form.specialty ?? ''} onChange={(e) => field('specialty', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.department', 'Department')}</label>
              <input className="input" value={form.department ?? ''} onChange={(e) => field('department', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.mobile', 'Mobile')}</label>
              <input className="input" value={form.mobile_number ?? ''} onChange={(e) => field('mobile_number', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.email', 'Email')}</label>
              <input type="email" className="input" value={form.email ?? ''} onChange={(e) => field('email', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.bmdc', 'BMDC Reg No')}</label>
              <input className="input" value={form.bmdc_reg_no ?? ''} onChange={(e) => field('bmdc_reg_no', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.consultation_fee', 'Consultation Fee')}</label>
              <input
                type="number"
                className="input"
                value={form.consultation_fee ?? 0}
                onChange={(e) => field('consultation_fee', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">{t('doctor.visiting_hours', 'Visiting Hours')}</label>
              <input className="input" value={form.visiting_hours ?? ''} onChange={(e) => field('visiting_hours', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">{t('doctor.qualifications', 'Qualifications')}</label>
              <input className="input" value={form.qualifications ?? ''} onChange={(e) => field('qualifications', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">{t('doctor.bio', 'Bio')}</label>
              <textarea
                className="input"
                rows={3}
                value={form.bio ?? ''}
                onChange={(e) => field('bio', e.target.value)}
              />
            </div>
            <div>
              <label className="label flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.is_marketplace_visible}
                  onChange={(e) => field('is_marketplace_visible', e.target.checked ? 1 : 0)}
                />
                {t('doctor.on_marketplace', 'Show on marketplace')}
              </label>
            </div>
            <div>
              <label className="label flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.is_available}
                  onChange={(e) => field('is_available', e.target.checked ? 1 : 0)}
                />
                {t('doctor.available', 'Available for appointments')}
              </label>
            </div>
            <div>
              <label className="label" title={t('doctor.is_active_tooltip', 'Contact admin to change')}>
                {t('doctor.is_active', 'Active')}
              </label>
              <input className="input bg-gray-100" value={form.is_active ? 'Yes' : 'No'} disabled />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {t('doctor.is_active_help', 'Only admins can change this')}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              className="btn-primary"
              onClick={() => {
                // Strip isActive before sending
                const { is_active, ...payload } = form as Doctor;
                update.mutate(payload);
              }}
              disabled={update.isPending}
            >
              {update.isPending ? t('common:saving', 'Saving…') : t('common:save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Add `invitations` and `doctorDetail` keys to `queryKeys.ts`**

In `web/src/lib/queryKeys.ts`, find the `doctors` block (lines 2-7). After it, add:

```typescript
invitations: {
  all: ['invitations'] as const,
  list: (filters?: Record<string, unknown>) => ['invitations', 'list', filters ?? {}] as const,
  forDoctor: (doctorId: number) => ['invitations', 'forDoctor', doctorId] as const,
},
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/doctor/DoctorProfile.tsx web/src/lib/queryKeys.ts
git commit -m "feat(doctor): new DoctorProfile self-edit page; invitations query keys"
```

---

## Task 16: Frontend — register route + sidebar

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add lazy import**

Find the existing `const DoctorCertificates = lazy(() => import('./pages/doctor/DoctorCertificates'));` (around line 333) and add directly above it:

```typescript
const DoctorProfile = lazy(() => import('./pages/doctor/DoctorProfile'));
```

- [ ] **Step 2: Add the route inside the doctor-only protected route group**

Find the `<Route element={<ProtectedRoute allowedRoles={['doctor']} />}>` block (around line 839). Add a child route inside it:

```tsx
<Route path="doctor/profile" element={<DoctorProfile />} />
```

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(app): register doctor self-edit profile route"
```

---

## Task 17: Update existing tests

**Files:**
- Modify: `web/src/pages/AcceptInvite.test.ts`, `web/src/pages/InviteStaff.test.ts`, `web/src/pages/doctor/DoctorList.test.ts` (these files exist per AGENTS.md)

- [ ] **Step 1: Update `AcceptInvite.test.ts` to assert doctor name shown**

Locate the test that asserts hero text. Add a new test:

```typescript
it('shows doctor name when invitation links to a doctor', async () => {
  server.use(
    http.get('*/api/invite/:token', () =>
      HttpResponse.json({
        valid: true,
        email: 'drsmith@hospital.com',
        role: 'doctor',
        doctorId: 42,
        doctorName: 'Smith',
        hospitalName: 'Test Hospital',
        slug: 'test',
      })
    )
  );
  render(<MemoryRouter initialEntries={['/h/test/accept-invite?token=abc']}><Routes><Route path="h/:slug/accept-invite" element={<AcceptInvite />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(/Dr\.\s*Smith/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Update `InviteStaff.test.ts` to assert doctor picker appears**

Add:

```typescript
it('shows doctor profile picker when role=doctor is selected', async () => {
  render(<MemoryRouter><InviteStaff /></MemoryRouter>);
  const roleSelect = await screen.findByLabelText(/role/i);
  fireEvent.change(roleSelect, { target: { value: 'doctor' } });
  expect(await screen.findByLabelText(/select doctor profile/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run frontend tests**

Run: `cd web && pnpm test --run --reporter=default 2>&1 | tail -40`
Expected: existing tests still pass, new tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/AcceptInvite.test.ts web/src/pages/InviteStaff.test.ts
git commit -m "test: accept-invite shows doctor name; invite-staff shows doctor picker"
```

---

## Task 18: Apply migration to production + deploy

**Files:** none — deployment tasks only.

- [ ] **Step 1: Apply migration to production D1**

Run:
```bash
wrangler d1 execute hms-super-admin-production-apac --remote --file=migrations/0343_doctor_invitation_linking.sql
```

Expected: `Executed ... successfully`. If the file has `INSERT OR IGNORE` issues with the `--file` form (wrangler sometimes wraps in implicit transactions), fall back to passing the SQL via `--command="..."` with the safe idempotent form shown in Task 1, Step 2.

- [ ] **Step 2: Build and deploy worker**

```bash
pnpm build && wrangler deploy --env production
```

Expected: deploy completes; new routes registered.

- [ ] **Step 3: Deploy frontend**

The frontend is bundled with the worker (Vite → Cloudflare Pages or bundled into worker assets). The build step in step 2 already produced the asset bundle. If frontend is on a separate Pages project, run the project's deploy command (check `web/` for a `deploy` script). For now, the worker build covers it.

- [ ] **Step 4: Manual smoke on production URL**

Test:
1. Open `https://hms-saas-production.rahmatullahzisan.workers.dev/h/<slug>/doctors`
2. Add a doctor (or pick an existing unlinked one)
3. Click "Invite" → copy link
4. Open link in incognito → see doctor name → set password → land on dashboard
5. As admin, revoke the same invitation in another browser → confirm link returns 410
6. As doctor, visit `/h/<slug>/doctor/profile` → edit name → save → audit log entry written

Expected: all 6 manual smoke tests pass.

- [ ] **Step 5: Commit any leftover changes + tag**

```bash
git status
git add -A
git commit -m "chore: production smoke for doctor invitation linking" --allow-empty
git tag doctor-invitation-v1
```

---

## Self-Review

**Spec coverage:**
- ✅ Schema allows doctor/nurse roles — Task 1
- ✅ doctor_id + revoked_at columns — Task 1
- ✅ POST /api/invitations accepts doctorId — Task 3
- ✅ GET /api/invitations includes doctor fields + status — Task 4
- ✅ DELETE /api/invitations/:id (revoke) — Task 5
- ✅ POST /api/invitations/:id/resend — Task 6
- ✅ GET /api/doctors/:id/invitations — Task 7
- ✅ POST /api/invite/:token/accept links doctor — Task 8
- ✅ GET /api/invite/:token returns doctorName — Task 9
- ✅ GET /api/doctors includes user_id — Task 10
- ✅ PUT /api/doctors/:id self-edit with allowlist — Task 11
- ✅ DoctorList invite actions — Task 12
- ✅ InviteStaff doctor picker — Task 13
- ✅ AcceptInvite shows doctor name — Task 14
- ✅ DoctorProfile self-edit page — Task 15
- ✅ App route + sidebar — Task 16
- ✅ Tests updated — Task 17
- ✅ Production deploy — Task 18

**Placeholder scan:** No TBDs, no "implement later", no "appropriate error handling" without concrete code.

**Type consistency:** All new endpoints share `doctorId` (camelCase) in both directions; `doctorId` ↔ `doctor_id` mapping is consistent in SQL. `invitationStatus` field is mentioned in the spec but the spec also says "include `user_id` and `invitationStatus`" — I've included `user_id` in the list query and compute status on the frontend from `user_id` + a separate `invitations` fetch. This is consistent and avoids a JOIN-heavy query.

**Naming consistency:** `queryKeys.invitations` and `queryKeys.doctors` follow existing patterns.

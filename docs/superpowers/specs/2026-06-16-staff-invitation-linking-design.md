# Staff Invitation Linking — Design

**Date:** 2026-06-16
**Status:** Draft (proposed — pending user review)
**Scope:** Mirror the existing doctor-invitation flow for general staff so a hospital admin can email a `staff` profile a one-time invite link that creates a `users` account and links it to the staff row.

---

## 1. Background

Doctors already have a complete invitation-and-linking flow:

- `migrations/0343_doctor_invitation_linking.sql` adds `doctor_id` to `invitations`.
- `POST /api/doctors/:id/invite` (in `src/routes/tenant/doctors.ts:1788`) is hard-gated to `hospital_admin`, generates a 7-day token, stores its SHA-256 hash, and returns the raw link once.
- `GET /api/invite/:token` and `POST /api/invite/:token/accept` (in `src/routes/public-invite.ts`) validate the token, create the user, and `UPDATE doctors SET user_id = ?` in a single batch.

General staff (nurses, lab techs, receptionists, pharmacists, accountants) currently have **no** equivalent. The `staff` table already has an `email` column (added in `0344_staff_extended_fields_email.sql`), but staff rows are not linked to `users`. This means a staff member can't log in, and there's no audit trail tying a user account to a staff profile.

This design adds the staff-side parallel: same UX as the doctor flow, same security posture (raw token never persisted, RBAC-gated, 7-day expiry), one new endpoint in the staff route, and a 3-field schema update to the public accept handler.

---

## 2. Goals & Non-Goals

**Goals**

- Let a `hospital_admin`, `md`, or `director` user invite a `staff` row by email.
- On accept, create a `users` row with the correct role and link it to the staff row.
- Surface invite state (`Linked` / `Pending Invite` / `Invite`) in the staff list so admins can act on it.
- Add 4 new fields to the staff-list API response and reuse them in the UI.

**Non-Goals**

- Adding an `hr` role to the system. The existing `hr` value in `authz.ts:264` is a permission-set key for the staff-module catalog, not a tenant role. We do **not** add a new tenant role named `hr` here. The endpoint is gated by `staff:write`, which `hospital_admin` (wildcard), `md`, and `director` all hold — verified in `packages/shared/src/authz.ts:119, 132, 140`.
- Bulk invites.
- Email delivery (the link is shown in a modal and copied manually, matching the doctor flow).
- Re-inviting staff who have a pending invite (rejected by API; user must wait for expiry or revoke).
- Refactoring the doctor invite endpoint to use the new shared helpers (out of scope; helpers are written so this is a follow-up).
- Adding a `category` column to `staff` (the existing `position` column already carries the role data we need).

---

## 3. Database Migration

**File:** `migrations/0353_staff_invitation_linking.sql`

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

**Rationale:** SQLite supports `ADD COLUMN` for nullable columns without a table rebuild. The previous doctor migration (`0343`) used rename-rebuild only because it had to update a `CHECK(role IN ...)` constraint — neither of these changes touches a CHECK or adds a NOT NULL/default, so the simpler form is correct here. Both new columns are nullable: existing staff have no user, existing invitations have no staff, and rollback is `DROP COLUMN` + `DROP INDEX`.

**Why `0353`:** `0345` is taken (`leave_request_requested_to.sql`), `0352` is taken (`cssd_sterilization_release.sql`). Next free is `0353`.

---

## 4. Schema

**File:** `src/schemas/invitation.ts`

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

---

## 5. Shared Helpers

**New file:** `src/lib/staff-invite.ts`

```ts
export function staffPositionToRole(position: string | null | undefined): {
  role: 'nurse' | 'laboratory' | 'reception' | 'pharmacist' | 'accountant';
} | null {
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

The token/hash/expiry helpers are extracted from the inline code currently in `src/routes/tenant/doctors.ts:1826-1837`. The doctor route is **not** refactored to use them in this change (out of scope), but doing so is a trivial follow-up.

**Why case-insensitive substring match:** `staff.position` is free text in the existing schema. Newer rows set `position` to the same value as the `category` dropdown (the form does `setForm(f => ({ ...f, category: e.target.value, position: e.target.value }))`), but legacy rows may have values like `"Senior Nurse"` or `"Lab Technician"`. A substring match accepts both styles; a strict-equality match would reject legacy data.

---

## 6. Backend — `POST /api/staff/:id/invite`

**File:** `src/routes/tenant/staff.ts` (append)

```ts
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

**Auth gate:** `requirePermission('staff:write')`. Verified in `packages/shared/src/authz.ts:119, 132, 140, 223` that `hospital_admin` (wildcard), `md`, `director`, and the `hr` module-scope permission set all have this permission. The doctor endpoint's hard-gate to `hospital_admin` is tighter; for staff we use the route's existing pattern, which is consistent with the rest of `staff.ts`. We intentionally do **not** add `hr` as a new tenant role.

**Body parsing:** The request body is parsed with `.catch(() => ({}))` so a malformed/empty body returns 400 from the validation step below rather than a 500 from the JSON parser. The doctor's invite endpoint at `src/routes/tenant/doctors.ts:1800` does not have this guard — a follow-up consistency improvement, out of scope for this change.

**Email precedence:** `body.email` (request body) → `staff.email` (DB). If neither is set → 400.

**Conflict matrix (all return 409):**
- Email already registered as a user in this tenant.
- Pending invite with same email in this tenant.
- Pending invite with same `staff_id` in this tenant.
- Staff row already has a non-null `user_id`.

---

## 7. Backend — `GET /api/staff` updated response

**File:** `src/routes/tenant/staff.ts` (modify existing `GET /`)

```ts
staffRoutes.get('/', requirePermission('staff:read'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    // LEFT JOIN only the latest active pending invitation per staff row.
    // The subquery picks the most recent pending invite (by created_at, id)
    // for each staff_id; the outer LEFT JOIN then attaches it. This avoids
    // the duplicate-row problem that a naive join would produce if a staff
    // row ever had two pending invites (which the invite endpoint prevents,
    // but defence in depth).
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
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch staff' });
  }
});
```

Each row gains 3 nullable fields: `pending_invitation_id`, `pending_invitation_status`, `pending_invitation_expires_at`. The response key stays `staff` (no contract break for existing fields). The `inv` subquery is keyed to the most recent `MAX(id)` pending invite per `(tenant_id, staff_id)`, so the result is at most one row per staff member.

**Performance note:** The correlated subquery uses `MAX(id)` instead of `MAX(created_at)` because `id` is the primary key and indexed, so the subquery is O(pending invites) instead of O(staff × pending invites). The composite index `idx_invitations_staff(tenant_id, staff_id)` added in migration 0353 supports this lookup.

---

## 8. Backend — Public invite updates

**File:** `src/routes/public-invite.ts` (modify both endpoints)

**`GET /:token` — add `staff_id` + `staff_name` to SELECT and response:**

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
  email: string; role: string; expires_at: string; accepted_at: string | null;
  revoked_at: string | null;
  doctor_id: number | null; staff_id: number | null;
  doctor_name: string | null; staff_name: string | null;
  hospital_name: string; subdomain: string;
}>();

// ...existing validity checks unchanged...

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

**`POST /:token/accept` — add staff guard + link in batch:**

```ts
// SELECT: add staff_id
const invite = await db.$client.prepare(
  `SELECT i.id, i.email, i.role, i.tenant_id, i.expires_at, i.accepted_at, i.revoked_at,
          i.doctor_id, i.staff_id
   FROM invitations i
   WHERE i.token IN (?, ?)`
).bind(token, tokenHash).first<{ ...; staff_id: number | null; }>();

// existing doctor guard remains; add parallel staff guard after it:
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

// ... user INSERT unchanged ...

// In followups batch, append the staff link with a tenant guard:
if (invite.staff_id) {
  followups.push(db.$client.prepare(
    'UPDATE staff SET user_id = ? WHERE id = ? AND tenant_id = ? AND user_id IS NULL'
  ).bind(userId, invite.staff_id, invite.tenant_id));
}
await db.$client.batch(followups);
```

**Invariant:** The 1:1 link between a `users` row and a `staff` row is enforced both at the application layer (the `if (member.user_id)` guard) and at the database layer (`AND user_id IS NULL` plus `AND tenant_id = ?` in the UPDATE — defense in depth so a cross-tenant bug can't ever overwrite a real link). If a race somehow got past the guard, the UPDATE would no-op rather than overwrite. The `tenant_id` guard mirrors the existing doctor pattern (`UPDATE doctors SET user_id = ? WHERE id = ? AND user_id IS NULL` in the same file, which is implicitly tenant-scoped because the doctor row was loaded with `tenant_id = ?` earlier in the handler — the staff case is identical).

---

## 9. Frontend — `StaffPage.tsx`

**File:** `web/src/pages/StaffPage.tsx` (additive changes)

**Interface additions:**
```ts
interface Staff {
  // ...existing fields...
  email?: string | null;
  user_id?: number | null;
  pending_invitation_id?: number | null;
  pending_invitation_status?: string | null;
  pending_invitation_expires_at?: string | null;
}

interface StaffForm {
  // ...existing fields...
  email: string;  // NEW
}
```

**Drawer form:** Add Email field after Mobile (input type=email, bound to `form.email`).

**Update payload:** Include `email: form.email` in the PUT body.

**New modal state + handlers:**
```ts
const [inviteModal, setInviteModal] = useState<{
  staff: Staff; link: string; email: string;
} | null>(null);

const handleInvite = async (member: Staff) => {
  // POST /api/staff/:id/invite, body { email: member.email ?? '' }
  // on success: setInviteModal({ staff, link, email }), invalidate staff query
  // on failure: toast.error
};

const copyInviteLink = async () => {
  await navigator.clipboard.writeText(inviteModal.link);
  toast.success('Invite link copied');
};
```

**New "Account" column in the table:**
```tsx
<th>{t('staff:account', { defaultValue: 'Account' })}</th>
<td>
  {member.user_id
    ? <span className="badge badge-success">Linked</span>
    : member.pending_invitation_id
      ? <span className="badge badge-warning">Pending Invite</span>
      : <button className="btn btn-sm btn-primary" onClick={() => handleInvite(member)}>
          <UserCheck size={14} /> Invite
        </button>}
</td>
```

**Modal markup at end of page:**
```tsx
{inviteModal && (
  <div className="modal-overlay" onClick={() => setInviteModal(null)}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <h3>Invitation sent</h3>
      <p>An invitation has been sent to <strong>{inviteModal.email}</strong></p>
      <p className="text-sm text-gray-600">Share this link with the staff member to accept:</p>
      <div className="flex gap-2 items-center">
        <input className="input flex-1" readOnly value={inviteModal.link} />
        <button className="btn btn-secondary" onClick={copyInviteLink}>Copy</button>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={() => setInviteModal(null)}>Done</button>
      </div>
    </div>
  </div>
)}
```

**Why a modal:** Mirrors the doctor-list pattern (modal with link + copy). Toast confirms the API call; modal shows the actual link. The user can copy, share manually, or close. Read-only `<input>` lets the link be selected without using the copy button.

---

## 10. Frontend — `AcceptInvite.tsx`

**File:** `web/src/pages/AcceptInvite.tsx` (small addition)

```tsx
// Add to Invite interface:
interface Invite {
  // ...existing fields
  doctorId?:   number | null;
  doctorName?: string | null;
  staffId?:    number | null;
  staffName?:  string | null;
  hospitalName: string;
}

// In the role display block, add the staff branch:
<strong>
  {invite.doctorName ? `Dr. ${invite.doctorName}`
    : invite.staffName
      ? invite.staffName
      : (TENANT_ROLE_LABELS[invite.role as keyof typeof TENANT_ROLE_LABELS] ?? invite.role)}
</strong>

// Add staff-linked banner next to existing doctor banner:
{invite.doctorName && (
  <p>Linked to your doctor profile: <code>{invite.doctorName}</code></p>
)}
{invite.staffName && (
  <p>Linked to your staff profile: <code>{invite.staffName}</code></p>
)}
```

**Why:** Without this, the accept page would say "join as Nurse" with no indication the account will be wired to a specific staff profile. The doctor flow already shows the linked doctor name; staff gets the parallel.

---

## 11. Tests

**New file:** `test/integration/routes/staff-invitation.test.ts`

Six tests, using the existing `mockDB` pattern from `test/integration/routes/zero-coverage.test.ts:292-302`:

| # | Test | Asserts |
|---|---|---|
| 1 | `POST /api/staff/:id/invite` creates invitation with `staff_id` | 201, `response.invite.staffId === staff.id`, mock has `INSERT INTO invitations … staff_id` |
| 2 | `POST /api/invite/:token/accept` links `staff.user_id` to new user | 201, mock has `UPDATE staff SET user_id = ? WHERE id = ? AND user_id IS NULL` |
| 3 | Reject duplicate pending invite (same email) | 409 |
| 4 | Reject duplicate pending invite (same `staff_id`) | 409 |
| 5 | Reject when staff already linked (`user_id` non-null) | 409 |
| 6 | `POST /api/doctors/:id/invite` still works (regression) | 201, `response.invite.doctorId` set |

The helpers (`createTestApp`, `jsonRequest`, `createMockDB`) are imported from the same test-helpers file used by `zero-coverage.test.ts`.

---

## 12. Audit & Observability

- One `createAuditLog` call per invite creation, action `CREATE`, resource `invitations`, meta `{ email, role, staffId, staffName, position }`.
- No additional telemetry beyond the standard `console.error` on internal failures (matches existing invite handlers).
- No metric counters added in this change.

---

## 13. Rollout

1. Land migration `0353` first (additive, safe).
2. Land schema + helpers (compile-only change).
3. Land backend invite endpoint + public-invite updates.
4. Land `GET /api/staff` JOIN update.
5. Land frontend `StaffPage.tsx` + `AcceptInvite.tsx` updates.
6. Land tests.

Each step is independently committable; the migration is forward-compatible with the existing app because new columns are nullable.

---

## 13.1 Compatibility with existing `InviteStaff` page

There is an existing `web/src/pages/InviteStaff.tsx` page (mounted at `/h/:slug/invitations`, see `web/src/App.tsx:275, 630`). It calls `POST /api/invitations` (handled by `src/routes/tenant/invitations.ts`) with just `{ email, role, doctorId? }` — it does **not** pass `staffId`, and the schema (`createInvitationSchema` after this change) will require it for staff roles.

**Decision:** This design is additive and **does not silently break** the existing flow:

- The `createInvitationSchema` in `src/schemas/invitation.ts` adds `staffId` as an **optional** field with a `superRefine` rule: it is **required only when `role` is one of `nurse / laboratory / reception / pharmacist / accountant`**. A request with `role: 'doctor'` continues to work unchanged (still uses `doctorId`).
- The existing `POST /api/invitations` route (`src/routes/tenant/invitations.ts`) is **not** modified. Generic role-only invites for non-staff, non-doctor roles (e.g., `md`, `director`, `hospital_admin`) still work as before, because the schema's new rule only fires for the five staff roles.
- A request with `role: 'nurse'` (or other staff role) and no `staffId` is rejected with 400 from the schema layer. The `InviteStaff.tsx` UI is **not** updated in this change; if a user picks a staff role in that modal, they will see a 400 with the schema's `staffId is required for staff roles` message. That is a known acceptable limitation of this PR — the new staff-profile-linked flow lives on `StaffPage.tsx`. A follow-up PR can extend the `InviteStaff.tsx` modal with a staff-profile selector for full parity.
- The new `POST /api/staff/:id/invite` endpoint requires the staff row to exist, requires its `position` to map to a known staff role, and always passes `staffId` to the schema. This is the only path that creates a `staff_id`-linked invitation.

**Verification:** Tests #3 and #4 in Section 11 cover the duplicate pending-invite scenarios; a manual check that `POST /api/invitations` with `role: 'doctor'` still returns 201 is the regression test.

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Position values like `"Senior Nurse"` map to `nurse` (correct), but `"ICU Receptionist"` could potentially match both `nurse` (if a row had "nurse" in a long string) and `reception`. The substring match order in `staffPositionToRole` prioritizes `nurse` first. | Order of checks is deliberate. A more strict mapping (e.g., a dedicated `category` column) is a future improvement; not needed today. |
| Race between two admins inviting the same staff at the same time | The duplicate pending-invite check uses `staff_id` AND is not in a transaction, so a true race could create two invites. Same behavior as the doctor flow today. Mitigation: out of scope; document in follow-up. |
| Migration 0353 conflicts with another 0353 (extremely unlikely) | Verified `0345`-`0352` are all taken on current main; 0353 is the next free number. Rechecked at spec-revision time. |
| `callerRole` super_admin edge case | `requirePermission` already gives `*` to `super_admin`; they will pass the gate. |
| Token storage — we hash before insert, raw token only in API response | Mirrors doctor flow exactly; raw token never persisted. |

---

## 15. Open Questions

None. All seven design questions (Q1–Q7) were resolved with the user before this spec was written:

- Q1: ALTER + index migration style
- Q2: Endpoint in `src/routes/tenant/staff.ts`, gated by `requirePermission('staff:write')`
- Q3: `staff.position` substring match → role
- Q4: Plain `user_id` (no unique index), 1:1 enforced at app layer
- Q5: Modal overlay (matches doctor flow)
- Q6: New test file, regression for doctor in same file
- Q7: Audit log meta `{ email, role, staffId, staffName, position }`

---

## 16. Revision History

| Date | Revision | Author | Notes |
|---|---|---|---|
| 2026-06-16 | v1 | brainstorming | Initial design. Status: Approved. |
| 2026-06-16 | v1.1 | spec revision | Status changed to **Draft**; `hr` removed from goals (not a tenant role); added §13.1 compatibility note for existing `InviteStaff.tsx` page; added `tenant_id` guard to the staff link UPDATE; rewrote `GET /api/staff` query to use a correlated subquery so at most one row per staff member is returned; added `.catch(() => ({}))` to body parsing; rechecked migration number on current main (still 0353). |

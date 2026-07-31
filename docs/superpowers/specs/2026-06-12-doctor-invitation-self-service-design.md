# Doctor Invitation & Self-Service Profile Design

**Date:** 2026-06-12
**Status:** Approved
**Author:** Brainstorming session

## Problem

The admin panel's Doctor Management page lists doctor profiles but provides no way to
invite those doctors to create user accounts. When a doctor logs into the doctor
interface they need an account, but the only path today is admin-side profile creation
followed by manual credential setup. The current `invitations` table CHECK constraint
also rejects the `doctor` role, so the existing `InviteStaff` UI is broken for doctors
even though the dropdown advertises the option.

When a doctor does eventually log in, there is also no self-service way to keep their
profile (name, specialty, contact info, consultation fee, follow-up window) up to date —
they must ask an admin to make every change.

## Goals

1. Hospital admins can invite a specific doctor profile to create an account.
2. The new user account is automatically linked to that doctor profile (no orphan rows).
3. Doctors can self-edit most of their own profile fields, including consultation fee
   and follow-up validity windows.
4. Invitations support the full lifecycle: create, resend, revoke, accept.
5. All operations are audit-logged.

## Non-Goals (YAGNI)

- Email/SMTP delivery — system remains link-copy, matching existing pattern.
- Bulk CSV invite.
- Doctor self-registration (admin-only creation of doctor profiles).
- Linking already-existing users to doctor profiles (only via fresh invite-accept).
- Rate limiting on invite creation (deferred to v2).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Admin flow:                                                 │
│   1. /doctors → Add Doctor (creates profile only)          │
│   2. /doctors → Invite → creates invitation + doctor_id link│
│   3. /doctors → list shows invitation status per row       │
│   4. /invitations → revoke / resend invitation             │
└─────────────────────────────────────────────────────────────┘
                            ↓
            Email / link with secure token
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Doctor flow:                                                │
│   1. Opens /h/:slug/accept-invite?token=...                 │
│   2. Sets name + password                                   │
│   3. Backend creates user + links doctors.user_id           │
│   4. JWT issued → /doctor/dashboard                         │
│   5. /doctor/profile → self-edit (most fields, no is_active)│
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### `invitations` table — extended

Migration `0343_doctor_invitation_linking.sql` rebuilds the table (SQLite does not
support `ALTER TABLE ... DROP CONSTRAINT`):

```sql
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
  doctor_id   INTEGER REFERENCES doctors(id),  -- NEW
  revoked_at  TEXT,                             -- NEW
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (invited_by)  REFERENCES users(id)
);
INSERT INTO invitations_new
  SELECT id, tenant_id, email, role, token, invited_by, expires_at, accepted_at,
         created_at, NULL, NULL FROM invitations;
DROP TABLE invitations;
ALTER TABLE invitations_new RENAME TO invitations;
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_tenant ON invitations(tenant_id);
CREATE UNIQUE INDEX idx_invitations_token_unique ON invitations(token);
CREATE INDEX idx_invitations_doctor ON invitations(tenant_id, doctor_id);
```

`doctors.user_id` is already present (migration 0251) — no further schema change needed.

## API Changes

| Method | Path | Change |
|---|---|---|
| `POST`   | `/api/invitations`             | Accept optional `doctorId` when `role='doctor'` |
| `GET`    | `/api/invitations`             | Include `doctorId`, `doctorName`, derived `status` |
| `DELETE` | `/api/invitations/:id`         | New — set `revoked_at = now()` |
| `POST`   | `/api/invitations/:id/resend`  | New — generate new token, mark old as revoked, reset expiry |
| `GET`    | `/api/doctors/:id/invitations` | New — list invitations for a specific doctor |
| `POST`   | `/api/invite/:token/accept`    | After user create, `UPDATE doctors SET user_id = ? WHERE id = ? AND user_id IS NULL` |
| `GET`    | `/api/invite/:token`           | Return `doctorName` when invitation links to a doctor |
| `GET`    | `/api/doctors`                 | Include `user_id` and `invitationStatus` per row |
| `PUT`    | `/api/doctors/:id`             | When caller role=doctor, restrict to own record + filter allowed fields |

### Validation rules

| Scenario | Response |
|---|---|
| `role=doctor` without `doctorId` | 400 "doctorId required when role=doctor" |
| `doctorId` belongs to other tenant | 404 |
| `doctorId` already has `user_id` | 409 "doctor already linked" |
| Email already in `users` for this tenant | 409 |
| Email already has pending (non-revoked, non-expired) invitation | 409 |
| Revoke already-accepted invitation | 409 |
| Revoke already-revoked invitation | 409 |
| Doctor self-edit on another doctor's record | 403 |
| Doctor self-edit sets `is_active` (or other forbidden field) | 200, field silently stripped server-side; only allowed fields persisted |
| Accept when `doctor_id` is already linked to a different user | 409 "doctor already linked" |

### Doctor self-edit allowed fields (role=doctor)

✅ `name`, `specialty`, `department`, `qualifications`, `bio`, `mobile`, `email`,
   `visiting_hours`, `languages`, `photo_key`, `public_bio`, `display_order`,
   `is_available`, `consultation_fee`, `bmdc_reg_no`, `is_marketplace_visible`,
   `follow_up_valid_days` (via existing settings endpoint),
   `report_show_valid_days` (via existing settings endpoint)

❌ `is_active`, `tenant_id`, `user_id`, `created_at`, `updated_at`

## Frontend Changes

### `web/src/pages/doctor/DoctorList.tsx` — extend
- Add an action column per row:
  - If `user_id IS NULL` and no pending invitation → **"Invite"** button → modal
    (email pre-filled from doctor.email if present) → copy link on success.
  - If a pending invitation exists → **"Resend"** + **"Revoke"** + copy link.
  - If `user_id IS NOT NULL` → ✅ **"Linked"** badge with last-accepted date.

### `web/src/pages/doctor/DoctorDetail.tsx` — extend
- Header status badge: "Linked User" / "Pending Invitation" / "No Account".
- "Invitation History" section: table of all invitations for this doctor.

### `web/src/pages/InviteStaff.tsx` — extend
- Role dropdown includes `doctor` and `nurse` (was already in UI but backend
  rejected them).
- When `role=doctor` is selected, show a **"Select Doctor Profile"** dropdown
  populated from `GET /api/doctors?status=unlinked`.
- Email input pre-fills with selected doctor's email.

### `web/src/pages/AcceptInvite.tsx` — extend
- When invitation has `doctorName`, show hero text:
  *"You've been invited as **Dr. {name}** at {hospital}"*.

### `web/src/pages/doctor/DoctorProfile.tsx` — NEW
- Route `/h/:slug/doctor/profile` (role-protected to `doctor`).
- Reuses `DoctorForm.tsx` with:
  - `is_active` field **disabled** + tooltip "Contact admin to change"
  - On save, calls `PUT /api/doctors/me` (preferred) or filtered `PUT /api/doctors/:id`
- Invalidate `queryKeys.doctors.all` on success.

### `web/src/App.tsx` — extend
- Add lazy import for `DoctorProfile` and route entry under the doctor-only
  `ProtectedRoute` group.
- Add a "My Profile" link in the doctor sidebar (visibility tied to role).

## Audit Logging

Each new operation writes a row via the existing `createAuditLog` helper:

| Event | Trigger |
|---|---|
| `INVITATION_CREATED`         | `POST /api/invitations` with `doctorId` |
| `INVITATION_REVOKED`         | `DELETE /api/invitations/:id` |
| `INVITATION_RESENT`          | `POST /api/invitations/:id/resend` |
| `INVITATION_ACCEPTED`        | `POST /api/invite/:token/accept` |
| `DOCTOR_LINKED_TO_USER`      | accept flow links `doctors.user_id` |
| `DOCTOR_PROFILE_SELF_UPDATED`| doctor role updates own profile |

## Security

- All admin operations gated by `hospital_admin` role check.
- Doctor self-edit: backend verifies `caller.doctor.id` == `path :id`.
- Token: 32-byte `crypto.getRandomValues`, SHA-256 hashed in DB (existing).
- Forbidden fields stripped server-side, not just disabled in the UI.
- All audit events include `caller_user_id`, `tenant_id`, `ip`, `user_agent`.

## Testing

### Backend
- `POST /api/invitations` role=doctor + doctorId → 201, `doctor_id` persisted
- `POST /api/invitations` role=doctor no doctorId → 400
- `POST /api/invitations` role=doctor but doctor already linked → 409
- `POST /api/invite/:token/accept` with doctorId → user created, `doctors.user_id` set
- `POST /api/invite/:token/accept` double-accept → 410
- `DELETE /api/invitations/:id` valid pending → 200, `revoked_at` set
- `DELETE /api/invitations/:id` accepted → 409
- Doctor self-edit `is_active=0` field → 200, DB unchanged
- Doctor self-edit on other doctor's record → 403
- Resend → old token invalid, new token works

### Frontend (Vitest + RTL, matching existing patterns)
- `DoctorList.test.tsx` — invite / resend / revoke flows
- `InviteStaff.test.tsx` — doctor role option requires doctor picker
- `DoctorProfile.test.tsx` — `is_active` disabled, allowed fields save
- `AcceptInvite.test.tsx` — doctor name shown when present

### Manual smoke
- Admin creates doctor, invites, doctor accepts, doctor dashboard loads
- Admin revokes pending, link returns 410
- Doctor self-edits, audit log entry written

## File Touch List (planned)

- `migrations/0343_doctor_invitation_linking.sql` (new)
- `src/routes/tenant/invitations.ts` (extend + add DELETE / resend)
- `src/routes/public-invite.ts` (extend accept to link doctor)
- `src/routes/tenant/doctors.ts` (extend PUT for self-edit, add /:id/invitations, list includes user_id)
- `web/src/pages/doctor/DoctorList.tsx` (extend)
- `web/src/pages/doctor/DoctorDetail.tsx` (extend)
- `web/src/pages/InviteStaff.tsx` (extend)
- `web/src/pages/AcceptInvite.tsx` (extend)
- `web/src/pages/doctor/DoctorProfile.tsx` (new)
- `web/src/components/doctor/DoctorForm.tsx` (slight refactor for readonly `is_active`)
- `web/src/App.tsx` (route + sidebar)
- `web/src/lib/queryKeys.ts` (new keys for doctor invitations)
- `src/schemas/invitation.ts` (new — extend `createInviteSchema` for `doctorId`)

## Rollout

1. Apply migration to local D1 first, then production D1 (per AGENTS.md deploy order).
2. Deploy worker with new routes and `pnpm build && wrangler deploy --env production`.
3. Deploy frontend bundle.
4. Manual smoke on production URL.

## Open Questions

None at this point — all clarified during brainstorming.

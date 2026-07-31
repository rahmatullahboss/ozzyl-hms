# Staff Access Unification Implementation Plan

## Goal

Make Staff Management the primary place for adding hospital people, editing their profile, sending login invitations, and assigning simple access bundles. The separate invitation and permission pages will remain available for audit/advanced work, but normal admin workflow should start from the Staff page.

## Current system observations

- Staff records are managed through `/api/staff` and `web/src/pages/StaffPage.tsx`.
- Staff invitation backend already exists at `/api/staff/:id/invite`.
- Staff list backend already joins the latest invitation per staff record, so invitation status can be surfaced on the Staff page.
- Global invitation APIs also exist at `/api/invitations`, but using them as the primary workflow creates confusion because invited people may not be visible in the Staff workflow.
- Doctor invitation is already connected from the doctor page; staff should follow the same profile-first model.
- Staff `bankAccount` is currently required in validation, which blocks quick onboarding even when bank details are not available yet.
- Roles and permissions already exist, but staff onboarding needs easy presets/bundles first, with advanced permission editing kept behind a separate action.

## Design principles

1. **Profile first, login later**
   - Create the staff/person profile first.
   - Login invitation is optional and can be sent immediately or later.

2. **Designation is not access**
   - Position/category tells what the person is.
   - Access bundles tell what the person can do in the software.
   - Example: a Director can also get Reception Counter Operator access.

3. **Staff page is the primary workflow**
   - Staff list should show profile, invite, and login/access status in one place.
   - Invitation page remains for audit/resend/revoke management.

4. **Easy presets before advanced permissions**
   - Common bundles: Reception Desk, Reception Counter Operator, Management Cash Receiver, Doctor Schedule Manager, Accountant, Inventory, Lab, Reports Viewer.
   - Advanced permission page is linked from staff row/detail.

5. **Optional HR/payroll fields**
   - Bank account, emergency contact, blood group, salary, shift details, and documents can be added later.

## Implementation phases

### Phase 1 — Staff onboarding simplification

- Make staff bank account optional in API validation.
- Keep DB compatibility by saving blank string when the current DB column is non-null.
- Keep salary default as zero.
- Add frontend copy so bank account is clearly optional / can be added later.

### Phase 2 — Staff page invitation integration

- Use the existing `/api/staff/:id/invite` endpoint from Staff page.
- Add row actions:
  - Send Invite
  - Resend Invite if pending/expired
  - Copy Invite Link when available
- Show invitation status in staff list:
  - No Access
  - Invitation Pending
  - Active User / Accepted
  - Expired
  - Revoked

### Phase 3 — Access intent on staff creation/edit

- Add optional "Software access" section to Add/Edit Staff form.
- Allow selecting a primary login role and one or more easy access bundles.
- First version can send an invitation with the selected role; bundle assignment can link to the advanced Roles & Permissions page if backend user-level bundle assignment is not yet available before invite acceptance.

### Phase 4 — Staff profile/detail UX

- Add an action from staff row to manage access.
- Add/edit profile should expose key editable fields:
  - name
  - mobile
  - email
  - position
  - department
  - category
  - salary
  - bank account
  - emergency contact
  - blood group
- Long-term: separate tabs for Overview, HR Details, Payroll, Schedule, System Access, Documents, Activity Log.

### Phase 5 — Permission and bundle unification

- Use existing permission bundles for quick selection.
- Keep advanced overrides on Roles & Permissions.
- Add or map bundles for:
  - Reception Desk
  - Reception Counter Operator
  - Management Cash Receiver
  - Doctor Schedule Manager
  - Accountant
  - Inventory Operator
  - Lab Operator
  - Reports Viewer

### Phase 6 — People linking, long-term

- Keep current staff/doctor/shareholder tables for now.
- Add linking in UI where possible:
  - staff profile can show linked user account/invite
  - doctor profile can show linked staff/user if present
  - shareholder page should be discoverable under People & Access or Finance
- Future schema: `people` as the core entity, with staff/doctor/shareholder/user profiles linked to one person.

## First implementation scope

This implementation focuses on the safe, immediately useful changes:

1. Make staff bank account optional in schema/UI while preserving DB compatibility.
2. Surface invitation status on Staff page.
3. Add Staff page actions for sending/resending/copying invite link using existing backend.
4. Add a simple Software Access section to the Staff form for choosing the invite role.
5. Keep advanced role/permission assignment on the existing Roles & Permissions page.

## Testing checklist

- Staff page renders with no staff.
- Add staff works without bank account.
- Staff list shows invite status badge.
- Send invite calls `/api/staff/:id/invite` and refreshes staff list.
- Copy invite link copies the latest invite link if available.
- Existing staff tests pass.
- Frontend build passes.

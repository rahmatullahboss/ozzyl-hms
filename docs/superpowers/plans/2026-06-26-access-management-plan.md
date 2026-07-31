# Access Management Implementation Plan

## Implemented now

1. Tightened Accountant workspace access so basic reception income or expense permissions do not unlock Accountant Dashboard.
2. Fixed Permission Management user search so staff access editing uses linked `user_id`.
3. Added primary role selection to the User Access screen.
4. Added simple workspace bundles for accountant, doctor management, HR, lab, pharmacy, and inventory work.
5. Added Staff drawer System Access section so admins can grant/revoke workspace bundles directly from a linked staff profile.
6. Added Staff drawer access change history so admins can quickly see latest user-level grants/revokes and reasons.
7. Added critical permission reason validation for direct advanced user overrides.
8. Added/updated tests for workspace bundles, workspace switcher gating, Staff System Access, Permission Management access flow, critical reason validation, and route gating.

## Next hardening phase

1. Gradually slim broad default roles after rollout review.
2. Extend reason-required workflow to role-level/module-level mass changes with a confirmation modal.
3. Complete a full route audit for remaining role-only checks.
4. Add richer access history/timeline with actor names and filtering inside each staff profile.

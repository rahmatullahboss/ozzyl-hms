# Minimal Patient Visit Pass Design

## Goal

Introduce a minimal patient-controlled sharing flow that works like a simple visit pass instead of a complex consent-management system.

## Why This Change

The vision document calls for patient-owned temporary access tokens. The technical foundation already exists:

- global patient portal authentication
- portable health summaries
- consent records
- health record access audit logging

But the current mental model of scopes, tokens, and consent objects is too advanced for broad Bangladesh rollout. Patients and front-desk staff need a low-friction workflow they can understand immediately.

## Product Framing

Do not expose this as “manage access tokens.”

Expose it as:

- **Create Visit Pass**
- **Show QR or code at hospital**
- **Hospital redeems pass**

## Research Basis

- Existing patient-sharing systems succeed when they feel like a one-time share code rather than a permissions console.
- Bangladesh-facing rollout should optimize for front-desk adoption, low digital literacy, and minimal setup burden.
- The Ozzyl ecosystem already has summary-only portable records, so the safest first pass is short-lived summary access rather than full chart disclosure.

## Scope

### In Scope

- patient creates one active visit pass at a time
- staff redeems pass by QR token or short code
- pass grants temporary summary-only access automatically
- pass becomes bound to one redeeming hospital
- same hospital can re-use the pass until expiry
- patient can revoke the pass

### Out of Scope

- patient choosing granular scope
- multi-hospital simultaneous redemption
- area-by-area consent selection
- full-record sharing
- frontend UI implementation

## Core Rules

### Pass Model

A visit pass contains:

- raw QR token for scan workflows
- short human-entered pass code
- expiry timestamp
- patient UHID / global user linkage
- redeemed tenant linkage once used

### Simplicity Rules

- only one active pass per patient at a time
- default scope is always `summary`
- default expiry is 24 hours
- maximum expiry is 72 hours
- pass can be redeemed by token or code
- once first redeemed, it is tied to that hospital only
- same hospital may redeem again idempotently until expiry

### Data Grant Rule

Redeeming a pass automatically creates short-lived `view_summary` consent records for the redeeming tenant across the patient’s linked source hospitals.

That means:

- patient does not need to pre-select hospitals
- staff do not need to understand consent internals
- audit remains explicit

## Technical Design

### New Table

`patient_visit_passes`

Columns:

- `id`
- `token_hash`
- `code_hash`
- `code_last4`
- `global_user_id`
- `uhid`
- `is_active`
- `expires_at`
- `redeemed_at`
- `redeemed_by_tenant_id`
- `redeemed_by_user_id`
- `revoked_at`
- `created_at`

### Patient Route

Under the authenticated global portal:

- `POST /api/global-portal/visit-pass`
- `DELETE /api/global-portal/visit-pass/:id`

Behavior:

- revoke any previous active passes for that patient
- create a new 24-hour summary-only pass
- return token, pass code, and QR payload

### Staff Route

New tenant-authenticated route:

- `POST /api/visit-pass/redeem`

Behavior:

1. validate token or pass code
2. reject inactive / expired / revoked pass
3. if pass already redeemed by another tenant, reject
4. resolve all linked patient records by UHID
5. create temporary summary consents for the current tenant
6. build and return portable summaries
7. log access

## Security

- pass code is hashed at rest
- token is hashed at rest
- pass is short-lived
- pass is tenant-bound on first redemption
- patient can revoke it
- all redemptions are audited

## Done Criteria

This work is complete when:

- global portal can create and revoke visit passes
- tenant staff can redeem by token or code
- redeeming creates temporary summary access automatically
- docs reflect the simpler rollout framing: visit pass, not permission dashboard

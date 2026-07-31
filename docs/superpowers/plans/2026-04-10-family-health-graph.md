# Family Health Graph Implementation Plan

## Scope

Deliver a global family graph and managed-account system for the patient portal.

## Steps

1. Add schema and migration
- create `global_family_links`
- add indexes for patient identity, manager auth, active status

2. Add family graph backend helpers
- resolve current auth user's identity
- resolve acting subject from optional `managed_identity_id`
- validate family access
- create dependent identity
- link existing identity with claim code or stored verifier

3. Add global portal family routes
- `GET /family`
- `POST /family/dependents`
- `POST /family/link-existing`
- `DELETE /family/links/:id`

4. Extend global portal managed context
- `GET /dashboard`
- `GET /hospitals`
- `POST /visit-pass`
- `POST /emergency-pack`

5. Add tests
- family graph list
- create dependent
- link existing unclaimed card
- managed dashboard
- managed visit pass/emergency pack
- revoke link

6. Add patient-facing UI
- new family tab in global portal
- create family member form
- link existing UHID form
- managed profile switcher
- visible dependent status

7. Update docs
- assessment progress
- vision progress

## Release Guardrails

- keep access simple: one `manager` role
- no granular sub-permission matrix
- no new patient password flow for dependents
- maintain compatibility with later self-claim

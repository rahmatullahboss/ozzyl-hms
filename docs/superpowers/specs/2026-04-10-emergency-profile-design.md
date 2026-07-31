# Universal NFC/QR Emergency Profile Design

## Goal

Add a dedicated emergency-only public profile that can be encoded into a QR or NFC workflow and scanned by emergency responders without exposing the patient's full portable record.

## Why This Change

The current platform already supports:

- portable health-record tokens
- versioned health cards
- public token throttling
- allergy, medication, diagnosis, and provenance normalization

What it does not yet support is a true emergency-access profile with a strict minimal payload. The vision document explicitly calls for a universal NFC/QR emergency profile that gives ER teams immediate access to blood group, major allergies, emergency contacts, and ongoing medications with zero registration delay.

## Research Basis

- MedicAlert guidance emphasizes that emergency-facing records should prioritize allergies, regular medications, critical conditions, and a concise ordering of lifesaving facts rather than a full chart dump.
- HL7 International Patient Summary (IPS) positions allergies, medication summary, and problem list as the essential minimum cross-setting dataset.
- OpenEMR documentation and user guidance keep active issues and prescriptions visible in summary views, reinforcing the idea that a short emergency-facing subset should be built from the active list rather than from unrestricted history.

Design implication:

- do not reuse the full portable summary as-is
- do build a dedicated emergency profile from active problems, severe allergies, active medications, and emergency contacts
- do allow it only through emergency-designated card tokens

## Scope

### In Scope

- emergency card issuance path
- emergency public route
- minimal emergency payload builder
- QR/NFC-friendly public URL returned at issue time
- audit logging for emergency scans
- docs updates

### Out of Scope

- real NFC hardware integration
- mobile wallet pass generation
- multilingual frontend rendering
- patient-managed emergency profile editing
- external verifier registry

## Access Model

### Card and Token Intent

Emergency access will be tied to a health card with `card_type = 'emergency'`.

The token itself remains in the existing token table, but the public emergency endpoint must only honor the token when:

- the token is active and not expired
- it is linked to an active emergency card
- the emergency card is not revoked, replaced, or stale

This avoids a risky schema migration while still giving the system a clear emergency-only access boundary.

### Consent Boundary

Unlike the normal portable summary route, the emergency profile route is intentionally designed for lifesaving access without prior interactive consent. Privacy is protected by strict payload minimization rather than broad record disclosure.

## Emergency Payload

The payload should include only:

- patient display info
  - name
  - age
  - gender
  - blood group
  - UHID
- severe or clinically important allergies
- active medications as medication names only
- active critical conditions/problem list
- emergency contacts
  - primary guardian or next of kin if present
  - patient mobile fallback if no guardian exists
- generated timestamp
- source hospital name

The payload must exclude:

- address
- national ID
- full lab history
- discharge summaries
- detailed diagnosis notes
- medication dosing details
- provenance-heavy internals

## Contact Selection Rules

Priority:

1. primary guardian rows from `patient_guardians`
2. patient `guardian_mobile`
3. patient `mobile`

If relationship metadata is unavailable, label the fallback clearly.

## Public Route Behavior

Add a dedicated route:

- `GET /api/public/emergency/:token`

Behavior:

- validate token format
- apply the same KV-backed throttling and invalid-attempt lockouts used for public summary access
- verify linked emergency card is active
- build the emergency profile
- log access as `qr_scan`
- increment token access count

## Card Issuance Behavior

When issuing a health card with `card_type = 'emergency'`, return:

- raw token
- `public_url`
- `qr_payload`
- `profile_kind = 'emergency'`

This lets a printer, frontend, or NFC encoder use the URL directly without needing a second transformation step.

## Technical Design

### New Library

Create a dedicated emergency-profile builder rather than bolting more branching logic into the portable summary builder.

Responsibilities:

- fetch minimal patient demographics
- fetch emergency contacts
- fetch severe allergies
- fetch active medications
- fetch active problems
- shape a compact JSON payload

### Public Route Reuse

The public route should reuse:

- token hashing
- token lock checks
- invalid-attempt recording
- valid token access counting

so summary and emergency routes behave consistently under abuse pressure.

## Testing Strategy

### Unit/Route Level

Add tests for:

- emergency card issuance returns emergency QR payload URL
- public emergency route returns minimal profile for active emergency card
- non-emergency tokens are rejected on emergency route
- revoked or stale emergency cards are rejected
- emergency scans are logged as `qr_scan`

## Done Criteria

This work is complete when:

- emergency cards can be issued through the existing card flow
- emergency scans hit a dedicated public route
- only minimal lifesaving data is exposed
- scans are audited
- docs reflect progress in assessment and vision files

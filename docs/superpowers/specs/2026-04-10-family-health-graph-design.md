# Family Health Graph Design

## Goal

Build a Bangladesh-friendly family graph and managed-account model for the global patient portal so that:

- a parent or guardian can create and manage a child's health profile
- an adult child or caregiver can manage an elderly person's profile when the patient cannot operate the portal alone
- a dependent profile can exist before the patient has their own login
- later self-claim can attach to the same global identity without duplicating the card or record

## Research Notes

Reference patterns used:

- Epic MyChart proxy access distinguishes adult proxy, teen transition, and child proxy flows, and allows the proxy to switch into the managed chart from their own account.
  - Source: [MyChart Proxy Access](https://epicmychart.nychhc.org/MyChart/htmlticklerimages/Signing%20Up%20for%20MyChart%20Proxy%20Access.pdf)
- Patient Access frames proxy access as acting for children, relatives, and dependants with tailored access to appointments, records, medication, and messaging.
  - Source: [Patient Access Proxy Access](https://support.patientaccess.com/proxy/what-is-proxy-access)
- HL7 US Core models family/caregiver relationships through `RelatedPerson`, explicitly covering legal or familial relationship to a patient.
  - Source: [US Core RelatedPerson](https://www.hl7.org/fhir/us/core/STU6/StructureDefinition-us-core-relatedperson.html)
- OpenEMR community direction is to model patient portal proxy access around structured related persons and role-based proxy permissions rather than loose ad hoc links.
  - Source: [OpenEMR Related Person Portal Proposal](https://community.open-emr.org/t/proposal-allow-assigning-related-person-access-to-the-patient-portal/26391)

## Product Decision

Do not build granular consent controls for family access in the first pass.

Instead, use a simple managed-profile model:

- `manager`: can operate the dependent profile in the portal
- `viewer`: reserved for later, not exposed in the first UX

The system must stay simple enough for Bangladesh reality:

- one account can manage multiple family members
- dependent profiles can be created without email or phone
- family members switch profiles from one dashboard instead of separate logins
- elderly and child flows both reuse the same managed-profile pattern

## Core Model

### 1. Global identity remains the patient truth

Every family member profile is still backed by `global_patient_identity`.

A dependent may be:

- `unclaimed`: no personal login yet
- `claimed`: has their own `global_patient_auth`

### 2. Family management is separate from identity

Create `global_family_links` to represent proxy management/access.

Each row links:

- `patient_identity_id`: the subject being managed
- `manager_auth_user_id`: the family member/caregiver account doing the management
- `relationship`
- `access_role`
- `verification_basis`
- `status`

### 3. Managed profile context

Global portal routes accept an optional `managed_identity_id`.

When provided, the backend resolves:

- whether the current signed-in user has an active family-management link
- which global identity is the acting subject
- linked hospital records for that identity

This lets the manager use the same dashboard, visit pass, and emergency pack flows for the dependent.

## Supported Flows

### A. Create dependent profile

Use case:

- parent creates child account
- caregiver creates elderly profile with family approval outside the system

Behavior:

- create a new `global_patient_identity`
- no `global_patient_auth` required
- create `global_family_links` row pointing to the manager account
- return dependent card details and family link

### B. Link existing unclaimed profile

Use case:

- hospital already created a card for an elderly patient
- family member wants to manage that card from their own portal

Behavior:

- identify existing `global_patient_identity` by UHID
- require positive proof: claim code or exact phone/NID verifier from the stored identity
- create family-management link instead of taking over the patient login
- keep the patient profile claimable later

### C. Self-claim later

If the dependent later creates their own login, the same identity remains linked.

The family manager relationship stays active until revoked.

### D. Managed profile switching

Global portal shows:

- self profile
- managed profiles

The user can switch context and operate the dependent chart.

## Access Scope for v1

`manager` access in v1 can:

- view global dashboard and linked hospitals
- view patient guidance and patient-reported summaries
- generate visit pass
- generate emergency pack
- see family graph entry details

Out of scope for this change:

- messaging as dependent
- billing payments as dependent
- document upload as dependent
- granular per-module consent

## Bangladesh-Specific Design Rules

- Do not force every dependent to have email.
- Do not force OTP for family setup.
- Allow guardian/caregiver creation from a single logged-in family account.
- Use UHID + claim code / NID / phone for existing-card linking.
- Keep the UI centered on "Manage Family Member" instead of legal language.

## Risks and Mitigations

- Risk: caregiver could misuse an elderly profile.
  - Mitigation: require claim code or stored verifier for linking an existing card, audit creation, allow revocation.
- Risk: multiple siblings managing one parent becomes confusing.
  - Mitigation: allow multiple links later; v1 exposes active managers but keeps create flow simple.
- Risk: dependent without hospital link looks empty.
  - Mitigation: still show the family profile and health card identity state so the manager understands the record exists but has no hospital data yet.

## Success Criteria

- A parent can create a child profile without creating a separate login for the child.
- A caregiver can attach an elderly unclaimed profile using UHID plus a positive verifier.
- The manager can switch into the dependent profile and use dashboard, visit pass, and emergency pack.
- The dependent can later claim their own account without breaking the family graph.

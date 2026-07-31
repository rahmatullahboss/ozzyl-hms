# Broad Provenance Completion Design

## Goal

Push the HMS toward a consistently trust-aware chart by making provenance explicit across the remaining high-value clinical data types that still surface as raw records in doctor workflows.

This slice deliberately does not implement wearable sync. Wearables remain a future Phase 3 capability because they require connector, consent, and consumer-device reliability work that is out of scope for the current production-hardening push.

## Why This Is Next

The assessment and vision are already strong on identity, health-card access, visit pass, emergency profile, family graph, and medication safety. The biggest remaining product-level gap is the "dual-layered data architecture" promise: the system must show whether data is patient-entered, clinician-entered, clinician-reviewed, imported, or family-derived wherever clinical decisions are made.

Without this, the doctor chart still mixes trustworthy and low-trust data too opaquely in several sections, and the vision remains below target parity.

## Reference Direction

### HL7 / FHIR

- FHIR Provenance treats data trust as metadata that travels with the resource and its actors, not as a hidden implementation detail.
- US Core Provenance pushes the same idea for operational interoperability: what was recorded, by whom, and whether it was derived or asserted elsewhere.

### OpenEMR

- OpenEMR keeps related-person/proxy structures separate from clinical records and leans on audit/history for traceability rather than flattening all trust into one status.
- That direction supports a split between identity/proxy governance and per-record provenance/trust display.

## Scope

### In scope

1. Expand normalized provenance coverage in doctor chart payloads for:
   - lab results
   - radiology reports
   - radiology orders
   - discharge summaries
   - documents
   - referrals
2. Add provenance-aware source drill-down support for:
   - lab source panel
   - discharge source panel
   - document source panel
   - referral source panel
3. Add timeline-level trust metadata so timeline rows can show trust state instead of only record type/status.
4. Surface provenance badges and concise trust text in:
   - doctor chart workspace
   - chart print view
5. Update assessment and vision docs:
   - wearable sync explicitly deferred to future/Phase 3
   - dual-layered data architecture status raised only if implementation justifies it
   - family analytics wording synced to current shipped state

### Out of scope

- Wearable sync, Health Connect, HealthKit
- Native Apple Wallet / Google Wallet
- Consent-system rewrites
- Large schema redesigns for all legacy tables
- Full FHIR Provenance resource emission

## Provenance Model

### Canonical provenance categories

The UI and AI summary should normalize to these trust buckets:

- `clinician_verified`
- `clinician_entered`
- `patient_reported`
- `imported_record`
- `system_derived`
- `family_history`
- `mixed`

### Record-level normalization rules

1. Labs
- If there is a recorded review/audit approval, show as `clinician_verified`.
- Otherwise show as `clinician_entered` because the result is institutionally generated but not yet acknowledged by a doctor.

2. Radiology reports
- If reviewed, `clinician_verified`.
- Else `clinician_entered`.

3. Radiology orders
- `clinician_entered`.

4. Discharge summaries
- `clinician_verified` when finalized or signed.
- `clinician_entered` when still draft/in-progress.

5. Documents
- `imported_record` by default because the chart often cannot guarantee who authored the attachment from metadata alone.

6. Referrals
- `clinician_entered`.

7. Family risk insights
- `family_history`.

8. Patient-reported ADR/lifestyle
- Existing `patient_reported` behavior stays intact.

### Review status text

For sections that support explicit review state, the API should provide both:

- machine-readable provenance/trust category
- concise human-readable badge text

This avoids duplicating normalization rules in multiple frontend files.

## API Design

### Chart payload additions

The doctor chart endpoint should attach provenance objects to the remaining sections:

- `recentLabs.abnormal[]`
- `recentLabs.recent[]`
- `radiologyOrders[]`
- `radiologyReports[]`
- `dischargeSummaries[]`
- `documents[]`
- `referrals[]`
- `timeline[]`

Each provenance object should include at least:

- `category`
- `badge_text`
- `review_status`
- `reviewed_at`
- `reviewed_by`
- `source_label`

### Source drill-down additions

The source endpoint should support:

- `lab-<id>`
- `discharge-<id>`
- `document-<id>`
- `referral-<id>`

Each source payload should expose provenance fields in sections, and where meaningful include a `summary` that mentions trust status without over-claiming authorship.

## UI Design

### Doctor chart workspace

- Timeline rows get a small provenance pill in addition to status.
- Labs, radiology, discharge, document, and referral cards get consistent trust badges.
- Labels must be terse and operational:
  - `Doctor verified`
  - `Clinician entered`
  - `Imported record`
  - `Family history`
  - `Patient reported`

### Print view

- The print summary gets the same trust vocabulary on key sections.
- Do not flood the page with metadata; show badges only where they materially change interpretation.

## Error Handling

- Missing provenance metadata must fall back to a conservative non-false claim.
- If authorship is unclear, prefer `imported_record` or `clinician_entered` over `clinician_verified`.
- Unsupported source IDs should continue returning `404`.

## Testing

1. Route tests for:
- chart payload provenance on new sections
- new source detail endpoints
- timeline provenance badges

2. UI/contract tests for:
- doctor chart provenance rendering
- print view provenance rendering

3. Regression checks:
- existing patient-reported and family-risk flows remain intact
- AI summary citations still resolve

## Expected Outcome

After this slice:

- The dual-layered data architecture moves from "strong partial" to near-complete in doctor workflows.
- The remaining big platform gaps become mostly ecosystem extras: wallet-native packaging, wearables, and a few polish items.
- Wearable sync stays documented as future work rather than falsely inflating current capability.

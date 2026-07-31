# Drug Interaction Engine Design

## Goal

Add a production-safe drug interaction engine that checks new prescription items against the patient's current active medications, same-order items, severe drug allergies, duplicate therapy, and max daily dose limits. The engine should block only the highest-risk cases and return warning-grade alerts for the rest to reduce alert fatigue.

## Context

Current code already has:

- `drug_interaction_pairs` with tenant-scoped seedable data
- `patient_active_medications`
- severe drug-allergy blocking in prescription flows
- `POST /api/e-prescribing/check-safety`
- `prescription_safety_checks` audit storage
- safety override history

The current safety route is too narrow for a full interaction engine:

- it accepts only one medication at a time
- it checks active meds but not same-order items
- it uses exact-name matching without a reusable normalization layer
- it does not distinguish hard-block vs warning policy in a reusable way
- duplicate therapy is limited to exact same medication

## Research Summary

The design follows the same direction as established systems and guidance:

- OpenEMR separates `active medication list` from `medication history`, and its drug decision support notes say interaction checks should use the existing active meds plus allergy list and CPOE context.
- NICE NG5 medicines reconciliation guidance defines reconciliation around an accurate list of current medicines before new prescribing.
- Joint Commission guidance says current medication information should be reviewed against new orders to identify omissions, duplications, contraindications, and changes.
- AHRQ's DDI CDS work shows that broad non-contextual alerts increase alert fatigue; contextual and high-value alerts are preferred.

This means first release should use `active/current medications` as the interaction baseline. Historical medications should remain future context, not blocking input.

## Scope

### In scope

- Check new medication items against:
  - patient active medications
  - other new medications in the same request
  - severe active drug allergies
  - duplicate therapy families
  - formulary max daily dose
- Reuse tenant `drug_interaction_pairs`
- Return structured findings with consistent severity and disposition
- Persist audit results in `prescription_safety_checks`
- Use the same engine from:
  - `POST /api/e-prescribing/check-safety`
  - prescription create flow
  - prescription update/replace flow where applicable

### Out of scope

- full historical-medication interaction logic
- external drug database integration
- UI rendering changes
- automatic clinical overrides

## Approach Options

### Option A: Extend the current route inline

Keep all logic inside `src/routes/tenant/ePrescribing.ts`.

Pros:

- fast to patch
- no new module

Cons:

- route file grows further
- hard to reuse in prescription create/update flows
- testing stays awkward

### Option B: Shared interaction engine library

Move normalization, matching, severity policy, and finding generation into a dedicated library and reuse it from all callers.

Pros:

- best reuse
- easy to test
- clear policy boundary

Cons:

- slightly more upfront work

### Option C: New rules table plus engine

Normalize everything around richer rules metadata now.

Pros:

- stronger long-term platform

Cons:

- too much scope for this release
- requires migration and authoring workflow

## Recommendation

Use **Option B**.

Build a shared library that:

- loads active meds, allergies, formulary limits, and interaction pairs
- normalizes names consistently
- compares new items vs current active meds
- compares new items vs same-order items
- detects duplicate therapy by normalized generic/family rules
- classifies findings into block/warn/info

This fits the current codebase and keeps future external integration as additive work. Curated washout support for recently discontinued high-risk medications was later added as the first extension on top of this engine.

## Design

### 1. Shared engine contract

Create a new library module that exposes:

- medication name normalization
- pair-key normalization for bidirectional interaction lookups
- duplicate therapy grouping
- severity mapping
- evaluation function

Core input:

- tenant id
- patient id
- new medication items
- optional prescription id

Core output:

- `findings[]`
- `summary`
  - `safe`
  - `has_blocking`
  - `has_contraindicated`
  - `has_major`
  - `warning_count`

### 2. New medication input shape

Support evaluating one or more medications in a single request.

Each candidate item should contain:

- `medication_name`
- optional `generic_name`
- optional `dose_mg`
- optional `frequency_per_day`

The old single-item safety endpoint should remain compatible by internally treating one item as an array of one.

### 3. Finding types

Use these finding categories:

- `drug_interaction`
- `allergy_contraindication`
- `duplicate_therapy`
- `max_dose`

Each finding will contain:

- `type`
- `severity`
- `blocking`
- `title`
- `description`
- `recommendation`
- `subject_medication`
- optional `related_medication`
- optional `interaction_pair`

### 4. Severity policy

Policy for this release:

- `contraindicated` => blocking
- `major` => blocking
- `moderate` => warning, not blocking
- `minor` => informational

Duplicate therapy:

- exact same normalized generic or medication => warning
- same-family duplicate therapy can be warning now, not block

Allergy:

- severe / life-threatening => blocking
- moderate => critical warning
- mild => warning

Max dose:

- >150% of max => blocking
- above max => warning
- within max => optional info

### 5. Duplicate therapy model

First release should avoid overfitting. Use:

- exact normalized generic match
- exact normalized medication-name match
- optional same-family grouping for obvious duplicates where formulary generic is present

No class-wide therapeutic duplication by category yet.

### 6. Persistence and audit

Persist results to `prescription_safety_checks` as today, but the warnings payload should now include:

- evaluated items
- findings
- blocking summary

This keeps the override workflow compatible.

### 7. Prescription flow behavior

Prescription create/update flows should use the shared engine before writing medication records.

Behavior:

- if any blocking finding exists, return `422`
- if only warning/info findings exist, allow write and include warnings in response

### 8. Future extension point

Keep room for:

- tenant-configurable washout rules beyond the built-in curated set
- chronic high-risk class rules
- renal/hepatic/lab contextual rules
- external terminology/drug knowledge feed

## Error Handling

- Missing formulary interaction data should not crash the route.
- Missing max dose data should simply skip max dose evaluation.
- A missing generic name should fall back to normalized medication name.
- Duplicate same-order items should be checked once per unique pair.

## Testing Strategy

### Unit

- name normalization
- bidirectional interaction matching
- severity mapping
- duplicate therapy matching
- block/warn summary generation

### Route/integration

- `POST /check-safety` with multiple candidate meds
- major interaction against active med blocks
- same-order interaction warns/blocks correctly
- duplicate therapy is emitted
- max-dose logic works
- existing prescription safety history still records checks

### Regression

- existing allergy safety tests stay green
- existing e-prescribing tests stay green

## Expected Outcome

After implementation:

- Ozzyl will have a real interaction engine instead of a single-item checker
- prescribing decisions will be based on active medication context
- blocking will be reserved for higher-risk events
- audit history remains available for future override and reporting workflows

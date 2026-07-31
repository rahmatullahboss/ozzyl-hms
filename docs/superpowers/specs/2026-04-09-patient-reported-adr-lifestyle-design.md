# Patient-Reported ADR and Lifestyle Design

## Goal

Add the first real Layer A patient-generated data module from the vision:

- self-reported medication adverse reactions
- daily lifestyle and symptom logs
- clinician-facing review-ready access to that data

This should create a usable bridge between patient-entered context and clinically reviewed decision support without waiting for full AI or wearable integrations.

## Why This Next

Assessment and vision now have:

- global identity and claim lifecycle
- health cards and controlled sharing
- provenance and clinician review foundations
- drug interaction engine

The next high-leverage ecosystem step is letting patients contribute structured context that doctors can later review. This is the missing half of the dual-layer model in the vision file.

## Research Direction

This design follows the same pattern used in established standards and systems:

- FHIR `AdverseEvent` supports recording a suspected adverse outcome tied to a medicinal product and lets provenance remain explicit.
- PROMIS and broader PRO guidance favor structured, low-friction patient-reported outcomes with clear time windows and trendability rather than large free-text dumps.
- Mature EHRs and patient portals typically separate:
  - clinician-entered medication/allergy/problem truth
  - patient-entered context, symptoms, adherence, and experience
- Reviewability matters: patient-reported data should not silently overwrite clinician-maintained truth.

So first release should be:

- structured
- low-friction
- provenance-preserving
- review-ready

## Scope

### In scope

- Patient portal endpoints to create/list:
  - adverse reaction reports
  - daily lifestyle logs
- Staff/clinician endpoints to:
  - fetch a patient’s reported summary by local patient id
  - review or reject reported entries
- Review metadata on both data types:
  - `review_status`
  - `reviewed_by`
  - `reviewed_at`
  - `review_notes`
- Summary response suitable for future doctor dashboard and AI use

### Out of scope

- wearable sync
- family graph
- AI physician summary
- automatic conversion into canonical allergies/problems/medications
- patient notifications on clinician review

## Approach Options

### Option A: Extend `global_patient_reported_data` for everything

Pros:

- one table
- low schema count

Cons:

- lifestyle logs and ADRs have different shapes
- weak analytics and summary logic
- awkward validation

### Option B: Keep legacy generic table and add dedicated ADR + lifestyle tables

Pros:

- structured fields for each use case
- easier summaries and review flows
- additive, low migration risk

Cons:

- more tables

### Option C: Build a generic event store now

Pros:

- very flexible

Cons:

- too abstract for this phase
- harder to query cleanly

## Recommendation

Use **Option B**.

Keep `global_patient_reported_data` as the older generic mechanism, but add dedicated tables for:

- `global_patient_adverse_reactions`
- `global_patient_lifestyle_logs`

This is the best compromise between practicality and long-term quality.

## Data Model

### 1. Adverse reactions

Each ADR record stores:

- `uhid`
- `medication_name`
- optional `generic_name`
- `reaction`
- `severity`
- optional `onset_date`
- optional `outcome_status`
- optional `notes`
- provenance defaults:
  - `source = 'patient_reported'`
  - `review_status = 'pending_review'`

This keeps ADR distinct from formal allergy truth. Later a clinician can decide whether to promote a report into a verified allergy or adverse-event record elsewhere.

### 2. Lifestyle logs

Each lifestyle log stores:

- `uhid`
- `logged_on`
- optional `sleep_hours`
- optional `exercise_minutes`
- optional `mood`
- optional `energy_level`
- optional `symptom_score`
- optional `symptoms`
- optional `diet_notes`
- optional `notes`
- provenance defaults:
  - `source = 'patient_reported'`
  - `review_status = 'pending_review'`

This gives enough structure for trend and summary generation without becoming a wearable platform.

## Route Design

### Patient routes

Under `/api/patient-phr`:

- `GET /adverse-reactions`
- `POST /adverse-reactions`
- `GET /lifestyle-logs`
- `POST /lifestyle-logs`

Patient auth remains global and tenant-agnostic through the current patient portal auth model.

### Staff routes

New tenant route namespace:

- `GET /api/patient-reported/patient/:id/summary`
- `PUT /api/patient-reported/adverse-reactions/:id/review`
- `PUT /api/patient-reported/lifestyle-logs/:id/review`

The staff route will resolve a local patient’s `uhid` first. If the patient is not globally linked, return an empty summary rather than crash.

## Review Workflow

Both ADR and lifestyle entries use the same review policy already established elsewhere:

- `pending_review`
- `verified`
- `rejected`

Review does not mutate the patient-entered content. It only annotates trust and reviewer metadata.

This keeps Layer A and Layer B separate, which is exactly what the vision calls for.

## Summary Payload

Staff summary route returns:

- `adverse_reactions`
- `recent_lifestyle_logs`
- `highlights`
  - recent average sleep
  - total exercise minutes over recent window
  - count of pending review items
  - count of severe ADRs

This is intentionally lightweight but future-AI-friendly.

## Validation Rules

### ADR

- medication name required
- reaction required
- severity enum
- outcome enum optional

### Lifestyle

- `logged_on` required
- numeric ranges constrained
- at least one meaningful metric or note required

## Testing Strategy

### Patient-side

- authenticated patient can submit ADR
- authenticated patient can submit lifestyle log
- list endpoints return newest-first

### Staff-side

- local patient id resolves global UHID
- summary returns ADR and lifestyle sections
- review endpoints update review status and metadata
- non-clinical roles rejected

### Regression

- existing patient PHR vault and reported-data routes remain unchanged

## Expected Outcome

After this implementation, Ozzyl will have the first concrete patient-generated data layer from the ecosystem vision:

- patients can report how medicines affected them
- patients can log daily context like sleep, exercise, and symptom burden
- clinicians can review that data without it overwriting clinical truth
- future AI summary work gets structured context instead of empty vision promises

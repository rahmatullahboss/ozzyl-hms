# Patient Reported Input Expansion Design

## Goal
Make the patient portal's self-reported data area directly actionable so patients can add long-term conditions, current health issues, allergies, and current medications from the section cards themselves instead of relying only on the top-level health log modal.

## Current State
- The patient portal has a strong `Self-Reported Data` tab, but the main cards for chronic conditions, allergies, and medications are read-only summaries.
- Patients can currently add data only from the top `Add Health Log` modal.
- There is no dedicated category for temporary but ongoing problems such as fever, cough, pain, gastritis flare-up, or dizziness.

## Proposed UX

### Primary interaction
- Keep the existing `Add Health Log` button for broad entry.
- Turn the main summary cards into clickable quick-add surfaces.
- When a patient clicks a card, an inline form expands inside that same card.

### Data sections
- `Long-term conditions`
  - For chronic illnesses such as diabetes, hypertension, asthma.
- `Current health issues`
  - New category for temporary but active problems such as fever, cough, pain, acidity flare-up.
- `Allergies`
  - Existing severity-aware flow stays.
- `Current medications`
  - Existing medication self-reporting stays.

### Form shape
- Each card gets a focused form with:
  - name/title
  - clinical status
  - start date
  - notes
- Severity remains shown for:
  - allergies
  - current health issues
- The existing modal remains available and supports the new category too.

## Data Model
- Extend patient-reported data category enum with `current_health_issue`.
- Existing storage remains in `global_patient_reported_data`.
- No new table is required for this phase.

## Backend
- Update request validation in `/api/patient-phr/reported-data`.
- Allow create/list flows to include `current_health_issue`.
- Keep response shape backward-compatible.

## Frontend
- Update `PatientReportedDataTab` to:
  - render four cards instead of three
  - allow per-card inline create
  - preserve the top modal flow
  - reuse the same submit logic and post-submit refresh
- Add new locale strings for:
  - current health issue labels
  - quick-add UI
  - section guidance text

## AI Interaction
- The new `current_health_issue` data becomes part of the patient's structured health context and is available for future AI planner refinement.
- This phase does not change AI generation logic directly; it improves upstream input quality.

## Error Handling
- Keep current validation behavior for missing names.
- Show a section-local saving state when using inline forms.
- Close inline forms only after successful create.

## Testing
- Add route tests to prove the new category is accepted.
- Add UI/helper tests to ensure the new section label and portal structure remain stable.
- Preserve existing patient portal e2e mocks by adding the new category where relevant.

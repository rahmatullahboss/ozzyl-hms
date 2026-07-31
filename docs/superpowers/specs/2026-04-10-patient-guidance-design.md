# Patient Guidance Design

## Goal

Add a patient-facing guidance layer inside the patient dashboard that turns existing portal data into simple, low-literacy, non-diagnostic guidance. The output should help the patient understand:

- what needs attention now
- what has been reviewed by a doctor
- what follow-up or preparation is useful before the next visit

This should stay aligned with Bangladesh-style operational reality: simple language, minimal clicks, and no complicated health-IT concepts.

## Research Direction

This design follows three consistent patterns:

1. OpenEMR-style separation between longitudinal records and point-in-time actions.
   - The portal should not dump raw history and expect the patient to interpret it.
   - A short action-oriented layer should sit on top of record data.
2. NHS patient-content guidance.
   - Use plain language, short paragraphs, clear section headings, and direct action wording.
3. Patient safety best practice.
   - Do not present diagnostic conclusions.
   - Do not imply treatment changes without clinician review.
   - Keep doctor-verified vs patient-entered distinctions visible.

## User Experience

The patient dashboard overview gets a new top-level card: `Today’s Guidance`.

The card contains:

- `headline`
  - a short plain-language summary, e.g. "You have 2 follow-up items before your next hospital visit."
- `status`
  - `attention`, `watch`, or `stable`
- `what_changed`
  - recent patient-visible changes such as new prescription, new appointment, new doctor review
- `next_steps`
  - short action bullets written as direct instructions
- `trust_notes`
  - explain what is doctor-verified vs still patient-entered/pending review
- `care_reminders`
  - low-risk operational reminders such as carry latest prescription, upload older reports, create Visit Pass before a new hospital visit

The card must also show a safety note:

- "This is a simple guidance summary. It is not a diagnosis."

## Data Inputs

The feature should reuse data already available in the platform, plus a few small aggregated queries:

- patient auth profile
  - phone present or missing
  - NID present or missing
- global dashboard data
  - upcoming appointments
  - recent prescriptions
  - recent bills are not primary guidance inputs
- patient portal data
  - vault document count
  - patient-reported data counts
  - pending review counts
  - verified counts
  - adverse reaction count
  - lifestyle log recency
- visit pass status
  - whether an active visit pass exists

## Guidance Rules

Guidance must be deterministic and safe.

Priority rules:

1. Identity/profile incompleteness
   - Missing phone or NID becomes a high-priority action.
2. Pending review trust issues
   - If patient-reported items are pending review, show that clearly.
3. Upcoming care tasks
   - Upcoming appointment or recent prescription creates simple preparation reminders.
4. Record completeness
   - If the patient has no vault documents, encourage upload of previous reports.
5. Visit readiness
   - If no active visit pass exists, encourage creating one before visiting a new hospital.

The system should never:

- diagnose disease
- recommend medication changes
- claim unreviewed patient-reported items are medically confirmed

## Backend Shape

Add a small deterministic guidance composer in `src/lib/patient-guidance.ts`.

Add `patient_guidance` to `/api/global-portal/dashboard`.

Response shape:

```ts
interface PatientGuidance {
  headline: string;
  status: 'attention' | 'watch' | 'stable';
  summary: string;
  what_changed: string[];
  next_steps: string[];
  trust_notes: string[];
  care_reminders: string[];
  counts: {
    pending_review_items: number;
    verified_items: number;
    vault_documents: number;
    active_visit_pass: number;
  };
}
```

## Frontend Shape

Render the new card in `web/src/pages/PatientDashboardPage.tsx` near the top of the overview flow, before the metric cards.

UI behavior:

- distinct status color
- 2-column responsive layout on desktop
- short bullet lists only
- visible trust count chips
- explicit low-literacy explanation copy

## Testing

Add:

- unit tests for deterministic guidance composition
- route-level test proving `/api/global-portal/dashboard` includes the guidance contract
- `tsc` and `web build` verification

## Scope Boundaries

In scope:

- deterministic patient-safe guidance
- dashboard API exposure
- dashboard UI rendering
- docs sync

Out of scope:

- freeform LLM-generated patient advice
- medication recommendations
- symptom triage engine
- multilingual content system overhaul


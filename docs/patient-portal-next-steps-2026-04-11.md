# Patient Portal Next Steps

## Current Position

The patient portal is now materially stronger in these areas:

- clearer dashboard hierarchy
- richer hospital services surface
- biometric live punch fix
- connected visit flow with live queue status
- patient-facing journey states for booked, checked-in, called, serving, and completed visits
- synced appointment cards that reflect queue and visit progression

This is enough for a solid patient-facing foundation, but not the end state.

## What To Pause Until A Hospital Is Onboarded

These items depend on real hospital operations, real staff behavior, and real workflow data. They should stay documented but not be treated as the immediate priority.

- real-time reception desk sync for queue movement
- reschedule, late arrival, and no-show operational policies
- doctor-room timing calibration for ETA accuracy
- branch-specific room and counter routing
- hospital-driven appointment confirmation workflow rules
- patient-facing notifications tied to live queue movement
- diagnostic and pharmacy workflow automation based on actual partner processes
- wallet/pass sharing flows that depend on hospital adoption

## What Can Be Built Now Without A Hospital

These improve patient value immediately and are mostly under product control.

- AI health summary for the patient dashboard
- AI-generated care reminders from appointments, labs, prescriptions, and self-reported data
- medication adherence support
- health timeline summarization
- document and record quality checks
- preventive lifestyle suggestions
- risk flags for missing follow-up, overdue labs, repeated symptoms, and unsafe record gaps
- patient-friendly explanation layers for reports, prescriptions, and diagnoses

## Recommended Immediate Priorities

### 1. AI Patient Review Layer

Build a patient-safe review engine that looks at available patient data and generates:

- what changed recently
- what needs attention now
- what to do before the next visit
- what to monitor at home
- when to seek urgent care

Output should always be:

- simple language
- clearly labeled as guidance, not diagnosis
- tied to source records
- conservative when data is incomplete

### 2. Medication Support

Use prescriptions plus refill history to generate:

- medication schedule summary
- missed refill warnings
- likely adherence gaps
- follow-up reminders
- plain-language medicine instructions

### 3. Lab And Report Explainers

For each synced lab result or uploaded report:

- explain what the result generally means
- show whether it looks stable, borderline, or attention-worthy
- suggest the next practical step
- tell the patient whether this likely needs doctor review soon

This should remain informational and avoid hard diagnostic claims.

### 4. Preventive Health Guidance

Use age, sex, diagnoses, symptoms, prescriptions, and patient-reported data to generate:

- lifestyle suggestions
- food and sleep reminders
- exercise suggestions
- chronic condition follow-up reminders
- screening reminders

### 5. Record Readiness Scoring

Add a patient-facing readiness score that answers:

- is my record complete enough for my next visit?
- what is missing?
- what should I upload or confirm now?

This is a high-value feature even before any hospital joins.

## AI Features Worth Building

## A. Daily Health Review

Input:

- appointments
- prescriptions
- lab results
- diagnoses
- uploaded documents
- patient-reported data

Output:

- today’s summary
- top 3 suggested actions
- urgent flags
- next visit preparation checklist

## B. Visit Prep Assistant

Before an upcoming visit, generate:

- suggested questions for the doctor
- which reports to carry
- medication list recap
- symptom recap
- missing info checklist

## C. Medical Record Explainer

Translate clinical data into plain Bangla and plain English.

Examples:

- prescription summary
- lab summary
- diagnosis summary
- what changed since last visit

## D. Safety Review

Flag likely patient risks such as:

- repeated similar visits without resolution
- overdue follow-up
- long time without refill on chronic medicine
- new abnormal lab result with no follow-up
- duplicate or conflicting medication patterns

This should create warnings for review, not final conclusions.

## E. Family Health Support

For managed family profiles:

- child vaccine and growth reminders
- elder care reminders
- chronic disease follow-up reminders
- family medication coordination summaries

## AI Guardrails

These are mandatory if AI is added.

- never present AI as the doctor
- clearly label confidence and data completeness
- separate emergency advice from routine advice
- keep medical language simple
- link every suggestion to the underlying data source when possible
- use safe fallback text when data is sparse
- do not auto-generate strong claims from a single weak signal

## Suggested Product Sequence

### Phase A

Build now:

- AI daily health review
- visit prep assistant
- record readiness score
- lab and prescription explainers

### Phase B

Build after more patient data depth exists:

- medication adherence scoring
- chronic follow-up intelligence
- family health assistant

### Phase C

Build after hospital onboarding:

- live queue notifications
- branch-specific ETA models
- operational reschedule workflows
- hospital-triggered patient updates

## Practical Recommendation

The next best move is not more hospital workflow depth right now.

The next best move is:

1. strengthen the standalone patient portal
2. add AI review and guidance features
3. make the patient feel continuously supported even without hospital integration

That path matches the product vision better at this stage because it creates immediate value for ordinary people before hospital partnerships are in place.

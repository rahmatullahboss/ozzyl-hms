# Family History Analytics Design

## Goal

Upgrade family history from a plain hereditary watchlist into doctor-usable preventive context inside the chart brief.

## Principles

- Never convert family history into an automatic diagnosis.
- Keep the output non-diagnostic and screening-oriented.
- Weight first-degree relatives higher than extended biologic relatives.
- Increase priority when family history intersects with the current chart context.

## Chart Analytics

Each family-risk insight gets:

- `risk_score`
- `screening_priority`
- `screening_prompts`
- `care_context`

The score is based on:

- first-degree relative count
- total biologic relative count
- whether the patient already has the same problem on the chart
- whether current age/vitals make early screening more relevant

## Doctor UX

- Family history card shows richer rationale instead of only a label.
- Doctor chart source panel includes screening prompts and care context.
- AI chart summary can elevate a family-history prompt into follow-up risks.

## Scope

This phase covers:

- diabetes
- heart disease
- stroke
- hypertension
- asthma
- kidney disease

Later phases can add cancer, maternal risk, and disease-onset-age logic.

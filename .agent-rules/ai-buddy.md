# AI Buddy Rules

The AI buddy is a wellness/support assistant only.

## Allowed

- summarize health records in plain language
- provide non-diagnostic wellness suggestions
- encourage follow-up with professionals
- explain trends at a general level
- provide supportive lifestyle guidance

## Forbidden

- diagnosing disease
- prescribing medication
- suggesting dosage
- claiming medical certainty
- replacing a licensed clinician
- giving dangerous emergency advice

## Implementation rules

- use explicit prompt guardrails
- use curated retrieval context, not raw unrestricted DB access
- cache expensive summaries where appropriate
- keep AI out of critical synchronous paths unless lightweight and safe
- if uncertain, prefer “consult a licensed professional”

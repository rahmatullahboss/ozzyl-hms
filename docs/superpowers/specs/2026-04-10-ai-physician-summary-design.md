# AI Physician Summary Design

> **Date:** 2026-04-10  
> **Scope:** Doctor-facing chart summary that combines clinician-entered records and patient-reported context without blurring provenance.

## Goal

Build a higher-bar physician summary layer for the patient chart so a doctor can open a chart and get a concise, citation-backed, clinically relevant snapshot that:

- prioritizes unstable issues and decision-relevant context
- includes Layer A patient-reported lifestyle and ADR signals when relevant
- preserves provenance boundaries between patient-reported and clinician-verified facts
- remains useful even when AI is unavailable

## Why This Is Needed

The current chart route can already aggregate clinical data and optionally call AI, but the summary path is still shallow:

- raw narrative is passed to AI without a strong signal-selection layer
- patient-reported context is now present in the chart, but not elevated into a ranked physician summary
- there is no deterministic doctor summary fallback beyond raw chart sections
- provenance is present in the payload, but not enforced in the summary contract

The ecosystem vision explicitly requires a “30-second snapshot” that combines lifestyle, adverse reactions, medications, and clinical truth. The assessment also says AI summary composition over Layer A + Layer B is the next high-leverage gap.

## Domain Direction

This design follows three domain principles:

1. **Current clinical decision support should stay contextual, not noisy.**  
   The summary should rank high-risk and near-term decision signals, not recap everything.

2. **Patient-generated data must supplement, not silently overwrite, clinician-maintained truth.**  
   A patient-reported ADR can be important context, but it must remain visibly patient-reported unless reviewed.

3. **AI should enrich a structured base, not invent the base.**  
   The system should first compute deterministic signals, then optionally let AI compress them into prose.

## Recommended Approach

### Option A: AI-only freeform summary

Send the chart narrative to AI and display whatever comes back.

**Pros**
- fastest to ship

**Cons**
- weak provenance control
- hard to test
- brittle citation quality
- easy to over-summarize or hallucinate

### Option B: Deterministic summary only

Compute all summary sections locally and skip AI entirely.

**Pros**
- fully testable
- no hallucination risk
- cheap and predictable

**Cons**
- less readable
- weaker “30-second snapshot” quality
- less adaptable to mixed data density

### Option C: Hybrid deterministic signal engine + AI compression

Compute structured summary sections first, then optionally ask AI to rewrite that structured context into a concise doctor-facing brief, with strict citation and provenance guardrails.

**Pros**
- strongest clinical control
- useful even without AI
- testable
- best aligned with the vision

**Cons**
- more work than a raw prompt

**Recommendation:** Option C

## Architecture

### 1. Deterministic Signal Engine

Create a focused summary composer that receives the chart aggregates and produces a structured summary object with:

- `one_liner`
- `active_issues`
- `patient_context`
- `recent_changes`
- `medication_focus`
- `abnormal_results`
- `follow_up_risks`
- `cautions`
- `provenance_flags`

Each entry includes:

- `text`
- `priority`
- `citation_ids`
- `provenance`

This layer is the source of truth for summary content.

### 2. AI Compression Layer

If AI is requested and available:

- pass the structured deterministic summary plus citation whitelist
- instruct the model to compress, not invent
- reject or sanitize items that cite unknown sources
- keep provenance labels visible in patient-generated items

### 3. Fallback Behavior

If AI is unavailable, not requested, or returns invalid output:

- return the deterministic summary in the same top-level summary envelope
- do not degrade to an empty placeholder

## Summary Contract

The chart payload will expose a richer `aiSummary` object:

- `status`: `ready | fallback | unavailable | not_requested`
- `generatedAt`
- `summary`
- `citations`
- `usage`

`summary` will contain:

- `oneLiner`
- `activeIssues`
- `patientContext`
- `recentChanges`
- `medicationFocus`
- `abnormalFindings`
- `followUpRisks`
- `cautions`
- `provenanceFlags`

Each list item will carry:

- `text`
- `priority`
- `citationIds`
- `provenance`

`provenance` values:

- `clinician_verified`
- `clinician_entered`
- `patient_reported`
- `mixed`

## Signal Rules

### Active Issues

Promote:

- critical vitals
- severe allergies
- active unstable consultations
- severe unresolved ADRs
- critical abnormal labs

### Patient Context

Promote only if decision-relevant:

- repeated poor sleep
- high symptom burden
- persistent fatigue
- severe patient-reported medication reaction

Do not dump all lifestyle logs.

### Medication Focus

Prioritize:

- active high-risk meds
- on-hold meds needing review
- recently stopped chronic meds
- drug interaction / allergy conflict outputs already computed elsewhere

### Cautions

Use for:

- unverified allergy data
- pending review patient-reported items
- missing follow-up in unstable chronic disease
- data-trust caveats where a key claim is still patient-reported only

## Provenance Guardrails

- Patient-reported items must remain labeled in summary text or metadata.
- AI may not restate patient-reported items as verified facts.
- Unknown citation IDs are dropped.
- If AI omits all citations for a section, fall back to deterministic items for that section.

## Testing Strategy

### Unit tests

For the summary composer:

- ranks critical issues ahead of informational items
- surfaces clinically relevant lifestyle context
- preserves patient-reported provenance
- emits deterministic fallback sections

### Route/integration tests

- `GET /patients/:id/chart?includeAiSummary=1` returns deterministic fallback when AI disabled
- AI output is sanitized to known citation IDs only
- patient-reported ADR/lifestyle can appear in `patientContext` and `cautions`
- unstable chart state surfaces in `activeIssues` and `followUpRisks`

## Files Expected

- New: `src/lib/chart-ai-summary.ts`
- Modify: `src/routes/tenant/patients.ts`
- New tests around summary composition and chart integration
- Update assessment doc after implementation

## Out of Scope

- wearable sync
- family graph
- fully autonomous treatment recommendations
- diagnosis generation
- replacing clinician review workflows

## Success Criteria

- doctor chart returns a useful summary even without AI
- AI summary becomes a compression of deterministic signals, not a freeform hallucination surface
- patient-generated data is clearly distinct from clinician-verified data
- citation integrity is enforced
- tests cover ranking, provenance, fallback, and AI sanitization

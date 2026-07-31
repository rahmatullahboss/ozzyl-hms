# Washout-Aware Medication Safety Design

## Goal

Extend the existing prescribing safety engine so it can detect clinically meaningful interactions with recently discontinued medications that still carry residual risk during a washout period, without turning the system into a noisy full-history alert engine.

## Why This Change

The current drug safety engine correctly evaluates:

- active medications versus new orders
- same-order medication interactions
- severe drug allergies
- duplicate therapy
- configured maximum daily dose

It intentionally ignores historical medications. That was the right first release, but it leaves a clinically important gap for a small class of medications where stopping the drug does not immediately eliminate the risk. Examples include monoamine oxidase inhibitor exposure before serotonergic agents and recent fluoxetine exposure before MAOI-like agents.

## Research Basis

- OpenEMR clinical decision support documentation is oriented around current medication data at ordering time rather than unrestricted medication history, which supports keeping active medications as the primary decision baseline.
- Medication reconciliation guidance from NICE and Joint Commission centers on the current medication list when checking new orders.
- AHRQ decision-support guidance warns against broad, non-contextual alerting because it increases alert fatigue.

Design implication:

- Do not alert on full medication history.
- Do alert on a narrow, curated set of recently discontinued medications with known washout periods.

## Scope

### In Scope

- Recently discontinued medication checks in the shared safety engine
- Pair-specific washout rules based on normalized generic families
- Route integration for:
  - `/api/e-prescribing/check-safety`
  - prescription create
  - prescription update
- Safety findings that clearly distinguish washout risk from active-drug interaction risk
- Documentation updates in assessment and vision alignment docs

### Out of Scope

- Full pharmacokinetic engine
- Tenant-configurable washout rule authoring UI
- Hard clinical override workflow
- Checking all historical discharge medications
- External drug knowledge API integration

## Clinical Model

### Baseline Principle

The blocking baseline remains:

- current `active` medications
- current same-order items

Recently discontinued medications are an additive risk layer, not a replacement for active-medication checks.

### Recently Discontinued Definition

A medication is considered for washout rules only when:

- `status` is one of `discontinued`, `completed`, `on_hold`, or `suspended`
- and the stop timestamp can be approximated from:
  - `end_date`
  - else `updated_at`
  - else `created_at`

### Rule Set for This Release

This release should stay narrow and clinically defensible:

1. **MAOI family -> serotonergic / interacting agents**
   - Examples in MAOI family:
     - phenelzine
     - tranylcypromine
     - isocarboxazid
     - selegiline
     - rasagiline
     - linezolid
     - methylene blue
   - Default washout window: 14 days
   - Behavior:
     - if new medication interacts with a recently stopped MAOI-family drug within 14 days, create blocking finding

2. **Fluoxetine -> MAOI-family drugs**
   - Fluoxetine has a meaningfully longer residual effect than most SSRIs
   - Washout window: 35 days
   - Behavior:
     - if a MAOI-family new medication is ordered within 35 days of stopped fluoxetine, create blocking finding

### Severity Policy

- `contraindicated` or `major` washout risks should block the order
- washout rules should produce a dedicated finding type so clinicians can tell this is not a concurrent active-med conflict
- finding text must say the medication was recently stopped and mention the remaining washout days

## Technical Design

### Shared Engine

Enhance `src/lib/drug-safety.ts` with:

- support for `recentlyStoppedMedications`
- curated washout rule definitions
- date-window evaluation helpers
- dedicated finding type: `washout_interaction`

The engine will:

1. keep current active-med checks unchanged
2. normalize recently stopped medications into family buckets
3. compare each new medication against the curated washout rules
4. emit findings only when the stop date is inside the configured window

### Route/Data Loading

Routes will query two medication sets:

- active meds:
  - `status = 'active'`
- recently stopped meds:
  - `status IN ('discontinued', 'completed', 'on_hold', 'suspended')`
  - `is_active = 1`

The route layer should not try to encode the clinical rules. It should only fetch candidate rows and pass them to the shared engine.

## User-Facing Behavior

### Safety Check Endpoint

The response should include washout findings in the existing `findings` array with:

- `type = "washout_interaction"`
- blocking flag
- the recently stopped medication name
- recommendation text with washout timing

### Prescription Create / Update

If a washout finding is blocking, the existing `422` block behavior should apply, so ordering workflows remain consistent.

## Testing Strategy

### Unit Tests

Add cases for:

- MAOI-family recently stopped within 14 days blocks serotonergic/interacting medication
- same medication outside washout window does not trigger
- fluoxetine stopped within 35 days blocks MAOI-family new medication
- active-med interaction behavior remains unchanged

### Route Tests

Add coverage that:

- `/check-safety` returns washout findings
- prescription create is blocked by washout rule
- prescription update is blocked by washout rule

## Risks and Guardrails

### Main Risk

False positives from broad historical medication scanning.

### Guardrail

Only recently stopped medications that match a curated washout rule are considered.

### Secondary Risk

Stop dates are imperfect because the schema does not have a dedicated `stopped_at` column.

### Guardrail

Use the best available timestamp now and keep the helper isolated so a future `stopped_at` column can replace the approximation cleanly.

## Done Criteria

This change is complete when:

- shared engine supports washout-aware findings
- both prescribing routes use the new data path
- tests cover blocking and non-blocking washout windows
- docs reflect that historical-medication washout support is now implemented as a curated high-risk layer

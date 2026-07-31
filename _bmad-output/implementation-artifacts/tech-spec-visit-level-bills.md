---
title: 'Add Visit-Level Bill Grouping to Patient Context'
type: 'feature'
created: '2026-05-22T12:00:00.000Z'
status: 'done'
context: []
---

# Add Visit-Level Bill Grouping to Patient Context

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The frontend OPD History tab needs bills grouped by visit_id to show bills under each visit, but the patient context endpoint currently returns flat arrays of bills.

**Approach:** Add visit-level bill grouping to the patient context endpoint by computing a visitBills array that groups bills by visit_id.

## Boundaries & Constraints

**Always:** 
- Preserve existing bill arrays (normalizedBills, normalizedDueBills) unchanged
- Only include bills with valid visit_id > 0
- Avoid duplicate bills within the same visit group

**Ask First:** None - this is a straightforward data transformation.

**Never:** 
- Don't modify existing bill normalization logic
- Don't remove or change existing response fields
- Don't add database queries - use existing in-memory data

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bills with visit_id | normalizedBills + normalizedDueBills | Grouped by visit_id in visitBills array | N/A |
| Bills without visit_id | visit_id = null or 0 | Excluded from visitBills | N/A |
| Duplicate bills | Same bill in both arrays | Deduplicated by id | N/A |
| Empty bills | No bills | Empty visitBills array | N/A |

</frozen-after-approval>

## Code Map

- `src/routes/tenant/reception.ts` -- Contains patient context endpoint with bill normalization logic

## Tasks & Acceptance

**Execution:**
- [ ] `src/routes/tenant/reception.ts` -- Add visitBills computation after normalization block -- Groups bills by visit_id for OPD History tab
- [ ] `src/routes/tenant/reception.ts` -- Add visitBills to response object -- Makes visitBills available to frontend

**Acceptance Criteria:**
- Given normalizedBills and normalizedDueBills are computed, when visitBills is computed, then it contains bills grouped by visit_id with no duplicates
- Given the response object, when visitBills is added, then it appears in the JSON response alongside existing fields
- Given existing tests, when run, then all tests pass without modification

## Spec Change Log

## Verification

**Commands:**
- `npx vitest run test/integration/routes/reception.test.ts` -- expected: All tests pass

**Manual checks:**
- Inspect response structure to verify visitBills array is present and properly formatted
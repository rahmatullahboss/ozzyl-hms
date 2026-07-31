# CDB-V1-071B Emergency Admission Convergence Design

## Context

CDB-V1-071 production migrations completed, but bounded backfill stopped before Worker rollout because tenant `100` produced 56 open convergence issues:

- 4 planned/admitted legacy admissions with no canonical encounter mapping;
- 34 emergency legacy admissions mapped to exact emergency encounters, but rejected because canonical admission validation only accepted inpatient encounters;
- 16 bed stays lacking canonical admission mappings, exactly downstream of the 4 + 12 admission cases with bed stays;
- 4 legacy bed-status cache variances where cached bed status disagrees with interval-based occupancy evidence.

The current production Worker remains the sole 100% traffic version. Legacy remains final response authority.

## Goals

1. Make the canonical admission model internally consistent: emergency admissions must be allowed to reference emergency encounters; all other admission types must reference inpatient encounters.
2. Converge the 34 exact emergency admission mappings without changing their emergency encounters.
3. Create deterministic inpatient encounters only for the 4 planned admissions that have one exact patient link and no canonical encounter mapping.
4. Allow the existing admission and bed-stay backfill to complete deterministically on a subsequent authorized run.
5. Keep the 4 legacy bed-status cache variances explicit and non-destructive; they require a separate bounded disposition authorization rather than legacy bed mutation.

## Non-goals

- No production execution in this implementation task.
- No mutation of legacy admissions, beds, patient-bed intervals, patients, visits, billing, or clinical notes.
- No provider flag, Canonical authority, local-sync, route, Worker traffic, or Legacy authority change.
- No broad redesign of the encounter/admission domain.

## Approach considered

### A. Resolve all issues as waivers

Fastest but unsafe. It would hide a real schema contradiction and leave admissions/bed stays unconverged.

### B. Convert emergency encounters to inpatient encounters

Rejected. It would destroy exact emergency encounter semantics and alter clinical episode identity.

### C. Repair the admission model and synthesize only missing inpatient encounters

Selected. It preserves exact emergency identity, creates only the four missing inpatient episodes, and lets existing deterministic admission/bed-stay logic finish.

## Schema change

Add migration `0571_canonical_admission_encounter_type_alignment.sql`.

The migration replaces `canonical_admissions_validate_insert` and `canonical_admissions_validate_update` with rules requiring:

- `admission_type = 'emergency'` → matching canonical encounter type `emergency`;
- every other admission type → matching canonical encounter type `inpatient`;
- patient link and tenant must still match exactly.

The update trigger includes `admission_type` in its watched columns. No table rebuild or business-row update occurs.

## Backfill behavior

### Exact emergency admissions

For an admission normalized to type `emergency`, an exact mapped emergency encounter is valid. The existing encounter is not retyped or rewritten. The backfill creates the canonical admission, initial status event, and mapped source mapping.

### Planned admissions without encounter mapping

When all of these are true:

- one exact active canonical patient link;
- no encounter mapping through legacy encounter, legacy admission, or active admission link;
- normalized admission type is not emergency;
- interval is valid;

the backfill creates a deterministic inpatient canonical encounter using the legacy admission as source identity. It also creates:

- initial encounter status event;
- encounter source mapping `entity_type=encounter`, `source_type=legacy_admission`;
- encounter-admission link preserving `legacy_admission_id`.

The new encounter uses the admission timestamps and status to derive canonical encounter status. It does not infer clinician, location, or diagnosis data.

### Invalid or ambiguous cases

The backfill remains fail-closed when patient links are missing/multiple, an emergency admission maps to inpatient (or vice versa), intervals are invalid, or an existing mapping conflicts. No guessing is introduced.

### Existing ambiguous mappings

The first failed production run wrote ambiguous admission mappings and open issues. A separately authorized reconciliation must remove or supersede only the exact 38 ambiguous admission mappings/issues before replay. This implementation supplies deterministic behavior for the replay but does not perform that production cleanup automatically.

## Bed-stay convergence

After the 38 canonical admissions are mapped, the existing bed-stay partition can resolve the 16 admission-mapping issues and create/update the exact canonical bed stays. No change to bed-stay matching rules is required.

## Bed-status cache variance

The 4 cache variances are not data-model blockers. Interval records remain the occupancy evidence; legacy cached bed status remains unchanged. A later protected reconciliation may mark the exact four issues `resolved` or `waived` with a bounded evidence fingerprint. They are not silently suppressed by this change.

## Error handling

- Trigger mismatch aborts the transaction.
- Deterministic IDs and unique source mappings prevent duplicate episodes.
- Conflicting existing encounter mappings remain issues.
- Replay must use a fresh migration run/checkpoint namespace or an exact protected reset of only the failed CDB-V1-071 run artifacts.
- Production rollout remains blocked until the new migration, reconciliation, replay, zero-new-row second pass, health checks, and new candidate authorization all pass.

## Testing

- Migration test verifies emergency admission ↔ emergency encounter succeeds, non-emergency ↔ inpatient succeeds, and cross-type combinations fail.
- Backfill tests verify exact emergency convergence without encounter mutation.
- Backfill tests verify deterministic inpatient encounter synthesis for a planned admission without mapping.
- Idempotency tests verify second execution creates zero new business rows.
- Existing encounter/admission/bed convergence and reconciliation suites remain green.
- Full TypeScript and production build must pass before integration.

## Release consequences

This change creates a new `main` candidate SHA and a new migration. The previous CDB-V1-071 candidate `6db262686985c01982b2858ce0963c8a1447215a` must not be deployed. Production application of migration `0571`, cleanup/replay, cache-variance disposition, candidate upload, and staged traffic rollout require a new exact protected authorization bound to the final verified candidate and evidence package.

# LIS Clinical Release Hardening Plan

Date: 2026-08-11
Scope: Laboratory / LIS only
Companion spec: `docs/lis-clinical-release-safety-spec-2026-08-11.md`

## 1. Observed pre-implementation risks

The accessible repository snapshot already contains strong staged analyzer acceptance, QC, retraction and supersession services, but final clinical release surfaces are not uniformly protected by the same authority.

Confirmed examples in `src/routes/tenant/lab.ts`:

- legacy `/items/:itemId/verify` directly writes `lab_order_items.status = 'verified'` after tenant/billing checks;
- `detectAbnormalFlag` fabricates critical thresholds from the normal range when explicit critical limits are absent;
- `/orders/:id/report/print` generates a patient-facing laboratory report without proving that a governed final release snapshot exists.

The implementation therefore prioritizes authority unification over adding more features.

## 2. Strategy

Use additive, fail-closed changes with minimal schema conflict. Reuse existing LIS acceptance/QC/retraction/supersession primitives where possible. Avoid destructive migrations in the reference branch.

### Phase A — Inventory and bypass closure

1. Enumerate every route/service/job that writes or treats as final:
   - `verified`, `validated`, `released`, `published`, `final`;
   - final print/download/portal communication;
   - correction/retraction state changes.
2. Classify each surface as authoritative, delegated, legacy-disabled, or unsafe bypass.
3. Replace unsafe final-state mutations with calls into the domain authority or fail-closed compatibility behavior.

### Phase B — Clinical release policy library

Introduce small pure functions/types that encode invariants independently of HTTP:

- explicit critical-threshold evaluation only;
- release state classification;
- deterministic canonical release snapshot serialization/digest contract;
- separation-of-duties check;
- machine-readable safety failure codes.

Pure policy code makes adversarial unit testing possible even before a database migration is required.

### Phase C — Release service

Create/extend a single `lis-clinical-release` service that:

1. loads report/order/patient/specimen/result context tenant-scoped;
2. rejects retracted/invalid state;
3. proves mandatory result completeness;
4. proves exact verified result versions/snapshot evidence;
5. invokes/reuses current QC/calibration/lot/validation gates;
6. applies SoD and critical communication policy;
7. commits release/audit/outbox idempotently with optimistic concurrency.

If the current schema lacks durable fields required for exact snapshot binding, use an additive migration only after confirming the current local branch schema. The reference branch must not guess a conflicting migration number.

### Phase D — Route rewiring

- Legacy item verification must no longer directly create a clinically final state.
- Final report validation/publication calls the release service.
- Final print/download requires released evidence.
- Draft output, if retained, must be explicit and watermarked.
- Portal/external delivery must query the current governed release, not arbitrary current rows.

### Phase E — Corrections and critical results

- Preserve immutable released history through supersession.
- Bind correction/re-release to a new release version/snapshot.
- Ensure critical-result communication tracks recipient + acknowledgement/read-back + escalation, not merely dispatch.

### Phase F — Safety tests

Add a dedicated production safety suite, preferably:

- `test/unit/lis-clinical-release-policy.test.ts`
- `test/unit/lis-clinical-release-safety.test.ts`
- integration tests against D1 for transaction/idempotency/concurrency where the harness supports them.

Required negative cases are defined in the companion spec.

### Phase G — CI gate

Add `test:lis:safety` and include it in `test:production:unit` or an equivalent required production workflow. Clinical safety must not depend on developers remembering to run an optional suite.

### Phase H — Adversarial review

After implementation:

1. grep/search every direct final-state mutation;
2. search all final report output surfaces;
3. attempt tenant IDOR/cross-tenant guessing;
4. test stale snapshot TOCTOU;
5. test concurrent release/replay;
6. test malformed validation config;
7. test missing critical thresholds;
8. verify correction/retraction invalidates stale final artifacts;
9. confirm audit/outbox uniqueness;
10. classify remaining findings P0/P1/P2 and remediate P0/P1 before integration.

## 3. Implementation order for this pass

1. Commit spec and plan before code.
2. Remove fabricated critical-threshold fallback.
3. Introduce fail-closed final-report release/print policy primitives that are safe to transplant.
4. Disable or redirect direct legacy verification bypass if it cannot prove the central safety invariants.
5. Add targeted adversarial tests for the policy/bypass behavior.
6. Add the LIS safety test command to production CI scripts.
7. Perform static adversarial review and document findings/remediation.

## 4. Local integration procedure

The newer local worktree must be reconciled before merge because it may contain phases not represented by the accessible snapshot.

Target local worktree previously associated with this workstream:

`/Users/rahmatullahzisan/Desktop/Dev/worktrees/lab-canonical-20260807`

Target local branch previously associated with this workstream:

`codex/lab-canonical-20260807`

Before transplant/integration on the Mac:

1. inspect unexpected concurrent parent Node processes; stop only unexpected task-owned parents, never global/brute-force kill;
2. verify `git status`, `MERGE_HEAD`, unresolved conflicts and task-owned WIP;
3. verify current local `main` and rebase/reconcile the Laboratory branch onto it safely;
4. compare this reference branch against the rebased Laboratory branch and transplant only non-duplicate changes;
5. run targeted LIS tests;
6. run `pnpm canonical:check && pnpm test:production && pnpm build` if still valid for current main;
7. run the new LIS clinical-safety suite explicitly;
8. repeat adversarial route/state-mutation review after conflict resolution.

## 5. Definition of done

This hardening pass is done only when:

- spec and plan exist and match implementation;
- no known legacy route can create a final clinical state without central safety proof;
- no code infers a clinical critical threshold;
- final patient-facing report output is release-gated;
- exact verified snapshot/version binding exists or remains an explicit integration blocker;
- LIS safety tests are mandatory in production CI;
- adversarial review has no open P0/P1 clinical-release bypass;
- current local branch has been reconciled and tests have actually passed.

Until the last two conditions are met on the current local worktree, this reference branch is implementation/transplant material, not authorization for unrestricted production deployment.
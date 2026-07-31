# CDB-101 Smoke/Observation Evidence Implementation Plan

1. Add a fixture and failing tests for the aggregate-only evidence contract.
2. Add failing tests for protected schema-v2 authorization binding, scope/plan/threshold/owner/recovery mismatches, shadow-effective and expiry checks, separate timing evidence, chronology, CLI protection, receipt leakage, and valid `no_go` semantics.
3. Implement strict protected JSON parsing and semantic evidence validation.
4. Reuse `prepareProtectedReportingCutoverAuthorization` and bind completed evidence to the protected authorization without changing migration/import/initial-shadow preconditions or command IDs.
5. Add `measurementKind`, `measuredAtUtc`, separate timing evidence ID/hash, and full policy-measurement-shadow-observation-decision-generation-validation chronology.
6. Add the offline CLI and package command; require both `--evidence` and `--authorization`, and reject `--execute` plus unknown/duplicate arguments.
7. Add the fail-closed production evidence template and operational documentation.
8. Extend only the post-stage execution evidence template with `evidenceReady`, `authorizationBound`, and `promotionReady` receipt fields.
9. Run focused tests, the complete canonical suite, TypeScript, governance, migration-manifest checks, JSON parsing, protected CLI success/refusal, missing-authorization refusal, and deterministic planner checks.
10. Review the diff for protected-value leakage, circular dependencies, accidental production access, and scope expansion.
11. Commit on the isolated task branch, merge into the program branch under the shared lock, run integration verification, update handoff trackers, and do not push.

## Completion checklist

- [x] RED authorization/recovery hardening tests observed before implementation.
- [x] Strict evidence module implemented.
- [x] Protected schema-v2 authorization binding implemented.
- [x] Separate policy/timing measurement evidence and chronology implemented.
- [x] Offline CLI requires evidence and authorization and rejects execution.
- [x] Protected template and runbook documentation updated.
- [x] Execution evidence template separates evidence, authorization, and promotion readiness.
- [x] Full verification complete.
- [x] Task branch committed and integrated.
- [x] Program trackers updated.

# Emergency Canonical Admission Implementation Plan

Date: 2026-07-31
Base: `origin/main` at `3da958da07e7a20d016dbe08176a629bd6f54b65`
Branch: `feature/emergency-canonical-admission`

## Completed slices

1. Review emergency registration, list/detail projection, triage, finalize behavior, patient master routing, and the standard IPD admission command.
2. Add tested server helpers for active-admission enforcement and incomplete emergency profile detection.
3. Project active admission metadata through the admission provider (including canonical-only mode) and patient profile completeness on emergency list/detail reads.
4. Reject false ER `admitted` finalization when no active admission exists.
5. Audit ER disposition changes with the linked admission reference.
6. Add a retry-safe emergency-to-IPD form that uses the standard admission command and a stable idempotency key.
7. Keep patient-master editing visible for new, triaged, finalized, and admitted emergency cases on mobile/desktop emergency views and on emergency-sourced IPD admission rows regardless of status.
8. Add focused server, request-builder, and action-visibility tests.
9. Run focused regression tests, TypeScript validation, production web build, canonical governance checks, and final branch review.

## Integration checklist

- Review only task-owned files; exclude `.ai-bridge` and generated build artifacts.
- Commit the verified task branch.
- Reconcile against the latest fetched `origin/main`.
- Integrate through a clean main worktree, rerun focused verification, push `origin/main`, and remove only the fully merged task worktree/branch.

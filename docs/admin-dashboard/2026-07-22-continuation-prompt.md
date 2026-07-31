# Admin Dashboard Control Center — Implementation Continuation Prompt

Use the following command in a new implementation session.

```text
@HMS ADC-CONTINUE করো; current implementation-এর জন্য dirty root বা docs branch modify করবে না; latest reviewed clean main থেকে isolated branch `program/admin-dashboard-control-center-20260722` এবং fixed worktree `.worktrees/admin-dashboard-control-center-20260722` create/verify করো; প্রথমে `agents.md`, `.agent-rules/architecture.md`, `.agent-rules/coding-rules.md`, `.agent-rules/data-storage.md`, `.agent-rules/performance.md`, relevant security/production-readiness rules, `docs/admin-dashboard/README.md`, `docs/admin-dashboard/2026-07-22-current-state-audit.md`, `docs/admin-dashboard/2026-07-22-product-requirements.md`, `docs/admin-dashboard/2026-07-22-information-architecture-ux-spec.md`, `docs/admin-dashboard/2026-07-22-data-semantic-api-contract.md`, `docs/admin-dashboard/2026-07-22-implementation-roadmap.md`, `docs/admin-dashboard/2026-07-22-qa-acceptance-test-plan.md`, `docs/admin-dashboard/2026-07-22-agent-task-board.yaml`, এবং `docs/superpowers/plans/2026-07-22-admin-dashboard-control-center-implementation.md` পুরোটা পড়ো; task board থেকে earliest incomplete dependency-safe task খুঁজে একা serially TDD অনুযায়ী implementation, targeted tests, checkpoint commits, tracker updates এবং verification চালাও; operational tables-কে source of truth রাখবে, parallel ledger বানাবে না, source failure-কে zero দেখাবে না, financial summary/detail reconciliation বাধ্যতামূলক রাখবে, existing tenant KPI overrides preserve করবে, changes additive/feature-flagged রাখবে; normal checkpoint commit-এর পরে STOP নয়—পরের safe task-এ এগিয়ে যাবে; production authorization ছাড়া production mutation, remote migration, production flag change বা production E2E করবে না; context/execution limit কাছে এলে clean checkpoint commit, exact next task, test evidence এবং continuation handoff লিখে থামবে।
```

## Expected first execution order

1. `ADC-001` — verify clean baseline and record current targeted tests.
2. `ADC-002` — freeze explicit metric semantics.
3. `ADC-003` — create golden reconciliation fixtures.
4. `ADC-101` through `ADC-103` — shared semantic foundation.
5. Proceed only when the phase gate passes.

## Non-negotiable decisions

- Do not start with visual restyling.
- Do not add more default cards.
- Do not silently reinterpret existing financial metrics.
- Do not calculate authoritative totals from current-page rows.
- Do not duplicate Action Center logic in the frontend.
- Do not treat unknown/unmapped data as a normal category.
- Do not claim a complete zero when a required provider failed.
- Do not remove legacy endpoints before feature-flag parity and pilot evidence.

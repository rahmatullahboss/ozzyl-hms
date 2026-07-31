# Ozzyl HMS Admin Dashboard Control Center Program

**Status:** Documentation baseline complete
**Date:** 2026-07-22
**Reviewed base:** local `main` at `79b054a199dbc877d0232015dcf9625361b0a08e`
**Documentation branch:** `docs/admin-dashboard-control-center-20260722`
**Primary roles:** Hospital Admin, MD, Director, Accountant, authorized Manager

## Executive decision

The current admin dashboard contains substantial reporting capability, but it is too dense and does not consistently communicate time basis, source completeness, reconciliation state, comparison context, or required action. The redesign must therefore prioritize **trust and decision support before adding more cards or charts**.

The dashboard will become a role-aware control center with five layers:

1. **Global reporting context** — period, date basis, temporal mode, timezone, refresh state, and data health.
2. **Focused executive signals** — a limited role preset of decision-grade KPIs.
3. **Financial reconciliation** — visible bridges between billing, collection, deposits, expenses, payouts, cash custody, and variance.
4. **Action center** — one prioritized queue for exceptions, approvals, collection follow-up, and data-quality problems.
5. **Progressive drillthrough** — summary → source group → transaction/item → invoice, admission, settlement, or audit evidence.

The dashboard remains an overview. Dense doctor, test, IPD, inventory, reagent, radiology, and transaction analysis belongs in dedicated workspaces opened from the overview.

## Current-state headline

The clean `main` implementation has improved range filtering for KPI and analytics panels, and IPD now receives the selected period. However:

- The default registry enables **40 KPI cards and 5 full analytics panels**.
- Revenue trend, payment method, operations snapshot, live cash, action center, and audit feed still use independent current/today/latest queries.
- Flow, as-of snapshot, and live values appear together without a universal temporal-mode contract.
- KPI summary responses do not expose comparison, generated timestamp, source completeness, warning, reconciliation, or explicit date basis.
- A second frontend heuristic exception section duplicates the persistent Action Center.
- Generic audit severity is inferred from CRUD verbs rather than business impact.
- Some secondary request failures can look like verified zero values.

Detailed evidence is in the [current-state audit](./2026-07-22-current-state-audit.md).

## Controlling documents

| Document | Purpose |
|---|---|
| [Owner summary — Bangla](./2026-07-22-owner-summary-bn.md) | Non-technical decision summary for the product owner |
| [Current-state audit](./2026-07-22-current-state-audit.md) | Code-evidence review, strengths, gaps, risks, and priority |
| [Product requirements](./2026-07-22-product-requirements.md) | Users, jobs, scope, functional and non-functional requirements |
| [Information architecture and UX specification](./2026-07-22-information-architecture-ux-spec.md) | Target screen hierarchy, interaction model, responsive and accessibility rules |
| [Data semantics and API contract](./2026-07-22-data-semantic-api-contract.md) | Metric meanings, temporal modes, source status, reconciliation, security, and performance contract |
| [Implementation roadmap](./2026-07-22-implementation-roadmap.md) | Phases, dependencies, rollout, and migration sequence |
| [QA and acceptance test plan](./2026-07-22-qa-acceptance-test-plan.md) | Verification matrix and release gates |
| [Agent task board](./2026-07-22-agent-task-board.yaml) | Machine-readable execution backlog and dependencies |
| [Continuation prompt](./2026-07-22-continuation-prompt.md) | Exact handoff command for an implementation worker |
| [Detailed implementation plan](../superpowers/plans/2026-07-22-admin-dashboard-control-center-implementation.md) | File-by-file TDD execution plan |

## Controlling principles

1. A number without a defined meaning, period, and source status is not a decision-grade KPI.
2. `0`, unavailable, stale, partial, and unreconciled are distinct states.
3. A dashboard period applies to period-aware surfaces; live/current surfaces must be visibly labeled and must not pretend to follow historical filters.
4. Every financial summary must reconcile to all matching detail rows or display an explicit unexplained difference.
5. “Other” and “Uncategorized” are data-quality exceptions, not normal business categories.
6. The dashboard uses a limited role preset by default; configuration may reveal additional modules without making the default unusable.
7. Comparisons use absolute and percentage variance with a metric-specific desirable direction.
8. Complex analysis uses full pages; drawers are for concise, bounded previews.
9. Patient and financial detail permissions are enforced by the server.
10. Dashboard hot paths use bounded, indexed, small-payload requests and avoid unnecessary fan-out.

## Research basis

The design direction follows official guidance and established reporting patterns:

- WHO routine health information guidance emphasizes standardized core indicators, recommended visualizations, data-quality assessment, and use of data for decision-making.
- Microsoft reporting guidance supports drillthrough from summarized results to contextual detail, KPI targets and trends, readable visual hierarchy, and accessible alternatives.
- NHS and AHRQ guidance reinforces timely, accurate data and deliberate measure prioritization.

Source links and implementation interpretation are recorded in the audit and UX specification.

## Program priority

**P0 is not a visual redesign.** P0 establishes a shared temporal and data-health contract, removes semantic ambiguity, reduces the default overview, and makes reconciliation failures visible. Styling and advanced analytics remain secondary until the numbers can be trusted.

## Integration boundary

This branch contains documentation only. It does not modify application behavior, database schema, production data, feature flags, or deployment configuration. Implementation must occur on a separate task branch following the detailed plan and repository production-readiness rules.

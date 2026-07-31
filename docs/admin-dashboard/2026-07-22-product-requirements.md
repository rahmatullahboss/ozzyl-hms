# Admin Dashboard Control Center — Product Requirements

**Date:** 2026-07-22
**Status:** Approved documentation baseline
**Product:** Ozzyl HMS
**Surface:** Tenant hospital admin dashboard

## 1. Product goal

Enable authorized hospital management to understand operational and financial health, verify the evidence behind material values, and act on exceptions without manually comparing multiple screens or asking a developer to explain the calculation.

## 2. Success statement

An administrator opening the dashboard must be able to determine, within one scan:

- the selected reporting context,
- the most important financial and operational signals,
- whether the data is complete, fresh, and reconciled,
- which exceptions require action,
- where each important value came from,
- which detail workspace should be opened next.

## 3. Primary users

### 3.1 Hospital Admin

Needs daily operational control, cash custody, due follow-up, discount/cancellation oversight, approvals, stock risk, and department bottlenecks.

### 3.2 MD / Director

Needs concise owner-level trends, collection and expense performance, cash/reconciliation risk, capacity utilization, and high-impact exceptions. Does not need transaction tables by default.

### 3.3 Accountant

Needs exact date basis, billing versus collection separation, expenses and payouts, deposits, payment methods, accounting posting status, reconciliation, and export controls.

### 3.4 Authorized Manager

Needs assigned operational signals, queues, exceptions, and department summaries. Owner-level financial and patient-identifying detail is not granted by default.

## 4. Jobs to be done

### Financial control

- Understand how much was billed, discounted, collected, deposited, refunded, spent, paid to doctors, and retained.
- Separate cash from non-cash and accounting income from physical cash movement.
- Understand how much cash should exist in each drawer and whether closing/handover reconciles.
- Identify unknown payment methods, unmapped services, missing evidence, and unexplained differences.

### Revenue-cycle control

- Understand new due created in the period and outstanding due as of period end.
- Identify aged/high-risk receivables and open their patient/invoice evidence.
- Distinguish current collection from old-due collection.

### Operational control

- Understand patient flow from registration through consultation, diagnostic completion, admission, and discharge.
- See current capacity and bottlenecks without mixing them with historical flow.
- Identify overdue tests, pending discharge settlements, bed pressure, and stock/QC exceptions.

### Governance

- See pending approvals and exceptions in one prioritized queue.
- Understand who changed, approved, cancelled, refunded, or settled a material transaction.
- Verify that access to patient and financial detail is permitted and audited.

## 5. Product principles

1. **Trust before decoration.** Data meaning, completeness, and reconciliation precede visual polish.
2. **Overview before detail.** The dashboard highlights; dedicated workspaces analyze.
3. **One meaning per metric.** Ambiguous labels are prohibited.
4. **One temporal mode per value.** Every value is period, as-of, or live.
5. **One action queue.** Persistent Action Center owns management work.
6. **Progressive disclosure.** Detail appears only when requested.
7. **Server-owned truth.** Authoritative totals, comparisons, severity, and reconciliation are calculated by backend services.
8. **Permission-aware evidence.** Sensitive fields are omitted or masked by the server.
9. **Accessible by default.** Meaning never depends on color, hover, or pointer input alone.
10. **Performance is a product requirement.** The overview avoids unnecessary fan-out and full-detail payloads.

## 6. Scope

### 6.1 Included in the program

- Shared dashboard context and URL state
- Temporal modes and date-basis labels
- Role-based default presets
- Decision-grade KPI contract
- Comparison and threshold context
- Source completeness and freshness state
- Financial reconciliation bridge
- Persistent Action Center consolidation
- Period-aware revenue/collection trend
- Period-aware payment-method mix
- Patient-flow and current-capacity separation
- Live cash state with explicit failure handling
- Business-level audit feed
- Generic preview drilldown improvements
- Links to dedicated doctor, test, commission, IPD, inventory, reagent, radiology, and audit workspaces
- Accessibility, responsive behavior, security, performance, observability, and tests

### 6.2 Excluded from the first implementation

- Replacing operational billing, accounting, cash, IPD, lab, inventory, or commission ledgers
- A generic drag-and-drop BI builder
- Predictive financial advice
- AI-generated clinical or financial recommendations
- Cross-tenant benchmarking
- Arbitrary end-user formulas
- A second independent reporting ledger
- Production data repair without a separately authorized task

## 7. Global context requirements

### FR-CTX-01 — Shared filter ownership

`AdminDashboard` owns normalized filter state and passes it to all period-aware surfaces. The filter state is reproducible through URL query parameters.

### FR-CTX-02 — Supported date presets

- Today
- Yesterday
- This week
- This month
- Last month
- Last 7 days
- Last 30 days
- Custom range

All dates use inclusive Asia/Dhaka business-date semantics.

### FR-CTX-03 — Date basis

The context exposes the active basis where applicable:

- service date,
- bill date,
- payment date,
- posting date,
- admission date,
- discharge date,
- census/as-of date.

A metric may lock its basis if only one basis is valid, but the label remains visible.

### FR-CTX-04 — Temporal mode

Each metric/surface declares:

- `period` — events occurring between start and end dates,
- `as_of` — state at the end of the selected period,
- `live` — current operational state independent of historical filters.

Live surfaces display a visible `Live` badge and their own generated timestamp.

### FR-CTX-05 — Data-health banner

The context bar displays one aggregate state:

- Healthy
- Warning
- Partial
- Stale
- Unreconciled

Opening it lists affected domains and recovery actions.

## 8. KPI requirements

### FR-KPI-01 — Limited default preset

Hospital Admin default contains no more than 10 primary KPI signals above the fold. Suggested baseline:

1. Net billed amount — period
2. Cash received — period
3. Non-cash received — period
4. Approved expense paid — period
5. New due created — period
6. Outstanding due — as of period end
7. Net cash movement — period
8. Drawer variance — live/as of latest closing
9. Critical exceptions — current
10. Bed occupancy — live/as of current time

Final inclusion is controlled by the metric registry and role preset tests.

### FR-KPI-02 — Decision-grade card content

A primary card displays:

- explicit label,
- formatted value,
- temporal-mode badge,
- date-basis label or tooltip,
- previous comparable value,
- absolute variance,
- percentage variance when denominator is valid,
- desirable direction,
- target/threshold when configured,
- freshness/source state,
- reconciliation state for financial metrics,
- drill action.

### FR-KPI-03 — Metric-specific direction

The same positive percentage cannot be colored as good for every metric. Registry defines whether higher, lower, target-range, or neutral is desirable.

### FR-KPI-04 — No ambiguous labels

Labels such as `Revenue`, `Collection`, `Profit`, `Commission`, `Due`, `Cash`, and `Others` require a qualified definition. Examples:

- Payment-date bill collection
- GL-posted operating revenue
- Approved cash expense paid
- New patient due created
- Outstanding patient due as of date
- Earned doctor commission
- Payable doctor commission
- Paid doctor commission
- Outstanding doctor commission
- Unmapped service amount

### FR-KPI-05 — Unknown/unmapped values

Unknown payment method, uncategorized service, missing doctor attribution, and similar records appear as warnings/exceptions with count and amount. They are not silently merged with normal categories.

## 9. Financial reconciliation requirements

### FR-FIN-01 — Visible billing bridge

Display:

```text
Gross billed
− Discount
= Net billed
− New due
= Collection attributable to period billing
```

The response states the date basis and whether prior-period due collection is included separately.

### FR-FIN-02 — Visible cash bridge

Display:

```text
Cash bill collection
+ Cash due collection
+ Cash deposit received
+ Other approved cash in
− Cash refund/return
− Cash expense paid
− Cash doctor payout
− Cash drop/handover
= Expected available drawer cash movement
```

Each component is drillable.

### FR-FIN-03 — Reconciliation state

Every financial section includes:

- summary total,
- complete-detail total,
- unexplained difference,
- tolerance,
- balanced flag,
- warning/action when not balanced.

### FR-FIN-04 — Deposit separation

Deposit received, deposit applied to bill, deposit refund, and remaining deposit liability are distinct measures.

### FR-FIN-05 — Billing, collection, cash, and accounting separation

The UI must never imply these are identical:

- bill generated,
- payment collected,
- physical cash received,
- accounting revenue posted,
- profit or operational surplus.

## 10. Action Center requirements

### FR-ACT-01 — Single source

All management actions originate from `/api/action-center` contracts. Frontend totals must not invent severity or create parallel exception queues.

### FR-ACT-02 — Priority data

Each action item includes:

- rule/type,
- severity,
- human-readable title,
- count,
- amount where applicable,
- oldest age/SLA state,
- responsible role or assignee,
- capability state,
- target route with filters,
- status.

### FR-ACT-03 — Minimum exception coverage

- Unbalanced report/closing
- Cash short/excess
- Stale/pending handover
- Unknown payment method
- Unmapped service/test/category
- Missing discount reference
- High or unauthorized discount
- Cancellation/refund review
- Missing expense evidence
- Failed/pending accounting posting
- High-aged receivable
- Commission calculation/settlement exception
- Stock-out/expiry/QC exception

### FR-ACT-04 — No normal activity as exception

A normal approved expense, payment, admission, or discount is not actionable solely because its amount is non-zero. Rules require threshold, missing evidence, policy breach, unusual change, overdue state, or reconciliation failure.

## 11. Operational requirements

### FR-OPS-01 — Period patient-flow funnel

Provide compact counts and conversion/drop-off for:

```text
Registered/checked in
→ consultation completed
→ diagnostic ordered
→ diagnostic completed
→ admitted
→ discharged
```

Only stages supported by reliable source data are displayed.

### FR-OPS-02 — Current capacity strip

Separate current/as-of measures:

- occupied/available beds,
- occupancy percentage,
- beds unavailable for cleaning/maintenance where supported,
- active counters,
- current diagnostic backlog,
- open discharge settlements.

### FR-OPS-03 — Domain health summaries

Inventory, laboratory, reagent, radiology, and pharmacy display compact health summaries such as critical count, warning count, and primary action. Full tables are opened separately.

## 12. Trend and payment requirements

### FR-TRD-01 — Server-owned trend

Trend endpoint accepts metric, start/end date, date basis, and granularity. It returns exact points, summary, comparison, and warnings.

### FR-TRD-02 — Correct chart type

Use line charts for at least four chronological points. Use stat cards for fewer points. Provide an accessible data-table alternative and exact values through keyboard/touch interaction.

### FR-PAY-01 — Period-aware payment mix

Payment mix follows the selected period and reports cash, supported digital methods, card, bank, cheque, and unknown. Server returns totals and percentages or values sufficient for exact client display without changing authoritative totals.

## 13. Audit requirements

### FR-AUD-01 — Business event contract

Dashboard audit events include:

- event type,
- business severity,
- actor,
- subject/reference,
- concise narrative,
- amount or changed fields where permitted,
- occurrence time,
- approval/review state,
- target route.

### FR-AUD-02 — Material events only

Dashboard feed prioritizes bill amount changes, discount override, cancellation/refund, expense/payment, payout, cash variance, handover, permission change, and sensitive export. Generic low-risk CRUD activity remains in the full audit workspace.

## 14. Drillthrough requirements

### FR-DRL-01 — Context preservation

Drillthrough preserves start date, end date, date basis, temporal mode, role scope, source, doctor/test filters, and status in the URL/API query.

### FR-DRL-02 — Hierarchy

```text
Summary
→ source/category
→ transaction/item
→ invoice/admission/order/settlement
→ audit evidence
```

### FR-DRL-03 — Drawer versus page

Use a drawer for a concise preview with bounded columns and rows. Use a full page for doctor, test, commission, IPD, inventory, reagent, radiology, or reconciliation analysis.

## 15. State and error requirements

### FR-STATE-01 — Explicit states

Every data surface supports:

- loading,
- complete zero,
- complete non-zero,
- empty/not applicable,
- partial,
- stale,
- unavailable/error,
- unreconciled.

### FR-STATE-02 — Partial response behavior

A failed optional domain does not blank the whole dashboard. The domain displays unavailable/partial state, while the global banner records the issue. Failed required sources prevent a healthy/balanced claim.

### FR-STATE-03 — Refresh behavior

Refresh state is per-domain and aggregate. Last refreshed time must originate from the response `generatedAt`, not only from the moment a browser request completed.

## 16. Security requirements

### SEC-01 — Tenant isolation

Every endpoint enforces tenant scope before querying.

### SEC-02 — Role and field permissions

Server controls access to:

- patient identifiers,
- commission formulas,
- audit details,
- export,
- financial totals,
- exception management.

### SEC-03 — No sensitive leakage

Errors, logs, warnings, analytics events, and query keys must not expose PHI or secrets.

### SEC-04 — Audited sensitive access

Sensitive detail views and exports are audited where required by policy.

## 17. Accessibility requirements

- Keyboard access for filters, cards, charts, tables, dialogs, and drill actions
- Visible focus indicators
- Correct heading order and landmarks
- Meaning not conveyed by color alone
- Text labels for health, direction, and severity
- Minimum accessible contrast
- Table alternative for chart data
- Screen-reader summary for trends
- Dialog focus trap, escape close, and focus restoration
- Touch targets at least 44 CSS pixels where practical
- Reduced-motion support
- English and Bangla semantic parity

## 18. Performance requirements

### PERF-01 — Overview request budget

Default above-the-fold view should require no more than:

- one configuration/preset request when not cached,
- one compact overview summary request,
- one action-center request,
- one live-state request when live controls are visible.

Optional below-fold domains load lazily or after explicit expansion.

### PERF-02 — Bounded server work

- Indexed D1 queries
- Bounded date ranges
- Server-side pagination
- No complete-detail rows in summary responses
- No repeated query in loops
- No unbounded parallel fan-out
- Heavy exports outside the synchronous request path

### PERF-03 — Payload budget

The default overview response target is under 100 KB uncompressed, excluding separately requested detail.

### PERF-04 — Perceived stability

Reserve layout space for async sections, avoid content jumps, and show progressive loading rather than replacing a stable dashboard with a full-screen spinner.

## 19. Observability requirements

Record without PHI:

- endpoint latency,
- query duration by report domain,
- response size,
- source-status counts,
- reconciliation failures,
- stale responses,
- unknown/unmapped counts,
- dashboard partial-load rate,
- drillthrough and action-center navigation success.

## 20. Release acceptance

The first release is acceptable when:

1. All displayed metrics declare temporal mode and date basis.
2. Historical selection cannot silently coexist with unlabeled today/live values.
3. Default Hospital Admin view has no more than 10 primary KPIs.
4. Financial summaries expose reconciliation state.
5. Source failure never displays as verified zero.
6. Action Center is the only management exception source.
7. Uncategorized and unknown values are actionable warnings.
8. Summary and complete detail reconcile for golden fixtures.
9. URL state reproduces the selected context.
10. Keyboard, screen-reader, responsive, permission, and performance gates pass.

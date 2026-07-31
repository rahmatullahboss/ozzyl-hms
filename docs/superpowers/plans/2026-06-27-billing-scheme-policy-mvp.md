# Billing Scheme Policy MVP

## Research-backed operating rules

- Keep charge master/service item pricing separate from payer or benefit-specific pricing. A scheme may point to a price category, but item prices remain in the service catalog/price category map.
- Keep eligibility separate from scheme definition. Staff, VIP, owner, shareholder, charity, corporate, and campaign benefits need auditable members/participants instead of ad-hoc receptionist choices.
- Keep discount source allocation explicit for accounting and audit. The patient-facing bill should show a clean total discount, while internal rows preserve the funding/source reason.
- Keep approvals and references as policy, not UI-only behavior. A scheme can require reference/documentation or approval above a threshold.

## Implementation scope

This MVP extends Billing Master without replacing the existing billing package flow.

1. Scheme policy fields
   - scheme type expanded for benefit/campaign use cases.
   - optional default price category.
   - internal discount source.
   - validity window.
   - per-bill cap.
   - approval threshold.
   - reference requirement.
   - auto-apply flag.

2. Scheme members
   - tenant-scoped `billing_scheme_members` table.
   - patient/member-code eligibility foundation.
   - status and validity window.

3. Apply/preview endpoint
   - validates active scheme and validity.
   - validates patient/member eligibility when member rows exist.
   - returns recommended price category, discount source, percent, capped amount, approval/reference flags.

4. Billing screen integration
   - selecting a scheme can switch to its default price category.
   - UI shows policy preview so cashier understands what will apply.

## Later phases

- Department/service-category specific rule matrix.
- Corporate contract coverage rules.
- Budget ledger/reconciliation per discount source.
- Auto allocation into `bill_discount_allocations` for every billing flow.
- Approval queue integration for scheme threshold breaches.

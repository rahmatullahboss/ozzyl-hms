# Refund Request Visual Hierarchy Design

**Date:** 2026-07-26

## Goal

Make bill-refund and payment-void request flows immediately understandable on mobile and desktop without changing refund calculations, approval behavior, payment reversal, cash-hold handling, or commission reconciliation.

## Current Problem

The refund method choices are visually similar text buttons with weak hierarchy. Users must read too much copy before understanding which option refunds the whole bill, which option selects individual services, and which option requires entering a monetary amount. The cash figures also appear as nearly identical neutral boxes, and payment-void requests do not visually communicate their financial consequence strongly enough.

## Approved Design

### Refund method cards

Replace the plain segmented selector with three large selectable cards:

1. **Full refund** — amber treatment, receipt/return icon, concise description indicating that the full refundable bill amount will be selected automatically.
2. **Item-based partial refund** — blue treatment, checklist icon, concise description indicating that individual services can be selected.
3. **Amount-based refund** — violet treatment, money icon, concise description indicating that a specific amount must be entered and will be allocated across eligible items.

Each card must have:

- a distinct icon and accent colour;
- a clear selected state using border, background, ring, and check indicator;
- `aria-pressed` to communicate selection to assistive technology;
- a minimum touch-friendly height;
- stacked layout on narrow mobile screens and three columns from the small breakpoint.

### Contextual input area

Only the currently selected refund mode's relevant controls remain prominent:

- Full refund shows the item summary and automatic eligible selection.
- Item-based partial refund shows selectable item rows.
- Amount-based refund shows a visually prominent amount input and the automatic allocation panel.

Mode switching must preserve the existing state-reset rules and backend payload behavior.

### Cash summary

Present Expected cash, Held refunds, and Available cash as differentiated KPI cards:

- Expected cash: blue.
- Held refunds: amber.
- Available cash: emerald.

Amounts are visually dominant, labels are secondary, and the layout stacks on mobile and uses three columns on larger screens.

### Payment correction / void request

When requesting payment correction, show a concise warning panel explaining that approval reverses the receipt, returns the bill to unpaid/due status, and triggers the existing financial/commission reconciliation. The receipt card must remain visible and the reason field remains required.

### Copy

Reduce long visible explanatory paragraphs. Keep one concise sentence in the header and move mode-specific guidance into each action card or selected panel. Existing translation calls may use new `defaultValue` text without requiring locale-file changes in this focused task.

## Behaviour That Must Not Change

- Full, item-based, and amount-based refund payload construction.
- Refund eligibility and maximum amount calculations.
- Cash availability and held-refund validation.
- Admin/accounts approval workflow.
- Payment reversal and commission reconciliation logic.
- Existing reason validation and submit actions.

## Responsive Acceptance Criteria

- On a phone-sized viewport, all three choices are readable as separate stacked cards without horizontal scrolling.
- On desktop, the choices display in one three-column row.
- A user can identify where to select services or enter an amount without reading the whole panel.
- Selected and unselected cards remain distinguishable in light and dark modes.

## Testing

Add a focused source-level UI regression test that verifies:

- the three action-card markers and accessible selection state are present;
- distinct mode-specific visual treatments are present;
- the three cash KPI treatments are present;
- the payment-void consequence warning is present;
- the existing amount and item controls remain wired to their corresponding modes.

Run the focused regression test, TypeScript typecheck/build checks applicable to the web package, and review the final diff before committing.
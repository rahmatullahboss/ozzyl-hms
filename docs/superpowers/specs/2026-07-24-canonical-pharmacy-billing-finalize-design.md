# Canonical Pharmacy Billing Finalize Design

**Date:** 2026-07-24

**Base:** local `main` at `c376b108a`

**Boundary:** `pharmacy.billing.finalize`

**Status:** Approved by the standing `CDB-CONTINUE` instruction to complete remaining canonical financial writers serially from the latest reviewed local `main`.

## Problem

`src/routes/tenant/pharmacy/advanced.ts` contains two separate finalization workflows behind the same strict boundary:

1. `POST /provisional-invoices/:id/convert`
2. `POST /prescriptions/:id/dispense-invoice`

Both workflows currently combine:

- source-document validation and status changes;
- FEFO or explicitly selected stock resolution;
- legacy stock cache decrement;
- pharmacy invoice and invoice-item creation;
- pharmacy stock-transaction creation;
- optional patient-deposit deduction;
- source-document completion;
- manual compensating rollback when a later step fails.

The writes span multiple transactions. A stock decrement, deposit adjustment, invoice header, item rows, stock transactions and source-document status can temporarily or permanently diverge if compensation is incomplete.

The boundary is blocked in strict mode because there is no reviewed command that atomically commits legacy pharmacy authority with canonical service, invoice, receipt/deposit and inventory authority.

## Mandatory shadow contract

Disabled and shadow modes must retain the original production-tested workflows exactly. In particular:

- provisional conversion keeps the `active → converting → converted` claim behavior;
- prescription dispense keeps the existing status validation and FEFO/explicit selection behavior;
- stock is deducted before invoice creation;
- legacy manual compensation remains unchanged;
- legacy payment, tender, credit and deposit validation messages remain unchanged;
- canonical failure after legacy commit does not alter the response.

Strict-only validation, canonical mapping requirements, canonical balance checks, row assertions and schema dependencies must never execute in disabled or shadow mode.

## Source audit findings

### Two workflows cannot share one legacy executor

The provisional flow reads `pharmacy_provisional_items`, preserves item-level discount/VAT totals, supports optional stock IDs and updates a provisional status.

The prescription flow reads `pharmacy_prescription_items`, resolves stock through explicit selections or FEFO, prices from current stock and marks a prescription dispensed.

A common reconstructed legacy batch would change one or both workflows. They require separate exact original executors.

### Runtime money authority

Although old schema comments label several pharmacy amounts as paisa, current route behavior and integration tests treat values such as `100` as a runtime invoice total of `100`. Legacy arithmetic remains unchanged. Canonical minor units are produced only at the canonical boundary with `toMinorUnits()`.

### Canonical inventory prerequisites

The existing inventory backfill defines pharmacy authority as:

- item: `canonical_inventory_items.legacy_pharmacy_item_id`;
- lot: `canonical_inventory_lots.legacy_pharmacy_stock_id`;
- location: active location code `PHARMACY-RICH`;
- movement source: `legacy_pharmacy_stock_transaction` / `pharmacy_stock_transactions`.

Strict mode must require these mappings. Shadow mode may record a canonical failure while preserving legacy success.

### Quantity constraint

Canonical inventory and service quantities are positive safe integers. Legacy pharmacy tables allow `REAL` quantity. Fractional legacy quantities remain supported in disabled and shadow modes, but strict mode fails before identity allocation or mutation until an approved unit-conversion policy exists.

## Decision

Implement three focused units.

### 1. Common canonical pharmacy sale command

Create `settle-pharmacy-sale.ts`.

The command accepts one normalized positive sale with source kind:

- `provisional_conversion`; or
- `prescription_dispense`.

It commits in one D1 batch:

- one canonical service request and one `dispensed` event per sold item;
- one canonical invoice with service lines plus one global discount line when required;
- optional canonical payment receipt/tender/allocation for `paidAmount`;
- optional canonical deposit applications for `depositDeductAmount`;
- canonical invoice due equal to `creditAmount`;
- one linked canonical inventory `sale` movement per pharmacy stock transaction;
- command, request, event, invoice, payment and inventory outbox events;
- source mappings to the actual legacy invoice item and stock transaction identities.

The command receives strict authoritative legacy statements from the coordinator so legacy and canonical authority share the same transaction in strict mode.

### 2. Provisional conversion adapter

Create `pharmacy-provisional-finalization.ts` with:

- `executePharmacyProvisionalOriginalLegacy()`;
- `preparePharmacyProvisionalStrictContext()`;
- `preparePharmacyProvisionalStrictStatements()`.

### 3. Prescription dispense adapter

Create `pharmacy-prescription-finalization.ts` with:

- `executePharmacyPrescriptionOriginalLegacy()`;
- `preparePharmacyPrescriptionStrictContext()`;
- `preparePharmacyPrescriptionStrictStatements()`.

The two adapters produce one shared normalized `PharmacySaleContext` for the canonical command and post-commit response.

## Normalized sale context

The context contains:

- tenant, user, patient, optional visit/prescriber/counter;
- source kind and source document ID;
- generated pharmacy invoice number;
- business date and normalized UTC timestamp;
- payment mode, tender, paid, credit and deposit amounts;
- subtotal, discount and total in legacy runtime units;
- item rows with stable line number and duplicate ordinal;
- pharmacy item, stock, batch, quantity, current available quantity and prices;
- legacy source item identity;
- canonical item, service, lot, location and balance/version identities;
- canonical minor-unit amounts.

## Strict preflight

Strict preparation is asynchronous and lazy. It runs only after strict policy selection and before invoice-number allocation.

It must validate:

1. source document is eligible and tenant-owned;
2. every source item is present;
3. stock selection exactly matches source quantity;
4. quantity is a positive safe integer;
5. current stock exists, is active, unexpired and sufficient;
6. payment split equals total;
7. cash tender covers declared cash payment;
8. legacy deposit balance covers requested deduction;
9. total is positive and all money values convert exactly to safe minor units;
10. canonical inventory item exists by `legacy_pharmacy_item_id`, is active and has a service identity;
11. canonical lot exists by `legacy_pharmacy_stock_id` and belongs to the item;
12. active canonical location `PHARMACY-RICH` exists;
13. canonical base unit/conversion can represent the integer source quantity;
14. canonical inventory balance exists and equals the legacy stock cache before sale;
15. canonical deposit availability covers requested deduction;
16. invoice number is allocated only after all preceding checks pass.

Any failure occurs before source claim, stock decrement, invoice insert or deposit adjustment.

## Strict legacy statements

### Provisional conversion

The guarded batch performs:

1. claim `active → converting` with one-row assertion;
2. exact stock-cache updates using expected preflight quantity and available balance;
3. pharmacy invoice insert with guarded unique invoice identity;
4. pharmacy invoice-item inserts;
5. pharmacy stock-transaction inserts;
6. optional legacy deposit adjustment with current balance guard;
7. final `converting → converted` update;
8. assertion cleanup.

### Prescription dispense

The guarded batch performs:

1. assert prescription is neither dispensed nor cancelled;
2. exact stock-cache updates;
3. pharmacy invoice insert;
4. pharmacy invoice-item inserts;
5. pharmacy stock-transaction inserts;
6. optional legacy deposit adjustment;
7. guarded prescription status update to `dispensed`;
8. assertion cleanup.

No manual rollback is used in strict mode because all statements and canonical authority share one transaction.

## Canonical service and invoice model

Each sold line creates:

- an active request with requested quantity equal to the integer sold quantity;
- a posted `dispensed` event for the same quantity;
- a canonical invoice service line linked to that event.

The invoice line uses quantity `1` and line-level total minor as its unit amount. This preserves exact legacy line totals even when per-item VAT or discount means the line total is not evenly divisible by the physical quantity. Physical quantity remains authoritative in the request, event and inventory movement.

A global pharmacy discount becomes one negative canonical discount line. Invoice arithmetic must equal the legacy header total exactly.

Source types:

- invoice: `legacy_pharmacy_invoice` / `pharmacy_invoices`;
- invoice item request/event: `legacy_pharmacy_invoice_item` / `pharmacy_invoice_items`;
- inventory movement: `legacy_pharmacy_stock_transaction` / `pharmacy_stock_transactions`.

## Payment and deposit model

`paidAmount` creates one canonical receipt, tender and invoice allocation.

Tender mapping:

- `cash` → `cash`;
- `card` → `card`;
- `mobile` → `mobile_wallet`;
- other paid modes → `other` with the original method code.

`depositDeductAmount` creates canonical oldest-available deposit applications through the existing settlement preparation.

`creditAmount` remains invoice due. The required identity is:

```text
paid + deposit + credit = invoice total
```

The legacy pharmacy invoice header remains the payment source evidence; no new legacy `payments` row is invented.

## Canonical inventory movement model

Each inserted `pharmacy_stock_transactions` sale row maps to one canonical `sale` movement linked to:

- the corresponding `dispensed` service event;
- canonical invoice;
- canonical invoice line.

The movement uses the preflight canonical balance/version and updates it atomically. The strict legacy stock update requires the same expected legacy available quantity. This creates a dual parity guard:

```text
legacy available before = canonical balance before
legacy available after  = canonical balance after
```

The source mapping selects the actual committed stock-transaction ID by invoice number, stock/item identity and duplicate ordinal.

## Shadow execution

For each route:

1. run the exact original legacy executor;
2. store its committed normalized context;
3. attempt the common canonical command without authoritative statements;
4. record canonical failure as a shadow issue;
5. return the original successful response unchanged.

Legacy manual compensation remains inside the original executor and is not reused by strict mode.

## Replay and conflicts

The common command uses deterministic identities from tenant, source kind, invoice number and line identity.

Identical replay returns the prior result. Changed patient, item, stock, quantity, price, payment, deposit, credit or discount evidence under the same key is rejected.

Strict failures are converted to the existing concurrent/canonical-unavailable conflict response. Disabled and shadow validation messages remain legacy-compatible.

## Governance

After both route flows are integrated:

```text
FINANCIAL_ROUTE_COVERAGE['pharmacy.billing.finalize']
status: integrated
canonicalCommand: settlePharmacySale
```

Direct compatibility-write allowances move from `src/routes/tenant/pharmacy/advanced.ts` to the two dedicated adapter files for:

- `pharmacy_invoices`;
- `pharmacy_invoice_items`;
- `pharmacy_stock_transactions`;
- `billing_deposits` where applicable.

The route must no longer contain direct insert/update authority for the integrated finalization blocks. Unrelated pharmacy CRUD remains untouched.

## Testing strategy

TDD must prove:

1. both original executors preserve exact source-specific order and manual rollback behavior;
2. strict-only factories never run in disabled/shadow;
3. fractional quantity, zero total, missing canonical mapping, balance drift and deposit drift fail before sequence allocation;
4. provisional claim, stock, invoice, items, transactions, deposit and source status commit atomically;
5. prescription stock, invoice, items, transactions, deposit and dispense status commit atomically;
6. stale stock, duplicate invoice, source-status race and deposit race roll back everything;
7. canonical request/event/invoice/payment/deposit/inventory facts commit together;
8. inventory movement links the exact service event and invoice line;
9. actual legacy invoice-item and stock-transaction mappings are created;
10. identical replay succeeds and conflicting evidence fails;
11. shadow canonical failure preserves each legacy `201` response;
12. strict preflight creates no legacy mutation;
13. existing mobile/card tender and stock compensation tests remain green;
14. financial coverage and governance report the boundary integrated;
15. full canonical, TypeScript, governance and production builds pass.

## Non-goals

- No pharmacy return/credit-note integration.
- No goods-receipt or purchase accounting integration.
- No fractional unit-conversion policy invention.
- No refactor of unrelated pharmacy routes.
- No production push, deployment, migration/backfill, feature-flag change, traffic movement, tenant mutation, observation, rollback or legacy retirement.

# Medication Administration and Reconciliation Authority Audit

**Checkpoint:** `CDB-124A-MEDICATION-ADMINISTRATION-AUTHORITY-DESIGN`

**Date:** 2026-07-28

**Scope:** repository-only audit; no schema, runtime, provider, sync, or production mutation

## Executive finding

The current medication administration record is not one stable clinical authority. `nur_medication_admin` mixes scheduled work, actual administration, non-administration outcomes, mutable correction, and visibility state in one row. Medication reconciliation is a separate workflow but is also mutable and only loosely connected to prescription and medication-order intent.

The Canonical design must separate:

1. immutable medication administration or non-administration events linked to an exact Canonical medication order; and
2. versioned, signed medication reconciliation workflow evidence that never becomes administration evidence by itself.

## Reviewed sources

### `nur_medication_admin`

Defined by `migrations/0047_nursing.sql` and expanded by `migrations/0050_clinical_mar.sql`.

The table contains patient, visit, free-text medication, dose, route, frequency, scheduled time, actual time, administering user, status, non-administration reason, barcode marker, remarks, and `is_active`.

Current risks:

- future schedule and actual administration are stored in the same row;
- `src/routes/tenant/nursing/medication-orders.ts` generates future rows with status `scheduled`;
- `src/routes/tenant/nursing/mar.ts` performs an in-place administration update on that scheduled row;
- the generic MAR route can update medication, dose, route, status, time, and remarks in place;
- soft delete can hide medication administration evidence by setting `is_active=0`;
- schedule rows and administration facts therefore cannot be reliably distinguished by table identity alone.

### `cln_medication_orders`

The nursing CPOE route creates an order and then, outside the same atomic batch, generates MAR schedule rows. A failure in MAR generation can leave the order committed without expected schedule projections.

The order route updates mutable order status and appends `cln_medication_order_status_history`; however, the current MAR row references only a legacy numeric `order_id` and free-text medication snapshots.

Canonical medication-order intent already exists in `canonical_medication_orders` and `canonical_medication_order_status_events`. A new administration authority must link to the exact Canonical order and order status version rather than infer identity from legacy medication text.

### Medication administration route

`src/routes/tenant/nursing/mar.ts` contains:

- list and detail reads;
- generic create/update/delete paths;
- an administer endpoint that mutates the existing MAR row;
- reports grouped by medication name and status.

`given` and `late` require dose and route at validation level, while statuses also include `withheld`, `refused`, `not_given`, `hold`, `not_available`, and `cancelled`. These vocabularies are inconsistent with table comments and other readers.

Medication text is not medication-order identity. Medicine name, patient/time proximity, schedule similarity, and numeric coincidence cannot prove that a MAR row belongs to a Canonical medication order.

### Medication due and nursing consumers

`src/routes/tenant/nursing/medication-due.ts` and other nursing summaries read schedule and status fields as operational workflow. These may remain compatibility projections, but they must not own immutable administration facts.

### `cln_medication_reconciliation` and `cln_medication_reconciliation_items`

Created in `migrations/0050_clinical_mar.sql` and written by `src/routes/tenant/nursing/medication-reconciliation.ts`.

The `cln_medication_reconciliation` header records admission, transfer, or discharge reconciliation with mutable status, completing user, timestamps, notes, and active flag. `cln_medication_reconciliation_items` contains free-text medication, dose, route, frequency, source, decision, reason, and proposed replacement instructions.

Current risks:

- draft items are inserted and deleted directly;
- header completion mutates the same row rather than preserving a signed version;
- items are not tied to a specific reconciliation version;
- free-text medication may be mistaken for prescription or order identity;
- completion does not enforce exact patient, encounter, practitioner, prescription, or medication-order evidence;
- discharge checklist update is non-atomic because it occurs after reconciliation completion;
- completion could be interpreted as creating new medication intent even though no explicit prescription/order command is executed.

Medication reconciliation is a separate signed workflow authority. It reviews medication history and recommends continue, modify, discontinue, or add decisions. It is not medication administration evidence and must not silently create medication orders or prescriptions.

## Writer and reader surface

Primary writers:

- `src/routes/tenant/nursing/mar.ts`
- `src/routes/tenant/nursing/medication-orders.ts`
- `src/routes/tenant/nursing/medication-reconciliation.ts`

Primary readers and projections:

- `src/routes/tenant/nursing/medication-due.ts`
- `src/routes/tenant/nursing/clinical-summary.ts`
- `src/routes/tenant/patients-timeline.ts`
- `src/routes/tenant/patients-chart.ts`
- `src/lib/health-summary.ts`

## Required source disposition

| Source | Disposition |
|---|---|
| order-linked MAR row with actual outcome | exact source candidate for one immutable Canonical administration event |
| schedule-only MAR row | workflow/projection; not an administration fact |
| MAR row without exact Canonical order mapping | deterministic processing issue; no administration event |
| mutable update/delete history | preserve source snapshot and map only reconstructable final evidence; never rewrite Canonical history |
| reconciliation header/items | migrate as versioned reconciliation workflow, not administration |
| prescription/order/discharge effects | remain separate explicit commands and projections |
| medication-due lists and reports | rebuildable consumers/projections |

## Target boundary

The minimal design contains five table families:

1. `canonical_medication_administration_events`
2. `canonical_medication_reconciliations`
3. `canonical_medication_reconciliation_versions`
4. `canonical_medication_reconciliation_items`
5. `canonical_medication_reconciliation_status_events`

Scheduled dose opportunities remain workflow projections derived from Canonical medication orders. They are not new fact authority.

## External gates

This audit does not authorize migration `0557`, a Drizzle schema module, runtime commands, route changes, provider creation or activation, production query/mutation, production migration/backfill, local sync activation, push, CDB-to-main integration, or legacy retirement.

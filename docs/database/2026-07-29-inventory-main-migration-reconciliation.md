# Inventory → Main Migration Reconciliation and Legacy Retirement Gate

**Verified:** 2026-07-29 18:06 Asia/Dhaka
**Observed main:** `849cf757b0b83bf30585112fdaee18db31f2950b`
**Observed Inventory branch:** `feature/inventory-modular-monolith` at `c3dbee241e0ee480762339f50c261eb69b92bb41`
**Production D1 queried:** no
**Production mutation authorized:** no

## 1. Decision

Do not merge the Inventory branch's migration files unchanged into current `main`.

The two histories use the same numeric migration prefixes for different SQL files. The Inventory migrations must be reconciled against the latest reviewed Canonical migration reservations on a fresh integration branch. Existing migration filenames already accepted on `main` or applied anywhere must not be rewritten merely to make a merge easy.

`0558d_retire_legacy_inventory_tables.sql` is destructive. It is not part of the ordinary additive Inventory release and must remain held behind a separate production retirement authorization.

## 2. Verified collision matrix

The following prefix collisions were calculated from the committed Git trees of `main` and `feature/inventory-modular-monolith`:

| Prefix | Current `main` | Inventory branch |
|---|---|---|
| `0537` | `0537_editable_performer_payout_overrides.sql` | `0537_inventory_resource_scope.sql` |
| `0538` | `0538_doctor_commission_recovery_compatibility.sql` | `0538_inventory_transfer_atomicity.sql` |
| `0539` | `0539_doctor_protected_commission_floor.sql` | `0539_inventory_operational_return_atomicity.sql` |
| `0540` | `0540_patient_registration_idempotency.sql` | `0540_inventory_supplier_return_atomicity.sql` |
| `0541` | `0541_patient_merge_map_hardening.sql` | `0541_inventory_stock_reservation_atomicity.sql` |
| `0542` | `0542_approval_revision_policy.sql` | `0542_inventory_requisition_dispatch_atomicity.sql` |
| `0543` | `0543_canonical_credit_note_cash_refund_reversals.sql` | `0543_editable_performer_payout_overrides.sql` |
| `0550` | `0550_canonical_credit_note_cash_refund_reversals.sql` | `0550_inventory_control_route_batch_guard.sql` |
| `0551` | `0551_workforce_roster_integrity.sql` | `0551_inventory_reconciliation_details.sql` |
| `0552` | `0552_attendance_projection_integrity.sql` | `0552_inventory_outbox_consumer_deliveries.sql` |
| `0553` | `0553_mfa_registration_schema_repair.sql` | `0553_canonical_inventory_procurement.sql` |

The merged CDB branch reserves `0570_doctor_commission_rule_version_snapshot.sql` for the doctor-rule snapshot after resolving the former `0553` collision.

The absence of a prefix from this table does not automatically make it safe. The integration agent must inspect latest `origin/main`, the reviewed CDB branch and any migration reservation board again immediately before assigning final numbers.

## 3. Inventory migration set requiring review

The Inventory branch introduces the following current sequence relative to its own history:

```text
0537_inventory_resource_scope.sql
0538_inventory_transfer_atomicity.sql
0539_inventory_operational_return_atomicity.sql
0540_inventory_supplier_return_atomicity.sql
0541_inventory_stock_reservation_atomicity.sql
0542_inventory_requisition_dispatch_atomicity.sql
0543_editable_performer_payout_overrides.sql
0544_inventory_pharmacy_adapter_links.sql
0545_inventory_ot_adapter_links.sql
0546_inventory_ward_adapter_links.sql
0547_inventory_billing_adapter.sql
0548_inventory_asset_lifecycle_adapter.sql
0549_doctor_commission_recovery_compatibility.sql
0550_inventory_control_route_batch_guard.sql
0551_inventory_reconciliation_details.sql
0552_inventory_outbox_consumer_deliveries.sql
0553_canonical_inventory_procurement.sql
0554_canonical_inventory_fulfillment_controls.sql
0555_canonical_inventory_transfer_workflow.sql
0556_lab_reagent_analyzer_canonical_stock.sql
0557_canonical_inventory_reorder_policy.sql
0558d_retire_legacy_inventory_tables.sql
```

This list is evidence of the Inventory branch's internal order, not an approved final numbering plan for `main`.

## 4. Required integration procedure

### Phase A — establish the accepted migration baseline

1. Fetch latest `origin/main` and every program branch selected for integration.
2. Record the exact latest `origin/main` SHA.
3. Confirm the reviewed CDB checkpoint and its committed migration files.
4. Confirm the current canonical migration reservation board.
5. Determine the highest accepted/reserved non-destructive migration order after CDB integration.
6. Create the consolidated integration branch/worktree from latest `origin/main`.
7. Integrate the reviewed CDB checkpoint first.
8. Run `pnpm build:migrations` and `pnpm canonical:check` before adding Inventory migrations.

### Phase B — assign a new Inventory range

1. Reserve one contiguous non-conflicting range for the additive Inventory migrations.
2. Preserve the Inventory migrations' semantic and dependency order.
3. Rename files only on the integration/reconciliation branch, never by rewriting existing `main` history.
4. Update all exact filename/order references in:
   - migration manifest expectations;
   - architecture and deterministic-order tests;
   - fresh-install and retirement verification scripts;
   - run reports and program trackers;
   - authorization/evidence contracts that match exact migration names;
   - documentation examples.
5. Search the repository for every old filename before declaring the rename complete.
6. Run `pnpm build:migrations` twice and verify deterministic identical output.
7. Run canonical governance, schema integration and fresh-install verification.

Do not preselect a final numeric range in this document. CDB development is active and must own the live reservation decision at integration time.

### Phase C — separate additive release from destructive retirement

The additive set may establish canonical Inventory identity, stock/procurement workflows, adapters, controls, reconciliation and reporting support.

The destructive migration:

```text
0558d_retire_legacy_inventory_tables.sql
```

must not be silently renumbered into and shipped with the additive set. Use one of these fail-closed approaches:

- keep it outside the ordinary production migration directory until retirement authorization; or
- add explicit tooling that rejects an ordinary migration apply whenever the destructive file is pending; or
- package it in a separately reviewed maintenance-only retirement mechanism.

The selected approach must be testable and documented before `main` integration.

## 5. Why repository completion is not production retirement evidence

The Inventory program proved:

- canonical Inventory tables exist in fresh-install verification;
- retired legacy tables are absent after the destructive retirement migration in a disposable database;
- runtime write/read/import/schema-definition references are zero;
- unapproved offline references and active remediation debt are zero;
- protected Reception/Billing regressions remain green.

These results prove repository readiness for reconciliation. They do not prove the production D1 database has no data, foreign keys, background consumers, reports, exports or old Worker dependencies on the legacy tables.

## 6. Production additive migration gate

Before applying any additive Inventory migration to production, collect and approve:

1. exact production database name and immutable ID;
2. exact approved release commit and Worker build;
3. exact applied migration list;
4. exact pending migration list in execution order;
5. confirmation that no destructive retirement file is in the pending set;
6. D1 backup/export and Time Travel/restore evidence;
7. foreign-key check and expected schema baseline;
8. current baseline Worker compatibility with the additive schema;
9. candidate Worker compatibility with both pre- and post-migration states where required;
10. reconciliation and smoke plan;
11. rollback owner and abort thresholds;
12. fresh exact production migration authorization.

`pnpm deploy:production` is not a substitute for migration execution or migration approval.

## 7. Production legacy retirement gate

Legacy Inventory tables may be dropped only after all of the following are green:

- exact table existence and row counts;
- zero unexpected live rows or an approved, reconciled disposition for every row;
- zero protected-core route dependency;
- zero background job, report, export, import or external consumer dependency;
- zero live foreign-key dependency;
- zero running Worker version that can reference the tables;
- canonical balance, lot, movement, procurement and adapter reconciliation;
- successful backup and restore drill;
- tested rollback/forward-recovery procedure;
- approved maintenance window;
- named rollback owner;
- explicit destructive action and confirmation token;
- post-retirement foreign-key, smoke and reconciliation plan.

Any missing or stale evidence means `BLOCKED — DO NOT DROP`.

## 8. Worker version compatibility rule

Do not apply a destructive migration while multiple Worker versions can receive traffic or while the previous known-good Worker still contains legacy table access. A zero-percent candidate or rollback version can still become active during recovery; schema removal must account for that operational path.

Additive migrations should be backward-compatible with the active baseline and candidate whenever both can run. Destructive retirement occurs only after compatibility with old code is intentionally ended and rollback strategy no longer depends on the retired schema.

## 9. Required verification on the consolidated branch

At minimum run:

```text
pnpm build:migrations
pnpm canonical:check
pnpm test:inventory
pnpm test:reception:protected
pnpm test:security
pnpm test:rbac
pnpm exec tsc --noEmit
pnpm build
```

Also run the Inventory branch's focused migration/fresh-install/zero-reference/schema-integration tests after adapting their exact filenames to the reconciled range.

Run `git diff --check`, review all migration SQL manually and confirm no ordinary release path can apply the held destructive migration.

## 10. Required integration report

The integration report must include:

- base `origin/main` SHA;
- reviewed CDB branch/head and integrated commits;
- Inventory source head `c3dbee241e0ee480762339f50c261eb69b92bb41`;
- old-to-new migration filename map;
- migration reservation evidence;
- destructive migration disposition;
- manifest count and deterministic result;
- canonical and Inventory verification counts;
- Full-MM rebaseline result;
- merge SHA and `origin/main` push confirmation;
- explicit statement that production mutation/deployment/retirement was not performed.

## 11. Current authorization boundary

This document authorizes documentation and local integration planning only. It does not authorize:

- production D1 inspection;
- production migration/backfill;
- data mutation or repair;
- Worker deploy/upload or traffic change;
- feature/provider activation;
- table drop;
- canonical read/strict cutover;
- local-sync activation.

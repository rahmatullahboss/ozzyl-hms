# P01 Diagnostics and Inventory Current-State Audit

**Program:** HMS canonical database redesign

**Audit scope:** diagnostics catalog/order/result/billing; pharmacy catalog/dispense/stock; enterprise inventory/procurement/movements

**Base branch:** `origin/feature/hms-canonical-data-architecture`

**Base commit:** `18d1b0b4c156d40a6bcdd84c54a7ca13ae00886a`

**Support branch:** `support/cdb-diagnostics-inventory-current-state-audit`

**Audit date:** 2026-07-13

**Change class:** documentation-only; no runtime, schema, migration, tracker, `.ai-bridge`, or Cloudflare changes

**Status:** READY FOR INTEGRATION

---

## 1. Executive verdict

The current implementation has several locally hardened workflows, but it does not yet have one canonical diagnostics catalog, one canonical service lifecycle, one canonical medication/dispense lifecycle, or one canonical stock movement ledger.

The most important current-state facts are:

1. **Diagnostics identity is split across operational catalogs, billing catalogs, legacy free-text tests, and prescription text.** `lab_test_catalog`, `radiology_imaging_items`, `billing_service_items`, the singular/plural billing price-map tables, `tests`, and prescription/order text can each describe a billable diagnostic service.
2. **Diagnostics price is stored in incompatible units and types.** Lab uses an integer field with no explicit persisted unit; radiology uses integer paisa; billing uses `REAL` BDT-like values; price-category maps store another `REAL` value. Runtime resolution usually prefers billing, but several alternate writers/readers still use the operational price directly.
3. **Order, performed, result, and billed states are not represented by one lifecycle.** Lab and radiology create bills at request time; lab often writes `visit_services.status = 'billed'` before performance; result, verification, scan, report, cancellation, and accounting proceed in separate operations.
4. **Performer and referrer attribution is implicit or incomplete.** Lab commission code may infer the requesting/prescribing doctor from the visit and infer the performer from the verifier's user-to-doctor mapping. Radiology stores a prescriber on the requisition and a performer on the report, while scan execution is only a user action. There is no shared participant table with enforced role semantics.
5. **General inventory has a strong atomic issue core and a strong atomic goods-receipt core, but those cores are not the only mutation paths.** Transfers, returns, dispatch, counts, adjustments, write-offs, ward supply, lab monitoring, pharmacy, and import paths still mutate stock through route-specific SQL.
6. **`InventoryStock` is the operational balance, while `InventoryStockTransaction` is only a partially reliable ledger.** The mutable balance cannot yet be rebuilt with confidence from movement rows because not every mutation uses the same service, movement vocabulary, typed source reference, or idempotency rule.
7. **Pharmacy has three coexisting stock/sale generations.** Legacy `medicines`/batch movements/sales, the richer `pharmacy_items`/stock/invoices model, and general `Inventory*` all remain active. Compatibility routing reduces some legacy writes, but prescription fulfilment still writes the legacy model directly.
8. **The lab reagent bridge and pharmacy inventory bridge are not convergence mechanisms.** The lab bridge mirrors general inventory into a second lab stock ledger. The pharmacy bridge links duplicate masters and can add a quantity difference into pharmacy stock without a corresponding pharmacy stock transaction or reverse synchronization.
9. **Accounting is generally downstream of clinical or stock commit.** Several strong workflows enqueue accounting events after the core commit and treat accounting failure as non-fatal. This is acceptable only when a durable outbox/reconciliation invariant proves eventual posting; that invariant is not uniform across all pharmacy and diagnostics paths.
10. **The canonical redesign should not select an existing table as-is.** It should merge identity into `service_catalog_items`, transform orders into `service_requests`/`service_request_items`, create `service_events` and explicit participants, and make immutable inventory movements the stock truth while treating balance tables as projections.

---

## 2. Sources and method

This audit followed the repository's `using-superpowers`, worktree, architecture, coding, data-storage, and execution instructions. It reviewed:

- `task-progress.yaml`
- `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-design.md`
- `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-spec.md`
- `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-master-plan.md`
- `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-implementation-plan.md`
- `docs/database-guide.md`
- `src/db/schema/schema.ts`
- relevant SQL migrations from the original lab/pharmacy/inventory creation through current hardening migrations
- diagnostics, LIS, billing, pharmacy, inventory, automation, bridge, reporting, and accounting routes/services
- focused unit, integration, SQLite, migration-contract, and route-contract tests

The repository's database guide correctly warns that the large Drizzle schema is incomplete relative to migration-defined tables. Therefore this audit treats **migration SQL plus active raw-SQL route behavior** as stronger evidence than Drizzle exports alone.

This is a code-and-migration current-state audit. It does not claim that every historical table contains production rows. Production staging must run the validations in section 15 before any migration decision is finalized.

---

## 3. Current source-of-truth map

### 3.1 Diagnostic and service identity

| Current source | What it currently represents | Active writers/readers | Current authority |
|---|---|---|---|
| `lab_test_catalog` | Lab test/panel/component identity, clinical metadata, local price, optional billing link | `src/routes/tenant/lab.ts`, diagnostic CSV sync, reagent defaults, settings/import paths | Operational lab authority; not sole commercial authority |
| `radiology_imaging_items` | Radiology procedure identity, type/template, explicit `price_paisa`, optional billing link | radiology catalog routes, diagnostic CSV sync, tenant seed cloning | Operational radiology authority; not sole commercial authority |
| `billing_service_items` | Cross-department billable service identity and base price | billing master routes, registration/seed, diagnostic sync, settings import | Preferred runtime price source for linked diagnostics |
| `billing_item_price_category_maps` | Price-category-specific service price | billing master, price-category routes, diagnostic sync/backfill, settings import | Additional commercial price source; not consistently selected by diagnostic order resolvers |
| `billing_item_price_category_map` | Older singular price map | historical schema/migrations and compatibility references | Duplicate/legacy commercial source |
| `tests` | Legacy patient test name/result/status with free-text identity | `src/routes/tenant/tests.ts` | Independent legacy clinical source |
| `prescriptions.lab_tests` and prescription/order text | Free-text diagnostic recommendation/order intent | prescription routes and legacy clinical flows | Unresolved request text, not safe catalog identity |
| `lab_order_items.test_name` | Snapshot/free-text test name for some prescription-origin rows | prescription-to-lab paths | Historical display snapshot; can outlive or bypass catalog link |
| `visit_services` | Mixed service history, billing link, reference, amount, and status | lab and other service routes | Duplicate service/billing projection, not a reliable performed-event ledger |

### 3.2 Diagnostic request, performance, result, and billing

| Source | Meaning | Important ambiguity |
|---|---|---|
| `lab_orders` | Lab request header | `ordered_by` is a user identifier, not an explicit clinical participant role; multiple creation routes use different fields and atomicity guarantees |
| `lab_order_items` | Requested lab service line plus price snapshot, specimen/result/status fields | Mixes request line, work item, result lifecycle, billing snapshot, and source-specific extensions |
| `radiology_requisitions` | Radiology request and much of its execution lifecycle | A single row mixes request, scan, billing, report flag, prescriber, and status |
| `radiology_reports` | Report content and reporter/performer context | Performer is report-local; no shared event participant identity |
| `invoice_items` | Bill line snapshot with generic `reference_id` | `reference_id` meaning depends on `item_category` and writer; no enforced typed target |
| `visit_services` | Visit-level service/bill projection | `status='billed'` can be written when a lab order is created, before service performance |
| `bills` | Financial document header | Created at diagnostics request time, not proof of delivery |
| `accounting_posting_events` | Durable or semi-durable accounting handoff | Coverage differs by path and event may be enqueued after the operational commit |
| performer reserve / doctor payable tables | Financial attribution for referrer/performer | Attribution is derived from route-specific inference rather than canonical event participants |

### 3.3 Pharmacy product, dispense, sale, and stock

| Generation | Tables | Current state |
|---|---|---|
| Legacy medicine model | `medicines`, `medicine_stock_batches`, `medicine_stock_movements`, `pharmacy_sales`, `pharmacy_sale_items`, `pharmacy_returns`, `pharmacy_return_items` | Still actively written by hospital prescription fulfilment and some compatibility/return flows |
| Rich pharmacy model | `pharmacy_items`, `pharmacy_stock`, `pharmacy_stock_transactions`, `pharmacy_invoices`, `pharmacy_invoice_items`, purchase/GRN/return/deposit/settlement tables | Called canonical by pharmacy code and used by counter invoice/purchase flows; still independent of general inventory |
| Enterprise inventory model | `InventoryItem`, `InventoryStock`, `InventoryStockTransaction`, `InventoryConsumption`, `InventoryConsumptionItem`, procurement/transfer/return/count tables | Used for hospital inventory and lab reagents; optional bidirectional item link to `pharmacy_items` |
| Medication fulfilment model | `medication_orders`, `medication_order_items`, prescription items | Captures dispense request/fulfilment semantics but writes legacy pharmacy sale and stock tables |

### 3.4 Enterprise inventory

| Source | Current role | Canonical suitability |
|---|---|---|
| `InventoryItem` | General item master | Good staging source, but duplicate with pharmacy and lab masters |
| `InventoryGoodsReceipt` / items | Receipt document and lines | Strong canonical candidate after money/unit normalization |
| `InventoryStock` | Mutable lot/store balance and quality/status projection | Must remain a projection/cache, not the canonical movement truth |
| `InventoryStockTransaction` | Movement-like rows with balance snapshots | Must be transformed into typed immutable movements; current references and movement names are inconsistent |
| `InventoryConsumption` / items | Issue/consumption business document and allocation lines | Strong source for issue events, but generic `BillingReferenceId` remains ambiguous |
| transfer, return, count, adjustment, reservation, write-off tables | Workflow-specific documents | Keep workflow intent; post all quantity effects through one movement engine |
| `InventoryConsumptionRule` / event tables | Automation policy and queued consumption | Useful policy layer, but `TriggerType + TriggerId/Code` is another polymorphic reference model |
| `InventoryAuditLog` | Audit projection | Keep; do not use as quantity truth |

---

## 4. Duplicate diagnostic catalog and service sources

### 4.1 The “single source” migrations linked catalogs but did not remove duplicate authority

`migrations/0246_diagnostic_catalog_single_source.sql`, `0247_diagnostic_catalog_active_uniqueness.sql`, and `0248_diagnostic_price_map_backfill.sql` improved linkage and active-code uniqueness. They did not create a single persisted catalog:

- lab rows still store identity and price;
- radiology rows still store identity and paisa price;
- billing service rows still store identity and base price;
- category maps still store another price;
- operational rows remain independently active/inactive;
- code-match fallback allows an unlinked operational row to borrow a billing row;
- alternate order writers can still read the operational price directly.

The migrations are therefore best understood as **synchronization and compatibility migrations**, not final canonicalization.

### 4.2 Identity conflict modes

1. Same tenant and normalized code exists in both lab and radiology.
2. Operational code matches more than one inactive/active billing row across departments.
3. Operational row points to a billing row whose department or service kind does not match.
4. Linked billing row is inactive while operational row is active, or vice versa.
5. Lab panel/component hierarchy is operational-only and has no equivalent canonical composition model.
6. Tenant seed cloning creates radiology operational rows before or without an explicit billing link.
7. Free-text prescription lab recommendations cannot be deterministically matched to a catalog row.
8. The legacy `tests` table can record a diagnostic event with no request item or catalog identity.
9. `visit_services.description` and invoice descriptions are snapshots that can be mistaken for catalog identity in reports.

### 4.3 Active catalog write paths

| Domain | Direct write path | Notes |
|---|---|---|
| Lab catalog | `src/routes/tenant/lab.ts` basic CRUD | Synchronizes billing service and default price map sequentially, then writes operational row |
| Lab panel/extended catalog | later catalog handlers in `src/routes/tenant/lab.ts` | Adds parent/component hierarchy and another update surface |
| Diagnostic bulk import/sync | `src/lib/diagnostic-catalog.ts` and lab import routes | Upserts billing and operational rows in multiple statements |
| Billing service catalog | `src/routes/tenant/billingMaster.ts` | Can change commercial identity/price independently |
| Price categories | `src/routes/tenant/priceCategories.ts` | Can change mapped price independently of operational catalog |
| Settings import/export | `src/routes/tenant/settings-import-export.ts` | Writes billing items/maps and inventory items outside domain CRUD |
| Radiology catalog | `src/routes/tenant/radiology/catalog.ts` | Synchronizes billing and operational rows sequentially |
| Tenant registration/seed | `src/routes/register.ts`, `src/routes/seed.ts`, radiology tenant seed | Creates initial service/medicine data through separate paths |
| Lab reagent defaults | `src/lib/lab-reagent-defaults.ts` | Can create lab catalog rows as setup data |

No current database constraint proves that one active operational item maps one-to-one to one active billing service item of the same tenant and service kind.

---

## 5. Price-source conflicts and money representation

### 5.1 Stored price sources

| Source | Storage | Apparent unit | Conflict |
|---|---|---|---|
| `lab_test_catalog.price` | integer | Not named in schema; runtime/UI commonly treats as direct currency amount | Integer is safer than `REAL`, but unit is not explicit and historical values may mix BDT and minor units |
| `radiology_imaging_items.price_paisa` | integer | Paisa | Explicit and safe, but converted to/from billing `REAL` |
| `billing_service_items.price` | `REAL` | BDT-like major unit | Floating-point source preferred by diagnostic resolver |
| `billing_item_price_category_maps.price` | `REAL` | BDT-like major unit | Can diverge from base service price; diagnostic resolver usually does not select a context-specific map |
| `invoice_items.unit_price` / `line_total` | mixed legacy numeric/`REAL` | Writer-dependent | Snapshots are needed, but migration must normalize units |
| rich pharmacy item/stock/invoice price fields | integer in current schemas | Paisa | Safer locally, but bridges to general inventory `REAL` costs and legacy medicine price fields |
| `InventoryItem.StandardRate`, purchase/cost/MRP and inventory document totals | mostly `REAL` | Major-unit or writer-dependent | Monetary arithmetic can accumulate floating-point and unit-conversion error |
| quantities | frequently `REAL` | physical units | `REAL` is legitimate for fractional quantities but requires canonical unit and scale rules |

### 5.2 Runtime precedence

`src/lib/diagnostic-catalog.ts` and the main lab/radiology catalog routes generally resolve price as:

1. linked `billing_service_items.price`;
2. active billing service item matched by code;
3. operational fallback (`lab_test_catalog.price` or `radiology.price_paisa / 100`).

This is a runtime preference, not a database invariant. Important exceptions include:

- order-set paths that read `lab_test_catalog.price` directly;
- prescription-to-lab paths that list/read operational lab price;
- extended panel logic that first loads panel metadata from the operational row;
- historical invoice/order lines that preserve earlier snapshots;
- price-category maps that may differ from the base billing service price;
- imported rows whose source unit is not persisted with the value.

### 5.3 Required canonical rule

The target must store all money as signed 64-bit integer minor units with an explicit currency and must never infer the unit from the source table name.

During staging, every imported money value needs:

- `source_table` and `source_column`;
- `source_unit` (`BDT_MAJOR`, `BDT_PAISA`, or `UNKNOWN`);
- deterministic conversion rule;
- original raw value;
- normalized integer minor-unit value;
- variance flag when linked sources disagree;
- effective date and price category/scheme context.

A canonical catalog item should not contain a mutable “current price” that competes with the effective-dated `service_catalog_prices` history. Order and invoice lines should snapshot the selected price and reference the applicable price version.

---

## 6. Diagnostic lifecycle: ordered vs performed vs resulted vs billed

### 6.1 Lab lifecycle today

The primary lab order route performs approximately this sequence:

1. resolve operational test and preferred billing price;
2. insert `lab_orders`;
3. create a `bills` row;
4. batch order items, invoice lines, visit-service rows, and order/bill links;
5. mark visit service as `billed` at request time;
6. run bill-finalization/accounting side effects;
7. accrue requesting/referring doctor commission;
8. later collect/receive/process specimen;
9. later complete or accept result;
10. later verify result and possibly accrue performer commission;
11. optionally consume mapped reagents;
12. cancellation/retraction/recollection follow separate paths.

The extended lab order route is a second implementation. It inserts the header, expands panels, inserts order items one by one, inserts the bill, links the order, batches invoice lines and visit services, then runs accounting and commission side effects. Prescription, reception, order-set, and LIS-oriented paths create or mutate the same tables with different subsets of fields.

Current consequences:

- a bill can exist without a successfully complete order/item set;
- an order can exist without its bill link if a later statement fails;
- `visit_services.status='billed'` is not evidence of performance;
- “completed”, “verified”, machine-accepted, report-ready, billed, paid, cancelled, and retracted are independent state machines;
- item price is snapshotted, but the selected price source/version is not retained;
- `lab_order_items` carries request, specimen, result, billing, LIS, cancellation, and performance concerns in one row;
- multiple writers can create different provenance shapes for the same logical request.

### 6.2 Radiology lifecycle today

A radiology requisition generally:

1. resolves imaging item and billing price;
2. inserts `radiology_requisitions`;
3. creates a bill;
4. batches invoice line plus requisition/bill link;
5. runs accounting side effects;
6. separately transitions through `pending`, `scanned`, `reported`, or `cancelled`-like states;
7. separately creates/finalizes `radiology_reports`;
8. records performer identity on the report rather than a shared service event;
9. cancellation updates invoice, bill, requisition, and accounting through separate operations.

There is no equivalent of the lab `visit_services` projection in the inspected requisition creation path, so cross-department “service delivered” reporting is structurally inconsistent.

### 6.3 Legacy and prescription diagnostic lifecycle

- `tests` can be created and resulted independently from `lab_orders`.
- `prescriptions.lab_tests` can remain unresolved free text.
- prescription-to-lab creation can store a `test_name` snapshot and nullable/variable catalog relationship.
- order sets can create lab orders from a different price and provenance path.

These rows must not be silently merged by name. They require deterministic matching or an exception queue.

### 6.4 Canonical lifecycle interpretation

The target should separate:

- **request acceptance:** `service_requests` and `service_request_items`;
- **operational service occurrence:** `service_events`;
- **participants:** `service_event_participants`;
- **specimen/acquisition/result/report detail:** domain extension tables keyed to request item/event;
- **billing:** invoice line linked to the service event or explicitly to a prepayment/request when policy allows advance billing;
- **payment:** payment allocation to invoice;
- **reversal/cancellation:** append-only reversal/replacement events, not destructive status reuse.

Per the approved no-LIS policy, a non-cancelled diagnostic request item may create its operational service event immediately. That event creation must not be misread as result verification. The event needs separate timestamps/statuses for accepted, scheduled, performed/acquired, result-produced, verified/reported, and reversed where the domain requires them.

---

## 7. Performer, referrer, prescriber, and verifier roles

### 7.1 Current role sources

| Role | Current source(s) | Problem |
|---|---|---|
| Ordered by / requester | `lab_orders.ordered_by`, prescription author, radiology creator | Usually a user ID; not necessarily a practitioner and not typed as a participant role |
| Prescriber/requesting doctor | visit doctor, radiology `prescriber_id`, prescription doctor | Lab finance can infer from visit rather than preserving the actual ordering participant |
| Referrer | billing/reception referrer fields and external-referrer tables | Not consistently linked to the diagnostic request/event; may be conflated with prescriber |
| Performer | lab verifier mapped from user to doctor; radiology report performer | Lab performance can be attributed to the verifier rather than the person who performed; missing performer is not uniformly blocked |
| Technician/scanner | scan/collection/processing user columns or audit | Operational user is not represented in a shared participant structure |
| Verifier/reporter | lab verified-by, radiology report finalizer | Distinct clinical role but often reused for commission inference |
| Dispenser | pharmacy created-by/sold-by/fulfilled-by | Not a canonical service-event participant |

### 7.2 Financial risk

Commission and reserve logic is downstream of inferred identities. This creates four risks:

1. the visit doctor receives “prescriber/referrer” credit even when another doctor ordered the test;
2. the verifier receives performer credit even when a technician/sonologist actually performed it;
3. missing performer produces no payable rather than an explicit exception;
4. referrer and performer shares can be calculated from a price/line amount that later changes or is cancelled without one canonical participant-linked event.

### 7.3 Required participant policy

`service_event_participants` should require explicit role codes, at minimum:

- `requester`
- `prescriber`
- `referrer_internal`
- `referrer_external`
- `collector`
- `technician`
- `performer`
- `reporter`
- `verifier`
- `dispenser`

Rules:

- Never infer referrer from visit doctor when a referrer is absent.
- Never infer performer from verifier unless a service-specific policy explicitly declares the roles equivalent.
- Services configured with a performer fee/reserve must not finalize financially without one valid performer or a recorded exception/waiver.
- Participant identity must be tenant-scoped and may reference practitioner, employee/user, or approved external party through typed columns—not one polymorphic integer.
- Commission/payable rows must reference the canonical event and participant row plus the immutable calculation basis/version.

---

## 8. Inventory source of truth and stock-movement gaps

### 8.1 Strong current cores

Two current implementations provide useful patterns for the canonical redesign:

#### Atomic inventory issue

`src/lib/inventory-issue-service.ts` and `src/lib/inventory-issue-atomic.ts` provide:

- operation idempotency;
- FEFO allocation;
- exact old-balance/quality/status guards;
- one D1 batch for consumption header, stock decrement, allocation line, stock transaction, audit, provisional billing, and demand projections;
- a guard table that converts stale updates into a failed batch;
- operation completion/replay semantics.

#### Atomic enterprise goods receipt

`src/lib/inventory-goods-receipt-atomic.ts` and `src/routes/tenant/inventory/gr.ts` provide:

- idempotent receipt operation keys and line keys;
- PO over-receipt guards;
- one core batch for GRN header, lines, new stock lots, movement rows, and PO progress;
- explicit `core_completed` versus projection-completed state;
- replayable post-commit projections for lab reagent metadata/accounting/audit.

These are strong implementation references, but they do not make all inventory paths canonical.

### 8.2 Remaining direct mutation paths

Direct `InventoryStock` mutations still exist in:

- transfers;
- dispatch and dispatch reversal/receipt;
- returns and the separate legacy `return.ts` path;
- adjustment requests;
- direct stock adjustment;
- count approval;
- write-off;
- reservations;
- ward supply;
- lab monitoring QC/open/transfer/waste operations;
- import/opening-stock paths;
- helper-level movement insertions.

Direct pharmacy stock mutations exist in:

- canonical invoice service;
- invoice route implementation;
- advanced pharmacy routes;
- purchase/GRN and supplier return routes;
- stock adjustment routes;
- legacy return routes;
- pharmacy inventory bridge;
- compatibility sales/billing routes.

Direct legacy medicine mutations remain in prescription fulfilment and legacy purchase/return flows.

### 8.3 Why `InventoryStockTransaction` is not yet reconstructive truth

A reconstructive movement ledger requires every quantity change to have:

- one immutable movement row;
- typed movement kind;
- source document type and ID;
- source line ID;
- idempotency/operation key;
- item, lot/batch, store/location, and unit;
- signed quantity in canonical unit;
- actor and effective timestamp;
- reversal relation when corrected;
- costing data/version where required.

Current `InventoryStockTransaction` instead has generic `TransactionType`, `ReferenceNo`, and `ReferenceId`. The meaning of `ReferenceId` changes among goods receipt, consumption, transfer, return, adjustment, count, dispatch, write-off, and other paths. Movement names also vary in punctuation and vocabulary. Some bridge/direct paths update a balance without inserting the corresponding ledger row.

Therefore:

- `InventoryStock` is currently the operational balance authority;
- `InventoryStockTransaction` is an important audit source but not sufficient to rebuild all balances;
- the canonical target should invert this relationship: immutable movements become truth and balance rows become verified projections.

### 8.4 Lab reagent dual ledger

The current general-inventory GRN commits an `InventoryStock` lot, then `mirrorInventoryLabReagentReceipt` may create:

- `lab_consumables` metadata;
- `lab_consumable_stock` with another received quantity;
- `lab_consumable_movements.purchase_in`.

Consumption code now prefers linked `InventoryStock` and routes canonical deductions through `createInventoryIssue`, then writes `lab_consumable_movements` as a projection. It can fall back to legacy lab stock for partial migrations and still supports legacy stock updates.

This is an intentional transition architecture, but current-state truth remains conditional:

- linked consumables use general inventory balance;
- unlinked/older consumables use lab stock balance;
- lab movement rows can represent either ledger via `ledger_type` and stock-ID columns;
- receipt mirroring duplicates quantity-bearing rows;
- post-commit mirror failure leaves general inventory committed and lab projection pending;
- reconciliation is required to prove projected lab usage equals canonical inventory consumption.

The final model should keep lab reagent metadata, QC, analyzer assignment, open-vial expiry, and usage context, but must not keep an independent quantity balance.

### 8.5 Pharmacy inventory bridge gaps

`src/routes/tenant/inventory/pharmacyBridge.ts`:

- links `pharmacy_items` and `InventoryItem` using two sequential updates without a database-enforced one-to-one relationship;
- suggests links by exact/contains name matching, which is unsafe for automatic migration;
- reports low stock from both systems rather than resolving one source;
- synchronizes only when summed general inventory is greater than pharmacy stock;
- adds the difference to the first pharmacy batch or creates a synthetic `SYNC` batch;
- does not sync the reverse direction;
- does not preserve lot/expiry/cost allocation when summing multiple general-inventory lots;
- does not insert a corresponding `pharmacy_stock_transactions` row in the inspected sync path;
- does not use an idempotency key or durable reconciliation claim.

This endpoint can create a balance that has no movement provenance and must not be used as the canonical migration mechanism.

---

## 9. Purchase, receipt, batch, expiry, return, and adjustment findings

### 9.1 Purchase and receipt

- Enterprise inventory has purchase request, RFQ, PO, GRN, vendor, store, and receipt line structures.
- Rich pharmacy has a parallel supplier, PO, GRN, item, stock, and transaction stack.
- Legacy medicine purchase still writes `medicine_stock_batches`, updates aggregate `medicines.quantity`, and writes `medicine_stock_movements`.
- General inventory GRN creates a new `InventoryStock` row per receipt line and an initial stock transaction.
- Rich pharmacy GRN creates or updates `pharmacy_stock` and writes pharmacy transaction rows.
- Purchase accounting uses separate event sources for enterprise inventory and pharmacy.

A supplier invoice/GRN can therefore appear in one of multiple procurement ledgers with no shared procurement document or item master.

### 9.2 Batch and expiry

Batch/expiry enforcement is stronger in the general inventory GRN normalization path, especially for lab reagents. Across the repository, however:

- some legacy rows permit missing batch/expiry;
- synthetic pharmacy `SYNC` stock has no source lot and may not preserve expiry;
- aggregate `medicines.quantity` has no batch identity;
- pharmacy and general inventory can each hold separate lots for linked items;
- open-vial/onboard expiry is lab-specific metadata and should not be collapsed into manufacturer expiry;
- some reports aggregate stock without excluding all blocked, damaged, QC-pending, expired, or after-open-expired quantities consistently.

### 9.3 Return and reversal

Returns are represented by multiple stacks:

- enterprise inventory return documents and stock mutations;
- a separate older inventory `return.ts` route;
- rich pharmacy invoice returns/credit-note rows;
- pharmacy supplier returns;
- legacy pharmacy patient returns tied to `pharmacy_sales`;
- lab cancellation/reagent reversal/reconciliation paths.

The critical invariant is not merely “quantity was added back.” A return must reference the original movement/allocation, enforce return quantity <= remaining returnable quantity, restore the correct lot/store/status, and create financial reversal events. Current paths differ in how much of this they enforce and which stock ledger they update.

### 9.4 Adjustment and count

General inventory supports both approval-oriented adjustment requests and direct adjustment. Pharmacy has its own adjustment and approval rules. Count approval, direct adjustment, write-off, and lab waste can all affect quantity through separate code.

Canonical design must make the workflow document separate from the movement posting engine. Approval should authorize a movement; it should not be a second implementation of stock arithmetic.

---

## 10. Pharmacy billing and accounting integration paths

### 10.1 Rich pharmacy counter invoice path

`src/lib/pharmacy-canonical.ts` and `src/routes/tenant/pharmacy/invoices.ts` implement overlapping canonical-looking invoice behavior. The service implementation:

1. resolves `pharmacy_stock` via explicit lot or FEFO;
2. validates payment split;
3. decrements stock rows individually with concurrency guards;
4. inserts invoice header;
5. batches invoice lines and `pharmacy_stock_transactions`;
6. on mid-flight failure, attempts compensating stock add-back and queues `pharmacy_invoice_repair_queue`;
7. enqueues bill-created and COGS accounting events after invoice commit;
8. treats accounting enqueue failure as non-fatal.

The route implementation additionally integrates payment, deposit adjustment, employee cash, and accounting posting events. Advanced routes contain more direct invoice/stock implementations.

This is a saga with compensation, not one atomic database transaction. It can be safe only when repair queue, idempotency, and reconciliation are complete and consistently used by every entry point.

### 10.2 Legacy compatibility sales/billing

`src/routes/tenant/pharmacy/index.ts` forwards selected legacy `/sales` and `/billing` requests to the rich pharmacy model and emits deprecation warnings. However:

- legacy medicine master/purchase writes still exist;
- the forwarder assumes a legacy medicine ID can be used as a `pharmacy_items.id` unless the canonical item exists with the same ID;
- other direct/advanced routes still operate on the rich tables independently of the shared service;
- compatibility tests include textual contract tests that prove source wiring, not full failure rollback.

### 10.3 Prescription fulfilment path

`src/routes/tenant/prescriptionFulfilment.ts` performs a strong D1 batch for:

- `medication_orders` and items;
- `pharmacy_sales` and items;
- `prescription_items.dispensed_qty`;
- `medicines.quantity`;
- `medicine_stock_batches.quantity_available`;
- `medicine_stock_movements.sale_out`;
- a COGS accounting event;
- an audit row.

It does **not** use `pharmacy_items`, `pharmacy_stock`, `pharmacy_invoices`, or general `Inventory*`. This means a hospital prescription dispense can be invisible to the rich pharmacy stock ledger and general inventory ledger while still producing a legacy sale and COGS event.

### 10.4 Returns, deposits, settlement, and cash

- Rich pharmacy invoice routes maintain pharmacy-specific deposits and settlements.
- Invoice creation may emit bill, payment, deposit-adjustment, and COGS events.
- Rich invoice returns create credit-note/return rows and stock-in transactions.
- Legacy pharmacy returns use legacy sale references and can update both rich and legacy stock depending on available links.
- Cash ledger code contains an explicit warning that prescription fulfilment writes sale/stock but does not establish the active cash-drawer source of truth.

Required reconciliation dimensions are therefore:

- invoice gross/net = sum invoice lines;
- payment + credit + deposit allocation = invoice total;
- cash sale payment = drawer/cash movement or explicit non-drawer exception;
- COGS = original lot cost allocation;
- return quantity and COGS reversal = original sale allocation;
- accounting event count/status = operational invoice/return state;
- no duplicate bill-created or COGS events across service and route implementations.

---

## 11. Transaction-boundary assessment

| Workflow | Current boundary | Assessment |
|---|---|---|
| Enterprise inventory issue | One D1 batch for core stock/ledger/audit/billing/demand; accounting after commit | Strong core; accounting must reconcile asynchronously |
| Enterprise inventory GRN | One D1 batch for core receipt/stock/movement/PO; lab/accounting/audit projections after commit | Strong staged operation with replayable projections |
| Basic lab order | Header and bill precede item/link batch; accounting/commission afterward | Partial-write risk between request, bill, items, service projection, and finance |
| Extended lab order | Header/items/bill/link/projections in multiple operations | Higher partial-write risk; panel expansion can leave incomplete request |
| Prescription/order-set/reception lab creation | Route-specific batches and fields | Provenance and atomicity differ by origin |
| Lab result/verification/reagent/commission | Separate operations and services | Result may commit while reagent, participant, payable, or accounting projection fails |
| Radiology request billing | Requisition and bill precede later batch/side effects | Partial-write risk |
| Radiology cancellation/report | Multiple updates and accounting/report operations | Reversal consistency requires reconciliation |
| Rich pharmacy invoice | Guarded stock decrements, later invoice batch, compensating rollback/repair queue, accounting afterward | Saga; not fully atomic |
| Prescription fulfilment | One D1 batch across legacy medication/sale/stock/COGS rows | Locally strong but commits to the wrong competing ledger |
| Pharmacy/general inventory bridge | Sequential master updates and per-item balance sync | Non-atomic and non-reconstructive |
| Transfer/return/count/adjustment/write-off | Route-specific guards/batches | Mixed guarantees; not one movement service |

Canonical implementation should standardize three layers:

1. **operation journal/idempotency claim**;
2. **one atomic core batch** for source document, immutable movement/event, and projection update;
3. **durable outbox projections** for accounting, analytics, notifications, and compatibility views, with retry and reconciliation status.

---

## 12. Reconciliation invariants

The following invariants must be executable before and after migration.

### 12.1 Catalog and price

1. One active canonical service catalog item per tenant + canonical code + service kind.
2. Every active lab/radiology operational row maps to exactly one canonical service item or one unresolved exception.
3. No canonical service item maps to active lab and radiology rows unless explicitly modeled as a composite service.
4. Every active price has currency, minor-unit amount, category/scheme, effective-from, and non-overlapping effective range.
5. Order/invoice snapshots equal the selected effective price minus authorized discount, with a recorded price-version reference.
6. Linked lab, radiology, billing base, and default price-map values either normalize equal or have an approved variance record.

### 12.2 Diagnostic request and event

1. Every non-legacy billable diagnostic invoice line links to one canonical service event.
2. Every service event links to one request item except explicitly documented walk-in/manual events.
3. Cancelled/retracted request items cannot have an unreversed active service event or charge.
4. Performed/reported/verified timestamps are monotonic and cannot precede request acceptance.
5. A verified/final report must have a result/report record and required verifier/reporter participant.
6. Services configured with performer compensation have one eligible performer participant or an explicit exception.
7. Referrer participant is explicit; absence remains absence.
8. Legacy `tests` and free-text prescription requests are either deterministically mapped or quarantined.

### 12.3 Inventory

1. For each tenant/item/store/lot/unit, projected balance equals opening movement plus signed immutable movements.
2. No active projected available quantity is negative.
3. Available, reserved, damaged, blocked, in-transit, and QC quantities reconcile to the lot total.
4. Every stock balance-changing operation has exactly one idempotent source-line movement.
5. Every movement references an existing typed source document/line or a controlled opening/import reason.
6. Transfer-out equals transfer-in plus still-in-transit quantity; no duplicate receipt.
7. Return quantity does not exceed original unreturned issue/sale/receipt allocation.
8. Expired, blocked, rejected, or QC-pending lots are excluded from available-to-issue.
9. Batch/expiry-required items have non-empty lot and valid expiry on receipt.
10. Unit conversion is explicit and quantities are stored in one canonical base unit.
11. `InventoryStockTransaction`/legacy movement rows and current balances have explainable deltas before cutover.

### 12.4 Pharmacy and dispense

1. Every fulfilled medication-order item maps to one dispense/service event and one or more lot allocations.
2. Sum dispense allocations equals fulfilled quantity and does not exceed prescribed/authorized quantity unless override is recorded.
3. Every pharmacy invoice line maps to the dispense/event or explicit over-the-counter sale event.
4. Rich pharmacy, legacy medicine, and general inventory balances for linked products reconcile or produce a staged exception; they must not be summed as separate real stock.
5. Every sale/return has matched stock movement and COGS/reversal accounting event.
6. Payment, credit, and deposit allocations equal invoice total.
7. Cash payment has a cash-drawer/cash-ledger movement or a typed reason it is outside the drawer.
8. Repair-queue rows are zero or explicitly accepted before cutover.

---

## 13. Keep / Transform / Merge / Replace / Archive matrix

| Current object | Decision | Target treatment |
|---|---|---|
| `billing_service_items` | **Transform + Merge** | Seed `service_catalog_items`; remove mutable price authority into effective-dated prices |
| `lab_test_catalog` | **Transform + Merge** | Preserve lab-specific metadata/hierarchy in domain extension tables linked to canonical service item |
| `radiology_imaging_items` | **Transform + Merge** | Preserve imaging type/template/reporting metadata as radiology extension |
| singular/plural billing price maps | **Merge + Replace** | One effective-dated `service_catalog_prices` model; archive duplicate map after validation |
| `tests` | **Archive** | Historical compatibility/read-only view after deterministic event migration; unresolved rows retained as exceptions |
| prescription free-text lab fields | **Transform** | Resolve to request items where deterministic; otherwise preserve text in unresolved request staging |
| `lab_orders` | **Transform** | `service_requests` header plus lab request extension |
| `lab_order_items` | **Transform** | `service_request_items`; specimen/result/LIS fields split into domain extensions |
| `radiology_requisitions` | **Transform** | Request header/item plus acquisition extension; do not keep mixed request/bill/report state |
| `radiology_reports` | **Keep + Transform** | Report document keyed to service event/request item with explicit reporter/performer participants |
| `visit_services` | **Replace** | Compatibility projection from `service_events` + invoice lines; not writable truth |
| generic `invoice_items.reference_id` | **Replace** | Typed `service_event_id`, inventory/dispense event ID, and source-line keys |
| doctor commission/performer reserve rows | **Transform** | Reference canonical event participant and immutable calculation basis |
| `InventoryItem` | **Keep + Transform** | Canonical inventory item master; merge duplicate pharmacy/lab master attributes |
| `InventoryGoodsReceipt` and items | **Keep + Transform** | Canonical receipt document/lines with integer money and typed movement linkage |
| `InventoryConsumption` and items | **Keep + Transform** | Canonical issue/consumption document and lot allocations |
| `InventoryStockTransaction` | **Transform** | Backfill typed immutable inventory movements; normalize movement vocabulary/references |
| `InventoryStock` | **Keep as projection** | Rebuildable lot/store balance projection, never independent truth |
| transfer/return/count/adjustment/write-off documents | **Keep + Transform** | Workflow intent/approval documents; quantity effect posted by one movement engine |
| `InventoryConsumptionRule`/events | **Keep + Transform** | Policy/queue layer keyed to typed service event/catalog/item references |
| `lab_consumables` | **Keep + Transform** | Reagent metadata mapped to canonical inventory item |
| `lab_consumable_stock` | **Replace/Archive** | Remove independent balance; retain lot/QC/open-vial metadata keyed to inventory lot |
| `lab_consumable_movements` | **Transform** | Lab usage/operation projection keyed to canonical movement; no independent quantity authority |
| `medicines` | **Merge + Archive** | Merge product identity into canonical pharmacy/inventory item; read-only history after cutover |
| `medicine_stock_batches` / movements | **Transform + Archive** | Backfill canonical lots/movements, then compatibility view |
| `pharmacy_sales` / items | **Transform + Archive** | Backfill invoice/dispense/event history; stop direct writes |
| `pharmacy_items` | **Transform + Merge** | Pharmacy product extension linked one-to-one to canonical inventory item |
| `pharmacy_stock` | **Replace** | Projection from canonical inventory lots/movements, optionally exposed through compatibility view |
| `pharmacy_stock_transactions` | **Transform + Merge** | Backfill canonical inventory movements |
| `pharmacy_invoices` / items | **Keep + Transform** | Canonical billing history with event/dispense links and integer money |
| pharmacy purchase/GRN tables | **Transform + Merge** | Merge into enterprise procurement/receipt documents or implement strict adapters to one receipt engine |
| pharmacy deposits/settlements | **Transform** | Move to canonical financial subledger/payment allocation; do not remain a separate cash truth |
| `medication_orders` / items | **Keep + Transform** | Medication service request and dispense workflow source |
| pharmacy/general inventory bridge sync endpoint | **Replace** | One-time staged reconciliation and canonical cutover; no balance-copy sync |

“Archive” means stop writes and retain audited read compatibility after successful migration; it does not mean delete historical records.

---

## 14. Proposed canonical service-request and service-event mappings

### 14.1 Lab

| Current | Canonical mapping |
|---|---|
| `lab_orders` | one `service_requests` row, `request_type='diagnostic_lab'` |
| `lab_order_items` | one `service_request_items` row per requested catalog item/component; preserve source item ID in provenance |
| panel row | request item for the ordered panel plus explicit component relationship; do not bill child components unless pricing policy says so |
| order accepted | create one operational `service_event` per non-cancelled request item under approved no-LIS policy |
| specimen collection/receipt | lab specimen/acquisition extension events keyed to request item/event |
| result draft/completed/accepted | lab result records with version/status; not a replacement for service event |
| verification | result verification record plus `verifier` participant |
| actual performer | required `performer` participant where service policy requires it |
| reagent consumption | inventory issue/movements keyed to the service event and request item |
| invoice item | typed `service_event_id`; request-time billing marked as advance/request billing until event becomes billable under policy |
| cancellation/retraction | reversal/cancellation event and financial reversal; preserve prior versions |

### 14.2 Radiology

| Current | Canonical mapping |
|---|---|
| `radiology_requisitions` | `service_requests` + one `service_request_item`, `request_type='diagnostic_imaging'` |
| requisition accepted | operational `service_event` under no-LIS/no-PACS policy |
| scan/acquisition status | imaging acquisition extension; set performed/acquired timestamp and technician participant |
| `radiology_reports` | report document/version keyed to event; reporter and performer participants explicit |
| prescriber | `prescriber`/`requester` participant; not automatically referrer |
| film usage | inventory consumption keyed to event, not boolean `film_usage_logged` as truth |
| billing | invoice line keyed to event; cancellation creates reversal |

### 14.3 Prescription lab text

1. Preserve the original text verbatim in staging.
2. Normalize whitespace/code/name for matching only.
3. Resolve only by tenant-scoped exact code, approved alias, or a reviewed mapping table.
4. Create a `service_request_item` only after deterministic resolution.
5. Keep unresolved text in `staging_service_request_exceptions` with reason `unresolved_catalog_identity`.
6. Never create a canonical catalog item automatically from arbitrary prescription text.

### 14.4 Medication and pharmacy

| Current | Canonical mapping |
|---|---|
| prescription item | medication `service_request_item` or medication-request extension |
| `medication_orders` / items | fulfilment request and selected product lines |
| fulfilled allocation | one dispense/service event with one or more lot-allocation rows |
| `pharmacy_sales` or `pharmacy_invoices` | invoice document; line points to dispense/OTC sale event |
| medicine/pharmacy stock movement | canonical immutable inventory movement keyed to dispense/event allocation |
| prescriber | explicit `prescriber` participant |
| pharmacist/dispenser | explicit `dispenser` participant |
| return | reversal/return event tied to original dispense allocation and invoice line |

### 14.5 Inventory automation

Replace `TriggerType + TriggerId/Code` as the long-term source identity with typed links where possible:

- `service_event_id` for diagnostic/procedure/service consumption;
- `dispense_event_id` for pharmacy;
- `invoice_line_id` only when consumption is genuinely bill-triggered;
- `manual_operation_id` for controlled manual consumption.

The automation rule can remain catalog- or service-type-based, but the generated consumption event must resolve to a concrete typed source before posting stock.

---

## 15. Staging-data validations required before migration

The future staging phase must run these validations against a production snapshot. Counts must be stored by tenant and source, not only printed.

### 15.1 Catalog identity

- duplicate active normalized codes within each current catalog;
- same normalized code across lab, radiology, and billing with conflicting names/departments;
- duplicate active billing service items by tenant/code;
- operational rows with missing, inactive, cross-tenant, or wrong-department billing links;
- multiple operational rows pointing to one billing row;
- linked row and code-match row resolving to different billing items;
- panel/component cycles, orphan components, inactive parent with active child;
- free-text tests/prescription items with zero, one, or multiple candidate matches;
- rows with blank code/name or synthetic/default code collision.

### 15.2 Price and money

- classify every source column's money unit;
- values with fractional paisa after normalization;
- negative price/discount/total values outside approved reversal documents;
- lab vs billing vs default-map normalized variance;
- radiology `price_paisa` vs billing price variance after exact integer conversion;
- overlapping effective prices after staging;
- invoice line arithmetic mismatch;
- order line vs invoice line amount mismatch;
- legacy pharmacy/rich pharmacy/general inventory cost and sale-price variance;
- values exceeding safe integer range after minor-unit conversion.

### 15.3 Diagnostic lifecycle

- orphan request items, invoice items, visit services, reports, specimens, results, and LIS records;
- bills referencing missing/incomplete orders;
- orders with no items or duplicate logical items;
- invoice lines whose generic `reference_id` cannot be typed;
- performed/reported/verified rows without an accepted request;
- billed/paid rows with cancelled request and no reversal;
- result/report timestamps before request date;
- final results with missing verifier/reporter;
- performer-required services with missing performer;
- ambiguous performer inferred from verifier/visit doctor;
- referrer fields that disagree across visit, bill, request, and commission rows;
- duplicate service occurrence represented in both `tests` and lab/radiology workflow.

### 15.4 Pharmacy identity and dispense

- legacy `medicines` to `pharmacy_items` to `InventoryItem` mapping cardinality;
- same numeric ID representing different products across legacy and rich pharmacy tables;
- duplicate barcode/item code/generic-brand-strength-form combinations;
- prescription item selected medicine missing from each stock master;
- fulfilled quantity > prescribed/remaining quantity;
- medication order fulfilled but missing sale/invoice or stock movement;
- sale/invoice without medication/OTC event provenance;
- rich and legacy invoices that represent the same transaction;
- return quantity > original unreturned sale quantity;
- open repair-queue and failed-idempotency rows.

### 15.5 Inventory and lot reconciliation

For every quantity-bearing table, calculate by tenant/item/store/lot:

- current projected balance;
- signed sum of movement rows;
- opening/import balance;
- unexplained delta;
- oldest and newest mutation timestamps;
- duplicate source-operation keys;
- missing source document/line;
- negative, expired-available, blocked-available, QC-pending-available, or impossible reservation balances;
- transfer out/in/in-transit mismatch;
- receipt quantity > PO remaining quantity;
- return > issued/received quantity;
- write-off/adjustment/count movement missing approval where required;
- linked lab stock vs inventory lot variance;
- linked pharmacy stock vs general inventory lot variance;
- synthetic `SYNC` batches and stock rows without transaction provenance;
- lot/unit conversion inconsistencies;
- duplicate physical lot represented in multiple ledgers.

### 15.6 Accounting and cash

- operational bill/invoice/GRN/consumption/return rows missing accounting posting event;
- duplicate event keys or multiple posted journals for one source event;
- pending/failed accounting events older than threshold;
- debit/credit imbalance;
- pharmacy COGS without sale and sale without COGS;
- return without revenue/COGS reversal;
- cash-paid pharmacy invoice/sale without drawer/cash-ledger movement;
- deposit deduction/return/settlement mismatch between pharmacy and canonical finance ledgers;
- diagnostic performer/referrer payable without canonicalizable participant provenance.

### 15.7 Tenant and reference safety

- every linked parent/child/source row has matching `tenant_id`;
- no cross-tenant numeric reference accepted by fallback code matching;
- every polymorphic ID can be assigned one source type;
- IDs reused across candidate target tables are flagged rather than guessed;
- source timestamps normalized to one timezone policy while preserving raw value.

---

## 16. Test coverage reviewed and remaining gaps

### 16.1 Strong evidence

The repository contains focused tests for:

- lab-to-billing catalog synchronization;
- diagnostic CSV parsing;
- lab order billing/accounting;
- radiology order accounting/cancellation;
- LIS acceptance/retraction and lab workflow;
- performer reserve rules/lifecycle;
- inventory issue atomic batching and rollback in an SQLite transactional harness;
- inventory GRN atomicity and idempotency;
- transfer/adjustment/return/count concurrency guards;
- lab reagent bridge, canonical consumption, and reconciliation;
- pharmacy invoice hardening, stock guards, billing/accounting, returns, and prescription dispense;
- inventory consumption rule/event/posting automation.

### 16.2 Coverage limitations

1. Some pharmacy hardening tests are textual source-contract tests. They prove that expected SQL/functions exist, not that all statements roll back together in D1.
2. The strongest inventory atomic tests cover the dedicated issue/GRN cores, not every direct route mutation.
3. Catalog sync tests primarily assert successful synchronization, not injected failure after the first source has been updated.
4. There is no single test that creates the same physical medicine through legacy pharmacy, rich pharmacy, and general inventory and proves one resulting balance.
5. There is no end-to-end invariant test from diagnostic request → explicit participant → performed event → invoice line → payment → commission/payable → accounting journal.
6. There is no comprehensive production-data test for polymorphic `reference_id` classification.
7. Bridge tests do not make name similarity or one-way balance copy safe for canonical migration.
8. Report tests can pass while underlying source systems remain duplicated because some dashboards intentionally sum legacy and rich pharmacy data.

Future canonical tests must operate from canonical invariants, not only route-local expected SQL.

---

## 17. Recommended sequencing for P04/P08 implementation

1. **Freeze and inventory writers.** Add route-origin telemetry before cutover so production use of legacy/advanced paths is known.
2. **Create catalog staging and mapping tables.** Do not mutate current catalogs during discovery.
3. **Normalize money and codes.** Resolve unit ambiguity before catalog merge.
4. **Create canonical service catalog and effective prices.** Backfill mappings and exceptions.
5. **Backfill diagnostic requests/items/events/participants.** Keep source IDs and raw snapshots.
6. **Change diagnostics writes to canonical core plus compatibility projections.** Do not dual-write two independent truths.
7. **Create canonical inventory movement model and rebuildable balance projection.** Adapt every mutation workflow to one posting engine.
8. **Merge product masters and lots.** Resolve legacy/rich/general pharmacy identity before moving balances.
9. **Move prescription fulfilment to canonical dispense + inventory movement + invoice event.** Stop legacy medicine stock writes.
10. **Replace bridges with staged reconciliation/cutover.** No ongoing quantity-copy bridge.
11. **Run dual-read comparison and invariant gates.** Require zero unexplained financial/stock deltas or signed exceptions.
12. **Freeze legacy writes, expose compatibility views, then archive.** Preserve audit history.

Hard blockers before canonical cutover:

- unresolved money units;
- ambiguous diagnostic catalog identity;
- ambiguous pharmacy product identity;
- untyped invoice/movement references;
- missing performer on performer-compensated services;
- unexplained stock balance versus movement deltas;
- duplicate operational invoices/sales across pharmacy generations;
- unreconciled accounting/repair queues.

---

## 18. Final current-state conclusion

The repository already contains valuable canonical building blocks: diagnostic-to-billing links, idempotent inventory issue/receipt cores, inventory consumption automation, lab reagent reconciliation, pharmacy repair queues, and accounting event posting. The redesign should reuse those patterns, not preserve their current table boundaries.

The required architectural decisions are:

- merge diagnostic and billing identity into one service catalog;
- make prices effective-dated integer-money records;
- separate request, occurrence, result/report, participant, invoice, and payment lifecycles;
- require explicit performer/referrer semantics;
- make immutable stock movements the quantity truth;
- converge pharmacy, lab reagent, and enterprise inventory on one item/lot/movement model;
- treat current balance and compatibility tables as projections;
- use durable idempotent operation journals and outbox reconciliation for all post-commit finance/analytics work.

No runtime implementation was changed by this audit.

**READY FOR INTEGRATION**

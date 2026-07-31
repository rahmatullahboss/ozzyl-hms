# Canonical Authority Writer and Reader Dependency Audit

**Date:** 2026-07-27
**Program:** HMS Canonical Data Architecture
**Checkpoint:** `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION-VERIFIED`
**Branch:** `program/cdb-main-continuous-20260725`
**Base registry commit:** `5e59706d7`
**Latest completed checkpoint commit:** `bfc352792`
**CDB-113F local checkpoint commit:** `561a34a1b`
**Reviewed main merge commit:** `9dec80136`
**Production access or mutation:** none

## Current rebaseline addendum — 2026-07-28

The historical checkpoint narratives below are retained as evidence. The machine registry was regenerated after CDB-122 through CDB-127E and the owner-approved Canonical Core V1 course correction. The current authoritative snapshot is:

| Measure | Current count |
| --- | ---: |
| Governed tables | 260 |
| Canonical tables | 121 |
| Matrix current-source tables | 155 |
| Governed legacy-disposition tables | 5 |
| Exact writer access pairs | 1,002 |
| Exact reader access pairs | 2,577 |
| `legacy_authority` writers | 457 |
| `canonical_compatibility` writers | 66 |
| `canonical_authority` writers | 284 |
| `migration_backfill` writers | 185 |
| `protected_fixture` writers | 10 |
| Legacy readers | 1,282 |
| Compatibility readers | 306 |
| Canonical readers | 900 |
| External readers | 89 |
| Registry/checker issues | 0 |

Identity/episode coverage now contains 815 reader pairs across 282 paths and 63 tables with zero unknown provider assignments. These counts supersede older totals when a new agent chooses work; older counts remain checkpoint-specific history only.

The next programme action is `CDB-V1-010-PROTECTED-PRODUCTION-CORE-SURFACE-INVENTORY`. Use `docs/architecture/hms-canonical-parallel-execution-board.yaml` for lane ownership and do not interpret every non-production dependency as a production migration requirement.

## 1. Purpose

This audit converts the full-HMS authority model into a code-level dependency graph. It answers two questions that must be resolved before any legacy table can be retired:

1. Which repository paths can still write a governed table?
2. Which repository paths still read a governed table?

The machine-readable evidence is:

- `docs/database/canonical-authority-access-registry.yaml`

The deterministic scanner and checker are:

- `scripts/canonical/canonical-authority-access.ts`
- `scripts/canonical/generate-canonical-authority-access-registry.ts`
- `scripts/canonical/check-canonical-authority-access.ts`
- `test/canonical/canonical-authority-access.test.ts`

An access count in this audit is an exact `path + table + access-type` pair. It is not a count of HTTP endpoints, SQL statements, database rows, or distinct business operations. A single file may contain multiple table dependencies, and one table may be used by many paths.

## 2. Scope and coverage

The governed set is the union of:

- 128 unique current-source table names from the authority matrix;
- 78 registered canonical tables;
- 5 registered legacy-disposition tables.

Because those sets overlap, the exact unique governed table count is **190**.

Static scan roots:

- `src/**`
- `scripts/canonical/**`

Explicit exclusions:

- test files;
- immutable historical migration SQL;
- generated migration manifests;
- dependencies, worktrees, build output, and coverage artifacts;
- comments when detecting SQL operations.

The scanner detects literal raw SQL `INSERT`, `REPLACE`, `UPDATE`, `DELETE`, `FROM`, and `JOIN` contexts plus common Drizzle `insert`, `update`, `delete`, `from`, and join calls. The registry records both raw-SQL and Drizzle evidence when both exist.

## 3. Overall result

| Measure | Count |
| --- | ---: |
| Governed tables | 191 |
| Exact writer access pairs | 869 |
| Exact reader access pairs | 2,088 |
| Registry/checker issues | 0 |

The result confirms that legacy retirement is not mainly a table-drop task. It is a broad command-boundary and provider-migration program spanning routes, shared libraries, canonical compatibility code, reports, dashboards, scheduled jobs, and migration/reconciliation tooling.

## 4. Writer classification

| Writer lifecycle | Access pairs | Meaning |
| --- | ---: | --- |
| `legacy_authority` | 414 | Active noncanonical writer that requires a canonical command cutover |
| `canonical_authority` | 227 | Runtime writer to a registered canonical table |
| `migration_backfill` | 142 | Explicit canonical migration, rehearsal, backfill, recovery, or evidence tool |
| `canonical_compatibility` | 65 | Canonical command/module still writing a legacy compatibility projection |
| `protected_fixture` | 10 | Seed, init, demo, or smoke-fixture path requiring production-scope review |
| `blocked_in_canonical_mode` | 0 | No generated entry currently uses this reviewed classification |
| `retirement_candidate` | 0 | Retirement is not inferred automatically from static discovery |

### Writer distribution by code area

The area-level table below is the reviewed CDB-113E pre-implementation ranking snapshot. The regenerated machine registry is authoritative for current exact path/table pairs and lifecycle totals.

| Area | Writer access pairs |
| --- | ---: |
| Tenant routes | 289 |
| Canonical libraries | 286 |
| Canonical scripts/tools | 131 |
| Shared libraries | 95 |
| Other routes | 27 |
| Services | 10 |
| Scheduled code | 1 |

The 414 `legacy_authority` access pairs are the most important implementation backlog. They are not all equally risky, but each must eventually be mapped to an owning canonical concept and either migrated, blocked under canonical mode, or retained under an explicit external/domain-extension decision.

The 65 `canonical_compatibility` pairs are also critical. They show where a canonical command currently preserves legacy state atomically for compatibility. These paths must not be removed until canonical reads are promoted and observed.

## 5. Reader classification

| Reader provider status | Access pairs | Meaning |
| --- | ---: | --- |
| `legacy` | 1,210 | Operational or analytical consumer still reading noncanonical authority |
| `canonical` | 539 | Consumer reading registered canonical tables |
| `compatibility` | 221 | Canonical module/tool still reading legacy sources or projections |
| `external` | 86 | Consumer reading an explicitly governed external authority such as tenant patient or auth identity |
| `shadow` | 0 | No path is classified solely by the deterministic shadow-path naming rule |

### Reader distribution by code area

The area-level table below is the reviewed CDB-113E pre-implementation ranking snapshot. Use the regenerated registry for current exact path/table evidence.

| Area | Reader access pairs |
| --- | ---: |
| Tenant routes | 901 |
| Canonical libraries | 421 |
| Shared libraries | 299 |
| Canonical scripts/tools | 262 |
| Other routes | 55 |
| Services | 36 |
| Scheduled code | 8 |
| Other source paths | 6 |

The dominant cutover blocker is the **1,210 legacy reader access pairs**. Even when canonical writing is correct, dashboards, reports, patient screens, operational queues, exports, public APIs, and background jobs can continue to show or calculate legacy truth. Reader migration therefore requires provider adapters and parity evidence, not only table backfill.

The reviewed `main` merge added seven legacy reader pairs in `src/routes/tenant/appointment-paid-context.ts`: `appointments`, `visits`, `doctors`, `bills`, `payments`, `invoice_items`, and `billing_provisional_items`. They support paid-visit display context and are intentionally classified as legacy projection dependencies; they do not promote appointment, practitioner, encounter, service, or financial authority.

CDB-113E added governed canonical access for encounter hardening, care-location and bed resources, admission lifecycle, bed-stay occupancy, disabled providers, bounded backfill, and persistent reconciliation. The regenerated registry records 19 more writers and 65 more readers than the reviewed preflight snapshot while leaving all 414 legacy-authority writers and 65 canonical-compatibility writers explicitly governed. This is local implementation evidence only; it does not prove route cutover or reader promotion.

CDB-113F adds three governed reads from the disabled-safe patient identity provider: the feature-flag row, legacy patient source, and canonical tenant-patient relationship. Its verified checkpoint registry contained 858 writers and 2,056 readers. A separate deterministic coverage registry classifies 616 operational identity/episode reader pairs across 249 paths and 41 tables with zero unknown assignments. Provider implementation self-reads remain governed here but are not counted as operational consumers in that promotion inventory. All provider flags remain disabled and no route was cut over.

CDB-113G added 21 governed read dependencies for the aggregate-only production schema/provider observer. Its verified checkpoint registry contained 858 writers and 2,077 readers. The observer is a governance tool rather than an operational route consumer, so the CDB-113F promotion inventory remains exactly 616 pairs across 249 paths and 41 tables. The production execution stopped after read-only schema preflight identified four missing authority tables; no provider query, data mutation, flag, route, or traffic change occurred.

CDB-113H post-main reconciliation registers the canonical cash-refund-reversal authority and the exact executed-refund legacy projection dependency. Its verified registry contained 191 governed tables, 869 writers, and 2,088 readers with zero issues. The identity/episode promotion inventory remained exactly 616 pairs across 249 paths and 41 tables because the refund/approval dependencies were outside that provider inventory.

CDB-113H2 adds three exact read dependencies from the production-shaped encounter/admission/bed reconciliation: one encounter-authority read and two admission/bed compatibility reads. Its protected-clone registry contained **191 governed tables, 869 writers, and 2,091 readers**, and its identity/episode inventory contained **619 operational reader pairs across 249 paths and 41 tables**.

CDB-113H2A synchronizes reviewed Staff/Workforce and Staff-authentication code from `main`. Three additional exact readers are now governed: Staff direct-login and MFA reads of `users`, plus the Workforce repository read of `canonical_practitioner_employee_links`. The current registry contains **191 governed tables, 869 writers, and 2,094 readers** with zero issues. The deterministic identity/episode inventory contains **622 operational reader pairs across 252 paths and 41 tables**; practitioner coverage is 190 and unknown provider assignments remain zero. All provider flags remain disabled and no production route, traffic, migration, backfill, Reception cutover, or retirement occurred.

## 6. Highest-dependency tables

### Highest writer-path counts

| Table | Writer paths |
| --- | ---: |
| `canonical_source_mappings` | 51 |
| `bills` | 25 |
| `canonical_invoices` | 22 |
| `InventoryStock` | 21 |
| `accounting_posting_events` | 19 |
| `canonical_outbox_events` | 18 |
| `canonical_processing_issues` | 19 |
| `invoice_items` | 17 |
| `lab_order_items` | 17 |
| `canonical_payment_receipts` | 16 |
| `canonical_payment_tenders` | 15 |
| `emp_cash_transactions` | 15 |
| `billing_provisional_items` | 13 |
| `canonical_payment_allocations` | 13 |
| `lab_orders` | 13 |

High counts for source mappings, issues, and outbox records are expected because they are shared migration/governance infrastructure. High counts for `bills`, `invoice_items`, `InventoryStock`, employee cash, provisional billing, and diagnostic order tables are direct evidence of unresolved operational authority spread.

### Highest reader-path counts

| Table | Reader paths |
| --- | ---: |
| `patients` | 143 |
| `bills` | 93 |
| `doctors` | 75 |
| `users` | 67 |
| `canonical_source_mappings` | 60 |
| `lab_orders` | 51 |
| `lab_test_catalog` | 49 |
| `lab_order_items` | 48 |
| `invoice_items` | 46 |
| `visits` | 42 |
| `admissions` | 40 |
| `canonical_invoices` | 40 |
| `billing_deposits` | 35 |
| `appointments` | 34 |
| `payments` | 33 |

The largest reader dependencies validate the roadmap order: identity and episode foundation first, then diagnostics and finance, then supply-chain convergence. Patient, doctor, appointment/visit/admission, billing, lab, and inventory facts are cross-cutting and cannot be fixed safely as isolated screens.

## 7. Highest-dependency paths

### Writer-heavy paths

Examples include:

- `src/lib/canonical/local-sync-business-apply.ts` — 18 governed writer dependencies, still offline and not runtime-connected;
- `src/routes/tenant/billingCounter.legacy.ts` — 14;
- `src/routes/tenant/reception.ts` — 13;
- `src/routes/tenant/approvals.ts` — 11;
- canonical financial smoke fixture — 11;
- canonical credit-note cash-refund and settlement commands — 11 each;
- IPD billing and lab routes — 10 each;
- canonical inventory/practitioner backfill tools — 10 each.

The local-sync apply file is not an activation approval. Its dependencies remain offline contract evidence, and the local-sync readiness gate remains blocked.

### Reader-heavy paths

Examples include:

- `src/lib/canonical/local-sync-business-apply.ts` — 23 governed reader dependencies;
- tenant reports and patients routes — 22 each;
- daily collection, dashboard, and legacy billing counter — 21 each;
- reception — 20;
- canonical IPD projection — 19;
- doctors and patient-chart routes — 18 each;
- canonical accounting poster and local-sync projector — 18 each;
- tenant billing — 17.

These paths are priority integration-test and provider-migration surfaces because a single file combines many domain facts.

## 8. Tables without statically discovered access

### No discovered writer

- `accounts`
- `canonical_accounting_accounts`
- `canonical_accounting_mappings`
- `canonical_accounting_periods`
- `canonical_inventory_unit_conversions`
- `canonical_schema_versions`
- `doctor_visits`
- `nur_patient_monitoring`

### No discovered reader

- `accounts`
- `canonical_cash_custody_movements`
- `canonical_compensation_adjustment_reversals`
- `canonical_encounter_addenda`
- `canonical_encounter_participants`
- `canonical_inventory_transfers`
- `canonical_practitioner_departments`
- `canonical_practitioner_specialties`
- `canonical_reconciliation_runs`
- `canonical_schema_versions`
- `canonical_sync_entity_versions`
- `doctor_visits`
- `expense_recoveries`
- `hr_payslip_adjustments`
- `nur_patient_monitoring`

“No discovered access” does not mean safe to delete. It may mean a planned table is not yet operationally adopted, a dynamic access was not statically inferable, a migration-only table was intentionally excluded, or functionality is incomplete. These lists are gap evidence, not retirement authorization.

## 9. Priority execution implications

### Priority A — Patient, practitioner, appointment, and episode foundation

Reader concentration on patients, doctors, users, visits, admissions, and related routes confirms this as the earliest dependency wave. CDB-113B now establishes explicit patient/global links, immutable relationship events, an atomic command, and deterministic backfill evidence. Practitioner operational adoption, appointment intent, encounter/admission convergence, and provider promotion remain the next serial steps.

### Priority B — Billing and cash

`bills`, `invoice_items`, `payments`, deposits, provisional items, employee cash, accounting events, and canonical receipt/allocation structures remain heavily cross-referenced. Strict canonical commands already exist for many paths, but read promotion and legacy-compatibility retirement are incomplete.

### Priority C — Diagnostics

Lab orders/items/catalog, visits, invoices, results, and performer/referrer facts have high reader and writer spread. Diagnostic requests/events/participants and result extensions must converge without inferring clinical roles.

### Priority D — Inventory and pharmacy

`InventoryStock`, movements, pharmacy tables, medicine batches, and lab consumables still represent overlapping quantity systems. Every quantity mutation must converge on canonical movements before balance retirement.

### Priority E — Expense, payroll, insurance, and remaining clinical extensions

These areas have fewer shared access pairs than core identity/billing but still lack complete canonical lifecycle models. They should follow the shared identity, encounter, service, finance, and inventory foundations rather than create independent authorities.

## 10. Static-analysis limitations

The registry is fail-closed for the reviewed static-detection contract, but it cannot prove:

- dynamic table names assembled without a literal table token;
- imported Drizzle variables renamed locally;
- SQL generated inside external dependencies;
- database-trigger behaviour;
- remote worker code outside the repository roots;
- runtime paths disabled or enabled by configuration;
- production traffic frequency or business criticality.

Before destructive retirement, the static registry must be supplemented by protected schema evidence, runtime/query telemetry where available, provider parity, zero unexplained reconciliation variance, observation, rollback proof, and fresh owner authorization.

## 11. Audit verdict

**Result: repository access registry implemented and verified; production cutover and retirement remain blocked.**

The access registry gives the program a durable, reviewable dependency map and prevents silent new governed accesses. It also demonstrates that the remaining architecture work is substantial: 414 active legacy writer pairs and 1,208 legacy reader pairs still need domain-by-domain migration or explicit retention decisions.

CDB-113D closes the local appointment-authority implementation checkpoint without claiming runtime promotion. The exact next checkpoint is `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`; the reviewed `main` merge adds paid-visit and admission-slip legacy read surfaces that must be included in the CDB-113E audit and later provider promotion.

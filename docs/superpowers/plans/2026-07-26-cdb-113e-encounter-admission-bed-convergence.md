# CDB-113E Encounter, Admission, and Bed Convergence Implementation Plan

**Program:** HMS Canonical Data Architecture
**Checkpoint:** `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`
**Branch:** `program/cdb-main-continuous-20260725`
**Execution mode:** single-agent continuous, local-only implementation and verification
**Production mutation authorised:** no
**Encounter/admission/bed provider activation authorised:** no
**Local-sync expansion authorised:** no
**Legacy retirement authorised:** no
**Push or CDB-to-main integration authorised:** no

## 1. Goal

Extend the existing canonical encounter foundation and implement one additive inpatient admission, care-location, bed-resource, and bed-stay authority. Preserve current operational routes through strict atomic compatibility boundaries and disabled providers. Do not make admission or occupancy authority own patient demographics, practitioner profiles, diagnoses, nursing assignment, bed pricing, admission fee, billing status, deposit/payment, invoice, accounting, cleaning workflow, reservation workflow, or discharge-finance truth.

The locally verified completion target includes:

- hardened `canonical_encounters` with canonical patient link and positive version;
- one `canonical_admissions` header per inpatient extension;
- immutable `canonical_admission_status_events`;
- canonical care-location identity;
- canonical bed-resource identity;
- canonical-public-ID-based `canonical_bed_stays` with open-stay and interval invariants;
- deterministic, idempotent, version-guarded commands;
- disabled encounter and admission/bed provider modes;
- bounded, resumable, deterministic, and second-pass safe backfill;
- persistent fail-closed reconciliation;
- updated source, authority, and access governance;
- a verified receipt, clean worktree, and one exact CDB-113F continuation action.

## 2. Reviewed input evidence

Read and obey:

1. `agents.md`;
2. `.agent-rules/git-workflow.md`;
3. `docs/architecture/canonical-program-control-center.md`;
4. `task-progress.yaml`;
5. `docs/database/audits/2026-07-26-encounter-admission-bed-convergence-audit.md`;
6. `docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md`;
7. `docs/superpowers/plans/2026-07-26-cdb-113a-identity-episode-foundation.md`;
8. `docs/database/migration-runs/P11-canonical-appointment-authority.md`;
9. `docs/database/canonical-authority-matrix.yaml`;
10. targeted entries from `docs/database/canonical-authority-access-registry.yaml`;
11. `migrations/0507_canonical_encounters.sql`;
12. `src/db/schema/canonical/clinical.ts`;
13. `scripts/canonical/backfill-encounters.ts`;
14. current admission, discharge, bed, billing, nursing, reception, death-record, encounter, visit, and consultation routes.

Exact current access evidence:

- `canonical_encounters`: 4 writers and 12 readers;
- `canonical_encounter_participants`: 2 writers and 0 readers;
- `canonical_encounter_admission_links`: 1 writer and 4 readers;
- `canonical_bed_stays`: 2 writers and 2 readers;
- `encounters`: 2 writers and 5 readers;
- `visits`: 9 writers and 42 readers;
- `consultations`: 3 writers and 11 readers;
- `admissions`: 7 writers and 40 readers;
- `beds`: 6 writers and 25 readers;
- `patient_bed_infos`: 6 writers and 10 readers;
- 69 literal admission/bed/occupancy mutation references;
- 39 literal legacy encounter/visit/consultation mutation references.

Priority operational surfaces include:

- `src/routes/tenant/admissions.ts`;
- `src/routes/tenant/reception.ts`;
- `src/routes/tenant/ipBilling.ts`;
- `src/routes/tenant/dischargePlanning.ts`;
- `src/routes/tenant/deathRecords.ts`;
- `src/routes/tenant/approvals.ts`;
- `src/routes/tenant/nursing/assignments.ts`;
- `src/routes/tenant/clinical/encounters.ts`;
- `src/routes/tenant/doctors.ts`;
- `src/routes/tenant/visits.ts`;
- `src/routes/tenant/consultations.ts`;
- `src/routes/tenant/appointment-paid-context.ts`;
- admission-slip and IPD display paths merged during the reviewed main-sync preflight.

## 3. Architecture contract

The implementation must preserve these exact rules:

- Encounter is actual care.
- Admission is an inpatient extension linked to one encounter.
- Bed is resource identity.
- Bed stay is interval-based occupancy truth.
- Clinical discharge is not financial settlement.
- Bed price is not bed identity or occupancy truth.
- Billing fields are not canonical admission lifecycle authority.
- Appointment remains planned intent and links explicitly to actual care.
- Patient demographics are not copied; use `patient_link_public_id`.
- Practitioner profile/auth/employee data are not copied; use practitioner public IDs and explicit participant roles.
- `canonical_encounters` is extended, not replaced.
- `canonical_encounter_admission_links` becomes migration compatibility evidence rather than final admission authority.
- `canonical_bed_stays` is extended, not replaced.
- `beds.status='occupied'`, `admissions.bed_id`, and open `patient_bed_infos` are compatibility projections until reader promotion.
- Admission fee, bed rate, calculated days/charge, bill ID, billing mode, package, due clearance, and payment/deposit state remain outside admission and occupancy authority.
- Ward names, floor text, room labels, bed-number text, names, phone, numeric-ID coincidence, and time proximity never establish identity or episode linkage.
- Transfer closes the old stay and opens the new stay atomically when occupancy changes.
- Discharge/cancellation closes the active stay and appends immutable admission history.
- Signed clinical content and addenda are never rewritten.
- Exact idempotency replay occurs before state-dependent validation.
- Every mutable canonical header/resource uses an expected version.
- Required compatibility statements execute through `authoritativeStatements` in the same canonical batch.
- PHI-minimised outbox and aggregate evidence exclude names, phone, addresses, diagnoses, care-of data, notes, money amounts, bill IDs, and copied display labels.
- Provider feature flags remain disabled.
- No production, remote, sync, traffic, retirement, push, or CDB-to-main action occurs.

## 4. Serial checkpoint sequence

### CDB-113E.1 — Audit, design contract, and serial plan

Inputs:

- reviewed main-sync preflight and current access registry;
- current canonical encounter/bed-stay foundation;
- current legacy encounter/admission/bed schemas;
- exact writer and reader paths;
- all admission creation, transfer, discharge, death, billing, bed-management, and occupancy mutations;
- CDB-113A target design.

Outputs:

- `docs/database/audits/2026-07-26-encounter-admission-bed-convergence-audit.md`;
- this plan;
- `test/canonical/encounter-admission-bed-convergence-design-contract.test.ts`.

Verification:

- documents are substantial;
- exact writer/reader and mutation counts are recorded;
- encounter/admission/resource/occupancy/finance separation is explicit;
- target tables, commands, provider modes, backfill, reconciliation, concurrency, safety, and next checkpoint are test-locked.

Commit:

`docs(canonical): define encounter admission bed convergence`

### CDB-113E.2 — Additive schema and governance

Use RED tests before migration or Drizzle implementation.

Target files:

- `test/canonical/encounter-admission-bed-convergence-schema.test.ts`;
- `migrations/0548_canonical_encounter_admission_bed_convergence.sql`;
- `src/db/schema/canonical/clinical.ts`;
- `src/db/schema/canonical/index.ts` only if new exports are required;
- `docs/database/canonical-source-of-truth.yaml`;
- `docs/database/canonical-authority-matrix.yaml`;
- regenerated access registry and governance fixtures where exact counts change.

#### 4.2.1 Encounter hardening

Extend `canonical_encounters` additively with:

- nullable `patient_link_public_id`, backfilled before any not-null promotion;
- positive `encounter_version` defaulting safely for existing rows;
- optional `care_location_public_id`;
- controlled `source_kind`;
- nullable command/idempotency source metadata compatible with historical rows;
- tenant-scoped foreign key to `canonical_tenant_patient_links`;
- tenant-scoped optional FK to canonical care location after that table exists;
- indexes for patient link/time, location/time, status/version, and source kind.

Status policy:

- historical `planned` values remain readable until classified;
- new canonical command tests must reject runtime creation in `planned` state;
- allowed new runtime actual-care states are `in_progress`, `on_hold`, `completed`, `cancelled`, `entered_in_error`;
- `unknown` is migration-only unresolved evidence;
- no destructive rewrite of existing signed encounters.

Do not remove `legacy_patient_id` in this checkpoint. It remains compatibility/source evidence and becomes non-authoritative after backfill.

#### 4.2.2 `canonical_admissions`

Required columns:

- integer primary key;
- `tenant_id` text not null;
- `admission_public_id` text not null;
- `encounter_public_id` text not null;
- `patient_link_public_id` text not null;
- `admission_number` text not null;
- `admission_type` text not null;
- `admission_source` text not null;
- `current_status` text not null;
- positive `status_version`;
- `admitted_at_utc` text not null;
- nullable `discharged_at_utc`;
- nullable safe `reason_code` and access-controlled safe note only if required;
- `idempotency_key` or equivalent command key;
- request fingerprint/source evidence SHA-256;
- created/updated UTC.

Required constraints:

- unique tenant + admission public ID;
- unique tenant + admission number;
- tenant-scoped FK to encounter;
- tenant-scoped FK to patient link;
- admitted/discharged interval validity;
- patient link must be validated against encounter in commands/reconciliation;
- status/version positive and controlled;
- one active admission per inpatient encounter through a partial unique index;
- lowercase 64-hex evidence/fingerprint where repository policy requires it;
- no `REAL` columns;
- no patient demographics, diagnosis narrative, care-of data, nurse assignment, admission fee, package, billing mode, due clearance, bill status, bed integer ID, current ward/bed label, payment, deposit, or invoice fields.

Status vocabulary:

- `planned`;
- `admitted`;
- `transfer_pending`;
- `discharge_pending`;
- `discharged`;
- `cancelled`;
- `entered_in_error`.

Admission type/source vocabularies must be controlled and broad enough for planned, emergency, transfer, direct, conversion, import, and other reviewed sources without copying free-form workflow labels into identity.

#### 4.2.3 `canonical_admission_status_events`

Required columns and constraints:

- tenant, event public ID, admission public ID;
- event type;
- nullable from status and required to status;
- positive sequence;
- reason code and optional safe note;
- actor user public ID or actor system key, with at least one required;
- command idempotency key;
- source evidence hash;
- occurred and created UTC;
- unique tenant + event public ID;
- unique tenant + admission + sequence;
- unique tenant + idempotency key;
- tenant-scoped FK to admission;
- exact status/event vocabularies;
- lowercase evidence hash.

Event vocabulary must represent at least:

- `created`;
- `admitted`;
- `transfer_requested`;
- `transfer_received`;
- `transfer_cancelled`;
- `discharge_requested`;
- `discharge_cancelled`;
- `discharged`;
- `cancelled`;
- `entered_in_error`.

Header current status/version must equal the latest immutable event.

#### 4.2.4 `canonical_care_locations`

Required columns:

- tenant ID;
- `location_public_id`;
- nullable parent location public ID;
- `location_kind`;
- stable code;
- display name;
- operational status;
- timezone;
- positive version;
- source evidence hash;
- created/updated UTC.

Required rules:

- tenant + public ID unique;
- tenant + parent/code uniqueness as appropriate;
- self-parent rejected;
- tenant-scoped parent FK;
- kind vocabulary for facility, branch, floor, ward, room, department care area, other;
- status vocabulary `active`, `inactive`, `retired`;
- no occupancy, patient, admission, price, rate, bill, or charge columns.

#### 4.2.5 `canonical_beds`

Required columns:

- tenant ID;
- `bed_public_id`;
- parent `location_public_id`;
- bed code/number;
- type/class;
- operational status;
- positive version;
- source evidence hash;
- created/updated UTC.

Required rules:

- tenant + bed public ID unique;
- tenant + location + bed code unique;
- tenant-scoped location FK;
- operational status `active`, `inactive`, `maintenance`, `retired`;
- no occupied/available status field;
- no patient/admission/current-stay ID;
- no rate, price, charge, days, bill ID, billed flag, or `REAL` money;
- mapped/history-bearing bed is retired, not physically deleted.

#### 4.2.6 Extend `canonical_bed_stays`

Add:

- nullable then backfill-required `admission_public_id`;
- nullable then backfill-required `bed_public_id`;
- canonical patient-link consistency reference or enforced derivation;
- positive `stay_version`;
- controlled `movement_reason`;
- nullable source command/idempotency metadata;
- optional close reason;
- tenant-scoped FKs to admission and bed;
- indexes for admission interval and bed interval.

Required invariants:

- one open bed stay per bed;
- one open bed stay per active admission;
- no overlap for the same bed;
- no overlap for the same admission;
- ended >= started;
- active stay has no end;
- completed/invalid stay has required close semantics;
- patient, admission, and encounter agree;
- inactive/maintenance/retired bed cannot receive a new stay;
- no rate, charge, billed status, or bill ID.

Use partial unique indexes for open-stay cardinality and command/reconciliation checks for historical interval overlap.

#### 4.2.7 Compatibility link evolution

Retain `canonical_encounter_admission_links` during migration. Add `admission_public_id` only if required to bridge old readers/backfill, or map it deterministically through `canonical_source_mappings`. Do not make it a second lifecycle header.

#### 4.2.8 Schema RED/green coverage

Tests must prove:

- migration and Drizzle schema existence;
- additive application against the existing foundation;
- exact columns/types/indexes/FKs;
- no duplicate encounter table;
- patient-link and version hardening;
- no runtime `planned` encounter creation through commands;
- one active admission per inpatient encounter;
- admission header/event vocabularies and version parity constraints;
- care-location hierarchy and tenant safety;
- bed identity without occupied/available or price;
- one open stay per bed and admission;
- interval validity and tenant-scoped references;
- no demographics, clinical narrative, auth, money, billing, or payment fields;
- source-of-truth registration and one authority owner per new table;
- migration manifest increments to 479 if no concurrent reviewed migration is added.

Commit:

`feat(canonical): add encounter admission bed schema`

### CDB-113E.3 — Encounter hardening and resource commands

Target files:

- `src/lib/canonical/commands/start-encounter.ts` or reviewed additive companion functions in the same authority module;
- `src/lib/canonical/commands/manage-care-location-and-bed.ts`;
- `test/canonical/encounter-admission-bed-resource-commands.test.ts`;
- access registry regeneration.

Use `runCanonicalBatch`, `readCanonicalCommandReplay`, deterministic ID helpers, source mappings, and existing outbox conventions. Do not implement a parallel transaction/idempotency framework.

#### 4.3.1 Encounter hardening

New runtime start/update behavior must:

- require exact tenant patient link;
- validate participant practitioner public IDs and role vocabulary;
- reject new `planned` encounter state;
- set positive encounter version;
- support exact idempotency replay and conflicting replay;
- reject source-mapping conflict;
- include typed source kind;
- use expected version for mutable encounter transitions;
- preserve signed snapshot and addendum immutability;
- execute required `authoritativeStatements` for legacy encounter/visit/consultation compatibility;
- emit PHI-minimised outbox evidence with public IDs, type/status/version/time only.

Do not rewrite all existing encounter commands if a minimal additive extension can preserve reviewed behavior. Keep appointment linkage explicit through `canonical_appointment_encounter_links`.

#### 4.3.2 `manage-care-location-and-bed`

Commands may include:

- create/update/retire care location;
- create/update/transition/retire bed resource;
- maintenance transition;
- source-mapping registration.

Rules:

- deterministic public IDs when omitted;
- exact source mapping;
- exact idempotency replay;
- expected version for updates;
- parent/location tenant validation;
- reject location cycles/self-parent;
- reject bed retirement with an open stay;
- reject physical deletion;
- never accept occupied/available as canonical bed operational status;
- caller-supplied legacy bed/ward compatibility statements commit atomically;
- outbox excludes notes, prices, patient/admission data, and copied labels not needed for routing.

Commit:

`feat(canonical): harden encounters and bed resources`

### CDB-113E.4 — Admission and occupancy commands

Target files:

- `src/lib/canonical/commands/manage-admission-bed-stay.ts` or clearly separated authority modules under `src/lib/canonical/commands/**`;
- `test/canonical/encounter-admission-bed-commands.test.ts`;
- access registry regeneration.

#### 4.4.1 `admit-patient-and-claim-bed`

Input must include:

- tenant and optional deterministic public IDs;
- patient-link public ID;
- existing inpatient encounter public ID or exact inputs to create/convert an encounter through the reviewed encounter boundary;
- optional admitting practitioner public ID;
- admission number/type/source;
- admitted UTC and safe reason code;
- optional bed public ID and expected bed version;
- source type/public ID/table/evidence hash;
- idempotency key;
- actor/system evidence;
- `authoritativeStatements` for legacy admission, bed, patient-bed, reservation, audit, and optional reviewed financial composition.

Behavior:

- exact replay before dependency validation;
- validate patient link and encounter patient agreement;
- validate inpatient encounter type/status;
- validate admitting practitioner and create explicit participant evidence;
- reject another active canonical admission for the encounter;
- create admission header version 1 and immutable created/admitted event sequence 1;
- create admission source mapping;
- if bed supplied, validate canonical bed/location/operational state and expected version;
- reject another open stay on the bed or admission;
- open first bed stay with deterministic ID;
- persist source mapping for admission/stay as required;
- execute all canonical rows/events/mappings/outbox/compatibility statements in one batch;
- optional admission-deposit statements remain canonical finance authority and are only composed, never copied.

Race tests:

- double admission;
- double bed claim;
- same idempotency exact replay;
- conflicting replay;
- stale bed version;
- patient/encounter mismatch;
- compatibility failure rollback;
- no partial admission without stay when bed claim was required.

#### 4.4.2 `transfer-bed`

Input must include:

- tenant;
- admission public ID;
- expected admission version;
- current stay public ID and expected stay version;
- destination bed public ID and expected bed version;
- effective UTC;
- movement reason;
- idempotency/actor/source evidence;
- `authoritativeStatements`.

Behavior:

- exact replay first;
- admission must be active;
- current open stay must belong to admission;
- destination bed must exist in tenant and be active;
- maintenance/inactive/retired destination rejected;
- destination open-stay conflict rejected;
- close current stay and increment/guard its version;
- open destination stay;
- append transfer event when lifecycle status changes or transfer evidence is required;
- preserve historical source labels only in compatibility projection;
- commit legacy `admissions.bed_id`, `previous_bed_id`, `beds.status`, `patient_bed_infos`, transfer flags, audit, and any workflow statements atomically;
- pending transfer does not falsely change effective occupancy before receive/acceptance.

Race tests:

- concurrent transfer to same destination;
- duplicate receive;
- transfer from stale current stay;
- destination retired after read;
- previous-stay close failure;
- compatibility failure rollback;
- exact replay creates no second stay.

#### 4.4.3 `discharge-or-cancel-admission`

Input must include:

- tenant, admission public ID, expected version;
- transition target/reason;
- occurred UTC;
- actor/system evidence;
- optional expected active stay public ID/version;
- optional encounter transition command inputs;
- idempotency/source evidence;
- `authoritativeStatements`.

Behavior:

- exact replay first;
- validate allowed admission transition;
- update header by expected version;
- append immutable status event;
- close active stay when terminal;
- optionally transition encounter through the reviewed encounter authority when clinically valid;
- death, normal discharge, cancellation, and entered-in-error use typed reasons;
- emit durable cross-domain orchestration evidence;
- execute legacy admission, patient-bed, bed-cleaning, provisional-discharge, death/discharge workflow, audit, and reviewed financial orchestration statements atomically where required;
- never set paid/cleared/billed state as admission authority;
- repeated discharge/cancel is exact replay or conflict, never a second terminal event.

Race tests:

- repeated discharge;
- stale expected version;
- discharge versus transfer race;
- discharge versus cancellation race;
- missing active stay;
- patient/admission/encounter mismatch;
- encounter transition failure rollback;
- compatibility/financial statement failure rollback without partial clinical state.

Commit:

`feat(canonical): add admission and bed stay commands`

### CDB-113E.5 — Disabled encounter and admission/bed providers

Target files:

- `src/lib/canonical/encounter-provider.ts`;
- `src/lib/canonical/admission-bed-provider.ts`;
- `test/canonical/encounter-admission-bed-provider.test.ts`;
- authority matrix and access registry evidence.

Feature flags:

- `canonical_encounter_provider_v1`;
- `canonical_admission_bed_provider_v1`.

Both feature flags remain disabled.

Modes:

- legacy mode;
- shadow mode;
- canonical mode.

Mode resolution:

- missing flag table or row => legacy;
- disabled flag => legacy;
- malformed/unsupported mode => legacy;
- enabled shadow => shadow;
- enabled canonical => canonical.

Encounter provider parity compares only reviewed authority facts:

- exact encounter source mapping;
- patient-link public ID;
- encounter public ID/type/status/version;
- started/ended interval;
- explicit participant public IDs/roles;
- care-location public ID;
- appointment link where applicable;
- signed/addendum cardinality, never clinical content.

Admission/bed provider parity compares:

- exact admission source mapping and public ID;
- encounter and patient-link agreement;
- admission number/type/source/status/version and interval;
- latest admission event status/version;
- current canonical bed public ID derived from one open stay;
- open-stay interval and cardinality;
- bed operational state and location public IDs;
- legacy bed status versus derived occupancy as parity evidence only.

Provider parity must not compare or log:

- names, phone, address, care-of data;
- diagnosis or notes;
- admission fee, rate per day, days, charge amount, billed flag, bill ID;
- payment/deposit/invoice state;
- free-form room/ward labels as identity;
- numeric-ID coincidence or time proximity.

Disabled-safe adapters should cover, without route wiring:

- encounter detail and patient timeline projection;
- admission detail/list/census projection;
- current bed/ward occupancy projection;
- mutation validation for admission, transfer, discharge, and bed claim;
- paid-visit context and appointment eligibility episode evidence;
- admission-slip display enrichment;
- nurse station, doctor, kitchen, IPD report, billing, dashboard, export, and scheduled consumer contracts as registered targets.

Canonical mode fails closed on missing critical mappings. No hidden fallback is permitted.

Commit:

`feat(canonical): add encounter admission bed providers`

### CDB-113E.6 — Bounded backfill and persistent reconciliation

Target files:

- `scripts/canonical/backfill-encounter-admission-bed-convergence.ts`;
- `scripts/canonical/reconcile-encounter-admission-bed-convergence.ts`;
- `test/canonical/encounter-admission-bed-backfill.test.ts`;
- `test/canonical/encounter-admission-bed-reconciliation.test.ts`;
- authority matrix and access registry evidence.

A dedicated convergence backfill is preferred over silently rewriting the existing historical `backfill-encounters.ts`. It may reuse its helpers and source mappings. The old script remains evidence of the initial foundation; the new script hardens canonical public-ID relationships and fills new authorities.

#### 4.6.1 Ordered partitions

1. encounter patient-link/version/source-kind hardening;
2. care-location source mapping;
3. bed-resource source mapping;
4. admission source mapping and lifecycle header/event creation;
5. bed-stay public-ID hardening and interval mapping;
6. unresolved/ambiguous issue classification.

Each partition uses:

- `canonical_migration_runs`;
- `canonical_backfill_checkpoints`;
- bounded `maxSourceRecords` or reviewed chunk option;
- deterministic IDs;
- source evidence hashes;
- one atomic source-row batch;
- resumable cursor;
- paused/completed checkpoint state;
- stable issues;
- aggregate result summary;
- second-pass zero-new-business-row proof.

#### 4.6.2 Encounter hardening rules

For each existing canonical encounter:

- resolve exact active tenant patient link from `legacy_patient_id`;
- populate `patient_link_public_id` only when exactly one valid link exists;
- classify planned status as appointment intent candidate or issue, never auto-promote it to actual care;
- initialize positive encounter version deterministically;
- retain signed snapshot/addenda unchanged;
- record missing/ambiguous patient link as issue;
- do not merge encounters by time proximity.

Source cardinality checks cover legacy `encounters`, `visits`, `consultations`, and `admissions` mappings without forcing distinct source rows into one encounter unless explicit source evidence exists.

#### 4.6.3 Care-location and bed rules

Location mapping may derive a deterministic hierarchy from exact tenant legacy bed fields:

- facility/branch if existing exact authority exists;
- floor from exact normalized source value;
- ward from exact tenant + floor + ward source evidence;
- optional room only when an exact source field exists;
- bed from exact legacy bed row.

Names/labels create deterministic resource source mappings within the same exact legacy source row; they do not link unrelated rows across tenants or systems. Duplicate tenant ward/bed source identities, conflicting floor/ward hierarchy, missing code, or invalid status become issues.

Legacy bed operational mapping:

- maintenance => canonical maintenance;
- intentionally decommissioned/inactive => inactive/retired only with reviewed evidence;
- available/occupied/reserved/cleaning do not become canonical operational status except active resource plus compatibility workflow evidence;
- rate per day is excluded.

#### 4.6.4 Admission rules

Every legacy admission receives one canonical admission or an ambiguous/rejected mapping issue.

Automatic relation requires:

- exact existing admission encounter source mapping or exact approved admission/visit relation;
- exact patient link;
- encounter patient agreement;
- unique tenant admission number;
- valid admitted/discharged interval;
- deterministic admission lifecycle classification.

Legacy statuses map through an explicit table. Financial markers, provisional discharge flags, transfer flags, and workflow fields may inform event classification but cannot independently overwrite the canonical header without a deterministic lifecycle rule. Conflicting terminal evidence becomes an issue.

Create an initial immutable event reflecting the derived current lifecycle and source evidence. Historical granular events are created only when timestamps/evidence are explicit; do not invent event chronology.

#### 4.6.5 Bed-stay rules

Every valid `patient_bed_infos` row maps through exact admission and bed mappings.

Require:

- exact admission public ID;
- exact bed public ID;
- patient/admission/encounter agreement;
- valid interval;
- deterministic source evidence;
- no existing conflicting source mapping.

Overlap, multiple open stays, inverted interval, missing bed/admission, patient mismatch, maintenance/retired bed occupancy, or duplicate source becomes a stable issue. Do not guess a winner. Valid rows populate new public-ID/version/movement fields without copying price, days, charge, billed state, or bill ID.

#### 4.6.6 Persistent reconciliation

Persist one aggregate receipt with explicit checks for:

1. encounter source mapping cardinality;
2. encounter patient-link validity;
3. encounter status/version validity;
4. planned actual-care state classification;
5. encounter participant practitioner/tenant validity;
6. admission source mapping cardinality;
7. one active admission per inpatient encounter;
8. admission header/latest-event parity;
9. admission event sequence/transition validity;
10. encounter/admission patient agreement;
11. admission interval/terminal-time validity;
12. care-location mapping and hierarchy validity;
13. bed resource mapping and tenant/location validity;
14. open-stay cardinality per bed;
15. open-stay cardinality per active admission;
16. interval overlap per bed;
17. interval overlap per admission;
18. stay/admission/encounter/patient consistency;
19. inactive/maintenance/retired bed occupancy;
20. legacy bed status versus derived occupancy;
21. unresolved encounter/admission/bed issues;
22. cross-tenant references;
23. second-pass zero-new-row evidence.

The result status is failed when any check count is nonzero. `mismatchChecks` counts failed check categories, while each check stores exact aggregate row/group count. Evidence hash is deterministic and excludes raw row content.

Backfill/reconciliation tests must prove:

- clean deterministic fixture;
- ambiguous patient/encounter/admission/bed mappings;
- overlapping stays;
- multiple open stays;
- invalid interval;
- patient mismatch;
- maintenance-bed conflict;
- source evidence drift;
- per-row transaction rollback;
- bounded pause/resume across partitions;
- migration-run binding;
- passing and failed persistent receipts;
- second pass creates zero new business rows;
- no PHI/financial values in result summaries or hashes.

Commit:

`feat(canonical): backfill and reconcile encounter admission bed authority`

### CDB-113E.7 — Final metadata, receipt, and verification

Target files:

- `docs/database/migration-runs/P11-canonical-encounter-admission-bed-convergence.md`;
- `docs/database/canonical-authority-matrix.yaml`;
- `docs/database/canonical-authority-access-registry.yaml`;
- `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`;
- `docs/architecture/canonical-program-control-center.md`;
- `.ai-bridge/current-plan.md`;
- `task-progress.yaml`;
- continuity contract tests.

Update exact facts:

- checkpoint and commit hashes;
- migration count;
- canonical table count;
- governed table/writer/reader counts;
- target modules and authority owners;
- backfill/reconciliation status;
- current provider-disabled state;
- legacy writer/reader blockers;
- readiness 0/8 and retirement 0/65 unless fresh checks prove otherwise;
- production, feature, sync, push, and CDB-to-main safety statements;
- one exact next action for `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`.

Do not mark encounter, admission, or bed authority runtime-cut-over. Locally verified schema/commands/provider/backfill/reconciliation are not production observation or reader promotion.

Commit:

`docs(canonical): verify encounter admission bed checkpoint`

## 5. Verification matrix

Run after each relevant checkpoint, then fresh before final metadata commit.

### Focused design/schema/command/provider/backfill tests

```text
pnpm vitest run test/canonical/encounter-admission-bed-convergence-design-contract.test.ts
pnpm vitest run test/canonical/encounter-admission-bed-convergence-schema.test.ts
pnpm vitest run test/canonical/encounter-admission-bed-resource-commands.test.ts
pnpm vitest run test/canonical/encounter-admission-bed-commands.test.ts
pnpm vitest run test/canonical/encounter-admission-bed-provider.test.ts
pnpm vitest run test/canonical/encounter-admission-bed-backfill.test.ts
pnpm vitest run test/canonical/encounter-admission-bed-reconciliation.test.ts
```

### Adjacent canonical regression

Include:

- patient-link lifecycle/backfill/reconciliation;
- practitioner commands/provider/backfill/reconciliation;
- appointment schema/commands/provider/backfill/reconciliation;
- start encounter and encounter backfill;
- IPD projection;
- admission deposit atomic command;
- IPD discharge billing finalization;
- invoice encounter links;
- service operations and finance boundaries that reference encounter/admission.

### Full verification

```text
pnpm vitest run test/canonical --testTimeout=15000
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

If runtime route files are intentionally integrated in this checkpoint, run their focused backend/web tests and production build. CDB-113E should normally stop at disabled adapters and compatibility statement builders, leaving route promotion to CDB-113F.

### Expected safety outcomes

- schema governance: 0 issues;
- authority governance: 0 issues;
- access governance: 0 issues after explicit registry regeneration/review;
- local sync: still blocked and not activated;
- legacy retirement: still blocked and not authorised;
- provider flags: disabled;
- production mutation: none;
- CDB-to-main integration: none;
- worktree: clean after each checkpoint commit.

## 6. Stop and continuation rules

A normal checkpoint commit is not a stop. Continue serially to the next safe checkpoint while context and execution limits allow.

Stop only when:

- a safety boundary requires fresh user authorization;
- an unresolved conflict risks overwriting unrelated work;
- production/remote action would be required;
- context/execution limit is near, after a clean commit and exact handoff.

Do not spawn or delegate other agents. Do not revive a separate canonical-finance architecture. Do not merge CDB back to `main`.

After verified CDB-113E completion, the exact next checkpoint is:

`CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`

CDB-113F owns provider coverage registry, shadow parity, fail-closed read-promotion readiness, staged local provider adoption, rollback evidence, and consumer-by-consumer migration. It still does not authorise production traffic or destructive retirement without fresh explicit authorization.

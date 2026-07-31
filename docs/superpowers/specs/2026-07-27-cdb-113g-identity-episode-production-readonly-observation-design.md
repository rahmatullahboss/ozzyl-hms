# CDB-113G Identity and Episode Production Read-Only Observation Design

**Date:** 2026-07-27  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Predecessor:** `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION-VERIFIED`  
**Authorization source:** Rahmatullah Zisan's explicit 2026-07-27 instruction to continue the next required CDB work and approval to proceed  
**Production mutation authorized by this design:** no  
**Provider flag activation authorized by this design:** no  
**Route or Worker traffic change authorized by this design:** no  
**Canonical-mode promotion authorized by this design:** no

## 1. Objective

CDB-113G establishes the first production-facing evidence step after local identity/episode read-promotion verification. It runs a tightly bounded, aggregate-only, read-only observation against the verified production D1 database for tenant `100`.

The observation measures whether the five reviewed provider families have deterministic canonical relationship and source-mapping evidence without returning patient, practitioner, appointment, encounter, admission, bed, or occupancy records.

The checkpoint must not enable any provider feature flag, wire an operational route, deploy a Worker, alter traffic, write a reconciliation row, apply a migration or backfill, retire a reader or writer, or claim canonical promotion readiness.

## 2. Considered approaches

### Approach A — Enable tenant shadow flags immediately

This would switch one or more provider flags to `shadow` and depend on live operational traffic.

Rejected for the first production step because:

- the selected adapters are library boundaries and operational routes have not yet been deliberately wired;
- flag mutation would create production state before a protected observation contract exists;
- the current evidence does not yet prove production mapping completeness;
- rollback and stop conditions would depend on unmeasured live behavior.

### Approach B — Aggregate-only production read probe

Run exact allowlisted `SELECT`/`WITH` queries against the verified production D1 database. Return only counts and classifications, require `changed_db=false` and `rows_written=0`, and store protected evidence outside the repository.

Selected because it gives current production truth with no flag, route, deployment, traffic, schema, or data mutation.

### Approach C — Deploy a candidate Worker and run zero-traffic or low-traffic canary

This can measure real route behavior, but it introduces deployment identity, route fingerprint, authenticated request, traffic, and rollback requirements.

Deferred until the read-only production evidence is clean and a separate shadow-canary authorization is issued.

## 3. Exact scope

### Database and tenant

- database name: `hms-super-admin-production-apac`;
- database UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`;
- environment: `production`;
- access mode: remote read-only;
- tenant: `100` only.

### Provider and consumer scope

| Provider family | Consumer ID | Feature flag |
|---|---|---|
| patient identity | `cdb113f_patient_detail` | `canonical_patient_identity_provider_v1` |
| practitioner | `cdb113f_practitioner_detail` | `canonical_practitioner_provider_v1` |
| appointment | `cdb113f_appointment_detail` | `canonical_appointment_provider_v1` |
| encounter | `cdb113f_encounter_detail` | `canonical_encounter_provider_v1` |
| admission/bed | `cdb113f_admission_detail` | `canonical_admission_bed_provider_v1` |

All five feature flags must remain disabled. The observation reads flag state only to prove that no activation occurred.

## 4. Authorization boundary

The observation accepts one protected JSON authorization file located outside the repository.

The file must:

- be a regular file, not a symlink or hard link;
- use mode `600`;
- be located directly inside a mode-`700` directory;
- identify schema version `1`;
- identify the exact production database name and UUID;
- name tenant `100`;
- contain exactly the five reviewed provider/consumer/flag triples;
- authorize only `read_only_controlled_probe`;
- explicitly prohibit provider flag changes, route changes, traffic changes, deployment, migration, backfill, data mutation, local-sync activation, retirement, push, and CDB-to-main integration;
- define issuance, observation start/end, and expiry timestamps;
- define thresholds and accepted exception IDs;
- identify Rahmatullah Zisan as the approving owner;
- bind the CDB-113F implementation and metadata commits `561a34a1b` and `3427268c8` plus the reviewed main-sync merge created immediately before CDB-113G.

A broad approval is narrowed by this checkpoint to read-only observation. It is not interpreted as permission for any later mutation or promotion stage.

## 5. Observation data model

The collector executes one aggregate query per measured iteration. The query returns exactly five rows, one per provider family.

Each row contains only:

- provider family;
- source row count;
- mapped source count;
- missing mapping count;
- duplicate active mapping count;
- invalid canonical target count;
- cross-tenant relationship count;
- unresolved critical processing-issue count relevant to the provider family;
- enabled provider flag count;
- canonical-mode provider flag count.

The query must not select or emit:

- names;
- phone or mobile numbers;
- email or address;
- UHID or national identifiers;
- source IDs or canonical public IDs;
- appointment times or notes;
- clinical narrative, diagnosis, observations, results, reports, or signed content;
- admission, bed, or location labels;
- billing, payment, deposit, compensation, price, or amount values;
- credentials, tokens, cookies, headers, environment values, or raw Wrangler output.

## 6. Measurement procedure

1. Validate the protected authorization fully offline.
2. Verify the selected workspace is clean and contains the required CDB-113F commits.
3. Run `wrangler d1 info` and require exact production database name and UUID.
4. Run one unmeasured warm-up aggregate query.
5. Run five measured aggregate query iterations.
6. For every D1 envelope require:
   - `success=true`;
   - exactly five result rows;
   - one unique row for every authorized provider;
   - `meta.changed_db=false`;
   - `meta.rows_written=0`.
7. Record query duration from aggregate D1 metadata only; do not retain raw command output.
8. Calculate p95 and maximum query duration from the five measured iterations.
9. Evaluate provider counts and thresholds.
10. Write the full protected evidence pack outside the repository with mode `600`.
11. Print only an aggregate receipt to stdout.

## 7. Thresholds

The initial read-only observation uses these fail-closed thresholds:

- measured iteration count: exactly `5`;
- provider row count per iteration: exactly `5`;
- command failures: `0`;
- provider flag enabled count: `0` for every provider;
- canonical-mode flag count: `0` for every provider;
- rows written: `0`;
- changed database envelopes: `0`;
- duplicate active mapping count: `0`;
- invalid canonical target count: `0`;
- cross-tenant relationship count: `0`;
- unresolved critical processing-issue count: `0`;
- p95 D1 query duration: at most `250 ms`;
- maximum D1 query duration: at most `500 ms`;
- accepted exception IDs: empty for the initial observation.

Missing mapping is measured and reported. It is a production-readiness blocker but does not invalidate the evidence pack itself. A provider can therefore produce valid read-only evidence with `observationReady=true` and `promotionReady=false` when mapping completion is incomplete.

This distinction prevents incomplete production backfill from being hidden while preserving a trustworthy observation record.

## 8. Result semantics

The collector returns three separate decisions:

- `evidenceReady`: authorization, identity, read-only boundary, schema, privacy, and chronology all passed;
- `observationReady`: `evidenceReady` plus zero command, duplicate, invalid-target, cross-tenant, critical-issue, flag-state, and latency failures;
- `promotionReady`: always `false` in CDB-113G.

Missing mappings are reported as provider blockers. They must be resolved through separately reviewed production backfill/reconciliation work before any provider shadow canary.

## 9. Protected evidence

The protected evidence file contains:

- normalized authorization snapshot hash;
- database identity hash;
- CDB-113F commit bindings;
- observation timing;
- five aggregate provider rows from the final iteration;
- stable count consistency across all measured iterations;
- measured duration list, p95, and maximum;
- issue codes;
- evidence, observation, and promotion decisions;
- explicit safety booleans;
- SHA-256 of the normalized evidence body.

It must not contain raw IDs, table row samples, SQL output, file paths, command lines, secrets, or PHI.

The stdout receipt contains only schema version, provider count, measured iteration count, issue count, mapping-blocker count, latency summary, decision booleans, network-request status, mutation status, and rows written.

## 10. Failure and rollback behavior

The collector is read-only, so rollback means stopping immediately and retaining legacy runtime state.

It must fail before or during execution when:

- authorization is absent, expired, malformed, over-broad, or not protected;
- repository commit binding is stale;
- database identity differs;
- any command contains a non-read operation;
- Wrangler reports a write or changed database;
- result shape is missing, duplicated, or unexpected;
- provider flags are enabled;
- sensitive fields appear in normalized evidence;
- query duration exceeds thresholds;
- output location is inside the repository or has unsafe permissions.

No compensating database action is required because no mutation is allowed.

## 11. Testing strategy

### Authorization tests

- complete protected authorization passes;
- missing or unknown fields fail;
- broad permissions fail;
- wrong tenant/provider/consumer/flag fails;
- stale commit binding fails;
- expired or invalid chronology fails;
- symlink, hard link, wrong directory mode, wrong file mode, or repository-contained file fails.

### Collector tests

- exact production identity and five successful aggregate rows pass;
- wrong database identity fails before aggregate query;
- any non-zero command exit fails;
- writes or changed database fail;
- malformed, duplicate, missing, or unknown provider rows fail;
- inconsistent counts across measured iterations fail;
- enabled/canonical flags fail;
- duplicate, invalid-target, cross-tenant, and critical-issue counts fail observation readiness;
- missing mapping blocks promotion but preserves valid evidence;
- latency threshold breach fails observation readiness;
- evidence output is protected and aggregate-only.

### Privacy tests

Recursive sensitive-key rejection covers patient, practitioner, clinical, operational label, financial, secret, raw output, SQL, command, environment, path, UUID, source ID, and canonical ID fields.

## 12. Verification and checkpoint completion

CDB-113G local implementation completion requires:

- focused authorization and collector tests;
- complete canonical test suite;
- TypeScript;
- canonical governance;
- migration manifest generation;
- local-sync and legacy-retirement readiness reports;
- worktree policy;
- clean checkpoint commits;
- updated tracker, control center, handoff, receipt, and continuity contracts.

Production read-only execution may occur only after the local tooling is verified and the protected authorization file validates. Its execution receipt must clearly state that no mutation, flag change, route change, deployment, traffic change, retirement, push, or main integration occurred.

## 13. Explicitly excluded work

CDB-113G does not:

- enable `shadow` or `canonical` provider mode;
- add provider calls to operational routes;
- deploy or create a Worker version;
- change traffic;
- authenticate or replay user requests;
- run a migration or backfill;
- write canonical reconciliation receipts into production;
- fix missing mappings automatically;
- retire any legacy reader or writer;
- activate local synchronization;
- authorize a later shadow canary or canonical promotion.

## 14. Production schema-preflight amendment

The verified collector performs an aggregate-only schema inventory immediately after exact D1 identity verification and before the provider aggregate query. The schema inventory is itself an allowlisted `SELECT` over `sqlite_schema`, requires `changed_db=false` and `rows_written=0`, and returns only reviewed table names.

If any required authority table is missing, the collector:

- writes protected schema-blocker evidence;
- reports `schemaReady=false` and `observationReady=false`;
- keeps `evidenceReady=true` when identity, authorization, output protection, and read-only boundaries pass;
- does not execute the provider warm-up or measured aggregate queries;
- keeps promotion, flags, routes, traffic, deployment, migration, backfill, sync, and retirement blocked.

The authorized production run found 17 of 21 required tables. The missing authorities are:

- `canonical_tenant_patient_links`;
- `canonical_appointments`;
- `canonical_admissions`;
- `canonical_beds`.

This is current production truth for the observation window, not authorization to apply the corresponding migrations or backfills.

## 15. Exact next decision after CDB-113G

Because required production schema is incomplete, the next checkpoint is `CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION`.

CDB-113H must remain non-mutating. It must reconcile migration availability, dependency order, current production migration state, bounded backfill prerequisites, verification equations, rollback evidence, and exact future mutation authorization. No flag or route canary may begin until the four missing authorities exist and their relevant mappings reconcile cleanly.

# CDB-V1-070 All-Tenant Legacy-Primary Shadow Rollout Plan

**Date:** 2026-07-30  
**Branch:** `program/cdb-main-continuous-20260725`  
**Production database:** `hms-super-admin-production-apac` (`c68a5360-a2c1-44cc-9e71-f21057bea102`)  
**Availability model:** zero-downtime; Legacy remains the user-visible read/write authority throughout this checkpoint  
**Production mutation status:** not executed

## Change trigger

The owner selected an all-active-tenant shadow rollout instead of a one-tenant read-only canary. The intended behaviour is:

- Legacy remains available and authoritative for every user;
- Canonical providers execute in shadow mode for every active tenant;
- users continue receiving Legacy responses;
- Canonical parity evidence is collected continuously and reconciled daily;
- no Canonical read or write promotion occurs during this checkpoint;
- any shadow problem is isolated from the user request and the exact provider flags can be disabled immediately.

## Live read-only preflight findings

Production was queried only through aggregate/read-only commands on 2026-07-30.

1. Active tenants are `1`, `100`, `101`, and `102`.
2. `canonical_financial_dual_write_v1` is already enabled in non-blocking shadow mode for all four active tenants; the existing validator returned `activationReady=true`, issue count `0`, and rows written `0`.
3. All nine reviewed read-provider flags are absent for all four active tenants. The provider-scope validator returned `activationReady=false` with nine incomplete-provider issues and rows written `0`.
4. Production currently runs Worker version `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71`, built from `f11f09f3526ea453632951455c73c727568dbfdb`.
5. Production has 29 pending migrations from `0541` through `0570` (with `0562` reserved/absent). Twenty-seven are additive. `0548_canonical_encounter_admission_bed_convergence.sql` and `0549_approval_revision_policy.sql` perform data-preserving SQLite table rebuilds using copy/replace/drop sequences. They are not pure additive migrations and require exact row-parity evidence, explicit table-rebuild authorization, a bounded exclusive-lock budget, protected backup/Time Travel evidence and post-apply integrity verification before execution.

## Exact shadow provider scope

The all-tenant shadow activation covers only these providers:

1. `canonical_invoice_provider_v1`
2. `canonical_payment_provider_v1`
3. `canonical_deposit_provider_v1`
4. `canonical_patient_identity_provider_v1`
5. `canonical_practitioner_provider_v1`
6. `canonical_appointment_provider_v1`
7. `canonical_encounter_provider_v1`
8. `canonical_admission_bed_provider_v1`
9. `canonical_compensation_accrual_provider_v1`

Every generated flag configuration explicitly binds:

- `mode = shadow`;
- `is_enabled = 1`;
- `readPolicy = shadow`;
- `responseAuthority = legacy`;
- one exact tenant ID in `tenantScope`.

## Protected execution authorization prerequisite

`CDB-V1-070A-ALL-TENANT-SHADOW-EXECUTION-AUTHORIZATION-CONTRACT-READY` prepares the repository contract but does not execute the rollout. The committed sanitized package must remain non-executable and bind the exact four tenants, 29 migrations, four backfills, nine providers, 36 expected flag rows, ten phases, zero-tolerance acceptance, immediate provider/Worker rollback, and a minimum 4,320-minute observation window.

A separate protected JSON authorization outside the repository must bind the exact integrated `main` candidate, production database, current active-tenant evidence, Time Travel bookmark, protected export, candidate and previous Worker versions, owners, single-operator risk acceptance, thresholds, exact scope, and deterministic confirmation tokens. Generic continuation approval is insufficient.

No phase below may start until:

- the sanitized repository package reports `packageReady=true`;
- the protected authorization reports `documentReady=true` and `executionReady=true`;
- the package and authorization bind the same candidate, migration manifest, tenant set, provider set, and rollback target;
- all broader permissions remain false.

## Zero-downtime execution order

### Phase 1 — Candidate integration and deployment

- integrate the reviewed CDB candidate into a clean current `main`;
- run full verification and build;
- deploy the candidate while all new provider flags remain absent or Legacy-default;
- retain the previous Worker version as the immediate traffic rollback target;
- verify normal health and Legacy workflows before any database change.

### Phase 2 — Protected schema convergence

- bind the exact production database identity and current candidate Worker version;
- capture a current D1 Time Travel bookmark and protected export evidence;
- verify the exact 29-migration ordered set and hashes;
- apply the migrations without a user-facing write freeze;
- require zero pending migrations after apply;
- verify foreign keys, integrity, Legacy smoke workflows, error rate, and latency.

This is a controlled change window, not a downtime window. Legacy traffic remains active.

### Phase 3 — Bounded all-tenant backfill

- run the approved patient, practitioner, appointment, encounter/admission/bed and related protected-core backfills tenant by tenant in small resumable batches;
- keep Legacy as the source authority;
- run a mandatory second pass and require zero unexplained new business rows;
- record mapping ambiguity, cross-tenant references, provider errors, and failed rows as processing issues instead of guessing.

### Phase 4 — Pre-activation reconciliation

For every active tenant, require:

- source and Canonical row-key coverage within the approved scope;
- zero unexplained financial variance in integer minor units;
- zero mapping ambiguity;
- zero cross-tenant reference;
- zero foreign-key violation;
- all required Legacy smoke workflows passing.

### Phase 5 — All-tenant provider shadow activation

- execute one exact all-active-tenant upsert for the nine reviewed flags;
- preserve Legacy response authority;
- verify 36 expected flag rows for the current four active tenants;
- require `missing_count=0`, `non_shadow_count=0`, and `shadow_enabled_count=active tenant count` for every provider;
- if verification fails, immediately run the exact disable-only rollback for the nine reviewed provider keys.

### Phase 6 — Observation and daily comparison

- collect provider reconciliation evidence continuously;
- produce a tenant/provider daily summary for missing rows, status mismatch, amount mismatch, mapping ambiguity, provider error, latency, and retry backlog;
- keep Canonical response and write promotion prohibited;
- disable the affected provider shadow flag when a threshold is breached while Legacy continues serving users.

## Explicit exclusions

This checkpoint does not authorize:

- Canonical user-visible reads;
- Canonical primary writes;
- Legacy reader or writer retirement;
- destructive schema changes;
- local-sync activation;
- deployment or migration against an unbound candidate;
- silent acceptance of a non-zero unexplained variance.

## Exit criteria

CDB-V1-070 shadow activation is complete only when:

- the exact reviewed Worker is at production traffic;
- all exact migrations are applied and verified;
- all approved backfills are second-pass stable;
- pre-activation reconciliation passes;
- all nine provider flags are active in shadow mode for every active tenant;
- Legacy remains the selected user-visible authority;
- protected aggregate evidence confirms zero activation issues;
- immediate flag rollback and Worker rollback remain available.

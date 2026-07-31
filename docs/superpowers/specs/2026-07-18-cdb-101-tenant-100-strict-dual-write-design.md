# CDB-101 Tenant-100 Strict Financial Dual-Write Design

Date: 2026-07-18

## Goal

Keep the Demo Hospital frontend and user-facing reports on the legacy authority while making tenant `100` financial mutations update the legacy and canonical models atomically. Before strict dual-write activation, incrementally backfill the missing tenant-100 historical financial facts and prove exact legacy/canonical parity.

The design deliberately fails a tenant-100 user operation when its canonical projection cannot be committed. Every other tenant remains legacy-only and must not fail because of canonical behavior.

## Existing Work Reused

This work does not repeat the completed CDB-101 foundation:

- canonical migrations `0505` through `0515` already applied to production D1;
- the existing tenant-100 canonical import and verified zero-write second pass;
- canonical practitioner, encounter, admission, bed-stay, service-catalog, service-request, service-event, and service-participant data;
- active financial FK repair evidence;
- existing canonical commands, source mappings, outbox, processing issues, reconciliation support, and reporting routes;
- existing guarded production wrappers, protected evidence controls, and zero-traffic Worker candidate preparation.

Before any later production mutation, the implementation must revalidate this state read-only. A drifted production state stops progression rather than causing a full re-import.

## Confirmed Gap

The current production canonical foundation is not a live dual-write system. The tenant-100 canonical financial baseline is missing: canonical invoices, payment receipts, and live outbox events were observed at zero, and the reporting shadow flag was absent. Therefore the remaining work is limited to:

1. incremental tenant-100 financial backfill and reconciliation;
2. tenant-100-only strict dual-write integration;
3. guarded deployment, activation, observation, and rollback.

## Scope

The first strict financial slice covers facts required by the approved reporting comparison:

- invoices/bills and invoice lines;
- payment receipts, tenders, and allocations;
- deposits and deposit applications;
- credit notes;
- refunds and payment reversals;
- practitioner/service compensation facts derived from the same financial events;
- the source mappings, idempotency facts, processing issues, outbox records, and accounting posting jobs required by those canonical commands.

The legacy frontend, legacy report responses, public navigation, and all non-tenant-100 write behavior are unchanged.

## Non-Goals

This slice does not:

- promote canonical reads to user-facing authority;
- change Worker traffic merely because a candidate exists;
- modify or delete legacy financial facts during backfill;
- re-import already-sealed non-financial canonical facts;
- enable strict dual-write for another tenant;
- silently fall back to legacy-only behavior while tenant-100 strict mode is enabled;
- retire any legacy tables or routes.

## Considered Approaches

### Selected: historical baseline plus atomic strict dual-write

Incrementally backfill the missing financial baseline, prove exact parity, then write both models in the same bounded D1 batch. This meets the requirement that tenant-100 operations expose canonical defects immediately without affecting other hospitals.

### Rejected: two independent synchronous writes

Writing legacy first and canonical second in separate transactions can leave split authority when the second write fails. Compensating afterward would weaken the requested strict guarantee.

### Rejected for tenant-100: asynchronous projection

An outbox/Queue projector is the safer future default for live hospitals because canonical failure does not block care or revenue operations. It is not selected for tenant `100` because the owner explicitly wants the Demo Hospital request to fail when canonical projection is defective.

## Tenant Isolation and Authority

Strict write authority uses a dedicated canonical flag separate from reporting-read authority:

- flag key: `canonical_financial_dual_write_v1`;
- tenant: exactly `100`;
- domain: `financial`;
- enabled database mode: exactly `shadow`;
- `config_json.writePolicy`: exactly `strict`;
- `config_json.tenantScope`: exactly `["100"]`;
- canonical read authority: unchanged and still controlled separately;
- canonical promotion: not authorized by this design.

The coordinator resolves the authenticated tenant before canonical flag work. When the tenant is not `100`, it immediately uses the existing legacy path and does not query the strict flag or construct a canonical mutation. A missing or disabled strict flag also preserves the existing legacy-only path.

The existing feature-flag schema is reused without a migration: `strict` is the write policy inside valid JSON configuration, not a new database `mode` value. When tenant `100` strict mode is enabled, a flag lookup error or malformed/mismatched strict configuration is fail-closed. It must not be interpreted as permission to write legacy-only.

## Components

### Incremental financial backfill builder

The builder reads a tenant-100 production export or authorized read-only source at a fixed cutoff `T0`. It reuses the existing canonical mapping and command semantics to produce a deterministic, DML-only incremental bundle for the missing financial target tables.

It must:

- scope every source and target fact to tenant `100`;
- preserve monetary values as integer minor units;
- create deterministic public IDs, idempotency keys, and source mappings;
- refuse cross-tenant references, unsafe amounts, duplicate mappings, missing required parents, or unsupported statuses;
- avoid updates or deletes to legacy tables;
- avoid rewriting already-matching canonical facts;
- emit a manifest with ordered target tables, row counts, source cutoff, source hash, bundle hash, and deterministic run ID.

### Baseline reconciler

The reconciler compares legacy and canonical aggregates at the same cutoff and normalization rules. It produces aggregate evidence plus non-PHI source identifiers for any mismatch.

Activation requires exact equality for:

- record counts by entity and normalized status;
- invoice gross, discount, net, paid, credited, refunded, and outstanding amounts;
- receipt/tender and payment-allocation totals;
- deposit received, applied, reversed, and remaining amounts;
- credit-note, refund, and payment-reversal totals;
- practitioner/service reporting totals;
- one-to-one source mappings and public IDs;
- allocation conservation and currency consistency;
- tenant isolation;
- unresolved critical processing issues;
- blocked outbox and accounting jobs.

There is zero unexplained amount tolerance. Expected semantic differences must be normalized deterministically or resolved before activation; they are not waived as unexplained variance.

### Strict dual-write coordinator

The coordinator is a small domain service used by the selected financial write boundaries. It accepts validated legacy statements and an existing canonical command plan. For enabled tenant-100 strict mode it executes, in one D1 batch/transaction:

1. the authoritative legacy mutation;
2. the matching canonical domain mutation;
3. deterministic source mapping and idempotency records;
4. canonical outbox and reconciliation markers;
5. accounting posting job creation when required by the existing command.

The request handler remains responsible only for authentication, authorization, input validation, coordinator invocation, and response mapping. It must not duplicate financial mapping logic.

### Evidence and reconciliation receipts

Receipts contain tenant, operation class, source/public identifiers or hashes, counts, integer amounts, timestamps, result codes, and run IDs. They exclude patient names, clinical text, credentials, tokens, and raw financial rows.

## Backfill Data Flow

1. Capture and hash the authorized tenant-100 legacy source at cutoff `T0`.
2. Run read-only preflight against current canonical tables, source mappings, processing queues, and tenant isolation.
3. Build the deterministic incremental financial bundle and manifest offline.
4. Validate statement policy, tenant scope, hashes, table allowlist, row counts, and authorization before the first remote write.
5. Import only missing canonical financial facts.
6. Run the same importer a second time and require zero new rows.
7. Run exact legacy/canonical reconciliation at `T0`.
8. Seal the baseline evidence. Any mismatch blocks deployment/activation progression.

## Live Write Data Flow

1. Authenticate and authorize the existing request.
2. Resolve tenant ID before strict-mode evaluation.
3. For tenants other than `100`, use the unchanged legacy path.
4. For tenant `100` with the strict flag disabled/absent, use the unchanged legacy path.
5. For tenant `100` with strict mode enabled, validate and construct both legacy and canonical plans before mutation.
6. Execute both plans and their evidence records atomically.
7. Return the existing successful legacy response shape when the batch commits.
8. Return a safe canonical strict-write failure response when the batch rolls back.

The frontend does not receive or render canonical report data in this stage.

## Failure Handling

Any canonical validation, mapping, constraint, allocation-conservation, accounting-job, or batch failure in tenant-100 strict mode rolls back both legacy and canonical mutations. No partial success is reported.

The response uses the stable non-sensitive error code `CANONICAL_STRICT_WRITE_FAILED` and the existing safe user-facing error envelope. Detailed diagnostics are limited to protected evidence with tenant ID, operation type, source/public ID or hash, stage, and failure code.

There is no automatic legacy-only fallback while strict mode is enabled, because fallback would hide the condition this Demo Hospital stage is intended to expose.

An operator may use the guarded kill switch to disable the tenant-100 strict flag. After verified disablement, new operations return to legacy-only behavior. Disabling the flag does not delete or reverse committed canonical facts. Any subsequent reactivation requires fresh parity and queue checks.

## Activation Gates

Strict activation is allowed only when all of the following are current and clean:

- production identity and tenant scope;
- canonical migration state;
- protected export/recovery evidence;
- active FK repair and archival disposition evidence;
- incremental financial bundle and manifest validation;
- exact post-import counts and zero-write second pass;
- exact baseline reconciliation at `T0`;
- zero unresolved critical processing issues;
- zero blocked canonical outbox/accounting jobs;
- focused, canonical, backend-regression, typecheck, and production-build verification;
- candidate deployment and authenticated tenant-100 smoke evidence;
- explicit tenant-100 strict-flag authorization and rollback readiness.

The reporting shadow flag remains a separate later decision. Strict-write activation alone does not change user-facing reporting.

## Testing

Implementation follows RED-GREEN-REFACTOR with focused commits.

### Unit tests

- exact tenant-100 flag semantics and non-tenant bypass;
- deterministic IDs, mappings, and idempotency keys;
- integer-minor-unit calculations and amount conservation;
- status normalization and unsupported-state refusal;
- safe error and evidence redaction.

### Integration tests

- tenant-100 strict success commits legacy and canonical facts together;
- injected canonical failure rolls back the legacy mutation;
- injected legacy failure leaves canonical unchanged;
- duplicate retry is idempotent and creates no duplicate financial fact;
- missing/disabled flag preserves tenant-100 legacy-only behavior;
- every non-tenant-100 path remains legacy-only even when tenant-100 strict mode is enabled;
- source mapping, outbox, and accounting jobs share the transaction boundary.

### Backfill and reconciliation tests

- existing non-financial canonical facts remain unchanged;
- deterministic bundle and manifest output;
- exact target allowlist and tenant scope;
- second import pass writes zero rows;
- count, amount, allocation, status, currency, and source-mapping parity;
- any unexplained variance blocks readiness;
- receipts remain aggregate-only and PHI-free.

### Regression and build verification

- focused financial route tests;
- canonical suite;
- relevant backend suite;
- TypeScript/typecheck;
- production build;
- authenticated candidate smoke before flag activation.

## Rollout and Observation

Deployment preserves legacy Worker traffic until the verified candidate is ready. Activation changes only the tenant-100 strict write flag; it does not promote canonical reads or widen tenant scope.

After activation, monitoring compares legacy and canonical counts and monetary totals from `T0`, checks strict-write failure codes, queue/accounting state, tenant isolation, latency, and user-facing legacy report health. Any unexplained mismatch, partial-state evidence, tenant leakage, or repeated strict failure is `NO_GO` and triggers guarded flag disablement.

## Acceptance Criteria

The slice is complete only when:

1. tenant-100 historical financial canonical facts match the legacy baseline exactly at `T0`;
2. a second incremental import produces zero new rows;
3. tenant-100 strict success and forced-failure rollback are proven;
4. other tenants are proven unchanged and legacy-only;
5. the frontend and user-facing reports remain legacy-authoritative;
6. production activation is backed by protected aggregate evidence and a verified kill switch;
7. no completed morning migration, import, FK repair, or non-financial canonical fact was repeated or overwritten.

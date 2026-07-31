# CDB-V1-030B2 Compensation Rule Route Integration

**Checkpoint:** `CDB-V1-030B2-COMPENSATION-RULE-ROUTE-INTEGRATION`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Reviewed:** 2026-07-28  
**Production access or mutation performed:** no

## Result

The two protected practitioner-compensation-rule writers now execute through the frozen Canonical command boundary while retaining their reviewed HTTP and legacy compatibility behaviour:

- `src/routes/tenant/commissions.ts` / `doctor_commission_rules`;
- `src/routes/tenant/billingMaster.ts` / `diagnostic_performer_payout_rules`.

Shared route integration is implemented at:

- `src/lib/canonical/compensation-rule-route-integration.ts`;
- `src/lib/canonical/contracts/manage-compensation-rule.ts`.

The routes use:

- `createCompensationRule`;
- `replaceCompensationRule`;
- `retireCompensationRule`.

The deterministic writer coverage now classifies both protected route writers as `atomic_compatibility`, reducing `command_required` from 63 to 61 without any unknown or unclassified writer.

## Stable legacy identity

Migration `0561_compensation_rule_route_identity.sql` adds nullable `doctor_commission_rules.canonical_source_key` and a partial unique index over `(tenant_id, canonical_source_key)`.

- new POST operations create a stable route source key before the auto-increment row ID exists;
- a supplied `Idempotency-Key` produces a deterministic tenant-scoped source key;
- requests without a supplied key receive a new non-PHI UUID source key;
- old rows remain unchanged and continue to use their exact numeric legacy ID as the source fallback;
- PUT adopts the numeric legacy ID as `canonical_source_key` atomically when an old row has no key;
- the migration performs no existing-row rewrite.

The generated schema migration manifest now contains 496 conforming migrations.

## Doctor commission rule routes

### Create

`POST /api/commissions/doctor-rules` commits in one D1 batch:

1. Canonical outbox/idempotency claim;
2. legacy `doctor_commission_rules` insert with stable source key;
3. audit row;
4. missing exact practitioner/service references and mappings;
5. immutable Canonical rule version 1;
6. compensation-rule source mapping.

The route resolves the legacy numeric ID by the exact `(tenant_id, canonical_source_key)` tuple after commit and preserves the existing `201` response envelope.

### Replace

`PUT /api/commissions/doctor-rules/:id` reads the exact tenant-scoped source row and builds complete current and next snapshots. The legacy update, source-key adoption, audit, reference bootstrap, immutable replacement version and outbox evidence commit atomically.

When no Canonical history exists for an old legacy row, the command writes the exact current legacy snapshot as version 1 and the requested replacement as version 2 in the same batch. No heuristic backfill or non-atomic pre-step is used.

### Retire

`DELETE /api/commissions/doctor-rules/:id` preserves the existing physical legacy deletion and HTTP response while appending an immutable Canonical retired version in the same batch. When Canonical history is absent, the current source snapshot is first recorded as version 1 and retirement is appended as version 2.

## Diagnostic performer payout route

`PUT /api/billing-master/service-items/:id/performer-payout-rule` now treats the tenant billing service item ID as the exact logical rule source identity.

- first enabled rule: legacy insert plus Canonical create;
- later enabled version: close previous legacy row, insert new row and append Canonical replacement;
- disable: close the legacy version without deleting history and append Canonical retirement;
- unchanged same-date request: preserves the existing no-write response;
- invalid/non-increasing effective dates preserve existing validation behaviour.

The exact billing service mapping is reused when present. Otherwise the deterministic service public ID, Canonical service row and exact source mapping are created in the same command batch.

## Identity and money rules

- practitioner identity derives only from `(tenant, legacy_doctor, doctor_id)` or its exact existing mapping;
- doctor-rule identity derives only from `(tenant, legacy_doctor_commission_rule, canonical_source_key|legacy_id)`;
- diagnostic performer-rule identity derives only from `(tenant, legacy_diagnostic_performer_rule, billing_service_item_id)`;
- lab and billing service identity uses exact source IDs or exact existing mappings;
- names, labels, timestamps and numeric similarity are never used to merge identities;
- percentage values remain integer basis points;
- fixed values convert exactly to integer minor units;
- `full_earned` protects zero;
- `protected_floor` protects the exact configured floor;
- `no_doctor_waiver` protects the complete rule rate;
- immutable rule versions are never updated or deleted.

`src/lib/canonical/live-doctor-compensation.ts` and `src/lib/lab-finance.ts` now consume `canonical_source_key` when present, preserving the same rule public ID between route configuration and later compensation accruals. Old rows retain the exact numeric-ID fallback.

## Replay, rollback and fail-closed behaviour

- exact tenant/idempotency replay returns the prior command result;
- a changed request under the same key conflicts;
- current-version checks guard replacement and retirement;
- missing Canonical history requires an explicit complete source snapshot;
- missing references require exact bootstrap evidence;
- mapping conflicts fail closed;
- any legacy, audit, reference, mapping, rule or outbox failure rolls back the complete D1 batch;
- route response status/messages remain compatible;
- no provider or feature flag was activated.

## Verification

Focused verification:

```text
pnpm vitest run \
  test/canonical/compensation-rule-route-identity-schema.test.ts \
  test/canonical/compensation-rule-commands.test.ts \
  test/doctor-commission-routes.test.ts \
  test/integration/routes/diagnostic-performer-rules.test.ts \
  test/canonical/compensation-lifecycle.test.ts \
  test/canonical/build-migration-manifest-determinism.test.ts \
  test/canonical/protected-core-writer-command-coverage.test.ts
```

Result: **7 files / 48 tests / 0 failures**.

Additional gates:

- `pnpm exec tsc --noEmit` — passed;
- `pnpm canonical:check` — passed;
- migration manifest build — 496 migrations;
- unknown protected writers/readers — 0;
- unclassified protected writers — 0.

Deterministic protected state after integration:

- 875 classified surfaces;
- 218 writers;
- 462 readers;
- 107 Canonical-command writers;
- 43 atomic-compatibility writers;
- 3 governed-external writers;
- 61 command-required writers;
- 4 isolated fixtures;
- 17 remaining implementation groups.

## Next action

`CDB-V1-030C-PRACTITIONER-ROUTE-INTEGRATION`

Integrate the single protected `src/routes/tenant/doctors.ts` writer with the frozen practitioner identity and practitioner-account-link commands. Preserve doctor HTTP/UI compatibility and prove exact identity, account-link uniqueness, tenant isolation, replay/conflict, atomic audit/outbox, rollback and writer-coverage reduction.

No production database, runtime route, deployment, provider activation, traffic, production migration/backfill or live legacy retirement was accessed or changed.

# CDB-V1-030B1 Canonical Compensation Rule Commands

**Checkpoint:** `CDB-V1-030B1-CANONICAL-COMPENSATION-RULE-COMMANDS`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Reviewed:** 2026-07-28  
**Production access or mutation performed:** no

## Result

The frozen CDB-V1-020 compensation-rule command boundary is now implemented at:

- `src/lib/canonical/contracts/manage-compensation-rule.ts`
- contract: `test/canonical/compensation-rule-commands.test.ts`

Implemented frozen commands:

- `createCompensationRule`
- `replaceCompensationRule`
- `retireCompensationRule`

The Core V1 authority artifact now records **17 existing command boundaries** and **3 remaining contract-only command boundaries**. The authority owner, table set, command names, provider key, status vocabulary, money rules and retirement contract are unchanged.

## Command guarantees

### Exact identity and tenant scope

- every rule is tenant-scoped by `rulePublicId`;
- optional service and practitioner links require exact active Canonical rows in the same tenant;
- service, category and all-scope rules are mutually exclusive;
- source mapping uses the exact tuple `(tenant, compensation_rule, source_type, source_public_id)`;
- an existing source mapping may be reused only when it already maps to the same rule public ID;
- no label, practitioner name, specialty, timestamp or numeric-ID similarity is used.

### Money and rule validation

- fixed values and basis points are safe integers;
- basis points cannot exceed `10000`;
- protected-floor values are safe integers, cannot exceed the rule rate and must be zero for non-floor waiver policies;
- minimum and cap values are integer minor units;
- cap cannot be below minimum;
- effective dates are exact valid calendar dates and cannot be reversed;
- status is `active|inactive` for create/replace and `retired` only through the retire command.

### Immutable versioning

- create writes version `1` only when no rule exists;
- replace requires the exact current `expectedVersion` and appends `version + 1`;
- retire requires the exact current `expectedVersion` and appends a copied `retired` version;
- no historical compensation-rule row is updated or deleted;
- existing accruals continue to reference the exact immutable rule version snapshot.

### Atomicity, replay and rollback

Each command uses `runCanonicalBatch`:

1. the outbox/idempotency claim;
2. caller-supplied legacy compatibility statements;
3. the new Canonical rule version;
4. the source mapping when required;
5. the replay-safe result and non-PHI event evidence;

all commit in one D1 batch. Any failing compatibility or Canonical statement rolls back the complete batch.

Exact replay returns the original result. Reusing the same tenant/idempotency key with a changed request fails with an idempotency conflict. Replace and retire use optimistic current-version guards.

## Evidence

Focused verification:

```text
pnpm vitest run \
  test/canonical/compensation-rule-commands.test.ts \
  test/canonical/compensation-lifecycle.test.ts \
  test/canonical/protected-core-authority-contract-freeze.test.ts \
  test/canonical/protected-core-writer-command-coverage.test.ts
```

Result: **4 files / 25 tests / 0 failures**.

TypeScript:

```text
pnpm exec tsc --noEmit
```

Result: passed.

The deterministic authority and writer-coverage artifacts were regenerated. Protected writer classification remains:

- 216 total;
- 63 command-required;
- 0 unclassified.

This is expected because the two protected route writers have not yet been integrated with the new command boundary.

## Next action

`CDB-V1-030B2-COMPENSATION-RULE-ROUTE-INTEGRATION`

Integrate the exact legacy compensation-rule create/update/retire mutations in `src/routes/tenant/commissions.ts` and the relevant billing-master mutation surface into these commands using caller-supplied authoritative compatibility statements. Preserve current HTTP responses and prove:

- one compatibility plus Canonical batch;
- deterministic source/public IDs;
- minor-unit conversion without floating-point authority;
- exact replay and conflict behaviour;
- tenant isolation;
- rollback of both legacy and Canonical rows;
- writer-coverage reduction without any unclassified writer.

No production route, provider, flag, deployment, migration/backfill or legacy retirement was changed in this checkpoint.

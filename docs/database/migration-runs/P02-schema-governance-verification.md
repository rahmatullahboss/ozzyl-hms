# P02 Canonical Schema Governance Verification

**Task:** CDB-022 — Add architecture governance checks

**Date:** 2026-07-14

**Branch:** `task/cdb-022-schema-governance`

## Delivered governance gate

The canonical migration manifest now runs `assertSchemaGovernance()` before generating artifacts. The same gate is available directly through:

```text
pnpm canonical:check
```

Governance begins at migration `0423`. Earlier migrations remain historical legacy evidence and are not silently reclassified as canonical-compliant.

## Stable issue codes

The checker reports deterministic, sorted issues using these codes:

- `GOV_CANONICAL_REAL_MONEY`
- `GOV_TENANT_ID_REQUIRED`
- `GOV_GENERIC_REFERENCE`
- `GOV_DIRECT_LEGACY_WRITE`
- `GOV_DESTRUCTIVE_SQL_UNAPPROVED`
- `GOV_SCHEMA_REGISTRY_DRIFT`
- `GOV_DUPLICATE_MIGRATION_NUMBER`
- `GOV_METRIC_CONTRACT_MISSING`
- `GOV_LEGACY_ALLOWLIST_INCOMPLETE`
- `GOV_FINANCIAL_COMMAND_CONTRACT`
- `GOV_REGISTRY_INVALID`

## Canonical schema checks

The checker validates governed canonical migrations and Drizzle modules for:

- canonical migration tables registered in `canonical-source-of-truth.yaml`;
- registered tables created by governed migrations;
- schema modules present and exported through the canonical and root barrels;
- `tenant_id TEXT NOT NULL` on tenant-owned canonical tables;
- money-like `REAL` declarations in SQL and Drizzle `real()` declarations;
- generic `reference_id` declarations;
- quoted, unquoted, multiline, and one-line SQLite table declarations;
- duplicate governed migration numbers;
- duplicate or malformed canonical table registry contracts;
- canonical metric markers without a metric contract;
- registered financial commands without `runCanonicalBatch`, `idempotencyKey`, and event evidence.

## Destructive SQL checks

Governed migrations require an explicit filename-level approval with owner, removal phase, and reason before using:

- `DROP TABLE`, `DROP INDEX`, `DROP VIEW`, or `DROP TRIGGER`;
- destructive `ALTER TABLE` rename/drop-column operations;
- `TRUNCATE TABLE`;
- migration-level `DELETE FROM`.

Comments are removed before SQL classification so commented examples do not create approvals or bypasses.

## Legacy disposition and write allowances

`legacy-table-disposition.yaml` initially registers five high-risk legacy authorities:

- `bills`
- `invoice_items`
- `payments`
- `doctor_commission_accruals`
- `InventoryStockTransaction`

Every active source write to these tables requires an exact `(source path, table)` allowance. There are `52` current allowances. Each entry includes:

- exact existing source path;
- exact registered table;
- accountable owner;
- removal/cutover phase;
- reason.

The checker rejects:

- wildcard paths or tables;
- nonexistent paths;
- unknown tables;
- missing owner/removal phase/reason;
- duplicate allowance scopes;
- stale allowances whose path no longer contains the matching legacy write;
- any new unallowlisted direct write.

This is a bounded compatibility registry, not a blanket legacy exemption. As each domain cuts over, its allowances must be removed and the table disposition advanced toward `read_only`, compatibility view, archive, and retirement.

The direct-write scan is intentionally static and detects literal `INSERT`, `REPLACE`, `UPDATE`, and `DELETE FROM` statements in active `src` files. Dynamically generated table names remain prohibited and require code review because static governance cannot prove their target safely.

## Registry format

The `.yaml` registries contain JSON-compatible YAML. This keeps parsing deterministic without introducing a new runtime dependency while remaining valid YAML for other tooling.

## TDD and adversarial evidence

Initial RED:

- checker module did not exist;
- all governance fixtures failed to load.

Hardening RED runs proved and then closed these bypasses:

- one-line `CREATE TABLE` formatting;
- quoted money column identifiers;
- Drizzle-only `real()` money declarations;
- bulk `DELETE FROM` and `DROP VIEW` destructive SQL;
- table-level broad legacy write permission;
- stale exact write allowances;
- duplicate canonical registry contracts.

Fixture coverage includes valid and intentionally invalid repositories for every stable rule class.

## Verification

- focused governance tests: `9` passed;
- full canonical and migration-manifest tests: `11` files, `79` tests, `0` failures;
- `pnpm canonical:check`: `0` issues;
- governance-gated migration build: `433` conforming migrations;
- TypeScript: `0` errors;
- canonical tables registered: `8`;
- high-risk legacy tables registered: `5`;
- exact scoped write allowances: `52`;
- wildcard allowances: `0`;
- duplicate allowance scopes: `0`;
- nonexistent allowance paths: `0`.

## Database and deployment boundary

CDB-022 is repository governance only.

- migration `0423` was not applied to production;
- no production or rehearsal database was mutated;
- no Worker/application deployment occurred;
- no Git push or `main` merge occurred;
- no Time Travel restore or local-server activation occurred.

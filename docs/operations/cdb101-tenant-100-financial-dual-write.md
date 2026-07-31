# CDB-101 Tenant-100 Financial Dual-Write Runbook

## Purpose

Follow the original controlled migration sequence for tenant `100`:

1. fresh read-only production verification
2. protected export and bookmark
3. deterministic tenant-100 backfill
4. second-pass idempotency proof
5. aggregate financial reconciliation
6. strict dual-write activation
7. observation
8. separately authorized later read/write cutover

Every tenant except `100` must remain on the legacy financial path throughout this runbook.

## Non-negotiable boundaries

- Do not delete or mutate legacy financial rows during backfill.
- Do not import data for any tenant other than `100`.
- Do not enable strict mode unless every reconciliation variance and control is zero.
- Do not treat non-critical processing issues as invisible; retain them for follow-up even when aggregate activation controls pass.
- Do not promote canonical reads or canonical-only behavior as part of strict dual-write activation.
- A failed gate stops the sequence. Do not continue with partial evidence.

## Implemented scope

The tenant-100 deterministic bundle includes:

- practitioners and encounters needed by financial references
- service catalog, prices, requests and events
- historical invoice-item and header-only delivery evidence
- invoices and typed invoice lines
- explicit payments, tenders and allocations
- patient deposit receipts
- FIFO deposit applications and refunds
- historical paid-balance residual receipts
- credit, refund and compensation structures already supported by canonical backfill
- source mappings, processing issues, outbox and accounting posting jobs

The allowed import table list is defined only in:

`scripts/canonical/tenant-financial-import-contract.ts`

## Phase 1 — Protected source material

Required inputs must remain outside the repository:

- one production export or protected SQLite clone
- the matching source export file
- protected parent directory mode `700`
- protected files mode `600`
- source export hash and Time Travel bookmark evidence

A stale snapshot may be used for rehearsal only. Final production import requires a fresh snapshot captured immediately before the maintenance stage.

## Phase 2 — Build and rehearse

Use:

`pnpm canonical:prepare-tenant-financial-backfill -- --source-database [PROTECTED_SQLITE] --source-export [PROTECTED_EXPORT] --output-directory [EMPTY_PROTECTED_OUTPUT] --authorization-id [APPROVAL_ID] --deterministic-run-id [RUN_ID] --now-utc [UTC_TIMESTAMP]`

The command must report:

- `bundleReady: true`
- `firstPassCompleted: true`
- `secondPassCompleted: true`
- `secondPassNewRows: 0`
- `legacyRowsMutated: 0`
- tenant `100`
- the exact allowed table list
- bundle, manifest and source export SHA-256 values

The generated SQLite clone and bundle remain protected outside the repository.

## Phase 3 — Aggregate reconciliation

After importing the candidate bundle into the intended target, use:

`pnpm canonical:collect-tenant-financial-reconciliation -- --output [PROTECTED_RECONCILIATION_JSON] --second-pass-new-rows 0 --cutoff-utc [UTC_TIMESTAMP]`

The reconciliation authority follows the same rules as backfill:

- invoice gross and implicit discount come from active invoice items
- header-only bills use explicit historical delivery evidence
- paid authority is the greater of header paid authority and verified payment plus deposit-application authority, capped by invoice total
- missing historical collections are explicit residual receipts and allocations
- deposit receipt, application and refund totals are reconciled separately
- deposit refunds are not double-counted as payment refunds

Activation requires:

- every financial variance equals `0`
- `secondPassNewRows = 0`
- source mapping duplicates `0`
- cross-tenant rows `0`
- unresolved critical issues `0`
- blocked outbox `0`
- blocked accounting `0`

## Phase 4 — Strict dual-write evidence

The strict activation evidence must bind:

- tenant `100`
- operator identity
- production database identity
- clean candidate commit and Worker version
- protected source export hash
- deterministic baseline bundle hash
- reconciliation readiness
- tenant-101 legacy smoke result
- tenant-100 atomic dual-write smoke result
- rollback rehearsal result
- a current authorization window

Core validation and transition logic are implemented in:

`scripts/canonical/set-production-financial-dual-write-flag.ts`

The core accepts only these previous states:

- no flag
- disabled flag

An enabled canonical-only row is an unsafe previous state and must be handled through a separate verified rollback before strict activation is attempted.

It then requires an exact post-state:

- flag key `canonical_financial_dual_write_v1`
- domain `financial`
- mode `shadow`
- enabled `1`
- tenant scope exactly `["100"]`
- write policy exactly `strict`

The Cloudflare production gateway adapter is intentionally not embedded in this branch. It is the final restricted local-agent task. The adapter must only:

1. read and verify production D1 identity
2. read the current flag row
3. submit the SQL returned by `buildFinancialStrictFlagSql`
4. report one changed row
5. read and return the exact post-state

It must not choose SQL, tenant scope, policy, or fallback behavior.

## Phase 5 — Observation

During strict mode:

- supported financial mutations must commit legacy and canonical writes atomically
- unsupported tenant-100 boundaries must fail before mutation
- tenant `101` and every other tenant remain legacy
- record counts and money aggregates are compared at each observation cutoff
- any unexplained variance disables strict mode and returns tenant `100` to legacy

Do not promote canonical reads or retire legacy authority until:

- the required observation window completes
- supported workflow coverage is complete
- reconciliation remains zero
- canonical read/report paths are verified
- rollback and replay behavior are documented
- a separate owner-authorized cutover stage is approved

## Database retention

- Production D1: retain.
- Active staging D1: retain; its config must match the active UUID.
- Canonical rehearsal clone: retain until rollout and rollback observation are complete.
- Restore-drill clone: cleanup candidate only after final export/hash and restore evidence are archived and all script references are removed.
- Databases belonging to other projects are outside this cleanup scope.

# CDB-101 Tenant-100 Canonical-Only Cutover Design

> **SUPERSEDED — HISTORICAL ONLY.** On 2026-07-18 the owner selected the original strict dual-write migration plan and withdrew canonical-only activation. Do not implement or execute this design. Current authority: `docs/database/migration-runs/production/CDB-101-strict-dual-write-recovery-20260718.md`.

**Date:** 2026-07-18  
**Scope:** Demo Hospital tenant `100` only  
**Decision owner:** Rahmatullah Zisan  
**Status:** Withdrawn; retained as historical design context

## Goal

Activate canonical-only financial mutation behavior for tenant `100` without rebuilding the full dual-write program. Every other tenant remains on the existing legacy behavior.

This cutover is intentionally diagnostic. Tenant `100` may return explicit errors or expose incomplete workflows while canonical gaps are discovered. Production data for other tenants must not be affected.

## Selected Behavior

- Tenant `100` financial mutations do not execute authoritative legacy financial statements.
- A supported tenant-100 mutation executes its canonical command only.
- An unsupported tenant-100 financial boundary fails before any legacy financial mutation with a stable `409` error code.
- All non-100 tenants bypass the canonical flag read and continue to execute their existing legacy statements.
- Existing tenant-100 frontend and legacy read paths remain unchanged in this reduced scope.
- A newly created canonical record may therefore be absent from current legacy-backed UI lists, and a downstream workflow that requires a numeric legacy ID may fail. This is accepted diagnostic behavior.
- No migration, historical import, FK repair, or morning reporting work is repeated.

## Activation Contract

Use the existing `canonical_financial_dual_write_v1` tenant-scoped feature-flag row, but set an exact canonical-only policy:

```json
{
  "tenantScope": ["100"],
  "writePolicy": "canonical-only"
}
```

The runtime accepts the policy only when all of these fields match exactly:

- `tenant_id = "100"`
- `flag_key = "canonical_financial_dual_write_v1"`
- `domain = "financial"`
- `mode = "canonical"`
- `is_enabled = 1`
- `config_json` has only `tenantScope` and `writePolicy`

Malformed or cross-tenant policy state fails closed.

## Mutation Flow

For tenant `100`:

```text
auth + tenant validation
-> exact canonical-only flag resolution
-> canonical input projection
-> canonical command atomic batch
-> canonical response or stable diagnostic error
```

The route must not pass legacy statements into the canonical command. Unsupported routes call the boundary guard before sequence reservation, idempotency reservation, or financial mutation.

For every other tenant:

```text
existing auth + validation
-> existing legacy batch
-> existing legacy response
```

## Supported Initial Boundaries

The initial reduced cutover may execute canonical-only commands for boundaries whose canonical inputs can be formed without guessing:

- `billing.create`
- `billing.payment.collect` when the canonical invoice mapping exists
- `billing-counter.invoice.create` for credit-only creation without embedded payment or deposit deduction
- `deposit.collect` when complete canonical receipt authority is available
- `deposit.apply` when canonical deposit and invoice mappings exist
- `deposit.refund` when one canonical deposit can satisfy the refund exactly
- `credit-note.approve` when canonical invoice and line mappings exist

If any prerequisite is absent, the request fails explicitly. The implementation must not silently fall back to a tenant-100 legacy write.

## Errors and Observability

Stable client-safe errors:

- `CANONICAL_ONLY_PREREQUISITE_MISSING`
- `CANONICAL_ONLY_WRITE_FAILED`
- `CANONICAL_ONLY_BOUNDARY_UNSUPPORTED`
- `CANONICAL_ONLY_LEGACY_ID_UNAVAILABLE`

Responses contain no internal cause, request body, patient data, or financial row details. Monitoring records only tenant ID, boundary ID, stable code, timestamp, Worker version, and aggregate latency.

## Rollback

Rollback disables the exact tenant-100 flag row and verifies its after-state. With the flag disabled, tenant `100` immediately returns to the existing legacy mutation path. Canonical facts already written remain append-only evidence and are not deleted automatically.

## Verification

Before activation:

1. Focused policy, coordinator, command, projection, and boundary tests pass.
2. Existing non-100 route regressions pass.
3. TypeScript and production build pass.
4. A zero-traffic production candidate is uploaded and legacy remains at `100%` traffic.
5. Candidate smoke proves tenant `101` remains legacy-only.
6. Candidate smoke proves tenant `100` never executes a legacy financial statement in canonical-only mode.
7. The guarded flag enable and disable paths both succeed in rehearsal.

After activation, monitoring treats tenant-100 errors as expected discovery signals. Any cross-tenant effect, tenant-100 legacy financial mutation, partial canonical batch, or sensitive log output is an immediate rollback condition.

## Non-Goals

- No tenant-100 canonical frontend/read-path replacement in this cutover.
- No full dual-write implementation.
- No other-tenant canonical activation.
- No deletion of legacy or canonical history.
- No public Worker traffic migration to a new version until the candidate gates pass.

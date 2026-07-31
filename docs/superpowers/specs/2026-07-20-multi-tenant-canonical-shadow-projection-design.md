# Multi-Tenant Canonical Shadow Projection Design

## Goal

Allow every tenant with an exact tenant-scoped `canonical_financial_dual_write_v1` shadow flag to project supported financial transactions into canonical tables while preserving legacy writes as the production authority.

## Root Cause

`src/lib/canonical/live-financial-projection.ts` currently rejects every tenant except `100`. Tenant `102` therefore commits legacy billing successfully but records `CANONICAL_SHADOW_WRITE_FAILED` with a `RangeError` for every supported billing-counter shadow attempt.

## Design

1. Replace the tenant-100-only projection guard with a generic tenant identifier validator.
2. Accept only a non-empty, trimmed decimal tenant identifier representing a positive safe integer.
3. Keep authorization and rollout isolation in `resolveStrictFinancialPolicy`, which reads the current tenant's own flag row and requires `tenantScope` to equal exactly `[currentTenantId]`.
4. Keep shadow execution non-blocking: legacy statements commit first, canonical failures are recorded, and user-facing billing remains successful.
5. Do not broaden strict mode. Strict remains restricted to tenant `100`; this change only enables canonical shadow projection for other correctly flagged tenants.
6. Add regression coverage proving tenant `102` projections are accepted and invalid/cross-format tenant identifiers are rejected.

## Data Flow

A supported billing mutation resolves the tenant-specific policy. In shadow mode it commits legacy statements, builds canonical projections using the same tenant ID, writes canonical invoice/payment/allocation rows, and records a tenant-scoped processing issue if projection fails.

## Safety

- No global wildcard flag.
- No canonical-only write mode.
- No change to legacy authority.
- Canonical rows and source mappings retain the originating tenant ID.
- Existing tenant `100` behavior remains unchanged.

## Verification

Run focused projection tests first, then the canonical suite, `pnpm canonical:check`, TypeScript typecheck, production build, immutable Worker upload, candidate-bound health/auth checks, 100% traffic promotion, and read-only production verification. A real tenant `102` transaction after deployment is required to prove end-to-end live projection; no fake production transaction will be created.

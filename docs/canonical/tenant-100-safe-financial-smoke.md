# Tenant 100 Safe Reversible Financial Smoke

## Purpose

This operation proves that an explicitly tagged zero-traffic candidate Worker can execute a controlled Tenant 100 financial lifecycle across legacy and canonical storage without leaving patient or financial business rows behind.

It is a protected schema-level dual-write fixture. It validates production financial tables, constraints, reversal projections, atomicity, and cleanup. It does not replace separate normal-route strict financial integration tests and must not appear in the software UI.

## Safety model

The protected route performs all of the following in one D1 atomic batch:

1. Creates one synthetic legacy bill and invoice item against an existing Tenant 100 patient.
2. Creates the matching canonical invoice and invoice line.
3. Records one BDT 1.00 legacy payment and matching canonical receipt, tender, and allocation.
4. Applies legacy cancellation effects and canonical payment reversal/refund effects.
5. Verifies the complete reversed legacy and canonical lifecycle state before cleanup.
6. Deletes only the exact synthetic rows identified by the unique smoke `runId`.

Every lifecycle and cleanup statement must report the expected changed-row count. Any SQL failure rolls back the entire batch. If lifecycle verification fails, the exact synthetic rows are still removed and the request fails. A post-batch query must report zero fixture-tagged legacy rows and zero fixture-tagged canonical rows.

The fixture never creates, updates, or deletes a patient row.

## Protected endpoint

`POST /api/canonical-financial-smoke/tenant-100/reversible`

Required controls:

- Authenticated Tenant 100 session.
- `hospital_admin` role.
- Central route-permission allow-list.
- `CDB101_FINANCIAL_SMOKE_GUARD` supplied as a Worker secret on the candidate version.
- Matching `x-cdb101-financial-smoke-guard` request header.
- Candidate uploaded with version tag `cdb101-financial-smoke-fix-20260719-c1`.
- Runtime `CF_VERSION_METADATA.tag` exactly matches that tag.
- Runtime `CF_VERSION_METADATA.id` is present and returned in the evidence response.
- Tenant 100 `canonical_financial_dual_write_v1` exactly matches this approved pre-activation state:
  - domain `financial`
  - mode `disabled`
  - `is_enabled = 0`
  - version `2`
  - config `{"tenantScope":["100"],"writePolicy":"canonical-only"}`

Request body:

```json
{
  "runId": "tenant100-20260719-live-c1",
  "patientId": 123
}
```

Use a currently valid existing Tenant 100 patient ID selected specifically for controlled smoke execution. Do not create a patient for this fixture.

## Current verified preflight — July 19, 2026

Read-only production checks established:

- Current active Worker version: `fea43f6c-dd5a-48ee-95ab-b335ed5e2295` at 100 percent.
- No current zero-percent candidate contains this fixture.
- Tenant 100 financial flag is disabled, version 2, with the exact canonical-only config above.
- Tenant 100 reconciliation returned `activationReady: true`, `issueCount: 0`, and `rowsWritten: 0`.
- No production database mutation was performed by these checks.

Previously recorded candidate IDs are stale and must not be used.

## Candidate upload

Build and upload a new version without assigning it traffic. Keep the additional secrets file outside the repository with restrictive permissions.

```bash
pnpm build
pnpm exec wrangler versions upload \
  --env production \
  --tag cdb101-financial-smoke-fix-20260719-c1 \
  --message "CDB-101 Tenant-100 protected financial smoke candidate; zero traffic" \
  --secrets-file "$CDB101_SMOKE_SECRETS_FILE"
```

The protected JSON file referenced by `CDB101_SMOKE_SECRETS_FILE` must contain the one-time `CDB101_FINANCIAL_SMOKE_GUARD`. Existing Worker secrets are preserved by version upload.

Record the returned candidate version ID. Do not use `wrangler deploy` or the immediately-deploying secret command for this operation.

## Zero-traffic deployment

Create a deployment that keeps the freshly verified baseline at 100 percent and the newly uploaded candidate at 0 percent:

```bash
pnpm exec wrangler versions deploy \
  "$BASELINE_VERSION_ID@100" \
  "$CANDIDATE_VERSION_ID@0" \
  --env production \
  --message "CDB-101 protected financial smoke candidate at zero traffic; baseline unchanged" \
  --yes
```

Immediately re-read deployments and require exactly those two versions at 100/0. Abort if the active baseline has changed since preflight; never substitute a stale baseline ID.

## Required execution order

1. Reconfirm baseline/candidate percentages are exactly 100/0.
2. Reconfirm the Tenant 100 financial flag has the exact disabled state above.
3. Capture a fresh Tenant 100 reconciliation baseline and require every issue and variance to be zero.
4. Select an existing controlled Tenant 100 patient ID.
5. Authenticate as a Tenant 100 `hospital_admin` using the protected operator process.
6. Send the request through a Cloudflare Worker version override targeting the new candidate. Supply the authenticated session and one-time guard through protected environment variables or the approved secret manager; do not put them in the repository or shell history.
7. Require HTTP success with:
   - `workerVersionId` equal to the new candidate version ID
   - `workerVersionTag` equal to `cdb101-financial-smoke-fix-20260719-c1`
   - `candidateVersionBound: true`
   - `lifecycleVerified: true`
   - `cleanupVerified: true`
   - `patientRowsCreated: 0`
   - `legacyRemainingRows: 0`
   - `canonicalRemainingRows: 0`
   - `accountingRemainingRows: 0`
8. Re-run Tenant 100 reconciliation and require every variance to remain zero.
9. Preserve upload, deployment, request/response, and reconciliation receipts outside the repository with protected permissions.

The version override header must target Worker `hms-saas-production` and the newly returned candidate version ID.

## Stop conditions

Stop immediately and do not activate the strict flag when any of the following occurs:

- Active baseline differs from the freshly verified baseline.
- Candidate is not exactly 0 percent.
- Worker version ID or tag mismatch.
- Missing or invalid guard value.
- Tenant or role mismatch.
- Financial flag row is missing or differs from the exact approved disabled state.
- Any lifecycle statement changes an unexpected number of rows.
- Lifecycle verification does not match the fully reversed legacy and canonical state.
- Any fixture-tagged row remains after execution.
- Any financial reconciliation variance is non-zero.

## After a successful smoke

A successful Tenant 100 fixture does not authorize canonical reads, legacy retirement, or production traffic movement. Tenant 101 authenticated legacy smoke must also pass. Only after both smokes and zero reconciliation evidence may the strict dual-write flag be enabled in shadow mode for observation.

After the smoke evidence is accepted, remove this protected route and candidate tag from the codebase in the next controlled candidate. The one-time guard must not be reused.

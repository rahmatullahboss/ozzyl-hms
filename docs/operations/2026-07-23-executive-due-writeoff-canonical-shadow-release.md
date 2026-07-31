# Executive Due Control and Write-Off Canonical-Shadow Production Release

**Executed:** 2026-07-23

**Release commit:** `400bd610ecf9a5811c742b87003253436a99f989`

**GitHub branch:** `origin/main`

**Worker:** `hms-saas-production`

**Release tag:** `release-20260723T102142Z-400bd610e`

**Promoted Worker version:** `6be19cd4-e6bc-4ba9-995d-48fdeabb928c`

**Rollback Worker version:** `d7c4e085-f79b-46a7-8b8c-824937d417c2`

## Scope

This release promoted the executive outstanding-due dashboard, Action Center collection visibility, controlled receivable write-off approval flow, canonical compensation reporting context, refund-reservation support, and the related reconciliation and audit hardening.

The release preserved legacy financial authority and canonical shadow projection. It did not promote canonical reads, enable strict or canonical-only mode, retire legacy tables, create a production write-off, or perform any controlled financial mutation.

## Release-gate correction

The first full release test run found two deterministic gate failures before any push, candidate upload, or traffic change:

1. The Action Center task integration fixture did not include the current RBAC override tables.
2. Custom receivable-write-off audit action names were outside the production `audit_logs` action CHECK allow-list.

The release was stopped, both root causes were fixed, and the corrected release commit was created:

`400bd610e fix(release): align write-off audit actions`

Write-off audit records now use canonical allow-listed actions (`APPROVE`, `REJECT`, and `PROCESS`) while retaining the exact write-off operation in audit metadata.

## Source and quality gates

- Minimum canonical-safe ancestor `95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf`: present
- Clean release worktree: confirmed
- Migration manifest: `463` conforming migrations generated
- Focused release regression: `169/169` tests passed
- Full test suite: `1,023/1,023` files and `16,600/16,600` tests passed
- TypeScript: passed
- Canonical governance: `0` issues
- Production build: passed for the main web/PWA, patient app, and admin app
- Git diff hygiene: passed
- `origin/main` and release HEAD before deployment: exact match at `400bd610e`

## Migration state

The production database was already upgraded and verified before Worker traffic promotion:

- `0526_receivable_write_off_approval.sql`
- `0530_canonical_compensation_reporting_context.sql`
- `0531_canonical_compensation_refund_reservations.sql`

Fresh pre-release and final migration listings both reported:

`No migrations to apply`

No migration was applied during this Worker release.

## Canonical shadow state

The live tenant-scoped financial flags remained unchanged throughout the release:

| Tenant | Mode | Enabled | Version | Policy |
|---|---|---:|---:|---|
| `1` | `shadow` | `1` | `1` | `shadow` |
| `100` | `shadow` | `1` | `6` | `shadow` |
| `101` | `shadow` | `1` | `1` | `shadow` |
| `102` | `shadow` | `1` | `1` | `shadow` |

Tenants `1`, `101`, and `102` retain the approved 2026-07-20 all-tenant shadow rollout identity. Tenant `100` retains its existing version-6 tenant-scoped shadow policy. No flag row was inserted, updated, disabled, or promoted by this release.

## Financial reconciliation

The protected Tenant 100 financial collector was run at each release gate:

1. Before candidate upload
2. After zero-traffic candidate smoke
3. After 5% traffic
4. After 50% traffic
5. After final 100% promotion

Every successful receipt reported:

- `evidenceReady: true`
- `activationReady: true`
- `issueCount: 0`
- `rowsWritten: 0`
- all `15` financial variances: `0`
- all `6` controls: `0`

The collector initially encountered transient Cloudflare GraphQL `429 Too Many Requests` responses during its read-only identity check. The release remained fail-closed with no upload or traffic mutation until a fresh protected collector run succeeded.

Protected aggregate-only evidence is retained outside Git at:

`/tmp/hms-release-20260723T102142Z-400bd610e`

## Candidate verification

The candidate was uploaded without traffic and installed beside the baseline at `0%`.

Candidate-bound health returned:

- status: `ok`
- Worker version: `6be19cd4-e6bc-4ba9-995d-48fdeabb928c`
- tag: `release-20260723T102142Z-400bd610e`

Candidate-bound authenticated read-only smoke passed for:

- hospital admin
- managing director
- director
- reception and billing access

Feature-specific candidate requests returned HTTP `200` for:

- `/api/action-center/collections?status=active&sort=exposure&page=1&limit=10`
- `/api/approvals?status=pending`
- `/api/admin/due-receivables`

No write-off, approval decision, billing mutation, or financial transaction was created during smoke testing.

## Controlled traffic promotion

| Stage | Baseline | Candidate | Deployment ID | Result |
|---|---:|---:|---|---|
| Zero traffic | `100%` | `0%` | `f80b426d-eb29-43bd-825d-d383c3631977` | passed |
| Low traffic | `95%` | `5%` | `84ed6360-caa7-45b7-a89c-6b95a763f904` | passed |
| Wider traffic | `50%` | `50%` | `473f35a1-2b06-42a2-a678-edc9118007e1` | passed |
| Final promotion | `0%` | `100%` | `2769a896-ed49-4f02-985b-7c2956ee2ffe` | passed |

Health and reconciliation remained clean at every stage.

## Final production state

- New Worker version `6be19cd4-e6bc-4ba9-995d-48fdeabb928c`: `100%`
- Previous baseline `d7c4e085-f79b-46a7-8b8c-824937d417c2`: `0%`
- Unexpected third version: none
- Normal production health: `ok`
- Normal production version/tag: exact new version and release tag
- Final hospital-admin authenticated smoke: passed
- Canonical shadow flags: unchanged
- Final financial reconciliation: zero variance and zero controls
- Pending production migrations: none
- GitHub `origin/main`: exact deployed source commit `400bd610e`

The previous baseline remains installed at zero traffic as the deterministic Worker rollback target. No Time Travel restore, D1 rollback, feature-flag mutation, canonical-read promotion, data backfill, or legacy retirement was performed.

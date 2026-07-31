# Canonical Shadow-Safe Production Deployment Runbook

**Status:** Mandatory while financial canonical shadow mode is enabled for any active tenant
**Effective date:** 2026-07-19  
**Production Worker:** `hms-saas-production`  
**Production URL:** `https://hms.ozzyl.com`

## 0. Current Canonical/Inventory release gate — 2026-07-29

The current repository architecture state is recorded in:

- `docs/architecture/2026-07-29-canonical-inventory-mm-release-control-center.md`;
- `docs/architecture/canonical-inventory-mm-current-state.yaml`;
- `docs/database/2026-07-29-inventory-main-migration-reconciliation.md`.

At the verified documentation snapshot:

- Inventory Modular Monolith development is complete on `feature/inventory-modular-monolith`, but it is not reconciled into current `main` or production-released;
- Canonical Core V1 remains active at next checkpoint `CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION`;
- Full Modular Monolith requires rebaseline from recorded `INV-MM-089` to final `INV-MM-121` Inventory contracts;
- current `main` and Inventory have 11 migration-prefix collisions;
- production D1 applied/pending migrations were not queried;
- `0558d_retire_legacy_inventory_tables.sql` is destructive and is not approved for an ordinary release.

Therefore:

1. never deploy directly from the Inventory, CDB or Full-MM program branch;
2. complete a fresh `origin/main`-based consolidated integration and full verification first;
3. treat repository merge, additive migration, Worker candidate upload, feature/provider activation, traffic promotion and destructive retirement as separate gates;
4. fail closed if the exact production pending set contains the Inventory retirement migration or any other destructive schema change;
5. do not infer live schema state from local manifest counts or fresh-install success;
6. do not combine destructive retirement with a two-version candidate deployment where the baseline or rollback Worker can still reference legacy tables.

This section does not authorize production inspection, mutation, migration, deployment, activation or retirement.

## 1. Why this runbook exists

Active production tenants use non-blocking canonical shadow writes while legacy financial reads and legacy financial authority remain active. The policy is stored in the production D1 feature-flag table, and the Worker must always commit the authoritative legacy mutation even when the canonical shadow write fails. Canonical failures are recorded for reconciliation and repair; they must not become user-facing billing failures while this policy is active.

A deployment from an old branch can therefore create one of two failures:

1. The feature flag remains enabled but the deployed Worker no longer calls the canonical shadow-write code, causing shadow writes to stop and reconciliation drift to grow silently.
2. The deployed Worker contains an incompatible route-level strict guard or expects a schema that is not present, causing legacy-authoritative financial mutations to fail instead of recording a non-blocking shadow issue.

For that reason, ordinary immediate deployment is prohibited while shadow observation is active.

## 2. Current production state snapshot

This is a historical snapshot for orientation only. Always re-read Cloudflare and D1 immediately before a deployment; never copy these IDs blindly into a future command.

- Latest production deployment ID: `4951d535-4279-4b51-bb50-302ba1099d26`
- Active baseline Worker version:
  - Version number: `1152`
  - Version ID: `fea43f6c-dd5a-48ee-95ab-b335ed5e2295`
  - Traffic: `100%`
- Canonical protected candidate:
  - Version number: `1155`
  - Version ID: `97b060d7-5c02-4da9-a553-ca0ff7f70d4d`
  - Tag: `cdb101-financial-smoke-fix-20260719-c1`
  - Traffic: `0%`
- Tenant 100 feature flag target state:
  - key: `canonical_financial_dual_write_v1`
  - domain: `financial`
  - mode: `shadow`
  - enabled: `1`
  - config: `{"tenantScope":["100"],"writePolicy":"shadow"}`
  - version: use the latest verified row; do not hard-code a historical version
- Canonical reads: not promoted
- Legacy financial authority: active
- Every active tenant: legacy-authoritative with non-blocking canonical financial shadow projection

## 3. Non-negotiable source-code guard

Until the canonical integration branch is merged into `main`, never deploy production from plain `main` or from a feature branch created from plain `main`.

The minimum shadow-safe ancestor is:

```text
95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf
```

Every production release commit must be a descendant of this commit.

Run:

```bash
git merge-base --is-ancestor \
  95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf \
  HEAD
```

Required result: exit code `0`.

If the command returns non-zero, stop. Merge or rebase the feature onto the latest canonical integration branch before any build or upload.

Also require a clean release commit:

```bash
git status --short
git rev-parse HEAD
```

Do not deploy uncommitted source changes. `.ai-bridge` files must never be included in a release commit.

## 4. Commands that are prohibited

Do not use these as a normal production release path while shadow mode is active:

```bash
wrangler deploy --env production
pnpm deploy:production
pnpm build && wrangler deploy --env production
```

Those commands immediately create a new 100% deployment and replace the controlled version split before candidate-bound verification is complete.

Do not:

- deploy from plain `main` until canonical integration is merged;
- change the Tenant 100 canonical flag through direct SQL;
- delete or rewrite canonical migrations already applied in production;
- deploy code that requires an unapplied migration;
- deploy a destructive migration while two Worker versions can run;
- increase traffic before candidate-bound health and authenticated smoke pass;
- promote canonical reads or retire legacy authority as part of an ordinary feature release;
- alter any tenant canonical flag during an ordinary Worker release;
- upload waiver, rehearsal or synthetic production data for any tenant.

## 5. Required release architecture

Every production feature release uses this sequence:

1. Verify canonical-safe source ancestry.
2. Run tests, typecheck, canonical governance and full build.
3. Capture the live deployment, feature flag and reconciliation baseline.
4. Upload the release as a new Worker version without traffic.
5. Replace the old zero-percent candidate with the new release candidate at `0%`, preserving the current baseline at `100%`.
6. Verify the new candidate through a Worker-version override.
7. Run candidate-bound authenticated smoke and feature-specific smoke.
8. Re-run financial reconciliation.
9. Promote traffic in controlled stages.
10. Keep the previous known-good version at `0%` after final promotion for fast rollback.
11. Verify the feature flag and reconciliation again.

The zero-percent candidate is a deployment safety mechanism. Tenant-scoped shadow policies are stored in D1 and apply to whichever compatible Worker receives traffic.

Replacing the current `c1` zero-percent candidate with a new release candidate does not delete `c1`; it remains in Cloudflare version history. It only removes `c1` from the latest active deployment split.

## 6. Pre-deployment verification

### 6.1 Source and quality gates

At minimum run:

```bash
git merge-base --is-ancestor \
  95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf \
  HEAD

git status --short
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm test
pnpm build
```

For a large or financial change, also run the integration and production-focused test suites relevant to the modified routes.

A failed test, TypeScript error, governance issue or build error stops the release.

### 6.2 Migration review

List all migration changes in the release:

```bash
git diff --name-only <PREVIOUS_RELEASE_COMMIT>...HEAD -- migrations/
```

If migrations changed:

- obtain separate migration approval;
- ensure migrations are additive and backward-compatible with both the current baseline and new candidate;
- apply and verify the migration before traffic reaches code that requires it;
- do not drop columns, rename live columns, narrow constraints or remove indexes while the old baseline may still execute;
- run reconciliation after migration and before Worker promotion.

If migrations did not change, record `no migration change` in the release evidence.

### 6.3 Create a protected evidence directory

```bash
EVIDENCE_DIR="/tmp/hms-release-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"
```

All evidence files must use mode `600`. Do not put credentials, bearer tokens or secrets in evidence files.

### 6.4 Capture the exact current deployment

```bash
pnpm exec wrangler deployments list --env production --json \
  > "$EVIDENCE_DIR/deployments-before.json"
chmod 600 "$EVIDENCE_DIR/deployments-before.json"
```

Read the latest deployment and record:

- current 100% version ID;
- current 0% version ID, if present;
- deployment ID;
- absence of an unexpected third version.

Never assume the IDs in section 2 are still current.

### 6.5 Confirm the exact all-active-tenant shadow scope

```bash
pnpm canonical:validate-production-financial-shadow-scope -- \
  --output "$EVIDENCE_DIR/financial-shadow-scope-before.json"
chmod 600 "$EVIDENCE_DIR/financial-shadow-scope-before.json"
```

Require one exact enabled `financial/shadow` policy per active tenant, exact tenant-scoped `writePolicy: shadow` config, no duplicate policy, no orphan inactive-tenant policy, and `rowsWritten: 0`.

### 6.6 Capture pre-release reconciliation for every active tenant

Read `activeTenantIds` from the scope receipt and run:

```bash
for TENANT_ID in $(node -e 'const r=require(process.argv[1]); console.log(r.activeTenantIds.join(" "))' \
  "$EVIDENCE_DIR/financial-shadow-scope-before.json"); do
  pnpm canonical:collect-tenant-financial-reconciliation -- \
    --tenant "$TENANT_ID" \
    --output "$EVIDENCE_DIR/reconciliation-before-tenant-$TENANT_ID.json" \
    --second-pass-new-rows 0
done
chmod 600 "$EVIDENCE_DIR"/reconciliation-before-tenant-*.json
```

For every active tenant require `evidenceReady: true`, `rowsWritten: 0` and all 6 controls zero. If `activationReady` is already true, require all 15 variances to remain zero. If an active tenant is still in non-blocking shadow observation with a documented non-zero baseline, record its exact issue list and all 15 variance values; an ordinary Worker release may proceed only when every candidate and post-promotion reconciliation is byte-for-byte equal to that approved pre-release baseline. A non-zero tenant must never be promoted to strict/canonical authority.

## 7. Upload a zero-traffic release candidate

Create an immutable tag that includes UTC time and the release commit:

```bash
RELEASE_COMMIT="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=10 HEAD)"
RELEASE_TAG="release-$(date -u +%Y%m%dT%H%M%SZ)-$SHORT_SHA"
```

Run one final dry build:

```bash
pnpm exec wrangler deploy \
  --env production \
  --dry-run \
  --outdir "$EVIDENCE_DIR/worker-dry-run"
```

Then upload a version without assigning traffic:

```bash
pnpm exec wrangler versions upload \
  --env production \
  --tag "$RELEASE_TAG" \
  --message "HMS production candidate $RELEASE_TAG from $RELEASE_COMMIT"
```

Record the returned new Worker version ID as `NEW_VERSION_ID`.

Existing Worker secrets are inherited by normal version upload. Do not generate, replace or print secrets during an ordinary feature deployment. New secrets require a separately reviewed secret-change procedure.

## 8. Install the candidate at zero traffic

Use the freshly read current 100% version as `CURRENT_BASELINE_ID`.

```bash
pnpm exec wrangler versions deploy \
  "$CURRENT_BASELINE_ID@100" \
  "$NEW_VERSION_ID@0" \
  --env production \
  --message "Zero-traffic verification for $RELEASE_TAG; baseline unchanged" \
  --yes
```

Immediately re-read deployments:

```bash
pnpm exec wrangler deployments list --env production --json \
  > "$EVIDENCE_DIR/deployments-candidate-zero.json"
chmod 600 "$EVIDENCE_DIR/deployments-candidate-zero.json"
```

Require exactly:

- `CURRENT_BASELINE_ID` at `100%`;
- `NEW_VERSION_ID` at `0%`;
- no third version.

If the baseline changed between preflight and deployment, stop. Do not guess or substitute an old baseline ID.

## 9. Candidate-bound verification

### 9.1 Health and version metadata

```bash
curl --fail --silent --show-error \
  "https://hms.ozzyl.com/api/health" \
  -H "Cloudflare-Workers-Version-Overrides: hms-saas-production=\"$NEW_VERSION_ID\"" \
  > "$EVIDENCE_DIR/candidate-health.json"
chmod 600 "$EVIDENCE_DIR/candidate-health.json"
```

Require:

- HTTP 200;
- `workerVersionId` equals `NEW_VERSION_ID`;
- `workerVersionTag` equals `RELEASE_TAG`.

### 9.2 Candidate-bound authenticated smoke

Use the approved protected operator process. Do not write passwords or bearer tokens to files or shell history.

At minimum verify through the exact candidate override:

- Tenant 100 hospital-admin login;
- dashboard;
- patient list/search;
- billing list;
- staff list;
- no unexpected HTTP 500;
- no business mutation unless a separately authorized controlled smoke is being executed.

Where supported, the existing authenticated checker can be bound to the candidate:

```bash
WORKER_VERSION_OVERRIDE_ID="$NEW_VERSION_ID" \
E2E_ROLE=hospital_admin \
E2E_SKIP_PATIENT=1 \
pnpm test:e2e:prod:auth
```

Run at least one authenticated read-only smoke for each active tenant when the change touches shared backend behavior. Legacy financial authority must remain active even though tenant-scoped shadow projection is enabled.

### 9.3 Feature-specific smoke

Test the feature introduced by the release through the version override. Use read-only checks where possible. Any controlled financial mutation requires its own approved run ID, controlled patient and cleanup/reconciliation proof.

### 9.4 Reconciliation after candidate testing

```bash
pnpm canonical:collect-tenant-financial-reconciliation -- \
  --output "$EVIDENCE_DIR/reconciliation-after-candidate-smoke.json" \
  --second-pass-new-rows 0
chmod 600 "$EVIDENCE_DIR/reconciliation-after-candidate-smoke.json"
```

Repeat reconciliation for every active tenant. Require zero values for tenants whose pre-release baseline was activation-ready; otherwise require the exact documented issue list, variance values and controls to remain unchanged.

## 10. Traffic promotion

Do not promote traffic until candidate-bound health, authenticated smoke, feature smoke and reconciliation all pass.

### Stage A: low traffic

```bash
pnpm exec wrangler versions deploy \
  "$CURRENT_BASELINE_ID@95" \
  "$NEW_VERSION_ID@5" \
  --env production \
  --message "Low-traffic production observation for $RELEASE_TAG" \
  --yes
```

Verify health, Worker errors, key routes and reconciliation.

### Stage B: wider traffic

```bash
pnpm exec wrangler versions deploy \
  "$CURRENT_BASELINE_ID@50" \
  "$NEW_VERSION_ID@50" \
  --env production \
  --message "Wider production observation for $RELEASE_TAG" \
  --yes
```

Again verify health, errors and reconciliation.

### Stage C: complete promotion while preserving rollback

```bash
pnpm exec wrangler versions deploy \
  "$CURRENT_BASELINE_ID@0" \
  "$NEW_VERSION_ID@100" \
  --env production \
  --message "Production promotion for $RELEASE_TAG; previous baseline retained at zero traffic" \
  --yes
```

Do not immediately remove the previous baseline from the active deployment. Keeping it at `0%` provides a deterministic rollback target.

For a low-risk emergency frontend-only release, stages may be shortened only with explicit owner authorization, but zero-traffic candidate verification is still mandatory.

## 11. Final post-deployment checks

After final promotion:

1. Re-read deployments and require new version `100%`, prior baseline `0%`, no third version.
2. Verify `/api/health` through normal production traffic and require the new version ID/tag.
3. Re-run the all-active-tenant shadow scope validator and require the same active tenant set and exact policies.
4. Run final financial reconciliation for every active tenant and require either zero parity or exact equality with its documented non-blocking shadow baseline.
5. Verify normal legacy billing screens remain operational for every active tenant.
6. Confirm canonical shadow remains non-blocking and legacy-authoritative for every tenant.
7. Confirm canonical reads remain unpromoted.
8. Confirm no legacy table retirement occurred.
9. Record the release commit, version ID, tag, deployment ID and rollback version in the tracker.

## 12. Rollback

### 12.1 Worker regression with reconciliation still zero

Return traffic to the previous baseline:

```bash
pnpm exec wrangler versions deploy \
  "$CURRENT_BASELINE_ID@100" \
  "$NEW_VERSION_ID@0" \
  --env production \
  --message "Rollback $RELEASE_TAG to previous known-good Worker" \
  --yes
```

Then verify deployment, health, flag and reconciliation.

### 12.2 Canonical shadow-write or parity incident

Symptoms include:

- `CANONICAL_STRICT_WRITE_FAILED`;
- `CANONICAL_STRICT_POLICY_INVALID`;
- new reconciliation variance;
- legacy succeeds but canonical shadow rows are missing or mismatched;
- unexpected financial HTTP 409/500 after release.

Actions:

1. Return Worker traffic to the previous known-good baseline.
2. Stop controlled financial QA.
3. Capture reconciliation and error evidence.
4. If the problem persists on the known-good Worker and is clearly caused by the enabled policy, use only a protected, reviewed feature-flag operator with exact precondition and postcondition verification to disable canonical shadow execution.
5. Never disable or edit the flag through direct production SQL.
6. Do not roll back D1 schema blindly after live writes.

## 13. Rules for other implementation agents

Every agent implementing or deploying a feature must receive these instructions:

```text
PRODUCTION DEPLOYMENT CONTRACT

Tenant 100 financial canonical shadow mode is active. Do not deploy from plain main and do not use plain wrangler deploy or pnpm deploy:production.

Your release HEAD must contain ancestor:
95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf

Before production upload, report:
1. release HEAD and clean git status;
2. ancestor-check result;
3. migration files changed;
4. tests, TypeScript, canonical governance and build results;
5. current 100% and 0% Worker version IDs;
6. exact Tenant 100 shadow flag state;
7. zero pre-release reconciliation.

Upload the release with wrangler versions upload. Install it at 0% beside the freshly read current 100% baseline. Verify exact candidate ID/tag through Cloudflare Worker version override, run authenticated and feature-specific smoke, and require zero reconciliation before traffic promotion.

Promote through controlled version splits. Keep the prior known-good Worker at 0% after final promotion. Reverify the Tenant 100 shadow flag and reconciliation after promotion.

Do not promote canonical reads, retire legacy financial authority, change tenant flags, import waiver/rehearsal data, run Time Travel restore, or apply an unapproved migration.
```

## 14. Main-branch integration requirement

The current canonical integration branch contains `main`, but is ahead of `main` by a large number of commits. Until this work is formally merged:

- new feature work intended for production must branch from the latest committed canonical integration branch;
- merging only the feature commit into plain `main` is not sufficient;
- any PR or cherry-pick must preserve the minimum-safe ancestor check;
- CI should eventually enforce the ancestor or an equivalent canonical-shadow compatibility contract.

After canonical integration is merged into `main`, update the minimum-safe commit and this runbook. The versioned candidate deployment process should remain the default production release method even after the merge.

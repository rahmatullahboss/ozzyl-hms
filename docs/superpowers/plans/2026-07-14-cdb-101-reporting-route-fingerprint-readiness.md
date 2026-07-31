# CDB-101 Reporting Route Fingerprint Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add deterministic, PHI-safe repository and live-evidence fingerprint validation for the legacy reporting routes and separate canonical canary routes without making production requests or mutations.

**Architecture:** A pure TypeScript contract owns the exact route registry, repository capture, live evidence validation, canonical JSON hashing, and aggregate verdict. Repository-only mode verifies mounts, handler markers, permissions, source hashes, and production route patterns. A protected normalized evidence file can later add Worker metadata and authenticated read-only route observations; the final fingerprint remains null until both halves validate.

**Tech Stack:** TypeScript, Node.js `crypto` and `fs`, Vitest, pnpm, Git, existing HMS route and authorization contracts.

## Global Constraints

- Work only in `task/cdb-101-route-fingerprint-readiness` under the isolated worktree.
- Never touch `/Users/rahmatullahzisan/Desktop/Dev/hms` directly.
- Do not make HTTP requests, use credentials, deploy, apply migrations, import rows, mutate flags, export production, repair FK rows, restore Time Travel, push, or merge to `main`.
- Commit no live response bodies, tokens, cookies, signed URLs, PHI, patient/practitioner names, transaction values, or protected evidence.
- The route validator must remain fail-closed and must never infer `activeRoutesUnchanged=true` from repository state alone.
- New behavior follows RED-GREEN-REFACTOR with a witnessed failing test before implementation.
- Aggregate output must report `productionMutationPerformed=false` and `aggregateOnly=true`.

---

### Task 1: Route Registry and Pure Fingerprint Contract

**Files:**
- Create: `test/canonical/reporting-route-fingerprint.test.ts`
- Create: `scripts/canonical/reporting-route-fingerprint.ts`
- Create: `docs/database/migration-runs/production/CDB-101-reporting-route-evidence-template.json`

**Interfaces:**
- Produces: `REPORTING_ROUTE_REGISTRY: readonly ReportingRouteContract[]`
- Produces: `canonicalJson(value: unknown): string`
- Produces: `evaluateReportingRouteFingerprint(input: ReportingRouteFingerprintInput): ReportingRouteFingerprintResult`
- Produces: stable route issue codes used by later tasks.

- [x] **Step 1: Write failing registry and repository-only tests**

Create tests asserting:

```ts
expect(REPORTING_ROUTE_REGISTRY.map((route) => route.id)).toEqual([
  'dashboard_kpi_summary',
  'dashboard_doctor_performance',
  'dashboard_doctor_performance_details',
  'dashboard_test_performance',
  'dashboard_test_performance_details',
  'daily_collection',
  'ipd_revenue',
  'canonical_reporting_status',
  'canonical_doctor_performance',
  'canonical_test_performance',
  'canonical_collections',
  'canonical_ipd_finance',
]);
```

Also assert that repository-only input returns:

```ts
{
  repositoryReady: true,
  liveEvidenceReady: false,
  activeRoutesUnchanged: false,
  routeFingerprintSha256: null,
  aggregateOnly: true,
  productionMutationPerformed: false,
}
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run test/canonical/reporting-route-fingerprint.test.ts
```

Expected: FAIL because `scripts/canonical/reporting-route-fingerprint.ts` does not exist.

- [x] **Step 3: Add the minimal registry, types, canonical JSON, and evaluator skeleton**

Implement:

```ts
export type ReportingRouteClassification = 'legacy_active' | 'canonical_canary';

export interface ReportingRouteContract {
  id: string;
  classification: ReportingRouteClassification;
  method: 'GET';
  pathTemplate: string;
  mountPrefix: string;
  handlerFile: string;
  handlerMarker: string;
  guardContract: string;
  permissionPrefix: string | null;
  expectedShapePaths: readonly string[];
  allowedStatuses: readonly number[];
}
```

Implement stable key-sorted `canonicalJson`, SHA-256 helper, exact registry validation, repository-only incomplete verdict, and issue minimization.

- [x] **Step 4: Add the fail-closed evidence template**

The committed JSON template must contain no tokens or raw body placeholders. It must use null/empty values and include all twelve route IDs with normalized fields only.

- [x] **Step 5: Run focused tests and verify GREEN**

Run the same Vitest command. Expected: registry and repository-only tests pass.

- [x] **Step 6: Commit Task 1**

```bash
git add test/canonical/reporting-route-fingerprint.test.ts scripts/canonical/reporting-route-fingerprint.ts docs/database/migration-runs/production/CDB-101-reporting-route-evidence-template.json
git commit -m "feat: add reporting route fingerprint contract"
```

---

### Task 2: Repository Route Capture and Contract Drift Detection

**Files:**
- Modify: `test/canonical/reporting-route-fingerprint.test.ts`
- Modify: `scripts/canonical/reporting-route-fingerprint.ts`

**Interfaces:**
- Consumes: `REPORTING_ROUTE_REGISTRY`
- Produces: `collectReportingRouteRepositoryEvidence(options: { rootDir: string; gitCommit?: string }): ReportingRouteRepositoryEvidence`
- Produces: issue codes for missing mount, marker, permission, pattern, and registry conflicts.

- [x] **Step 1: Write failing fixture-repository tests**

Use temporary directories with small fixture files. Prove:

- missing `app.route('/api/dashboard', dashboardRoutes)` emits `CDB101_ROUTE_MOUNT_MISSING`;
- missing `dashboardRoutes.get('/doctor-performance'` emits `CDB101_ROUTE_HANDLER_MARKER_MISSING`;
- missing canonical reporting permission emits `CDB101_ROUTE_PERMISSION_MISSING`;
- production route patterns or `run_worker_first` drift emits `CDB101_ROUTE_PATTERN_MISMATCH`;
- a legacy route using `/api/canonical-reporting` emits `CDB101_CANONICAL_ROUTE_NOT_SEPARATE`.

- [x] **Step 2: Run the focused test and verify RED**

Expected: FAIL because repository capture is absent.

- [x] **Step 3: Implement repository capture**

Read only these registered files plus `wrangler.toml`, `src/index.ts`, and `src/lib/route-permissions.ts`. Verify exact mount and handler markers, calculate file SHA-256 values, parse production route patterns and `run_worker_first`, and return aggregate evidence without file contents.

The real repository should resolve its full commit with:

```bash
git rev-parse HEAD
```

The pure function must also accept an injected `gitCommit` for fixtures.

- [x] **Step 4: Verify GREEN on fixtures and the real repository**

Add a real-repository test asserting `repositoryReady=true`, twelve route contracts, seven legacy routes, five canonical routes, and no repository issues.

- [x] **Step 5: Commit Task 2**

```bash
git add test/canonical/reporting-route-fingerprint.test.ts scripts/canonical/reporting-route-fingerprint.ts
git commit -m "feat: verify reporting route repository ownership"
```

---

### Task 3: Normalized Live Evidence Validation and CLI

**Files:**
- Modify: `test/canonical/reporting-route-fingerprint.test.ts`
- Modify: `scripts/canonical/reporting-route-fingerprint.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ReportingRouteRepositoryEvidence`
- Consumes: normalized `ReportingRouteLiveEvidence`
- Produces: deterministic `routeFingerprintSha256`, `evidenceId`, aggregate issue list, and readiness flags.
- Produces CLI script: `canonical:fingerprint-reporting-routes`.

- [x] **Step 1: Write failing live-evidence tests**

Cover one behavior per test:

- missing Worker version emits `CDB101_WORKER_VERSION_MISSING`;
- missing route observation emits `CDB101_LIVE_ROUTE_OBSERVATION_MISSING`;
- duplicate route observation emits `CDB101_LIVE_ROUTE_OBSERVATION_DUPLICATE`;
- missing normalized shape hash emits `CDB101_LIVE_ROUTE_SHAPE_MISSING`;
- invalid status emits `CDB101_LIVE_ROUTE_STATUS_INVALID`;
- legacy route with `canonicalHandlerObserved=true` emits `CDB101_LEGACY_ROUTE_CANONICALIZED`;
- canonical status with `activeRouteSwitched=true` emits `CDB101_ACTIVE_ROUTE_SWITCHED`;
- fields such as `rawBody`, `authorization`, `cookie`, `patientName`, `practitionerName`, or `signedUrl` emit `CDB101_ROUTE_EVIDENCE_SENSITIVE`;
- complete normalized evidence produces a stable SHA-256 and `activeRoutesUnchanged=true`;
- aggregate result serialization excludes route body values, tokens, user IDs, and source response objects.

- [x] **Step 2: Run focused tests and verify RED**

Expected: new live-evidence tests fail because validation is missing.

- [x] **Step 3: Implement minimal live validation**

Validate exact Worker name `hms-saas-production`, UUID-shaped active and previous versions, script ETag SHA-256, absolute UTC capture time, production route pattern equality, one observation per route, sorted unique normalized shape paths, status allowlists, no sensitive keys recursively, and classification-specific rules.

Compute:

```ts
routeFingerprintSha256 = sha256(canonicalJson({ repository, live: normalizedLiveEvidence }));
evidenceId = `cdb101-route-${routeFingerprintSha256.slice(0, 16)}`;
```

Only compute these values when every issue list is empty.

- [x] **Step 4: Add CLI parsing**

Support only:

```bash
pnpm canonical:fingerprint-reporting-routes -- --repository-only
pnpm canonical:fingerprint-reporting-routes -- --evidence <path>
```

Reject unknown flags, missing evidence files, malformed JSON, and any request for network capture. Print only the aggregate verdict JSON.

- [x] **Step 5: Add package script**

```json
"canonical:fingerprint-reporting-routes": "tsx scripts/canonical/reporting-route-fingerprint.ts"
```

- [x] **Step 6: Verify focused tests and repository-only CLI**

Expected repository-only CLI result:

```json
{
  "repositoryReady": true,
  "liveEvidenceReady": false,
  "activeRoutesUnchanged": false,
  "routeFingerprintSha256": null,
  "aggregateOnly": true,
  "productionMutationPerformed": false
}
```

- [x] **Step 7: Commit Task 3**

```bash
git add test/canonical/reporting-route-fingerprint.test.ts scripts/canonical/reporting-route-fingerprint.ts package.json
git commit -m "feat: validate normalized reporting route evidence"
```

---

### Task 4: Adversarial Review, Documentation, Tracker, and Final Verification

**Files:**
- Create: `docs/database/migration-runs/production/CDB-101-reporting-route-fingerprint.md`
- Modify: `docs/database/migration-runs/production/CDB-101-reporting-operational-readiness.md`
- Modify: `task-progress.yaml`
- Modify: `.ai-bridge/current-plan.md`
- Modify: `.ai-bridge/agent-status.md`
- Modify: `.ai-bridge/decisions.md`
- Modify: this plan checklist.

**Interfaces:**
- Consumes: final implementation and verification outputs.
- Produces: a preparation-complete handoff that leaves `CDB101_ACTIVE_ROUTE_EVIDENCE_UNAVAILABLE` open until protected authenticated observations exist.

- [x] **Step 1: Run adversarial and edge-case review**

Review for:

- static evidence accidentally closing the blocker;
- raw response values entering hashes or output;
- route registry omission or duplicate IDs;
- production route pattern wildcard normalization mistakes;
- path parameter values leaking into evidence;
- 401/403 being treated as success when a success probe is required;
- canonical route observations being accepted as legacy routes;
- unexpected additional live observations being silently ignored;
- abbreviated commits or mutable Worker labels being accepted.

Write a failing regression test for every confirmed defect before fixing it.

- [x] **Step 2: Write the production-readiness report**

Document the registry, repository result, CLI usage, protected live evidence procedure, issue codes, and explicit statement that no live HTTP request or production mutation occurred.

- [x] **Step 3: Update operational readiness and trackers**

Record that route fingerprint tooling is ready but live fingerprints remain absent. Do not mark CDB-101 execution ready or reduce the authoritative blocker count from 17.

- [x] **Step 4: Run fresh verification**

```bash
pnpm vitest run test/canonical/reporting-route-fingerprint.test.ts test/canonical/production-cutover-contract.test.ts test/canonical/reporting-cutover-preflight.test.ts test/integration/routes/canonical-reporting.test.ts
pnpm vitest run test/canonical test/integration/routes/canonical-reporting.test.ts
pnpm build:migrations
pnpm canonical:check
pnpm exec tsc --noEmit --pretty false
pnpm canonical:fingerprint-reporting-routes -- --repository-only
python3 -c "import json,yaml; yaml.safe_load(open('task-progress.yaml')); json.load(open('docs/database/migration-runs/production/CDB-101-reporting-route-evidence-template.json')); print('metadata assertions passed')"
git diff --check
```

Expected:

- focused tests pass;
- full canonical suite passes;
- migration count remains `443`;
- governance issues `0`;
- TypeScript errors `0`;
- repository route capture ready;
- live evidence incomplete;
- active routes unchanged remains false;
- no production mutation.

- [x] **Step 5: Commit final implementation evidence**

```bash
git add docs/database/migration-runs/production/CDB-101-reporting-route-fingerprint.md docs/database/migration-runs/production/CDB-101-reporting-operational-readiness.md task-progress.yaml .ai-bridge/current-plan.md .ai-bridge/agent-status.md .ai-bridge/decisions.md docs/superpowers/plans/2026-07-14-cdb-101-reporting-route-fingerprint-readiness.md
git commit -m "chore: record reporting route fingerprint readiness"
```

- [x] **Step 6: Leave a clean worker branch**

Report exact commits and `READY FOR INTEGRATION`. Do not merge or push from the worker branch.

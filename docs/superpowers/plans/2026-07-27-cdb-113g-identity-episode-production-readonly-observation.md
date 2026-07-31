# CDB-113G Identity and Episode Production Read-Only Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and execute a protected, aggregate-only, read-only production observation for tenant `100` across the five CDB-113F identity/episode provider families without changing flags, routes, traffic, schema, or data.

**Architecture:** A strict protected authorization loader validates an exact non-mutating scope. A pure evaluator validates five aggregate provider rows and latency samples. A remote collector verifies the production D1 identity, runs one warm-up plus five measured allowlisted aggregate queries, enforces `changed_db=false` and `rows_written=0`, writes protected evidence outside the repository, and emits a minimal aggregate receipt.

**Tech Stack:** TypeScript, Node.js `fs`/`child_process`/`crypto`, Wrangler D1 JSON output, Vitest, existing canonical production database constants and repository worktree policy.

## Global Constraints

- Production database must be exactly `hms-super-admin-production-apac` with UUID `c68a5360-a2c1-44cc-9e71-f21057bea102`.
- Tenant scope is exactly `100`.
- Provider scope is exactly patient identity, practitioner, appointment, encounter, and admission/bed with the five CDB-113F consumer IDs and feature flags.
- The only authorized operation is `read_only_controlled_probe`.
- All provider flags must remain disabled; canonical mode must remain absent.
- Every remote D1 envelope must report `changed_db=false` and `rows_written=0`.
- One warm-up query and exactly five measured queries are allowed.
- Protected authorization and evidence must remain outside the repository in a mode-`700` directory with mode-`600` regular files.
- No raw source IDs, canonical IDs, names, phones, addresses, clinical narrative, financial values, credentials, commands, SQL, paths, UUIDs, or raw Wrangler output may be written to evidence or stdout.
- `promotionReady` is always `false` in CDB-113G.
- No deploy, migration, backfill, flag, route, traffic, local-sync, retirement, push, or CDB-to-main integration is part of this checkpoint.

---

### Task 1: Protected authorization contract

**Files:**
- Create: `scripts/canonical/identity-episode-production-observation-authorization.ts`
- Create: `test/canonical/identity-episode-production-observation-authorization.test.ts`
- Create: `docs/database/migration-runs/production/CDB-113G-identity-episode-observation-authorization-template.json`

**Interfaces:**
- Produces: `loadIdentityEpisodeObservationAuthorization(path, options)` returning a normalized `IdentityEpisodeObservationAuthorization`.
- Produces: `IDENTITY_EPISODE_OBSERVATION_PROVIDERS`, the exact five provider/consumer/flag triples.
- Consumes: `CDB101_PRODUCTION_DATABASE_NAME`, `CDB101_PRODUCTION_DATABASE_ID`, and `CDB101_CANARY_TENANT_ID`.

- [ ] **Step 1: Write failing authorization tests**

Cover exact valid authorization, unknown fields, wrong database/tenant/provider/consumer/flag, broad permissions, invalid chronology, stale commit bindings, non-empty accepted exceptions, repository-contained file, symlink, hard link, unsafe directory mode, and unsafe file mode.

- [ ] **Step 2: Run the authorization test and confirm RED**

Run:

```bash
pnpm vitest run test/canonical/identity-episode-production-observation-authorization.test.ts
```

Expected: FAIL because the authorization module does not exist.

- [ ] **Step 3: Implement the strict authorization parser and protected-file checks**

The module must export:

```ts
export type IdentityEpisodeObservationProvider =
  | 'patient_identity'
  | 'practitioner'
  | 'appointment'
  | 'encounter'
  | 'admission_bed';

export interface IdentityEpisodeObservationAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'read_only_controlled_probe';
  database: { name: string; uuid: string; environment: 'production'; remote: true };
  tenantId: '100';
  providers: Array<{ provider: IdentityEpisodeObservationProvider; consumerId: string; flagKey: string }>;
  timing: { issuedAtUtc: string; observationStartUtc: string; observationEndUtc: string; expiresAtUtc: string };
  thresholds: { measuredIterations: 5; p95DurationMs: 250; maxDurationMs: 500; acceptedExceptionIds: [] };
  commits: { implementation: '561a34a1b'; metadata: '3427268c8'; mainSync: 'f4004195a'; design: '89cbc4ad3' };
  owner: { ownerId: 'rahmatullah-zisan'; displayName: 'Rahmatullah Zisan'; approved: true; approvalSource: 'user_explicit_production_readonly_observation_authorization' };
  permissions: Record<string, boolean>;
}
```

Require all mutation/promotion permissions to be `false` and reject unknown object keys recursively.

- [ ] **Step 4: Run authorization tests and confirm GREEN**

Run the focused test and require all cases to pass.

- [ ] **Step 5: Commit the authorization slice**

```bash
git add scripts/canonical/identity-episode-production-observation-authorization.ts test/canonical/identity-episode-production-observation-authorization.test.ts docs/database/migration-runs/production/CDB-113G-identity-episode-observation-authorization-template.json
git commit -m "feat(canonical): add identity episode observation authorization"
```

---

### Task 2: Aggregate SQL and pure observation evaluator

**Files:**
- Create: `scripts/canonical/identity-episode-production-observation.ts`
- Create: `test/canonical/identity-episode-production-observation.test.ts`

**Interfaces:**
- Consumes: normalized authorization from Task 1.
- Produces: `IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL`.
- Produces: `evaluateIdentityEpisodeProductionObservation(input)` returning evidence/observation/promotion decisions.

- [ ] **Step 1: Write failing evaluator tests**

Test exact five-provider success, missing mapping blockers, duplicate mapping failure, invalid target failure, cross-tenant failure, critical issue failure, enabled/canonical flag failure, inconsistent measured iterations, latency threshold breach, malformed provider row, duplicate provider row, missing provider row, and recursive sensitive-key rejection.

- [ ] **Step 2: Run the evaluator test and confirm RED**

```bash
pnpm vitest run test/canonical/identity-episode-production-observation.test.ts
```

Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement the aggregate query**

Use a single read-only `WITH ... UNION ALL` statement that returns exactly these numeric fields per provider:

```ts
interface IdentityEpisodeObservationAggregateRow {
  provider: IdentityEpisodeObservationProvider;
  source_count: number;
  mapped_source_count: number;
  missing_mapping_count: number;
  duplicate_active_mapping_count: number;
  invalid_canonical_target_count: number;
  cross_tenant_relationship_count: number;
  unresolved_critical_issue_count: number;
  enabled_flag_count: number;
  canonical_mode_flag_count: number;
}
```

The query must use only counts and existence checks over tenant `100`; it must never select row identifiers or descriptive fields.

- [ ] **Step 4: Implement the evaluator**

The evaluator must:

- validate five stable provider rows per iteration;
- require count stability across five measured iterations;
- calculate p95 using nearest-rank selection over five durations;
- emit stable issue codes;
- distinguish mapping blockers from evidence failures;
- set `evidenceReady=true` only when authorization/result shape/read-only/privacy/chronology are valid;
- set `observationReady=true` only when no non-mapping issues exist and latency passes;
- always set `promotionReady=false`.

- [ ] **Step 5: Run evaluator tests and confirm GREEN**

Run the focused test and require all cases to pass.

- [ ] **Step 6: Commit the evaluator slice**

```bash
git add scripts/canonical/identity-episode-production-observation.ts test/canonical/identity-episode-production-observation.test.ts
git commit -m "feat(canonical): evaluate identity episode production observation"
```

---

### Task 3: Remote read-only collector and protected evidence writer

**Files:**
- Create: `scripts/canonical/collect-identity-episode-production-observation.ts`
- Create: `test/canonical/collect-identity-episode-production-observation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: authorization loader and pure evaluator.
- Produces: `collectIdentityEpisodeProductionObservation(options)`.
- Produces package command: `canonical:identity-episode-production-observe`.

- [ ] **Step 1: Write failing collector tests**

Use an injected runner to cover exact database identity, wrong identity, command failure, malformed Wrangler JSON, write/changed-db envelopes, incorrect row counts, one warm-up plus five measured calls, unsafe evidence output, protected evidence permissions, aggregate-only stdout receipt, and no `--yes`/mutation command arguments.

- [ ] **Step 2: Run collector tests and confirm RED**

```bash
pnpm vitest run test/canonical/collect-identity-episode-production-observation.test.ts
```

Expected: FAIL because the collector does not exist.

- [ ] **Step 3: Implement the collector**

The collector must:

1. load authorization before any child process;
2. validate current Git commit ancestry or exact required commit presence before network access;
3. run `wrangler d1 info <database> --json` and validate name/UUID;
4. run one allowlisted aggregate-only `sqlite_schema` preflight;
5. if required authority tables are missing, write protected blocker evidence and stop before provider queries;
6. otherwise run exactly one warm-up plus five measured provider commands:

```text
wrangler d1 execute hms-super-admin-production-apac --env production --remote --json --command <allowlisted SQL>
```

7. reject any command argument containing `--yes`, `--file`, mutation verbs, or an unexpected database/environment;
8. require successful read-only D1 metadata;
9. retain only normalized schema names, aggregate rows, and duration;
10. write evidence with `flag: 'wx'`, mode `600`, outside the repository;
11. print only a minimal receipt.

- [ ] **Step 4: Add package command**

Add:

```json
"canonical:identity-episode-production-observe": "tsx scripts/canonical/collect-identity-episode-production-observation.ts"
```

- [ ] **Step 5: Run collector and adjacent focused tests**

```bash
pnpm vitest run test/canonical/identity-episode-production-observation-authorization.test.ts test/canonical/identity-episode-production-observation.test.ts test/canonical/collect-identity-episode-production-observation.test.ts
```

- [ ] **Step 6: Commit the collector slice**

```bash
git add scripts/canonical/collect-identity-episode-production-observation.ts test/canonical/collect-identity-episode-production-observation.test.ts package.json
git commit -m "feat(canonical): collect identity episode production observation"
```

---

### Task 4: Local verification and protected authorization materialization

**Files:**
- Create outside repository: protected authorization JSON under a mode-`700` directory.
- No repository source change required unless verification finds a defect.

**Interfaces:**
- Consumes the verified collector CLI.
- Produces a validated protected authorization file for the user-approved read-only scope.

- [ ] **Step 1: Run focused tests, TypeScript, and governance**

```bash
pnpm vitest run test/canonical/identity-episode-production-observation-authorization.test.ts test/canonical/identity-episode-production-observation.test.ts test/canonical/collect-identity-episode-production-observation.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
```

- [ ] **Step 2: Materialize the protected authorization**

Use current UTC timestamps with:

- issuance at materialization;
- observation start no earlier than issuance;
- observation end within two hours;
- expiry equal to observation end plus thirty minutes.

Write outside the repository, require directory mode `700` and file mode `600`, and validate it offline before any production call.

- [ ] **Step 3: Run authorization validation only**

Invoke the collector in a validation-only mode or exported loader test harness and require zero network calls.

- [ ] **Step 4: Record the exact protected authorization path only in the active local session, not in Git or stdout receipts**

No protected path, authorization ID, owner ID, UUID, or hash may be written into repository documentation.

---

### Task 5: Execute the authorized production read-only observation

**Files:**
- Create outside repository: protected observation evidence JSON.
- Create repository receipt only after execution using aggregate, non-sensitive values.

**Interfaces:**
- Consumes the protected authorization and collector CLI.
- Produces aggregate-only production truth and a decision for the next checkpoint.

- [ ] **Step 1: Run the collector against production**

```bash
pnpm canonical:identity-episode-production-observe -- --authorization <protected-auth.json> --output <protected-evidence.json>
```

- [ ] **Step 2: Verify execution safety**

Require:

- exact production database identity;
- one warm-up plus five measured read-only queries;
- zero command failures;
- `changed_db=false` for every query;
- `rows_written=0` for every query;
- all five flags disabled;
- no raw or sensitive output;
- protected evidence file mode `600`.

- [ ] **Step 3: Classify the next action**

- zero mapping blockers and clean observation: next checkpoint is a separately authorized shadow-route canary design;
- mapping blockers present: next checkpoint is an exact bounded production backfill/reconciliation preparation;
- any safety/evidence issue: stop with legacy state unchanged.

---

### Task 6: Receipt, tracker, continuity, and final checkpoint commits

**Files:**
- Create: `docs/database/migration-runs/production/CDB-113G-identity-episode-production-readonly-observation.md`
- Modify: `task-progress.yaml`
- Modify: `docs/architecture/canonical-program-control-center.md`
- Modify: `.ai-bridge/current-plan.md`
- Modify: `test/canonical/canonical-program-continuity-contract.test.ts`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Consumes aggregate collector receipt and exact commit hashes.
- Produces a durable non-sensitive checkpoint handoff and one exact next action.

- [ ] **Step 1: Write RED continuity assertions for CDB-113G**

Require current checkpoint, design/implementation commits, provider/iteration counts, read-only safety state, evidence/observation/promotion decisions, mapping blocker count, and exact next action.

- [ ] **Step 2: Update receipt, tracker, control center, and handoff**

Do not include protected paths, authorization IDs/hashes, database UUID, source IDs, raw query output, or PHI.

- [ ] **Step 3: Run complete verification**

```bash
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

Run the focused IPD discharge test added by the reviewed main sync as an adjacent merge verification.

- [ ] **Step 4: Commit metadata and leave a clean worktree**

Stage exact CDB-113G files only and create a final metadata commit. Do not push or integrate CDB to `main`.

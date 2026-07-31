# LIS Safety Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unsafe direct analyzer-result handling with replay-safe staging, exact matching, fail-closed clinical gates, atomic acceptance, durable critical communication, and analyzer-specific verification evidence.

**Architecture:** Incoming analyzer messages are identified and stored once, then each observation is staged in an immutable inbox. Matching, QC, validation, and review determine eligibility; only an authorized acceptance service changes canonical patient results. External notifications and bridge work use durable outbox/queue patterns.

**Tech Stack:** TypeScript 5.9, Hono, Zod, Cloudflare Workers, D1/SQLite, Vitest, Playwright, local Node.js analyzer bridge.

## Global Constraints

- Preserve tenant isolation on every query and uniqueness constraint.
- Clinical evidence writes must not be catch-and-ignore.
- Unknown message/result/QC states fail closed.
- Analyzer receive/reprocess must not automatically publish a report.
- Use test-first RED/GREEN/REFACTOR for each behavior change.
- Do not modify unrelated current branch changes.
- New migration prefix starts at `0404`.
- Raw and normalized values, units, statuses, and interpretations remain separately traceable.

---

## File map

### New files

- `migrations/0404_lis_analyzer_safety_inbox.sql` — message replay ledger, immutable observation inbox, critical event outbox, tenant-scoped constraints.
- `src/lib/lis-ingestion.ts` — message hashing/identity, exact candidate selection, staging state helpers.
- `src/lib/lis-clinical-mapping.ts` — fail-closed status/interpretation normalization and raw/normalized value model.
- `src/services/lis-result-acceptance.ts` — authorized canonical acceptance command.
- `test/lis-ingestion-safety.test.ts` — unit tests for identity, replay, collision, matching, and state decisions.
- `test/lab-machine-staging.test.ts` — route tests proving receive stages rather than overwrites.
- `test/lis-result-acceptance.test.ts` — atomic acceptance, supersession, audit, and critical outbox tests.
- `test/fixtures/lis/` — de-identified golden HL7/ASTM messages.
- `docs/lis-validation-pack.md` — IQ/OQ/PQ and site sign-off checklist.

### Modified files

- `src/lib/hl7-parser.ts` — strict message validation, abnormal/status preservation, no false critical mapping.
- `src/lib/astm-parser.ts` — strict checksum and unknown-status handling.
- `src/routes/tenant/labMachines.ts` — stage-only receive/reprocess and acceptance/reconciliation routes.
- `src/middleware/lis-bridge-auth.ts` — delivery identity and later per-agent signing.
- `src/routes/tenant/labWorkflow.ts` — enforce transition and separation-of-duty invariants.
- `tools/lab-middleware/index.js` — delivery ID, durable acknowledgement policy, signed request support.
- `tools/lab-middleware/retry-queue.cjs` — transactional/encrypted queue lifecycle.
- `package.json` — dedicated LIS safety verification commands.

---

### Task 1: Protocol fail-closed behavior

**Files:**
- Modify: `src/lib/hl7-parser.ts`
- Modify: `src/lib/astm-parser.ts`
- Test: `test/lab-lis.test.ts`
- Test: `test/lis-ingestion-safety.test.ts`

**Interfaces:**
- Produces: `validateHL7ClinicalMessage(parsed): { valid: boolean; errors: string[] }`
- Produces: normalized result status may be `unrecognized`; caller must quarantine it.
- Produces: HL7 `A` maps to abnormal, not critical.

- [ ] Write failing tests for HL7 `A`, unknown HL7 status, empty ORU, ASTM checksum `00` mismatch, missing ASTM status, and unknown ASTM status.
- [ ] Run focused tests and confirm failures are caused by existing permissive behavior.
- [ ] Implement strict checksum validation and fail-closed status mapping.
- [ ] Add message validation requiring MSH, supported message type, and at least one result/query.
- [ ] Run focused tests and typecheck.

### Task 2: Replay ledger and immutable analyzer inbox

**Files:**
- Create: `migrations/0404_lis_analyzer_safety_inbox.sql`
- Create: `src/lib/lis-ingestion.ts`
- Test: `test/lis-ingestion-safety.test.ts`
- Test: `test/integration/schemas/lis-analyzer-safety.test.ts`

**Interfaces:**
- `sha256Hex(payload: string): Promise<string>`
- `buildLisMessageIdentity(input): string`
- `classifyReplay(existingHash, incomingHash): 'new' | 'duplicate' | 'collision'`
- `selectExactCandidate<T>(candidates: T[]): { kind: 'none' | 'exact' | 'ambiguous'; candidate?: T }`

- [ ] Write failing unit tests for deterministic tenant/machine-scoped identities, duplicate replay, hash collision, and exact-one matching.
- [ ] Write failing schema tests for unique `(tenant_id, machine_id, message_identity)` and immutable observation fields.
- [ ] Add tables `lis_ingestion_messages`, `lis_analyzer_inbox`, and `lis_critical_event_outbox` with tenant-scoped indexes.
- [ ] Implement identity/hash/matching helpers.
- [ ] Run schema/unit tests and migration manifest build.

### Task 3: Stage-only analyzer receive path

**Files:**
- Modify: `src/routes/tenant/labMachines.ts`
- Test: `test/lab-machine-staging.test.ts`
- Test: `test/lab-machine-integration-readiness.test.ts`

**Interfaces:**
- Receive routes return `{ disposition, messageId, inboxIds, outcomes }`.
- `duplicate` returns prior disposition without new clinical writes.
- `collision` returns HTTP 409.
- Staging outcome states include `unmatched`, `ambiguous`, `qc_blocked`, `validation_blocked`, and `review_required`.

- [ ] Write failing route tests proving receive does not update `lab_order_items` or insert `lab_results`.
- [ ] Write failing tests for empty message rejection, duplicate delivery, collision, zero candidate, and multiple candidates.
- [ ] Refactor matching query to return at most two candidates and reject ambiguity.
- [ ] Stage observations with raw/normalized fields and patient/specimen context.
- [ ] Pass canonical patient ID into validation and record skipped/unavailable rules explicitly.
- [ ] Remove billing as a clinical-ingestion blocker; retain billing state as release metadata.
- [ ] Run all lab/lis tests.

### Task 4: Atomic result acceptance

**Files:**
- Create: `src/services/lis-result-acceptance.ts`
- Modify: `src/routes/tenant/labMachines.ts`
- Test: `test/lis-result-acceptance.test.ts`

**Interfaces:**
- `acceptStagedLisResult(db, input): Promise<AcceptanceResult>`
- Eligible states: `review_required` or `acceptance_eligible` according to permission policy.
- Writes one D1 batch: canonical result, observation audit, inbox state/version, workflow event, parent status, critical outbox.

- [ ] Write failing tests for unauthorized acceptance, stale version, self-approval restriction, atomic batch failure, correction supersession, and critical outbox creation.
- [ ] Implement acceptance service with optimistic version check and D1 batch.
- [ ] Add acceptance/rejection routes with governance roles.
- [ ] Ensure changed values create supersession rather than destructive overwrite.
- [ ] Run acceptance, workflow, and tenant-isolation tests.

### Task 5: Structured clinical normalization

**Files:**
- Create: `src/lib/lis-clinical-mapping.ts`
- Modify: `src/routes/tenant/labMachines.ts`
- Modify: relevant lab configuration migrations/routes
- Test: `test/lis-clinical-normalization.test.ts`

**Interfaces:**
- `normalizeMachineObservation(input): NormalizedObservation`
- Stores raw and normalized value/unit/range separately.
- Critical status requires explicit configured limit or validated explicit device code.

- [ ] Write failing tests for converted value/unit/range consistency, negative/scientific values, `<`/`>` ranges, qualitative results, and absent critical limits.
- [ ] Implement structured normalization and reject dimensionally inconsistent conversion.
- [ ] Add effective-dated reference interval and critical-limit resolution.
- [ ] Run formula, validation, and report rendering tests.

### Task 6: QC and calibration fail-closed policy

**Files:**
- Modify: `src/routes/tenant/labMachines.ts`
- Create: `src/lib/lis-qc-gate.ts`
- Test: `test/lab-machine-qc-detection.test.ts`
- Test: `test/lis-qc-fail-closed.test.ts`

**Interfaces:**
- `evaluateLisQcGate(...): { state: 'pass'|'fail'|'not_run'|'stale'|'config_missing'|'system_error'|'override'; eligible: boolean; reason: string }`

- [ ] Write failing tests for missing schema, query failure, missing QC, stale QC, failed calibration, and audited override.
- [ ] Extract QC gate into a focused module.
- [ ] Replace all permissive catches with explicit blocked states.
- [ ] Add analyzer activation readiness check.
- [ ] Run QC, calibration, and route tests.

### Task 7: Durable critical-result communication

**Files:**
- Modify: `src/services/lis-result-acceptance.ts`
- Add/modify notification worker/queue consumer
- Test: `test/lis-critical-communication.test.ts`

**Interfaces:**
- Critical outbox rows carry accountable recipient policy, attempts, deadline, acknowledgement, escalation, and terminal state.

- [ ] Write failing tests for outbox creation, retry, acknowledgement, escalation, and unresolved closure blocking.
- [ ] Implement queue consumer and acknowledgement route.
- [ ] Add monitoring metrics for acknowledgement time and overdue events.
- [ ] Run notification and LIS workflow tests.

### Task 8: Per-agent authentication and replay protection

**Files:**
- Modify: `migrations/0404_lis_analyzer_safety_inbox.sql` or add next migration
- Modify: `src/middleware/lis-bridge-auth.ts`
- Modify: `tools/lab-middleware/index.js`
- Test: `test/lis-bridge-auth.test.ts`

**Interfaces:**
- Headers include key ID, delivery ID, timestamp, nonce, body SHA-256, and HMAC signature.
- Credentials are tenant/agent/machine scoped, rotatable, and revocable.

- [ ] Write failing tests for wrong tenant, expired timestamp, nonce replay, body tampering, revoked key, and rotation overlap.
- [ ] Implement constant-time verification and nonce ledger.
- [ ] Preserve a controlled migration path from the current global key.
- [ ] Run security and bridge tests.

### Task 9: Local bridge transactional durability

**Files:**
- Modify: `tools/lab-middleware/index.js`
- Modify: `tools/lab-middleware/retry-queue.cjs`
- Test: `test/lab-middleware-retry-queue.test.ts`
- Add bridge integration tests

**Interfaces:**
- Positive ASTM/MLLP acknowledgement only after durable local commit.
- Queue states: active, retrying, dead-letter, acknowledged.

- [ ] Write failing crash/restart, corruption, duplicate-delivery, and terminal-failure monitoring tests.
- [ ] Replace direct JSON writes with transactional local storage or atomic fsync/rename journal.
- [ ] Add encryption-at-rest, integrity MAC, locking, retention, and secure log redaction.
- [ ] Run bridge fault-injection tests.

### Task 10: Analyzer validation pack and release gate

**Files:**
- Create: `test/fixtures/lis/*`
- Create: `docs/lis-validation-pack.md`
- Modify: `package.json`
- Add protocol simulator and end-to-end tests

- [ ] Add de-identified golden messages and expected normalized observations.
- [ ] Add malformed, duplicate, corrected, deleted, wrong-patient, checksum, partial-frame, and out-of-order cases.
- [ ] Add `test:lis:safety`, `test:lis:protocol`, and `test:lis:release` commands.
- [ ] Document IQ/OQ/PQ, reconciliation, downtime, restore, and clinical sign-off evidence.
- [ ] Run full unit, integration, security, E2E, load, typecheck, and build gates.

---

## Implementation status — 2026-07-10

### Completed and verified

- Tasks 1–4: fail-closed protocol handling, replay/collision ledger, immutable stage-only receive/reprocess, and governed atomic acceptance.
- Task 5 safety subset: raw/normalized traceability, signed/scientific/one-sided ranges, and explicit-only critical limits.
- Task 6: QC/calibration fail-closed states integrated into staging.
- Task 7 safety core: durable critical outbox, acknowledgement, optimistic closure, and overdue escalation service/API.
- Task 8: per-key HMAC signing, tenant/machine scope, timestamp/body binding, nonce replay protection, revocation/expiry, and controlled legacy fallback.
- Task 9 durability core: encrypted atomic retry queue, stable delivery identity, corruption quarantine, strict ASTM checksum, and encrypted fsync transmission journal before positive frame ACK.
- Task 10 core: golden protocol fixtures, IQ/OQ/PQ validation pack, dedicated LIS release commands, real SQLite acceptance commit/rollback tests, typecheck, migration build, and production build.
- Reviewer workflow: machine-scoped analyzer inbox queue, evidence detail, pagination/search/filtering, governed accept/reject actions, view-only laboratory access, and immutable terminal decisions via migration `0405_lis_inbox_terminal_decisions.sql`.
- Controlled supersession workflow: same-test target search, immutable correction/rematch rows, explicit QC/validation override evidence, one-direct-successor uniqueness, atomic command audit, second-reviewer separation of duty, and operator UI via migration `0406_lis_inbox_supersession_workflow.sql`.

### Remaining deployment/product work

- Formal accepted-result retraction workflow for moving or withdrawing a previously published result, including clinician/patient notification and amended-report lifecycle.
- Effective-dated demographic reference intervals and full UCUM dimensional conversion governance.
- External critical-notification dispatcher/scheduler and operational monitoring dashboards.
- Database-managed bridge-key lifecycle/rotation UI and nonce-retention cleanup job.
- Vendor/analyzer-specific protocol profiles, physical device testing, load/reconnect tests, and hospital IQ/OQ/PQ clinical sign-off.

### Verification evidence

- `pnpm test:lis:release`: 61 safety files / 459 tests, 6 protocol-security files / 85 tests, and 3 reviewer UI files / 27 tests passed; TypeScript and bridge syntax passed.
- Real SQLite acceptance/rejection/supersession tests: 8/8 passed, including atomic rollback, stale-version safety, terminal-source preservation, and immutable successor creation.
- Schema immutability/replay/terminal-decision/supersession tests: 10/10 passed.
- `pnpm build:migrations`: 416 migrations generated successfully.
- `pnpm build`: production builds passed.

The engineering safety foundation is suitable for a controlled, human-reviewed pilot after site validation. It is not approval for unattended auto-publication or a substitute for laboratory IQ/OQ/PQ and clinical governance sign-off.

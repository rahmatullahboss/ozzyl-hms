# CDB-113F Identity and Episode Read-Promotion Implementation Plan

**Program:** HMS Canonical Data Architecture  
**Checkpoint:** `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Reviewed base:** `6ef1c713e`  
**Execution mode:** single-agent, serial, local-only  
**Production mutation authorised:** no  
**Provider activation authorised:** no  
**Local-sync activation authorised:** no  
**Legacy reader/writer retirement authorised:** no  
**Push or CDB-to-main integration authorised:** no

## 1. Goal

Complete the local identity/episode read-promotion foundation by mapping every active identity/episode reader to one reviewed provider, adding the missing patient identity provider, producing PHI-minimised shadow parity evidence, proving selected adapter behaviour, and implementing a fail-closed local readiness checker. Preserve legacy runtime behaviour and keep all provider flags disabled.

Local completion means the codebase can prove which provider owns each reader and whether a selected consumer is locally ready for a later separately authorised canary. It does not mean production cutover.

## 2. Reviewed inputs

Read and obey:

1. `agents.md`;
2. `.agent-rules/git-workflow.md`;
3. `.agent-rules/architecture.md`;
4. `.agent-rules/coding-rules.md`;
5. `.agent-rules/data-storage.md`;
6. `docs/database-guide.md`;
7. `docs/architecture/canonical-program-control-center.md`;
8. `.ai-bridge/current-plan.md`;
9. `task-progress.yaml`;
10. `docs/database/audits/2026-07-27-identity-episode-read-promotion-audit.md`;
11. `docs/database/canonical-authority-matrix.yaml`;
12. targeted entries from `docs/database/canonical-authority-access-registry.yaml`;
13. the CDB-113B through CDB-113E receipts;
14. the current patient/practitioner/appointment/encounter/admission-bed commands and providers.

## 3. Architecture contract

- Patient identity provider owns tenant-patient relationship evidence, not duplicated demographics.
- Practitioner provider owns practitioner identity and explicit account/employee/identifier/classification relationships.
- Appointment provider owns planned intent.
- Encounter provider owns actual care.
- Admission/bed provider owns inpatient lifecycle, care-location identity, bed-resource identity, and interval occupancy.
- Authentication, finance, diagnosis, clinical narrative, nursing assignment, and display labels remain outside these provider authorities.
- Every eligible exact `path + table` reader receives exactly one provider assignment.
- Mixed legacy sources use reviewed path/table rules, never value heuristics.
- Missing, disabled, malformed, or unsupported provider configuration remains legacy.
- Shadow mode returns legacy behaviour and records aggregate parity only.
- Canonical mode fails closed without exact mapping, tenant, lifecycle, and parity evidence.
- Rollback changes provider mode to legacy and never deletes canonical evidence.
- All repository/runtime defaults keep provider flags disabled.
- No production, remote, sync, retirement, push, or integration action occurs.

## 4. Serial implementation sequence

### CDB-113F.1 — Audit, design contract, and plan

Outputs:

- `docs/database/audits/2026-07-27-identity-episode-read-promotion-audit.md`;
- this plan;
- `test/canonical/identity-episode-read-promotion-design-contract.test.ts`.

Verification:

- documents record the exact 616-reader inventory;
- five provider families and authority boundaries are explicit;
- mixed `consultations` classification is deterministic;
- patient provider gap is explicit;
- shadow privacy, variance, readiness, rollback, retirement, and safety contracts are test-locked.

Commit:

`docs(canonical): define identity episode read promotion`

### CDB-113F.2 — Deterministic provider coverage registry

Use RED tests first.

Target files:

- `scripts/canonical/identity-episode-provider-coverage.ts`;
- `scripts/canonical/generate-identity-episode-provider-coverage-registry.ts`;
- `scripts/canonical/check-identity-episode-provider-coverage.ts`;
- `docs/database/canonical-identity-episode-provider-coverage-registry.json`;
- `test/canonical/identity-episode-provider-coverage.test.ts`;
- `package.json` scripts.

Required behaviour:

- parse the current access registry deterministically;
- select entries whose concept IDs intersect the reviewed identity/episode concepts;
- assign exactly one provider using reviewed table/path rules;
- preserve source `providerStatus`, concepts, domains, and path/table evidence;
- create stable non-PHI consumer IDs;
- record provider module, flag key, rollback mode, and local adoption state;
- record the source registry SHA-256;
- produce exact summary counts: 616 eligible, 249 paths, 41 tables, zero unknown;
- fail closed on drift, duplicates, unknown provider, count mismatch, stale hash, missing module/flag, or invalid classification;
- remain deterministic across repeated generation.

Selected local-adoption consumer IDs must cover representative patient, practitioner, appointment, encounter, and admission/bed adapters while not claiming route cutover.

Commit:

`feat(canonical): register identity episode reader providers`

### CDB-113F.3 — Disabled-safe patient identity provider

Use RED tests before implementation.

Target files:

- `src/lib/canonical/patient-identity-provider.ts`;
- `test/canonical/patient-identity-provider.test.ts`;
- access registry regeneration after implementation.

Provider flag:

- `canonical_patient_identity_provider_v1`;
- supported modes: `legacy`, `shadow`, `canonical`;
- absent/disabled/malformed/unsupported flag: `legacy`.

Required input:

- exact tenant ID;
- positive legacy patient ID;
- optional `identitySensitive` marker.

Legacy facts may include the existing legacy patient projection needed by stable route contracts, but parity receipts must never include those fields.

Canonical relationship facts must include:

- `patient_link_public_id`;
- exact legacy patient ID;
- link status;
- verification level;
- evidence type/hash classification;
- optional global identity/UHID relationship when explicitly present;
- positive relationship version;
- effective interval.

Required semantics:

- legacy mode returns legacy projection and available relationship ID;
- shadow mode returns legacy projection plus aggregate parity booleans;
- canonical mode requires one exact active patient link for the same tenant and legacy patient;
- multiple active links, cross-tenant evidence, retired/rejected link, or identity-sensitive missing mapping fails closed;
- phone/name similarity is never queried or accepted as mapping evidence;
- patient demographics are not copied to canonical relationship tables;
- provider exposes detail/link/auth-scope adapter functions without route activation.

Commit:

`feat(canonical): add patient identity read provider`

### CDB-113F.4 — PHI-minimised shadow evidence and selected adapters

Use RED tests first.

Target files:

- `src/lib/canonical/identity-episode-shadow-evidence.ts`;
- `src/lib/canonical/identity-episode-read-adapters.ts`;
- `test/canonical/identity-episode-shadow-evidence.test.ts`;
- `test/canonical/identity-episode-read-adapters.test.ts`;
- access registry regeneration.

Shadow evidence must:

- accept provider parity booleans and non-PHI source keys;
- create stable SHA-256 variance IDs;
- classify reviewed variance classes;
- record comparison count, elapsed milliseconds, error count, mode, rollback mode, and observed-at UTC;
- reject or strip forbidden PHI/clinical/financial keys;
- never include provider result payloads;
- mark latency budget variance independently;
- preserve intentional/accepted exception IDs explicitly.

Selected adapters must:

- expose one stable library boundary for each provider family;
- call existing provider modules, not private canonical table queries;
- preserve legacy-default behaviour;
- expose shadow evidence without changing returned legacy route projection;
- fail closed in canonical mode when provider-specific mapping/parity requirements fail;
- support rollback by returning to legacy mode with canonical evidence retained.

Commit:

`feat(canonical): add identity episode shadow read adapters`

### CDB-113F.5 — Fail-closed local readiness and retirement gates

Use RED tests first.

Target files:

- `scripts/canonical/check-identity-episode-read-promotion-readiness.ts`;
- `docs/database/identity-episode-read-promotion-evidence.json`;
- `docs/database/legacy-write-retirement-gates.yaml`;
- `test/canonical/identity-episode-read-promotion-readiness.test.ts`;
- `test/canonical/legacy-write-retirement-readiness.test.ts` only when its reviewed contract requires extension;
- `package.json` scripts.

The readiness evidence must be local and non-production. It records:

- coverage registry hash and exact counts;
- five provider modules and flag keys;
- selected adapter IDs;
- focused test evidence;
- patient/practitioner/appointment/encounter/admission-bed second-pass evidence references;
- mapping/issue policy;
- zero critical unexplained local fixture variance;
- latency and error thresholds;
- rollback mode and command description;
- provider flags disabled by default;
- production observation absent;
- owner authorisation absent;
- legacy retirement blocked.

Checker rules:

- fail on stale or incomplete coverage;
- fail on missing provider/test/evidence reference;
- fail on enabled-by-default provider or production-cutover claim;
- fail on critical unresolved variance;
- fail on missing rollback or accepted-exception governance;
- report `localReady=true` only for local selected-adapter readiness;
- always report `productionReady=false` until separately authorised evidence exists;
- never mutate flags or traffic.

Retirement gates add blocked domains for:

- `patient_identity`;
- `practitioner_identity`;
- `appointment_intent`;
- `encounter_care_episode`;
- `inpatient_admission_bed_occupancy`.

Every new gate keeps production cutover, read promotion, observation, rollback freshness, owner authorisation, and all retirement approvals false.

Commit:

`feat(canonical): gate identity episode read promotion`

### CDB-113F.6 — Final verification, receipt, and continuity

Target files:

- `docs/database/migration-runs/P11-canonical-identity-episode-read-promotion.md`;
- `docs/architecture/canonical-program-control-center.md`;
- `task-progress.yaml`;
- `.ai-bridge/current-plan.md`;
- `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`;
- continuity tests.

Run fresh:

```text
pnpm vitest run <CDB-113F focused files>
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm canonical:identity-episode-coverage-check
pnpm canonical:identity-episode-readiness
pnpm vitest run test/canonical --testTimeout=15000
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

Run web/patient/admin builds only if those runtime surfaces changed.

Update exact commits, counts, blockers, safety state, and next action. Commit metadata separately and leave the worktree clean.

## 5. Test matrix

### Coverage registry

- exact source hash;
- deterministic output;
- 616 eligible reader pairs;
- 249 unique paths;
- 41 unique tables;
- zero unknown provider;
- exactly one provider per entry;
- mixed consultation classification;
- five provider modules/flags/rollback modes;
- stale/duplicate/unknown drift rejection.

### Patient provider

- missing table/flag and disabled flag remain legacy;
- shadow returns legacy projection and parity only;
- canonical exact active link;
- identity-sensitive missing link fails;
- multiple active links fail;
- rejected/retired link fails;
- cross-tenant isolation;
- no name/phone matching query;
- PHI absent from parity.

### Shadow evidence

- deterministic variance IDs;
- reviewed variance classes;
- latency budget classification;
- critical/unexplained classification;
- accepted exception handling;
- forbidden key rejection/scrubbing;
- no provider payload logging;
- stable aggregate receipt.

### Selected adapters

- one adapter per provider family;
- disabled-default legacy response;
- shadow response remains legacy;
- canonical fail-closed behaviour;
- privacy and tenant isolation;
- rollback mode evidence.

### Readiness

- complete local fixture evidence passes local readiness;
- stale coverage fails;
- unknown consumer fails;
- critical variance fails;
- missing second-pass evidence fails;
- enabled-by-default flag fails;
- production-ready claim fails;
- missing rollback fails;
- retirement gates remain blocked.

## 6. Stop conditions

Stop before any action requiring:

- production/protected-clone access;
- credentials or secrets;
- deployment, migration/backfill application, flag, or traffic change;
- local-sync runtime registration or activation;
- automatic patient/practitioner/episode merge from ambiguous evidence;
- signed clinical history alteration;
- destructive schema change;
- legacy reader/writer removal;
- production canary execution;
- push or CDB-to-main integration;
- a new authority conflicting with the reviewed matrix.

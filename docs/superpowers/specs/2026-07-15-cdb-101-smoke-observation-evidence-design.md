# CDB-101 Smoke/Observation Evidence Design

## Problem

CDB-101 authorizes the tenant `100` reporting shadow plan, thresholds, owners, and rollback policy, but completed observation results can exist only after migration, import, and initial shadow-flag stages. Making completed results a precondition of those stages would create a circular dependency. An unbound result pack would also be unsafe because its plan, thresholds, observers, timing, or decision window could drift from the protected authorization.

## Decision

Add a standalone post-stage validator. It runs after the tenant `100` reporting shadow stage and before any GO/promotion or rollback decision. Existing pre-mutation wrappers and deterministic command IDs remain unchanged.

The validator accepts two protected files outside the repository:

- the completed smoke/observation evidence document;
- the exact schema-v2 reporting authorization document.

It reuses `prepareProtectedReportingCutoverAuthorization`, remains local and offline, emits only aggregate metrics, and rejects execution-style arguments.

## Authorization binding

The completed evidence must exactly match the protected authorization for:

- authorization ID;
- tenant `100`;
- reporting domain;
- shadow mode;
- smoke plan ID;
- exact ordered 12-scenario registry;
- maximum p95 latency;
- maximum error rate;
- observation primary and backup owner IDs;
- rollback maximum duration;
- reopen maximum duration.

Observation must start at or after the authorized shadow effective time. Observer decision time, evidence generation time, and validation time must remain within authorization expiry. The authorization must pass its existing schema-v2 semantic validation at the supplied validation time.

## Evidence model

The document contains:

- exact authorization and scope binding;
- exact observation window;
- the exact ordered 12-scenario registry;
- per-scenario aggregate pass evidence;
- parity and performance thresholds plus observed aggregates;
- tenant-isolation, role-denial, and read-only proofs;
- distinct primary/backup observer confirmations and GO/NO-GO decision;
- reviewed rollback/reopen policy thresholds;
- recovery measurement kind and measurement UTC;
- separate policy and timing evidence IDs/SHA-256 values;
- measured rollback and reopen durations;
- monotonic chronology and unique ID/hash bindings.

Accepted recovery measurement kinds are `rehearsal` and `controlled_drill`. Policy evidence and timing measurement evidence are separate artifacts and cannot reuse an ID or hash.

## Chronology

The validator requires:

1. policy review;
2. timing measurement;
3. shadow effective time;
4. observation start;
5. observation end and scenario completions;
6. observer decision;
7. evidence generation;
8. validation time.

Scenario completion must remain inside the observation window. Decision follows observation end, generation follows decision, and validation follows generation.

## Safety boundary

Both protected-file loads reject repository-local files, insecure modes, symlinks, hard links, oversized documents, and excessive nesting. Strict parsing rejects duplicate, unknown, unsafe, sensitive, raw-response, credential, path, and patient-identifying fields.

The receipt omits authorization IDs and hashes, owner/observer identities, evidence IDs and hashes, paths, raw content, UUIDs, commits, and ETags. It always declares that no network request, external command, or production mutation occurred.

## Readiness semantics

The receipt exposes three separate booleans:

- `evidenceReady`: the evidence document is internally valid and audit-ready;
- `authorizationBound`: the evidence exactly matches a valid protected authorization;
- `promotionReady`: `evidenceReady && authorizationBound && decision === "go"`.

A valid `no_go` document is a valid audit record and can be authorization-bound, but it is never promotion-ready.

## Integration

Add aggregate receipt fields to the execution evidence template and document both protected inputs in the operational runbook. Do not add completed evidence to migration, import, or initial feature-flag wrappers, command scopes, or authorization command IDs.

## Testing

Use RED-GREEN-REFACTOR. Cover:

- valid protected authorization binding;
- authorization ID, plan, scenario, threshold, observer, and recovery-policy mismatches;
- observation before shadow effectiveness;
- expired authorization;
- missing or duplicate timing evidence;
- full chronology failures;
- existing scope, scenario, parity, performance, isolation, role, read-only, decision, and recovery failures;
- strict JSON and protected-file enforcement for both inputs;
- CLI missing authorization and `--execute` refusal;
- aggregate receipt leakage prevention;
- valid `no_go` audit semantics;
- absence of network and child-process implementation paths.

# CDB-101 Two-Person Constrained Cutover Design

Date: 2026-07-16

Status: approved in principle by Rahmatullah Zisan; written specification pending final owner review before implementation

## Goal

Permit the CDB-101 tenant-100 reporting cutover to operate with exactly two accountable humans when the company does not have four distinct operational owners, while keeping the process fail-closed, stage-gated, shadow-only, reversible, and explicitly higher risk than the existing four-person contract.

## Current production baseline

- Production Worker version `1128` (`ea0d032e-1514-45cf-bb63-e2374a650c1d`) currently receives 100% production traffic.
- Worker version `1127` (`cce46fb5-1019-4a24-8b7a-5d0c8104f4f3`) remains uploaded but has no deployment traffic.
- Version `1127` was built before the later main-branch fix and is therefore stale for the next cutover.
- The next cutover candidate must be rebuilt from the exact reviewed latest-main commit after the fix.
- The rollback baseline for the next cutover is the then-current 100% production Worker, presently version `1128`, not version `1126`.
- A fresh protected production export and Time Travel bookmark must be captured immediately before the next mutation window. The earlier export remains useful as historical evidence but is not sufficient for the next night's mutation authorization.

## Compatibility strategy

The existing strict four-person schema-v2 contract remains unchanged and valid.

The reduced-owner path is introduced as a new explicit contract version and mode rather than silently weakening schema v2:

- `schemaVersion: 3`
- `ownerModel: "two_person_constrained"`

A schema-v3 authorization is valid only when all requirements in this specification are satisfied. Schema-v2 authorizations continue to require four distinct operational identities.

## Human roles

### Technical operator

Rahmatullah Zisan is the sole technical operator and rollback authority.

Required capabilities and duties:

- remain available for the full maintenance window and observation grace period;
- approve every mutation stage separately;
- run or supervise the reviewed production commands;
- stop progression on any failed gate;
- disable the tenant-100 shadow flag when rollback is required;
- restore the prior Worker deployment if an approved candidate ever receives traffic and must be rolled back;
- decide whether the maintenance window may continue or must close;
- never override a monitoring `NO_GO` decision.

The cutover automatically becomes `NO_GO` when the technical operator is unavailable, loses network access, cannot access Cloudflare, or cannot perform the documented rollback action.

### Monitoring owner

The company staff member is the sole monitoring owner and does not perform Cloudflare, database, deployment, migration, import, or rollback commands.

Required duties:

- perform baseline monitoring before the maintenance window;
- observe login, billing, collections, reporting, latency, errors, tenant isolation, and card/detail parity during the official observation window;
- record aggregate-only results in the incident channel;
- issue `GO_RECOMMENDATION` or `NO_GO` after each required verification checkpoint;
- issue immediate `NO_GO` on any tenant leak, financial mismatch, reporting write, route failure, unexplained error spike, or abnormal latency;
- remain available for the full maintenance window and observation grace period.

A monitoring `NO_GO` is final for that stage. A monitoring `GO_RECOMMENDATION` does not authorize mutation; the technical operator must still issue the exact next-stage approval.

## Distinctness requirement

Exactly two distinct human identities are required:

1. one technical operator;
2. one monitoring owner.

The technical operator and monitoring owner cannot be the same person. No backup identities are required in this constrained mode. Missing either person, duplicated identities, or missing acknowledgements fails closed.

## Explicit risk acceptance

Schema v3 adds a protected `twoPersonRiskAcceptance` object requiring:

- `accepted: true`;
- exact owner identifier for Rahmatullah Zisan;
- absolute UTC acceptance timestamp;
- evidence identifier and SHA-256;
- `noTechnicalBackupAccepted: true`;
- `noMonitoringBackupAccepted: true`;
- `automaticAbortOnTechnicalOperatorUnavailable: true`;
- `automaticAbortOnMonitoringOwnerUnavailable: true`;
- `shadowOnlyAccepted: true`;
- `canonicalPromotionProhibited: true`;
- `workerTrafficChangeProhibited: true` for this cutover package.

The validator rejects generic risk language, null evidence, reused evidence identifiers, or an authorization that permits canonical promotion or Worker traffic assignment.

## Communication channel

Both humans must acknowledge one real incident channel before the maintenance window. The evidence stores a safe identifier for the channel, not chat content.

The channel is used for:

- owner acknowledgements;
- stage approval messages;
- monitoring decisions;
- timestamps;
- rollback decisions;
- maintenance closeout.

## Stage-gated execution

No blanket execution approval exists. The following stages require separate exact approvals and confirmations in order:

1. active financial FK repair for exactly eight reviewed rows;
2. post-repair FK verification proving only the 41 archival violations remain;
3. canonical migrations `0502` through `0512`;
4. post-migration schema and migration-manifest verification;
5. deterministic tenant-100 canonical import;
6. required second-pass verification proving zero inserted rows;
7. processing evidence proving all seven blocking counters are zero;
8. tenant-100 `canonical_reporting_v1` shadow flag only;
9. smoke and observation decision.

A stage approval expires when that stage completes, fails, the maintenance window ends, evidence changes, or any bound command ID changes. Approval for one stage never authorizes the next stage.

## Prohibited actions

The constrained contract prohibits:

- assigning production traffic to the cutover candidate Worker;
- changing Worker routes or triggers;
- enabling canonical mode;
- promoting beyond tenant `100`;
- enabling a global reporting switch;
- waiving the eight active financial FK violations;
- bypassing a safety-layer refusal;
- continuing after either human becomes unavailable;
- reusing stale candidate, deployment, route, export, bookmark, authorization, command-ID, or evidence hashes.

## Deployment freshness

Any production deployment after candidate creation invalidates the candidate and its Worker evidence for cutover purposes.

Before the next maintenance window the system must:

1. identify the current 100% production Worker and record it as the rollback baseline;
2. freeze the exact reviewed latest-main commit;
3. build and test from that commit;
4. upload a new immutable candidate version with zero traffic;
5. verify the candidate is absent from production deployment traffic;
6. regenerate Worker build/version evidence, route evidence, authorization hashes, and deterministic command IDs.

Therefore the current version `1127` must not be used for the next cutover. A new candidate version must be created after the main-branch fix is included and reviewed.

## Monitoring schedule

### Baseline monitoring

Baseline monitoring may begin immediately while Worker `1128` serves normal production traffic. It does not authorize or validate the cutover. The monitoring owner records normal behavior for:

- login;
- billing creation and viewing;
- collections and receipts;
- reporting pages;
- normal response speed;
- visible errors;
- tenant isolation.

### Official cutover monitoring

Official monitoring begins immediately before the first mutation in the approved maintenance window and continues through the observation grace period. Fresh pre-mutation results are required even when baseline monitoring was completed earlier.

## Failure and rollback behavior

The process stops immediately when:

- either human is unavailable;
- the monitoring owner issues `NO_GO`;
- a stage command or evidence hash mismatches;
- the maintenance authorization expires;
- a candidate or live Worker changes after evidence capture;
- the protected export or Time Travel evidence is missing or stale;
- active FK violations remain after repair;
- the second import pass writes rows;
- processing evidence contains a non-zero blocking count;
- tenant isolation, financial parity, route stability, latency, or error thresholds fail;
- a safety layer refuses the requested operation.

Rollback priority remains:

1. stop stage progression;
2. disable the tenant-100 shadow flag if enabled;
3. verify legacy route health;
4. restore the recorded production Worker baseline only if candidate traffic had separately been authorized and assigned in a future package;
5. keep canonical writes and promotion closed;
6. use Time Travel restore only under separate explicit restore authorization.

## Authorization and evidence changes

Implementation will add schema-v3 support to:

- authorization document parsing;
- production cutover contract validation;
- maintenance/recovery evidence validation;
- deterministic command-ID generation;
- migration, import, and flag wrapper gates;
- reporting preflight;
- smoke/observation evidence binding;
- authorization and evidence templates;
- operational runbook and tests.

The new mode must not relax schema-v2 behavior.

## Verification requirements

Implementation is complete only when tests prove:

- schema v2 still rejects fewer than four distinct owner identities;
- schema v3 accepts exactly two distinct acknowledged humans with valid risk acceptance;
- schema v3 rejects one person in both roles;
- schema v3 rejects backup identities as a substitute for the required two primaries;
- schema v3 rejects canonical promotion, global scope, candidate traffic assignment, or tenants other than `100`;
- schema v3 rejects unavailable-owner evidence and monitoring `NO_GO` progression;
- each mutation wrapper refuses without an exact current-stage approval;
- later production deployment invalidates stale candidate evidence;
- no wrapper invokes external mutation commands when any new gate fails;
- all existing canonical, authorization, maintenance, smoke, route, and wrapper regression suites pass.

## Production boundary

Writing and implementing this contract does not authorize FK repair, migration, import, shadow flag enablement, Worker traffic change, restore, deployment, or canonical promotion. Tomorrow night's production work requires a fresh maintenance window, current evidence, exact identities, acknowledgements, and separate stage approvals.

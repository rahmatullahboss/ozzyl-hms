# LIS Safety Hardening Design

**Date:** 2026-07-10
**Approved baseline:** `docs/lis-enterprise-safety-review-2026-07-10.md`
**Scope:** Analyzer-to-clinical-result safety, integrity, traceability, authorization, and verification.

## Goal

Convert the current analyzer integration from a direct application write path into a safety-controlled laboratory transaction that preserves every incoming observation, rejects ambiguity, prevents replay, fails closed on uncertain clinical state, and requires an explicit acceptance boundary before canonical patient results are changed.

## Architecture decision

The system will use a two-layer result model:

1. **Immutable analyzer inbox** is the source of truth for received machine observations. It stores raw identity, payload hash, parsed value/unit/range/status, matching decision, QC/validation decision, and disposition.
2. **Canonical clinical result** is updated only through an acceptance service after all required gates pass. Receiving or reprocessing a machine message must not directly overwrite a released clinical result.

D1 remains the authoritative relational store. The receive request performs bounded validation and staging only. Later acceptance may remain synchronous for the controlled pilot, but its writes must be packaged as one database batch and emit durable outbox records for critical-value communication and other external work.

## Core data flow

```text
Bridge/analyzer
  -> authenticated request
  -> message identity + payload hash
  -> replay/collision check
  -> parse and profile validation
  -> immutable inbox observation(s)
  -> exact-one specimen/order candidate matching
  -> QC/calibration gate
  -> patient-aware result validation
  -> review_required or acceptance_eligible
  -> authorized accept command
  -> atomic canonical result + audit + workflow event + critical outbox
  -> publish only through existing report governance
```

## State model

Inbox states:

- `received`
- `parsed`
- `unmatched`
- `ambiguous`
- `qc_blocked`
- `validation_blocked`
- `review_required`
- `acceptance_eligible`
- `accepted`
- `rejected`
- `superseded`
- `error`

Message states:

- `received`
- `processing`
- `completed`
- `partial`
- `rejected`
- `collision`
- `error`

Unknown status, missing clinical configuration, database/schema errors, checksum failures, and ambiguous identity never become final or acceptance-eligible.

## Message identity

Each request derives a tenant-and-machine-scoped ingestion identity:

- HL7: sending application, sending facility, message type, MSH-10, and payload SHA-256.
- ASTM: machine, payload SHA-256, and bridge delivery identifier when available.
- JSON: bridge delivery identifier when provided, otherwise payload SHA-256.

Same identity and same hash returns the prior disposition. Same identity with a different hash is quarantined as a collision.

## Matching policy

Automatic matching requires exactly one eligible candidate using tenant, machine mapping, specimen/accession/barcode/order identity, test/component, and non-cancelled state.

- Zero candidates: `unmatched`.
- More than one candidate: `ambiguous`.
- Recency must never resolve ambiguity.

The inbox retains candidate metadata for manual reconciliation. Canonical patient ID and specimen ID must be available before patient-dependent validation can be considered complete.

## Clinical value model

The inbox preserves both raw and normalized forms:

- raw value and unit
- normalized numeric value and canonical unit
- conversion factor/rule version
- analyzer-provided reference range
- LIS-selected structured reference interval
- original analyzer abnormal/status codes
- normalized abnormal interpretation
- separately calculated critical state

Normal, abnormal, directional high/low, and critical/panic state are distinct concepts. Critical limits are laboratory-configured; they are never inferred from a normal interval.

## QC and calibration

QC-controlled analyzers/tests fail closed. Results distinguish:

- `pass`
- `fail`
- `not_run`
- `stale`
- `config_missing`
- `system_error`
- `override`

An override requires authorized identity, reason, timestamp, expiry/scope, and audit. Missing schema or query errors are system errors, not passes.

## Acceptance and correction

The accept command:

1. re-reads the inbox row and verifies its version/state;
2. checks reviewer permissions and separation-of-duty rules;
3. verifies the candidate still points to the same patient/specimen/order;
4. writes canonical result, immutable observation audit, inbox transition, workflow event, parent status, and critical outbox atomically;
5. never destroys the earlier result; changed values create a supersession/correction chain;
6. does not automatically publish the report.

Analyzer-corrected results always require review. Published results continue through the existing formal correction and revalidation workflow.

## Bridge security

Move from one global secret toward per-agent credentials. Phase 1 introduces request delivery identity and replay controls without breaking current deployments. Later phases add per-agent key records, key ID, rotation, revocation, timestamp/nonce signatures, body hash binding, and scoped machine permissions.

## Error handling

Clinical evidence writes are mandatory. Failures creating inbox, audit, critical event, or replay records must return an error and remain visible for recovery. Catch-and-ignore is prohibited for mandatory patient-safety records.

The response must distinguish:

- accepted for staging
- duplicate replay
- collision
- partial staging
- rejected profile/message
- system error

## Testing strategy

### Unit

- HL7 status and interpretation mapping
- ASTM checksum/frame/status behavior
- message identity and hash behavior
- exact-one candidate selection
- QC fail-closed decisions
- raw/normalized value consistency

### Database integration

- migration and constraints
- duplicate replay and collision
- inbox immutability/state transitions
- concurrent report/inbox creation
- acceptance batch rollback behavior
- tenant isolation

### Route integration

- empty/malformed message rejection
- duplicate delivery returns prior result
- ambiguous match quarantines
- billing does not suppress clinical staging
- critical result creates durable outbox
- unauthorized acceptance fails

### Protocol/golden corpus

- representative de-identified HL7 and ASTM messages by analyzer profile
- repetitions, escapes, preliminary/final/corrected/deleted/wrong statuses
- bad checksum, partial frames, duplicate frames, reordered delivery

### Resilience

- failure after each persistence step
- bridge restart/retry
- duplicate and out-of-order messages
- network/cloud outage and reconciliation

## Delivery phases

1. **Safety kernel:** parser fail-closed fixes, message validation, replay identity, immutable inbox, exact-one matching, patient-aware validation.
2. **Atomic acceptance:** canonical acceptance service, supersession, critical outbox, separation of duty.
3. **Clinical normalization:** structured units/ranges/critical limits and conversion governance.
4. **Bridge security and durability:** per-agent credentials, signed requests, encrypted transactional local queue.
5. **Validation and operations:** simulator/golden corpus, fault injection, site IQ/OQ/PQ pack, dashboards and release gates.

## Initial release policy

Until all release gates pass, analyzer results may be staged and manually reviewed but must not be automatically published. Critical, corrected, ambiguous, QC-blocked, unit-converted, or patient-history-dependent results are never autoverified.

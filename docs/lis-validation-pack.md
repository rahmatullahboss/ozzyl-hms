# LIS Analyzer Integration Validation and Release Pack

**Version:** 1.0
**Date:** 2026-07-10
**Applies to:** Ozzyl HMS analyzer integration, local LIS bridge, result inbox, acceptance workflow, and critical-result communication.

## 1. Release policy

Analyzer integrations are **human-reviewed by default**. Receiving or reprocessing a machine message stages immutable observations; it does not publish a report. Automatic publication is prohibited until an analyzer/site-specific validation package is completed and separately approved.

The following results always require review:

- corrected/amended observations;
- critical/panic observations;
- QC override observations;
- unit-converted observations until the conversion is analyzer-validated;
- ambiguous, manually reconciled, or previously unmatched observations;
- patient-history-dependent validation results;
- qualitative mappings not yet verified for that analyzer/assay version.

## 2. Automated software release gates

Run from the repository root:

```bash
pnpm test:lis:release
```

The command must pass all of the following:

1. LIS safety and regression tests;
2. protocol parser, bridge signing, replay, and durable queue tests;
3. TypeScript compilation;
4. local bridge JavaScript syntax validation.

Additional full-project verification before production deployment:

```bash
pnpm test
pnpm build:migrations
pnpm build
```

A failed command is a release blocker unless the failure is documented as unrelated, reproduced on the baseline branch, and accepted by the responsible engineering owner.

## 3. Evidence retained for each analyzer/site

Create one controlled folder or ticket containing:

- hospital/tenant and laboratory location;
- analyzer manufacturer, model, serial number, firmware/software version;
- bridge host identity and bridge version;
- protocol/profile version and connection settings;
- machine-to-LIS test-code mapping export;
- unit and conversion mapping export;
- reference interval and critical-limit approval;
- QC/calibration configuration and laboratory sign-off;
- de-identified test-message corpus and expected results;
- IQ, OQ, and PQ execution evidence;
- exception/deviation log and resolution;
- final go-live approval and rollback owner.

Do not retain identifiable patient data in engineering fixtures or screenshots.

## 4. Installation Qualification (IQ)

Verify and record:

- [ ] Analyzer model, serial, firmware, and vendor interface specification match the approved profile.
- [ ] Bridge host uses supported operating system and Node.js versions.
- [ ] Bridge service runs under a restricted service account.
- [ ] Queue and logs are on persistent storage with restricted permissions.
- [ ] Queue encryption key is configured outside source control.
- [ ] Signed bridge key ID and secret are configured outside source control.
- [ ] Server key is tenant-scoped, machine-scoped where possible, active, and not revoked.
- [ ] Legacy bridge-key authentication is disabled after migration.
- [ ] System time synchronization is enabled on analyzer, bridge, and server.
- [ ] Required TCP/serial/MLLP routes are documented and restricted by firewall.
- [ ] Raw clinical message logging is disabled.
- [ ] Backup, restore, downtime, and support contacts are documented.
- [ ] Migrations `0404_lis_analyzer_safety_inbox.sql`, `0405_lis_inbox_terminal_decisions.sql`, `0406_lis_inbox_supersession_workflow.sql`, `0407_lis_result_retraction_workflow.sql`, and `0408_lis_retraction_notification_dispatch.sql` are applied and verified.

## 5. Operational Qualification (OQ)

Use de-identified or synthetic samples. Execute every applicable case and retain expected/actual evidence.

### 5.1 Transport and parser

- [ ] Valid final result.
- [ ] Preliminary result.
- [ ] Corrected result.
- [ ] Cancelled/deleted/wrong-result status where supported.
- [ ] Unknown or missing result status is quarantined, not finalized.
- [ ] Multi-test and multi-order message.
- [ ] Qualitative, numeric, negative, decimal, and scientific-notation values.
- [ ] One-sided and two-sided reference ranges.
- [ ] HL7 escapes/repetitions used by the analyzer profile.
- [ ] ASTM multi-frame message.
- [ ] ASTM invalid checksum receives rejection/NAK and is not staged.
- [ ] Empty/malformed clinical message is rejected.

### 5.2 Identity, replay, and matching

- [ ] Same identity and same body returns duplicate disposition without a second clinical write.
- [ ] Same HL7 message control ID and different body creates collision quarantine.
- [ ] Zero candidate matches become unmatched.
- [ ] Two candidate matches become ambiguous; the newest row is not selected automatically.
- [ ] Tenant isolation prevents cross-hospital matching.
- [ ] Machine-scoped bridge key cannot post for another analyzer.
- [ ] Expired timestamp, tampered body, invalid signature, revoked key, and replayed nonce are rejected.

### 5.3 QC, calibration, and validation

- [ ] Current passing QC permits review eligibility.
- [ ] Missing QC configuration blocks acceptance.
- [ ] Missing, stale, or failed QC blocks acceptance.
- [ ] QC database/query error blocks acceptance.
- [ ] Overdue/failed/unknown calibration state blocks acceptance.
- [ ] Blocking validation rule creates `validation_blocked`.
- [ ] Warning rule remains visible to the reviewer.
- [ ] Patient-dependent rule receives the correct patient identity.
- [ ] Authorized QC/validation override records actor, reason, scope, and time.

### 5.4 Normalization and clinical governance

- [ ] Raw value/unit/range remain unchanged in the inbox.
- [ ] Normalized value/unit/range match the approved mapping.
- [ ] Dimensionally invalid unit conversion is rejected.
- [ ] Generic abnormal flag is not treated as critical.
- [ ] Critical status occurs only from approved explicit limits or approved analyzer codes.
- [ ] Result acceptance requires an exact match, passing/overridden gates, expected version, and authorized reviewer.
- [ ] The same user cannot stage and accept where separation of duty applies.
- [ ] Acceptance creates one atomic canonical result, audit evidence, workflow transition, and inbox transition.
- [ ] Batch failure leaves no partial canonical result.
- [ ] Correction preserves the previous observation and supersession provenance.
- [ ] Acceptance does not automatically publish the report.

### 5.5 Accepted-result retraction and amendment

- [ ] Only an authorized governance role can request retraction of an accepted result.
- [ ] A different authorized reviewer must approve or reject the request with documented evidence.
- [ ] Approval atomically retracts the canonical result, order item, and report; records an immutable audit observation; and creates one durable notification event.
- [ ] Missing or silently ignored canonical/audit/notification evidence aborts and rolls back the entire transaction.
- [ ] Retracted result and report rows cannot be updated, republished, or deleted.
- [ ] Same-item correction after retraction creates a new report version linked by `supersedes_report_id`; it never writes into the withdrawn report.
- [ ] Rematch to another order item is blocked until the original accepted result has an applied retraction.
- [ ] The requester cannot approve or reject their own request.
- [ ] Withdrawn values are excluded from delta checks, dependency rules, AI/predictive summaries, CCDA export, doctor inboxes, and hospital-link synchronization.
- [ ] Historical print/PDF output carries a prominent withdrawn warning and patient notification actions are disabled.
- [ ] Retraction notification fan-out creates one immutable per-recipient delivery ledger row for each eligible governance user, ordering clinician, and patient portal recipient.
- [ ] Re-running dispatch or recovering a stale lease does not duplicate staff or patient notification artifacts.
- [ ] A partial channel failure retries only the failed recipient/channel with bounded backoff; successful deliveries are not repeated.
- [ ] No eligible recipient and malformed immutable evidence become visible terminal failures rather than endless retries.
- [ ] Governance monitoring is tenant-scoped and exposes per-recipient status, attempts, errors, and timestamps.
- [ ] Manual retry records the accountable reviewer and resets only failed deliveries.
- [ ] Patient portal notification listing and read acknowledgement are tenant/patient scoped.
- [ ] Immediate post-approval delivery is tested; scheduled retry worker is deployed only after an account cron slot is assigned.

### 5.6 Critical-result communication

- [ ] Critical acceptance creates one durable outbox event.
- [ ] Duplicate acceptance cannot create a second event.
- [ ] Delivery retry and terminal failure are visible.
- [ ] Accountable clinician/laboratory role can acknowledge with note, user, and time.
- [ ] Non-accountable role cannot acknowledge.
- [ ] Deadline breach escalates the unresolved event.
- [ ] Acknowledged/cancelled event cannot be reopened accidentally.

### 5.7 Downtime and recovery

- [ ] API/network outage produces an encrypted, durably written queue item before HL7 positive acknowledgement in configured queue-ack mode.
- [ ] Bridge restart retains and retries queued messages.
- [ ] Retry preserves delivery ID and uses a fresh signed nonce/timestamp.
- [ ] Queue corruption is quarantined and alerted; corrupted data is not posted.
- [ ] Permanent `4xx` rejection is not retried indefinitely.
- [ ] Terminal queue failure is reviewed and reconciled.
- [ ] Server/database recovery does not create duplicate canonical results.

## 6. Performance Qualification (PQ)

Run with laboratory staff using the intended workflow and representative workload.

- [ ] Compare at least the laboratory-approved number of samples across normal, abnormal, critical, qualitative, and reportable ranges.
- [ ] Achieve 100% patient/specimen/test identity agreement.
- [ ] Achieve 100% value/unit/status agreement after approved normalization.
- [ ] Reconcile every unmatched, ambiguous, QC-blocked, and validation-blocked observation.
- [ ] Verify reviewer workload and turnaround time are operationally acceptable.
- [ ] Verify critical notification acknowledgement and escalation within laboratory policy.
- [ ] Perform peak-volume and reconnect/retry testing without message loss or duplicate canonical results.
- [ ] Verify reports remain unpublished until the approved release workflow completes.

The laboratory director/pathologist determines the required sample count and acceptance tolerance for each assay and analyzer; engineering must not invent clinical tolerances.

## 7. Go/no-go decision

### No-go conditions

Any of the following blocks unattended production use:

- failed automated LIS release command;
- incomplete IQ/OQ/PQ evidence;
- unresolved identity, value, unit, status, QC, calibration, or critical-alert discrepancy;
- plaintext queue or uncontrolled raw message logging;
- legacy shared key still enabled without an approved temporary exception;
- inability to restore/reconcile after bridge or network failure;
- automatic result publication enabled before clinical governance approval;
- retraction notification retry worker not deployed or no accountable manual monitoring/retry owner assigned.

### Controlled pilot conditions

A controlled pilot may start only when:

- software gates pass;
- site IQ and core OQ pass;
- all analyzer observations require authorized human acceptance;
- daily reconciliation owner and downtime process are assigned;
- critical-result communication is tested;
- rollback and support contacts are available.

## 8. Sign-off

| Role | Name | Decision | Date | Signature/reference |
|---|---|---|---|---|
| Laboratory director/pathologist |  |  |  |  |
| Laboratory supervisor |  |  |  |  |
| Hospital clinical governance |  |  |  |  |
| Hospital IT/security |  |  |  |  |
| Ozzyl engineering |  |  |  |  |
| Ozzyl implementation/support |  |  |  |  |

## 9. Current engineering status

The software now provides immutable staging, replay/collision handling, exact-one matching, fail-closed parser/QC/validation behavior, raw/normalized traceability, governed atomic acceptance, correction provenance, two-person accepted-result retraction, immutable withdrawn-result/report evidence, versioned amended reports, per-recipient idempotent retraction notification delivery, bounded retry and stale-lease recovery, patient portal notification/read flows, a real API-backed Ozzyl Health mobile notification inbox with safe internal deep links, governance monitoring/manual retry, durable critical outboxes, acknowledgement controls, per-key signed bridge requests, encrypted atomic retry queue storage, and dedicated backend/web/mobile release commands.

Physical analyzer/site validation, real vendor-profile qualification, SMS/email provider-idempotent retraction delivery, deployment of the dedicated scheduled jobs worker after cron-slot consolidation, patient identity proof completion for pending self-registrations, and final clinical sign-off remain deployment activities and cannot be proven by repository tests alone.

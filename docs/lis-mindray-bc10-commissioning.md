# Mindray BC-10 LIS Commissioning Runbook

**Version:** 1.0  
**Date:** 2026-07-10  
**Status:** Controlled commissioning template — no BC-10 profile is considered validated until this runbook is completed and signed off.

## 1. Release position

The Ozzyl LIS software can stage, reconcile, review, accept, supersede, retract, audit, and notify analyzer results. A Mindray BC-10 installation must still be qualified for the exact hospital, analyzer serial number, firmware/vendor software version, interface mode, cable/network path, and laboratory policy.

Do not enable unattended autoverification or automatic report publication during commissioning. All analyzer observations must remain human-reviewed until the laboratory director/pathologist approves the completed IQ/OQ/PQ evidence.

## 2. Responsibility split

### Hospital/vendor actions

- Enable or license the analyzer/vendor-software LIS interface.
- Provide the interface manual or export specification.
- Confirm the physical connection and communication settings.
- Supply authorized laboratory staff for QC and patient-sample comparison.
- Approve test-code, unit, reference-range, critical-limit, and QC mappings.
- Sign the IQ/OQ/PQ evidence and go-live decision.

### Ozzyl engineering actions

- Configure the machine record and local bridge.
- Capture and analyze de-identified interface traffic.
- Build a BC-10-specific, versioned profile only after protocol evidence exists.
- Configure code, unit, qualitative, status, and QC mappings.
- Add golden-message and negative-path tests from approved de-identified samples.
- Review unmatched, ambiguous, blocked, duplicate, corrected, and retraction behavior.
- Generate the final middleware configuration and deployment evidence.

## 3. Site survey — collect before coding a profile

Record the following in the implementation ticket or controlled validation folder.

| Field | Required evidence |
|---|---|
| Hospital/tenant | Tenant ID, hospital name, laboratory location |
| Analyzer identity | Model, serial number, firmware/software version, photo of nameplate |
| Vendor software | Product name, version, host PC, current machine connection |
| LIS interface entitlement | Enabled/licensed/not available, vendor confirmation |
| Direction | Unidirectional result upload or bidirectional order/worklist + result |
| Protocol | HL7, ASTM/LIS2, TCP text, serial, CSV/file export, vendor DB/API, unknown |
| Network settings | Analyzer/vendor-PC IP, port, subnet, firewall owner |
| Serial settings | COM port, baud, parity, data bits, stop bits, flow control |
| Message framing | MLLP, ASTM frames, line-delimited text, file naming/rotation |
| Identifier sent | Barcode, specimen ID, order number, rack/tube ID, patient ID |
| Result statuses | Preliminary, final, corrected, deleted/cancelled, unknown variants |
| QC identifiers | Control name/lot/prefix and how QC is distinguished from patient samples |
| Time policy | Analyzer, bridge, and server time/timezone synchronization |
| Downtime owner | Manual entry/reconciliation owner and escalation contact |

## 4. Choose the integration path from evidence

### Path A — vendor software exposes HL7/ASTM/TCP output

Preferred when the vendor application already receives results from the analyzer and can send a documented LIS feed.

1. Keep the existing analyzer-to-vendor-software connection unchanged.
2. Configure the vendor software to send to the Ozzyl local bridge.
3. Match the bridge listener to the documented protocol/framing.
4. Validate ACK/NAK, retries, corrected results, and reconnect behavior.

### Path B — analyzer supports a direct LIS connection

Use only when the analyzer can safely send to the bridge without disrupting the vendor application.

1. Confirm whether multiple destinations are supported.
2. Use the documented TCP/serial settings.
3. Do not split or sniff a serial connection without vendor approval.
4. Preserve the vendor workflow as the fallback until PQ is accepted.

### Path C — only CSV/file/database export is available

1. Identify the authoritative export folder/table/API.
2. Define a read-only adapter with an immutable file/row identity and payload hash.
3. Never mark a source file/row consumed until it is durably queued.
4. Quarantine changed duplicates, malformed rows, and unknown test codes.
5. Retain enough metadata to reconcile every source record to one inbox observation.

### Path D — interface is proprietary or locked

Stop commissioning until the vendor supplies an approved interface method, middleware, or specification. Do not reverse-engineer clinical traffic into production without a controlled validation decision.

## 5. Safe raw-message capture

Capture synthetic or de-identified traffic only.

Required examples where supported:

- one normal CBC result;
- one abnormal result;
- one analyzer-flagged or laboratory-critical result;
- one QC/control result;
- one corrected/repeated result;
- one multi-observation message;
- one duplicate retransmission;
- one unknown test code;
- one malformed/truncated or bad-checksum example;
- one reconnect/retry sequence.

Before sharing with engineering, remove patient name, mobile, address, national ID, date of birth, and any unnecessary identifier. Replace the specimen/order identifier with a controlled synthetic ID while preserving field positions and delimiters.

For each capture retain:

- direction and timestamp;
- protocol/framing;
- exact bytes or lossless text;
- expected analyzer printout/vendor-software result;
- expected Ozzyl disposition;
- analyzer/vendor software version.

## 6. HMS pre-configuration

Complete these steps in the hospital tenant before patient testing.

1. Create the analyzer in **Lab Machine Settings**.
2. Keep the machine inactive or commissioning-only until readiness has no blockers.
3. Select the closest profile only as a starting template; do not label another BC-series profile as a validated BC-10 profile.
4. Generate the machine-specific middleware configuration from:
   - `/api/lab-machines/:machineId/middleware-config`
5. Configure a machine-scoped signed bridge identity and secret outside source control.
6. Confirm bridge heartbeat in:
   - `/api/lab-machines/bridge-agents`
7. Configure every test code used in the commissioning corpus.
8. Configure approved units and conversions.
9. Configure QC/control identifiers and ranges.
10. Configure laboratory-approved reference intervals and critical limits.
11. Configure blocking validation rules.
12. Run machine-specific readiness:
   - `/api/lab-monitoring/lis-go-live-readiness?machineId=:machineId`

## 7. Mapping worksheet

Do not assume analyzer codes or units from another Mindray model. Populate this table from real BC-10 output and laboratory approval.

| Analyzer code | Analyzer label | Raw unit | Ozzyl test/service | Normalized unit | Conversion/version | Result type | Status mapping | Approved by |
|---|---|---|---|---|---|---|---|---|
|  | WBC |  |  |  |  | Numeric |  |  |
|  | RBC |  |  |  |  | Numeric |  |  |
|  | HGB |  |  |  |  | Numeric |  |  |
|  | HCT |  |  |  |  | Numeric |  |  |
|  | MCV |  |  |  |  | Numeric |  |  |
|  | MCH |  |  |  |  | Numeric |  |  |
|  | MCHC |  |  |  |  | Numeric |  |  |
|  | PLT |  |  |  |  | Numeric |  |  |
|  | Other analyzer output |  |  |  |  |  |  |  |

For every mapping verify:

- exact code and case;
- raw and normalized value;
- raw and normalized unit;
- precision and rounding;
- reference interval applicability;
- abnormal direction;
- criticality source;
- preliminary/final/corrected/deleted status behavior.

## 8. Installation Qualification (IQ)

- [ ] Analyzer identity, firmware, vendor software, and interface entitlement recorded.
- [ ] Bridge host OS, Node.js/runtime, service account, and storage recorded.
- [ ] TCP/serial cable, port, firewall, and time synchronization verified.
- [ ] Signed machine-scoped credentials configured and legacy shared access disabled.
- [ ] Durable encrypted queue and restricted logs configured.
- [ ] Backup, restore, downtime, and support contacts documented.
- [ ] Required database migrations through `0408_lis_retraction_notification_dispatch.sql` applied.
- [ ] Production logging does not retain uncontrolled identifiable raw messages.

## 9. Operational Qualification (OQ)

- [ ] Valid normal result creates one immutable inbox observation.
- [ ] Exact duplicate does not create a second canonical result.
- [ ] Same message identity with different content is quarantined as a collision.
- [ ] Unknown/missing status is review-required, never silently final.
- [ ] Unknown test code becomes unmatched.
- [ ] Zero or multiple order matches do not write a canonical result.
- [ ] QC/control result never enters a patient result.
- [ ] Missing/stale/failed QC or calibration blocks acceptance.
- [ ] Invalid unit conversion blocks acceptance.
- [ ] Generic abnormal flag is not automatically treated as critical.
- [ ] Corrected result preserves the previous accepted observation.
- [ ] Invalid checksum/truncated message is rejected where the protocol supports integrity checks.
- [ ] Network loss queues durably before a positive queue ACK is returned.
- [ ] Bridge restart retries without duplicate canonical writes.
- [ ] Reprocess creates auditable evidence and does not bypass review.
- [ ] Retraction requires a different authorized approver and notifies governed recipients.

## 10. Performance Qualification (PQ)

The laboratory director/pathologist selects the sample count and acceptance tolerance.

For the approved sample set:

- [ ] 100% patient/specimen/order identity agreement.
- [ ] 100% test-code agreement.
- [ ] 100% value, unit, precision, and status agreement after approved normalization.
- [ ] Normal, abnormal, critical, and representative reportable ranges included.
- [ ] Analyzer printout/vendor software/manual entry compared to Ozzyl output.
- [ ] Every unmatched, ambiguous, blocked, duplicate, and corrected observation reconciled.
- [ ] Peak workload and reconnect test show no message loss or duplicate canonical result.
- [ ] Operator review workload and turnaround time are acceptable.
- [ ] Critical communication acknowledgement/escalation meets laboratory policy.

## 11. Controlled go-live sequence

1. Keep all analyzer results human-reviewed.
2. Start with one analyzer and a limited test menu.
3. Maintain the vendor/manual fallback workflow.
4. Reconcile analyzer runs, bridge logs, inbox observations, accepted results, and reports daily.
5. Assign named owners for heartbeat, QC, unmatched queue, failed notification delivery, and downtime reconciliation.
6. Review the first day, first three days, and first week before expanding scope.
7. Enable any autoverification only through a separate approved validation package.

## 12. No-go conditions

Do not use the BC-10 integration clinically when any condition is true:

- protocol or identifier fields are still assumed rather than evidenced;
- bridge heartbeat is absent or retry storage is not durable;
- any active analyzer test code is unmapped;
- value/unit/status differs from analyzer printout or vendor software;
- QC/control can be mistaken for a patient sample;
- unknown status, checksum failure, ambiguity, or conversion error can pass silently;
- readiness API reports a blocker;
- IQ/OQ/PQ evidence or clinical sign-off is incomplete;
- no accountable daily monitoring and fallback owner is assigned.

## 13. Evidence handoff to Ozzyl engineering

Provide one controlled package containing:

1. completed site-survey table;
2. interface manual/specification;
3. machine and vendor-software version evidence;
4. de-identified raw-message corpus;
5. analyzer printout/vendor-software expected results;
6. proposed test-code/unit/QC mapping sheet;
7. network or serial settings;
8. laboratory-approved ranges and critical limits;
9. named vendor, laboratory, IT, and clinical sign-off contacts.

After this evidence is available, engineering can create and test a BC-10-specific profile without guessing vendor behavior.

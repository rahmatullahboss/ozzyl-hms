# LIS First Hospital Bridge Deployment Checklist

Date: 2026-07-09
Scope: first production hospital analyzer bridge deployment for Ozzyl HMS.

This checklist follows the OpenELIS-style deployment principle of validating site readiness, bridge connectivity, analyzer mapping, QC/control routing, smoke-test results, and fallback operations before production use. It is adapted to the existing Ozzyl HMS LIS implementation and must not be treated as a separate workflow outside HMS.

## Source of truth in Ozzyl HMS

Use existing HMS endpoints and screens:

- Machine setup and middleware config: `/api/lab-machines/:machineId/middleware-config`
- Bridge heartbeat: `/api/lab-machines/bridge-agents`
- Go-live readiness: `/api/lab-monitoring/lis-go-live-readiness?machineId=:machineId`
- Machine run summary: `/api/lab-machines/:machineId/runs`
- Raw message logs: machine settings → Logs tab
- Unmatched queue: machine settings → Unmatched LIS tab
- Reagent/TAT reconciliation: `/api/lab-monitoring/reagent-reconciliation`

## Stage 1 — Site survey and analyzer capability confirmation

- Confirm analyzer manufacturer, model, protocol, port/serial settings, and whether LIS is actually enabled on the device.
- Capture analyzer IP/port or RS232 COM/baud/parity/data bits/stop bits with a photo or vendor confirmation.
- Confirm whether the analyzer sends HL7/ASTM/file/CSV and whether it needs MLLP framing.
- Confirm fallback manual result-entry workflow with lab staff before enabling go-live expectations.

## Stage 2 — Local bridge installation and heartbeat

- Install bridge on a stable lab PC/local server that can reach the analyzer and HMS API.
- Generate machine-specific middleware config from HMS.
- Put bridge key/secret only in local config, not in screenshots or docs.
- Verify queue/retry folder is writable and persistent.
- Start bridge and confirm heartbeat in HMS.

## Stage 3 — HMS machine, mapping, and readiness configuration

- Activate analyzer machine in HMS.
- Select analyzer profile/defaults where available.
- Map all analyzer test codes used in the first smoke test.
- Add unit conversion where machine unit differs from report unit.
- Add qualitative aliases for tests such as `POS`, `Detected`, `NEG`, `Non-reactive`.
- Configure validation rules for high-risk tests and critical ranges.
- Run `/api/lab-monitoring/lis-go-live-readiness?machineId=:machineId`.

## Stage 4 — QC/control smoke test

- Configure QC controls and ranges matching the analyzer control identifier/lot.
- Send one QC/control result from the analyzer or simulator.
- Confirm it goes to QC results/review, not patient lab results.
- Confirm machine run summary shows QC outcome.
- Do not proceed to patient smoke test if QC/control messages are treated as patient results.

## Stage 5 — Patient/order smoke test and reconciliation

- Create a clearly marked test patient/order or agreed smoke-test order.
- Collect/receive the sample so barcode/specimen ID exists in HMS.
- Send one analyzer patient result.
- Confirm run summary shows matched/processed.
- Confirm lab order item/result is updated.
- Confirm unmatched queue did not get unexpected entries.
- Review reagent/TAT reconciliation for billed/performed/resulted/consumed/TAT status.

## Stage 6 — Go-live controls and handover

- Resolve or document all unmatched/review/error runs.
- Train operator on Runs, Logs, Unmatched LIS, Reprocess, QC review, and fallback entry.
- Assign daily review owner for first week:
  - bridge heartbeat
  - analyzer run errors
  - unmatched queue
  - QC status
  - reagent exceptions
  - TAT/reconciliation
- Keep manual fallback active until the first week is stable.

## Go/no-go rule

Do not go live if any of these are true:

- No active machine configuration.
- No active analyzer test mapping.
- Bridge heartbeat is missing.
- QC/control result routes to patient result.
- Patient smoke-test result cannot be matched.
- Unmatched queue has unresolved smoke-test items.
- Staff cannot explain fallback workflow.

Go live only when the readiness API returns no blockers and all warnings are accepted/documented by the implementation lead and hospital lab owner.

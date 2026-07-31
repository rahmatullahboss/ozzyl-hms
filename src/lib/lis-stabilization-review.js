export function buildLisStabilizationReview(input = {}) {
  const machineQuery = input.machineId ? `?machineId=${input.machineId}` : "";
  const machinePath = input.machineId ? `/${input.machineId}` : "/:machineId";
  const branch = input.branchName || "deployment branch";
  return [
    {
      id: "merge-hygiene",
      title: "Merge hygiene and scope control",
      purpose: "Prevent unrelated workspace changes from entering the LIS deployment branch.",
      gates: [
        {
          id: "lis-only-commit-scope",
          title: "Stage only LIS-related files for merge/deploy",
          status: "must_pass",
          evidence: `Review staged diff on ${branch}; unrelated e2e artifacts, billing/reception changes, and local reference folders must stay out of the LIS merge.`,
          testCommand: "git diff --cached --stat",
          riskIfSkipped: "Unrelated dirty files can silently change billing/reception behavior or bloat the deployment commit."
        },
        {
          id: "migration-order-reviewed",
          title: "Review LIS migration order before deployment",
          status: "must_pass",
          evidence: "Confirm qualitative mapping and sample storage/referral migrations are included and deploy before app code uses new columns.",
          testCommand: "pnpm exec tsc --noEmit",
          riskIfSkipped: "Runtime routes can fail if new code references columns that are not migrated yet."
        }
      ]
    },
    {
      id: "analyzer-bridge",
      title: "Analyzer bridge and message ingestion",
      purpose: "Confirm bridge connectivity, message parsing, reprocess, and operator visibility are stable.",
      gates: [
        {
          id: "bridge-config-generated",
          title: "Machine-specific middleware config generated",
          status: "must_pass",
          evidence: "Middleware config can be generated without secrets leaking into docs/screenshots.",
          endpoint: `/api/lab-machines${machinePath}/middleware-config`,
          testCommand: "pnpm exec vitest run test/lab-analyzer-profiles.test.ts test/lab-machine-runs.test.ts",
          riskIfSkipped: "Local bridge can be configured with the wrong protocol, port, analyzer identity, or API endpoint."
        },
        {
          id: "bridge-heartbeat-readiness",
          title: "Bridge heartbeat and go-live readiness checked",
          status: "must_pass",
          evidence: "Readiness API has no bridge or machine blockers; local bridge heartbeat is recent.",
          endpoint: `/api/lab-monitoring/lis-go-live-readiness${machineQuery}`,
          riskIfSkipped: "Analyzer messages may not reach HMS during production use."
        },
        {
          id: "runs-reprocess-visible",
          title: "Runs/reprocess visibility available to operator",
          status: "must_pass",
          evidence: "Machine settings show Runs/Logs/Unmatched; backend run summary and reprocess tests pass.",
          endpoint: `/api/lab-machines${machinePath}/runs`,
          testCommand: "pnpm exec vitest run test/lab-machine-runs.test.ts test/lab-machine-reprocess.test.ts",
          riskIfSkipped: "Staff may repeatedly resend messages or lose traceability when mapping is fixed after first failure."
        }
      ]
    },
    {
      id: "result-safety",
      title: "Result safety gates",
      purpose: "Prevent unsafe analyzer writes and distinguish patient results from QC/control messages.",
      gates: [
        {
          id: "validation-gate",
          title: "Machine ingestion uses validation rules before patient write",
          status: "must_pass",
          evidence: "Validation-blocked machine results route to review instead of direct patient result write.",
          testCommand: "pnpm exec vitest run test/lab-machine-validation-gate.test.ts",
          riskIfSkipped: "Out-of-range or invalid values can be stored as final results without review."
        },
        {
          id: "qc-control-routing",
          title: "QC/control analyzer messages do not become patient results",
          status: "must_pass",
          evidence: "QC/control identifiers route to lab_qc_results or review queue, not lab_order_items/lab_results.",
          testCommand: "pnpm exec vitest run test/lab-machine-qc-detection.test.ts",
          riskIfSkipped: "Control material can appear as a patient result."
        },
        {
          id: "qualitative-mapping",
          title: "Qualitative analyzer aliases normalize before validation/write",
          status: "must_pass",
          evidence: "Aliases such as POS/NEG/Detected map to canonical report values.",
          testCommand: "pnpm exec vitest run test/lab-machine-qualitative-mapping.test.ts",
          riskIfSkipped: "Analyzer-specific qualitative wording can fail validation or create inconsistent reporting."
        }
      ]
    },
    {
      id: "workflow-reconciliation",
      title: "Workflow, storage, referral, reagent, and TAT reconciliation",
      purpose: "Confirm lab operations remain traceable after analyzer automation is enabled.",
      gates: [
        {
          id: "sample-storage-referral",
          title: "Sample storage/referral actions use existing lab workflow events",
          status: "monitor",
          evidence: "Storage/referral APIs update lab_order_items and lab_workflow_events without a parallel sample lifecycle.",
          testCommand: "pnpm exec vitest run test/integration/routes/lab-workflow.test.ts",
          riskIfSkipped: "Samples sent out or stored physically can become untraceable after result automation."
        },
        {
          id: "reagent-tat-reconciliation",
          title: "Billed/performed/resulted/reagent/TAT reconciliation reviewed",
          status: "monitor",
          evidence: "Existing reagent reconciliation includes TAT and performed/resulted signals.",
          endpoint: "/api/lab-monitoring/reagent-reconciliation",
          testCommand: "pnpm exec vitest run test/integration/routes/lab-monitoring-critical.test.ts",
          riskIfSkipped: "Automation may hide reagent deduction gaps, TAT delays, or unmatched performed tests."
        }
      ]
    },
    {
      id: "operator-readiness",
      title: "Operator readiness and fallback",
      purpose: "Make the first hospital safe to operate even if bridge/analyzer automation fails.",
      gates: [
        {
          id: "readiness-card-visible",
          title: "Go-live readiness card visible in monitoring UI",
          status: "must_pass",
          evidence: "Lab monitoring dashboard surfaces readiness/checklist and first deployment next step.",
          testCommand: "cd web && pnpm exec vitest run src/pages/LabMonitoringDashboard.test.ts",
          riskIfSkipped: "Admin may not see blockers/warnings before enabling first production machine bridge."
        },
        {
          id: "manual-fallback-trained",
          title: "Manual fallback workflow trained and documented",
          status: "manual_review",
          evidence: "Lab team can enter results manually and knows when to stop using bridge automation.",
          endpoint: "/api/lab-monitoring/lis-bridge-deployment-checklist",
          riskIfSkipped: "Service can stop if the bridge/PC/network fails during patient service hours."
        },
        {
          id: "first-week-monitoring-owner",
          title: "First-week monitoring owner assigned",
          status: "manual_review",
          evidence: "Named person checks heartbeat, run errors, unmatched queue, QC status, reagent exceptions, and TAT daily.",
          endpoint: `/api/lab-monitoring/lis-go-live-readiness${machineQuery}`,
          riskIfSkipped: "Silent data quality issues can accumulate after deployment team leaves."
        }
      ]
    }
  ];
}
export function summarizeLisStabilizationReview(sections) {
  const gates = sections.flatMap((section) => section.gates);
  return {
    sections: sections.length,
    gates: gates.length,
    must_pass: gates.filter((gate) => gate.status === "must_pass").length,
    monitor: gates.filter((gate) => gate.status === "monitor").length,
    manual_review: gates.filter((gate) => gate.status === "manual_review").length
  };
}

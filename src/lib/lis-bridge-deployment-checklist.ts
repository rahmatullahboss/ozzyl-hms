export type LisBridgeDeploymentChecklistInput = {
  machineId?: number | null;
  machineName?: string | null;
  machineCode?: string | null;
  protocol?: string | null;
  analyzerProfileId?: string | null;
};

export type LisBridgeDeploymentChecklistItem = {
  id: string;
  title: string;
  owner: 'implementation_team' | 'lab_team' | 'vendor_team' | 'hospital_admin';
  evidence: string;
  endpoint?: string | null;
  notes?: string | null;
};

export type LisBridgeDeploymentChecklistStage = {
  id: string;
  title: string;
  purpose: string;
  items: LisBridgeDeploymentChecklistItem[];
};

export function buildLisBridgeDeploymentChecklist(input: LisBridgeDeploymentChecklistInput = {}): LisBridgeDeploymentChecklistStage[] {
  const machineLabel = input.machineName || input.machineCode || (input.machineId ? `Machine #${input.machineId}` : 'selected analyzer');
  const protocol = String(input.protocol || 'configured protocol').toUpperCase();
  const machineIdSegment = input.machineId ? `/${input.machineId}` : '/:machineId';
  const machineQuery = input.machineId ? `?machineId=${input.machineId}` : '';

  return [
    {
      id: 'site-survey',
      title: 'Site survey and analyzer capability confirmation',
      purpose: 'Confirm the real analyzer communication method before touching production workflow.',
      items: [
        {
          id: 'confirm-analyzer-profile',
          title: `Confirm analyzer profile for ${machineLabel}`,
          owner: 'implementation_team',
          evidence: 'Manufacturer, model, protocol, port/serial settings, and LIS availability are written in the deployment note.',
          endpoint: `/api/lab-machines${machineIdSegment}/middleware-config`,
          notes: `Current protocol basis: ${protocol}. Verify against the vendor/device screen before go-live.`,
        },
        {
          id: 'confirm-network-path',
          title: 'Confirm local network/serial path from analyzer to bridge PC',
          owner: 'vendor_team',
          evidence: 'Analyzer IP/port or COM port/baud/parity settings captured with photo or vendor confirmation.',
          notes: 'For RS232 analyzers, keep bridge on the lab PC and avoid direct cloud dependency.',
        },
        {
          id: 'confirm-fallback-workflow',
          title: 'Confirm manual fallback workflow with lab team',
          owner: 'lab_team',
          evidence: 'Lab team knows how to enter results manually if bridge/analyzer communication is down.',
          notes: 'Fallback must be tested before enabling strict go-live expectations.',
        },
      ],
    },
    {
      id: 'bridge-installation',
      title: 'Local bridge installation and heartbeat',
      purpose: 'Bring up the local bridge safely and confirm the HMS server can see it.',
      items: [
        {
          id: 'install-bridge',
          title: 'Install and configure local LIS bridge',
          owner: 'implementation_team',
          evidence: 'Bridge config includes API base URL, bridge key, machine code, protocol settings, queue path, and heartbeat interval.',
          endpoint: `/api/lab-machines${machineIdSegment}/middleware-config`,
        },
        {
          id: 'verify-heartbeat',
          title: 'Verify bridge heartbeat in HMS',
          owner: 'implementation_team',
          evidence: 'Heartbeat appears healthy and recent in the bridge agents list/readiness check.',
          endpoint: '/api/lab-machines/bridge-agents',
        },
        {
          id: 'verify-queue-retry',
          title: 'Verify queue/retry folder is writable',
          owner: 'implementation_team',
          evidence: 'Bridge can persist queued messages when HMS is temporarily unavailable, then retry successfully.',
          notes: 'Do not go live if queue persistence is only in memory.',
        },
      ],
    },
    {
      id: 'hms-configuration',
      title: 'HMS machine, mapping, and readiness configuration',
      purpose: 'Ensure Ozzyl HMS can match analyzer messages to the existing lab workflow.',
      items: [
        {
          id: 'machine-active',
          title: 'Activate machine configuration',
          owner: 'hospital_admin',
          evidence: 'Machine is active with code, protocol, port, bidirectional flag, and analyzer profile/defaults reviewed.',
          endpoint: `/api/lab-monitoring/lis-go-live-readiness${machineQuery}`,
        },
        {
          id: 'test-mapping',
          title: 'Map analyzer test codes to lab catalog',
          owner: 'implementation_team',
          evidence: 'All tests used in smoke test have active machine test mappings, units/conversion, and qualitative aliases where needed.',
          endpoint: `/api/lab-machines${machineIdSegment}/mappings`,
        },
        {
          id: 'validation-rules',
          title: 'Review validation and critical rules',
          owner: 'lab_team',
          evidence: 'Mandatory/range/critical validation rules exist for high-risk tests and warnings are understandable to staff.',
          endpoint: `/api/lab-monitoring/lis-go-live-readiness${machineQuery}`,
        },
      ],
    },
    {
      id: 'qc-smoke-test',
      title: 'QC/control smoke test',
      purpose: 'Prevent analyzer QC/control messages from becoming patient results.',
      items: [
        {
          id: 'qc-controls-ranges',
          title: 'Configure QC controls and ranges',
          owner: 'lab_team',
          evidence: 'Control code/lot and range match the analyzer QC identifier used at the site.',
          endpoint: `/api/lab-monitoring/lis-go-live-readiness${machineQuery}`,
        },
        {
          id: 'send-qc-result',
          title: 'Send one analyzer QC/control result',
          owner: 'lab_team',
          evidence: 'QC result is recorded in QC results/review, not in patient lab results.',
          endpoint: `/api/lab-machines${machineIdSegment}/runs`,
        },
        {
          id: 'review-qc-status',
          title: 'Review QC gate status before patient smoke test',
          owner: 'lab_team',
          evidence: 'QC status is accepted or documented for review; patient result gate is not silently bypassed.',
          endpoint: `/api/lab-machines${machineIdSegment}/runs`,
        },
      ],
    },
    {
      id: 'patient-smoke-test',
      title: 'Patient/order smoke test and reconciliation',
      purpose: 'Confirm end-to-end patient result flow before production use.',
      items: [
        {
          id: 'create-test-order',
          title: 'Create a test lab order and collect/receive sample',
          owner: 'lab_team',
          evidence: 'Order item has barcode/specimen ID matching analyzer message identifiers.',
          notes: 'Use a clearly marked test patient/order if possible.',
        },
        {
          id: 'send-patient-result',
          title: 'Send one analyzer patient result',
          owner: 'implementation_team',
          evidence: 'Run summary shows matched/processed; lab order item/result updated; no unexpected unmatched queue entry.',
          endpoint: `/api/lab-machines${machineIdSegment}/runs`,
        },
        {
          id: 'reconcile-reagent-and-tat',
          title: 'Review reagent and TAT reconciliation',
          owner: 'hospital_admin',
          evidence: 'Billed/performed/resulted/consumed and TAT status are visible for the smoke-test order.',
          endpoint: '/api/lab-monitoring/reagent-reconciliation',
        },
      ],
    },
    {
      id: 'go-live-controls',
      title: 'Go-live controls and support handover',
      purpose: 'Make sure the hospital can operate safely after the implementation team leaves.',
      items: [
        {
          id: 'resolve-open-queues',
          title: 'Resolve open unmatched/review queues',
          owner: 'implementation_team',
          evidence: 'Go-live readiness has no blockers and only accepted/documented warnings.',
          endpoint: `/api/lab-monitoring/lis-go-live-readiness${machineQuery}`,
        },
        {
          id: 'train-operator',
          title: 'Train operator on Runs, Logs, Unmatched, Reprocess, and fallback entry',
          owner: 'implementation_team',
          evidence: 'Operator can explain where to see run errors, unmatched results, and how to escalate.',
          notes: 'Training must include what not to do: do not repeatedly resend without checking duplicates/reprocess status.',
        },
        {
          id: 'first-week-monitoring',
          title: 'Set first-week monitoring cadence',
          owner: 'hospital_admin',
          evidence: 'Daily review owner is assigned for bridge heartbeat, run errors, unmatched queue, QC status, and reagent exceptions.',
          endpoint: `/api/lab-monitoring/lis-go-live-readiness${machineQuery}`,
        },
      ],
    },
  ];
}

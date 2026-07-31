export const LAB_MACHINE_PROTOCOLS = [
  'astm',
  'hl7',
  'hl7_mllp',
  'serial',
  'tcp',
  'http',
  'json',
  'csv',
  'file_drop',
] as const;

export const LAB_MACHINE_CONNECTION_TYPES = [
  'tcp',
  'serial',
  'http',
  'mllp',
  'file_drop',
  'sftp',
] as const;

export const LAB_MACHINE_TYPES = [
  'hematology',
  'biochemistry',
  'immunoassay',
  'coagulation',
  'urinalysis',
  'microbiology',
  'blood_gas',
  'electrolyte',
  'molecular',
  'serology',
  'histopathology',
  'cytology',
  'blood_bank',
  'poct',
  'other',
] as const;

export type LabMachineProtocol = typeof LAB_MACHINE_PROTOCOLS[number];
export type LabMachineConnectionType = typeof LAB_MACHINE_CONNECTION_TYPES[number];
export type LabMachineType = typeof LAB_MACHINE_TYPES[number];

export interface MachineCapability {
  machineType: LabMachineType;
  examples: string[];
  inbound: LabMachineProtocol[];
  outbound: LabMachineProtocol[];
  notes: string;
}

export const LAB_MACHINE_CAPABILITIES: MachineCapability[] = [
  {
    machineType: 'hematology',
    examples: ['Sysmex XN/KX', 'Mindray BC series', 'Nihon Kohden'],
    inbound: ['astm', 'hl7', 'json'],
    outbound: ['astm', 'hl7', 'hl7_mllp'],
    notes: 'CBC and differential analyzers usually send ASTM/LIS2 or HL7 ORU results by barcode/specimen id.',
  },
  {
    machineType: 'biochemistry',
    examples: ['Beckman AU', 'Roche Cobas', 'Mindray BS'],
    inbound: ['astm', 'hl7', 'csv', 'json'],
    outbound: ['astm', 'hl7', 'hl7_mllp'],
    notes: 'Chemistry analyzers commonly require bidirectional worklist/order download and unit conversion.',
  },
  {
    machineType: 'immunoassay',
    examples: ['Abbott Architect', 'Roche e411/e601', 'Siemens Immulite'],
    inbound: ['astm', 'hl7', 'csv', 'json'],
    outbound: ['astm', 'hl7', 'hl7_mllp'],
    notes: 'Supports assay-code mapping, final/corrected result status, and raw result audit.',
  },
  {
    machineType: 'coagulation',
    examples: ['Sysmex CA', 'Stago', 'ACL TOP'],
    inbound: ['astm', 'hl7', 'json'],
    outbound: ['astm', 'hl7'],
    notes: 'PT/INR/APTT workflows need reference ranges and panic value handling.',
  },
  {
    machineType: 'urinalysis',
    examples: ['Dirui', 'Sysmex UF', 'Mindray UA'],
    inbound: ['astm', 'hl7', 'csv', 'json'],
    outbound: ['astm', 'hl7'],
    notes: 'Supports textual/coded results as well as numeric values.',
  },
  {
    machineType: 'microbiology',
    examples: ['BD Phoenix', 'VITEK', 'BacT/ALERT'],
    inbound: ['hl7', 'csv', 'json', 'file_drop'],
    outbound: ['hl7', 'hl7_mllp'],
    notes: 'Culture/sensitivity often needs middleware mapping and narrative result text.',
  },
  {
    machineType: 'blood_gas',
    examples: ['Radiometer ABL', 'i-STAT', 'Roche b123'],
    inbound: ['astm', 'hl7', 'json'],
    outbound: ['astm', 'hl7'],
    notes: 'Point-of-care devices can post JSON through the on-prem bridge when direct TCP is unavailable.',
  },
  {
    machineType: 'electrolyte',
    examples: ['AVL', 'Medica EasyLyte', 'Sensa Core'],
    inbound: ['astm', 'hl7', 'json'],
    outbound: ['astm', 'hl7'],
    notes: 'Barcode-based result matching and critical electrolyte alerts are supported.',
  },
  {
    machineType: 'molecular',
    examples: ['GeneXpert', 'PCR platforms'],
    inbound: ['hl7', 'csv', 'file_drop', 'json'],
    outbound: ['hl7', 'hl7_mllp'],
    notes: 'Usually integrated through vendor middleware exporting HL7, CSV, or API payloads.',
  },
  {
    machineType: 'poct',
    examples: ['Glucometer middleware', 'i-STAT', 'rapid-test readers'],
    inbound: ['http', 'json', 'csv'],
    outbound: ['http', 'json'],
    notes: 'Direct browser/device integration is avoided; use an authenticated on-prem bridge.',
  },
];

export function getLabMachineCapabilities() {
  return {
    machineTypes: LAB_MACHINE_TYPES,
    protocols: LAB_MACHINE_PROTOCOLS,
    connectionTypes: LAB_MACHINE_CONNECTION_TYPES,
    capabilities: LAB_MACHINE_CAPABILITIES,
  };
}

export function deriveMachineResultWorkflowState(rawStatus?: string | null): {
  resultStatus: 'preliminary' | 'final' | 'corrected' | 'cancelled';
  itemStatus: 'processing' | 'completed' | 'cancelled';
  isFinalLike: boolean;
  recognized: boolean;
} {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'preliminary' || status === 'p') {
    return { resultStatus: 'preliminary', itemStatus: 'processing', isFinalLike: false, recognized: true };
  }
  if (status === 'final' || status === 'f') {
    return { resultStatus: 'final', itemStatus: 'completed', isFinalLike: true, recognized: true };
  }
  if (status === 'corrected' || status === 'c') {
    return { resultStatus: 'corrected', itemStatus: 'completed', isFinalLike: true, recognized: true };
  }
  if (status === 'cancelled' || status === 'canceled' || status === 'x' || status === 'd') {
    return { resultStatus: 'cancelled', itemStatus: 'cancelled', isFinalLike: false, recognized: true };
  }
  return { resultStatus: 'preliminary', itemStatus: 'processing', isFinalLike: false, recognized: false };
}

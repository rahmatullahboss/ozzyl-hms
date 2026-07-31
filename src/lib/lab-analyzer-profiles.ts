export type LabAnalyzerProtocol = 'astm' | 'hl7' | 'file';

export interface LabAnalyzerProfile {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  protocol: LabAnalyzerProtocol;
  machineType: string;
  bidirectional: boolean;
  defaultPort?: number;
  defaultAckMode?: 'always_ack_after_queue' | 'ack_only_after_api_success';
  supportedResultTypes: Array<'numeric' | 'qualitative' | 'text'>;
  requiresUnitMapping?: boolean;
  requiresQualitativeMapping?: boolean;
  recommendedFor?: string[];
}

const PROFILES: LabAnalyzerProfile[] = [
  {
    id: 'mindray-bc2000-hl7',
    name: 'Mindray BC-2000',
    manufacturer: 'Mindray',
    model: 'BC-2000',
    protocol: 'hl7',
    machineType: 'hematology',
    bidirectional: true,
    defaultPort: 2575,
    defaultAckMode: 'always_ack_after_queue',
    supportedResultTypes: ['numeric', 'qualitative', 'text'],
    requiresUnitMapping: true,
    recommendedFor: ['CBC', 'HGB', 'WBC', 'PLT'],
  },
  {
    id: 'mindray-bc5380-hl7',
    name: 'Mindray BC-5380',
    manufacturer: 'Mindray',
    model: 'BC-5380',
    protocol: 'hl7',
    machineType: 'hematology',
    bidirectional: true,
    defaultPort: 2575,
    defaultAckMode: 'always_ack_after_queue',
    supportedResultTypes: ['numeric', 'qualitative', 'text'],
    requiresUnitMapping: true,
    recommendedFor: ['CBC', 'DLC', 'HGB', 'WBC', 'PLT'],
  },
  {
    id: 'mindray-bs200-hl7',
    name: 'Mindray BS-200',
    manufacturer: 'Mindray',
    model: 'BS-200',
    protocol: 'hl7',
    machineType: 'biochemistry',
    bidirectional: true,
    defaultPort: 2575,
    defaultAckMode: 'always_ack_after_queue',
    supportedResultTypes: ['numeric', 'qualitative'],
    requiresUnitMapping: true,
    recommendedFor: ['Glucose', 'Creatinine', 'ALT', 'AST', 'Urea'],
  },
  {
    id: 'mindray-ba88a-astm',
    name: 'Mindray BA-88A',
    manufacturer: 'Mindray',
    model: 'BA-88A',
    protocol: 'astm',
    machineType: 'biochemistry',
    bidirectional: false,
    defaultPort: 9100,
    supportedResultTypes: ['numeric', 'qualitative'],
    requiresUnitMapping: true,
    recommendedFor: ['Glucose', 'Creatinine', 'ALT', 'AST'],
  },
  {
    id: 'sysmex-xn-astm',
    name: 'Sysmex XN',
    manufacturer: 'Sysmex',
    model: 'XN',
    protocol: 'astm',
    machineType: 'hematology',
    bidirectional: true,
    defaultPort: 9100,
    supportedResultTypes: ['numeric', 'qualitative', 'text'],
    requiresUnitMapping: true,
    recommendedFor: ['CBC', 'DLC', 'Reticulocyte'],
  },
  {
    id: 'abbott-architect-hl7',
    name: 'Abbott Architect',
    manufacturer: 'Abbott',
    model: 'Architect',
    protocol: 'hl7',
    machineType: 'immunoassay',
    bidirectional: true,
    defaultPort: 2575,
    defaultAckMode: 'always_ack_after_queue',
    supportedResultTypes: ['numeric', 'qualitative'],
    requiresUnitMapping: true,
    requiresQualitativeMapping: true,
    recommendedFor: ['TSH', 'FT4', 'HBsAg', 'Troponin'],
  },
  {
    id: 'genexpert-hl7',
    name: 'Cepheid GeneXpert HL7',
    manufacturer: 'Cepheid',
    model: 'GeneXpert',
    protocol: 'hl7',
    machineType: 'microbiology',
    bidirectional: true,
    defaultPort: 2575,
    defaultAckMode: 'always_ack_after_queue',
    supportedResultTypes: ['qualitative', 'text'],
    requiresQualitativeMapping: true,
    recommendedFor: ['MTB/RIF', 'Xpert'],
  },
  {
    id: 'genexpert-astm',
    name: 'Cepheid GeneXpert ASTM',
    manufacturer: 'Cepheid',
    model: 'GeneXpert',
    protocol: 'astm',
    machineType: 'microbiology',
    bidirectional: true,
    defaultPort: 9100,
    supportedResultTypes: ['qualitative', 'text'],
    requiresQualitativeMapping: true,
    recommendedFor: ['MTB/RIF', 'Xpert'],
  },
];

export function listLabAnalyzerProfiles(filters: { protocol?: string; manufacturer?: string; q?: string } = {}): LabAnalyzerProfile[] {
  const protocol = filters.protocol?.trim().toLowerCase();
  const manufacturer = filters.manufacturer?.trim().toLowerCase();
  const q = filters.q?.trim().toLowerCase();

  return PROFILES.filter((profile) => {
    if (protocol && profile.protocol !== protocol) return false;
    if (manufacturer && profile.manufacturer.toLowerCase() !== manufacturer) return false;
    if (q) {
      const haystack = [profile.id, profile.name, profile.manufacturer, profile.model, profile.machineType, profile.protocol, ...(profile.recommendedFor ?? [])]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function getLabAnalyzerProfile(id: string): LabAnalyzerProfile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}

export function suggestAnalyzerProfileDefaults(input: { profileId?: string; model?: string; manufacturer?: string; protocol?: string }) {
  const direct = input.profileId ? getLabAnalyzerProfile(input.profileId) : undefined;
  const normalizedModel = input.model?.toLowerCase() ?? '';
  const normalizedManufacturer = input.manufacturer?.toLowerCase() ?? '';
  const normalizedProtocol = input.protocol?.toLowerCase();
  const profile = direct ?? PROFILES.find((candidate) => {
    if (normalizedProtocol && candidate.protocol !== normalizedProtocol) return false;
    const modelMatch = normalizedModel && (candidate.model.toLowerCase().includes(normalizedModel) || normalizedModel.includes(candidate.model.toLowerCase()));
    const manufacturerMatch = normalizedManufacturer && candidate.manufacturer.toLowerCase() === normalizedManufacturer;
    return Boolean(modelMatch || (manufacturerMatch && normalizedModel && candidate.name.toLowerCase().includes(normalizedModel)));
  });

  if (!profile) return null;
  return {
    profileId: profile.id,
    machine_type: profile.machineType,
    protocol: profile.protocol,
    port: profile.defaultPort,
    is_bidirectional: profile.bidirectional,
    ackMode: profile.defaultAckMode,
    requiresUnitMapping: Boolean(profile.requiresUnitMapping),
    requiresQualitativeMapping: Boolean(profile.requiresQualitativeMapping),
  };
}

export function buildLabMiddlewareConfigSnippet(input: {
  apiBaseUrl?: string;
  tenantId?: string | number;
  machineCode: string;
  machineName?: string | null;
  protocol?: string | null;
  port?: number | null;
  profileId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  agentCode?: string | null;
  siteName?: string | null;
}) {
  const profile = input.profileId ? getLabAnalyzerProfile(input.profileId) : undefined;
  const defaults = suggestAnalyzerProfileDefaults({
    profileId: input.profileId ?? undefined,
    manufacturer: input.manufacturer ?? undefined,
    model: input.model ?? undefined,
    protocol: input.protocol ?? undefined,
  });
  const protocol = String(profile?.protocol ?? defaults?.protocol ?? input.protocol ?? 'hl7').toLowerCase();
  const port = Number(input.port ?? profile?.defaultPort ?? defaults?.port ?? (protocol === 'astm' ? 9100 : 2575));
  const ackMode = profile?.defaultAckMode ?? defaults?.ackMode ?? 'always_ack_after_queue';
  const machineName = input.machineName || profile?.name || input.machineCode;

  return {
    api: {
      baseUrl: input.apiBaseUrl || 'https://your-hospital.ozzyl.com',
      apiKey: '[REDACTED_SECRET]',
      tenantId: input.tenantId ? String(input.tenantId) : '[TENANT_ID]',
    },
    queue: {
      dir: './queue',
      retryIntervalMs: 30000,
      maxAttempts: 10,
      baseDelayMs: 30000,
      maxDelayMs: 900000,
    },
    agent: {
      code: input.agentCode || `lis-bridge-${String(input.machineCode).toLowerCase()}`,
      name: 'Ozzyl Local LIS Bridge',
      siteName: input.siteName || 'Hospital Main Lab',
      version: '1.0.0',
      heartbeatIntervalMs: 60000,
    },
    astm: {
      enabled: protocol === 'astm',
      port: protocol === 'astm' ? port : 9100,
      machines: protocol === 'astm' ? [{ name: machineName, ip: '[ANALYZER_IP]', machineCode: input.machineCode }] : [],
    },
    hl7: {
      enabled: protocol !== 'astm',
      port: protocol === 'astm' ? 2575 : port,
      ackMode,
      machines: protocol !== 'astm' ? [{ name: machineName, ip: '[ANALYZER_IP]', machineCode: input.machineCode }] : [],
    },
    logging: {
      level: 'info',
      file: './logs/middleware.log',
    },
  };
}

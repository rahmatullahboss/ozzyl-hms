const os = require('os');

function sanitizeAgentCode(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 80) || 'local-lis-bridge';
}

function buildBridgeHeartbeatPayload(options = {}) {
  const config = options.config || {};
  const env = options.env || process.env;
  const protocols = [];
  if (config.astm?.enabled) protocols.push('astm');
  if (config.hl7?.enabled) protocols.push('hl7');

  const astmMachines = Array.isArray(config.astm?.machines) ? config.astm.machines.length : 0;
  const hl7Machines = Array.isArray(config.hl7?.machines) ? config.hl7.machines.length : 0;
  const queueDepth = Number(options.queueDepth || 0);
  const status = options.status || (queueDepth > 0 ? 'degraded' : 'active');

  return {
    agentCode: sanitizeAgentCode(env.LIS_BRIDGE_AGENT_CODE || config.agent?.code || os.hostname()),
    agentName: env.LIS_BRIDGE_AGENT_NAME || config.agent?.name || 'Ozzyl Local LIS Bridge',
    siteName: env.LIS_BRIDGE_SITE_NAME || config.agent?.siteName || config.api?.tenantId || undefined,
    hostFingerprint: env.LIS_BRIDGE_HOST_FINGERPRINT || config.agent?.hostFingerprint || `${os.platform()}-${os.hostname()}`,
    version: env.LIS_BRIDGE_VERSION || config.agent?.version || 'local-dev',
    status,
    lastError: options.lastError || undefined,
    capabilities: {
      protocols,
      astmEnabled: Boolean(config.astm?.enabled),
      hl7Enabled: Boolean(config.hl7?.enabled),
      astmMachines,
      hl7Machines,
      queueDepth,
      queueDir: options.queueDir,
      ackMode: options.ackMode,
    },
  };
}

module.exports = {
  buildBridgeHeartbeatPayload,
  sanitizeAgentCode,
};

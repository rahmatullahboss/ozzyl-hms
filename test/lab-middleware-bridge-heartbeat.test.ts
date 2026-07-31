import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildBridgeHeartbeatPayload,
  sanitizeAgentCode,
} = require('../tools/lab-middleware/bridge-heartbeat.cjs') as typeof import('../tools/lab-middleware/bridge-heartbeat.cjs');

describe('lab middleware bridge heartbeat', () => {
  it('builds an active heartbeat payload with protocol capabilities', () => {
    const payload = buildBridgeHeartbeatPayload({
      env: { LIS_BRIDGE_AGENT_CODE: 'lab bridge #1' },
      config: {
        api: { tenantId: 'tenant-1' },
        astm: { enabled: true, machines: [{ machineCode: 'A1' }] },
        hl7: { enabled: true, machines: [{ machineCode: 'H1' }, { machineCode: 'H2' }] },
      },
      queueDepth: 0,
      queueDir: './queue',
      ackMode: 'always_ack_after_queue',
    });

    expect(payload).toMatchObject({
      agentCode: 'lab-bridge--1',
      agentName: 'Ozzyl Local LIS Bridge',
      siteName: 'tenant-1',
      status: 'active',
      capabilities: {
        protocols: ['astm', 'hl7'],
        astmEnabled: true,
        hl7Enabled: true,
        astmMachines: 1,
        hl7Machines: 2,
        queueDepth: 0,
        queueDir: './queue',
        ackMode: 'always_ack_after_queue',
      },
    });
  });

  it('marks heartbeat degraded when queued payloads are waiting', () => {
    const payload = buildBridgeHeartbeatPayload({
      config: { astm: { enabled: false }, hl7: { enabled: true, machines: [] } },
      queueDepth: 3,
      lastError: 'api down',
    });

    expect(payload.status).toBe('degraded');
    expect(payload.lastError).toBe('api down');
    expect(payload.capabilities.queueDepth).toBe(3);
  });

  it('sanitizes agent code to match backend schema limits', () => {
    expect(sanitizeAgentCode('  bridge / ward @ 1  ')).toBe('bridge---ward---1');
    expect(sanitizeAgentCode('')).toBe('local-lis-bridge');
    expect(sanitizeAgentCode('x'.repeat(120))).toHaveLength(80);
  });
});

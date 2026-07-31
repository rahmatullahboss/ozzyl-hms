import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRetryQueue, calculateBackoffMs } = require('../tools/lab-middleware/retry-queue.cjs') as typeof import('../tools/lab-middleware/retry-queue.cjs');

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'lis-queue-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('lab middleware retry queue', () => {
  it('persists failed analyzer payloads and lists due items', () => withTempDir((dir) => {
    const queue = createRetryQueue(dir, { baseDelayMs: 1000, maxDelayMs: 5000 });
    const item = queue.enqueue('/api/lab-machines/hl7/receive', { machineCode: 'A-1', message: 'HL7' }, 'network');

    expect(item.id).toBeTruthy();
    const all = queue.list();
    expect(all).toHaveLength(1);
    expect(all[0].item).toMatchObject({
      endpoint: '/api/lab-machines/hl7/receive',
      payload: { machineCode: 'A-1', message: 'HL7' },
      attempts: 0,
      lastError: 'network',
    });
    expect(queue.due()).toHaveLength(1);
  }));

  it('moves retry time forward after failure and deletes on delivery', () => withTempDir((dir) => {
    const queue = createRetryQueue(dir, { baseDelayMs: 1000, maxDelayMs: 5000 });
    queue.enqueue('/api/lab-machines/astm/receive', { machineCode: 'A-2', message: 'ASTM' }, 'api');

    const [{ filePath, item }] = queue.list();
    const retry = queue.markFailed(filePath, item, '503');
    expect(retry).toMatchObject({ terminal: false, attempts: 1 });
    expect(queue.due(new Date())).toHaveLength(0);

    const [{ filePath: retryPath }] = queue.list();
    queue.markDelivered(retryPath);
    expect(queue.list()).toHaveLength(0);
  }));

  it('caps exponential backoff and marks terminal failures', () => withTempDir((dir) => {
    expect(calculateBackoffMs(10, { baseDelayMs: 1000, maxDelayMs: 5000 })).toBe(5000);

    const queue = createRetryQueue(dir, { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 5000 });
    queue.enqueue('/api/lab-machines/hl7/receive', { message: 'HL7' }, 'api');
    const [{ filePath, item }] = queue.list();
    const terminal = queue.markFailed(filePath, item, 'still down');

    expect(terminal).toMatchObject({ terminal: true, attempts: 1 });
    expect(queue.list()).toHaveLength(0);
  }));

  it('preserves a stable delivery id across retries', () => withTempDir((dir) => {
    const queue = createRetryQueue(dir, { baseDelayMs: 1000, maxDelayMs: 5000 });
    queue.enqueue(
      '/api/lab-machines/hl7/receive',
      { message: 'HL7' },
      'network',
      { deliveryId: 'delivery-123' },
    );
    const [{ filePath, item }] = queue.list();
    expect(item.deliveryId).toBe('delivery-123');

    queue.markFailed(filePath, item, '503');
    expect(queue.list()[0].item.deliveryId).toBe('delivery-123');
  }));

  it('encrypts queued clinical payloads and writes them atomically when configured', () => withTempDir((dir) => {
    const queue = createRetryQueue(dir, {
      encryptionKey: 'queue-' + 'encryption-key',
      baseDelayMs: 1000,
      maxDelayMs: 5000,
    });
    queue.enqueue('/api/lab-machines/hl7/receive', {
      machineCode: 'A-1',
      message: 'PID|||PATIENT-SECRET||DOE^JOHN',
    }, 'network', { deliveryId: 'delivery-encrypted' });

    const names = readdirSync(dir);
    expect(names.some((name) => name.endsWith('.tmp'))).toBe(false);
    const queueFile = names.find((name) => name.endsWith('.json'))!;
    const raw = readFileSync(join(dir, queueFile), 'utf8');
    expect(raw).not.toContain('PATIENT-SECRET');
    expect(raw).toContain('"encrypted": true');
    expect(queue.list()[0].item).toMatchObject({
      deliveryId: 'delivery-encrypted',
      payload: { message: 'PID|||PATIENT-SECRET||DOE^JOHN' },
    });
  }));

  it('quarantines corrupted encrypted queue files instead of retrying unknown data', () => withTempDir((dir) => {
    const queue = createRetryQueue(dir, { encryptionKey: 'queue-' + 'encryption-key' });
    queue.enqueue('/api/lab-machines/astm/receive', { message: 'ASTM' }, 'network');
    const queueFile = readdirSync(dir).find((name) => name.endsWith('.json'))!;
    writeFileSync(join(dir, queueFile), '{"version":2,"encrypted":true,"ciphertext":"tampered"}');

    expect(queue.list()).toHaveLength(0);
    expect(readdirSync(dir).some((name) => name.includes('.corrupt.'))).toBe(true);
  }));
});

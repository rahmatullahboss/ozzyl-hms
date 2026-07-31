import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createTransmissionJournal } = require('../tools/lab-middleware/transmission-journal.cjs');

function withTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'lis-journal-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('ASTM durable transmission journal', () => {
  it('persists each validated frame before acknowledgement and survives restart', () => withTempDir((dir) => {
    const first = createTransmissionJournal(dir, { encryptionKey: 'journal-' + 'key' });
    first.start('session-1', { machineCode: 'M1', remoteAddress: '10.0.0.2' });
    first.appendFrame('session-1', 'H|\\^&|||Mindray', false);
    first.appendFrame('session-1', 'P|1|PATIENT-1', false);

    const restarted = createTransmissionJournal(dir, { encryptionKey: 'journal-' + 'key' });
    expect(restarted.load('session-1')).toMatchObject({
      id: 'session-1',
      machineCode: 'M1',
      state: 'receiving',
      frameCount: 2,
      frames: ['H|\\^&|||Mindray', 'P|1|PATIENT-1'],
    });
  }));

  it('encrypts frame content and leaves no temporary file after atomic commits', () => withTempDir((dir) => {
    const journal = createTransmissionJournal(dir, { encryptionKey: 'journal-' + 'key' });
    journal.start('session-2', { machineCode: 'M2' });
    journal.appendFrame('session-2', 'P|1|PATIENT-SECRET', false);

    const names = readdirSync(dir);
    expect(names.some((name) => name.endsWith('.tmp'))).toBe(false);
    const file = names.find((name) => name.endsWith('.json'))!;
    const raw = readFileSync(join(dir, file), 'utf8');
    expect(raw).not.toContain('PATIENT-SECRET');
    expect(raw).toContain('"encrypted": true');
  }));

  it('marks a complete transmission delivered only after API acceptance or durable queueing', () => withTempDir((dir) => {
    const journal = createTransmissionJournal(dir, { encryptionKey: 'journal-' + 'key' });
    journal.start('session-3', { machineCode: 'M3' });
    journal.appendFrame('session-3', 'H|header', false);
    journal.markComplete('session-3', 'H|header\r');

    expect(journal.load('session-3')).toMatchObject({ state: 'complete', message: 'H|header\r' });
    journal.markDelivered('session-3', { deliveryId: 'delivery-3', queued: true });
    expect(journal.load('session-3')).toBeNull();
  }));

  it('quarantines corrupted journal evidence instead of treating it as valid', () => withTempDir((dir) => {
    const journal = createTransmissionJournal(dir, { encryptionKey: 'journal-' + 'key' });
    journal.start('session-4', { machineCode: 'M4' });
    const file = readdirSync(dir).find((name) => name.endsWith('.json'))!;
    writeFileSync(join(dir, file), '{"version":2,"encrypted":true,"ciphertext":"tampered"}');

    expect(journal.load('session-4')).toBeNull();
    expect(readdirSync(dir).some((name) => name.includes('.corrupt.'))).toBe(true);
  }));
});

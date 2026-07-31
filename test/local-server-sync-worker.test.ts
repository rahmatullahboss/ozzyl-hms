import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const worker = readFileSync('scripts/local-server/sync-worker.sh', 'utf8');
const compose = readFileSync('deploy/local-server/compose.yml', 'utf8');

describe('hospital local-server periodic sync worker contract', () => {
  it('runs local push before cloud pull in one sequential interval loop', () => {
    expect(worker).toContain('HMS_LOCAL_SYNC_INTERVAL_SECONDS:-300');
    expect(worker).toContain('while true; do');

    const loopStart = worker.indexOf('while true; do');
    const flushCall = worker.indexOf('flush_cloud_sync', loopStart);
    const pullCall = worker.indexOf('pull_cloud_sync', loopStart);
    const sleepCall = worker.indexOf('sleep "$INTERVAL"', loopStart);

    expect(flushCall).toBeGreaterThan(loopStart);
    expect(pullCall).toBeGreaterThan(flushCall);
    expect(sleepCall).toBeGreaterThan(pullCall);
  });

  it('skips cloud pull when the local outbox push fails, preserving unsynced local writes', () => {
    expect(worker).toContain('if flush_cloud_sync; then');
    expect(worker).toContain('cloud pull skipped because local outbox flush did not complete; preserving unsynced local data');
    expect(worker).toContain('return 1');

    const loopStart = worker.indexOf('while true; do');
    const conditionalFlush = worker.indexOf('if flush_cloud_sync; then', loopStart);
    const pullCall = worker.indexOf('pull_cloud_sync', conditionalFlush);
    const elseBranch = worker.indexOf('else', pullCall);
    const skippedMessage = worker.indexOf('preserving unsynced local data', elseBranch);

    expect(conditionalFlush).toBeGreaterThan(loopStart);
    expect(pullCall).toBeGreaterThan(conditionalFlush);
    expect(skippedMessage).toBeGreaterThan(elseBranch);
  });

  it('bounds every worker HTTP request with configurable connect and total timeouts', () => {
    expect(worker).toContain('HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS:-10');
    expect(worker).toContain('HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS:-60');
    expect(worker).toContain('curl --connect-timeout "$CONNECT_TIMEOUT" --max-time "$REQUEST_TIMEOUT" "$@"');
    expect(worker).not.toMatch(/\n\s*curl -(?:f?sS)/);
    expect(worker.match(/curl_sync -(?:f?sS)/g)?.length).toBe(7);
  });

  it('validates timing settings and spreads hospital startup load with bounded jitter', () => {
    expect(worker).toContain('require_positive_integer HMS_LOCAL_SYNC_INTERVAL_SECONDS "$INTERVAL"');
    expect(worker).toContain('require_positive_integer HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS "$CONNECT_TIMEOUT"');
    expect(worker).toContain('require_positive_integer HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS "$REQUEST_TIMEOUT"');
    expect(worker).toContain('require_non_negative_integer HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS "$STARTUP_JITTER"');
    expect(worker).toContain('HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS:-30');
    expect(worker).toContain('RANDOM % (STARTUP_JITTER + 1)');
  });

  it('passes worker reliability settings through the local-server compose service', () => {
    expect(compose).toContain('HMS_LOCAL_STATUS_URL: http://hms-app:8787/api/local-server/status');
    expect(compose).toContain('HMS_LOCAL_SYNC_INTERVAL_SECONDS: ${HMS_LOCAL_SYNC_INTERVAL_SECONDS:-300}');
    expect(compose).toContain('HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS: ${HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS:-10}');
    expect(compose).toContain('HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS: ${HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS:-60}');
    expect(compose).toContain('HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS: ${HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS:-30}');
  });
});

import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for the cache purge host resolution logic in prerender.tsx.
 *
 * The bug: cache purge targeted `hms-${subdomain}.ozzyl.com` (non-existent)
 * instead of the actual worker domain `hms-saas.rahmatullahzisan.workers.dev`.
 */

// We test the exported helper directly
import { getCachePurgeHosts } from '../../src/routes/public/prerender';

function mockDb(rows: { custom_domain: string | null; custom_domain_verified: number }[]) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(rows[0] ?? null),
      }),
    }),
  } as unknown as D1Database;
}

describe('getCachePurgeHosts', () => {
  it('always includes the default worker domain when no env override is provided', async () => {
    const db = mockDb([{ custom_domain: null, custom_domain_verified: 0 }]);
    const hosts = await getCachePurgeHosts('demo', 1, db, {});
    expect(hosts).toContain('hms-saas.rahmatullahzisan.workers.dev');
  });

  it('uses WORKER_HOST from env when provided', async () => {
    const db = mockDb([{ custom_domain: null, custom_domain_verified: 0 }]);
    const hosts = await getCachePurgeHosts('demo', 1, db, { WORKER_HOST: 'custom-worker.workers.dev' });
    expect(hosts).toContain('custom-worker.workers.dev');
    expect(hosts).not.toContain('hms-saas.rahmatullahzisan.workers.dev');
  });

  it('includes verified custom domain when tenant has one', async () => {
    const db = mockDb([{ custom_domain: 'hospital.example.com', custom_domain_verified: 1 }]);
    const hosts = await getCachePurgeHosts('demo', 1, db, {});
    expect(hosts).toContain('hms-saas.rahmatullahzisan.workers.dev');
    expect(hosts).toContain('hospital.example.com');
  });

  it('excludes unverified custom domain', async () => {
    const db = mockDb([{ custom_domain: 'hospital.example.com', custom_domain_verified: 0 }]);
    const hosts = await getCachePurgeHosts('demo', 1, db, {});
    expect(hosts).not.toContain('hospital.example.com');
  });

  it('never returns the old ozzyl.com domain', async () => {
    const db = mockDb([{ custom_domain: null, custom_domain_verified: 0 }]);
    const hosts = await getCachePurgeHosts('demo', 1, db, {});
    expect(hosts.every((h: string) => !h.includes('ozzyl.com'))).toBe(true);
  });
});

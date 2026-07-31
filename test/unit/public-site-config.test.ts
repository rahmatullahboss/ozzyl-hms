import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('public site worker-first asset routing config', () => {
  it('keeps public hospital-site and patient portal routes on the worker in the base and production assets config', () => {
    const wrangler = readFileSync('wrangler.toml', 'utf8');
    const workerFirstLines = wrangler.match(/run_worker_first = \[[^\]]+\]/g) ?? [];
    const publicSiteLines = workerFirstLines.filter((line) => line.includes('"/site"'));

    expect(publicSiteLines.length).toBeGreaterThanOrEqual(2);
    for (const line of publicSiteLines) {
      expect(line).toContain('"/api/*"');
      expect(line).toContain('"/patient/*"');
      expect(line).toContain('"/site"');
      expect(line).toContain('"/site/*"');
    }
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/emergency-profile.ts', 'utf8');

describe('emergency profile D1 batching', () => {
  it('fetches the emergency profile dependencies through one D1 batch call', () => {
    expect(source).toContain('const batchResults = await db.$client.batch([');
    expect(source).toContain('const patientRow = batchResults[0]?.results?.[0]');
    expect(source).toContain('const hospitalRow = batchResults[1]?.results?.[0]');
    expect(source).toContain('const allergiesResult = { results: batchResults[2]?.results || [] }');
    expect(source).toContain('const guardiansResult = { results: batchResults[5]?.results || [] }');
  });

  it('does not fan out the emergency profile reads with Promise.all', () => {
    expect(source).not.toContain('Promise.all([\n    db.$client.prepare');
  });
});

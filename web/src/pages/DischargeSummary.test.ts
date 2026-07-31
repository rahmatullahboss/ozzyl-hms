import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('DischargeSummary', () => {
  it('keeps hooks before error/loading early returns', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/DischargeSummary.tsx'), 'utf8');
    const firstLocalHook = source.indexOf('const [summary, setSummary] = useState<Summary>');
    expect(firstLocalHook).toBeGreaterThan(-1);
    expect(source.indexOf('if (isError)')).toBeGreaterThan(firstLocalHook);
    expect(source.indexOf('if (loading)')).toBeGreaterThan(firstLocalHook);
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DischargeSummary');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});

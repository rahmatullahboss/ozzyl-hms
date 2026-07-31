import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'AssetManagement.tsx');
const source = readFileSync(sourcePath, 'utf8');

describe('AssetManagement', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./AssetManagement');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('opens the requested tab from URL query params', () => {
    expect(source).toContain('getAssetManagementQueryState');
    expect(source).toContain('URLSearchParams(window.location.search)');
    expect(source).toContain('requestedTab');
    expect(source).toContain('TABS.includes');
  });

  it('supports deep-linking to a specific maintenance log', () => {
    expect(source).toContain('focusLogId');
    expect(source).toContain('logParam');
    expect(source).toContain('maintenance-log-');
    expect(source).toContain('scrollIntoView');
    expect(source).toContain('Focused maintenance log');
  });

  it('keeps tab changes synchronized with the URL', () => {
    expect(source).toContain('handleTabChange');
    expect(source).toContain('params.set');
    expect(source).toContain('params.delete');
    expect(source).toContain('window.history.replaceState');
  });

  it('highlights the selected maintenance row', () => {
    expect(source).toContain('ring-2 ring-amber-300');
    expect(source).toContain('scroll-mt-24');
    expect(source).toContain('focusLogId === m.id');
  });
});

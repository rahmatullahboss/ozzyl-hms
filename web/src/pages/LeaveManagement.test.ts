import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('LeaveManagement', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./LeaveManagement');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('page header reads hr:leaveTitle (not hr:title, which now belongs to HR Dashboard)', async () => {
    const source = readFileSync(resolve(__dirname, './LeaveManagement.tsx'), 'utf8');
    expect(source).toMatch(/page-title[^}]*hr:leaveTitle/);
    expect(source).not.toMatch(/page-title[^}]*hr:title[^a-zA-Z]/);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('HRDashboard helpers', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HRDashboard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('does not expose a LeaveTab function (leave is its own standalone page)', async () => {
    const source = readFileSync(resolve(__dirname, './HRDashboard.tsx'), 'utf8');
    expect(source).not.toMatch(/function\s+LeaveTab\b/);
  });

  it('TABS tuple no longer includes the leave or payroll tab', async () => {
    const source = readFileSync(resolve(__dirname, './HRDashboard.tsx'), 'utf8');
    const match = source.match(/const\s+TABS\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const tabs = match![1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    expect(tabs).toContain('overview');
    expect(tabs).toContain('attendance');
    expect(tabs).not.toContain('payroll');
    expect(tabs).not.toContain('leave');
  });

  it('does not expose a PayrollTab function (payroll is its own standalone page)', async () => {
    const source = readFileSync(resolve(__dirname, './HRDashboard.tsx'), 'utf8');
    expect(source).not.toMatch(/function\s+PayrollTab\b/);
  });

  it('tabIcons record no longer has a leave entry', async () => {
    const source = readFileSync(resolve(__dirname, './HRDashboard.tsx'), 'utf8');
    expect(source).not.toMatch(/leave\s*:\s*</);
  });

  it('conditional render no longer branches on activeTab === "leave"', async () => {
    const source = readFileSync(resolve(__dirname, './HRDashboard.tsx'), 'utf8');
    expect(source).not.toMatch(/activeTab\s*===\s*['"]leave['"]/);
  });
});

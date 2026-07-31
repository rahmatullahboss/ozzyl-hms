import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin dashboard v2 comparison route', () => {
  it('mounts the command center at the tenant dashboard/v2 path without replacing the legacy route', () => {
    const source = readFileSync('src/App.tsx', 'utf8');
    expect(source).toContain('<Route path="dashboard" element={<DashboardEntryRoute />} />');
    expect(source).toContain('<Route path="dashboard/v2" element={<AdminDashboard forceCommandCenter />} />');
  });
});

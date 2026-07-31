import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('patient analytics app route', () => {
  it('lazy-loads the compatibility redirect and mounts it at the historical tenant path', () => {
    const source = readFileSync('src/App.tsx', 'utf8');
    expect(source).toContain("const PatientAnalytics = lazy(() => import('./pages/analytics/PatientAnalytics'));");
    expect(source).toContain('<Route path="analytics/patients" element={<PatientAnalytics />} />');
    expect(source).not.toContain('<Route path="analytics/patients" element={<TenantRedirect path="reports" />} />');
  });
});

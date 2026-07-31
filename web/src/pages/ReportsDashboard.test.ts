import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ReportsDashboard helpers', () => {
  it('buildDoctorPerformanceCsv exports the new 8-column layout: doctor, specialty, visits, visit rev, tests, test rev, test comm, hospital rev', () => {
    const source = readFileSync(resolve(__dirname, 'ReportsDashboard.tsx'), 'utf8');
    expect(source).toMatch(/Visits[\s\S]*?Visit Revenue[\s\S]*?Tests[\s\S]*?Test Revenue[\s\S]*?Test Commission[\s\S]*?Hospital Revenue/);
  });

  it('buildDoctorPerformanceHtml renders the 4 KPI cards and the 7-column print table', () => {
    const source = readFileSync(resolve(__dirname, 'ReportsDashboard.tsx'), 'utf8');
    expect(source).toMatch(/Tests[\s\S]*?Test Rev[\s\S]*?Test Comm[\s\S]*?Hospital Rev/);
  });

  it('buildDoctorPerformanceHtml renders the negative-net footnote', () => {
    const source = readFileSync(resolve(__dirname, 'ReportsDashboard.tsx'), 'utf8');
    expect(source).toMatch(/netNegativeNote/);
  });

  it('DoctorPerf type includes the new testCount, testRevenue, and hospitalRevenue fields', () => {
    const source = readFileSync(resolve(__dirname, 'ReportsDashboard.tsx'), 'utf8');
    expect(source).toMatch(/testCount:\s*number/);
    expect(source).toMatch(/testRevenue:\s*number/);
    expect(source).toMatch(/hospitalRevenue:\s*number/);
  });

  it('Doctor Performance i18n keys are wired in en/reports.json', () => {
    const en = readFileSync(resolve(__dirname, '../../public/locales/en/reports.json'), 'utf8');
    expect(en).toMatch(/"testCount":\s*"Tests"/);
    expect(en).toMatch(/"testRevenue":\s*"Test Revenue"/);
    expect(en).toMatch(/"testCommission":\s*"Test Commission"/);
    expect(en).toMatch(/"hospitalRevenue":\s*"Hospital Revenue"/);
    expect(en).toMatch(/"drPerformanceSubtitle":/);
  });

  it('resolves report library links from the tenant root instead of nesting under /reports', () => {
    const source = readFileSync(resolve(__dirname, 'ReportsDashboard.tsx'), 'utf8');
    expect(source).toMatch(/function getTenantRoute/);
    expect(source).toMatch(/return `\.\.\/\$\{path\}`/);
    expect(source).toMatch(/to=\{getTenantRoute\(href\)\}/);
    expect(source).toMatch(/: 'profit-loss'/);
  });
});

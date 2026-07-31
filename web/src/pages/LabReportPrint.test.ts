import { describe, expect, it } from 'vitest';
import {
  canNotifyLabReport,
  isWithdrawnLabReport,
} from './LabReportPrint';

describe('LabReportPrint withdrawal safety', () => {
  it('detects withdrawn reports from status or timestamp', () => {
    expect(isWithdrawnLabReport({ report_status: 'retracted' })).toBe(true);
    expect(isWithdrawnLabReport({ report_status: 'published', retracted_at: '2026-07-10T00:00:00Z' })).toBe(true);
    expect(isWithdrawnLabReport({ report_status: 'published', retracted_at: null })).toBe(false);
  });

  it('allows patient notification only for active reports', () => {
    expect(canNotifyLabReport({ report_status: 'published', retracted_at: null })).toBe(true);
    expect(canNotifyLabReport({ report_status: 'retracted', retracted_at: '2026-07-10T00:00:00Z' })).toBe(false);
  });

  it('renders a printable withdrawn warning and disables patient notification actions', async () => {
    const source = await import('./LabReportPrint?raw');
    expect(source.default).toContain('WITHDRAWN — DO NOT USE FOR CLINICAL DECISIONS');
    expect(source.default).toContain('report.retraction_reason');
    expect(source.default).toContain('disabled={withdrawn}');
    expect(source.default).toContain('This historical report was formally withdrawn');
  });
});

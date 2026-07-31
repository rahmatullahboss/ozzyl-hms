import { describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import {
  assertLabReportNotRetracted,
  isRetractedLabReport,
} from '../src/lib/lis-retraction-guards';

describe('LIS retraction lifecycle guards', () => {
  it('detects withdrawn reports from status or retraction timestamp', () => {
    expect(isRetractedLabReport({ report_status: 'retracted' })).toBe(true);
    expect(isRetractedLabReport({ report_status: 'published', retracted_at: '2026-07-10' })).toBe(true);
    expect(isRetractedLabReport({ report_status: 'published', retracted_at: null })).toBe(false);
  });

  it('blocks verification or publication of a retracted report with a conflict', () => {
    expect(() => assertLabReportNotRetracted({ report_status: 'retracted' }, 'verified'))
      .toThrow(HTTPException);
    try {
      assertLabReportNotRetracted({ report_status: 'retracted' }, 'published');
    } catch (error) {
      expect(error).toMatchObject({ status: 409 });
      expect((error as Error).message).toContain('create an amended report instead');
    }
  });

  it('allows active reports to proceed through normal governance', () => {
    expect(() => assertLabReportNotRetracted({ report_status: 'pending' }, 'verified')).not.toThrow();
    expect(() => assertLabReportNotRetracted({ report_status: 'published' }, 'delivered')).not.toThrow();
  });

  it('wires the guard into all report-governance and patient-notification paths', async () => {
    const workflow = await import('../src/routes/tenant/labWorkflow?raw');
    const legacy = await import('../src/routes/tenant/lab?raw');
    const notifications = await import('../src/routes/tenant/labNotifications?raw');
    expect(workflow.default.match(/assertLabReportNotRetracted\(report, 'verified'\)/g)?.length).toBe(1);
    expect(workflow.default.match(/assertLabReportNotRetracted\(report, 'published'\)/g)?.length).toBe(1);
    expect(legacy.default).toContain("assertLabReportNotRetracted(report, 'reviewed')");
    expect(notifications.default).toContain("assertLabReportNotRetracted(report, 'sent by SMS')");
    expect(notifications.default).toContain("assertLabReportNotRetracted(report, 'sent by email')");
  });

  it('excludes withdrawn results from active clinical calculations and exports', async () => {
    const resultEntry = await import('../src/routes/tenant/lab-results?raw');
    const validation = await import('../src/routes/tenant/labValidation?raw');
    const predictive = await import('../src/routes/tenant/predictiveAnalytics?raw');
    const ai = await import('../src/routes/tenant/ai?raw');
    const ccda = await import('../src/routes/tenant/ccda?raw');
    const hospitalLinks = await import('../src/routes/hospital-links?raw');
    const doctorInbox = await import('../src/lib/doctor-lab-inbox?raw');
    const filter = "COALESCE(lr.result_status, '') <> 'retracted'";
    expect(resultEntry.default).toContain(filter);
    expect(validation.default.match(/COALESCE\(lr\.result_status, ''\) <> 'retracted'/g)?.length).toBe(2);
    expect(predictive.default).toContain(filter);
    expect(ai.default).toContain("COALESCE(result_status, '') <> 'retracted'");
    expect(ccda.default).toContain("COALESCE(result_status, '') <> 'retracted'");
    expect(hospitalLinks.default.match(/LOWER\(COALESCE\(result_status, ''\)\) <> 'retracted'/g)?.length).toBe(2);
    expect(doctorInbox.default.match(/COALESCE\(loi\.result_status, ''\) <> 'retracted'/g)?.length).toBe(2);
  });
});

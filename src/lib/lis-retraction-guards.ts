import { HTTPException } from 'hono/http-exception';

export interface LabReportRetractionState {
  report_status?: unknown;
  retracted_at?: unknown;
  retraction_reason?: unknown;
}

export function isRetractedLabReport(report: LabReportRetractionState | null | undefined): boolean {
  return String(report?.report_status ?? '').trim().toLowerCase() === 'retracted'
    || report?.retracted_at != null;
}

export function assertLabReportNotRetracted(
  report: LabReportRetractionState | null | undefined,
  action: string,
): void {
  if (!isRetractedLabReport(report)) return;
  throw new HTTPException(409, {
    message: `Retracted laboratory report cannot be ${action}; create an amended report instead`,
  });
}

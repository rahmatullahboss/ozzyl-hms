import { describe, expect, it } from 'vitest';
import {
  analyzerRetractionQueueUrl,
  canViewAnalyzerRetractionQueue,
  retractionRequestLabel,
  retractionStatusBadge,
} from './AnalyzerRetractionQueueTab';

describe('AnalyzerRetractionQueueTab helpers', () => {
  it('restricts the retraction queue to governance roles', () => {
    expect(canViewAnalyzerRetractionQueue('pathologist')).toBe(true);
    expect(canViewAnalyzerRetractionQueue('lab-supervisor')).toBe(true);
    expect(canViewAnalyzerRetractionQueue('hospital_admin')).toBe(true);
    expect(canViewAnalyzerRetractionQueue('md')).toBe(true);
    expect(canViewAnalyzerRetractionQueue('lab_tech')).toBe(false);
  });

  it('builds a machine-scoped queue URL with encoded filters', () => {
    expect(analyzerRetractionQueueUrl({ machineId: 4, status: 'requested', search: 'ORD 21' })).toBe(
      '/api/lab-machines/retraction-requests?machineId=4&status=requested&q=ORD%2021',
    );
    expect(analyzerRetractionQueueUrl({ machineId: 4, status: 'all', search: ' ' })).toBe(
      '/api/lab-machines/retraction-requests?machineId=4&status=all',
    );
  });

  it('formats queue labels and status badges', () => {
    expect(retractionRequestLabel({
      id: 701,
      patient_name: 'Patient One',
      test_name: 'Hemoglobin',
      order_no: 'ORD-21',
    })).toBe('Patient One · Hemoglobin · ORD-21');
    expect(retractionRequestLabel({ id: 702 })).toBe('Retraction #702');
    expect(retractionStatusBadge('requested')).toBe('badge-warning');
    expect(retractionStatusBadge('applied')).toBe('badge-danger');
    expect(retractionStatusBadge('rejected')).toBe('badge-secondary');
  });

  it('wires second-person approval, rejection, and delivery monitoring to governed endpoints', async () => {
    const source = await import('./AnalyzerRetractionQueueTab?raw');
    expect(source.default).toContain('/api/lab-machines/retraction-requests/${row.id}/approve');
    expect(source.default).toContain('/api/lab-machines/retraction-requests/${row.id}/reject');
    expect(source.default).toContain('row.can_review');
    expect(source.default).toContain('The requester cannot review their own request');
    expect(source.default).toContain("import AnalyzerRetractionNotificationMonitor from './AnalyzerRetractionNotificationMonitor'");
    expect(source.default).toContain('<AnalyzerRetractionNotificationMonitor machineId={machineId} />');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildAnalyzerRetractionRequestPayload,
  buildAnalyzerRetractionReviewPayload,
  canManageAnalyzerRetraction,
  isAnalyzerRetractionApplied,
  shouldShowAnalyzerRetractionRequestForm,
} from './AnalyzerRetractionPanel';

describe('AnalyzerRetractionPanel helpers', () => {
  it('allows only laboratory governance roles to manage accepted-result retraction', () => {
    expect(canManageAnalyzerRetraction('pathologist')).toBe(true);
    expect(canManageAnalyzerRetraction('lab-supervisor')).toBe(true);
    expect(canManageAnalyzerRetraction('hospital_admin')).toBe(true);
    expect(canManageAnalyzerRetraction('md')).toBe(true);
    expect(canManageAnalyzerRetraction('lab_tech')).toBe(false);
  });

  it('shows a request form only for accepted active results with no open/applied request', () => {
    expect(shouldShowAnalyzerRetractionRequestForm({
      disposition: 'accepted',
      existing_result_status: 'final',
      retraction_status: null,
    })).toBe(true);
    expect(shouldShowAnalyzerRetractionRequestForm({
      disposition: 'accepted',
      existing_result_status: 'final',
      retraction_status: 'rejected',
    })).toBe(true);
    expect(shouldShowAnalyzerRetractionRequestForm({
      disposition: 'accepted',
      existing_result_status: 'retracted',
      retraction_status: 'applied',
    })).toBe(false);
    expect(shouldShowAnalyzerRetractionRequestForm({
      disposition: 'review_required',
      existing_result_status: 'final',
      retraction_status: null,
    })).toBe(false);
  });

  it('detects an applied retraction from either request status or applied lineage', () => {
    expect(isAnalyzerRetractionApplied({ retraction_status: 'applied', applied_retraction_request_id: null })).toBe(true);
    expect(isAnalyzerRetractionApplied({ retraction_status: 'requested', applied_retraction_request_id: 701 })).toBe(true);
    expect(isAnalyzerRetractionApplied({ retraction_status: null, applied_retraction_request_id: null })).toBe(false);
  });

  it('builds trimmed optimistic request and review payloads', () => {
    expect(buildAnalyzerRetractionRequestPayload({
      source: { state_version: 2 },
      reasonCode: 'wrong_order',
      reason: '  Result belongs to another order.  ',
      notes: '  Analyzer and specimen were checked. ',
    })).toEqual({
      expectedInboxVersion: 2,
      reasonCode: 'wrong_order',
      reason: 'Result belongs to another order.',
      notes: 'Analyzer and specimen were checked.',
    });
    expect(buildAnalyzerRetractionReviewPayload({
      requestVersion: 1,
      reviewNotes: '  Verified source and patient identity. ',
    })).toEqual({
      expectedVersion: 1,
      reviewNotes: 'Verified source and patient identity.',
    });
  });

  it('wires request, approval, and rejection to governed endpoints', async () => {
    const source = await import('./AnalyzerRetractionPanel?raw');
    expect(source.default).toContain('/api/lab-machines/inbox/${sourceEvidence.id}/retraction-requests');
    expect(source.default).toContain('/api/lab-machines/retraction-requests/${sourceEvidence.retraction_request_id}/approve');
    expect(source.default).toContain('/api/lab-machines/retraction-requests/${sourceEvidence.retraction_request_id}/reject');
    expect(source.default).toContain('A different governance reviewer must approve');
  });
});

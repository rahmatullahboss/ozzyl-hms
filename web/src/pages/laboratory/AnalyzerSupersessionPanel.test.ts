import { describe, expect, it } from 'vitest';
import {
  analyzerSupersessionTargetsUrl,
  buildAnalyzerSupersessionPayload,
  canCreateAnalyzerSupersession,
  canRematchAcceptedAnalyzerEvidence,
  supersessionRequiresQcOverride,
  supersessionRequiresValidationOverride,
} from './AnalyzerSupersessionPanel';

describe('AnalyzerSupersessionPanel helpers', () => {
  it('restricts supersession creation to laboratory clinical governance roles', () => {
    expect(canCreateAnalyzerSupersession('pathologist')).toBe(true);
    expect(canCreateAnalyzerSupersession('lab-supervisor')).toBe(true);
    expect(canCreateAnalyzerSupersession('hospital_admin')).toBe(false);
    expect(canCreateAnalyzerSupersession('md')).toBe(false);
    expect(canCreateAnalyzerSupersession('lab_tech')).toBe(false);
  });

  it('builds an encoded same-test target search URL', () => {
    expect(analyzerSupersessionTargetsUrl(80, 'ORD 21')).toBe(
      '/api/lab-machines/inbox/80/targets?q=ORD%2021',
    );
    expect(analyzerSupersessionTargetsUrl(80, '  ')).toBe(
      '/api/lab-machines/inbox/80/targets',
    );
  });

  it('unlocks alternate rematch for accepted evidence only after applied retraction', () => {
    expect(canRematchAcceptedAnalyzerEvidence({ disposition: 'accepted', applied_retraction_request_id: null })).toBe(false);
    expect(canRematchAcceptedAnalyzerEvidence({ disposition: 'accepted', applied_retraction_request_id: 701 })).toBe(true);
    expect(canRematchAcceptedAnalyzerEvidence({ disposition: 'rejected', applied_retraction_request_id: null })).toBe(true);
  });

  it('requires QC override evidence unless the original QC gate passed or was already overridden', () => {
    expect(supersessionRequiresQcOverride({ qc_state: 'fail' })).toBe(true);
    expect(supersessionRequiresQcOverride({ qc_state: 'config_missing' })).toBe(true);
    expect(supersessionRequiresQcOverride({ qc_state: 'pass' })).toBe(false);
    expect(supersessionRequiresQcOverride({ qc_state: 'override' })).toBe(false);
  });

  it('requires validation override evidence for failed validation or a changed patient', () => {
    const source = { patient_id: 40, validation_state: 'pass' };
    expect(supersessionRequiresValidationOverride(source, { patient_id: 40 })).toBe(false);
    expect(supersessionRequiresValidationOverride(source, { patient_id: 41 })).toBe(true);
    expect(supersessionRequiresValidationOverride({ ...source, validation_state: 'fail' }, { patient_id: 40 })).toBe(true);
    expect(supersessionRequiresValidationOverride({ patient_id: null, validation_state: 'pass' }, { patient_id: 40 })).toBe(true);
  });

  it('builds a trimmed optimistic supersession request without empty override fields', () => {
    expect(buildAnalyzerSupersessionPayload({
      source: { state_version: 3 },
      targetLabOrderItemId: 11,
      reason: '  Correct order linkage after clinical review.  ',
      qcOverrideReason: '  ',
      validationOverrideReason: ' Patient identity was manually verified. ',
    })).toEqual({
      expectedVersion: 3,
      targetLabOrderItemId: 11,
      reason: 'Correct order linkage after clinical review.',
      validationOverrideReason: 'Patient identity was manually verified.',
    });
  });

  it('wires target search and supersession creation to the governed endpoints', async () => {
    const source = await import('./AnalyzerSupersessionPanel?raw');
    expect(source.default).toContain('/api/lab-machines/inbox/${sourceEvidence.id}/supersede');
    expect(source.default).toContain('analyzerSupersessionTargetsUrl(sourceEvidence.id, search)');
    expect(source.default).toContain('A different reviewer must accept the new row');
  });
});

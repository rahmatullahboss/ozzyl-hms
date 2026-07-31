import { describe, expect, it } from 'vitest';
import {
  analyzerInboxListUrl,
  analyzerInboxResultLabel,
  canAcceptAnalyzerInbox,
  canFinalizeAnalyzerInbox,
  analyzerInboxStatusBadge,
} from './AnalyzerInboxTab';

describe('AnalyzerInboxTab helpers', () => {
  it('builds a machine-scoped reviewer queue URL with encoded filters', () => {
    expect(analyzerInboxListUrl({
      machineId: 7,
      disposition: 'review_required',
      critical: 'true',
      search: 'Patient One',
    })).toBe('/api/lab-machines/inbox?machineId=7&disposition=review_required&critical=true&q=Patient%20One&limit=50');
  });

  it('omits an empty search term without losing the safety filters', () => {
    expect(analyzerInboxListUrl({
      machineId: 7,
      disposition: 'all',
      critical: 'all',
      search: '  ',
    })).toBe('/api/lab-machines/inbox?machineId=7&disposition=all&critical=all&limit=50');
  });

  it('includes later reviewer pages so evidence beyond the first 50 rows remains reachable', () => {
    expect(analyzerInboxListUrl({
      machineId: 7,
      disposition: 'review_required',
      critical: 'all',
      search: '',
      page: 3,
    })).toBe('/api/lab-machines/inbox?machineId=7&disposition=review_required&critical=all&page=3&limit=50');
  });

  it('allows only governance roles to make final accept or reject decisions', () => {
    for (const role of ['pathologist', 'lab_supervisor', 'hospital_admin', 'md']) {
      expect(canFinalizeAnalyzerInbox(role)).toBe(true);
    }
    expect(canFinalizeAnalyzerInbox('lab_tech')).toBe(false);
    expect(canFinalizeAnalyzerInbox('laboratory')).toBe(false);
  });

  it('only enables acceptance when matching, QC, validation, and disposition are safe', () => {
    const safe = {
      disposition: 'review_required',
      match_state: 'exact',
      qc_state: 'pass',
      validation_state: 'override',
    };
    expect(canAcceptAnalyzerInbox(safe)).toBe(true);
    expect(canAcceptAnalyzerInbox({ ...safe, match_state: 'ambiguous' })).toBe(false);
    expect(canAcceptAnalyzerInbox({ ...safe, qc_state: 'missing' })).toBe(false);
    expect(canAcceptAnalyzerInbox({ ...safe, validation_state: 'blocked' })).toBe(false);
    expect(canAcceptAnalyzerInbox({ ...safe, disposition: 'accepted' })).toBe(false);
  });

  it('creates a concise patient, test, and result label', () => {
    expect(analyzerInboxResultLabel({
      id: 80,
      patient_name: 'Patient One',
      patient_code: 'P-40',
      test_name: 'Hemoglobin',
      test_code: 'HGB',
      normalized_value: '14.2',
      normalized_units: 'g/dL',
    })).toBe('Patient One · Hemoglobin · 14.2 g/dL');
  });

  it('uses danger badges for critical and blocked states', () => {
    expect(analyzerInboxStatusBadge('critical')).toBe('badge-danger');
    expect(analyzerInboxStatusBadge('qc_blocked')).toBe('badge-danger');
    expect(analyzerInboxStatusBadge('review_required')).toBe('badge-warning');
    expect(analyzerInboxStatusBadge('accepted')).toBe('badge-success');
  });

  it('uses the freshly loaded detail version as the authoritative review record', async () => {
    const source = await import('./AnalyzerInboxTab?raw');
    expect(source.default).toContain('const selected = detail ?? rows.find');
    expect(source.default).not.toContain('const selected = rows.find(row => row.id === selectedId) ?? detail');
  });

  it('mounts the immutable supersession workflow against detailed evidence', async () => {
    const source = await import('./AnalyzerInboxTab?raw');
    expect(source.default).toContain("import AnalyzerSupersessionPanel from './AnalyzerSupersessionPanel'");
    expect(source.default).toContain('<AnalyzerSupersessionPanel');
    expect(source.default).toContain('sourceEvidence={detail}');
  });

  it('mounts formal accepted-result retraction before supersession controls', async () => {
    const source = await import('./AnalyzerInboxTab?raw');
    expect(source.default).toContain("import AnalyzerRetractionPanel from './AnalyzerRetractionPanel'");
    expect(source.default).toContain('<AnalyzerRetractionPanel');
    expect(source.default).toContain('sourceEvidence={detail}');
    expect(source.default.indexOf('<AnalyzerRetractionPanel')).toBeLessThan(
      source.default.indexOf('<AnalyzerSupersessionPanel'),
    );
  });
});

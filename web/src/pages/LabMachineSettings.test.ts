import { describe, expect, it } from 'vitest';

describe('LabMachineSettings', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('formats unmatched LIS result labels', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.unmatchedResultLabel({ id: 7, identifier_type: 'barcode', identifier_value: 'BC-1', machine_test_code: 'HGB' })).toBe('barcode: BC-1 · HGB');
    expect(mod.unmatchedResultLabel({ id: 8, machine_test_code: 'WBC' })).toBe('Result #8 · WBC');
  });

  it('allows resolving only open unmatched LIS results', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.canResolveUnmatchedResult({ status: 'open' })).toBe(true);
    expect(mod.canResolveUnmatchedResult({ status: 'resolved' })).toBe(false);
    expect(mod.canResolveUnmatchedResult({ status: 'ignored' })).toBe(false);
  });

  it('builds unmatched candidate search defaults and URLs', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.initialUnmatchedCandidateSearch({ identifier_value: ' BC-99 ', machine_test_code: 'HGB' })).toBe('BC-99');
    expect(mod.initialUnmatchedCandidateSearch({ machine_test_code: ' WBC ' })).toBe('WBC');
    expect(mod.unmatchedCandidateSearchUrl('BC 99')).toBe('/api/lab-machines/unmatched-results/candidates?q=BC%2099&limit=8');
  });

  it('formats unmatched candidate labels for staff selection', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.unmatchedCandidateLabel({
      lab_order_item_id: 11,
      order_no: 'LAB-1',
      patient_name: 'Rahim',
      test_name: 'Hemoglobin',
      item_barcode: 'BC-1',
    })).toBe('#11 · Rahim · Hemoglobin · LAB-1 · BC-1');
  });

  it('formats and applies analyzer profile defaults to machine form', async () => {
    const mod = await import('./LabMachineSettings');
    const profile = {
      id: 'mindray-bs200-hl7',
      name: 'Mindray BS-200',
      manufacturer: 'Mindray',
      model: 'BS-200',
      protocol: 'hl7',
      machineType: 'biochemistry',
      bidirectional: true,
      defaultPort: 2575,
    };

    expect(mod.analyzerProfileLabel(profile)).toBe('Mindray BS-200 · HL7 · biochemistry');
    expect(mod.applyAnalyzerProfileToMachineForm({ port: '', manufacturer: '', model_number: '', machine_type: 'other', protocol: 'astm', is_bidirectional: false }, profile)).toMatchObject({
      manufacturer: 'Mindray',
      model_number: 'BS-200',
      machine_type: 'biochemistry',
      protocol: 'hl7',
      port: '2575',
      is_bidirectional: true,
    });
  });

  it('merges backend machine capabilities before fallback UI options', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.mergeCapabilityOptions(['astm', 'hl7'], ['hl7_mllp', 'hl7', 'json'])).toEqual(['hl7_mllp', 'hl7', 'json', 'astm']);
    expect(mod.mergeCapabilityOptions(['tcp'], undefined)).toEqual(['tcp']);
  });

  it('formats machine capability notes from backend capabilities', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.machineCapabilityNotes({
      capabilities: [{ machineType: 'biochemistry', notes: 'Chemistry analyzers need unit conversion.', examples: ['Mindray BS', 'Roche Cobas'] }],
    }, 'biochemistry')).toBe('Chemistry analyzers need unit conversion. Examples: Mindray BS, Roche Cobas.');
    expect(mod.machineCapabilityNotes({ capabilities: [] }, 'hematology')).toBe('');
  });

  it('parses qualitative mapping input safely for machine test mappings', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.parseQualitativeMapInput('POS=Positive\nDetected=Positive\nNEG:Negative')).toEqual({
      POS: 'Positive',
      Detected: 'Positive',
      NEG: 'Negative',
    });
    expect(mod.parseQualitativeMapInput('{"Reactive":"Positive","Non-reactive":"Negative"}')).toEqual({
      Reactive: 'Positive',
      'Non-reactive': 'Negative',
    });
    expect(mod.parseQualitativeMapInput('')).toBeUndefined();
    expect(() => mod.parseQualitativeMapInput('POS Positive')).toThrow('Use one alias per line');
  });

  it('summarizes qualitative mappings for the mapping table', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.qualitativeMapSummary(JSON.stringify({ POS: 'Positive', Detected: 'Positive', NEG: 'Negative', NR: 'Non-reactive' }))).toBe('POS→Positive, Detected→Positive, NEG→Negative +1');
    expect(mod.qualitativeMapSummary(null)).toBe('—');
    expect(mod.qualitativeMapSummary('not-json')).toBe('Invalid map');
  });

  it('wires the analyzer inbox reviewer into each machine detail panel', async () => {
    const source = await import('./LabMachineSettings?raw');
    expect(source.default).toContain("import AnalyzerInboxTab from './laboratory/AnalyzerInboxTab'");
    expect(source.default).toContain("detailTab === 'inbox'");
    expect(source.default).toContain('<AnalyzerInboxTab machineId={selectedMachine.id} role={role} />');
  });

  it('wires a governance-only accepted-result retraction queue into machine details', async () => {
    const source = await import('./LabMachineSettings?raw');
    expect(source.default).toContain("import AnalyzerRetractionQueueTab");
    expect(source.default).toContain("detailTab === 'retractions'");
    expect(source.default).toContain("canViewAnalyzerRetractionQueue(role)");
    expect(source.default).toContain('<AnalyzerRetractionQueueTab machineId={selectedMachine.id} role={role} />');
  });

  it('formats analyzer run status badges and summaries for operator review', async () => {
    const mod = await import('./LabMachineSettings');
    expect(mod.analyzerRunStatusBadge('completed')).toBe('badge-success');
    expect(mod.analyzerRunStatusBadge('partial')).toBe('badge-warning');
    expect(mod.analyzerRunStatusBadge('qc_review')).toBe('badge-warning');
    expect(mod.analyzerRunStatusBadge('error')).toBe('badge-danger');
    expect(mod.analyzerRunStatusBadge('unknown')).toBe('badge-secondary');
    expect(mod.analyzerRunSummaryText({
      total_results: 5,
      matched: 3,
      unmatched: 2,
      blocked: 1,
      qc: 1,
      duplicate: 1,
      corrected: 1,
    })).toBe('5 results · 3 matched · 2 unmatched · 1 blocked · 1 QC · 1 duplicate · 1 corrected');
    expect(mod.analyzerRunSummaryText({ total_results: 2, matched: 2, unmatched: 0, blocked: 0, qc: 0, duplicate: 0, corrected: 0 })).toBe('2 results · 2 matched · 0 unmatched');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('DigitalPrescription', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DigitalPrescription');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('keeps fulfilment out of the doctor prescription screen and carries verified dispensing metadata', () => {
    const source = readFileSync('src/pages/DigitalPrescription.tsx', 'utf8');
    expect(source).not.toContain('/order-delivery');
    expect(source).not.toContain('Medicine Delivery');
    expect(source).toContain('medicineId: m.medicine_id');
    expect(source).toContain('quantity');
  });

  it('applies repeat prescription items from the repeat endpoint response', () => {
    const source = readFileSync('src/pages/DigitalPrescription.tsx', 'utf8');

    expect(source).toContain('items: r.items');
    expect(source).toContain('applyRepeatData({ ...r.prescription, items: r.items');
  });

  it('prints a newly-created prescription using the returned id instead of stale state', () => {
    const source = readFileSync('src/pages/DigitalPrescription.tsx', 'utf8');

    expect(source).toContain('const saved = await save(\'final\')');
    expect(source).toContain('const printableId = saved?.id ?? rxId');
  });

  it('uses lab catalog search for prescription lab orders instead of only fixed checkboxes', () => {
    const source = readFileSync('src/pages/DigitalPrescription.tsx', 'utf8');

    expect(source).toContain('interface LabTestSearchResult');
    expect(source).toContain('/api/lab?search=${encodeURIComponent(labSearch)}');
    expect(source).toContain('addLabTestFromCatalog');
    expect(source).toContain('selectedLabTestDetails');
    expect(source).not.toContain('const LAB_TESTS =');
  });

  it('shows deterministic EHR highlights from the patient chart without requesting an AI summary', () => {
    const source = readFileSync('src/pages/DigitalPrescription.tsx', 'utf8');

    expect(source).toContain('interface PrescriptionChartSummary');
    expect(source).toContain('/api/patients/${patientIdParam}/chart');
    expect(source).not.toContain('/api/patients/${patientIdParam}/chart?includeAiSummary=1');
    expect(source).toContain('ehrHighlightGroups');
    expect(source).toContain('rx.ehrHighlights');
    expect(source).toContain('rx.openFullChart');
  });

  it('offers quick follow-up shortcuts while preserving manual date entry', () => {
    const source = readFileSync('src/pages/DigitalPrescription.tsx', 'utf8');

    expect(source).toContain('FOLLOW_UP_SHORTCUTS');
    expect(source).toContain('toLocalDateInputValue');
    expect(source).toContain('applyFollowUpShortcut');
    expect(source).toContain('rx.followUpShortcut.7d');
    expect(source).toContain('rx.followUpShortcut.15d');
    expect(source).toContain('rx.followUpShortcut.1m');
  });
});

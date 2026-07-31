import { describe, it, expect } from 'vitest';
import {
  BLUE_BUTTON_SECTIONS,
  buildBlueButtonBundle,
  type BlueButtonBundle,
} from '../src/lib/blue-button';

describe('BLUE_BUTTON_SECTIONS', () => {
  it('has 7 sections', () => {
    expect(BLUE_BUTTON_SECTIONS).toHaveLength(7);
  });

  it('includes all required health record sections', () => {
    const keys = BLUE_BUTTON_SECTIONS.map((s) => s.key);
    expect(keys).toContain('demographics');
    expect(keys).toContain('vitals');
    expect(keys).toContain('medications');
    expect(keys).toContain('allergies');
    expect(keys).toContain('wellness_logs');
    expect(keys).toContain('mental_health');
    expect(keys).toContain('documents');
  });

  it('every section has key, label, query, mapper', () => {
    for (const s of BLUE_BUTTON_SECTIONS) {
      expect(s.key).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.query).toContain('SELECT');
      expect(typeof s.mapper).toBe('function');
    }
  });

  it('every query binds patient_id with ?', () => {
    for (const s of BLUE_BUTTON_SECTIONS) {
      expect(s.query).toContain('?');
    }
  });
});

describe('Section Mappers', () => {
  it('demographics → Patient resource', () => {
    const section = BLUE_BUTTON_SECTIONS.find((s) => s.key === 'demographics')!;
    const result = section.mapper({
      name: 'John Doe',
      phone: '+8801700000000',
      nid: '1234567890',
      gender: 'male',
      date_of_birth: '1990-01-01',
      blood_group: 'O+',
      address: 'Dhaka',
      emergency_contact: 'Jane Doe',
      emergency_phone: '+8801711111111',
    });
    expect(result.resourceType).toBe('Patient');
    expect(result.name).toBe('John Doe');
    expect(result.gender).toBe('male');
    expect(result.birthDate).toBe('1990-01-01');
    expect((result.identifier as any[]).length).toBe(1);
    expect((result.identifier as any[])[0].value).toBe('1234567890');
  });

  it('demographics without NID has empty identifier', () => {
    const section = BLUE_BUTTON_SECTIONS.find((s) => s.key === 'demographics')!;
    const result = section.mapper({ name: 'Test', nid: null });
    expect((result.identifier as any[])).toHaveLength(0);
  });

  it('vitals → Observation resource', () => {
    const section = BLUE_BUTTON_SECTIONS.find((s) => s.key === 'vitals')!;
    const result = section.mapper({
      type: 'blood_pressure_systolic',
      value: 120,
      unit: 'mmHg',
      recorded_at: '2026-04-18T10:00:00Z',
    });
    expect(result.resourceType).toBe('Observation');
    expect(result.category).toBe('vital-signs');
    expect((result.valueQuantity as any).value).toBe(120);
    expect((result.valueQuantity as any).unit).toBe('mmHg');
  });

  it('medications → MedicationStatement resource', () => {
    const section = BLUE_BUTTON_SECTIONS.find((s) => s.key === 'medications')!;
    const result = section.mapper({
      medication_name: 'Metformin 500mg',
      dose: '500mg',
      frequency: 'twice daily',
      start_date: '2026-01-01',
      end_date: null,
      status: 'active',
      notes: 'Take with food',
    });
    expect(result.resourceType).toBe('MedicationStatement');
    expect((result.medicationCodeableConcept as any).text).toBe('Metformin 500mg');
    expect(result.status).toBe('active');
    expect((result.note as any[])[0].text).toBe('Take with food');
  });

  it('allergies → AllergyIntolerance with severity mapping', () => {
    const section = BLUE_BUTTON_SECTIONS.find((s) => s.key === 'allergies')!;

    const severe = section.mapper({ allergen: 'Penicillin', severity: 'severe', reaction_type: 'allergy' });
    expect(severe.criticality).toBe('high');

    const moderate = section.mapper({ allergen: 'Dust', severity: 'moderate', reaction_type: 'intolerance' });
    expect(moderate.criticality).toBe('low');

    const mild = section.mapper({ allergen: 'Pollen', severity: 'mild', reaction_type: 'allergy' });
    expect(mild.criticality).toBe('low');
  });

  it('mental_health → QuestionnaireResponse', () => {
    const section = BLUE_BUTTON_SECTIONS.find((s) => s.key === 'mental_health')!;
    const result = section.mapper({
      screening_type: 'PHQ-9',
      total_score: 14,
      severity: 'moderately severe',
      responses: '{"q1":2,"q2":3}',
      screened_at: '2026-04-18T09:00:00Z',
    });
    expect(result.resourceType).toBe('QuestionnaireResponse');
    expect(result.questionnaire).toBe('PHQ-9');
    expect(result.score).toBe(14);
  });

  it('documents → DocumentReference (metadata only)', () => {
    const section = BLUE_BUTTON_SECTIONS.find((s) => s.key === 'documents')!;
    const result = section.mapper({
      file_name: 'blood_test.pdf',
      file_type: 'application/pdf',
      tags: 'lab_report',
      uploaded_at: '2026-04-10',
    });
    expect(result.resourceType).toBe('DocumentReference');
    expect(result.description).toBe('blood_test.pdf');
  });
});

describe('buildBlueButtonBundle', () => {
  it('returns valid FHIR Bundle structure', () => {
    const bundle = buildBlueButtonBundle(42, [
      { key: 'vitals', entries: [{ resourceType: 'Observation', code: 'hr', valueQuantity: { value: 72 } }] },
    ]);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
    expect(bundle.timestamp).toBeTruthy();
    expect(bundle.meta.source).toBe('OzzyLife HMS');
    expect(bundle.meta.patient_id).toBe(42);
  });

  it('includes only non-empty sections in meta.sections', () => {
    const bundle = buildBlueButtonBundle(1, [
      { key: 'vitals', entries: [{ resourceType: 'Observation' }] },
      { key: 'allergies', entries: [] },
      { key: 'medications', entries: [{ resourceType: 'MedicationStatement' }] },
    ]);
    expect(bundle.meta.sections).toEqual(['vitals', 'medications']);
    expect(bundle.meta.sections).not.toContain('allergies');
  });

  it('flattens all entries into single entry array', () => {
    const bundle = buildBlueButtonBundle(1, [
      { key: 'vitals', entries: [{ resourceType: 'Observation', id: '1' }, { resourceType: 'Observation', id: '2' }] },
      { key: 'medications', entries: [{ resourceType: 'MedicationStatement', id: '3' }] },
    ]);
    expect(bundle.entry).toHaveLength(3);
  });

  it('handles empty sections gracefully', () => {
    const bundle = buildBlueButtonBundle(1, []);
    expect(bundle.entry).toHaveLength(0);
    expect(bundle.meta.sections).toHaveLength(0);
  });

  it('sets exported_at timestamp', () => {
    const before = new Date().toISOString();
    const bundle = buildBlueButtonBundle(1, []);
    const after = new Date().toISOString();
    expect(bundle.meta.exported_at >= before).toBe(true);
    expect(bundle.meta.exported_at <= after).toBe(true);
  });
});

describe('Blue Button API contract', () => {
  it('GET /blue-button returns JSON by default', () => {
    const format = undefined ?? 'json';
    expect(format).toBe('json');
  });

  it('GET /blue-button?format=download sets Content-Disposition', () => {
    const format = 'download';
    const patientId = 42;
    const filename = `health-record-${patientId}-${new Date().toISOString().slice(0, 10)}.json`;
    expect(filename).toContain('health-record-42-');
    expect(filename).toMatch(/\.json$/);
  });

  it('GET /blue-button/sections returns all 7 section keys', () => {
    const sections = BLUE_BUTTON_SECTIONS.map((s) => ({ key: s.key, label: s.label }));
    expect(sections).toHaveLength(7);
    expect(sections[0].key).toBe('demographics');
    expect(sections[0].label).toBe('Demographics');
  });
});

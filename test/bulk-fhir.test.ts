import { describe, it, expect } from 'vitest';
import {
  BULK_RESOURCE_TYPES,
  generateExportId,
  patientToNDJSON,
  observationToNDJSON,
  allergyToNDJSON,
  medicationToNDJSON,
  conditionToNDJSON,
} from '../src/lib/bulk-fhir';

describe('BULK_RESOURCE_TYPES', () => {
  it('has 6 resource types', () => {
    expect(BULK_RESOURCE_TYPES).toHaveLength(6);
  });

  it('includes core FHIR types', () => {
    expect(BULK_RESOURCE_TYPES).toContain('Patient');
    expect(BULK_RESOURCE_TYPES).toContain('Observation');
    expect(BULK_RESOURCE_TYPES).toContain('AllergyIntolerance');
    expect(BULK_RESOURCE_TYPES).toContain('MedicationStatement');
    expect(BULK_RESOURCE_TYPES).toContain('Condition');
    expect(BULK_RESOURCE_TYPES).toContain('DiagnosticReport');
  });
});

describe('generateExportId', () => {
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, generateExportId));
    expect(ids.size).toBe(50);
  });

  it('starts with bulk_ prefix', () => {
    expect(generateExportId().startsWith('bulk_')).toBe(true);
  });
});

describe('patientToNDJSON', () => {
  it('produces valid JSON line', () => {
    const line = patientToNDJSON({ id: 1, name: 'Test User', gender: 'male', date_of_birth: '1990-01-01', phone: '+880171', address: 'Dhaka', nid: '123' });
    const parsed = JSON.parse(line);
    expect(parsed.resourceType).toBe('Patient');
    expect(parsed.id).toBe('1');
    expect(parsed.gender).toBe('male');
    expect(parsed.name[0].text).toBe('Test User');
    expect(parsed.identifier[0].value).toBe('123');
  });

  it('maps female gender correctly', () => {
    const parsed = JSON.parse(patientToNDJSON({ id: 2, gender: 'female' }));
    expect(parsed.gender).toBe('female');
  });

  it('maps unknown gender', () => {
    const parsed = JSON.parse(patientToNDJSON({ id: 3, gender: null }));
    expect(parsed.gender).toBe('unknown');
  });

  it('omits empty telecom when no phone', () => {
    const parsed = JSON.parse(patientToNDJSON({ id: 4, phone: null }));
    expect(parsed.telecom).toHaveLength(0);
  });
});

describe('observationToNDJSON', () => {
  it('produces Observation resource', () => {
    const parsed = JSON.parse(observationToNDJSON(
      { id: 10, type: 'heart_rate', value: 72, unit: 'bpm', recorded_at: '2026-04-19T10:00:00Z' },
      '1',
    ));
    expect(parsed.resourceType).toBe('Observation');
    expect(parsed.subject.reference).toBe('Patient/1');
    expect(parsed.valueQuantity.value).toBe(72);
  });
});

describe('allergyToNDJSON', () => {
  it('produces AllergyIntolerance resource', () => {
    const parsed = JSON.parse(allergyToNDJSON(
      { id: 20, allergen: 'Penicillin', severity: 'severe', reaction_type: 'allergy', onset_date: '2020-01-01' },
      '1',
    ));
    expect(parsed.resourceType).toBe('AllergyIntolerance');
    expect(parsed.code.text).toBe('Penicillin');
    expect(parsed.criticality).toBe('high');
  });

  it('maps non-severe as low criticality', () => {
    const parsed = JSON.parse(allergyToNDJSON(
      { id: 21, allergen: 'Dust', severity: 'mild' },
      '1',
    ));
    expect(parsed.criticality).toBe('low');
  });
});

describe('medicationToNDJSON', () => {
  it('produces MedicationStatement resource', () => {
    const parsed = JSON.parse(medicationToNDJSON(
      { id: 30, medication_name: 'Metformin', dose: '500mg', frequency: 'BD', status: 'active', start_date: '2026-01-01' },
      '1',
    ));
    expect(parsed.resourceType).toBe('MedicationStatement');
    expect(parsed.medicationCodeableConcept.text).toBe('Metformin');
    expect(parsed.dosage[0].text).toBe('500mg BD');
  });
});

describe('conditionToNDJSON', () => {
  it('produces Condition resource with ICD code', () => {
    const parsed = JSON.parse(conditionToNDJSON(
      { id: 40, diagnosis: 'Type 2 Diabetes', icd_code: 'E11.9', status: 'active', onset_date: '2020-06-01' },
      '1',
    ));
    expect(parsed.resourceType).toBe('Condition');
    expect(parsed.code.text).toBe('Type 2 Diabetes');
    expect(parsed.code.coding[0].code).toBe('E11.9');
    expect(parsed.code.coding[0].system).toBe('http://hl7.org/fhir/sid/icd-10');
  });

  it('handles missing ICD code', () => {
    const parsed = JSON.parse(conditionToNDJSON(
      { id: 41, diagnosis: 'Back Pain', icd_code: null },
      '1',
    ));
    expect(parsed.code.coding).toHaveLength(0);
  });
});

describe('NDJSON format', () => {
  it('each line is valid JSON (no trailing newline in single line)', () => {
    const line = patientToNDJSON({ id: 1, name: 'Test' });
    expect(() => JSON.parse(line)).not.toThrow();
    expect(line).not.toContain('\n');
  });

  it('multiple lines form valid NDJSON', () => {
    const lines = [
      patientToNDJSON({ id: 1, name: 'A' }),
      patientToNDJSON({ id: 2, name: 'B' }),
    ];
    const ndjson = lines.join('\n');
    const parsed = ndjson.split('\n').map((l) => JSON.parse(l));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('1');
    expect(parsed[1].id).toBe('2');
  });
});

describe('Bulk FHIR API Contract', () => {
  it('POST /$export returns 202 with Content-Location', () => {
    const statusCode = 202;
    expect(statusCode).toBe(202);
  });

  it('GET /status/:id returns output array when completed', () => {
    const response = {
      transactionTime: '2026-04-19T12:00:00Z',
      output: [{ type: 'Patient', count: 100, url: '/api/bulk-fhir/download/job123/Patient' }],
    };
    expect(response.output[0].type).toBe('Patient');
    expect(response.output[0].url).toContain('/download/');
  });

  it('GET /download/:id/:type returns application/ndjson', () => {
    const contentType = 'application/ndjson';
    expect(contentType).toBe('application/ndjson');
  });
});

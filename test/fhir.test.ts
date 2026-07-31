// ═══════════════════════════════════════════════════════════════════════════════
// FHIR R4 Facade Tests — Mapper correctness + structure validation
// ═══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  toFhirPatient, toFhirPractitioner, toFhirObservations,
  toFhirMedicationRequests, toFhirEncounter, toFhirAppointment,
  toBundle, buildCapabilityStatement, LOINC,
} from '../src/lib/fhir/mappers';
import { buildSearchClauses, parseCount } from '../src/lib/fhir/search';

const BASE = 'https://hms.example.com';

// ─── Patient Mapper ─────────────────────────────────────────────────────────
describe('toFhirPatient', () => {
  const row = {
    id: 42,
    name: 'Karim Rahman',
    patient_code: 'P-00042',
    mobile: '+8801712345678',
    gender: 'Male',
    address: 'Mirpur, Dhaka',
    created_at: '2024-01-15T10:00:00Z',
  };

  it('maps resourceType and id', () => {
    const p = toFhirPatient(row, BASE);
    expect(p.resourceType).toBe('Patient');
    expect(p.id).toBe('42');
  });

  it('maps identifier from patient_code', () => {
    const p = toFhirPatient(row, BASE);
    expect(p.identifier).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'P-00042' }),
    ]));
  });

  it('parses name into HumanName', () => {
    const p = toFhirPatient(row, BASE);
    expect(p.name?.[0].family).toBe('Rahman');
    expect(p.name?.[0].given).toEqual(['Karim']);
    expect(p.name?.[0].text).toBe('Karim Rahman');
  });

  it('maps telecom from mobile', () => {
    const p = toFhirPatient(row, BASE);
    expect(p.telecom).toEqual(expect.arrayContaining([
      expect.objectContaining({ system: 'phone', value: '+8801712345678', use: 'mobile' }),
    ]));
  });

  it('normalizes gender to lowercase', () => {
    const p = toFhirPatient(row, BASE);
    expect(p.gender).toBe('male');
  });

  it('maps address with country BD', () => {
    const p = toFhirPatient(row, BASE);
    expect(p.address?.[0].text).toBe('Mirpur, Dhaka');
    expect(p.address?.[0].country).toBe('BD');
  });
});

// ─── Practitioner Mapper ─────────────────────────────────────────────────────
describe('toFhirPractitioner', () => {
  const row = {
    id: 7,
    name: 'Dr Fatima Akhter',
    specialty: 'Cardiology',
    mobile_number: '+8801890000000',
    bmdc_reg_no: 'A-12345',
    is_active: 1,
    created_at: '2024-02-01T09:00:00Z',
  };

  it('maps resourceType and id', () => {
    const pr = toFhirPractitioner(row, BASE);
    expect(pr.resourceType).toBe('Practitioner');
    expect(pr.id).toBe('7');
    expect(pr.active).toBe(true);
  });

  it('maps BMDC registration as identifier', () => {
    const pr = toFhirPractitioner(row, BASE);
    expect(pr.identifier).toEqual(expect.arrayContaining([
      expect.objectContaining({ system: 'https://bmdc.org.bd', value: 'A-12345' }),
    ]));
  });

  it('maps specialty as qualification', () => {
    const pr = toFhirPractitioner(row, BASE);
    expect(pr.qualification?.[0].code.text).toBe('Cardiology');
  });
});

// ─── Observation Mapper (Vitals) ─────────────────────────────────────────────
describe('toFhirObservations', () => {
  const row = {
    id: 100,
    patient_id: 42,
    systolic: 120,
    diastolic: 80,
    heart_rate: 72,
    temperature: 36.8,
    spo2: 98,
    recorded_at: '2024-03-10T14:30:00Z',
  };

  it('creates blood pressure panel with systolic + diastolic components', () => {
    const obs = toFhirObservations(row, BASE);
    const bp = obs.find(o => o.id === '100-bp');
    expect(bp).toBeDefined();
    expect(bp!.code.coding?.[0].code).toBe(LOINC.blood_pressure.code);
    expect(bp!.component).toHaveLength(2);
    expect(bp!.component![0].valueQuantity?.value).toBe(120);
    expect(bp!.component![1].valueQuantity?.value).toBe(80);
  });

  it('creates individual observations for heart_rate, temperature, spo2', () => {
    const obs = toFhirObservations(row, BASE);
    const hr = obs.find(o => o.id === '100-heart_rate');
    expect(hr).toBeDefined();
    expect(hr!.code.coding?.[0].code).toBe(LOINC.heart_rate.code);
    expect(hr!.valueQuantity?.value).toBe(72);

    const temp = obs.find(o => o.id === '100-temperature');
    expect(temp).toBeDefined();
    expect(temp!.valueQuantity?.value).toBe(36.8);
  });

  it('includes FHIR vital-signs category', () => {
    const obs = toFhirObservations(row, BASE);
    expect(obs[0].category?.[0].coding?.[0].code).toBe('vital-signs');
  });

  it('sets subject reference to Patient', () => {
    const obs = toFhirObservations(row, BASE);
    expect(obs[0].subject?.reference).toBe('Patient/42');
  });

  it('skips null vitals', () => {
    const sparse = { id: 200, patient_id: 1, heart_rate: 80, recorded_at: '2024-01-01' };
    const obs = toFhirObservations(sparse, BASE);
    expect(obs).toHaveLength(1); // only heart_rate
    expect(obs[0].id).toBe('200-heart_rate');
  });
});

// ─── MedicationRequest Mapper ────────────────────────────────────────────────
describe('toFhirMedicationRequests', () => {
  const rx = { id: 10, patient_id: 42, doctor_id: 7, status: 'active', created_at: '2024-03-01', doctor_name: 'Dr A' };
  const items = [
    { medicine_name: 'Paracetamol 500mg', dosage: '1 tab', frequency: '3 times daily', duration: '5 days', instructions: 'after meals' },
    { medicine_name: 'Omeprazole 20mg', dosage: '1 cap', frequency: '1 time daily', duration: '14 days' },
  ];

  it('creates one MedicationRequest per item', () => {
    const reqs = toFhirMedicationRequests(rx, items, BASE);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].id).toBe('10-0');
    expect(reqs[1].id).toBe('10-1');
  });

  it('maps medicine name as medicationCodeableConcept', () => {
    const reqs = toFhirMedicationRequests(rx, items, BASE);
    expect(reqs[0].medicationCodeableConcept?.text).toBe('Paracetamol 500mg');
  });

  it('maps dosageInstruction with timing', () => {
    const reqs = toFhirMedicationRequests(rx, items, BASE);
    expect(reqs[0].dosageInstruction?.[0].text).toContain('3 times daily');
    expect(reqs[0].dosageInstruction?.[0].timing?.code?.text).toBe('3 times daily');
  });

  it('maps status correctly', () => {
    const reqs = toFhirMedicationRequests(rx, items, BASE);
    expect(reqs[0].status).toBe('active');
  });
});

// ─── Encounter Mapper ────────────────────────────────────────────────────────
describe('toFhirEncounter', () => {
  it('maps OPD visit as AMB class', () => {
    const enc = toFhirEncounter({ id: 1, patient_id: 42, visit_type: 'opd', created_at: '2024-01-01' }, BASE);
    expect(enc.class.code).toBe('AMB');
    expect(enc.class.display).toBe('Ambulatory');
  });

  it('maps IPD visit as IMP class', () => {
    const enc = toFhirEncounter({ id: 2, patient_id: 42, visit_type: 'ipd', admission_no: 'ADM-001', created_at: '2024-01-01' }, BASE);
    expect(enc.class.code).toBe('IMP');
    expect(enc.identifier).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'ADM-001' }),
    ]));
  });

  it('sets status finished when discharge_date is present', () => {
    const enc = toFhirEncounter({ id: 3, patient_id: 42, visit_type: 'ipd', discharge_date: '2024-01-05', created_at: '2024-01-01' }, BASE);
    expect(enc.status).toBe('finished');
  });

  it('includes ICD-10 diagnosis', () => {
    const enc = toFhirEncounter({
      id: 4, patient_id: 42, visit_type: 'opd',
      icd10_code: 'J06.9', icd10_description: 'Acute upper respiratory infection',
      created_at: '2024-01-01',
    }, BASE);
    expect(enc.diagnosis?.[0].condition.display).toContain('J06.9');
  });
});

// ─── Appointment Mapper ──────────────────────────────────────────────────────
describe('toFhirAppointment', () => {
  it('maps scheduled → booked', () => {
    const appt = toFhirAppointment({ id: 1, patient_id: 42, status: 'scheduled', appt_date: '2024-03-15' }, BASE);
    expect(appt.status).toBe('booked');
  });

  it('maps completed → fulfilled', () => {
    const appt = toFhirAppointment({ id: 2, patient_id: 42, status: 'completed', appt_date: '2024-03-15' }, BASE);
    expect(appt.status).toBe('fulfilled');
  });

  it('maps waiting → arrived', () => {
    const appt = toFhirAppointment({ id: 3, patient_id: 42, status: 'waiting', appt_date: '2024-03-15' }, BASE);
    expect(appt.status).toBe('arrived');
  });

  it('includes patient and doctor as participants', () => {
    const appt = toFhirAppointment({ id: 5, patient_id: 42, doctor_id: 7, doctor_name: 'Dr A', appt_date: '2024-03-15', status: 'scheduled' }, BASE);
    expect(appt.participant).toHaveLength(2);
    expect(appt.participant![0].actor?.reference).toBe('Patient/42');
    expect(appt.participant![1].actor?.reference).toBe('Practitioner/7');
  });

  it('formats start datetime', () => {
    const appt = toFhirAppointment({ id: 6, patient_id: 42, appt_date: '2024-03-15', appt_time: '09:30', status: 'scheduled' }, BASE);
    expect(appt.start).toBe('2024-03-15T09:30:00');
  });
});

// ─── Bundle Builder ──────────────────────────────────────────────────────────
describe('toBundle', () => {
  it('creates searchset bundle with correct total', () => {
    const resources = [
      toFhirPatient({ id: 1, name: 'A' }, BASE),
      toFhirPatient({ id: 2, name: 'B' }, BASE),
    ];
    const bundle = toBundle(resources, BASE);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('searchset');
    expect(bundle.total).toBe(2);
    expect(bundle.entry).toHaveLength(2);
  });

  it('omits entry for empty results', () => {
    const bundle = toBundle([], BASE);
    expect(bundle.total).toBe(0);
    expect(bundle.entry).toBeUndefined();
  });
});

// ─── CapabilityStatement ─────────────────────────────────────────────────────
describe('buildCapabilityStatement', () => {
  it('declares FHIR version 4.0.1', () => {
    const cs = buildCapabilityStatement(BASE);
    expect(cs.resourceType).toBe('CapabilityStatement');
    expect(cs.fhirVersion).toBe('4.0.1');
  });

  it('lists all 6 supported resource types', () => {
    const cs = buildCapabilityStatement(BASE);
    const types = cs.rest[0].resource.map(r => r.type);
    expect(types).toEqual(expect.arrayContaining([
      'Patient', 'Practitioner', 'Observation',
      'MedicationRequest', 'Encounter', 'Appointment',
    ]));
  });

  it('supports read and search-type interactions', () => {
    const cs = buildCapabilityStatement(BASE);
    const patient = cs.rest[0].resource.find(r => r.type === 'Patient')!;
    const codes = patient.interaction.map(i => i.code);
    expect(codes).toContain('read');
    expect(codes).toContain('search-type');
  });
});

// ─── Search Helper ───────────────────────────────────────────────────────────
describe('buildSearchClauses', () => {
  it('builds LIKE clause for string search', () => {
    const result = buildSearchClauses({ name: 'karim' }, { name: { column: 'name', op: 'like' } });
    expect(result.where).toEqual(['name LIKE ?']);
    expect(result.params).toEqual(['%karim%']);
  });

  it('builds eq clause for token search', () => {
    const result = buildSearchClauses({ _id: '42' }, { _id: { column: 'id', op: 'eq' } });
    expect(result.where).toEqual(['id = ?']);
    expect(result.params).toEqual(['42']);
  });

  it('parses FHIR date prefixes (ge, le)', () => {
    const result = buildSearchClauses({ date: 'ge2024-01-01' }, { date: { column: 'created_at', op: 'date' } });
    expect(result.where).toEqual(['created_at >= ?']);
    expect(result.params).toEqual(['2024-01-01']);
  });

  it('parses FHIR reference (Patient/123)', () => {
    const result = buildSearchClauses({ patient: 'Patient/42' }, { patient: { column: 'patient_id', op: 'ref' } });
    expect(result.where).toEqual(['patient_id = ?']);
    expect(result.params).toEqual(['42']);
  });

  it('ignores undefined params', () => {
    const result = buildSearchClauses({ name: undefined }, { name: { column: 'name', op: 'like' } });
    expect(result.where).toEqual([]);
    expect(result.params).toEqual([]);
  });
});

describe('parseCount', () => {
  it('returns default when _count is absent', () => {
    expect(parseCount({})).toBe(50);
  });

  it('respects max limit', () => {
    expect(parseCount({ _count: '500' })).toBe(200);
  });

  it('parses valid count', () => {
    expect(parseCount({ _count: '25' })).toBe(25);
  });
});

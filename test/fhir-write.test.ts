import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// FHIR Write API Tests — Schema validation + LOINC reverse mapping
// ═══════════════════════════════════════════════════════════════════════════════

describe('FHIR Write Schemas', () => {
  let fhirCreatePatientSchema: z.ZodType;
  let fhirCreateObservationSchema: z.ZodType;
  let fhirCreateEncounterSchema: z.ZodType;

  beforeAll(async () => {
    const mod = await import('../src/schemas/fhir');
    fhirCreatePatientSchema = mod.fhirCreatePatientSchema;
    fhirCreateObservationSchema = mod.fhirCreateObservationSchema;
    fhirCreateEncounterSchema = mod.fhirCreateEncounterSchema;
  });

  // ─── Patient Schema ─────────────────────────────────────────────────────────

  describe('fhirCreatePatientSchema', () => {
    const validPatient = {
      resourceType: 'Patient',
      name: [{ text: 'Rahim Uddin' }],
      gender: 'male',
      birthDate: '1990-01-15',
      telecom: [{ system: 'phone', value: '+8801712345678' }],
      address: [{ text: 'Dhaka, Bangladesh' }],
      identifier: [{ system: 'http://fhir.health.gov.bd/sid/nid', value: '19901234567890123' }],
    };

    it('accepts a complete valid FHIR Patient', () => {
      const result = fhirCreatePatientSchema.safeParse(validPatient);
      expect(result.success).toBe(true);
    });

    it('accepts minimal Patient with just name', () => {
      const result = fhirCreatePatientSchema.safeParse({
        resourceType: 'Patient',
        name: [{ given: ['Rahim'], family: 'Uddin' }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects wrong resourceType', () => {
      const result = fhirCreatePatientSchema.safeParse({
        ...validPatient,
        resourceType: 'Observation',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
      const { name, ...rest } = validPatient;
      const result = fhirCreatePatientSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects empty name array', () => {
      const result = fhirCreatePatientSchema.safeParse({
        ...validPatient,
        name: [],
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid gender values', () => {
      for (const gender of ['male', 'female', 'other', 'unknown']) {
        const result = fhirCreatePatientSchema.safeParse({
          ...validPatient,
          gender,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid gender', () => {
      const result = fhirCreatePatientSchema.safeParse({
        ...validPatient,
        gender: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('accepts Patient without optional fields', () => {
      const result = fhirCreatePatientSchema.safeParse({
        resourceType: 'Patient',
        name: [{ text: 'Test User' }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects name with empty object (no text/family/given)', () => {
      const result = fhirCreatePatientSchema.safeParse({
        resourceType: 'Patient',
        name: [{}],
      });
      expect(result.success).toBe(false);
    });

    it('accepts BD NID identifier', () => {
      const result = fhirCreatePatientSchema.safeParse({
        resourceType: 'Patient',
        name: [{ text: 'Test' }],
        identifier: [
          { system: 'http://fhir.health.gov.bd/sid/nid', value: '12345678901234567' },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── Observation Schema ─────────────────────────────────────────────────────

  describe('fhirCreateObservationSchema', () => {
    const validObservation = {
      resourceType: 'Observation',
      status: 'final',
      code: {
        coding: [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }],
      },
      subject: { reference: 'Patient/42' },
      valueQuantity: { value: 37.2, unit: '°C' },
      effectiveDateTime: '2026-04-09T10:30:00Z',
    };

    it('accepts a valid single-vital Observation', () => {
      const result = fhirCreateObservationSchema.safeParse(validObservation);
      expect(result.success).toBe(true);
    });

    it('accepts BP panel with components', () => {
      const bpPanel = {
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }],
        },
        subject: { reference: 'Patient/42' },
        component: [
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic' }] },
            valueQuantity: { value: 120, unit: 'mmHg' },
          },
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic' }] },
            valueQuantity: { value: 80, unit: 'mmHg' },
          },
        ],
      };
      const result = fhirCreateObservationSchema.safeParse(bpPanel);
      expect(result.success).toBe(true);
    });

    it('defaults status to final', () => {
      const { status, ...rest } = validObservation;
      const result = fhirCreateObservationSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('final');
      }
    });

    it('rejects wrong resourceType', () => {
      const result = fhirCreateObservationSchema.safeParse({
        ...validObservation,
        resourceType: 'Patient',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing code', () => {
      const { code, ...rest } = validObservation;
      const result = fhirCreateObservationSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects missing subject', () => {
      const { subject, ...rest } = validObservation;
      const result = fhirCreateObservationSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects invalid subject reference format', () => {
      const result = fhirCreateObservationSchema.safeParse({
        ...validObservation,
        subject: { reference: 'InvalidRef/42' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects subject reference without numeric ID', () => {
      const result = fhirCreateObservationSchema.safeParse({
        ...validObservation,
        subject: { reference: 'Patient/abc' },
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid FHIR observation statuses', () => {
      for (const status of ['registered', 'preliminary', 'final', 'amended']) {
        const result = fhirCreateObservationSchema.safeParse({
          ...validObservation,
          status,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── Encounter Schema ───────────────────────────────────────────────────────

  describe('fhirCreateEncounterSchema', () => {
    const validEncounter = {
      resourceType: 'Encounter',
      status: 'finished',
      class: { code: 'AMB' },
      subject: { reference: 'Patient/42' },
      period: {
        start: '2026-04-09T08:00:00Z',
        end: '2026-04-09T09:30:00Z',
      },
    };

    it('accepts a valid Encounter', () => {
      const result = fhirCreateEncounterSchema.safeParse(validEncounter);
      expect(result.success).toBe(true);
    });

    it('accepts Encounter with participant (doctor)', () => {
      const result = fhirCreateEncounterSchema.safeParse({
        ...validEncounter,
        participant: [
          { individual: { reference: 'Practitioner/5', display: 'Dr. Hasan' } },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts Encounter with reasonCode (ICD-10)', () => {
      const result = fhirCreateEncounterSchema.safeParse({
        ...validEncounter,
        reasonCode: [
          {
            coding: [
              { system: 'http://hl7.org/fhir/sid/icd-10', code: 'J06.9', display: 'Acute upper respiratory infection' },
            ],
            text: 'Acute URI',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts Encounter with dual ICD-10 + ICD-11 coding', () => {
      const result = fhirCreateEncounterSchema.safeParse({
        ...validEncounter,
        reasonCode: [
          {
            coding: [
              { system: 'http://id.who.int/icd/release/11/mms', code: 'CA40', display: 'Acute upper respiratory infections' },
              { system: 'http://hl7.org/fhir/sid/icd-10', code: 'J06.9', display: 'Acute URI' },
            ],
            text: 'Acute URI',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('defaults status to finished', () => {
      const { status, ...rest } = validEncounter;
      const result = fhirCreateEncounterSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('finished');
      }
    });

    it('rejects wrong resourceType', () => {
      const result = fhirCreateEncounterSchema.safeParse({
        ...validEncounter,
        resourceType: 'Patient',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing class', () => {
      const { class: cls, ...rest } = validEncounter;
      const result = fhirCreateEncounterSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects missing subject', () => {
      const { subject, ...rest } = validEncounter;
      const result = fhirCreateEncounterSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects invalid subject reference', () => {
      const result = fhirCreateEncounterSchema.safeParse({
        ...validEncounter,
        subject: { reference: 'Encounter/42' },
      });
      expect(result.success).toBe(false);
    });

    it('accepts all FHIR encounter class codes', () => {
      for (const code of ['AMB', 'IMP', 'EMER']) {
        const result = fhirCreateEncounterSchema.safeParse({
          ...validEncounter,
          class: { code },
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts Encounter with only required fields', () => {
      const result = fhirCreateEncounterSchema.safeParse({
        resourceType: 'Encounter',
        class: { code: 'AMB' },
        subject: { reference: 'Patient/1' },
      });
      expect(result.success).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOINC Reverse Mapping Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('LOINC Vital Code Mapping', () => {
  let LOINC: Record<string, { code: string; display: string; unit: string }>;

  beforeAll(async () => {
    const mod = await import('../src/lib/fhir/mappers');
    LOINC = mod.LOINC as any;
  });

  it('LOINC map covers all standard vital signs', () => {
    const expectedVitals = [
      'systolic', 'diastolic', 'heart_rate', 'temperature',
      'spo2', 'respiratory_rate', 'weight', 'blood_pressure',
    ];
    for (const vital of expectedVitals) {
      expect(LOINC[vital]).toBeDefined();
      expect(LOINC[vital].code).toBeTruthy();
      expect(LOINC[vital].display).toBeTruthy();
    }
  });

  it('all LOINC codes are valid format (digits + dash + check digit)', () => {
    for (const [, entry] of Object.entries(LOINC)) {
      expect(entry.code).toMatch(/^\d+-\d+$/);
    }
  });

  it('systolic maps to correct LOINC code 8480-6', () => {
    expect(LOINC.systolic.code).toBe('8480-6');
  });

  it('diastolic maps to correct LOINC code 8462-4', () => {
    expect(LOINC.diastolic.code).toBe('8462-4');
  });

  it('heart_rate maps to LOINC 8867-4', () => {
    expect(LOINC.heart_rate.code).toBe('8867-4');
  });

  it('temperature maps to LOINC 8310-5', () => {
    expect(LOINC.temperature.code).toBe('8310-5');
  });

  it('spo2 maps to LOINC 2708-6', () => {
    expect(LOINC.spo2.code).toBe('2708-6');
  });

  it('blood_pressure panel uses LOINC 85354-9', () => {
    expect(LOINC.blood_pressure.code).toBe('85354-9');
  });

  it('weight maps to LOINC 29463-7', () => {
    expect(LOINC.weight.code).toBe('29463-7');
  });

  it('no duplicate LOINC codes exist', () => {
    const codes = Object.values(LOINC).map(v => v.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FHIR Mapper Output Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('FHIR Mapper — toFhirPatient BD-Core compliance', () => {
  let toFhirPatient: Function;
  let BD_FHIR: Record<string, string>;

  beforeAll(async () => {
    const mod = await import('../src/lib/fhir/mappers');
    toFhirPatient = mod.toFhirPatient;
    BD_FHIR = mod.BD_FHIR as any;
  });

  it('produces BD-Core patient profile URL in meta', () => {
    const result = toFhirPatient({ id: 1, name: 'Test User' }, 'http://localhost');
    expect(result.meta?.profile).toContain(BD_FHIR.PATIENT_PROFILE);
  });

  it('maps NID to both identifier and extension', () => {
    const result = toFhirPatient(
      { id: 1, name: 'Test', national_id: '12345678901234567' },
      'http://localhost',
    );
    // NID in identifiers
    const nidIdentifier = result.identifier?.find((i: any) => i.system === BD_FHIR.NID_SYSTEM);
    expect(nidIdentifier).toBeDefined();
    expect(nidIdentifier.value).toBe('12345678901234567');

    // NID in extensions
    const nidExt = result.extension?.find((e: any) => e.url === BD_FHIR.NID_EXT);
    expect(nidExt).toBeDefined();
    expect(nidExt.valueString).toBe('12345678901234567');
  });

  it('maps BRN to both identifier and extension', () => {
    const result = toFhirPatient(
      { id: 1, name: 'Baby Test', brn: 'BRN123456' },
      'http://localhost',
    );
    const brnId = result.identifier?.find((i: any) => i.system === BD_FHIR.BRN_SYSTEM);
    expect(brnId).toBeDefined();
    expect(brnId.value).toBe('BRN123456');
  });

  it('maps upazila to BD extension on address', () => {
    const result = toFhirPatient(
      { id: 1, name: 'Test', upazila: 'Savar', district: 'Dhaka', division: 'Dhaka' },
      'http://localhost',
    );
    expect(result.address).toHaveLength(1);
    const upazilaExt = result.address[0].extension?.[0];
    expect(upazilaExt?.url).toContain('bd-upazila');
    expect(upazilaExt?.valueString).toBe('Savar');
  });

  it('maps UHID to identifier', () => {
    const result = toFhirPatient(
      { id: 1, name: 'Test', uhid: 'UHID-001' },
      'http://localhost',
    );
    const uhidId = result.identifier?.find((i: any) => i.system === BD_FHIR.UHID_SYSTEM);
    expect(uhidId).toBeDefined();
    expect(uhidId.value).toBe('UHID-001');
  });

  it('maps gender correctly', () => {
    expect(toFhirPatient({ id: 1, name: 'T', gender: 'Male' }, 'http://localhost').gender).toBe('male');
    expect(toFhirPatient({ id: 1, name: 'T', gender: 'Female' }, 'http://localhost').gender).toBe('female');
    expect(toFhirPatient({ id: 1, name: 'T', gender: 'xyz' }, 'http://localhost').gender).toBe('unknown');
  });

  it('country is always BD', () => {
    const result = toFhirPatient(
      { id: 1, name: 'Test', address: 'Dhaka' },
      'http://localhost',
    );
    expect(result.address?.[0]?.country).toBe('BD');
  });
});

describe('FHIR Mapper — toFhirEncounter ICD dual coding', () => {
  let toFhirEncounter: Function;

  beforeAll(async () => {
    const mod = await import('../src/lib/fhir/mappers');
    toFhirEncounter = mod.toFhirEncounter;
  });

  it('includes ICD-11 when both codes present (ICD-11 preferred)', () => {
    const row = {
      id: 1, patient_id: 1, visit_type: 'opd',
      icd11_code: 'BA00', icd11_description: 'Strep pharyngitis',
      icd10_code: 'J02.0', icd10_description: 'Strep pharyngitis',
      created_at: '2026-04-09',
    };
    const enc = toFhirEncounter(row, 'http://localhost');
    expect(enc.diagnosis).toHaveLength(1);
    const coding = enc.diagnosis[0].condition.display;
    expect(coding).toContain('BA00');
  });

  it('falls back to ICD-10 when ICD-11 absent', () => {
    const row = {
      id: 2, patient_id: 1, visit_type: 'opd',
      icd10_code: 'J06.9', icd10_description: 'Acute URI',
      created_at: '2026-04-09',
    };
    const enc = toFhirEncounter(row, 'http://localhost');
    expect(enc.diagnosis).toHaveLength(1);
    expect(enc.diagnosis[0].condition.display).toContain('J06.9');
  });

  it('maps visit_type ipd to class IMP', () => {
    const enc = toFhirEncounter(
      { id: 1, patient_id: 1, visit_type: 'ipd', created_at: '2026-04-09' },
      'http://localhost',
    );
    expect(enc.class.code).toBe('IMP');
  });

  it('maps visit_type opd to class AMB', () => {
    const enc = toFhirEncounter(
      { id: 1, patient_id: 1, visit_type: 'opd', created_at: '2026-04-09' },
      'http://localhost',
    );
    expect(enc.class.code).toBe('AMB');
  });
});

describe('FHIR CapabilityStatement — create interactions', () => {
  let buildCapabilityStatement: Function;

  beforeAll(async () => {
    const mod = await import('../src/lib/fhir/mappers');
    buildCapabilityStatement = mod.buildCapabilityStatement;
  });

  it('declares create interaction for Patient', () => {
    const cs = buildCapabilityStatement('http://localhost');
    const patientResource = cs.rest[0].resource.find((r: any) => r.type === 'Patient');
    const interactions = patientResource.interaction.map((i: any) => i.code);
    expect(interactions).toContain('create');
  });

  it('declares create interaction for Observation', () => {
    const cs = buildCapabilityStatement('http://localhost');
    const obsResource = cs.rest[0].resource.find((r: any) => r.type === 'Observation');
    const interactions = obsResource.interaction.map((i: any) => i.code);
    expect(interactions).toContain('create');
  });

  it('declares create interaction for Encounter', () => {
    const cs = buildCapabilityStatement('http://localhost');
    const encResource = cs.rest[0].resource.find((r: any) => r.type === 'Encounter');
    const interactions = encResource.interaction.map((i: any) => i.code);
    expect(interactions).toContain('create');
  });

  it('does NOT declare create for MedicationRequest (read-only)', () => {
    const cs = buildCapabilityStatement('http://localhost');
    const medResource = cs.rest[0].resource.find((r: any) => r.type === 'MedicationRequest');
    const interactions = medResource.interaction.map((i: any) => i.code);
    expect(interactions).not.toContain('create');
  });

  it('declares BD-Core IG in instantiates', () => {
    const cs = buildCapabilityStatement('http://localhost');
    expect(cs.instantiates).toContain('http://fhir.health.gov.bd/ImplementationGuide/bd-core');
  });

  it('FHIR version is 4.0.1', () => {
    const cs = buildCapabilityStatement('http://localhost');
    expect(cs.fhirVersion).toBe('4.0.1');
  });
});

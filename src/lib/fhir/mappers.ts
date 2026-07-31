// ═══════════════════════════════════════════════════════════════════════════════
// FHIR R4 Mappers — Pure functions: DB row → FHIR R4 resource
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  FhirPatient, FhirPractitioner, FhirObservation, FhirObservationComponent,
  FhirMedicationRequest, FhirEncounter, FhirAppointment, FhirBundle,
  FhirBundleEntry, FhirResource, FhirCapabilityStatement, FhirCondition,
  FhirExtension, FhirAddress,
} from './types';

// ─── LOINC Vital Codes ──────────────────────────────────────────────────────
export const LOINC = {
  systolic:         { code: '8480-6',  display: 'Systolic blood pressure',  unit: 'mmHg' },
  diastolic:        { code: '8462-4',  display: 'Diastolic blood pressure', unit: 'mmHg' },
  heart_rate:       { code: '8867-4',  display: 'Heart rate',               unit: 'beats/min' },
  temperature:      { code: '8310-5',  display: 'Body temperature',         unit: '°C' },
  spo2:             { code: '2708-6',  display: 'Oxygen saturation',        unit: '%' },
  respiratory_rate: { code: '9279-1',  display: 'Respiratory rate',         unit: 'breaths/min' },
  weight:           { code: '29463-7', display: 'Body weight',              unit: 'kg' },
  blood_pressure:   { code: '85354-9', display: 'Blood pressure panel',     unit: '' },
} as const;

// ─── BD-Core FHIR URIs ──────────────────────────────────────────────────────
export const BD_FHIR = {
  NID_SYSTEM: 'http://fhir.health.gov.bd/sid/nid',
  BRN_SYSTEM: 'http://fhir.health.gov.bd/sid/brn',
  UHID_SYSTEM: 'https://ozzyl.health/sid/uhid',
  NID_EXT: 'http://fhir.health.gov.bd/StructureDefinition/bd-nid',
  BRN_EXT: 'http://fhir.health.gov.bd/StructureDefinition/bd-brn',
  PATIENT_PROFILE: 'http://fhir.health.gov.bd/StructureDefinition/bd-core-patient',
  CONDITION_PROFILE: 'http://fhir.health.gov.bd/StructureDefinition/bd-core-condition',
  BD_CORE_IG: 'http://fhir.health.gov.bd/ImplementationGuide/bd-core',
  ICD11_SYSTEM: 'http://id.who.int/icd/release/11/mms',
  ICD10_SYSTEM: 'http://hl7.org/fhir/sid/icd-10',
} as const;

// ─── Patient → FHIR Patient (BD-Core) ──────────────────────────────────────

interface PatientRow {
  id: number;
  name: string;
  patient_code?: string;
  mobile?: string;
  guardian_mobile?: string;
  gender?: string;
  date_of_birth?: string;
  age?: number;
  blood_group?: string;
  address?: string;
  father_husband?: string;
  created_at?: string;
  updated_at?: string;
  national_id?: string;
  uhid?: string;
  brn?: string;
  division?: string;
  district?: string;
  upazila?: string;
}

export function toFhirPatient(row: PatientRow, baseUrl: string): FhirPatient {
  const patient: FhirPatient = {
    resourceType: 'Patient',
    id: String(row.id),
    meta: {
      lastUpdated: row.updated_at ?? row.created_at,
      profile: [BD_FHIR.PATIENT_PROFILE],
    },
  };

  // Identifiers
  const identifiers: FhirPatient['identifier'] = [];
  if (row.patient_code) {
    identifiers.push({ system: `${baseUrl}/patient-code`, value: row.patient_code });
  }
  if (row.uhid) {
    identifiers.push({ system: BD_FHIR.UHID_SYSTEM, value: row.uhid, type: { text: 'Ozzyl UHID' } });
  }
  if (row.national_id) {
    identifiers.push({ system: BD_FHIR.NID_SYSTEM, value: row.national_id, type: { text: 'National ID (NID)' } });
  }
  if (row.brn) {
    identifiers.push({ system: BD_FHIR.BRN_SYSTEM, value: row.brn, type: { text: 'Birth Registration Number' } });
  }
  if (identifiers.length > 0) patient.identifier = identifiers;

  // BD-Core extensions
  const extensions: FhirExtension[] = [];
  if (row.national_id) {
    extensions.push({ url: BD_FHIR.NID_EXT, valueString: row.national_id });
  }
  if (row.brn) {
    extensions.push({ url: BD_FHIR.BRN_EXT, valueString: row.brn });
  }
  if (extensions.length > 0) patient.extension = extensions;

  // Name
  const nameParts = row.name.trim().split(/\s+/);
  patient.name = [{
    use: 'official',
    text: row.name,
    family: nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined,
    given: nameParts.length > 1 ? nameParts.slice(0, -1) : [nameParts[0]],
  }];

  // Telecom
  const telecom: FhirPatient['telecom'] = [];
  if (row.mobile) telecom.push({ system: 'phone', value: row.mobile, use: 'mobile' });
  if (row.guardian_mobile) telecom.push({ system: 'phone', value: row.guardian_mobile, use: 'home' });
  if (telecom.length > 0) patient.telecom = telecom;

  // Gender
  if (row.gender) {
    const g = row.gender.toLowerCase();
    patient.gender = g === 'male' || g === 'female' || g === 'other' ? g : 'unknown';
  }

  // Birth date
  if (row.date_of_birth) patient.birthDate = row.date_of_birth;

  // Address (BD-Core: division → state, district → city, upazila → extension)
  if (row.address || row.division || row.district || row.upazila) {
    const addrEntry: FhirAddress = {
      use: 'home',
      text: row.address ?? undefined,
      city: row.district ?? undefined,
      state: row.division ?? undefined,
      country: 'BD',
    };
    if (row.upazila) {
      addrEntry.extension = [{
        url: 'http://fhir.health.gov.bd/StructureDefinition/bd-upazila',
        valueString: row.upazila,
      }];
    }
    patient.address = [addrEntry];
  }

  return patient;
}

// ─── Doctor → FHIR Practitioner ──────────────────────────────────────────────

interface DoctorRow {
  id: number;
  name: string;
  specialty?: string;
  mobile_number?: string;
  bmdc_reg_no?: string;
  qualifications?: string;
  is_active?: number;
  created_at?: string;
  updated_at?: string;
}

export function toFhirPractitioner(row: DoctorRow, baseUrl: string): FhirPractitioner {
  const practitioner: FhirPractitioner = {
    resourceType: 'Practitioner',
    id: String(row.id),
    meta: { lastUpdated: row.updated_at ?? row.created_at },
    active: row.is_active !== 0,
  };

  // Identifier (BMDC registration)
  if (row.bmdc_reg_no) {
    practitioner.identifier = [{
      system: 'https://bmdc.org.bd',
      value: row.bmdc_reg_no,
      type: { text: 'BMDC Registration Number' },
    }];
  }

  // Name
  const nameParts = row.name.trim().split(/\s+/);
  practitioner.name = [{
    use: 'official',
    text: row.name,
    family: nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined,
    given: nameParts.length > 1 ? nameParts.slice(0, -1) : [nameParts[0]],
  }];

  // Telecom
  if (row.mobile_number) {
    practitioner.telecom = [{ system: 'phone', value: row.mobile_number, use: 'work' }];
  }

  // Qualification (specialty)
  if (row.specialty) {
    practitioner.qualification = [{
      code: { text: row.specialty },
    }];
  }

  return practitioner;
}

// ─── Patient Vitals → FHIR Observation (Blood Pressure Panel) ────────────────

interface VitalRow {
  id: number;
  patient_id: number;
  systolic?: number;
  diastolic?: number;
  heart_rate?: number;
  temperature?: number;
  spo2?: number;
  respiratory_rate?: number;
  weight?: number;
  recorded_at?: string;
  notes?: string;
}

export function toFhirObservations(row: VitalRow, baseUrl: string): FhirObservation[] {
  const observations: FhirObservation[] = [];
  const subject = { reference: `Patient/${row.patient_id}` };
  const effectiveDateTime = row.recorded_at;

  // Blood pressure panel (systolic + diastolic as components)
  if (row.systolic != null || row.diastolic != null) {
    const components: FhirObservationComponent[] = [];
    if (row.systolic != null) {
      components.push({
        code: { coding: [{ system: 'http://loinc.org', code: LOINC.systolic.code, display: LOINC.systolic.display }] },
        valueQuantity: { value: row.systolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
      });
    }
    if (row.diastolic != null) {
      components.push({
        code: { coding: [{ system: 'http://loinc.org', code: LOINC.diastolic.code, display: LOINC.diastolic.display }] },
        valueQuantity: { value: row.diastolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
      });
    }

    observations.push({
      resourceType: 'Observation',
      id: `${row.id}-bp`,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: LOINC.blood_pressure.code, display: LOINC.blood_pressure.display }] },
      subject,
      effectiveDateTime,
      component: components,
    });
  }

  // Individual vitals
  const singles: [keyof typeof LOINC, number | undefined][] = [
    ['heart_rate', row.heart_rate],
    ['temperature', row.temperature],
    ['spo2', row.spo2],
    ['respiratory_rate', row.respiratory_rate],
    ['weight', row.weight],
  ];

  for (const [key, value] of singles) {
    if (value == null) continue;
    const loinc = LOINC[key];
    observations.push({
      resourceType: 'Observation',
      id: `${row.id}-${key}`,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: loinc.code, display: loinc.display }] },
      subject,
      effectiveDateTime,
      valueQuantity: { value, unit: loinc.unit, system: 'http://unitsofmeasure.org' },
    });
  }

  return observations;
}

// ─── Prescription → FHIR MedicationRequest ───────────────────────────────────

interface PrescriptionRow {
  id: number;
  patient_id: number;
  doctor_id?: number;
  rx_no?: string;
  status?: string;
  diagnosis?: string;
  advice?: string;
  created_at?: string;
  doctor_name?: string;
}

interface PrescriptionItemRow {
  medicine_name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
}

function mapRxStatus(s?: string): FhirMedicationRequest['status'] {
  switch (s?.toLowerCase()) {
    case 'active':    return 'active';
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    default:          return 'active';
  }
}

export function toFhirMedicationRequests(
  rx: PrescriptionRow,
  items: PrescriptionItemRow[],
  _baseUrl: string
): FhirMedicationRequest[] {
  if (items.length === 0) {
    // Single MedicationRequest for the overall prescription
    return [{
      resourceType: 'MedicationRequest',
      id: String(rx.id),
      status: mapRxStatus(rx.status),
      intent: 'order',
      subject: { reference: `Patient/${rx.patient_id}` },
      requester: rx.doctor_id ? { reference: `Practitioner/${rx.doctor_id}`, display: rx.doctor_name } : undefined,
      authoredOn: rx.created_at,
      note: rx.diagnosis ? [{ text: `Diagnosis: ${rx.diagnosis}` }] : undefined,
    }];
  }

  // One MedicationRequest per item
  return items.map((item, idx) => ({
    resourceType: 'MedicationRequest' as const,
    id: `${rx.id}-${idx}`,
    status: mapRxStatus(rx.status),
    intent: 'order' as const,
    medicationCodeableConcept: { text: item.medicine_name },
    subject: { reference: `Patient/${rx.patient_id}` },
    requester: rx.doctor_id ? { reference: `Practitioner/${rx.doctor_id}`, display: rx.doctor_name } : undefined,
    authoredOn: rx.created_at,
    dosageInstruction: [{
      text: [item.dosage, item.frequency, item.duration].filter(Boolean).join(' — '),
      timing: item.frequency ? { code: { text: item.frequency } } : undefined,
    }],
    note: item.instructions ? [{ text: item.instructions }] : undefined,
  }));
}

// ─── Visit → FHIR Encounter ─────────────────────────────────────────────────

interface VisitRow {
  id: number;
  patient_id: number;
  doctor_id?: number;
  visit_no?: string;
  visit_type?: string;
  admission_no?: string;
  admission_date?: string;
  discharge_date?: string;
  notes?: string;
  icd10_code?: string;
  icd10_description?: string;
  icd11_code?: string;
  icd11_description?: string;
  created_at?: string;
  updated_at?: string;
  doctor_name?: string;
}

function mapEncounterStatus(row: VisitRow): FhirEncounter['status'] {
  if (row.discharge_date) return 'finished';
  if (row.visit_type === 'ipd') return 'in-progress';
  return 'finished'; // OPD visits are typically single-encounter
}

export function toFhirEncounter(row: VisitRow, _baseUrl: string): FhirEncounter {
  const encounter: FhirEncounter = {
    resourceType: 'Encounter',
    id: String(row.id),
    meta: { lastUpdated: row.updated_at ?? row.created_at },
    status: mapEncounterStatus(row),
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: row.visit_type === 'ipd' ? 'IMP' : 'AMB',
      display: row.visit_type === 'ipd' ? 'Inpatient' : 'Ambulatory',
    },
    subject: { reference: `Patient/${row.patient_id}` },
  };

  // Identifier
  const identifiers: FhirEncounter['identifier'] = [];
  if (row.visit_no) identifiers.push({ system: 'visit-number', value: row.visit_no });
  if (row.admission_no) identifiers.push({ system: 'admission-number', value: row.admission_no });
  if (identifiers.length > 0) encounter.identifier = identifiers;

  // Doctor/participant
  if (row.doctor_id) {
    encounter.participant = [{ individual: { reference: `Practitioner/${row.doctor_id}`, display: row.doctor_name } }];
  }

  // Period
  encounter.period = {
    start: row.admission_date ?? row.created_at,
    end: row.discharge_date ?? undefined,
  };

  // Diagnosis (ICD-11 preferred, ICD-10 fallback, dual-coding when both available)
  if (row.icd11_code || row.icd10_code) {
    const coding = [];
    if (row.icd11_code) {
      coding.push({ system: BD_FHIR.ICD11_SYSTEM, code: row.icd11_code, display: row.icd11_description ?? '' });
    }
    if (row.icd10_code) {
      coding.push({ system: BD_FHIR.ICD10_SYSTEM, code: row.icd10_code, display: row.icd10_description ?? '' });
    }
    const display = row.icd11_code
      ? `${row.icd11_code} — ${row.icd11_description ?? ''}`
      : `${row.icd10_code} — ${row.icd10_description ?? ''}`;

    encounter.diagnosis = [{
      condition: { reference: '#', display },
      use: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/diagnosis-role', code: 'AD', display: 'Admission diagnosis' }],
      },
    }];
  }

  return encounter;
}

// ─── Appointment → FHIR Appointment ─────────────────────────────────────────

interface AppointmentRow {
  id: number;
  patient_id: number;
  doctor_id?: number;
  appt_date?: string;
  appt_time?: string;
  status?: string;
  reason?: string;
  appt_no?: string;
  doctor_name?: string;
}

function mapAppointmentStatus(s?: string): FhirAppointment['status'] {
  switch (s?.toLowerCase()) {
    case 'scheduled': return 'booked';
    case 'waiting':   return 'arrived';
    case 'in_progress': return 'arrived';
    case 'completed': return 'fulfilled';
    case 'paid':      return 'fulfilled';
    case 'cancelled': return 'cancelled';
    case 'no_show':   return 'noshow';
    default:          return 'proposed';
  }
}

export function toFhirAppointment(row: AppointmentRow, _baseUrl: string): FhirAppointment {
  const appointment: FhirAppointment = {
    resourceType: 'Appointment',
    id: String(row.id),
    status: mapAppointmentStatus(row.status),
    description: row.reason ?? undefined,
  };

  // Start time
  if (row.appt_date) {
    appointment.start = row.appt_time
      ? `${row.appt_date}T${row.appt_time}:00`
      : `${row.appt_date}T00:00:00`;
  }

  // Participants
  appointment.participant = [];
  appointment.participant.push({
    actor: { reference: `Patient/${row.patient_id}` },
    status: 'accepted',
  });
  if (row.doctor_id) {
    appointment.participant.push({
      actor: { reference: `Practitioner/${row.doctor_id}`, display: row.doctor_name },
      status: 'accepted',
    });
  }

  return appointment;
}

// ─── Diagnosis → FHIR Condition (BD-Core) ──────────────────────────────────

interface DiagnosisRow {
  id: number;
  patient_id: number;
  visit_id?: number;
  icd10_code?: string;
  icd10_description?: string;
  icd11_code?: string;
  icd11_title?: string;
  diagnosis_type?: string;
  is_primary?: number;
  notes?: string;
  created_at?: string;
}

export function toFhirCondition(row: DiagnosisRow, _baseUrl: string): FhirCondition {
  const condition: FhirCondition = {
    resourceType: 'Condition',
    id: String(row.id),
    meta: {
      lastUpdated: row.created_at,
      profile: [BD_FHIR.CONDITION_PROFILE],
    },
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active', display: 'Active' }],
    },
    verificationStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed', display: 'Confirmed' }],
    },
    subject: { reference: `Patient/${row.patient_id}` },
    recordedDate: row.created_at,
  };

  // Dual-coded: ICD-11 preferred, ICD-10 for backward compat
  const coding = [];
  if (row.icd11_code) {
    coding.push({ system: BD_FHIR.ICD11_SYSTEM, code: row.icd11_code, display: row.icd11_title ?? '' });
  }
  if (row.icd10_code) {
    coding.push({ system: BD_FHIR.ICD10_SYSTEM, code: row.icd10_code, display: row.icd10_description ?? '' });
  }
  if (coding.length > 0) {
    condition.code = {
      coding,
      text: row.icd11_title ?? row.icd10_description ?? '',
    };
  }

  // Category based on diagnosis type
  if (row.diagnosis_type) {
    condition.category = [{
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }],
      text: row.diagnosis_type,
    }];
  }

  if (row.visit_id) {
    condition.encounter = { reference: `Encounter/${row.visit_id}` };
  }

  if (row.notes) {
    condition.note = [{ text: row.notes }];
  }

  return condition;
}

// ─── Bundle builder ──────────────────────────────────────────────────────────

export function toBundle(resources: FhirResource[], baseUrl: string): FhirBundle {
  const entries: FhirBundleEntry[] = resources.map(r => ({
    fullUrl: `${baseUrl}/api/fhir/${r.resourceType}/${r.id}`,
    resource: r,
  }));

  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: resources.length,
    entry: entries.length > 0 ? entries : undefined,
  };
}

// ─── CapabilityStatement ─────────────────────────────────────────────────────

export function buildCapabilityStatement(baseUrl: string): FhirCapabilityStatement {
  return {
    resourceType: 'CapabilityStatement',
    id: 'ozzyl-hms',
    status: 'active',
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['json'],
    instantiates: [BD_FHIR.BD_CORE_IG],
    rest: [{
      mode: 'server',
      resource: [
        {
          type: 'Patient',
          profile: BD_FHIR.PATIENT_PROFILE,
          interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }],
          searchParam: [
            { name: 'name', type: 'string' },
            { name: '_id', type: 'token' },
            { name: 'identifier', type: 'token' },
            { name: 'phone', type: 'token' },
          ],
        },
        {
          type: 'Practitioner',
          interaction: [{ code: 'read' }, { code: 'search-type' }],
          searchParam: [
            { name: 'name', type: 'string' },
            { name: '_id', type: 'token' },
            { name: 'specialty', type: 'string' },
          ],
        },
        {
          type: 'Condition',
          profile: BD_FHIR.CONDITION_PROFILE,
          interaction: [{ code: 'read' }, { code: 'search-type' }],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'code', type: 'token' },
            { name: 'date', type: 'date' },
          ],
        },
        {
          type: 'Observation',
          interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'date', type: 'date' },
          ],
        },
        {
          type: 'MedicationRequest',
          interaction: [{ code: 'read' }, { code: 'search-type' }],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'date', type: 'date' },
            { name: 'status', type: 'token' },
          ],
        },
        {
          type: 'Encounter',
          interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'date', type: 'date' },
            { name: 'type', type: 'token' },
          ],
        },
        {
          type: 'Appointment',
          interaction: [{ code: 'read' }, { code: 'search-type' }],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'date', type: 'date' },
            { name: 'status', type: 'token' },
          ],
        },
      ],
    }],
  };
}

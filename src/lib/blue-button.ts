/**
 * Blue Button — Patient Health Record Export
 *
 * Lets patients download their complete health record as JSON (FHIR R4 Bundle).
 * Aggregates: demographics, vitals, medications, allergies, lab results,
 * wellness logs, mental health screenings, and uploaded documents.
 *
 * Mounted at: /api/patient-phr/blue-button
 * Auth: phr_token (patient JWT)
 */

export interface BlueButtonBundle {
  resourceType: 'Bundle';
  type: 'document';
  timestamp: string;
  entry: BlueButtonEntry[];
  meta: {
    source: string;
    exported_at: string;
    patient_id: number;
    sections: string[];
  };
}

export interface BlueButtonEntry {
  resource: {
    resourceType: string;
    [key: string]: unknown;
  };
}

export interface BlueButtonSection {
  key: string;
  label: string;
  query: string;
  /** Map DB row → FHIR-like resource */
  mapper: (row: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Section definitions — each pulls data from a DB table
 * and maps to a simplified FHIR-like resource.
 */
export const BLUE_BUTTON_SECTIONS: BlueButtonSection[] = [
  {
    key: 'demographics',
    label: 'Demographics',
    query: `SELECT name, phone, nid, gender, date_of_birth, blood_group, address, emergency_contact, emergency_phone
            FROM global_patient_auth WHERE id = ?`,
    mapper: (row) => ({
      resourceType: 'Patient',
      name: row.name,
      phone: row.phone,
      gender: row.gender,
      birthDate: row.date_of_birth,
      bloodGroup: row.blood_group,
      address: row.address,
      emergencyContact: { name: row.emergency_contact, phone: row.emergency_phone },
      identifier: row.nid ? [{ system: 'urn:bangladesh:nid', value: row.nid }] : [],
    }),
  },
  {
    key: 'vitals',
    label: 'Vital Signs',
    query: `SELECT type, value, unit, recorded_at
            FROM patient_vitals_log WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 500`,
    mapper: (row) => ({
      resourceType: 'Observation',
      category: 'vital-signs',
      code: row.type,
      valueQuantity: { value: row.value, unit: row.unit },
      effectiveDateTime: row.recorded_at,
    }),
  },
  {
    key: 'medications',
    label: 'Medications',
    query: `SELECT medication_name, dose, frequency, start_date, end_date, status, notes
            FROM patient_reported_medications WHERE patient_id = ? ORDER BY start_date DESC LIMIT 200`,
    mapper: (row) => ({
      resourceType: 'MedicationStatement',
      medicationCodeableConcept: { text: row.medication_name },
      dosage: [{ text: `${row.dose ?? ''} ${row.frequency ?? ''}`.trim() }],
      effectivePeriod: { start: row.start_date, end: row.end_date },
      status: row.status ?? 'active',
      note: row.notes ? [{ text: row.notes }] : [],
    }),
  },
  {
    key: 'allergies',
    label: 'Allergies & Adverse Reactions',
    query: `SELECT allergen, reaction_type, severity, onset_date, notes
            FROM patient_adverse_reactions WHERE patient_id = ? ORDER BY onset_date DESC`,
    mapper: (row) => ({
      resourceType: 'AllergyIntolerance',
      code: { text: row.allergen },
      type: row.reaction_type,
      criticality: row.severity === 'severe' ? 'high' : row.severity === 'moderate' ? 'low' : 'low',
      onsetDateTime: row.onset_date,
      note: row.notes ? [{ text: row.notes }] : [],
    }),
  },
  {
    key: 'wellness_logs',
    label: 'Wellness Logs',
    query: `SELECT type, value, unit, note, logged_at
            FROM lifestyle_logs WHERE patient_id = ? ORDER BY logged_at DESC LIMIT 1000`,
    mapper: (row) => ({
      resourceType: 'Observation',
      category: 'wellness',
      code: row.type,
      valueQuantity: { value: row.value, unit: row.unit },
      note: row.note ? [{ text: row.note }] : [],
      effectiveDateTime: row.logged_at,
    }),
  },
  {
    key: 'mental_health',
    label: 'Mental Health Screenings',
    query: `SELECT screening_type, total_score, severity, responses, screened_at
            FROM mental_health_screenings WHERE patient_id = ? ORDER BY screened_at DESC LIMIT 100`,
    mapper: (row) => ({
      resourceType: 'QuestionnaireResponse',
      questionnaire: row.screening_type,
      score: row.total_score,
      severity: row.severity,
      authored: row.screened_at,
    }),
  },
  {
    key: 'documents',
    label: 'Uploaded Documents (metadata)',
    query: `SELECT file_name, file_type, tags, uploaded_at
            FROM patient_vault_files WHERE patient_id = ? ORDER BY uploaded_at DESC LIMIT 200`,
    mapper: (row) => ({
      resourceType: 'DocumentReference',
      description: row.file_name,
      type: { text: row.file_type },
      category: row.tags,
      date: row.uploaded_at,
    }),
  },
];

/**
 * Build a Blue Button bundle from raw section results.
 */
export function buildBlueButtonBundle(
  patientId: number,
  sections: { key: string; entries: Record<string, unknown>[] }[],
): BlueButtonBundle {
  const now = new Date().toISOString();
  const allEntries: BlueButtonEntry[] = [];
  const includedSections: string[] = [];

  for (const section of sections) {
    if (section.entries.length > 0) {
      includedSections.push(section.key);
      for (const entry of section.entries) {
        allEntries.push({ resource: entry as BlueButtonEntry['resource'] });
      }
    }
  }

  return {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: now,
    entry: allEntries,
    meta: {
      source: 'OzzyLife HMS',
      exported_at: now,
      patient_id: patientId,
      sections: includedSections,
    },
  };
}

export interface EmergencyAdmissionPayloadInput {
  patientId: number;
  erPatientNumber: string;
  conditionOnArrival?: string | null;
  admissionReason?: string | null;
  department?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

export interface EmergencyAdmissionPayload {
  patient_id: number;
  admission_type: 'emergency';
  admit_source: 'emergency';
  is_emergency: true;
  billing_mode: 'emergency';
  admission_reason?: string;
  department?: string;
  notes: string;
  idempotencyKey: string;
}

function normalized(value?: string | null): string {
  return value?.trim() ?? '';
}

export function buildEmergencyAdmissionPayload(
  input: EmergencyAdmissionPayloadInput,
): EmergencyAdmissionPayload {
  const admissionReason = normalized(input.admissionReason) || normalized(input.conditionOnArrival);
  const department = normalized(input.department);
  const detailNotes = normalized(input.notes);
  const notes = `Emergency case ${input.erPatientNumber}.${detailNotes ? ` ${detailNotes}` : ''}`;

  return {
    patient_id: input.patientId,
    admission_type: 'emergency',
    admit_source: 'emergency',
    is_emergency: true,
    billing_mode: 'emergency',
    ...(admissionReason ? { admission_reason: admissionReason } : {}),
    ...(department ? { department } : {}),
    notes,
    idempotencyKey: input.idempotencyKey,
  };
}

export function emergencyPatientDetailsPath(patientId: number): string {
  return `../patients/${patientId}`;
}

export function createEmergencyAdmissionIdempotencyKey(erPatientId: number): string {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `er-admit-${erPatientId}-${randomPart}`;
}

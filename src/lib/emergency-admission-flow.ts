import { HTTPException } from 'hono/http-exception';

export interface EmergencyActiveAdmission {
  id: number | null;
  admission_no: string;
  admission_public_id?: string | null;
  mode?: 'legacy' | 'shadow' | 'canonical';
}

export interface EmergencyPatientProfileProjection {
  patient_name?: string | null;
  patient_gender?: string | null;
  patient_mobile?: string | null;
  patient_address?: string | null;
  patient_date_of_birth?: string | null;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isEmergencyPatientProfileIncomplete(
  profile: EmergencyPatientProfileProjection,
): boolean {
  return !hasText(profile.patient_name)
    || !hasText(profile.patient_gender)
    || !hasText(profile.patient_mobile)
    || !hasText(profile.patient_address)
    || !hasText(profile.patient_date_of_birth);
}

export function getRequiredEmergencyAdmission(
  finalizedStatus: string,
  activeAdmission: EmergencyActiveAdmission | null,
): EmergencyActiveAdmission | null {
  if (finalizedStatus !== 'admitted') return null;
  if (!activeAdmission) {
    throw new HTTPException(409, {
      message: 'Create the IPD admission before marking this emergency case admitted',
    });
  }
  return activeAdmission;
}

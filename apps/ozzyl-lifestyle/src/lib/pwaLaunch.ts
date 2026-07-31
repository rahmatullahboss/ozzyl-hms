const PATIENT_STORAGE_KEY = 'global_patient_user';
const STAFF_TOKEN_KEY = 'hms_token';

export interface PwaLaunchState {
  patientUserJson: string | null;
  staffToken: string | null;
}

export function getPwaLaunchPath(state: PwaLaunchState): string {
  if (state.staffToken) {
    return '/login';
  }

  if (state.patientUserJson) {
    try {
      const patient = JSON.parse(state.patientUserJson) as { id?: number | string } | null;
      if (patient && patient.id) {
        return '/patient/home';
      }
    } catch {
      // Ignore malformed patient session payloads and fall through.
    }
  }

  return '/patient/login';
}

export function getStoredPwaLaunchPath(storage: Pick<Storage, 'getItem'>): string {
  return getPwaLaunchPath({
    patientUserJson: storage.getItem(PATIENT_STORAGE_KEY),
    staffToken: storage.getItem(STAFF_TOKEN_KEY),
  });
}

import { describe, expect, it } from 'vitest';
import {
  getRequiredEmergencyAdmission,
  isEmergencyPatientProfileIncomplete,
} from '../../src/lib/emergency-admission-flow';

describe('emergency admission flow', () => {
  it('requires a real active IPD admission before an ER case can be finalized as admitted', () => {
    expect(() => getRequiredEmergencyAdmission('admitted', null)).toThrowError(
      'Create the IPD admission before marking this emergency case admitted',
    );
  });

  it('returns the existing active admission so retries can finish ER linkage idempotently', () => {
    const admission = { id: 73, admission_no: 'ADM-000073' };

    expect(getRequiredEmergencyAdmission('admitted', admission)).toEqual(admission);
    expect(getRequiredEmergencyAdmission('discharged', null)).toBeNull();
  });

  it('marks minimum-detail emergency profiles incomplete without blocking lifesaving admission', () => {
    expect(isEmergencyPatientProfileIncomplete({
      patient_name: 'Unknown Emergency',
      patient_gender: null,
      patient_mobile: null,
      patient_address: '',
      patient_date_of_birth: null,
    })).toBe(true);

    expect(isEmergencyPatientProfileIncomplete({
      patient_name: 'Rahim Uddin',
      patient_gender: 'male',
      patient_mobile: '01700000000',
      patient_address: 'Dhaka',
      patient_date_of_birth: '1990-01-01',
    })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  PATIENT_PORTAL_PRIMARY_NAV,
  PATIENT_PORTAL_SECONDARY_NAV,
  PATIENT_PORTAL_BOTTOM_NAV,
  getPatientPortalSectionShortcuts,
} from '../../apps/ozzyl-lifestyle/src/lib/patientPortalNav';

describe('patient portal navigation model', () => {
  it('keeps primary navigation focused on the six top-level portal areas', () => {
    expect(PATIENT_PORTAL_PRIMARY_NAV.map((item) => item.id)).toEqual([
      'overview',
      'hospital-services',
      'global-records',
      'trends',
      'family',
      'privacy',
    ]);

    expect(PATIENT_PORTAL_SECONDARY_NAV.map((item) => item.id)).toEqual([
      'find-care',
      'hospital-services',
      'data',
      'privacy',
      'vault',
      'global-records',
    ]);

    expect(PATIENT_PORTAL_BOTTOM_NAV.map((item) => item.id)).toEqual([
      'home',
      'care',
      'records',
      'profile',
    ]);
  });

  it('shows section-specific shortcuts for the active area', () => {
    expect(getPatientPortalSectionShortcuts('hospital-services').map((item) => item.id)).toEqual([
      'find-care',
      'hospital-services',
    ]);

    expect(getPatientPortalSectionShortcuts('global-records').map((item) => item.id)).toEqual([
      'vault',
      'global-records',
    ]);

    expect(getPatientPortalSectionShortcuts('privacy').map((item) => item.id)).toEqual([
      'data',
      'privacy',
    ]);
  });
});

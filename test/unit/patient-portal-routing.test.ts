import { describe, expect, it } from 'vitest';
import {
  getPatientPortalPathForTab,
  getPatientPortalTabFromLocation,
  getPatientPortalTopLevelPath,
} from '../../apps/ozzyl-lifestyle/src/lib/patientPortalRouting';

describe('patient portal routing', () => {
  it('maps top-level patient portal paths to stable default tabs', () => {
    expect(getPatientPortalTabFromLocation('/patient/home', '')).toBe('overview');
    expect(getPatientPortalTabFromLocation('/patient/care', '')).toBe('hospital-services');
    expect(getPatientPortalTabFromLocation('/patient/records', '')).toBe('global-records');
    expect(getPatientPortalTabFromLocation('/patient/wellness', '')).toBe('trends');
    expect(getPatientPortalTabFromLocation('/patient/family', '')).toBe('family');
    expect(getPatientPortalTabFromLocation('/patient/privacy', '')).toBe('privacy');
  });

  it('preserves legacy query-tab links when resolving state', () => {
    expect(getPatientPortalTabFromLocation('/patient/dashboard', '?tab=vault')).toBe('vault');
    expect(getPatientPortalTabFromLocation('/patient/care', '?tab=find-care')).toBe('find-care');
    expect(getPatientPortalTabFromLocation('/patient/wellness', '?tab=medicine-tracker')).toBe('medicine-tracker');
  });

  it('builds canonical patient paths from tabs', () => {
    expect(getPatientPortalPathForTab('overview')).toBe('/patient/home');
    expect(getPatientPortalPathForTab('hospital-services')).toBe('/patient/care');
    expect(getPatientPortalPathForTab('global-records')).toBe('/patient/records');
    expect(getPatientPortalPathForTab('trends')).toBe('/patient/wellness');
    expect(getPatientPortalPathForTab('family')).toBe('/patient/family');
    expect(getPatientPortalPathForTab('privacy')).toBe('/patient/privacy');
    expect(getPatientPortalPathForTab('find-care')).toBe('/patient/care?tab=find-care');
    expect(getPatientPortalPathForTab('vault')).toBe('/patient/records?tab=vault');
    expect(getPatientPortalPathForTab('data')).toBe('/patient/home?tab=data');
  });

  it('exposes top-level paths for app shell redirects and launch logic', () => {
    expect(getPatientPortalTopLevelPath('home')).toBe('/patient/home');
    expect(getPatientPortalTopLevelPath('care')).toBe('/patient/care');
    expect(getPatientPortalTopLevelPath('records')).toBe('/patient/records');
    expect(getPatientPortalTopLevelPath('wellness')).toBe('/patient/wellness');
    expect(getPatientPortalTopLevelPath('family')).toBe('/patient/family');
    expect(getPatientPortalTopLevelPath('privacy')).toBe('/patient/privacy');
  });
});

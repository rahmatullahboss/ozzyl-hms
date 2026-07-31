import { describe, expect, it } from 'vitest';
import { resolvePatientAssetPath } from '../../src/lib/patient-asset-routing';

describe('patient asset routing', () => {
  it('serves the patient SPA shell for patient client routes', () => {
    expect(resolvePatientAssetPath('/patient/login')).toBe('/patient/index.html');
    expect(resolvePatientAssetPath('/patient/dashboard')).toBe('/patient/index.html');
    expect(resolvePatientAssetPath('/patient/onboarding')).toBe('/patient/index.html');
  });

  it('keeps concrete patient asset files untouched', () => {
    expect(resolvePatientAssetPath('/patient/assets/index.js')).toBe('/patient/assets/index.js');
    expect(resolvePatientAssetPath('/patient/sw.js')).toBe('/patient/sw.js');
    expect(resolvePatientAssetPath('/patient/manifest.webmanifest')).toBe('/patient/manifest.webmanifest');
  });

  it('normalizes the patient root to the patient SPA shell', () => {
    expect(resolvePatientAssetPath('/patient')).toBe('/patient/index.html');
    expect(resolvePatientAssetPath('/patient/')).toBe('/patient/index.html');
  });
});

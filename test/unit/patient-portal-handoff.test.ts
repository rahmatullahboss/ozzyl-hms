import { describe, expect, it } from 'vitest';
import {
  buildPatientPortalHandoffTarget,
  shouldUnregisterServiceWorkerScope,
} from '../../web/src/lib/patientPortalHandoff';

describe('patient portal handoff helpers', () => {
  it('keeps the current patient path when handing off to the dedicated app shell', () => {
    expect(
      buildPatientPortalHandoffTarget({
        pathname: '/patient/dashboard',
        search: '?tab=vault',
        hash: '#documents',
      }),
    ).toBe('/patient/dashboard?tab=vault#documents');
  });

  it('unregisters the same-origin root web shell service worker', () => {
    expect(
      shouldUnregisterServiceWorkerScope('https://hms.example.com/', 'https://hms.example.com'),
    ).toBe(true);
  });

  it('keeps the patient portal service worker registered', () => {
    expect(
      shouldUnregisterServiceWorkerScope('https://hms.example.com/patient/', 'https://hms.example.com'),
    ).toBe(false);
  });

  it('ignores service workers from another origin', () => {
    expect(
      shouldUnregisterServiceWorkerScope('https://cdn.example.com/', 'https://hms.example.com'),
    ).toBe(false);
  });
});

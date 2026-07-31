import { describe, expect, it } from 'vitest';
import { getPwaLaunchPath } from '../../web/src/lib/pwaLaunch';

describe('pwa launch path', () => {
  it('opens the patient home when a patient session exists', () => {
    expect(
      getPwaLaunchPath({
        patientUserJson: '{"id":1,"name":"Patient"}',
        staffToken: null,
      }),
    ).toBe('/patient/home');
  });

  it('opens the staff login when no patient session exists but staff token is present', () => {
    expect(
      getPwaLaunchPath({
        patientUserJson: null,
        staffToken: 'jwt-token',
      }),
    ).toBe('/login');
  });

  it('defaults to patient login when no session exists', () => {
    expect(
      getPwaLaunchPath({
        patientUserJson: null,
        staffToken: null,
      }),
    ).toBe('/patient/login');
  });

  it('ignores malformed patient session payloads', () => {
    expect(
      getPwaLaunchPath({
        patientUserJson: '{bad json',
        staffToken: null,
      }),
    ).toBe('/patient/login');
  });

  it('prefers the staff app when both staff and patient sessions exist', () => {
    expect(
      getPwaLaunchPath({
        patientUserJson: '{"id":1,"name":"Patient"}',
        staffToken: 'jwt-token',
      }),
    ).toBe('/login');
  });
});

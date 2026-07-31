import { describe, expect, it } from 'vitest';
import patientRoutes from '../src/routes/tenant/patients';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function makeNursePatientApp() {
  return createTestApp({
    route: patientRoutes,
    routePath: '/patients',
    role: 'nurse',
    queryOverride(sql) {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from role_permission_overrides')) {
        return { first: null };
      }
      if (normalized.includes('from user_permission_overrides')) {
        return { results: [] };
      }
      return null;
    },
  }).app;
}

describe('patient write permission boundaries', () => {
  it('blocks a read-only nurse from merging patient identities', async () => {
    const response = await jsonRequest(makeNursePatientApp(), '/patients/2/merge?original_id=1', {
      method: 'PUT',
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'Missing permission: patients:write' });
  });

  it('blocks a read-only nurse from linking a global patient into the hospital', async () => {
    const response = await jsonRequest(makeNursePatientApp(), '/patients/link-global', {
      method: 'POST',
      body: { uhid: 'OZ-000123' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'Missing permission: patients:write' });
  });
});

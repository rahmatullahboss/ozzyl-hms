import { describe, expect, it } from 'vitest';
import nursingRoutes from '../src/routes/tenant/nursing';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('nursing route index', () => {
  it.each([
    ['/nursing/blood-sugar'],
    ['/nursing/consultation-requests'],
    ['/nursing/ward-billing'],
    ['/nursing/drug-requisition'],
    ['/nursing/patient-transfer'],
    ['/nursing/nursing-orders'],
    ['/nursing/respiratory?patient_id=1'],
  ])('mounts %s', async (path) => {
    const { app } = createTestApp({
      route: nursingRoutes,
      routePath: '/nursing',
      role: 'nurse',
      universalFallback: true,
    });

    const res = await jsonRequest(app, path);
    expect(res.status).not.toBe(404);
  });
});

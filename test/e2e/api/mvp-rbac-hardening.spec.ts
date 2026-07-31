/**
 * Ozzyl HMS — MVP RBAC hardening smoke tests
 *
 * These tests verify that sensitive MVP modules are no longer protected only by
 * authentication. They must also enforce role permissions centrally from authMiddleware.
 *
 * Run:
 *   BASE_URL=... E2E_PASSWORD=Demo@1234 npx playwright test test/e2e/api/mvp-rbac-hardening.spec.ts
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] || 'https://hms-saas-production.rahmatullahzisan.workers.dev';
const PASSWORD = process.env['E2E_PASSWORD'] || 'Demo@1234';

type RoleKey = 'doctor' | 'reception' | 'pharmacy' | 'accountant';

const accounts: Record<RoleKey, string> = {
  doctor: process.env['E2E_DOCTOR_EMAIL'] || 'doctor@demo-hospital.com',
  reception: process.env['E2E_RECEPTION_EMAIL'] || 'reception@demo-hospital.com',
  pharmacy: process.env['E2E_PHARMACY_EMAIL'] || 'pharmacy@demo-hospital.com',
  accountant: process.env['E2E_ACCOUNTANT_EMAIL'] || 'accounts@demo-hospital.com',
};

const tokens: Partial<Record<RoleKey, { token: string; slug: string }>> = {};

async function login(request: APIRequestContext, role: RoleKey) {
  const res = await request.post(`${BASE_URL}/api/auth/login-direct`, {
    data: { email: accounts[role], password: PASSWORD },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  tokens[role] = { token: body.token, slug: body.slug };
}

function h(role: RoleKey) {
  const auth = tokens[role];
  if (!auth) throw new Error(`Role not logged in: ${role}`);
  return {
    Authorization: `Bearer ${auth.token}`,
    'X-Tenant-Slug': auth.slug,
    'Content-Type': 'application/json',
  };
}

test.describe('MVP RBAC hardening', () => {
  test.beforeAll(async ({ request }) => {
    await Promise.all((Object.keys(accounts) as RoleKey[]).map((role) => login(request, role)));
  });

  test('accountant cannot list patients without patients:read', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients?limit=1`, { headers: h('accountant') });
    expect(res.status()).toBe(403);
  });

  test('doctor cannot access billing dues without billing:read', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/billing/due`, { headers: h('doctor') });
    expect(res.status()).toBe(403);
  });

  test('pharmacist cannot create visits without appointments:write', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/visits`, {
      headers: h('pharmacy'),
      data: { patientId: 1, visitType: 'opd', admissionFlag: false },
    });
    expect(res.status()).toBe(403);
  });

  test('reception cannot read prescription history without prescriptions:read', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/prescriptions/history?patientId=1`, { headers: h('reception') });
    expect(res.status()).toBe(403);
  });

  test('doctor cannot enter lab result even if the lab item id exists', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/lab/items/1/result`, {
      headers: h('doctor'),
      data: { result: '12.5' },
    });
    expect(res.status()).toBe(403);
  });

  test('reception cannot move lab sample status', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/lab/items/1/sample-status`, {
      headers: h('reception'),
      data: { status: 'collected', notes: 'unauthorized test attempt' },
    });
    expect(res.status()).toBe(403);
  });
});

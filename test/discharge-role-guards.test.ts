import { describe, expect, it } from 'vitest';
import dischargeRoutes from '../src/routes/tenant/discharge';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeApp(role: string) {
  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      // Mock admission lookup
      if (s.includes('from admissions') && s.includes('where id = ? and tenant_id = ?')) {
        if (params[1] !== 'tenant-1') return { first: null };
        return {
          first: {
            id: Number(params[0]),
            tenant_id: 'tenant-1',
            patient_id: 1,
            doctor_id: 1,
            bed_id: 1,
            status: 'admitted',
            patient_name: 'Test Patient',
            patient_code: 'P001',
            date_of_birth: '1990-01-01',
            gender: 'Male',
            ward_name: 'General',
            bed_number: 'B1',
            doctor_name: 'Dr Test',
            staff_id: 1,
          },
        };
      }
      // Mock discharge summary lookup
      if (s.includes('from discharge_summaries') && s.includes('where admission_id = ?')) {
        return {
          first: {
            id: 1,
            tenant_id: 'tenant-1',
            admission_id: Number(params[0]),
            patient_id: 1,
            status: 'draft',
            procedures_performed: '[]',
            medicines_on_discharge: '[]',
            lab_tests: '[]',
            imaging_items: '[]',
          },
        };
      }
      // Mock consultants lookup
      if (s.includes('from discharge_summary_consultants')) {
        return { results: [] };
      }
      // Mock template lookup
      if (s.includes('from discharge_summary_templates')) {
        return { results: [{ id: 1, name: 'Default', fields_json: '{}', is_default: 1 }] };
      }
      // Mock discharge slip query
      if (s.includes('discharge_condition_types')) {
        return { first: null };
      }
      // Mock insert/update operations
      if (s.includes('insert into') || s.includes('update ')) {
        return { success: true, meta: { last_row_id: 1, changes: 1 } };
      }
      return null;
    },
  });

  return createTestApp({
    route: dischargeRoutes,
    routePath: '/discharge',
    role,
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('discharge role guards', () => {
  describe('GET /discharge/templates/list', () => {
    const allowedRoles = ['hospital_admin', 'doctor', 'md', 'nurse', 'reception'];
    const deniedRoles = ['pharmacist', 'lab_technician'];

    for (const role of allowedRoles) {
      it(`allows ${role} to list templates`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/templates/list');
        expect(res.status).not.toBe(403);
      });
    }

    for (const role of deniedRoles) {
      it(`denies ${role} from listing templates`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/templates/list');
        expect(res.status).toBe(403);
      });
    }
  });

  describe('POST /discharge/templates', () => {
    const allowedRoles = ['hospital_admin', 'doctor', 'md'];
    const deniedRoles = ['nurse', 'reception', 'pharmacist', 'lab_technician'];

    for (const role of allowedRoles) {
      it(`allows ${role} to create templates`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test Template' }),
        });
        expect(res.status).not.toBe(403);
      });
    }

    for (const role of deniedRoles) {
      it(`denies ${role} from creating templates`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test Template' }),
        });
        expect(res.status).toBe(403);
      });
    }
  });

  describe('GET /discharge/:admissionId', () => {
    const allowedRoles = ['hospital_admin', 'doctor', 'md', 'nurse', 'reception'];
    const deniedRoles = ['pharmacist', 'lab_technician'];

    for (const role of allowedRoles) {
      it(`allows ${role} to read discharge summary`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1');
        expect(res.status).not.toBe(403);
      });
    }

    for (const role of deniedRoles) {
      it(`denies ${role} from reading discharge summary`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1');
        expect(res.status).toBe(403);
      });
    }
  });

  describe('PUT /discharge/:admissionId', () => {
    const allowedRoles = ['hospital_admin', 'doctor', 'md'];
    const deniedRoles = ['nurse', 'reception', 'pharmacist', 'lab_technician'];

    for (const role of allowedRoles) {
      it(`allows ${role} to update discharge summary`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'draft' }),
        });
        expect(res.status).not.toBe(403);
      });
    }

    for (const role of deniedRoles) {
      it(`denies ${role} from updating discharge summary`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'draft' }),
        });
        expect(res.status).toBe(403);
      });
    }
  });

  describe('POST /discharge/:admissionId/consultants', () => {
    const allowedRoles = ['hospital_admin', 'doctor', 'md'];
    const deniedRoles = ['nurse', 'reception', 'pharmacist', 'lab_technician'];

    for (const role of allowedRoles) {
      it(`allows ${role} to add consultants`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1/consultants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consultant_id: 2, role: 'consultant' }),
        });
        expect(res.status).not.toBe(403);
      });
    }

    for (const role of deniedRoles) {
      it(`denies ${role} from adding consultants`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1/consultants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consultant_id: 2, role: 'consultant' }),
        });
        expect(res.status).toBe(403);
      });
    }
  });

  describe('DELETE /discharge/:admissionId/consultants/:consultantId', () => {
    const allowedRoles = ['hospital_admin', 'doctor', 'md'];
    const deniedRoles = ['nurse', 'reception', 'pharmacist', 'lab_technician'];

    for (const role of allowedRoles) {
      it(`allows ${role} to remove consultants`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1/consultants/2', {
          method: 'DELETE',
        });
        expect(res.status).not.toBe(403);
      });
    }

    for (const role of deniedRoles) {
      it(`denies ${role} from removing consultants`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1/consultants/2', {
          method: 'DELETE',
        });
        expect(res.status).toBe(403);
      });
    }
  });

  describe('GET /discharge/:admissionId/slip', () => {
    const allowedRoles = ['hospital_admin', 'doctor', 'md', 'nurse', 'reception'];
    const deniedRoles = ['pharmacist', 'lab_technician'];

    for (const role of allowedRoles) {
      it(`allows ${role} to read discharge slip`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1/slip');
        expect(res.status).not.toBe(403);
      });
    }

    for (const role of deniedRoles) {
      it(`denies ${role} from reading discharge slip`, async () => {
        const { app } = makeApp(role);
        const res = await app.request('/discharge/1/slip');
        expect(res.status).toBe(403);
      });
    }
  });

  describe('unauthenticated requests', () => {
    it('returns 403 when no role is set', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: undefined,
        tenantId: 'tenant-1',
        mockDB: createMockDB(),
      });
      const res = await app.request('/discharge/1');
      expect(res.status).toBe(403);
    });
  });
});

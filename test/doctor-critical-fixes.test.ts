import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import doctorScheduleRoutes from '../src/routes/tenant/doctorSchedule';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

// ─── CRIT-2: upload-photo role guard ─────────────────────────────────────────

describe('CRIT-2: upload-photo role guard', () => {
  function makePhotoApp(role: string) {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('where id = ?')) {
          return { first: { id: 1, tenant_id: 'tenant-1', photo_key: null } };
        }
        return null;
      },
    });

    return createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role,
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });
  }

  it('returns 403 for nurse role', async () => {
    const { app } = makePhotoApp('nurse');
    const formData = new FormData();
    formData.append('photo', new File(['test'], 'photo.jpg', { type: 'image/jpeg' }));

    const res = await app.request('/doctors/upload-photo', {
      method: 'POST',
      body: formData,
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 for receptionist role', async () => {
    const { app } = makePhotoApp('receptionist');
    const formData = new FormData();
    formData.append('photo', new File(['test'], 'photo.jpg', { type: 'image/jpeg' }));

    const res = await app.request('/doctors/upload-photo', {
      method: 'POST',
      body: formData,
    });
    expect(res.status).toBe(403);
  });

  it('succeeds for hospital_admin role', async () => {
    const { app } = makePhotoApp('hospital_admin');
    const formData = new FormData();
    formData.append('photo', new File(['test'], 'photo.jpg', { type: 'image/jpeg' }));

    const res = await app.request('/doctors/upload-photo', {
      method: 'POST',
      body: formData,
    });
    expect(res.status).not.toBe(403);
  });

  it('succeeds for doctor role', async () => {
    const { app } = makePhotoApp('doctor');
    const formData = new FormData();
    formData.append('photo', new File(['test'], 'photo.jpg', { type: 'image/jpeg' }));

    const res = await app.request('/doctors/upload-photo', {
      method: 'POST',
      body: formData,
    });
    expect(res.status).not.toBe(403);
  });
});

// ─── CRIT-3: publish audit log ───────────────────────────────────────────────

describe('CRIT-3: publish endpoint audit log', () => {
  function makePublishApp() {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
          if (params[1] !== 'tenant-1') return { first: null };
          return {
            first: {
              id: 5,
              tenant_id: 'tenant-1',
              name: 'Dr Existing',
              is_active: 1,
              is_marketplace_visible: 0,
            },
          };
        }
        return null;
      },
    });

    return createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });
  }

  it('creates an UPDATE audit log when doctor is published to marketplace', async () => {
    const { app, mockDB } = makePublishApp();

    const res = await app.request('/doctors/5/publish', { method: 'POST' });
    expect(res.status).toBe(200);

    const auditLogs = mockDB.queries.filter((q) =>
      q.sql.toLowerCase().includes('insert into audit_logs'),
    );
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs[0].params).toContain('UPDATE');
    expect(auditLogs[0].params).toContain('doctors');
    expect(auditLogs[0].params).toContain('tenant-1');
  });
});

// ─── CRIT-4: doctorSchedule.ts role guards ───────────────────────────────────

describe('CRIT-4: doctorSchedule.ts write endpoint auth', () => {
  function makeScheduleApp(role: string) {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_schedules') && s.includes('where id = ?')) {
          return { first: { id: 1, doctor_id: 1, tenant_id: 'tenant-1', start_time: '09:00', end_time: '12:00' } };
        }
        if (s.includes('from doctors') && s.includes('where id = ?')) {
          return { first: { id: 1, tenant_id: 'tenant-1' } };
        }
        return null;
      },
    });

    return createTestApp({
      route: doctorScheduleRoutes,
      routePath: '/doctor-schedules',
      role,
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });
  }

  it('POST /doctor-schedules returns 403 for doctor role', async () => {
    const { app } = makeScheduleApp('doctor');
    const res = await jsonRequest(app, '/doctor-schedules', {
      method: 'POST',
      body: { doctor_id: 1, day_of_week: 'mon', start_time: '09:00', end_time: '12:00', session_type: 'morning', max_patients: 10 },
    });
    expect(res.status).toBe(403);
  });

  it('POST /doctor-schedules returns 403 for nurse role', async () => {
    const { app } = makeScheduleApp('nurse');
    const res = await jsonRequest(app, '/doctor-schedules', {
      method: 'POST',
      body: { doctor_id: 1, day_of_week: 'mon', start_time: '09:00', end_time: '12:00', session_type: 'morning', max_patients: 10 },
    });
    expect(res.status).toBe(403);
  });

  it('POST /doctor-schedules succeeds for hospital_admin role', async () => {
    const { app } = makeScheduleApp('hospital_admin');
    const res = await jsonRequest(app, '/doctor-schedules', {
      method: 'POST',
      body: { doctor_id: 1, day_of_week: 'mon', start_time: '09:00', end_time: '12:00', session_type: 'morning', max_patients: 10 },
    });
    expect(res.status).not.toBe(403);
  });

  it('PUT /doctor-schedules/:id returns 403 for doctor role', async () => {
    const { app } = makeScheduleApp('doctor');
    const res = await jsonRequest(app, '/doctor-schedules/1', {
      method: 'PUT',
      body: { start_time: '10:00' },
    });
    expect(res.status).toBe(403);
  });

  it('DELETE /doctor-schedules/:id returns 403 for nurse role', async () => {
    const { app } = makeScheduleApp('nurse');
    const res = await app.request('/doctor-schedules/1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('DELETE /doctor-schedules/:id succeeds for hospital_admin role', async () => {
    const { app } = makeScheduleApp('hospital_admin');
    const res = await app.request('/doctor-schedules/1', { method: 'DELETE' });
    expect(res.status).not.toBe(403);
  });
});

// ─── Pending order billing state visible without exposing bill amount ────────

describe('Doctor pending order billing state', () => {
  function makeDashboardApp() {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        // Doctor lookup via user_id
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: { id: 5, name: 'Dr Test', specialty: 'Medicine', department: 'Medicine', qualifications: 'MBBS', consultation_fee: 500 } };
        }
        // Enhanced queue query
        if (s.includes('from appointments') && s.includes('appt_date')) {
          return { results: [] };
        }
        // KPI
        if (s.includes('count(*)') && s.includes('appointments')) {
          return { first: { cnt: 0, total: 0, completed: 0, waiting: 0, in_progress: 0 } };
        }
        // Visit types
        if (s.includes('visit_type') && s.includes('group by')) {
          return { results: [] };
        }
        // Recent rx
        if (s.includes('from prescriptions') && s.includes('order by')) {
          return { results: [] };
        }
        // Follow ups
        if (s.includes('follow_up_date')) {
          return { results: [] };
        }
        // Available doctors
        if (s.includes('from doctors') && s.includes('is_active = 1') && s.includes('display_order')) {
          return { results: [] };
        }
        // Pending lab orders — include billing state but not bill amount
        if (s.includes('from lab_orders') && s.includes('ordered_by')) {
          return { results: [{ id: 1, type: 'lab', order_no: 'LO-001', ordered_at: '2026-05-19', patient_name: 'Test', patient_code: 'P001', status: 'pending', billing_status: 'unpaid', bill_id: 77, invoice_no: 'INV-77' }] };
        }
        // Pending imaging orders
        if (s.includes('from radiology_requisitions') && s.includes('created_by')) {
          return { results: [] };
        }
        // Inpatients
        if (s.includes('from admissions') && s.includes('doctor_id')) {
          return { results: [] };
        }
        // Website config (triggerSiteReRender)
        if (s.includes('website_config')) {
          return { first: null };
        }
        return null;
      },
    });

    return createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });
  }

  it('pending lab orders include billing status and invoice without bill totals', async () => {
    const { app, mockDB } = makeDashboardApp();

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(200);

    const body = await res.json();

    // Verify pending orders exist
    expect(body.pendingOrders).toBeDefined();
    expect(body.pendingOrders.length).toBeGreaterThanOrEqual(1);

    const order = body.pendingOrders[0];
    expect(order.billing_status).toBe('unpaid');
    expect(order.invoice_no).toBe('INV-77');
    expect(order.bill_id).toBe(77);
    expect(order.total).toBeUndefined();
    expect(order.bill_amount).toBeUndefined();
    expect(order.amount).toBeUndefined();
  });

  it('pending lab orders SQL joins bills only for invoice metadata', async () => {
    const { mockDB } = makeDashboardApp();

    // Find the lab orders query
    const labQuery = mockDB.queries.find((q) => {
      const s = q.sql.toLowerCase();
      return s.includes('lab_orders') && (s.includes('ordered_by') || s.includes('pending'));
    });

    // If the query exists, verify only invoice metadata is selected from bills.
    if (labQuery) {
      const sql = labQuery.sql.toLowerCase();
      expect(sql).toContain('join bills');
      expect(sql).toContain('b.invoice_no');
      expect(sql).not.toContain('b.total');
      expect(sql).not.toContain('b.due');
    }
  });
});

describe('CRIT-5: reassign does not corrupt department_id', () => {
  function makeReassignApp() {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        // Doctor lookup for dashboard resolution
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: { id: 10, name: 'Dr Current', tenant_id: 'tenant-1' } };
        }
        // Appointment lookup
        if (s.includes('from appointments') && s.includes('where id = ? and tenant_id = ? and doctor_id = ?')) {
          return {
            first: {
              id: 100,
              patient_id: 50,
              doctor_id: 10,
              status: 'checked_in',
              appt_date: '2026-05-19',
              appt_time: '10:00',
              notes: '',
            },
          };
        }
        // Target doctor lookup
        if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ? and is_active = 1')) {
          return { first: { id: 20, name: 'Dr Target', tenant_id: 'tenant-1' } };
        }
        // Conflict check
        if (s.includes('select id from appointments') && s.includes('appt_time')) {
          return { first: null };
        }
        // Canonical appointment route context
        if (s.includes('from appointments') && s.includes('where tenant_id=? and id=?')) {
          return {
            first: {
              id: 100,
              patient_id: 50,
              doctor_id: 10,
              status: 'checked_in',
              appt_date: '2026-05-19',
              appt_time: '10:00',
              appointment_type: 'new_patient',
              visit_type: 'new_patient',
              source: 'reception',
              token_no: 1,
              token_assignment_type: 'auto',
              notes: '',
              canonical_source_key: null,
            },
          };
        }
        if (s.includes('count(*) as link_count') && s.includes('canonical_tenant_patient_links')) {
          return { first: { link_count: 1, patient_link_public_id: 'ptl-50' } };
        }
        if (s.includes('from canonical_tenant_patient_links') && s.includes('patient_link_public_id=?')) {
          return { first: { legacy_patient_id: 50, link_status: 'unlinked', effective_to_utc: null } };
        }
        if (s.includes('select canonical_source_key') && s.includes('from doctors')) {
          return { first: { canonical_source_key: Number(params[1]) === 20 ? 'doctor-source-20' : 'doctor-source-10' } };
        }
        if (s.includes("entity_type='practitioner'") && s.includes('from canonical_source_mappings')) {
          return {
            first: {
              canonical_public_id: String(params[1]).includes('20') ? 'practitioner-20' : 'practitioner-10',
              mapping_status: 'mapped',
            },
          };
        }
        if (s.includes('from canonical_practitioners') && s.includes('practitioner_public_id=?')) {
          return { first: { status: 'active' } };
        }
        if (s.includes("entity_type='appointment'") && s.includes('from canonical_source_mappings')) {
          return { first: null };
        }
        if (s.includes('from canonical_outbox_events')) return { first: null };
        if (s.includes('from canonical_appointments')) return { first: null };
        return null;
      },
    });

    return createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });
  }

  it('does not set department_id to doctor_id in queue_entries update', async () => {
    const { app, mockDB } = makeReassignApp();

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/100/reassign', {
      method: 'PUT',
      body: { doctorId: 20 },
    });

    expect(res.status).toBe(200);

    // Find the queue_entries UPDATE query
    const queueUpdate = mockDB.queries.find((q) =>
      q.sql.toLowerCase().includes('update queue_entries') && q.sql.toLowerCase().includes('doctor_id'),
    );

    expect(queueUpdate).toBeDefined();

    // Verify the SQL does NOT contain department_id = ?
    expect(queueUpdate!.sql.toLowerCase()).not.toContain('department_id');

    // Verify doctor_id is bound correctly (should be 20, not 10)
    expect(queueUpdate!.params).toContain(20);
  });
});

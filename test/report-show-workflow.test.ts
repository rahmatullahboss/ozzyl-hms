import { describe, it, expect } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

// ─── Mock DB factory for report-show tests ──────────────────────────────────

function makeReportShowMockDB(overrides?: {
  appointments?: Record<string, unknown>[];
  prescriptions?: Record<string, unknown>[];
  prescriptionItems?: Record<string, unknown>[];
  labOrders?: Record<string, unknown>[];
  labOrderItems?: Record<string, unknown>[];
  labTestCatalog?: Record<string, unknown>[];
  queryOverride?: (sql: string, params: unknown[]) => ReturnType<typeof createMockDB>[0] extends { queryOverride?: infer R } ? R : never;
}) {
  const today = '2026-05-26';

  const defaultAppointments = [
    {
      id: 101,
      patient_id: 1,
      appt_date: today,
      appt_time: '10:00',
      appointment_type: 'report_show',
      status: 'checked_in',
      notes: null,
      doctor_id: 1,
      tenant_id: 'tenant-1',
    },
    {
      id: 102,
      patient_id: 2,
      appt_date: today,
      appt_time: '10:30',
      appointment_type: 'report_show',
      status: 'checked_in',
      notes: null,
      doctor_id: 1,
      tenant_id: 'tenant-1',
    },
  ];

  const defaultPrescriptions = [
    {
      id: 1,
      patient_id: 1,
      doctor_id: 1,
      rx_no: 'RX001',
      chief_complaint: 'Headache',
      diagnosis: 'Migraine',
      advice: 'Rest and hydrate',
      follow_up_date: '2026-06-01',
      status: 'final',
      created_at: '2026-05-20 10:00:00',
      tenant_id: 'tenant-1',
    },
    {
      id: 2,
      patient_id: 2,
      doctor_id: 1,
      rx_no: 'RX002',
      chief_complaint: 'Fever',
      diagnosis: 'Viral infection',
      advice: 'Take paracetamol',
      follow_up_date: null,
      status: 'final',
      created_at: '2026-05-22 14:00:00',
      tenant_id: 'tenant-1',
    },
  ];

  const defaultPrescriptionItems = [
    { id: 1, prescription_id: 1, medicine_name: 'Paracetamol', dosage: '500mg', frequency: 'TDS', duration: '5 days', instructions: 'After meal', sort_order: 0 },
    { id: 2, prescription_id: 2, medicine_name: 'Ibuprofen', dosage: '400mg', frequency: 'BD', duration: '3 days', instructions: null, sort_order: 0 },
  ];

  const defaultLabOrders = [
    { id: 1, order_no: 'L001', patient_id: 1, order_date: '2026-05-20', status: 'completed', tenant_id: 'tenant-1' },
    { id: 2, order_no: 'L002', patient_id: 1, order_date: '2026-05-22', status: 'pending', tenant_id: 'tenant-1' },
    { id: 3, order_no: 'L003', patient_id: 2, order_date: '2026-05-22', status: 'completed', tenant_id: 'tenant-1' },
  ];

  const defaultLabOrderItems = [
    { id: 1, lab_order_id: 1, lab_test_id: 1, result: '5.5', status: 'completed', completed_at: '2026-05-21 09:00:00', tenant_id: 'tenant-1', abnormal_flag: 'normal' },
    { id: 2, lab_order_id: 2, lab_test_id: 2, result: null, status: 'pending', completed_at: null, tenant_id: 'tenant-1', abnormal_flag: 'pending' },
    { id: 3, lab_order_id: 3, lab_test_id: 1, result: '6.2', status: 'completed', completed_at: '2026-05-23 10:00:00', tenant_id: 'tenant-1', abnormal_flag: 'high' },
  ];

  const defaultLabTestCatalog = [
    { id: 1, name: 'CBC', unit: 'million/mcL', tenant_id: 'tenant-1' },
    { id: 2, name: 'Blood Sugar Fasting', unit: 'mg/dL', tenant_id: 'tenant-1' },
  ];

  const appointments = overrides?.appointments ?? defaultAppointments;
  const prescriptions = overrides?.prescriptions ?? defaultPrescriptions;
  const prescriptionItems = overrides?.prescriptionItems ?? defaultPrescriptionItems;
  const labOrders = overrides?.labOrders ?? defaultLabOrders;
  const labOrderItems = overrides?.labOrderItems ?? defaultLabOrderItems;
  const labTestCatalog = overrides?.labTestCatalog ?? defaultLabTestCatalog;

  const patients = [
    { id: 1, name: 'Ali Ahmed', patient_code: 'P001', mobile: '01712345678', age: 35, gender: 'male', tenant_id: 'tenant-1' },
    { id: 2, name: 'Fatima Begum', patient_code: 'P002', mobile: '01812345678', age: 28, gender: 'female', tenant_id: 'tenant-1' },
  ];

  return createMockDB({
    tables: {
      prescriptions,
      prescription_items: prescriptionItems,
      lab_orders: labOrders,
      lab_order_items: labOrderItems,
      lab_test_catalog: labTestCatalog,
      settings: [],
      patients,
      doctors: [
        { id: 1, name: 'Dr. Karim', specialty: 'Medicine', tenant_id: 'tenant-1', is_active: 1, user_id: 1 },
      ],
      visits: [],
      queue_entries: [],
    },
    queryOverride(sql, params) {
      const s = sql.toLowerCase();

      // Doctor lookup by user_id
      if (s.includes('from doctors') && s.includes('user_id = ?')) {
        return {
          first: {
            id: 1, name: 'Dr. Karim', specialty: 'Medicine',
            department: null, qualifications: null, consultation_fee: 500,
          },
        };
      }

      // Doctor lookup by id + tenant
      if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
        return {
          first: {
            id: Number(params[0]),
            name: 'Dr. Karim',
            specialty: 'Medicine',
            tenant_id: String(params[1]),
            is_active: 1,
            user_id: 1,
          },
        };
      }

      // Staff lookup
      if (s.includes('from staff')) return { first: null };

      // Last visit doctor lookup (batched IN query)
      if (s.includes('from visits') && s.includes('join doctors') && s.includes('patient_id in')) {
        // params: [tenantId, ...patientIds, tenantId]
        const patientIds = params.slice(1, -1).map(Number);
        const results: Record<string, unknown>[] = [];
        for (const pid of patientIds) {
          if (pid === 1) {
            results.push({ patient_id: 1, doctor_id: 1, doctor_name: 'Dr. Karim' });
          }
        }
        return { results };
      }

      // Settings
      if (s.includes('from settings')) return { first: null };

      // Report show appointments query (JOIN with patients)
      if (s.includes('from appointments') && s.includes('join patients') && s.includes('report_show')) {
        const doctorId = Number(params[0]);
        const tenantId = String(params[1]);
        const apptDate = String(params[2]);
        const matchedAppointments = appointments.filter(
          (a) => a.doctor_id === doctorId && a.tenant_id === tenantId && a.appt_date === apptDate && a.appointment_type === 'report_show',
        );
        return {
          results: matchedAppointments.map((a) => {
            const patient = patients.find((p) => p.id === a.patient_id);
            return {
              appointment_id: a.id,
              patient_id: a.patient_id,
              appt_date: a.appt_date,
              appt_time: a.appt_time,
              appointment_type: a.appointment_type,
              appointment_status: a.status,
              notes: a.notes,
              doctor_id: a.doctor_id,
              patient_name: patient?.name ?? 'Unknown',
              patient_code: patient?.patient_code ?? '',
              patient_mobile: patient?.mobile ?? '',
              patient_age: patient?.age ?? null,
              patient_gender: patient?.gender ?? null,
            };
          }),
        };
      }

      // Appointment lookup by id + tenant_id (review endpoint and Canonical route context)
      if (s.includes('from appointments') && s.includes('id') && s.includes('tenant_id') && !s.includes('join')) {
        const tenantFirst = s.includes('where tenant_id=?') || s.includes('where tenant_id = ?');
        const apptId = Number(params[tenantFirst ? 1 : 0]);
        const tenantId = String(params[tenantFirst ? 0 : 1]);
        const appt = appointments.find(
          (a) => Number(a.id) === apptId && a.tenant_id === tenantId,
        );
        return { first: appt ?? null };
      }

      // Last prescription for patients (batched IN query)
      if (s.includes('from prescriptions') && s.includes('patient_id') && s.includes('tenant_id') && !s.includes('limit 1') && !s.includes('max(')) {
        const tenantId = String(params[0]);
        const patientIds = Array.isArray(params[1]) ? params[1].map(Number) : params.slice(1).map(Number);
        const matched = prescriptions.filter(
          (r) => patientIds.includes(Number(r.patient_id)) && r.tenant_id === tenantId,
        );
        return { results: matched };
      }

      // Prescription items for prescriptions (batched IN query)
      if (s.includes('from prescription_items') && s.includes('prescription_id in')) {
        const rxIds = params.map(Number);
        const items = prescriptionItems.filter((i) => rxIds.includes(Number(i.prescription_id)));
        return { results: items };
      }

      // Lab order items with JOIN to lab_orders (report show endpoint)
      if (s.includes('from lab_order_items') && s.includes('join lab_orders')) {
        const tenantId = String(params[0]);
        const patientIds = Array.isArray(params[1]) ? params[1].map(Number) : params.slice(1).map(Number);
        const matchedOrders = labOrders.filter(
          (lo) => patientIds.includes(Number(lo.patient_id)) && lo.tenant_id === tenantId,
        );
        const results: Record<string, unknown>[] = [];
        for (const order of matchedOrders) {
          const items = labOrderItems.filter((loi) => loi.lab_order_id === order.id);
          for (const item of items) {
            results.push({
              patient_id: order.patient_id,
              item_id: item.id,
              test_name: item.test_name ?? 'Test',
              status: item.status,
              result: item.result,
              unit: item.unit ?? '',
              abnormal_flag: item.abnormal_flag,
              completed_at: item.completed_at,
            });
          }
        }
        return { results };
      }

      if (overrides?.queryOverride) return overrides.queryOverride(sql, params);
      return null;
    },
  });
}

// ─── Report Show Endpoint Tests ─────────────────────────────────────────────

describe('Report Show Workflow', () => {

  describe('GET /doctors/dashboard/report-show-patients', () => {

    it('returns patients with correct structure', async () => {
      const mockDB = makeReportShowMockDB();
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.patients).toBeDefined();
      expect(Array.isArray(body.patients)).toBe(true);
      expect(body.patients.length).toBeGreaterThan(0);

      const patient = body.patients[0];
      expect(patient).toHaveProperty('appointment_id');
      expect(patient).toHaveProperty('patient_id');
      expect(patient).toHaveProperty('patient_name');
      expect(patient).toHaveProperty('patient_age');
      expect(patient).toHaveProperty('patient_code');
      expect(patient).toHaveProperty('patient_mobile');
      expect(patient).toHaveProperty('validity_badge');
    });

    it('includes last prescription details', async () => {
      const mockDB = makeReportShowMockDB();
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      const body = await res.json();

      const patient1 = body.patients.find((p: any) => p.patient_id === 1);
      expect(patient1).toBeDefined();
      expect(patient1.last_prescription).toBeDefined();
      expect(patient1.last_prescription.rx_no).toBe('RX001');
      expect(patient1.last_prescription.diagnosis).toBe('Migraine');
      expect(patient1.last_prescription.chief_complaint).toBe('Headache');
      expect(patient1.last_prescription.items).toBeDefined();
      expect(patient1.last_prescription.items.length).toBeGreaterThan(0);
      expect(patient1.last_prescription.items[0].medicine_name).toBe('Paracetamol');
    });

    it('includes ordered tests (pending and completed)', async () => {
      const mockDB = makeReportShowMockDB();
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      const body = await res.json();

      const patient1 = body.patients.find((p: any) => p.patient_id === 1);
      expect(patient1).toBeDefined();
      expect(patient1.ordered_tests).toBeDefined();
      expect(Array.isArray(patient1.ordered_tests)).toBe(true);

      const pendingTest = patient1.ordered_tests.find((t: any) => t.status === 'pending');
      const completedTest = patient1.ordered_tests.find((t: any) => t.status === 'completed');
      expect(pendingTest).toBeDefined();
      expect(completedTest).toBeDefined();
    });

    it('includes completed reports with values', async () => {
      const mockDB = makeReportShowMockDB();
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      const body = await res.json();

      const patient1 = body.patients.find((p: any) => p.patient_id === 1);
      expect(patient1).toBeDefined();
      expect(patient1.completed_reports).toBeDefined();
      expect(Array.isArray(patient1.completed_reports)).toBe(true);
      expect(patient1.completed_reports.length).toBeGreaterThan(0);

      const report = patient1.completed_reports[0];
      expect(report.test_name).toBeDefined();
      expect(report.result).toBeDefined();
      expect(report.unit).toBeDefined();
    });

    it('includes correct validity badge', async () => {
      const mockDB = makeReportShowMockDB();
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      const body = await res.json();

      expect(body.patients.length).toBeGreaterThan(0);
      const patient = body.patients[0];
      expect(patient.validity_badge).toBeDefined();
      expect(['valid_report_show', 'report_show_expired']).toContain(patient.validity_badge);
    });

    it('does not mark report show valid when no issued prescription exists', async () => {
      const mockDB = makeReportShowMockDB({ prescriptions: [] });
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.patients[0].last_prescription).toBeNull();
      expect(body.patients[0].validity_badge).toBe('report_show_expired');
    });

    it('includes last_visit_doctor from the patient last visit', async () => {
      const mockDB = makeReportShowMockDB();
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      expect(res.status).toBe(200);
      const body = await res.json();

      const patient1 = body.patients.find((p: any) => p.patient_id === 1);
      expect(patient1).toBeDefined();
      expect(patient1.last_visit_doctor).toBeDefined();
      expect(patient1.last_visit_doctor).not.toBeNull();
      expect(patient1.last_visit_doctor.id).toBe(1);
      expect(patient1.last_visit_doctor.name).toBe('Dr. Karim');

      const patient2 = body.patients.find((p: any) => p.patient_id === 2);
      expect(patient2).toBeDefined();
      expect(patient2.last_visit_doctor).toBeNull();
    });

    it('requires doctor role', async () => {
      const mockDB = makeReportShowMockDB();
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'reception',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/report-show-patients?date=2026-05-26');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /doctors/dashboard/report-show/:appointmentId/review', () => {

    it('marks appointment as reviewed', async () => {
      const mockDB = makeReportShowMockDB({
        appointments: [
          {
            id: 101,
            patient_id: 1,
            appt_date: '2026-05-26',
            appointment_type: 'report_show',
            status: 'checked_in',
            doctor_id: 1,
            tenant_id: 'tenant-1',
            notes: null,
          },
        ],
      });
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/doctors/dashboard/report-show/101/review', {
        method: 'POST',
        body: { notes: 'Reviewed. All reports normal.' },
      });

      expect(res.status, await res.clone().text()).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.message).toContain('reviewed');

      // Review state changes are committed together in one D1 batch.
      const updateQuery = mockDB.queries.find(q =>
        q.sql.toLowerCase().includes('update appointments') && q.method === 'all'
      );
      expect(updateQuery).toBeDefined();
      expect(mockDB.queries.some(q =>
        q.sql.toLowerCase().includes('insert into audit_logs')
      )).toBe(true);
    });

    it('requires doctor role for review', async () => {
      const mockDB = makeReportShowMockDB({
        appointments: [
          {
            id: 101,
            patient_id: 1,
            appt_date: '2026-05-26',
            appointment_type: 'report_show',
            status: 'checked_in',
            doctor_id: 1,
            tenant_id: 'tenant-1',
            notes: null,
          },
        ],
      });
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'reception',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/doctors/dashboard/report-show/101/review', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent appointment', async () => {
      const mockDB = makeReportShowMockDB({
        appointments: [],
      });
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/doctors/dashboard/report-show/999/review', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(404);
    });

    it('does not close a normal consultation through the report-review action', async () => {
      const mockDB = makeReportShowMockDB({
        appointments: [
          {
            id: 101,
            patient_id: 1,
            appt_date: '2026-05-26',
            appointment_type: 'new_patient',
            status: 'checked_in',
            doctor_id: 1,
            tenant_id: 'tenant-1',
            notes: null,
          },
        ],
      });
      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/doctors/dashboard/report-show/101/review', {
        method: 'POST',
        body: { notes: 'Not a report-show visit' },
      });

      expect(res.status).toBe(409);
    });
  });
});

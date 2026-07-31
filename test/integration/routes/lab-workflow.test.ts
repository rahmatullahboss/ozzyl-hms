import { describe, expect, it } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import labWorkflowRoutes from '../../../src/routes/tenant/labWorkflow';

describe('lab workflow routes', () => {
  it('collects a paid sample, assigns a scanner-safe barcode, and records workflow audit queries', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_order_items loi') && s.includes('join lab_test_catalog ltc')) {
          return {
            first: {
              id: 11,
              lab_order_id: 22,
              lab_test_id: 33,
              status: 'pending',
              barcode: null,
              specimen_num: null,
              specimen_type: 'Blood',
              sample_container: 'EDTA',
              patient_id: 44,
              order_no: 'LO-000022',
              default_specimen_type: 'Blood',
              default_container: 'EDTA',
              default_department_id: 3,
              bill_id: 77,
              bill_status: 'paid',
              bill_total: 50000,
              bill_paid: 50000,
            },
          };
        }
        if (s.includes('from lab_departments') && s.includes('where id = ?')) {
          return { first: { id: Number(params[0]) } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/items/11/collect', {
      method: 'POST',
      body: { notes: 'Collected from OPD booth', department_id: 7 },
    });

    if (res.status !== 200) {
      throw new Error(await res.text());
    }
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      barcode: 'SAMPLE-000011',
      specimen_num: 'SMP-000011',
    });
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_workflow_events') && q.params.includes('sample_collected'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_order_items') && q.params.includes(7))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO audit_logs') && q.params.includes('COLLECT'))).toBe(true);
  });

  it('collects a reception-approved credit sample before payment is collected', async () => {
    const { app } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_order_items loi') && s.includes('join lab_test_catalog ltc')) {
          return {
            first: {
              id: 12,
              lab_order_id: 23,
              lab_test_id: 34,
              status: 'pending',
              barcode: null,
              specimen_num: null,
              specimen_type: 'Blood',
              sample_container: 'Plain tube',
              patient_id: 45,
              order_no: 'LO-000023',
              default_specimen_type: 'Blood',
              default_container: 'Plain tube',
              default_department_id: 3,
              bill_id: 78,
              diagnostic_billing_status: 'approved_credit',
              bill_status: 'open',
              bill_total: 800,
              bill_paid: 0,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/items/12/collect', {
      method: 'POST',
      body: { notes: 'Approved by reception for later payment' },
    });

    expect(res.status).toBe(200);
  });

  it('filters prescription-origin lab worklists to tests selected by reception', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      universalFallback: true,
    });

    const res = await app.request('/lab-workflow/worklists?stage=collection&limit=10');

    expect(res.status).toBe(200);
    const query = mockDB.queries.find((q) =>
      q.sql.includes('FROM lab_order_items loi')
      && q.sql.includes('ORDER BY')
      && q.sql.includes('loi.id ASC')
    );
    expect(query?.sql).toContain('lo.prescription_id IS NULL');
    expect(query?.sql).toContain('lab_item_bill.id IS NOT NULL');
  });

  it('acknowledges a critical value through the new acknowledgement table', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'doctor',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_order_items loi') && s.includes('loi.abnormal_flag')) {
          return {
            first: {
              id: 11,
              lab_order_id: 22,
              abnormal_flag: 'critical',
              patient_id: 44,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/critical/11/acknowledge', {
      method: 'POST',
      body: { acknowledged_to: 'Ward nurse', notes: 'Phone informed' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_critical_acknowledgements'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_workflow_events') && q.params.includes('critical_acknowledged'))).toBe(true);
  });

  it('delivers a published report and writes a delivery log entry', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_reports lr') && s.includes('where lr.id')) {
          return {
            first: {
              id: 91,
              lab_order_id: 22,
              report_status: 'published',
              delivery_status: 'pending',
              patient_id: 44,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/reports/91/deliver', {
      method: 'POST',
      body: { delivery_method: 'print', copy_count: 2, recipient_name: 'Patient party' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_report_deliveries') && q.params.includes('print'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes("delivery_status = 'delivered'"))).toBe(true);
  });

  it('stores old and new values during result correction and moves the report back to revalidation', async () => {
    let resultLookupCount = 0;

    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'hospital_admin',
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_reports lr') && s.includes('where lr.id')) {
          return {
            first: {
              id: 91,
              lab_order_id: 22,
              report_status: 'published',
              review_status: 'validated',
              patient_id: 44,
            },
          };
        }
        if (s.includes('from lab_results lr') && s.includes('where lr.id = ?')) {
          resultLookupCount += 1;
          return {
            first: {
              id: Number(params[0]),
              lab_test_id: 33,
              component_id: null,
              result_value: '5.0',
              result_numeric: 5,
              comments: null,
              normal_range: '4-8',
              critical_low: 2,
              critical_high: 10,
              gender: 'Male',
              date_of_birth: '1990-01-01',
            },
          };
        }
        if (s.includes('from lab_reference_ranges')) {
          return { first: null };
        }
        if (s.includes('select abnormal_flag') && s.includes('from lab_results')) {
          return { results: [{ abnormal_flag: 'critical' }] };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/reports/91/correct', {
      method: 'POST',
      body: {
        reason: 'Analyzer carryover confirmed',
        results: [{ result_id: 501, result_value: '12.0', comments: 'Repeat run accepted' }],
      },
    });

    expect(res.status).toBe(200);
    expect(resultLookupCount).toBe(1);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_result_corrections') && q.params.includes('Analyzer carryover confirmed'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_results') && q.params.includes('critical'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_order_items') && q.params.includes('critical'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_reports') && q.params.includes(1))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_workflow_events') && q.params.includes('result_corrected'))).toBe(true);
  });

  it('returns item workflow timeline events', async () => {
    const { app } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_order_items loi') && s.includes('left join lab_reports')) {
          return {
            first: {
              id: 11,
              lab_order_id: 22,
              patient_id: 44,
              report_id: 91,
            },
          };
        }
        if (s.includes('from lab_workflow_events')) {
          return {
            results: [{
              id: 1,
              event_type: 'sample_collected',
              event_stage: 'collection',
              lab_order_id: 22,
              lab_order_item_id: 11,
              lab_report_id: null,
              patient_id: 44,
              from_status: 'pending',
              to_status: 'collected',
              actor_user_id: 1,
              actor_role: 'laboratory',
              notes: null,
              metadata_json: '{"barcode":"SAMPLE-000011"}',
              created_at: '2026-05-18 11:00:00',
            }],
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/items/11/timeline');
    expect(res.status).toBe(200);
    const body = await res.json() as { events: Array<{ event_type: string; metadata: { barcode: string } }> };
    expect(body.events[0]).toMatchObject({
      event_type: 'sample_collected',
      metadata: { barcode: 'SAMPLE-000011' },
    });
  });

  it('lists lab departments with user counts', async () => {
    const { app } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_departments d') && s.includes('count(du.id)')) {
          return {
            results: [
              { id: 1, department_code: 'HEMATOLOGY', department_name: 'Hematology', is_active: 1, user_count: 3 },
              { id: 2, department_code: 'BIOCHEMISTRY', department_name: 'Biochemistry', is_active: 1, user_count: 2 },
            ],
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/departments');
    expect(res.status).toBe(200);
    const body = await res.json() as { departments: Array<{ department_code: string; user_count: number }> };
    expect(body.departments).toHaveLength(2);
    expect(body.departments[0]).toMatchObject({ department_code: 'HEMATOLOGY', user_count: 3 });
  });

  it('creates a new lab department', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'hospital_admin',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_departments') && s.includes('upper(?)')) {
          return { first: null };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/departments', {
      method: 'POST',
      body: { department_code: 'MICRO', department_name: 'Microbiology', tat_target_minutes: 120 },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_departments'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO audit_logs') && q.params.includes('CREATE'))).toBe(true);
  });

  it('rejects duplicate department code', async () => {
    const { app } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'hospital_admin',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_departments') && s.includes('upper(?)')) {
          return { first: { id: 1 } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/departments', {
      method: 'POST',
      body: { department_code: 'HEMATOLOGY', department_name: 'Hematology' },
    });

    expect(res.status).toBe(409);
  });

  it('records sample storage location without creating a separate sample lifecycle', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_order_items loi') && s.includes('join lab_orders lo') && s.includes('where loi.id = ?')) {
          return {
            first: {
              id: 31,
              lab_order_id: 41,
              lab_test_id: 51,
              status: 'received',
              sample_status: 'received_in_lab',
              patient_id: 61,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/items/31/storage', {
      method: 'POST',
      body: { fridge: 'F1', rack: 'R2', box: 'B3', position: 'P4', storage_condition: '2-8C', notes: 'Stored after centrifuge' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_order_items') && q.sql.includes('sample_storage_fridge') && q.params.includes('F1'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_workflow_events') && q.params.includes('sample_stored') && q.params.includes('storage'))).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT INTO audit_logs')
      && q.params.includes('UPDATE')
      && q.params.some((param) => String(param).includes('STORE_SAMPLE'))
    )).toBe(true);
  });

  it('records external sample referral through the existing workflow event trail', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_order_items loi') && s.includes('join lab_orders lo') && s.includes('where loi.id = ?')) {
          return {
            first: {
              id: 32,
              lab_order_id: 42,
              lab_test_id: 52,
              status: 'received',
              sample_status: 'received_in_lab',
              patient_id: 62,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/items/32/referral', {
      method: 'POST',
      body: {
        referral_lab_name: 'National Reference Lab',
        referral_contact: '01700000000',
        referral_tracking_no: 'REF-123',
        referral_reason: 'Specialized PCR confirmation',
        expected_return_at: '2026-07-11T10:00:00+06:00',
        notes: 'Courier handover',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ referral_status: 'sent' });
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_order_items') && q.sql.includes("sample_status = 'referred_out'") && q.params.includes('National Reference Lab'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_workflow_events') && q.params.includes('sample_referred_out') && q.params.includes('referral'))).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT INTO audit_logs')
      && q.params.includes('UPDATE')
      && q.params.some((param) => String(param).includes('REFER_SAMPLE'))
    )).toBe(true);
  });

  it('prevents storing a sample before collection/receiving', async () => {
    const { app } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'laboratory',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_order_items loi') && s.includes('join lab_orders lo') && s.includes('where loi.id = ?')) {
          return { first: { id: 33, lab_order_id: 43, lab_test_id: 53, status: 'pending', sample_status: 'pending', patient_id: 63 } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/items/33/storage', {
      method: 'POST',
      body: { fridge: 'F1' },
    });

    expect(res.status).toBe(400);
  });

  it('updates a lab department', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'hospital_admin',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_departments') && s.includes('where id = ?') && !s.includes('count')) {
          return { first: { id: 1, department_code: 'HEMATOLOGY', department_name: 'Hematology' } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/departments/1', {
      method: 'PUT',
      body: { department_name: 'Clinical Hematology', tat_target_minutes: 90 },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_departments'))).toBe(true);
  });

  it('assigns a user to a department', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'hospital_admin',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_departments') && s.includes('where id = ?') && !s.includes('count') && !s.includes('department_users')) {
          return { first: { id: 1, department_name: 'Hematology' } };
        }
        if (s.includes('from lab_department_users') && s.includes('department_id = ?') && s.includes('user_id = ?')) {
          return { first: null };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/departments/1/users', {
      method: 'POST',
      body: { user_id: 5, workflow_role: 'lab_technician', can_collect: 1, can_deliver: 1 },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_department_users'))).toBe(true);
  });

  it('removes a user from a department', async () => {
    const { app, mockDB } = createTestApp({
      route: labWorkflowRoutes,
      routePath: '/lab-workflow',
      role: 'hospital_admin',
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_departments') && s.includes('where id = ?') && !s.includes('count')) {
          return { first: { id: 1 } };
        }
        if (s.includes('delete from lab_department_users')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab-workflow/departments/1/users/5', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.includes('DELETE FROM lab_department_users'))).toBe(true);
  });
});

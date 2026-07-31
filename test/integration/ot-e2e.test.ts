import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from './helpers/test-app';

/**
 * E2E Integration Tests for OT Module
 *
 * Tests the complete OT workflow from booking creation to billing posting
 * with commission calculation. Uses a shared mock DB that tracks all
 * operations to verify the full lifecycle.
 */

function makeE2EApp() {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;

  // In-memory state to simulate DB
  const state = {
    rooms: [{ id: 1, tenant_id: 1, name: 'OT-1', room_code: 'R1', floor: '3F', room_type: 'general', status: 'available', cleaning_duration_minutes: 30, sterilization_duration_minutes: 45, is_active: 1 }],
    bookings: [] as Record<string, unknown>[],
    clearance: [] as Record<string, unknown>[],
    consents: [] as Record<string, unknown>[],
    vitals: [] as Record<string, unknown>[],
    safetyChecklist: [] as Record<string, unknown>[],
    anesthesia: [] as Record<string, unknown>[],
    inventory: [] as Record<string, unknown>[],
    bills: [] as Record<string, unknown>[],
    billItems: [] as Record<string, unknown>[],
    commissions: [] as Record<string, unknown>[],
    recovery: [] as Record<string, unknown>[],
    audit: [] as Record<string, unknown>[],
    commissionRules: [
      { id: 1, role: 'chief_surgeon', rule_type: 'percentage_of_surgery', amount: 0, percent: 15, procedure_id: null, department_id: null, doctor_id: null, include_emergency_surcharge: 0, priority: 10 },
      { id: 2, role: 'anesthetist', rule_type: 'fixed_amount', amount: 3000, percent: 0, procedure_id: null, department_id: null, doctor_id: null, include_emergency_surcharge: 0, priority: 10 },
    ],
  };

  const app = createTestApp({
    route: otRoutes,
    routePath: '/ot',
    role: 'hospital_admin',
    tenantId: '1',
    userId: 1,
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      calls.push({ sql, params: params as unknown[] });

      // ─── Patients ───
      if (s.includes('from patients')) {
        const patientId = params[0];
        return { first: { id: patientId, tenant_id: 1 }, results: [{ id: patientId, tenant_id: 1 }], success: true, meta: {} };
      }

      // ─── Rooms ───
      if (s.includes('insert into ot_rooms')) {
        const id = nextId++;
        state.rooms.push({ id, tenant_id: 1, ...Object.fromEntries(params.map((p, i) => [`col${i}`, p])) });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_rooms') && s.includes('and id = ?')) {
        const id = params[params.length - 1];
        const room = state.rooms.find(r => r.id === id) ?? null;
        return { first: room, results: room ? [room] : [], success: true, meta: {} };
      }
      if (s.includes('from ot_rooms')) {
        return { first: null, results: state.rooms.filter(r => r.is_active), success: true, meta: {} };
      }
      if (s.startsWith('update ot_rooms set is_active = 0')) {
        const id = params[0];
        const room = state.rooms.find(r => r.id === id);
        if (room) room.is_active = 0;
        return { first: room ?? null, results: room ? [room] : [], success: true, meta: {} };
      }

      // ─── Bookings ───
      if (s.includes('insert into ot_bookings')) {
        const id = nextId++;
        const booking = {
          id,
          tenant_id: params[0],
          patient_id: params[1],
          visit_id: params[2] ?? null,
          booked_for_date: params[3],
          is_emergency: params[4] ?? 0,
          operation_status: 'scheduled',
          is_active: 1,
        };
        state.bookings.push(booking);
        return { first: { id }, results: [{ id }], success: true, meta: { last_row_id: id } };
      }
      if (s.includes('from ot_bookings') && s.includes('and id = ?') && !s.includes('clearance') && !s.includes('consent') && !s.includes('vital') && !s.includes('anesthesia') && !s.includes('inventory') && !s.includes('audit') && !s.includes('safety')) {
        const id = params.find(p => typeof p === 'number') ?? params[0];
        const booking = state.bookings.find(b => b.id === id) ?? null;
        return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
      }
      if (s.includes('from ot_bookings') && !s.includes('clearance') && !s.includes('consent')) {
        return { first: null, results: state.bookings.filter(b => b.is_active), success: true, meta: {} };
      }

      // ─── Clearance ───
      if (s.includes('insert into ot_clearance_checks')) {
        const id = nextId++;
        state.clearance.push({ id, tenant_id: params[0], booking_id: params[1], check_type: params[2], status: 'pending' });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_clearance_checks')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.clearance.filter(c => c.booking_id === bookingId), success: true, meta: {} };
      }
      if (s.startsWith('update ot_clearance_checks')) {
        const id = params[params.length - 2];
        const check = state.clearance.find(c => c.id === id);
        if (check) check.status = params.find(p => typeof p === 'string' && ['pending','done','rejected','waived','not_required'].includes(p)) ?? check.status;
        return { first: check ?? null, results: check ? [check] : [], success: true, meta: {} };
      }

      // ─── Consents ───
      if (s.includes('insert into ot_consents')) {
        const id = nextId++;
        state.consents.push({ id, tenant_id: 1, booking_id: params[0], consent_type: params[1], status: 'pending' });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_consents')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.consents.filter(c => c.booking_id === bookingId), success: true, meta: {} };
      }
      if (s.startsWith('update ot_consents')) {
        const id = params[0];
        const consent = state.consents.find(c => c.id === id);
        if (consent) consent.status = params.find(p => typeof p === 'string' && ['not_required','pending','uploaded','signed','verified','rejected'].includes(p)) ?? consent.status;
        return { first: consent ?? null, results: consent ? [consent] : [], success: true, meta: {} };
      }

      // ─── Vitals ───
      if (s.includes('insert into clinical_vitals')) {
        const id = nextId++;
        state.vitals.push({ id, tenant_id: 1, patient_id: params[0], visit_id: params[1], pulse: params[2], taken_at: new Date().toISOString() });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from clinical_vitals')) {
        return { first: state.vitals[0] ?? null, results: state.vitals, success: true, meta: {} };
      }

      // ─── Safety Checklist ───
      if (s.includes('insert into ot_safety_checklists')) {
        const id = nextId++;
        state.safetyChecklist.push({ id, tenant_id: 1, booking_id: params[0], section: params[1], item_name: params[2], item_value: params[3] ?? 0 });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_safety_checklists')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.safetyChecklist.filter(i => i.booking_id === bookingId), success: true, meta: {} };
      }
      if (s.startsWith('update ot_safety_checklists')) {
        const id = params[0];
        const item = state.safetyChecklist.find(i => i.id === id);
        if (item) item.item_value = params.find(p => typeof p === 'number' && p <= 1) ?? item.item_value;
        return { first: item ?? null, results: item ? [item] : [], success: true, meta: {} };
      }

      // ─── Anesthesia ───
      if (s.includes('insert into ot_anesthesia_logs')) {
        const id = nextId++;
        state.anesthesia.push({ id, tenant_id: 1, booking_id: params[0], anesthesia_type: params[1] });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_anesthesia_logs')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.anesthesia.filter(a => a.booking_id === bookingId), success: true, meta: {} };
      }

      // ─── Inventory ───
      if (s.includes('insert into ot_inventory_consumptions')) {
        const id = nextId++;
        state.inventory.push({ id, tenant_id: 1, booking_id: params[0], item_id: params[1], status: 'issued' });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_inventory_consumptions')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.inventory.filter(i => i.booking_id === bookingId), success: true, meta: {} };
      }
      if (s.startsWith('update ot_inventory_consumptions')) {
        const id = params[0];
        const item = state.inventory.find(i => i.id === id);
        if (item) item.status = params.find(p => typeof p === 'string' && ['issued','used','returned','wasted','billed','cancelled'].includes(p)) ?? item.status;
        return { first: item ?? null, results: item ? [item] : [], success: true, meta: {} };
      }

      // ─── Bills ───
      if (s.includes('insert into ot_bills')) {
        const id = nextId++;
        state.bills.push({ id, tenant_id: params[0], booking_id: params[1], patient_id: params[2], status: 'draft', gross_amount: 0, discount_amount: 0, net_amount: 0 });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_bills') && s.includes('and id = ?')) {
        const id = params.find(p => typeof p === 'number') ?? params[0];
        const bill = state.bills.find(b => b.id === id) ?? null;
        return { first: bill, results: bill ? [bill] : [], success: true, meta: {} };
      }
      if (s.includes('from ot_bills')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        const bill = state.bills.find(b => b.booking_id === bookingId) ?? null;
        return { first: bill, results: bill ? [bill] : [], success: true, meta: {} };
      }
      if (s.startsWith('update ot_bills')) {
        const id = params[params.length - 2];
        const bill = state.bills.find(b => b.id === id);
        if (bill) {
          const status = params.find(p => typeof p === 'string' && ['draft','pending_review','posted','locked','cancelled'].includes(p));
          if (status) bill.status = status;
        }
        return { first: bill ?? null, results: bill ? [bill] : [], success: true, meta: {} };
      }

      // ─── Bill Items ───
      if (s.includes('insert into ot_bill_items')) {
        const id = nextId++;
        state.billItems.push({ id, tenant_id: params[0], ot_bill_id: params[1], charge_head: params[2], description: params[5], quantity: params[6], unit_price: params[7], total: params[8] });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_bill_items')) {
        const billId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.billItems.filter(i => i.ot_bill_id === billId), success: true, meta: {} };
      }

      // ─── Commission Rules ───
      if (s.includes('from ot_commission_rules')) {
        return { first: null, results: state.commissionRules.filter(r => r.is_active !== 0), success: true, meta: {} };
      }
      if (s.includes('insert into ot_commission_rules')) {
        const id = nextId++;
        state.commissionRules.push({ id, tenant_id: 1, role: params[0], rule_type: params[1], amount: params[2], percent: params[3], is_active: 1, priority: params[4] ?? 0 });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }

      // ─── Commissions ───
      if (s.includes('insert into ot_commissions')) {
        const id = nextId++;
        state.commissions.push({ id, tenant_id: 1, booking_id: params[0], ot_bill_id: params[1], doctor_id: params[2], role: params[3], commission_amount: params[4], status: 'pending' });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_commissions')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.commissions.filter(c => c.booking_id === bookingId), success: true, meta: {} };
      }

      // ─── Recovery ───
      if (s.includes('insert into ot_recovery_handovers')) {
        const id = nextId++;
        state.recovery.push({ id, tenant_id: 1, booking_id: params[0], shifted_to: params[1] });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_recovery_handovers')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: state.recovery.find(r => r.booking_id === bookingId) ?? null, results: state.recovery.filter(r => r.booking_id === bookingId), success: true, meta: {} };
      }

      // ─── Audit ───
      if (s.includes('insert into ot_audit_logs')) {
        const id = nextId++;
        state.audit.push({ id, tenant_id: params[0], booking_id: params[1], user_id: params[2], action: params[4], created_at: new Date().toISOString() });
        return { first: { id }, results: [{ id }], success: true, meta: {} };
      }
      if (s.includes('from ot_audit_logs')) {
        const bookingId = params.find(p => typeof p === 'number') ?? params[0];
        return { first: null, results: state.audit.filter(a => a.booking_id === bookingId), success: true, meta: {} };
      }

      // ─── Reports ───
      if (s.includes('count(*) as total')) return { first: { total: 1 }, results: [{ total: 1 }], success: true, meta: {} };
      if (s.includes('count(*) as count')) return { first: { count: 0 }, results: [{ count: 0 }], success: true, meta: {} };
      if (s.includes('room_name')) return { first: null, results: [{ room_name: 'OT-1', bookings: 1, utilization_pct: 100 }], success: true, meta: {} };
      if (s.includes('surgeon_name')) return { first: null, results: [], success: true, meta: {} };
      if (s.includes('surgery_type')) return { first: null, results: [], success: true, meta: {} };
      if (s.includes('gross_amount')) return { first: { total_revenue: 0, total_discount: 0, net_revenue: 0 }, results: [], success: true, meta: {} };
      if (s.includes('charge_head')) return { first: null, results: [], success: true, meta: {} };
      if (s.includes('commission_amount')) return { first: { total: 0 }, results: [], success: true, meta: {} };
      if (s.includes('total_items')) return { first: { total_items: 0, total_value: 0 }, results: [], success: true, meta: {} };
      if (s.includes('source')) return { first: null, results: [], success: true, meta: {} };
      if (s.includes('wasted')) return { first: { items: 0, value: 0 }, results: [], success: true, meta: {} };
      if (s.includes('returned')) return { first: { items: 0, value: 0 }, results: [], success: true, meta: {} };
      if (s.includes('actual_end')) return { first: { avg_duration: 0 }, results: [], success: true, meta: {} };
      if (s.includes('cleaning_duration')) return { first: { avg_duration: 30 }, results: [], success: true, meta: {} };
      if (s.includes('reason')) return { first: null, results: [], success: true, meta: {} };

      return { first: null, results: [], success: true, meta: {} };
    },
  });

  return { ...app, calls, state };
}

describe('OT E2E: Full Workflow', () => {
  it('completes the full OT lifecycle: booking → clearance → vitals → surgery → billing → recovery', async () => {
    const { app, calls, state } = makeE2EApp();

    // ─── Step 1: Verify rooms exist ───
    const roomsRes = await jsonRequest(app, '/ot/rooms');
    expect(roomsRes.status).toBe(200);
    const roomsBody = await roomsRes.json() as { rooms: Array<{ name: string }> };
    expect(roomsBody.rooms.length).toBe(1);
    expect(roomsBody.rooms[0].name).toBe('OT-1');

    // ─── Step 2: Create a booking ───
    const bookingRes = await jsonRequest(app, '/ot/bookings', {
      method: 'POST',
      body: {
        patient_id: 100,
        booked_for_date: '2026-06-05',
        surgery_type: 'Appendectomy',
        diagnosis: 'Acute appendicitis',
        team: [
          { staff_id: 1, role_type: 'surgeon' },
          { staff_id: 3, role_type: 'anesthetist' },
        ],
      },
    });
    expect(bookingRes.status).toBe(201);
    const bookingBody = await bookingRes.json() as { id: number };
    const bookingId = bookingBody.id;
    expect(bookingId).toBeGreaterThan(0);

    // ─── Step 3: Add clearance checks ───
    const clearanceTypes = ['surgery_consent', 'anesthesia_consent', 'anesthesia_fitness', 'lab_reports', 'npo_fasting'];
    for (const checkType of clearanceTypes) {
      const res = await jsonRequest(app, `/ot/bookings/${bookingId}/clearance`, {
        method: 'POST',
        body: { check_type: checkType, is_required: 1 },
      });
      expect(res.status).toBe(201);
    }

    // Verify clearance list
    const clearanceRes = await jsonRequest(app, `/ot/bookings/${bookingId}/clearance`);
    expect(clearanceRes.status).toBe(200);
    const clearanceBody = await clearanceRes.json() as { checks: Array<{ check_type: string; status: string }> };
    expect(clearanceBody.checks.length).toBe(5);
    expect(clearanceBody.checks.every(c => c.status === 'pending')).toBe(true);

    // ─── Step 4: Mark clearances as done ───
    for (const check of clearanceBody.checks) {
      const checkId = (check as { id: number }).id;
      const res = await jsonRequest(app, `/ot/clearance/${checkId}`, {
        method: 'PUT',
        body: { status: 'done' },
      });
      expect(res.status).toBe(200);
    }

    // ─── Step 5: Add consent ───
    const consentRes = await jsonRequest(app, `/ot/bookings/${bookingId}/consents`, {
      method: 'POST',
      body: { consent_type: 'general_surgery', guardian_name: 'Rahim', guardian_relation: 'Father' },
    });
    expect(consentRes.status).toBe(201);

    // ─── Step 6: Record pre-op vitals ───
    const vitalsRes = await jsonRequest(app, `/ot/bookings/${bookingId}/vitals`, {
      method: 'POST',
      body: { pulse: 72, blood_pressure_systolic: 120, blood_pressure_diastolic: 80, spo2: 98, temperature: 98.6 },
    });
    expect(vitalsRes.status).toBe(201);

    // ─── Step 7: Check safety checklist ───
    const safetyRes = await jsonRequest(app, `/ot/bookings/${bookingId}/safety-checklist`, {
      method: 'POST',
      body: { section: 'sign_in', item_name: 'Patient identity confirmed', item_value: 1 },
    });
    expect(safetyRes.status).toBe(201);

    // ─── Step 8: Record anesthesia ───
    const anesthesiaRes = await jsonRequest(app, `/ot/bookings/${bookingId}/anesthesia`, {
      method: 'POST',
      body: { anesthesia_type: 'general', airway_method: 'ETT', drugs: 'Propofol, Sevoflurane' },
    });
    expect(anesthesiaRes.status).toBe(201);

    // ─── Step 9: Add inventory consumption ───
    const inventoryRes = await jsonRequest(app, `/ot/bookings/${bookingId}/inventory`, {
      method: 'POST',
      body: { item_id: 10, qty_issued: 2, unit_price: 150, source: 'ot_sub_store' },
    });
    expect(inventoryRes.status).toBe(201);

    // ─── Step 10: Create bill ───
    const billRes = await jsonRequest(app, `/ot/bookings/${bookingId}/bill`, { method: 'POST' });
    expect(billRes.status).toBe(201);
    const billBody = await billRes.json() as { id: number };
    const billId = billBody.id;

    // ─── Step 11: Add bill items ───
    const billItems = [
      { charge_head: 'ot_room', description: 'OT Room 1 — 2 hours', quantity: 2, unit_price: 2000 },
      { charge_head: 'surgery', description: 'Appendectomy', quantity: 1, unit_price: 15000, doctor_id: 1, is_commissionable: 1 },
      { charge_head: 'anesthesia', description: 'General anesthesia', quantity: 1, unit_price: 5000, doctor_id: 3, is_commissionable: 1 },
      { charge_head: 'consumables', description: 'Sutures and supplies', quantity: 1, unit_price: 1500 },
    ];
    for (const item of billItems) {
      const res = await jsonRequest(app, `/ot/bills/${billId}/items`, {
        method: 'POST',
        body: item,
      });
      expect(res.status).toBe(201);
    }

    // ─── Step 12: Post bill (should auto-calculate commissions) ───
    const postRes = await jsonRequest(app, `/ot/bills/${billId}`, {
      method: 'PUT',
      body: { status: 'posted' },
    });
    expect(postRes.status).toBe(200);

    // ─── Step 13: Create recovery handover ───
    const recoveryRes = await jsonRequest(app, `/ot/bookings/${bookingId}/recovery`, {
      method: 'POST',
      body: { shifted_to: 'recovery', shift_time: '2026-06-05 13:00:00', consciousness_level: 'conscious', bp: '120/80', pulse: 78, spo2: 98 },
    });
    expect(recoveryRes.status).toBe(201);

    // ─── Step 14: Create audit log ───
    const auditRes = await jsonRequest(app, `/ot/bookings/${bookingId}/audit`, {
      method: 'POST',
      body: { action: 'case_completed', entity_type: 'ot_booking', reason: 'Surgery completed successfully' },
    });
    expect(auditRes.status).toBe(201);

    // ─── Step 15: Verify audit trail ───
    const auditListRes = await jsonRequest(app, `/ot/bookings/${bookingId}/audit`);
    expect(auditListRes.status).toBe(200);
    const auditBody = await auditListRes.json() as { logs: Array<{ action: string }> };
    expect(auditBody.logs.length).toBeGreaterThan(0);
    expect(auditBody.logs.some(a => a.action === 'case_completed')).toBe(true);

    // ─── Step 16: Generate daily report ───
    const reportRes = await jsonRequest(app, '/ot/reports/daily?date=2026-06-05');
    expect(reportRes.status).toBe(200);
    const reportBody = await reportRes.json() as { report: { date: string; total_scheduled: number } };
    expect(reportBody.report.date).toBe('2026-06-05');

    // ─── Verify state ───
    expect(state.bookings.length).toBe(1);
    expect(state.clearance.length).toBe(5);
    expect(state.consents.length).toBe(1);
    expect(state.vitals.length).toBe(1);
    expect(state.safetyChecklist.length).toBe(1);
    expect(state.anesthesia.length).toBe(1);
    expect(state.inventory.length).toBe(1);
    expect(state.bills.length).toBe(1);
    expect(state.billItems.length).toBe(4);
    expect(state.recovery.length).toBe(1);
    expect(state.audit.length).toBe(1);
  });

  it('handles emergency OT booking flow', async () => {
    const { app, state } = makeE2EApp();

    // Create emergency booking
    const res = await jsonRequest(app, '/ot/bookings', {
      method: 'POST',
      body: {
        patient_id: 200,
        booked_for_date: '2026-06-05',
        is_emergency: 1,
        surgery_type: 'Laparotomy',
        diagnosis: 'Peritonitis',
        remarks: 'EMERGENCY: Patient in septic shock',
      },
    });
    expect(res.status).toBe(201);

    // Verify booking was created with emergency flag
    expect(state.bookings.length).toBe(1);
    expect(state.bookings[0].is_emergency).toBe(1);
  });

  it('handles commission rules CRUD', async () => {
    const { app, state } = makeE2EApp();

    // List existing rules
    const listRes = await jsonRequest(app, '/ot/commission-rules');
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { rules: Array<{ role: string }> };
    expect(listBody.rules.length).toBe(2);

    // Add a new rule
    const createRes = await jsonRequest(app, '/ot/commission-rules', {
      method: 'POST',
      body: { role: 'assistant_surgeon', rule_type: 'percentage_of_surgery', percent: 10, priority: 5 },
    });
    expect(createRes.status).toBe(201);
    expect(state.commissionRules.length).toBe(3);
  });

  it('handles OT settings CRUD', async () => {
    const { app } = makeE2EApp();

    // Get settings (returns defaults when none exist)
    const getRes = await jsonRequest(app, '/ot/settings');
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { settings: { default_cleaning_minutes: number; hard_block_on_consent: number } };
    expect(getBody.settings.default_cleaning_minutes).toBe(30);
    expect(getBody.settings.hard_block_on_consent).toBe(1);

    // Update settings
    const updateRes = await jsonRequest(app, '/ot/settings', {
      method: 'PUT',
      body: { default_cleaning_minutes: 45, hard_block_on_payment: 1 },
    });
    expect(updateRes.status).toBe(200);
  });

  it('generates all report types', async () => {
    const { app } = makeE2EApp();

    // Daily report
    const dailyRes = await jsonRequest(app, '/ot/reports/daily?date=2026-06-05');
    expect(dailyRes.status).toBe(200);
    const dailyBody = await dailyRes.json() as { report: { date: string } };
    expect(dailyBody.report.date).toBe('2026-06-05');

    // Financial report
    const financialRes = await jsonRequest(app, '/ot/reports/financial?from=2026-06-01&to=2026-06-30');
    expect(financialRes.status).toBe(200);

    // Inventory report
    const inventoryRes = await jsonRequest(app, '/ot/reports/inventory?from=2026-06-01&to=2026-06-30');
    expect(inventoryRes.status).toBe(200);

    // Utilization report
    const utilizationRes = await jsonRequest(app, '/ot/reports/utilization?from=2026-06-01&to=2026-06-30');
    expect(utilizationRes.status).toBe(200);
  });

  it('validates all report endpoints require date parameters', async () => {
    const { app } = makeE2EApp();

    // Daily report without date
    const dailyRes = await jsonRequest(app, '/ot/reports/daily');
    expect(dailyRes.status).toBe(400);

    // Financial report without from/to
    const financialRes = await jsonRequest(app, '/ot/reports/financial');
    expect(financialRes.status).toBe(400);

    // Inventory report without from/to
    const inventoryRes = await jsonRequest(app, '/ot/reports/inventory');
    expect(inventoryRes.status).toBe(400);

    // Utilization report without from/to
    const utilizationRes = await jsonRequest(app, '/ot/reports/utilization');
    expect(utilizationRes.status).toBe(400);
  });
});

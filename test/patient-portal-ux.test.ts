import { describe, expect, it } from 'vitest';
import {
  normalizePatientAiPlannerPayload,
  buildPatientSyncedAppointmentStatus,
  buildPatientAppointmentMvpState,
  buildPatientAppointmentBookingGuard,
  buildPatientPrescriptionActionState,
  formatPatientDateMonthYear,
  formatPatientDateTimeMonthYear,
  buildPatientGuidanceChecklist,
  buildPatientGuidanceMetrics,
  buildPatientDailyUtilitySnapshot,
  buildPatientReportExplainerCard,
  buildPatientWeeklyCheckInStreak,
  getPatientGuidanceBadge,
  buildPatientGlobalHealthPath,
  buildPatientTenantPortalPath,
  LEGACY_PATIENT_PORTAL_REDIRECT_PATH,
  PATIENT_DASHBOARD_ASSURANCE,
  PATIENT_LOGIN_ASSURANCE_BODY,
  PATIENT_LOGIN_ASSURANCE_TITLE,
  PATIENT_SELECTED_HOSPITAL_STORAGE_KEY,
  PATIENT_PORTAL_SECTIONS,
  getPatientQuickActionKeys,
  normalizePatientDashboardPayload,
  normalizePatientHospitalRecordSnapshot,
  normalizePatientClinicalDataForDisplay,
  buildSelectedHospitalCareOverview,
  isPatientVisiblePrescription,
  isPatientVisibleLabResult,
  normalizePatientLiveVisitSummary,
} from '../web/src/lib/patientPortalUx';

describe('patient portal ux helpers', () => {
  it('preserves patient guidance when normalizing dashboard payload', () => {
    const normalized = normalizePatientDashboardPayload({
      hospitalsCount: 2,
      appointments: [],
      prescriptions: [],
      reports: [{ id: 9, status: 'released', test_names: 'CBC' }],
      bills: [],
      patient_guidance: {
        headline: 'Follow-up recommended',
        status: 'watch',
        summary: 'You have pending review items.',
        what_changed: ['One item was added'],
        next_steps: ['Review your new entry'],
        trust_notes: ['Doctor review pending'],
        care_reminders: ['Carry a visit pass before your next visit'],
        counts: {
          pending_review_items: 1,
          verified_items: 3,
          vault_documents: 2,
          active_visit_pass: 0,
        },
      },
    });

    expect(normalized.patient_guidance?.headline).toBe('Follow-up recommended');
    expect(normalized.patient_guidance?.counts.pending_review_items).toBe(1);
    expect(normalized.patient_guidance?.what_changed).toEqual(['One item was added']);
    expect(normalized.reports[0]?.test_names).toBe('CBC');
    expect(normalized.labResults[0]?.id).toBe(9);
  });

  it('builds an actionable checklist from guidance content', () => {
    const checklist = buildPatientGuidanceChecklist({
      headline: 'Follow-up recommended',
      status: 'watch',
      summary: 'You have pending review items.',
      what_changed: ['One item was added'],
      next_steps: ['Review your new entry', 'Upload your latest prescription'],
      trust_notes: ['Doctor review pending'],
      care_reminders: ['Create a visit pass before your next visit'],
      counts: {
        pending_review_items: 1,
        verified_items: 3,
        vault_documents: 2,
        active_visit_pass: 0,
      },
    });

    expect(checklist).toEqual([
      'Review your new entry',
      'Upload your latest prescription',
      'Create a visit pass before your next visit',
    ]);
  });

  it('hides misleading record metrics when every value is zero', () => {
    const metrics = buildPatientGuidanceMetrics({
      pendingReviewItems: 0,
      verifiedItems: 0,
      vaultDocuments: 0,
      hospitalsCount: 0,
    });

    expect(metrics).toEqual([]);
  });

  it('formats patient-visible dates as date-month-year everywhere', () => {
    expect(formatPatientDateMonthYear('2026-06-20')).toBe('20-06-2026');
    expect(formatPatientDateMonthYear('2026-01-05T13:45:00Z')).toBe('05-01-2026');
    expect(formatPatientDateTimeMonthYear('2026-01-05T13:45:00Z')).toMatch(/^05-01-2026 /);
    expect(formatPatientDateMonthYear(null)).toBe('—');
    expect(formatPatientDateMonthYear('not-a-date')).toBe('not-a-date');
  });

  it('builds prescription action state with safe detail, refill, pdf, and follow-up paths', () => {
    const state = buildPatientPrescriptionActionState({
      id: 55,
      rx_no: 'RX-55',
      doctor_name: 'Dr Karim',
      created_at: '2026-06-20',
      follow_up_date: '2026-07-02',
      diagnosis: 'Follow-up diagnosis',
      advice: 'Take rest',
    });

    expect(state.title).toBe('RX-55');
    expect(state.doctorLabel).toBe('Dr Karim');
    expect(state.dateLabel).toBe('20-06-2026');
    expect(state.followUpLabel).toBe('02-07-2026');
    expect(state.canRequestRefill).toBe(true);
    expect(state.detailPath).toBe('/api/patient-portal/prescriptions/55');
    expect(state.itemsPath).toBe('/api/patient-portal/prescriptions/55/items');
    expect(state.pdfPath).toBe('/api/patient-portal/prescriptions/55/pdf');
    expect(state.shareText).toContain('RX-55');
  });

  it('creates a meaningful badge for actionable watch guidance', () => {
    expect(getPatientGuidanceBadge('attention', 2)).toBe('Needs action');
    expect(getPatientGuidanceBadge('watch', 2)).toBe('2 tasks to finish');
    expect(getPatientGuidanceBadge('stable', 0)).toBe('All set');
  });

  it('builds an appointment booking guard from booked slots before submit', () => {
    const guard = buildPatientAppointmentBookingGuard({
      doctorId: 10,
      date: '2099-04-20',
      bookedCount: 2,
      bookedSlots: [
        { appt_time: '09:00', token_no: 1 },
        { appt_time: '10:30:00', token_no: 2 },
      ],
    }, '10:30');

    expect(guard.hasDate).toBe(true);
    expect(guard.bookedCount).toBe(2);
    expect(guard.bookedTimes).toEqual(['09:00', '10:30']);
    expect(guard.isSelectedTimeBooked).toBe(true);
    expect(guard.canSubmit).toBe(false);
    expect(guard.message).toContain('already booked');

    const freeGuard = buildPatientAppointmentBookingGuard({
      doctorId: 10,
      date: '2099-04-20',
      bookedSlots: [{ appt_time: '09:00' }],
    }, '11:00');

    expect(freeGuard.isSelectedTimeBooked).toBe(false);
    expect(freeGuard.canSubmit).toBe(true);
    expect(freeGuard.message).toContain('available');

    const backendContractGuard = buildPatientAppointmentBookingGuard({
      doctorId: 10,
      date: '2099-04-20',
      bookedTimes: ['14:00'],
    }, '14:00:00');

    expect(backendContractGuard.bookedTimes).toEqual(['14:00']);
    expect(backendContractGuard.isSelectedTimeBooked).toBe(true);
    expect(backendContractGuard.canSubmit).toBe(false);

    const generatedSlotGuard = buildPatientAppointmentBookingGuard({
      doctorId: 10,
      date: '2099-04-20',
      hasSchedule: true,
      availableSlots: [{ time: '15:00', label: '15:00 · Room 2' }],
    }, '16:00');

    expect(generatedSlotGuard.availableTimes).toEqual(['15:00']);
    expect(generatedSlotGuard.hasGeneratedSlots).toBe(true);
    expect(generatedSlotGuard.canSubmit).toBe(false);
    expect(generatedSlotGuard.message).toContain('available slot');

    const matchingGeneratedSlotGuard = buildPatientAppointmentBookingGuard({
      doctorId: 10,
      date: '2099-04-20',
      hasSchedule: true,
      availableSlots: [{ time: '15:00', label: '15:00 · Room 2' }],
    }, '15:00');

    expect(matchingGeneratedSlotGuard.canSubmit).toBe(true);
    expect(matchingGeneratedSlotGuard.message).toContain('available');
  });

  it('builds appointment MVP state for detail, cancel, reschedule, and queue context', () => {
    const upcoming = buildPatientAppointmentMvpState({
      id: 77,
      doctor_name: 'Dr Rahman',
      department_name: 'Medicine',
      appt_date: '2099-03-14',
      appt_time: '10:30',
      status: 'confirmed',
      chief_complaint: 'Follow-up',
      live_token_no: 'A012',
      live_counter_no: 'Room 2',
      live_estimated_wait_minutes: 18,
    });

    expect(upcoming.title).toBe('Dr Rahman');
    expect(upcoming.subtitle).toContain('Medicine');
    expect(upcoming.status.label).toBe('Confirmed');
    expect(upcoming.canCancel).toBe(true);
    expect(upcoming.reschedule.enabled).toBe(false);
    expect(upcoming.reschedule.label).toContain('coming soon');
    expect(upcoming.queue.token).toBe('A012');
    expect(upcoming.queue.counter).toBe('Room 2');
    expect(upcoming.queue.estimatedWaitMinutes).toBe(18);

    const completed = buildPatientAppointmentMvpState({
      id: 78,
      doctor_name: 'Dr Old',
      appt_date: '2024-01-01',
      status: 'completed',
    });

    expect(completed.canCancel).toBe(false);
    expect(completed.status.label).toBe('Completed');
  });

  it('builds a daily utility snapshot from patient activity loops', () => {
    const utility = buildPatientDailyUtilitySnapshot({
      hasSavedAiPlan: true,
      remainingAiGenerationsToday: 0,
      totalReportedEntries: 2,
      lifestyleLogCount: 1,
      vitalsLogCount: 0,
      hasRecentLifestyleLog: true,
      hasRecentVitalsLog: false,
      prescriptionsCount: 1,
      vaultDocumentCount: 3,
    });

    expect(utility.completedLoops).toBe(3);
    expect(utility.hasAiPlan).toBe(true);
    expect(utility.hasRecentCheckIn).toBe(true);
    expect(utility.hasMedicationContext).toBe(true);
    expect(utility.hasRecordContext).toBe(true);
    expect(utility.weeklyCheckInStreak).toBe(0);
  });

  it('marks missing daily utility loops when patient has not started them yet', () => {
    const utility = buildPatientDailyUtilitySnapshot({
      hasSavedAiPlan: false,
      remainingAiGenerationsToday: 1,
      totalReportedEntries: 0,
      lifestyleLogCount: 0,
      vitalsLogCount: 0,
      hasRecentLifestyleLog: false,
      hasRecentVitalsLog: false,
      prescriptionsCount: 0,
      vaultDocumentCount: 0,
    });

    expect(utility.completedLoops).toBe(0);
    expect(utility.hasAiPlan).toBe(false);
    expect(utility.hasRecentCheckIn).toBe(false);
    expect(utility.hasMedicationContext).toBe(false);
    expect(utility.hasRecordContext).toBe(false);
  });

  it('builds a simple consecutive streak from recent check-in dates', () => {
    const streak = buildPatientWeeklyCheckInStreak([
      '2026-04-13',
      '2026-04-12',
      '2026-04-11',
      '2026-04-09',
    ]);

    expect(streak).toBe(3);
  });

  it('builds a plain-language report explainer card from the latest AI plan snapshot', () => {
    const card = buildPatientReportExplainerCard({
      latestPlan: {
        id: 1,
        headline: 'Focus on blood sugar stability',
        summary: 'This report suggests you should keep your meal timing and movement consistent.',
        confidence: 'medium',
        created_at: '2026-04-13T08:00:00Z',
        completed_items: [],
        completion_percent: 0,
        plan: {
          focus_areas: ['Blood sugar is the main thing to watch this week.'],
          action_checklist: ['Walk for 15 minutes after dinner.'],
          eat_more: [],
          avoid_or_reduce: [],
          daily_routine: [],
          exercise_plan: [],
          follow_up_actions: ['Repeat the test if your doctor asks for follow-up.'],
          warning_signs: ['See a doctor early if dizziness or severe weakness continues.'],
          doctor_consultation_advice: [],
          data_gaps: [],
          disclaimer: 'Talk to your doctor.',
        },
        source_snapshot: {
          vault_documents: [{ title: 'HbA1c report', document_type: 'lab_report' }],
        },
      },
    });

    expect(card?.title).toBe('HbA1c report');
    expect(card?.documentType).toBe('lab_report');
    expect(card?.badge).toBe('Lab report');
    expect(card?.nextStep).toContain('Repeat the test');
    expect(card?.warning).toContain('See a doctor');
    expect(card?.foodHint).toContain('rice');
  });

  it('preserves wellness tracker adherence in normalized ai planner payloads', () => {
    const payload = normalizePatientAiPlannerPayload({
      latest_plan: {
        id: 4,
        headline: 'Stay consistent this week',
        summary: 'Your plan now uses how well you are following reminders.',
        confidence: 'medium',
        created_at: '2026-04-13T08:00:00Z',
        completed_items: ['Walk after dinner'],
        completion_percent: 50,
        plan: {
          focus_areas: ['Consistency'],
          action_checklist: ['Walk after dinner', 'Take evening medicine'],
          eat_more: [],
          avoid_or_reduce: [],
          daily_routine: [],
          exercise_plan: [],
          follow_up_actions: [],
          warning_signs: [],
          doctor_consultation_advice: [],
          data_gaps: [],
        },
        source_snapshot: {
          wellness_tracker: {
            medication_reminders: ['Evening medicine'],
            daily_routines: ['Walk after dinner'],
            completed_items_today: ['Walk after dinner'],
            adherence_percent_today: 50,
            tracker_date: '2026-04-13',
          },
        },
      },
      plans: [],
      remaining_generations_today: 1,
      daily_limit: 1,
    });

    expect(payload.latestPlan?.source_snapshot?.wellness_tracker?.adherence_percent_today).toBe(50);
    expect(payload.latestPlan?.source_snapshot?.wellness_tracker?.daily_routines).toEqual(['Walk after dinner']);
  });

  it('adapts explainer messaging for prescriptions', () => {
    const card = buildPatientReportExplainerCard({
      latestPlan: {
        id: 2,
        headline: 'Medication follow-up',
        summary: 'This prescription is mainly about taking medicines on time.',
        confidence: 'medium',
        created_at: '2026-04-13T08:00:00Z',
        completed_items: [],
        completion_percent: 0,
        plan: {
          focus_areas: ['Keep medicines regular.'],
          action_checklist: ['Take the morning dose after breakfast.'],
          eat_more: [],
          avoid_or_reduce: [],
          daily_routine: [],
          exercise_plan: [],
          follow_up_actions: ['Review the medicines after 7 days.'],
          warning_signs: [],
          doctor_consultation_advice: [],
          data_gaps: [],
          disclaimer: 'Talk to your doctor.',
        },
        source_snapshot: {
          vault_documents: [{ title: 'Prescription April', document_type: 'prescription' }],
        },
      },
    });

    expect(card?.documentType).toBe('prescription');
    expect(card?.nextStep).toContain('Take the morning dose');
    expect(card?.doctorHint).toContain('pharmacist');
  });

  it('prioritizes actionable first-session quick actions', () => {
    const actions = getPatientQuickActionKeys({
      profileNeedsCompletion: true,
      hasPatientData: false,
      hasVaultDocuments: false,
      hasActiveVisitPass: false,
      hasLinkedHospitals: true,
      hasFamilyProfiles: true,
      hasOutstandingBills: true,
      hasRecentPrescriptions: true,
    });

    expect(actions[0]).toBe('complete_profile');
    expect(actions).toContain('book_appointment');
    expect(actions).toContain('review_bills');
    expect(actions).toContain('manage_prescriptions');
    expect(actions).not.toContain('manage_family');
  });

  it('filters patient-facing clinical records to safe display statuses', () => {
    const normalized = normalizePatientClinicalDataForDisplay({
      appointments: [{ id: 'a1' }],
      prescriptions: [
        { id: 1, status: 'active' },
        { id: 2, status: 'draft' },
        { id: 3, status: 'voided' },
        { id: 4, prescription_status: 'final' },
      ],
      labResults: [
        { id: 10, status: 'released' },
        { id: 11, status: 'draft' },
        { id: 12, verification_status: 'verified' },
        { id: 13, status: 'unverified' },
      ],
      bills: [{ id: 'b1' }],
    });

    expect(normalized.appointments).toHaveLength(1);
    expect(normalized.prescriptions.map((item) => item.id)).toEqual([1, 4]);
    expect(normalized.labResults.map((item) => item.id)).toEqual([10, 12]);
    expect(normalized.labs.map((item) => item.id)).toEqual([10, 12]);
    expect(normalized.bills).toHaveLength(1);
    expect(isPatientVisiblePrescription({ status: 'completed' })).toBe(true);
    expect(isPatientVisiblePrescription({ status: 'void' })).toBe(false);
    expect(isPatientVisibleLabResult({ status: 'completed' })).toBe(true);
    expect(isPatientVisibleLabResult({ status: 'pending' })).toBe(false);
  });

  it('builds selected hospital care overview from safe clinical records', () => {
    const overview = buildSelectedHospitalCareOverview({
      hospitalName: 'City Hospital',
      liveVisit: {
        status: 'waiting',
        patients_ahead: 2,
        estimated_wait_minutes: 15,
        queue: { id: 1, token_no: 'TOKEN-12', token_number: 12, status: 'waiting' },
      },
      clinicalData: {
        appointments: [
          { id: 'past', appointment_date: '2024-01-01', doctor_name: 'Old visit' },
          { id: 'next', appointment_date: '2099-01-01', doctor_name: 'Dr Future' },
        ],
        prescriptions: [
          { id: 'draft-rx', status: 'draft', created_at: '2099-01-03' },
          { id: 'final-rx', status: 'final', created_at: '2099-01-02' },
        ],
        labResults: [
          { id: 'pending-lab', status: 'pending', created_at: '2099-01-04' },
          { id: 'released-lab', status: 'released', created_at: '2099-01-05' },
        ],
        bills: [
          { id: 'paid-bill', status: 'paid', total_amount: 5000, paid_amount: 5000, bill_date: '2099-01-01' },
          { id: 'due-bill', status: 'partial', total_amount: 7000, paid_amount: 2000, bill_date: '2099-01-02' },
        ],
      },
    });

    expect(overview.hasSelectedHospital).toBe(true);
    expect(overview.liveVisit?.queue?.token_no).toBe('TOKEN-12');
    expect(overview.nextAppointment?.id).toBe('next');
    expect(overview.recentPrescription?.id).toBe('final-rx');
    expect(overview.latestLabResult?.id).toBe('released-lab');
    expect(overview.billSummary.dueCount).toBe(1);
    expect(overview.billSummary.totalDue).toBe(5000);
    expect(overview.counts.prescriptions).toBe(1);
    expect(overview.counts.labResults).toBe(1);
  });

  it('normalizes hospital service snapshots from tenant APIs', () => {
    const normalized = normalizePatientHospitalRecordSnapshot({
      selectedHospital: {
        tenantId: '12',
        hospitalName: 'City Hospital',
      },
      appointments: [{ id: 1 }],
      prescriptions: [{ id: 2 }],
      labResults: [{ id: 3 }],
      documents: [{ id: 4 }],
      diagnoses: [{ id: 5 }],
      conversations: [{ doctor_id: 6 }],
      reviews: [{ id: 7 }],
      bills: [{ id: 8, due: 100 }],
      timeline: [{ id: 9, event_type: 'appointment' }],
      refillRequests: [{ id: 10, status: 'pending' }],
    });

    expect(normalized.selectedHospital?.tenantId).toBe('12');
    expect(normalized.appointments).toHaveLength(1);
    expect(normalized.labResults).toHaveLength(1);
    expect(normalized.documents).toHaveLength(1);
    expect(normalized.conversations[0]?.doctor_id).toBe(6);
    expect(normalized.bills[0]?.due).toBe(100);
    expect(normalized.timeline[0]?.event_type).toBe('appointment');
    expect(normalized.refillRequests[0]?.status).toBe('pending');
  });

  it('normalizes live visit summaries for patient-facing queue cards', () => {
    const normalized = normalizePatientLiveVisitSummary({
      status: 'waiting',
      current_serving_token_no: 'T009',
      patients_ahead: 2,
      estimated_wait_minutes: 18,
      last_updated_at: '2026-04-11T10:07:00Z',
      next_step_label: 'Please stay ready for your token to be called.',
      arrival_guidance: {
        action: 'arrive_soon',
        label: 'Please arrive soon.',
      },
      journey: [
        { key: 'booked', state: 'done', label: 'Booked' },
        { key: 'checked_in', state: 'done', label: 'Checked in' },
        { key: 'called', state: 'upcoming', label: 'Called' },
      ],
      appointment: {
        id: 1,
        appt_date: '2026-04-11',
        appt_time: '10:30',
        doctor_name: 'Dr Ahmed',
        status: 'confirmed',
      },
      visit: {
        id: 77,
        status: 'checked-in',
        visit_date: '2026-04-11',
      },
      queue: {
        id: 99,
        token_no: 'T012',
        token_number: 12,
        status: 'waiting',
        counter_no: 'Room 3',
      },
    });

    expect(normalized?.status).toBe('waiting');
    expect(normalized?.queue?.token_no).toBe('T012');
    expect(normalized?.arrival_guidance?.action).toBe('arrive_soon');
    expect(normalized?.journey).toHaveLength(3);
    expect(normalized?.visit?.status).toBe('checked-in');
    expect(normalized?.last_updated_at).toBe('2026-04-11T10:07:00Z');
  });

  it('builds patient-facing appointment sync labels from queue and visit state', () => {
    const synced = buildPatientSyncedAppointmentStatus({
      status: 'confirmed',
      queue_status: 'called',
      live_token_no: 'T012',
      live_counter_no: 'Room 3',
      live_estimated_wait_minutes: 4,
      visit_status: 'checked-in',
    });

    expect(synced.label).toBe('Go now');
    expect(synced.tone).toBe('blue');
    expect(synced.details).toEqual(['Token T012', 'Counter Room 3', '4 min wait']);
  });

  it('normalizes patient ai planner payload for card rendering', () => {
    const normalized = normalizePatientAiPlannerPayload({
      latest_plan: {
        id: 1,
        headline: 'Focus on blood sugar stability',
        summary: 'Build a consistent meal and walking routine this week.',
        confidence: 'medium',
        plan: {
          action_checklist: ['Walk after dinner'],
          eat_more: ['Vegetables'],
          avoid_or_reduce: ['Sugary drinks'],
        },
        completed_items: ['Walk after dinner'],
        completion_percent: 100,
        source_snapshot: {
          vault_documents: [{ title: 'HbA1c report', document_type: 'lab_report' }],
          vitals: [{ blood_sugar: 10.2, logged_on: '2026-04-10' }],
          lifestyle_logs: [{ sleep_hours: 6, exercise_minutes: 10, diet_notes: 'Too much rice' }],
        },
        created_at: '2026-04-11T10:00:00Z',
      },
      plans: [
        {
          id: 1,
          headline: 'Focus on blood sugar stability',
          summary: 'Build a consistent meal and walking routine this week.',
          confidence: 'medium',
          plan: {
            action_checklist: ['Walk after dinner'],
            eat_more: ['Vegetables'],
            avoid_or_reduce: ['Sugary drinks'],
          },
          completed_items: ['Walk after dinner'],
          completion_percent: 100,
          source_snapshot: {
            vault_documents: [{ title: 'HbA1c report', document_type: 'lab_report' }],
          },
          created_at: '2026-04-11T10:00:00Z',
        },
      ],
      remaining_generations_today: 0,
      daily_limit: 1,
    });

    expect(normalized.latestPlan?.headline).toBe('Focus on blood sugar stability');
    expect(normalized.plans).toHaveLength(1);
    expect(normalized.remainingGenerationsToday).toBe(0);
    expect(normalized.dailyLimit).toBe(1);
    expect(normalized.latestPlan?.completed_items).toEqual(['Walk after dinner']);
    expect(normalized.latestPlan?.completion_percent).toBe(100);
    expect(normalized.latestPlan?.source_snapshot?.vitals?.[0]?.blood_sugar).toBe(10.2);
  });

  it('exposes unified portal sections and legacy redirect contract', () => {
    expect(LEGACY_PATIENT_PORTAL_REDIRECT_PATH).toBe('/patient/dashboard');
    expect(PATIENT_PORTAL_SECTIONS.map((section) => section.id)).toEqual([
      'overview',
      'ai-planner',
      'hospital-services',
      'global-records',
      'family',
      'vault',
      'data',
      'privacy',
    ]);
  });

  it('builds tenant patient portal API paths from the mounted backend prefix', () => {
    expect(buildPatientTenantPortalPath('/dashboard')).toBe('/api/patient-portal/dashboard');
    expect(buildPatientTenantPortalPath('/reviews/mine')).toBe('/api/patient-portal/reviews/mine');
    expect(buildPatientGlobalHealthPath('/access-log')).toBe('/api/global-health/access-log');
    expect(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY).toBe('ozzyl_patient_selected_hospital');
  });

  it('keeps patient-facing copy free of infrastructure terms', () => {
    const combined = [
      PATIENT_LOGIN_ASSURANCE_TITLE,
      PATIENT_LOGIN_ASSURANCE_BODY,
      PATIENT_DASHBOARD_ASSURANCE,
    ].join(' ').toLowerCase();

    expect(combined).not.toContain('worker');
    expect(combined).not.toContain('pages');
    expect(combined).not.toContain('landing page');
    expect(combined).not.toContain('cors');
    expect(combined).not.toContain('origin');
  });
});

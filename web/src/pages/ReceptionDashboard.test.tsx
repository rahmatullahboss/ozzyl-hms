import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  calculateAgeLabel,
  buildPatientIdentityParts,
  buildReceptionPatientIdentityText,
  buildPatientInlineLabel,
  formatTime,
  getBillServiceLabel,
  getIpdProvisionalDisplayTotal,
  getFlowTokenLabel,
  getReceptionFlowDoctorLabel,
  buildPendingConsultationEntries,
  buildReceptionPendingBillDateParam,
  buildReceptionDueCollectionDateParam,
  pendingBillSummaryToBillRecord,
  buildReceptionFlowRows,
  buildAdmittedPatientFlowRows,
  buildAdmissionFinalBillRecord,
  buildReceptionFlowDisplayRows,
  shouldIncludeAdmissionInReceptionFlow,
  shouldShowAdmissionRunningBillPrint,
  shouldShowAdmissionInvoicePrint,
  getAdmissionFlowAdmissionId,
  getAdmissionFlowPatientId,
  isAdmissionFlowRow,
  filterReceptionBillsByDate,
  filterReceptionFlowRowsByQuery,
  getNonConsultationPendingAmount,
  getAppointmentPendingAmount,
  getBillCashPaidAmount,
  getBillOutstandingAmount,
  getBillSettledAmount,
  addReceptionDateDays,
  formatReceptionFlowDate,
  summarizeReceptionBeds,
  isCompletedReceptionFlowStatus,
  sortReceptionFlowRows,
  buildReceptionAppointmentTokenPayload,
  buildCheckedInVisit,
  redirectToReceptionBillPrint,
  shouldShowServiceDepositField,
  calculateVisitServicePaymentDraft,
  isReceptionBillIpd,
  receptionDueAgeDays,
  receptionDueMatchesAgeBucket,
  buildReagentUsageWarningToast,
  buildReceptionNewPatientAgeDraft,
} from './ReceptionDashboard';

describe('ReceptionDashboard helpers', () => {
  it('builds reagent warning toast copy for billing-time stock failures', () => {
    expect(buildReagentUsageWarningToast(null)).toBeNull();
    expect(buildReagentUsageWarningToast([])).toBeNull();
    expect(buildReagentUsageWarningToast([{ itemId: 1, message: 'Insufficient CBC reagent stock' }])).toBe('Lab reagent stock warning: Insufficient CBC reagent stock');
    expect(buildReagentUsageWarningToast([{ itemId: 1, message: 'Missing mapping' }, { itemId: 2, message: 'Insufficient stock' }])).toBe('Lab reagent stock warning: 2 billed tests could not deduct reagent stock. First: Missing mapping');
  });

  it('does not mark paid appointments as pending consultation dues', () => {
    expect(getAppointmentPendingAmount({ final_fee: 800, billing_status: 'paid' }, 'paid')).toBe(0);
    expect(getAppointmentPendingAmount({ consultation_fee: 500, billing_status: 'due_approved' }, 'due_approved')).toBe(0);
  });

  it('keeps pending amount for unpaid appointments', () => {
    expect(getAppointmentPendingAmount({ final_fee: 800, billing_status: 'pending' }, 'pending')).toBe(800);
    expect(getAppointmentPendingAmount({ consultation_fee: 500, billing_status: 'partial_paid' }, 'partial_paid')).toBe(500);
  });

  it('formats stored timestamps into a visible hh:mm value', () => {
    expect(formatTime('2026-05-15 07:42:12')).toBe('07:42 AM');
    expect(formatTime('09:15:00')).toBe('09:15 AM');
    expect(formatTime('18:20:00')).toBe('06:20 PM');
    expect(formatTime('2026-05-15 18:39:00', { assumeUtc: true })).toBe('12:39 AM');
  });

  it('builds an age label from date of birth when available', () => {
    expect(calculateAgeLabel('2000-05-15')).toMatch(/^\d+y$/);
    expect(calculateAgeLabel(null)).toBeNull();
  });

  it('builds pediatric age labels from date of birth with months and days', () => {
    expect(calculateAgeLabel('2026-05-27', new Date('2026-07-03T12:00:00+06:00'))).toBe('1m 6d');
    expect(buildPatientIdentityParts({
      date_of_birth: '2025-04-03',
      mobile: '01700000000',
    }, new Date('2026-07-03T12:00:00+06:00'))).toEqual(['1y 3m', '01700000000']);
  });

  it('builds new-patient age payload from manual years months days and rejects decimals', () => {
    const referenceDate = new Date('2026-07-03T12:00:00+06:00');

    expect(buildReceptionNewPatientAgeDraft({
      age: '0',
      ageMonths: '1',
      ageDays: '6',
      dateOfBirth: '',
    }, referenceDate)).toEqual({
      ok: true,
      age: 0,
      dateOfBirth: '2026-05-27',
      ageParts: { years: 0, months: 1, days: 6 },
    });

    expect(buildReceptionNewPatientAgeDraft({
      age: '1.3',
      ageMonths: '',
      ageDays: '',
      dateOfBirth: '',
    }, referenceDate)).toMatchObject({ ok: false });

    expect(buildReceptionNewPatientAgeDraft({
      age: '0',
      ageMonths: '0',
      ageDays: '0',
      dateOfBirth: '',
    }, referenceDate)).toMatchObject({
      ok: true,
      age: 0,
      dateOfBirth: '2026-07-03',
    });
  });

  it('prefers selected DOB for new-patient age payload and sends completed years', () => {
    expect(buildReceptionNewPatientAgeDraft({
      age: '',
      ageMonths: '',
      ageDays: '',
      dateOfBirth: '2025-03-20',
    }, new Date('2026-07-03T12:00:00+06:00'))).toEqual({
      ok: true,
      age: 1,
      dateOfBirth: '2025-03-20',
      ageParts: { years: 1, months: 3, days: 13 },
    });
  });

  it('renders patient age and mobile as readable inline title badges', () => {
    const node = buildPatientInlineLabel({ age: 20, mobile: '013077370614' } as any) as any;

    expect(node.props.className).toContain('inline-flex');
    expect(node.props.className).toContain('font-semibold');
    expect(node.props.className).not.toContain('text-[var(--color-text-muted)]');
    expect(node.props.children).toEqual([
      expect.objectContaining({ props: expect.objectContaining({ children: '20y' }) }),
      expect.objectContaining({ props: expect.objectContaining({ children: '013077370614' }) }),
    ]);
  });

  it('builds patient-flow identity parts without duplicating age suffixes', () => {
    expect(buildPatientIdentityParts({ age: '20y', mobile: 'phone' })).toEqual(['20y', 'phone']);
    expect(buildPatientIdentityParts({ age: 35, mobile: '' })).toEqual(['35y']);
  });

  it('builds patient selector identity text with code, age, and mobile', () => {
    expect(buildReceptionPatientIdentityText({
      id: 1,
      patient_code: 'P-000001',
      age: 32,
      mobile: '01739416661',
    })).toBe('P-000001 · 32y · 01739416661');

    expect(buildReceptionPatientIdentityText({
      id: 2,
      patient_code: 'P-000002',
      date_of_birth: '2025-06-03',
      mobile: null,
    }, undefined, new Date('2026-07-03T12:00:00+06:00'))).toBe('P-000002 · 1y 1m');

    expect(buildReceptionPatientIdentityText({ id: 3, mobile: null })).toBe('Patient #3');
  });

  it('uses the age-aware patient identity in test bill, OPD serial, and IPD admission selectors', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');
    expect(source).toContain('buildReceptionPatientIdentityText(quickBillPatient)');
    expect(source).toContain('buildReceptionPatientIdentityText(appointmentPatient');
    expect(source).toContain('buildReceptionPatientIdentityText(admissionPatient)');
    expect((source.match(/buildReceptionPatientIdentityText\(patient/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('highlights the IPD admission no-patient state as a clear registration action', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('border-amber-300 bg-amber-50');
    expect(source).toContain('<UserPlus className="h-5 w-5"');
    expect(source).toContain("t('btn.noSavedPatientRegister', { ns: 'reception' })");
    expect(source).toContain("t('info.registerPatientToContinueAdmission', { ns: 'reception' })");
    expect(source).toContain("t('btn.registerNewPatient', { ns: 'reception' })");
  });

  it('uses eligible admission candidates and opens the admission slip after success', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain("'/api/reception/admission-candidates?search=' + encodeURIComponent(admissionPatientLookupTerm) + '&limit=8'");
    expect(source).toMatch(/ipd-admission-patient-lookup[\s\S]*?admission-candidates[\s\S]*?staleTime: 0,/);
    expect(source).toContain('const sourcePatients = admissionPatientLookupData?.patients ?? [];');
    expect(source).toContain("import { getAdmissionSlipPrintPath } from '../lib/admissionPrint';");
    expect(source).toContain('admission?: { id?: number; admission_no?: string }');
    expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['reception', 'ipd-admission-patient-lookup'] });");
    expect(source).toContain('navigate(getAdmissionSlipPrintPath(basePath, Number(data.admission.id)));');
  });

  it('sorts completed patient-flow rows below active work', () => {
    const sorted = sortReceptionFlowRows([
      { key: 'done-newer', source: 'appointment', status: 'concluded', appointment: { created_at: '2026-05-16 10:00:00' }, serial: 1 },
      { key: 'active-older', source: 'appointment', status: 'scheduled', appointment: { created_at: '2026-05-16 08:00:00' }, serial: 2 },
      { key: 'active-newer', source: 'appointment', status: 'checked_in', appointment: { created_at: '2026-05-16 09:00:00' }, serial: 3 },
    ]);

    expect(sorted.map((row) => row.key)).toEqual(['active-newer', 'active-older', 'done-newer']);
    expect(isCompletedReceptionFlowStatus('concluded')).toBe(true);
    expect(isCompletedReceptionFlowStatus('scheduled')).toBe(false);
  });

  it('summarizes pending bill service purpose from invoice items or category totals', () => {
    expect(getBillServiceLabel({ service_summary: 'CBC, X-Ray, ECG, Thyroid' })).toBe('CBC, X-Ray, ECG +1 more');
    expect(getBillServiceLabel({ doctor_visit_bill: 300 })).toBe('Doctor consultation');
    expect(getBillServiceLabel({ test_bill: 50000 })).toBe('Lab / diagnostic test');
  });

  it('counts deposit adjustments as settled money for collect-payment bills', () => {
    const bill = {
      total_amount: 8000,
      paid_amount: 0,
      deposit_adjusted: 5000,
    };

    expect(getBillSettledAmount(bill)).toBe(5000);
    expect(getBillOutstandingAmount(bill)).toBe(3000);
  });

  it('uses server-calculated outstanding before local total minus paid fallback', () => {
    expect(getBillOutstandingAmount({
      total_amount: 8000,
      paid_amount: 0,
      deposit_adjusted: 5000,
      outstanding: 2500,
    })).toBe(2500);
  });

  it('caps stale server outstanding after deposit adjustment settlement', () => {
    expect(getBillOutstandingAmount({
      total_amount: 8000,
      paid_amount: 0,
      deposit_adjusted: 5000,
      outstanding: 8000,
    })).toBe(3000);
  });

  it('normalizes floating-point residue before prefilling a due payment', () => {
    expect(getBillOutstandingAmount({
      total_amount: 1000,
      settled_amount: 800.0000000000001,
      outstanding: 200,
    })).toBe(200);
  });

  it('separates cash paid from deposit adjusted in settled invoice records', () => {
    const bill = {
      total_amount: 1000,
      paid_amount: 1000,
      settled_amount: 1000,
      deposit_adjusted: 700,
      outstanding: 0,
    };

    expect(getBillCashPaidAmount(bill)).toBe(300);
    expect(getBillSettledAmount(bill)).toBe(1000);
    expect(getBillOutstandingAmount(bill)).toBe(0);
  });

  it('does not label unbilled consultation entries as walk-in tokens', () => {
    expect(getFlowTokenLabel({ serial: 4, visit: {}, pendingServices: 1 })).toBe('#4');
    expect(getFlowTokenLabel({ visit: {}, pendingServices: 1 })).toBe('No token yet');
    expect(getFlowTokenLabel({ visit: {}, pendingAmount: 500 })).toBe('No token yet');
    expect(getFlowTokenLabel({ visit: {}, pendingServices: 0, pendingAmount: 0 })).toBe('Walk-in');
  });

  it('shows self or referring doctor in patient-flow doctor column', () => {
    expect(getReceptionFlowDoctorLabel({ doctorName: '' })).toBe('Self');
    expect(getReceptionFlowDoctorLabel({ referredByType: 'self' })).toBe('Self');
    expect(getReceptionFlowDoctorLabel({ referredByType: 'doctor', referredByDoctorName: 'Dr Karim' })).toBe('Dr Karim');
    expect(getReceptionFlowDoctorLabel({ referredByType: 'doctor', referredByName: 'Dr External' })).toBe('Dr External');
  });

  it('groups appointment fees and doctor visit service entries as one consultation queue', () => {
    const entries = buildPendingConsultationEntries({
      appointments: [
        { id: 10, patient_name: 'A', doctor_name: 'Dr X', final_fee: 500, billing_status: 'unpaid', token_no: 1 },
      ],
      visits: [
        { id: 20, patient_name: 'B', doctor_name: 'Dr X', pending_doctor_visit_amount: 500, pending_doctor_visit_services: 1 },
        { id: 21, patient_name: 'C', pending_doctor_visit_amount: 0, pending_doctor_visit_services: 0, pending_amount: 700 },
      ],
    });

    expect(entries.map((entry) => entry.key)).toEqual(['appointment-10', 'visit-20']);
    expect(entries.every((entry) => entry.label === 'Consultation')).toBe(true);
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(1000);
  });

  it('keeps non-consultation pending services out of the consultation amount', () => {
    expect(getNonConsultationPendingAmount({ pending_amount: 900, pending_doctor_visit_amount: 500 })).toBe(400);
    expect(getNonConsultationPendingAmount({ pending_amount: 500, pending_doctor_visit_amount: 500 })).toBe(0);
  });

  it('keeps selected-date billing widgets aligned with the dashboard date', () => {
    const bills = [
      { id: 1, created_at: '2026-06-01 09:00:00', status: 'open' },
      { id: 2, created_at: '2026-05-31 18:00:00', status: 'open' },
      { id: 3, created_at: '2026-05-30 11:00:00', bill_date: '2026-06-01', status: 'open' },
    ];

    expect(filterReceptionBillsByDate(bills, '2026-06-01').map((bill) => bill.id)).toEqual([1, 3]);
    expect(buildReceptionPendingBillDateParam('date', '2026-06-01')).toBe('&date=2026-06-01');
    expect(buildReceptionPendingBillDateParam('all', '2026-06-01')).toBe('');
    expect(buildReceptionPendingBillDateParam('past', '2026-06-01')).toBe('&beforeDate=2026-06-01');
  });

it('builds collect-payment date filters and pending bill records', () => {
    expect(buildReceptionDueCollectionDateParam('today', '2026-07-01')).toBe('&date=2026-07-01');
    expect(buildReceptionDueCollectionDateParam('overdue', '2026-07-01')).toBe('&beforeDate=2026-07-01');
    expect(buildReceptionDueCollectionDateParam('all', '2026-07-01')).toBe('');
    const bill = pendingBillSummaryToBillRecord({
      bill_id: 77,
      invoice_no: 'INV-77',
      patient_name: 'Panna',
      pending_amount: 500,
      total_amount: 1000,
      paid_amount: 500,
      status: 'partial_paid',
      created_at: '2026-07-01 12:00:00',
      service_summary: 'Lab / diagnostic test',
      test_bill: 1,
    });
    expect(bill.id).toBe(77);
    expect(bill.due).toBe(500);
    expect(bill.test_bill).toBe(1);
  });

  it('filters reception flow rows by patient name (case-insensitive)', () => {
    const rows = [
      { key: 'visit-1', patientName: 'Rahim Uddin', serial: 1 },
      { key: 'visit-2', patientName: 'Karim Hossain', serial: 2 },
    ];

    expect(filterReceptionFlowRowsByQuery(rows, 'rahim').map((row) => row.key)).toEqual(['visit-1']);
    expect(filterReceptionFlowRowsByQuery(rows, 'KARIM').map((row) => row.key)).toEqual(['visit-2']);
  });

  it('matches invoiceNo with letter-o typo tolerance', () => {
    const rows = [
      { key: 'visit-1', patientName: 'Rahim', invoiceNo: 'INV-000001' },
      { key: 'visit-2', patientName: 'Karim', invoiceNo: 'INV-000002' },
    ];

    expect(filterReceptionFlowRowsByQuery(rows, 'inv-ooooo1').map((row) => row.key)).toEqual(['visit-1']);
    expect(filterReceptionFlowRowsByQuery(rows, 'INV-0oooo2').map((row) => row.key)).toEqual(['visit-2']);
  });

  it('matches the snake_case invoice_no row field', () => {
    const rows = [
      { key: 'visit-1', patientName: 'A', invoice_no: 'INV-000077' },
      { key: 'visit-2', patientName: 'B', invoice_no: 'INV-000078' },
    ];

    expect(filterReceptionFlowRowsByQuery(rows, 'inv-77').map((row) => row.key)).toEqual([]);
    expect(filterReceptionFlowRowsByQuery(rows, 'oooo77').map((row) => row.key)).toEqual(['visit-1']);
    expect(filterReceptionFlowRowsByQuery(rows, 'oooo78').map((row) => row.key)).toEqual(['visit-2']);
  });

  it('returns no rows when query does not match any haystack', () => {
    const rows = [
      { key: 'visit-1', patientName: 'Rahim', invoiceNo: 'INV-000001' },
      { key: 'visit-2', patientName: 'Karim', mobile: '01700000000' },
    ];

    expect(filterReceptionFlowRowsByQuery(rows, 'xyz-not-a-match')).toEqual([]);
  });

  it('returns all rows for empty or whitespace queries', () => {
    const rows = [
      { key: 'visit-1', patientName: 'A' },
      { key: 'visit-2', patientName: 'B' },
    ];

    expect(filterReceptionFlowRowsByQuery(rows, '')).toEqual(rows);
    expect(filterReceptionFlowRowsByQuery(rows, '   ')).toEqual(rows);
  });

  it('classifies IPD due invoices for reception outstanding collection summaries', () => {
    expect(isReceptionBillIpd({ admission_bill: 1500 })).toBe(true);
    expect(isReceptionBillIpd({ admission_id: 13068 } as any)).toBe(true);
    expect(isReceptionBillIpd({ test_bill: 900, doctor_visit_bill: 300 })).toBe(false);
  });

  it('calculates due ageing buckets for previous outstanding invoice follow-up', () => {
    expect(receptionDueAgeDays('2026-06-25 10:00:00', '2026-07-01')).toBe(6);
    expect(receptionDueMatchesAgeBucket(6, '0_7')).toBe(true);
    expect(receptionDueMatchesAgeBucket(8, '8_30')).toBe(true);
    expect(receptionDueMatchesAgeBucket(45, '31_60')).toBe(true);
    expect(receptionDueMatchesAgeBucket(90, '60_plus')).toBe(true);
  });

  it('keeps collect payment modal wired to dedicated collection list', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('buildReceptionDueCollectionDateParam(dueCollectionScope, dueCollectionDate)');
    expect(source).toContain('limit=100');
    expect(source).toContain('pagination?.total');
    expect(source).toContain('Includes previous unpaid and partially paid invoices, not only today');
  });

  it('increments appointment date without reopening the calendar picker', () => {
    expect(addReceptionDateDays('2026-06-05', 1)).toBe('2026-06-06');
    expect(addReceptionDateDays('2026-06-30', 1)).toBe('2026-07-01');
  });

  it('formats patient-flow date as day-month-year independent of browser locale', () => {
    expect(formatReceptionFlowDate('2026-06-26')).toBe('26/06/2026');
    expect(formatReceptionFlowDate('invalid-date')).toBe('invalid-date');
  });

  it('builds serial override payloads for reception appointment booking', () => {
    expect(buildReceptionAppointmentTokenPayload('auto', '', '')).toEqual({});
    expect(buildReceptionAppointmentTokenPayload('reserved', 7, '')).toEqual({ requestedTokenNo: 7 });
    expect(buildReceptionAppointmentTokenPayload('manual', '', '42')).toEqual({ forceTokenNo: 42 });
  });

  it('renders booked serials as reusable duplicate manual choices in the appointment serial strip', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('bookedTokens?:');
    expect(source).toContain('const bookedTokenNumbers');
    expect(source).toContain('setAppointmentTokenMode(\'manual\')');
    expect(source).toContain('manual duplicate');
  });

  it('hides visit service deposit input when the patient has no deposit balance', () => {
    expect(shouldShowServiceDepositField(0)).toBe(false);
    expect(shouldShowServiceDepositField(null)).toBe(false);
    expect(shouldShowServiceDepositField(50)).toBe(true);
  });

  it('calculates visit service partial payment and remaining due after deposit', () => {
    expect(calculateVisitServicePaymentDraft({
      grandTotal: 1400,
      depositBalance: 0,
      depositRequested: 0,
      payNowInput: 500,
    })).toEqual({ depositApplied: 0, payableNow: 1400, cashPaid: 500, dueAfterPayment: 900 });

    expect(calculateVisitServicePaymentDraft({
      grandTotal: 1400,
      depositBalance: 300,
      depositRequested: 250,
      payNowInput: '',
    })).toEqual({ depositApplied: 250, payableNow: 1150, cashPaid: 1150, dueAfterPayment: 0 });
  });

  it('wires the show-admitted-patients toggle in the dashboard source', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('showAdmittedPatients');
    expect(source).toContain('Show IPD Patients');
    expect(source).toContain('/api/admissions?status=all&perPage=100');
  });

  it('builds admitted patient rows with working action ids', () => {
    const [row] = buildAdmittedPatientFlowRows([{
      id: 58,
      patient_id: 42,
      admission_no: 'ADM-00058',
      patient_name: 'Mon Moto',
      ward_name: 'Ward A',
      bed_number: '6',
      status: 'admitted',
      final_bill_id: 9001,
      final_invoice_no: 'IPD-9001',
      final_bill_total_amount: 12000,
      final_bill_paid_amount: 5000,
    }]);

    expect(isAdmissionFlowRow(row)).toBe(true);
    expect(getAdmissionFlowAdmissionId(row)).toBe(58);
    expect(getAdmissionFlowPatientId(row)).toBe(42);
    expect(row.patient?.id).toBe(42);
    expect(row.wardBed).toContain('Ward A');

    const finalBill = buildAdmissionFinalBillRecord(row);
    expect(finalBill?.id).toBe(9001);
    expect(finalBill?.invoice_no).toBe('IPD-9001');
    expect(finalBill?.due).toBe(7000);
  });

  it('keeps IPD admission idempotency stable across rapid dashboard clicks', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('admissionCreateIdempotencyRef');
    expect(source).toContain('idempotencyKey: admissionCreateIdempotencyRef.current');
    expect(source).not.toContain('idempotencyKey: `dash-admission-${admissionPatient.id}-${crypto.randomUUID()}`');
  });

  it('keeps new-patient registration idempotent across rapid dashboard clicks', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('const newPatientSubmitLockRef = useRef(false)');
    expect(source).toContain('const newPatientCreateIdempotencyRef = useRef<string | null>(null)');
    expect(source).toContain('if (newPatientSubmitLockRef.current) return;');
    expect(source).toContain('newPatientCreateIdempotencyRef.current = `reception-patient-registration-${crypto.randomUUID()}`');
    expect(source).toContain('idempotencyKey: newPatientCreateIdempotencyRef.current');
    expect(source).toContain('newPatientSubmitLockRef.current = false');
    expect(source).toContain('error.status < 500');
    expect(source).toContain("error.message.includes('already being processed')");
  });

  it('redirects successful reception bills to the same-tab print page', () => {
    const navigate = vi.fn();

    expect(redirectToReceptionBillPrint(navigate, '/h/demo/reception', 5210)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/h/demo/reception/billing/5210/print');
    expect(redirectToReceptionBillPrint(navigate, '/h/demo/reception', undefined)).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('builds the newly checked-in visit directly from the appointment response', () => {
    expect(buildCheckedInVisit({
      appointment: {
        id: 14117,
        patient_id: 244,
        patient_name: 'Patient',
        patient_code: 'P-000244',
        patient_mobile: '01700000000',
        doctor_id: 101,
        doctor_name: 'Dr. Aminul Islam',
      },
      visitId: 9001,
      sentToRoom: true,
    })).toMatchObject({
      id: 9001,
      appointment_id: 14117,
      patient_id: 244,
      patient_name: 'Patient',
      patient_code: 'P-000244',
      mobile: '01700000000',
      doctor_id: 101,
      doctor_name: 'Dr. Aminul Islam',
      status: 'engaged',
    });
  });

  it('builds admitted patient-flow rows with IPD print helpers', () => {
    const rows = buildAdmittedPatientFlowRows([
      {
        id: 501,
        patient_id: 44,
        admission_no: 'ADM-501',
        patient_name: 'Rahim Uddin',
        patient_code: 'P-000044',
        patient_mobile: '01700000000',
        ward_name: 'Male Ward',
        bed_number: '12',
        doctor_name: 'Dr Karim',
        admission_date: '2026-06-30 09:15:00',
        status: 'admitted',
        final_bill_id: 8001,
        final_invoice_no: 'BL-8001',
      },
    ] as any);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'admission-501',
      source: 'admission',
      patientId: 44,
      patientName: 'Rahim Uddin',
      status: 'admitted',
      finalBillId: 8001,
      finalInvoiceNo: 'BL-8001',
      billId: 8001,
      invoiceNo: 'BL-8001',
    });
  });

  it('keeps the admitted-patient toggle exclusive to IPD admissions', () => {
    const admissionRows = buildAdmittedPatientFlowRows([{ id: 501, patient_id: 44, patient_name: 'IPD Patient', status: 'admitted' }] as any);
    const rows = buildReceptionFlowDisplayRows({
      showAdmittedPatients: true,
      admissionFlowRows: admissionRows,
      visits: [{ id: 20, patient_id: 1, patient_name: 'OPD Patient', status: 'checked_in' }] as any,
      todayAppointments: [{ id: 10, patient_id: 1, patient_name: 'Serial Patient', status: 'scheduled' }] as any,
      hideCompletedFlow: false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'admission', patientName: 'IPD Patient' });
  });

  it('filters active and same-day discharged admissions for the IPD patient view', () => {
    expect(shouldIncludeAdmissionInReceptionFlow({ status: 'admitted' }, '2026-06-30')).toBe(true);
    expect(shouldIncludeAdmissionInReceptionFlow({ status: 'critical' }, '2026-06-30')).toBe(true);
    expect(shouldIncludeAdmissionInReceptionFlow({ status: 'discharged', discharge_date: '2026-06-30 11:30:00' }, '2026-06-30')).toBe(true);
    expect(shouldIncludeAdmissionInReceptionFlow({ status: 'discharged', discharge_date: '2026-06-29 11:30:00' }, '2026-06-30')).toBe(false);
  });

  it('shows only one bill print action for admission rows based on bill finalization state', () => {
    expect(shouldShowAdmissionRunningBillPrint({ status: 'admitted' })).toBe(true);
    expect(shouldShowAdmissionRunningBillPrint({ status: 'admitted', finalBillId: 9001 })).toBe(false);
    expect(shouldShowAdmissionRunningBillPrint({ status: 'discharged' })).toBe(false);
    expect(shouldShowAdmissionInvoicePrint({ finalBillId: 9001 })).toBe(true);
    expect(shouldShowAdmissionInvoicePrint({ billId: null })).toBe(false);
  });

  it('uses matched appointment invoice details for checked-in visit rows', () => {
    const rows = buildReceptionFlowRows({
      visits: [{
        id: 20,
        appointment_id: 10,
        patient_id: 1,
        patient_name: 'Azimun Nesa',
        patient_code: 'P-000011',
        mobile: '01839497052',
        age: 44,
        date_of_birth: '1982-02-03',
        doctor_id: 7,
        doctor_name: 'Dr Md. Abdul Khaleq',
        created_at: '2026-06-01 10:38:00',
        status: 'concluded',
        bill_id: null,
        bill_total: 0,
        bill_paid: 0,
        bill_due: 0,
      }],
      todayAppointments: [{
        id: 10,
        patient_id: 1,
        patient_name: 'Azimun Nesa',
        patient_code: 'P-000011',
        patient_mobile: '01839497052',
        patient_age: 44,
        patient_date_of_birth: '1982-02-03',
        doctor_id: 7,
        doctor_name: 'Dr Md. Abdul Khaleq',
        token_no: 1,
        status: 'checked_in',
        billing_status: 'paid',
        bill_id: 7701,
        invoice_no: 'INV-7701',
        bill_total: 1100,
        bill_paid: 1100,
        bill_due: 0,
      }],
      hideCompletedFlow: false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'visit-20',
      billId: 7701,
      invoiceNo: 'INV-7701',
      billTotal: 1100,
      billPaid: 1100,
      billDue: 0,
      billStatus: 'paid',
      billingStatus: 'paid',
      age: 44,
      dateOfBirth: '1982-02-03',
    });
  });

  it('collapses duplicate visit rows created for the same appointment', () => {
    const rows = buildReceptionFlowRows({
      visits: [
        {
          id: 20,
          appointment_id: 10,
          patient_id: 1,
          patient_name: 'Azimun Nesa',
          doctor_id: 7,
          doctor_name: 'Dr Md. Abdul Khaleq',
          created_at: '2026-06-01 10:38:00',
          status: 'concluded',
          bill_id: 7701,
          bill_total: 1100,
          bill_paid: 1100,
          bill_due: 0,
          bill_status: 'paid',
        },
        {
          id: 21,
          appointment_id: 10,
          patient_id: 1,
          patient_name: 'Azimun Nesa',
          doctor_id: 7,
          doctor_name: 'Dr Md. Abdul Khaleq',
          created_at: '2026-06-01 10:39:00',
          status: 'concluded',
          bill_id: null,
        },
      ],
      todayAppointments: [{ id: 10, patient_id: 1, doctor_id: 7, token_no: 1, billing_status: 'paid' }],
      hideCompletedFlow: false,
    });

    expect(rows.map((row) => row.key)).toEqual(['visit-20']);
  });

  it('includes bed charges in IPD provisional modal totals', () => {
    expect(getIpdProvisionalDisplayTotal({ provisional_total: 780, bed_total: 410000, grand_total: 410780 })).toBe(410780);
    expect(getIpdProvisionalDisplayTotal({ provisional_total: 780, bed_total: 410000 })).toBe(410780);
  });

  it('summarizes reception bed statuses for the quick drawer', () => {
    const summary = summarizeReceptionBeds([
      { id: 1, ward_name: 'General', bed_number: '101', status: 'available' },
      { id: 2, ward_name: 'General', bed_number: '102', status: 'available' },
      { id: 3, ward_name: 'General', bed_number: '103', status: 'cleaning' },
      { id: 4, ward_name: 'Cabin', bed_number: '201', status: 'reserved' },
      { id: 5, ward_name: 'ICU', bed_number: '1', status: 'maintenance' },
      { id: 6, ward_name: 'ICU', bed_number: '2', status: 'occupied' },
    ]);

    expect(summary).toMatchObject({
      total: 6,
      available: 2,
      cleaning: 1,
      reserved: 1,
      maintenance: 1,
      occupied: 1,
    });
    expect(summary.wardAvailability).toEqual([['General', 2]]);
  });

  it('makes patient-flow rows open the patient context while keeping action buttons isolated', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('const openRowPatientContext = () => {');
    expect(source).toContain('onClick={openRowPatientContext}');
    expect(source).toContain('role="button"');
    expect(source).toContain("event.key === 'Enter' || event.key === ' '");
    expect(source).toContain('onClick={(event) => event.stopPropagation()}');
  });

  it('uses chip-style controls for the patient-flow toolbar and actions', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');
    const css = readFileSync('src/index.css', 'utf8');

    expect(source).toContain('patient-flow-chip-button');
    expect(source).toContain('patient-flow-icon-button');
    expect(source).toContain('patient-flow-date-input');
    expect(source).toContain('patient-flow-row');
    expect(source).toContain('ReceptionFlowActionButton');
    expect(source).toContain('patient-flow-action-button');
    expect(source).toContain('patient-flow-action-detail');
    expect(css).toContain('.patient-flow-chip-button');
    expect(css).toContain('.patient-flow-icon-button');
    expect(css).toContain('.patient-flow-row');
    expect(css).toContain('.patient-flow-action-button');
    expect(css).toContain('.patient-flow-action-detail');
    expect(css).toContain('position: absolute;');
    expect(css).toContain('pointer-events: none;');
    expect(css).toContain('bottom: calc(100% + 0.55rem);');
    expect(css).not.toContain('min-height: 4.85rem');
  });

  it('wires prescription lab orders to selected item billing instead of billing the whole order', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('const pendingLabOrdersData = dashboardSnapshotData?.pendingLabOrders;');
    expect(source).not.toContain('/api/billing-counter/pending-lab-orders?limit=10');
    expect(source).toContain('/api/billing-counter/lab-orders/${payload.orderId}/bill');
    expect(source).toContain('itemIds: selectedPendingLabItemIds');
    expect(source).toContain('Leave unchecked if patient will test outside.');
    expect(source).toContain('pendingLabOrdersByPatient');
    expect(source).toContain('openPendingLabOrder(patientPendingLabOrders[0])');
  });

  it('opens add-item billing from the check-in response instead of waiting only for a visit refetch', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('const checkedInVisit = buildCheckedInVisit({');
    expect(source).toContain('openAddService(checkedInVisit, kind);');
  });

  it('redirects every reception billing success path through the shared print helper', () => {
    const dashboardSource = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');
    const drawerSource = readFileSync('src/components/reception/ReceptionPatientDrawer.tsx', 'utf8');

    expect(dashboardSource.match(/redirectToReceptionBillPrint\(navigate, basePath, data\.billId\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(dashboardSource).not.toContain('payload?.openPrint');
    expect(drawerSource).toContain('redirectToReceptionBillPrint(navigate, basePath, res.billId)');
  });

  it('sends self, doctor, hospital, or other referrer details from quick service billing', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain("type QuickBillReferrerType = 'self' | 'doctor' | 'hospital' | 'other'");
    expect(source).toContain('setQuickBillReferrerType');
    expect(source).toContain('referredByType: quickBillReferrerType');
    expect(source).toContain("referrerSelectionSource: quickBillReferrerType === 'doctor' && quickBillDoctorId");
    expect(source).toContain("quickBillDoctorTouched ? 'manual' : 'patient_context'");
    expect(source).toContain('referredByHospitalId: quickBillReferrerType ===');
    expect(source).toContain('referredByName: quickBillReferrerName');
    expect(source).toContain('<HospitalCombobox');
  });

  it('resets stale quick-bill referral state whenever the patient changes', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).not.toContain('const hasManualQuickBillReferrer = () =>');
    expect(source).toContain('const resetQuickBillReferralForPatient = (patient: Patient) =>');
    expect(source).toContain('const defaultDoctorId = defaultReferringDoctorIdForPatient(patient.id);');
    expect(source).toContain("setQuickBillReferrerType(defaultDoctorId ? 'doctor' : 'self');");
    expect(source).toContain("setQuickBillExtRefDoctorId('');");
    expect(source).toContain('setQuickBillReferrerHospital(null);');
    expect(source).toContain("setQuickBillOtherReferrerName('');");
    expect(source).toContain('resetQuickBillReferralForPatient(patient);');
  });

  it('captures non-cash references across reception collection flows', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain("from '../lib/paymentReference'");
    expect(source).toContain('const [payReference, setPayReference]');
    expect(source).toContain('const [quickBillPaymentReference, setQuickBillPaymentReference]');
    expect(source).toContain('const [servicePaymentReference, setServicePaymentReference]');
    expect(source).toContain('const [pendingLabPaymentReference, setPendingLabPaymentReference]');
    expect(source).toContain('const [appointmentPaymentReference, setAppointmentPaymentReference]');
    expect(source).toContain('externalTransactionId: normalizeExternalTransactionId');
  });

  it('wires scheme benefit preview and application into quick service billing', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('/api/billing-master/apply-scheme-preview');
    expect(source).toContain('submitQuickBillSchemeCheck');
    expect(source).toContain('applyQuickBillSchemeDiscount');
    expect(source).toContain('schemeApplication: quickBillSchemePreview?.eligible');
    expect(source).toContain("serviceCategory: quickBillSchemePreview.service_category ?? 'quick_service_bill'");
    expect(source).toContain('setQuickBillDiscountSources([{ id: crypto.randomUUID(), reason');
  });

  it('keeps the visit doctor selected when adding tests from patient flow', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('function resolveVisitDoctorId');
    expect(source).toContain('source.doctor_id ?? source.doctorId ?? source.prescriber_doctor_id ?? source.prescriberDoctorId ?? source.referring_doctor_id ?? source.referringDoctorId');
    expect(source).toContain('setSelectedServiceDoctorId(resolveVisitDoctorId(visit) ||');
  });

  it('wires scheme benefit preview and application into visit service billing', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('submitVisitServiceSchemeCheck');
    expect(source).toContain('applyVisitServiceSchemeDiscount');
    expect(source).toContain('serviceSchemePreview?.eligible && serviceDiscountAmount > 0');
    expect(source).toContain("serviceCategory: serviceSchemePreview.service_category ?? 'visit_service_bill'");
    expect(source).toContain('checkVisitServiceSchemePreviewMutation');
    expect(source).toContain('Advanced / Split');
    expect(source).toContain('canApplyDiscount && serviceDiscountAmount > 0 ? (');
    expect(source).not.toContain("{canApplyDiscount ? (\n                        serviceAdvancedDiscount ? (");
    expect(source).toContain('totalDiscount={serviceDiscountAmount}');
  });


  it('wires scheme benefit preview and application into final visit bill generation', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('submitFinalBillSchemeCheck');
    expect(source).toContain('applyFinalBillSchemeDiscount');
    expect(source).toContain('billSchemePreview?.eligible && billDiscount > 0');
    expect(source).toContain("serviceCategory: billSchemePreview.service_category ?? 'reception_visit_bill'");
    expect(source).toContain('checkFinalBillSchemePreviewMutation');
  });


  it('wires optional scheme benefit preview into appointment payment modal', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('checkAppointmentPaymentSchemePreviewMutation');
    expect(source).toContain('appointmentPaymentSchemePreview?.eligible');
    expect(source).toContain("service_category: 'appointment_payment'");
    expect(source).toContain("serviceCategory: appointmentPaymentSchemePreview.service_category ?? 'appointment_payment'");
    expect(source).toContain('Optional: leave empty for normal appointment payment.');
  });

  it('does not keep refilling the collect-payment amount after the receptionist edits it', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('}, [payBill, batchPaymentBills]);');
    expect(source).not.toContain('}, [payAmount, payBill]);');
    expect(source).not.toContain('}, [payAmount, payBill, batchPaymentBills]);');
  });

  it('keeps billing and reception context endpoints deposit-aware for collect-due surfaces', () => {
    const billingSource = readFileSync('../src/routes/tenant/billing.ts', 'utf8');
    const receptionSource = readFileSync('../src/routes/tenant/reception.ts', 'utf8');

    expect(billingSource).toContain('AS cash_paid_amount');
    expect(billingSource).toContain('AS deposit_adjusted');
    expect(billingSource).toContain('AS settled_amount');
    expect(billingSource).toContain('AS outstanding');
    expect(receptionSource).toContain('billing_deposits bd');
    expect(receptionSource).toContain('AS cash_paid_amount');
    expect(receptionSource).toContain('AS deposit_adjusted');
    expect(receptionSource).toContain('AS settled_amount');
    expect(receptionSource).toContain('AND ${outstandingExpression} > 0');
  });

  it('loads active reception dashboard data from the batched snapshot endpoint', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain("['reception', 'dashboard-snapshot', date]");
    expect(source).toContain('/api/reception/dashboard-snapshot?date=${date}');
    expect(source).toContain('const visitsData = dashboardSnapshotData?.visits;');
    expect(source).toContain('const todayAppointmentsData = dashboardSnapshotData?.appointments;');
    expect(source).toContain('const queueStatsData = dashboardSnapshotData?.queueStats;');
    expect(source).toContain('const activeCounterData = dashboardSnapshotData?.activeCounter;');
    expect(source).not.toContain('/api/appointments/today?date=${date}');
    expect(source).not.toContain("'/api/queue/tokens/stats'");
    expect(source).not.toContain("'/api/billing-counter/sessions/active'");
  });

  it('exposes a single server snapshot route for reception patient-flow polling', () => {
    const receptionSource = readFileSync('../src/routes/tenant/reception.ts', 'utf8');

    expect(receptionSource).toContain("receptionRoutes.get('/dashboard-snapshot'");
    expect(receptionSource).toContain('const [visitsResult, appointmentsResult, queueStats, pendingLabOrdersResult, activeCounter] = await Promise.all');
    expect(receptionSource).toContain('parseReceptionSnapshotPendingLabItems');
    expect(receptionSource).toContain('activeCounter: { active: Boolean(session), session }');
  });

  it('auto-fills the selected doctor name and preloads waiver capacity before source selection', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('const quickBillDoctorWaiverDoctorName = quickBillDoctorWaiverDoctorId');
    expect(source).toContain('const serviceDoctorWaiverDoctorName = serviceDoctorWaiverDoctorId');
    expect(source).toContain('const billDoctorWaiverDoctorName = billDoctorWaiverDoctorId');
    expect(source.match(/onQuickSourceSelected=/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('setQuickBillDiscountByName(quickBillDoctorWaiverDoctorName)');
    expect(source).toContain('setServiceDiscountByName(serviceDoctorWaiverDoctorName)');
    expect(source).toContain('setBillDiscountByName(billDoctorWaiverDoctorName)');
    expect(source).toContain('const [quickBillDoctorWaiverLoading, setQuickBillDoctorWaiverLoading]');
    expect(source).toContain('const [serviceDoctorWaiverLoading, setServiceDoctorWaiverLoading]');
    expect(source).toContain('const [billDoctorWaiverLoading, setBillDoctorWaiverLoading]');
    expect(source.match(/doctorWaiverLoading:/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('}, [quickBillDiscount, quickBillDoctorWaiverDoctorId, quickBillHasEligibleSchemePreview, quickBillLines]);');
    expect(source).toContain('}, [serviceDiscountAmount, serviceDoctorWaiverDoctorId, serviceHasEligibleSchemePreview, selectedServiceLines]);');
    expect(source).toContain('}, [billDiscount, billDoctorWaiverDoctorId, billHasEligibleSchemePreview, pendingVisitServices]);');
    expect(source).toContain('Wait for the doctor commission preview to finish.');
    expect(source).toContain('allocateProportionalDiscounts');
    expect(source).toContain('grossLineTotal');
    expect(source).toContain('quantity');
  });

  it('sends performer doctor from F2 quick service bill payload separately from prescriber', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');
    expect(source).toContain('const [quickBillPerformerDoctorId, setQuickBillPerformerDoctorId]');
    expect(source).toContain('performerDoctorId: line.performerDoctorId ? Number(line.performerDoctorId) : quickBillPerformerDoctorId ? Number(quickBillPerformerDoctorId) : undefined');
    expect(source).toContain("prescriberDoctorId: quickBillReferrerType === 'doctor' && quickBillDoctorId ? Number(quickBillDoctorId) : undefined");
  });

  it('sends performer doctor from patient-flow add item payload separately from referring doctor', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');
    expect(source).toContain('const [selectedServicePerformerDoctorId, setSelectedServicePerformerDoctorId]');
    expect(source).toContain('performerDoctorId: line.performerDoctorId ? Number(line.performerDoctorId) : selectedServicePerformerDoctorId ? Number(selectedServicePerformerDoctorId) : undefined');

  });

  it('loads lab-test performer doctors separately and keeps performer dropdowns searchable', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain('/api/doctors?service_type=lab_test&incentive_type=performer');
    expect(source).toContain('const performerDoctors = performerDoctorsData?.doctors ?? [];');
    expect(source).toContain('const [quickBillPerformerDoctorSearch, setQuickBillPerformerDoctorSearch]');
    expect(source).toContain('const [selectedServicePerformerDoctorSearch, setSelectedServicePerformerDoctorSearch]');
    expect(source).toContain('filteredQuickBillPerformerDoctors.map');
    expect(source).toContain('filteredSelectedServicePerformerDoctors.map');
    expect(source).toContain('Search performer doctor');
    expect(source).toContain('No performer commission rule configured for lab tests.');
  });

  it('does not replace referrer or prescriber doctor dropdowns with performer-only doctors', () => {
    const source = readFileSync('src/pages/ReceptionDashboard.tsx', 'utf8');

    expect(source).toContain("prescriberDoctorId: quickBillReferrerType === 'doctor' && quickBillDoctorId ? Number(quickBillDoctorId) : undefined");
    expect(source).toContain('doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty');
    expect(source).toContain('{doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}');
  });

  it('supports performer doctor lookup through active commission rule filters', () => {
    const source = readFileSync('../src/routes/tenant/doctors.ts', 'utf8');

    expect(source).toContain('doctor_commission_rules r');
    expect(source).toContain('r.is_active = 1');
    expect(source).toContain('r.service_type = ?');
    expect(source).toContain('r.incentive_type = ?');
  });

});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildLabReportPrintUrl,
  buildReceptionReportActions,
  buildReceptionReportsPdfCenterPath,
  buildDoctorPerformanceCsv,
  buildDoctorReportHtml,
  getCollectionDetailReference,
  buildReceptionDueBillsUrl,
  buildShiftHandoverReportUrl,
  buildShiftHandoverFinalizeUrl,
  buildShiftHandoverHistoryUrl,
  buildShiftHandoverReportCsv,
  buildShiftHandoverReportHtml,
  getReceptionBillOutstanding,
  type ShiftHandoverReport,
} from './ReceptionReportsPage';
import { buildReportBody, getAvailablePdfReportOptions, getInitialPdfReportType, reportCategories, reportOptions } from './AdminPdfGenerationPage';

describe('ReceptionReportsPage due bill helpers', () => {
  it('uses the centralized due report endpoint with supported date filters', () => {
    expect(buildReceptionDueBillsUrl('2026-05-12')).toBe('/api/billing/due?from=2026-05-12&to=2026-05-12');
  });

  it('builds role-aware report shortcuts for receptionist and admin report centers', () => {
    expect(buildReceptionReportsPdfCenterPath('/h/demo-hospital', 'reception')).toBe('/h/demo-hospital/reception/reports/pdf');
    expect(buildReceptionReportsPdfCenterPath('/h/demo-hospital', 'hospital_admin')).toBe('/h/demo-hospital/reports/pdf');

    const receptionActions = buildReceptionReportActions('/h/demo-hospital', 'reception');
    expect(receptionActions.map((action) => action.title)).toEqual([
      'Shift Report Print',
      'Report Delivery Desk',
      "Today's Collection Snapshot",
      'PDF Center',
      'Cash Operations',
    ]);
    expect(receptionActions[0]).toMatchObject({ href: '/h/demo-hospital/reception/reports/pdf?report=shiftHandover', badge: 'Print/PDF' });
    expect(receptionActions[3]).toMatchObject({ href: '/h/demo-hospital/reception/reports/pdf', badge: 'Print/PDF' });
    expect(receptionActions[4]).toMatchObject({ href: '/h/demo-hospital/reception/cash-operations', badge: 'Cash work' });

    const adminActions = buildReceptionReportActions('/h/demo-hospital', 'hospital_admin');
    expect(adminActions[0]).toMatchObject({ title: 'All Shift Handovers', href: '#shift-handover-report', badge: 'Admin audit' });
    expect(adminActions.find((action) => action.title === 'PDF Center')).toMatchObject({ href: '/h/demo-hospital/reports/pdf' });
  });

  it('scopes PDF report options by role so reception gets operational reports but not admin-only reports', () => {
    const receptionValues = getAvailablePdfReportOptions('reception').map((option) => option.value);
    expect(receptionValues).toContain('dailyCollection');
    expect(receptionValues).toContain('reportDelivery');
    expect(receptionValues).toContain('shiftHandover');
    expect(receptionValues).not.toContain('doctorPayout');
    expect(receptionValues).not.toContain('expenses');
    expect(receptionValues).not.toContain('cashActivity');
    expect(receptionValues).not.toContain('discountReport');
    expect(receptionValues).not.toContain('refundReport');
    expect(receptionValues).not.toContain('doctorPerformance');
    expect(receptionValues).not.toContain('referralReport');
    expect(receptionValues).not.toContain('auditLog');

    expect(getAvailablePdfReportOptions('hospital_admin').map((option) => option.value)).toEqual(reportOptions.map((option) => option.value));
    expect(getAvailablePdfReportOptions('accountant').map((option) => option.value)).toEqual(reportOptions.map((option) => option.value));
  });

  it('opens the PDF center directly on shift handover from query parameters', () => {
    expect(getInitialPdfReportType('shiftHandover', 'reception')).toBe('shiftHandover');
    expect(getInitialPdfReportType('expenses', 'reception')).toBe('dailyCollection');
    expect(getInitialPdfReportType('expenses', 'hospital_admin')).toBe('expenses');
  });



  it('keeps the reception reports PDF route on the live preview designer instead of direct API print windows', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    expect(appSource).toContain('<Route path="reception/reports/pdf" element={<RoleAwareRoute component={AdminPdfGenerationPage} />} />');
    expect(appSource).toContain('<Route path="reception/print" element={<RoleAwareRoute component={ReceptionPrintCenter} />} />');
  });

  it('keeps raw API print URLs out of the reception report generator to avoid missing-token print windows', () => {
    const source = readFileSync('src/pages/reception/ReceptionPrintCenter.tsx', 'utf8');
    expect(source).not.toContain('/api/reports/shift-handover/print');
    expect(source).not.toContain('/api/reports/${kebabType(type)}/print');
    expect(source).toContain('openReportDesigner');
  });

  it('does not offer reception report cards that the role-scoped PDF designer cannot open', () => {
    const source = readFileSync('src/pages/reception/ReceptionPrintCenter.tsx', 'utf8');
    expect(source).not.toContain("{ value: 'expenses', title: 'Expense Report'");
    expect(source).not.toContain("{ value: 'discountReport', title: 'Discount Report'");
    expect(source).not.toContain("{ value: 'refundReport', title: 'Refund Report'");
    expect(source).toContain("{ value: 'ipdAdmission', title: 'IPD Admission Report'");
    expect(source).not.toContain("/api/expenses?startDate=");
    expect(source).not.toContain("/api/reports/shift-handover");
    expect(source).not.toContain("/api/bills?status=due");
  });

  it('uses the printable lab report endpoint for reception report delivery actions', () => {
    expect(buildLabReportPrintUrl('/h/demo-hospital', 42)).toBe('/h/demo-hospital/api/lab/orders/42/report/print?autoprint=1');
  });

  it('loads shift handover reports by selected report date and optional session', () => {
    expect(buildShiftHandoverReportUrl('2026-06-22')).toBe('/api/reports/shift-handover?from=2026-06-22&to=2026-06-22&limit=100');
    expect(buildShiftHandoverReportUrl('2026-06-22', 17)).toBe('/api/reports/shift-handover?from=2026-06-22&to=2026-06-22&limit=100&sessionId=17');
  });

  it('links reception report shortcuts directly to the shift handover print center', () => {
    const actions = buildReceptionReportActions('/h/demo-hospital', 'reception');
    expect(actions.find((action) => action.title === 'Shift Report Print')).toMatchObject({
      href: '/h/demo-hospital/reception/reports/pdf?report=shiftHandover',
      badge: 'Print/PDF',
    });
  });

  it('exposes a clear shift report print shortcut in the reports page source', () => {
    const source = readFileSync('src/pages/ReceptionReportsPage.tsx', 'utf8');
    expect(source).toContain('Shift Report Print');
    expect(source).toContain('Opening cash');
    expect(source).toContain('Collections');
    expect(source).toContain('Expense / doctor payout');
    expect(source).toContain('Handover receiver');
  });

  it('uses the immutable shift handover finalize endpoint before printing', () => {
    expect(buildShiftHandoverFinalizeUrl(17)).toBe('/api/reports/shift-handover/sessions/17/finalize');
  });

  it('uses the finalized shift handover history endpoint for audit list', () => {
    expect(buildShiftHandoverHistoryUrl(12)).toBe('/api/reports/shift-handover/history?limit=12');
  });

  it('uses server-calculated outstanding amount before falling back to total minus paid', () => {
    expect(getReceptionBillOutstanding({
      id: 1,
      invoice_no: 'INV-1',
      total_amount: 1000,
      paid_amount: 250,
      outstanding: 700,
      discount: 0,
      status: 'open',
      created_at: '2026-05-12 10:00:00',
    })).toBe(700);

    expect(getReceptionBillOutstanding({
      id: 2,
      invoice_no: 'INV-2',
      total_amount: 1000,
      paid_amount: 250,
      discount: 0,
      status: 'open',
      created_at: '2026-05-12 10:00:00',
    })).toBe(750);
  });

  it('exports doctor performance csv with visit, test, and commission columns', () => {
    const csv = buildDoctorPerformanceCsv([
      {
        doctor_id: 5,
        doctor_name: 'Dr. A',
        patient_count: 12,
        doctor_visit_count: 14,
        doctor_visit_amount: 7000,
        test_count: 9,
        test_order_count: 6,
        test_collection_amount: 3600,
        test_commission_amount: 180,
        commission_amount: 900,
      },
    ]);

    expect(csv).toContain('"Doctor","Patients Seen","Doctor Visits"');
    expect(csv).toContain('"Dr. A"');
    expect(csv).toContain('"7000"');
    expect(csv).toContain('"3600"');
    expect(csv).toContain('"180"');
    expect(csv).toContain('"900"');
  });

  it('uses invoice number before receipt description for daily collection transaction references', () => {
    expect(getCollectionDetailReference({
      id: 478,
      transaction_type: 'CollectionFromReceivable',
      amount: 500,
      payment_method: 'cash',
      invoice_no: 'INV-D-2026-000094',
      description: 'Payment RCP-000301',
      created_at: '2026-06-23 21:02:22',
    })).toBe('INV-D-2026-000094');
  });

  it('builds a printable single-doctor html summary', () => {
    const html = buildDoctorReportHtml(
      '2026-05-15',
      [{
        doctor_id: 5,
        doctor_name: 'Dr. A',
        patient_count: 12,
        doctor_visit_count: 14,
        doctor_visit_amount: 7000,
        test_count: 9,
        test_order_count: 6,
        test_collection_amount: 3600,
        test_commission_amount: 180,
        test_commission_percent: 5,
        commission_amount: 900,
      }],
      {
        total_received: 14000,
        cash_received: 8000,
        current_collection: 11000,
        due_collection: 3000,
        total_returns: 200,
        total_discounts: 150,
        net_collection: 13800,
      },
      {
        total_patients_seen: 20,
        doctor_visit_count: 22,
        doctor_visit_amount: 9000,
        test_count: 15,
        test_amount: 5000,
      },
      {
        doctor_id: 5,
        doctor_name: 'Dr. A',
        patient_count: 12,
        doctor_visit_count: 14,
        doctor_visit_amount: 7000,
        test_count: 9,
        test_order_count: 6,
        test_collection_amount: 3600,
        test_commission_amount: 180,
        test_commission_percent: 5,
        commission_amount: 900,
      },
      [{
        doctor_id: 5,
        doctor_name: 'Dr. A',
        bill_id: 101,
        invoice_no: 'INV-101',
        invoice_date: '2026-05-15 10:00:00',
        patient_name: 'Patient One',
        patient_code: 'P-1',
        patient_mobile: '01700000000',
        reference_name: 'Ref. Clinic',
        test_names: 'CBC, X-Ray',
        test_count: 2,
        gross_amount: 2000,
        discount_amount: 200,
        test_collection_amount: 1800,
        paid_amount: 1800,
        due_amount: 0,
        test_commission_amount: 180,
        test_commission_percent: 10,
      } as any],
    );

    expect(html).toContain('Dr. A Daily Performance');
    expect(html).toContain('2026-05-15');
    expect(html).toContain('Test Collection');
    expect(html).toContain('Test Commission');
    expect(html).toContain('Test Commission %');
    expect(html).toContain('Reference Name');
    expect(html).toContain('Ref. Clinic');
    expect(html).toContain('Commission %');
    expect(html).toContain('5%');
    expect(html).toContain('10%');
    expect(html).toContain('৳3,600');
    expect(html).toContain('৳900');
    expect(html).toContain('Total Doctor Collection');
    expect(html).toContain('Net After Commission');
    expect(html).toContain('Test Invoice Details');
    expect(html).toContain('INV-101');
    expect(html).toContain('CBC, X-Ray');
    expect(html).toContain('৳180');
    expect(html).not.toContain('৳14,000');
    expect(html).not.toContain('৳13,800');
  });

  it('shows the configured commission rate instead of reverse-calculating an effective rate', () => {
    const html = buildDoctorReportHtml(
      '2026-07-17',
      [{
        doctor_id: 141,
        doctor_name: 'Dr. Khandakar Rejwanur Rahman',
        patient_count: 0,
        doctor_visit_count: 0,
        doctor_visit_amount: 0,
        test_count: 8,
        test_order_count: 8,
        test_collection_amount: 14_500,
        test_commission_amount: 3_618,
        test_commission_percent: 25,
        commission_amount: 3_618,
      }],
      { total_received: 14_500, cash_received: 14_500, current_collection: 14_500, due_collection: 0, total_returns: 0, total_discounts: 0, net_collection: 14_500 },
      { total_patients_seen: 0, doctor_visit_count: 0, doctor_visit_amount: 0, test_count: 8, test_amount: 14_500 },
    );

    expect(html).toContain('25%');
    expect(html).not.toContain('24.95%');
  });

  it('builds shift handover printable html and csv from audit-safe report data', () => {
    const report: ShiftHandoverReport = {
      session: {
        sessionId: 17,
        status: 'active',
        counterId: 3,
        counterName: 'Main Reception Counter',
        counterCode: 'RC-1',
        cashierId: 21,
        cashierName: 'Nusrat Jahan Sony',
        openedAt: '2026-06-19 09:00:00',
        closedAt: null,
        openingCash: 1000,
      },
      activity: {
        serialCreated: 25,
        doctorSeen: 5,
        serialCancelled: 1,
        serialWaiting: 2,
        invoiceCount: 26,
        patientsSeen: 5,
        doctorVisits: 5,
        testOrders: 21,
        testItems: 21,
      },
      finance: {
        totalReceived: 13400,
        cashReceived: 13400,
        dueCollection: 0,
        doctorVisitCollection: 1900,
        testCollection: 11500,
        refund: 0,
        discount: 100,
        doctorPayout: 900,
        pettyExpense: 250,
        transferOut: 1000,
        bankDeposit: 500,
        acceptedTransferIn: 200,
        totalDue: 0,
        expectedCash: 11950,
        countedCash: 11950,
        variance: 0,
      },
      paymentMethods: [{ paymentMethod: 'cash', transactionCount: 3, totalAmount: 13400 }],
      settlement: {
        paymentMethods: [{ paymentMethod: 'card', transactionCount: 2, systemAmount: 1200, declaredAmount: 1190, difference: -10 }],
        nonCashRemarks: 'Terminal batch verified',
      },
      handover: {
        handoverToName: 'Accountant One',
        handoverAmount: 11950,
        handoverDue: 0,
        status: 'received',
        remarks: 'Counted together',
      },
      expenses: [{ id: 8, category: 'MISC', amount: 250, description: 'Courier', status: 'approved' }],
      transfers: [{ id: 4, transferNo: 'CCT-17-demo', amount: 1000, status: 'pending', receiverName: 'Accountant' }],
      audit: { reportNo: 'SHR-20260619-17', generatedAt: '2026-06-19T12:00:00.000Z', generatedBy: 21, scope: 'own_shift' },
    };

    const html = buildShiftHandoverReportHtml(report);
    expect(html).toContain('Shift Handover Report');
    expect(html).toContain('SHR-20260619-17');
    expect(html).toContain('OPD Serial Created');
    expect(html).toContain('Expected Drawer Cash');
    expect(html).toContain('৳11,950');
    expect(html).toContain('Receiver Signature');
    expect(html).toContain('Payment Settlement Reconciliation');
    expect(html).toContain('Cash Handover Summary');
    expect(html).toContain('Accountant One');
    expect(html).toContain('Terminal batch verified');

    const csv = buildShiftHandoverReportCsv(report);
    expect(csv).toContain('"Report No","SHR-20260619-17"');
    expect(csv).toContain('"Expected Drawer Cash","11950"');
    expect(csv).toContain('"Payment Method","Transactions","Amount"');
  });

  it('offers grouped report types in the PDF center', () => {
    expect(reportCategories).toEqual(['Collection Reports', 'Clinical / Patient Reports', 'Doctor Reports', 'Cash / Admin Reports']);
    expect(reportOptions.map((option) => option.value)).toEqual(expect.arrayContaining([
      'visitReport',
      'testReport',
      'paymentMethod',
      'userCollection',
      'invoiceSummary',
      'patientRegistration',
      'departmentIncome',
      'ipdAdmission',
      'serviceItemSales',
      'doctorPayout',
      'referralReport',
      'dailyDiscount',
      'refundReport',
      'auditLog',
    ]));
    expect(reportOptions.find((option) => option.value === 'visitReport')?.title).toBe('Visit Report');
    expect(reportOptions.find((option) => option.value === 'testReport')?.title).toBe('Test Report');
  });

  it('builds separate visit-only and test-only PDF center bodies', () => {
    const collection = {
      service_summary: { total_patients_seen: 3, doctor_visit_count: 4, doctor_visit_amount: 2000, test_count: 2, test_amount: 3000 },
      finance_summary: { total_received: 4500, deposit_collection: 500 },
      summary: { total_bill: 5000, total_deposit: 500, total_expense: 0, total_due: 500 },
      collection_sources: [
        { department: 'Doctor Visit / Consultation', amount: 1500 },
        { department: 'Diagnostic / Laboratory', amount: 2500 },
        { department: 'Deposits / Advances', amount: 500 },
      ],
      payment_methods: [{ method: 'Cash', amount: 4500, percentage: 100 }],
      expenses: [],
      cash_closing: { net_cash_movement: 4400, cash_in_hand: 4500 },
      doctor_summaries: [{ doctor_name: 'Dr. A', patient_count: 3, doctor_visit_count: 4, doctor_visit_amount: 2000, consultation_commission_amount: 500, test_order_count: 1, test_count: 2, test_collection_amount: 3000, test_commission_amount: 300 }],
      doctor_test_invoices: [{ invoice_no: 'INV-1', invoice_date: '2026-06-21 10:00:00', patient_name: 'Patient A', doctor_name: 'Dr. A', test_names: 'CBC', test_count: 2, gross_amount: 3200, discount_amount: 200, test_collection_amount: 3000, paid_amount: 2500, due_amount: 500, test_commission_amount: 300 }],
      by_payment_method: [{ payment_method: 'cash', transaction_count: 2, total_amount: 4500 }],
      by_employee: [{ employee_id: 7, employee_name: 'Cashier A', cash_sales: 3000, collection_from_receivable: 1500, cash_discount_given: 200, sales_return: 100, deposit_return: 0, net: 4400 }],
      details: [
        { transaction_type: 'DiscountGiven', amount: 200, payment_method: 'cash', invoice_no: 'INV-1', description: 'RCP-1', created_at: '2026-06-21 10:30:00' },
        { transaction_type: 'SalesReturn', amount: 100, payment_method: 'cash', description: 'INV-2', created_at: '2026-06-21 11:30:00' },
      ],
      invoice_summary_rows: [{ source: 'Visit Invoice', invoice_no: 'INV-V1', patient_name: 'Patient A', doctor_name: 'Dr. A', total_amount: 2000, paid_amount: 1500, due_amount: 500 }],
      patient_registration_summary: { total_patients: 1, with_mobile: 1, by_gender: [{ gender: 'Male', count: 1 }] },
      patient_registration_rows: [{ patient_code: 'P-1', name: 'Patient A', mobile: '01700000000', gender: 'Male', district: 'Dhaka', upazila: 'Dhanmondi', created_at: '2026-06-21 09:00:00' }],
      ipd_admission_summary: { new_admissions: 1, discharges: 0, running_admitted: 1 },
      ipd_admission_rows: [{ admission_no: 'ADM-1', patient_name: 'Patient A', doctor_name: 'Dr. A', ward_name: 'Ward A', bed_number: 'A-1', status: 'admitted', admission_date: '2026-06-21 08:00:00' }],
      service_item_sales_rows: [{ item_category: 'test', description: 'CBC', quantity: 2, gross_amount: 3200, discount_amount: 200, net_amount: 3000 }],
    };
    const base = { collection, expenses: { expenses: [] }, cashActivity: { activity: [{ movementType: 'cash_in', referenceType: 'bill', referenceId: 1, actorName: 'Cashier A', description: 'Cash received', amount: 4500, createdAt: '2026-06-21 10:45:00' }] }, shift: undefined, dueBills: { bills: [] }, includeSummary: true, includeDetails: true, pageSize: 'a4' as const, orientation: 'portrait' as const };

    const visitHtml = buildReportBody('visitReport', base);
    expect(visitHtml).toContain('Visit Summary');
    expect(visitHtml).toContain('Doctor Wise Visits');
    expect(visitHtml).toContain('Visit Bill Amount');
    expect(visitHtml).toContain('Commission Accrued');
    expect(visitHtml).not.toContain('Visit Net');
    expect(visitHtml).not.toContain('CBC');

    const testHtml = buildReportBody('testReport', base);
    expect(testHtml).toContain('Test Summary');
    expect(testHtml).toContain('Test Invoice Details');
    expect(testHtml).toContain('INV-1');
    expect(testHtml).not.toContain('CBC');
    expect(testHtml).toContain('৳500.00');
    expect(testHtml).not.toContain('Visit Summary');

    expect(buildReportBody('paymentMethod', base)).toContain('Payment Method Summary');
    const userCollectionHtml = buildReportBody('userCollection', base);
    expect(userCollectionHtml).toContain('User-wise Collection');
    expect(userCollectionHtml).toContain('Cashier A');
    expect(buildReportBody('invoiceSummary', base)).toContain('INV-V1');
    expect(buildReportBody('patientRegistration', base)).toContain('Patient Registration Summary');
    expect(buildReportBody('departmentIncome', base)).toContain('Department / Service Billing &amp; Receipts');
    expect(buildReportBody('ipdAdmission', base)).toContain('IPD Admission Details');
    expect(buildReportBody('serviceItemSales', base)).toContain('Service Item Sales');
    const doctorPayoutHtml = buildReportBody('doctorPayout', base);
    expect(doctorPayoutHtml).toContain('Doctor Payout Estimate');
    expect(doctorPayoutHtml).toContain('Net Test Bill');
    expect(doctorPayoutHtml).toContain('Test Commission Accrued');
    expect(doctorPayoutHtml).toContain('৳3,000.00');
    expect(buildReportBody('referralReport', base)).toContain('Referral / Doctor Test Business');
    expect(buildReportBody('dailyDiscount', base)).toContain('Discount Allocation Details');
    expect(buildReportBody('refundReport', base)).toContain('Refund / Return Details');
    const dailyCollectionHtml = buildReportBody('dailyCollection', base);
    expect(dailyCollectionHtml).toContain('Department-wise Collection');
    expect(dailyCollectionHtml).toContain('Diagnostic / Laboratory');
    expect(dailyCollectionHtml).toContain('Payment Method Summary');
    expect(dailyCollectionHtml).toContain('৳4,500.00');
    expect(dailyCollectionHtml).toContain('Transaction Details');
    expect(dailyCollectionHtml).toContain('INV-1');
    expect(dailyCollectionHtml).toContain('INV-2');
    expect(dailyCollectionHtml).toContain('Discount given');
    expect(dailyCollectionHtml).not.toContain('RCP-1');
    expect(dailyCollectionHtml).not.toContain('Bill Reconciliation');
    expect(dailyCollectionHtml).not.toContain('Management Income Reconciliation');

    const shiftHtml = buildReportBody('shiftHandover', {
      ...base,
      shift: {
        reports: [
          { session: { cashierName: 'Cashier A', counterName: 'Main Counter', openedAt: '2026-06-21 09:00:00', closedAt: '2026-06-21 14:00:00', status: 'closed', openingCash: 1000 }, finance: { expectedCash: 5000, countedCash: 5000, variance: 0 }, expenses: [] },
          { session: { cashierName: 'Cashier B', counterName: 'Main Counter', openedAt: '2026-06-21 14:00:00', closedAt: '2026-06-21 20:00:00', status: 'closed', openingCash: 5000 }, finance: { expectedCash: 8000, countedCash: 7900, variance: -100 }, expenses: [] },
        ],
      },
    });
    expect(shiftHtml).toContain('Shift Sessions');
    expect(shiftHtml).toContain('Cashier B');
    expect(shiftHtml).toContain('৳13,000.00');
  });

  it('shows paid operating expenses and doctor payouts line by line', () => {
    const source = readFileSync('src/pages/ReceptionReportsPage.tsx', 'utf8');
    expect(source).toContain('collectionData?.expense_details');
    expect(source).not.toContain('dailyExpenses.slice(0, 8)');
    expect(source).toContain('Payment Method');
    expect(source).toContain('Paid Amount');
  });

  it('treats an explicit empty expense detail list as authoritative', () => {
    const source = readFileSync('src/pages/ReceptionReportsPage.tsx', 'utf8');
    expect(source).toContain('const paidExpenseDetails = collectionData?.expense_details;');
    expect(source).toContain('paidExpenseDetails !== undefined');
  });

  it('keeps expense recording in Cash Operations instead of the reports workspace', () => {
    const source = readFileSync('src/pages/ReceptionReportsPage.tsx', 'utf8');
    expect(source).not.toContain('/api/expenses');
    expect(source).toContain('/reception/cash-operations');
  });

  it('top-aligns the collection page title with wrapped date/PDF actions', () => {
    const source = readFileSync('src/pages/ReceptionReportsPage.tsx', 'utf8');
    expect(source).toContain('flex flex-col justify-between gap-3 sm:flex-row sm:items-start');
    expect(source).not.toContain('flex flex-col justify-between gap-3 sm:flex-row sm:items-center');
  });
});

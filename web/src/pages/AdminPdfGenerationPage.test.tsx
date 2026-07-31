import { describe, expect, it } from 'vitest';
import {
  buildDailyClosingPackBody,
  buildReportBody,
  reportOptions,
  type ReportType,
} from './AdminPdfGenerationPage';

const collectionFixture = {
  bill_summary: {
    gross_before_discount: 73_300,
    final_bill_amount: 67_300,
    paid_against_bills: 63_800,
    due_remaining: 3_500,
    discount_amount: 6_000,
    doctor_visit_bill_amount: 23_600,
    test_bill_amount: 43_700,
    other_bill_amount: 0,
  },
  finance_summary: {
    total_received: 69_400,
    cash_received: 40_000,
    current_collection: 59_150,
    due_collection: 6_050,
    deposit_collection: 4_200,
    total_returns: 700,
    total_discounts: 6_000,
  },
  summary: {
    total_bill: 67_300,
    total_collection: 69_400,
    total_deposit: 4_200,
    total_expense: 3_020,
    total_due: 3_500,
    net_income: 66_380,
    net_cash: 35_980,
    net_collection: 69_400,
    total_cash_sales: 59_150,
    total_collection_from_receivable: 6_050,
    total_deposit_collection: 4_200,
    total_sales_return: 700,
    total_deposit_return: 300,
    total_cash_discount_given: 6_000,
  },
  service_summary: {
    doctor_visit_count: 8,
    doctor_visit_amount: 23_600,
    test_count: 11,
    test_amount: 43_700,
  },
  service_collection_summary: {
    doctor_visit_collection: 23_600,
    test_collection: 41_600,
    other_collection: 0,
  },
  collection_sources: [
    { department: 'Doctor Visit / Consultation', amount: 23_600 },
    { department: 'Diagnostic / Laboratory', amount: 41_600 },
    { department: 'Deposits / Advances', amount: 4_200 },
  ],
  payment_methods: [
    { method: 'Cash', amount: 40_000, percentage: 57.64 },
    { method: 'bKash', amount: 29_400, percentage: 42.36 },
  ],
  expenses: [
    { expense_head: 'Transport', amount: 2_020 },
    { expense_head: 'Doctor payouts', amount: 1_000 },
  ],
  cash_closing: {
    net_cash_movement: 35_980,
    cash_in_hand: 36_480,
  },
  by_payment_method: [
    { payment_method: 'cash', transaction_count: 7, total_amount: 40_000 },
    { payment_method: 'bkash', transaction_count: 3, total_amount: 29_400 },
  ],
  by_employee: [
    {
      employee_id: 117,
      employee_name: 'Safaoat Ullah',
      cash_sales: 51_000,
      collection_from_receivable: 1_700,
      cash_discount_given: 500,
      sales_return: 300,
      deposit_return: 200,
      net: 52_200,
    },
  ],
  details: [
    { transaction_type: 'CashSales', payment_method: 'cash', invoice_no: 'INV-1001', amount: 12_500, created_at: '2026-06-30 09:00:00' },
    { transaction_type: 'SalesReturn', payment_method: 'cash', reference_id: 12, amount: 700, created_at: '2026-06-30 10:00:00' },
    { transaction_type: 'RefundDeposit', payment_method: 'cash', reference_id: 13, amount: 300, created_at: '2026-06-30 11:00:00' },
  ],
  discount_rows: [
    { transaction_type: 'CashDiscountGiven', description: 'Discount on INV-1001', employee_name: 'Safaoat Ullah', amount: 500, created_at: '2026-06-30 09:05:00' },
  ],
  invoice_summary_rows: [
    { source: 'Diagnostic', invoice_no: 'INV-1001', patient_name: 'Patient One', doctor_name: 'Dr. Rahman', status: 'partial', total_amount: 10_000, paid_amount: 7_000, due_amount: 3_000 },
  ],
  patient_registration_summary: {
    total_patients: 2,
    with_mobile: 1,
    by_gender: [{ gender: 'male', count: 1 }, { gender: 'female', count: 1 }],
  },
  patient_registration_rows: [
    { patient_code: 'P-1001', name: 'Patient One', mobile: '01700000000', gender: 'male', district: 'Barguna', upazila: 'Amtali', created_at: '2026-06-30 09:10:00' },
    { patient_code: 'P-1002', name: 'Patient Two', gender: 'female', district: 'Dhaka', upazila: 'Mirpur', created_at: '2026-06-30 09:20:00' },
  ],
  doctor_summaries: [
    {
      doctor_id: 7,
      doctor_name: 'Dr. Rahman',
      patient_count: 5,
      doctor_visit_count: 6,
      doctor_visit_amount: 5_300,
      consultation_commission_amount: 1_000,
      test_order_count: 4,
      test_count: 9,
      test_collection_amount: 12_000,
      test_commission_amount: 2_400,
      referral_commission_amount: 500,
      commission_amount: 3_900,
    },
  ],
  doctor_test_invoices: [
    {
      invoice_no: 'LAB-1001',
      invoice_date: '2026-06-30 10:30:00',
      patient_name: 'Patient One',
      doctor_name: 'Dr. Rahman',
      test_count: 3,
      gross_amount: 5_000,
      discount_amount: 500,
      test_collection_amount: 4_500,
      paid_amount: 3_500,
      due_amount: 1_000,
      test_commission_amount: 900,
    },
  ],
  report_delivery_summary: { total_orders: 2, ready_orders: 1, pending_orders: 1 },
  report_delivery_queue: [
    { order_no: 'LO-1001', patient_name: 'Patient One', invoice_no: 'LAB-1001', order_status: 'pending', due_amount: 1_000, ready_count: 2, delivered_count: 1, item_count: 3 },
  ],
  ipd_admission_summary: { new_admissions: 1, discharges: 1, running_admitted: 3 },
  ipd_admission_rows: [
    { admission_no: 'IPD-1001', patient_name: 'IPD Patient', doctor_name: 'Dr. Rahman', ward_name: 'Cabin', bed_number: 'B-12', status: 'admitted', admission_date: '2026-06-30 08:00:00' },
  ],
  service_item_sales_rows: [
    { item_category: 'test', description: 'CBC', quantity: 2, gross_amount: 1_000, discount_amount: 100, net_amount: 900 },
  ],
};

const reportData = {
  includeSummary: true,
  includeDetails: true,
  pageSize: 'a4' as const,
  orientation: 'portrait' as const,
  collection: collectionFixture,
  expenses: {
    expenses: [
      { date: '2026-06-30', category: 'Transport', description: 'Bank Joma+Gari Vara', status: 'approved', amount: 3_020 },
      { date: '2026-06-30', category: 'Lab', description: 'Eman Sir Ultra', status: 'pending', amount: 1_600 },
    ],
  },
  cashActivity: {
    activity: [
      { createdAt: '2026-06-30 09:00:00', movementType: 'cash_in', referenceType: 'bill', referenceId: 1001, description: 'Patient payment', amount: 12_500, actorName: 'Safaoat Ullah' },
      { createdAt: '2026-06-30 12:00:00', movementType: 'cash_out', referenceType: 'expense', referenceId: 7101, description: 'Expense payment', amount: 3_020, actorName: 'Admin User' },
    ],
  },
  shift: {
    reports: [
      {
        session: { cashierName: 'Safaoat Ullah', counterName: 'Reception-1', openedAt: '2026-06-30 08:00:00', closedAt: '2026-06-30 16:00:00', status: 'closed', openingCash: 500 },
        finance: { expectedCash: 3_250, countedCash: 3_250, variance: 0, totalCollection: 10_000 },
        expenses: [{ category: 'Transport', description: 'Bank Joma+Gari Vara', status: 'approved', amount: 3_020 }],
      },
    ],
  },
  dueBills: {
    bills: [
      { invoice_no: 'DUE-1001', patient_name: 'Due Patient', status: 'partial', total_amount: 10_000, paid_amount: 6_000, outstanding: 4_000 },
      { invoice_no: 'PAID-1002', patient_name: 'Paid Patient', status: 'paid', total_amount: 5_000, paid_amount: 5_000, outstanding: 0 },
    ],
  },
  discountReport: {
    summary: { total_discount_given: 500, discounted_bills_count: 1, average_discount: 500 },
    items: [{
      invoice_no: 'INV-1001',
      patient_name: 'Patient One',
      created_at: '2026-06-30 10:00:00',
      service: 'Discount on INV-1001',
      gross_amount: 5_000,
      discount_amount: 500,
      discount_percent: 10,
      reason: 'Management approval',
      approved_by: 'Dr. Rahman',
      given_by: 'Safaoat Ullah',
      user: 'Safaoat Ullah',
      counter: 'Reception-1',
    }],
  },
};

const reportCaseExpectations: Array<{ type: ReportType; expected: string[]; forbidden?: string[] }> = [
  { type: 'dailyCollection', expected: ['Total Collection Today', 'Department-wise Collection', 'Payment Method Summary', 'Transaction Details', '69,400.00', '41,600.00'] },
  { type: 'paymentMethod', expected: ['Payment Method Summary', 'cash', 'bkash', '40,000.00', '29,400.00'] },
  { type: 'userCollection', expected: ['User-wise Collection', 'Safaoat Ullah', '52,200.00', '1,700.00'] },
  { type: 'dueBills', expected: ['Due Bills', 'DUE-1001', 'Due Patient', '4,000.00'], forbidden: ['PAID-1002'] },
  { type: 'invoiceSummary', expected: ['Invoice Summary', 'INV-1001', 'Patient One', '3,000.00'] },
  { type: 'patientRegistration', expected: ['Patient Registration Summary', 'P-1001', '01700000000', 'Barguna, Amtali'] },
  { type: 'visitReport', expected: ['Visit Summary', 'Doctor Wise Visits', 'Dr. Rahman', '5,300.00', '1,000.00'] },
  { type: 'testReport', expected: ['Test Summary', 'LAB-1001', 'Patient One', '4,500.00', '1,000.00', '900.00'] },
  { type: 'reportDelivery', expected: ['Report Delivery Queue', 'LO-1001', 'LAB-1001', '2/3', '1/3'] },
  { type: 'doctorPerformance', expected: ['Category Summary', 'Doctor Wise Performance', 'Dr. Rahman', '12,000.00', '3,900.00'] },
  { type: 'doctorPayout', expected: ['Doctor Payout Estimate', 'Dr. Rahman', '1,000.00', '2,400.00', '3,900.00'] },
  { type: 'referralReport', expected: ['Referral / Doctor Test Business', 'Dr. Rahman', '12,000.00', '2,900.00'] },
  { type: 'departmentIncome', expected: ['Department / Service Billing &amp; Receipts', 'OPD / Doctor Visit Bill', 'Lab / Diagnostic Test Bill', '43,700.00', '41,600.00'] },
  { type: 'ipdAdmission', expected: ['IPD Admission Details', 'IPD-1001', 'Cabin / B-12', 'admitted'] },
  { type: 'serviceItemSales', expected: ['Service Item Sales', 'CBC', '900.00'] },
  { type: 'expenses', expected: ['Expense Category Summary', 'Transport', 'Bank Joma+Gari Vara', '3,020.00', '1,600.00'] },
  { type: 'cashActivity', expected: ['Cash Activity Category Summary', 'Patient payment', 'Expense payment', '12,500.00', '3,020.00'] },
  { type: 'dailyDiscount', expected: ['Discount Allocation Details', 'Discount on INV-1001', 'Safaoat Ullah', '500.00'] },
  { type: 'refundReport', expected: ['Refund / Return Details', 'SalesReturn', 'RefundDeposit', '700.00', '300.00'] },
  { type: 'shiftHandover', expected: ['Shift Sessions', 'Safaoat Ullah', 'Reception-1', '3,250.00', 'Bank Joma+Gari Vara'] },
  { type: 'auditLog', expected: ['Audit / Activity Log', 'Patient payment', 'Safaoat Ullah', '12,500.00'] },
];

function maxHeaderColumnCount(html: string): number {
  const headerRows = [...html.matchAll(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/g)];
  return headerRows.reduce((max, match) => Math.max(max, (match[1].match(/<th\b/g) ?? []).length), 0);
}

const detailToggleCases: Array<{ type: ReportType; marker: string }> = [
  { type: 'userCollection', marker: 'Safaoat Ullah' },
  { type: 'invoiceSummary', marker: 'INV-1001' },
  { type: 'patientRegistration', marker: 'P-1001' },
  { type: 'ipdAdmission', marker: 'IPD-1001' },
  { type: 'serviceItemSales', marker: 'CBC' },
  { type: 'visitReport', marker: 'Dr. Rahman' },
  { type: 'testReport', marker: 'LAB-1001' },
  { type: 'doctorPerformance', marker: 'Dr. Rahman' },
  { type: 'doctorPayout', marker: 'Dr. Rahman' },
  { type: 'referralReport', marker: 'Dr. Rahman' },
  { type: 'expenses', marker: 'Bank Joma+Gari Vara' },
  { type: 'dailyDiscount', marker: 'INV-1001' },
  { type: 'refundReport', marker: 'SalesReturn' },
  { type: 'cashActivity', marker: 'Patient payment' },
  { type: 'auditLog', marker: 'Patient payment' },
  { type: 'dueBills', marker: 'DUE-1001' },
  { type: 'reportDelivery', marker: 'LO-1001' },
  { type: 'shiftHandover', marker: 'Safaoat Ullah' },
];

describe('AdminPdfGenerationPage report body', () => {
  it('has a coverage expectation for every configured PDF report type', () => {
    expect(reportCaseExpectations.map((item) => item.type).sort()).toEqual(reportOptions.map((option) => option.value).sort());
  });

  it.each(reportCaseExpectations)('renders correct mapped information for $type PDF', ({ type, expected, forbidden = [] }) => {
    const html = buildReportBody(type, reportData);

    for (const text of expected) expect(html).toContain(text);
    for (const text of forbidden) expect(html).not.toContain(text);
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('[object Object]');
  });

  it('keeps the daily collection PDF operational without reconciliation clutter', () => {
    const html = buildReportBody('dailyCollection', reportData);

    expect(html).toContain('<span>Total Billed Today</span>');
    expect(html).toContain('<span>Total Collection Today</span>');
    expect(html).toContain('<span>Total Deposit Today</span>');
    expect(html).toContain('<span>Total Expense</span>');
    expect(html).toContain('<span>Total Due Today</span>');
    expect(html).toContain('<span>Net Cash Today</span>');
    expect(html).not.toContain('<span>Cash in Hand</span>');
    expect(html).toContain('Operational Collection Summary');
    expect(html).toContain('Department-wise Collection');
    expect(html).toContain('Payment Method Summary');
    expect(html).toContain('<h3>Expense</h3>');
    expect(html).toContain('Transaction Details');
    expect(html).toContain('Share');
    expect(html).not.toContain('Bill Reconciliation');
    expect(html).not.toContain('Management Income Reconciliation');
    expect(html).not.toContain('Receipt Collection Summary');
    expect(html).not.toContain('Service-wise Receipt Allocation');
  });

  it('uses deposit-inclusive collection and normalized net cash fields', () => {
    const html = buildReportBody('dailyCollection', {
      includeSummary: true,
      includeDetails: false,
      pageSize: 'a4',
      orientation: 'portrait',
      collection: {
        ...collectionFixture,
        finance_summary: {
          ...collectionFixture.finance_summary,
          total_received: 15_300,
          deposit_collection: 300,
        },
        summary: {
          ...collectionFixture.summary,
          total_collection: 15_000,
          total_deposit: 300,
          total_expense: 2_190,
          net_income: 12_810,
          net_cash: 88_888,
        },
        collection_sources: [
          { department: 'Doctor Visit / Consultation', amount: 10_000 },
          { department: 'Diagnostic / Laboratory', amount: 5_000 },
          { department: 'Deposits / Advances', amount: 300 },
        ],
        payment_methods: [
          { method: 'Cash', amount: 10_000 },
          { method: 'bKash', amount: 5_300 },
        ],
        expenses: [{ expense_head: 'Operations', amount: 2_190 }],
        cash_closing: { net_cash_movement: 13_110, cash_in_hand: 99_999 },
      },
    });

    expect(html).toContain('৳15,300.00');
    expect(html).toContain('Deposits / Advances');
    expect(html).toContain('৳300.00');
    expect(html).toContain('৳2,190.00');
    expect(html).toContain('৳13,110.00');
    expect(html).not.toContain('৳12,810.00');
    expect(html).not.toContain('৳88,888.00');
    expect(html).not.toContain('৳99,999.00');
    expect(html).not.toContain('Net Income');
  });

  it('honors the discount detail toggle', () => {
    const html = buildReportBody('dailyDiscount', {
      ...reportData,
      includeDetails: false,
    });

    expect(html).toContain('Total Discount Given');
    expect(html).not.toContain('Discount Allocation Details');
    expect(html).not.toContain('INV-1001');
  });

  it('uses compact bounded discount details on A5', () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      ...reportData.discountReport.items[0],
      invoice_no: `INV-${String(index + 1).padStart(2, '0')}`,
    }));
    const html = buildReportBody('dailyDiscount', {
      ...reportData,
      pageSize: 'a5',
      orientation: 'portrait',
      discountReport: { ...reportData.discountReport, items },
    });

    expect(html).toContain('Discount Allocation Details (first 24)');
    expect(html).toContain('INV-24');
    expect(html).not.toContain('INV-25');
    expect(html).not.toContain('Date &amp; Time');
    expect(html).not.toContain('Approved By');
  });

  it('labels user-wise discounts as non-cash and net as cash-in', () => {
    const html = buildReportBody('userCollection', reportData);

    expect(html).toContain('Invoice Discount (Non-cash)');
    expect(html).toContain('Net Cash In');
    expect(html).not.toContain('<th class="right">Discount</th>');
  });

  it('uses reconciled management and physical-cash totals in the daily closing pack', () => {
    const html = buildDailyClosingPackBody(reportData);

    expect(html).toContain('Management Closing Position');
    expect(html).toContain('<span>Total Collection</span><strong>৳69,400.00</strong>');
    expect(html).toContain('<span>Total Expense</span><strong>৳3,020.00</strong>');
    expect(html).toContain('<span>Net Income</span><strong>৳66,380.00</strong>');
    expect(html).toContain('<span>Physical Net Cash</span><strong>৳35,980.00</strong>');
    expect(html).toContain('Expense Report');
  });

  it('distinguishes submitted expense requests from approved requests', () => {
    const html = buildReportBody('expenses', reportData);

    expect(html).toContain('Submitted Amount');
    expect(html).toContain('Approved Requests');
    expect(html).toContain('Pending Requests');
    expect(html).toContain('Approved Expense Category Summary');
    expect(html).toContain('Approval Status Summary');
    expect(html).not.toContain('<span>Total Expenses</span>');
  });

  it('uses billed-versus-received terminology across service and clinical financial PDFs', () => {
    const departmentHtml = buildReportBody('departmentIncome', reportData);
    const serviceHtml = buildReportBody('serviceItemSales', reportData);
    const visitHtml = buildReportBody('visitReport', reportData);
    const testHtml = buildReportBody('testReport', reportData);
    const doctorPerformanceHtml = buildReportBody('doctorPerformance', reportData);
    const doctorPayoutHtml = buildReportBody('doctorPayout', reportData);
    const referralHtml = buildReportBody('referralReport', reportData);

    expect(departmentHtml).toContain('Department / Service Billing &amp; Receipts');
    expect(departmentHtml).toContain('Service-wise Receipt Allocation');
    expect(departmentHtml).not.toContain('Service-wise Cash Collection');
    expect(serviceHtml).toContain('Net Billed Sales');
    expect(visitHtml).toContain('Visit Bill Amount');
    expect(visitHtml).toContain('Commission Accrued');
    expect(visitHtml).not.toContain('Visit Net');
    expect(testHtml).toContain('Net Test Bill');
    expect(testHtml).toContain('Allocated Test Receipts');
    expect(doctorPerformanceHtml).toContain('Billed Amount');
    expect(doctorPerformanceHtml).toContain('Commission Accrued');
    expect(doctorPerformanceHtml).not.toContain('Visit Collection');
    expect(doctorPerformanceHtml).not.toContain('<th class="right">Net</th>');
    expect(doctorPayoutHtml).toContain('Visit Commission Accrued');
    expect(doctorPayoutHtml).toContain('Estimated Payable');
    expect(referralHtml).toContain('Net Test Bill');
    expect(referralHtml).toContain('Commission Accrued');
    expect(referralHtml).not.toContain('Test Collection');
  });

  it('renders the approved daily collection operational summary from normalized totals', () => {
    const html = buildReportBody('dailyCollection', reportData);

    expect(html).toContain('৳67,300.00');
    expect(html).toContain('৳69,400.00');
    expect(html).toContain('৳4,200.00');
    expect(html).toContain('৳3,020.00');
    expect(html).toContain('৳3,500.00');
    expect(html).toContain('৳35,980.00');
    expect(html).not.toContain('৳36,480.00');
    expect(html).toContain('Deposits Included in Total');
    expect(html).toContain('Doctor Visit / Consultation');
    expect(html).toContain('Diagnostic / Laboratory');
    expect(html).toContain('Deposits / Advances');
    expect(html).toContain('57.6%');
    expect(html).toContain('42.4%');
    expect(html).toContain('Doctor payouts');
    expect(html).toContain('Cash sales');
    expect(html).toContain('<th>Payment Method</th>');
    expect(html).toContain('<th>Invoice / Reference</th>');
    expect(html).toContain('INV-1001');
  });

  it('preserves negative net cash, empty states, and the details toggle', () => {
    const html = buildReportBody('dailyCollection', {
      includeSummary: true,
      includeDetails: false,
      pageSize: 'a4',
      orientation: 'portrait',
      collection: {
        bill_summary: { final_bill_amount: 2_000, due_remaining: 150 },
        finance_summary: { total_received: 12_345, deposit_collection: 345 },
        summary: {
          total_bill: 1_900,
          total_collection: 99_999,
          total_deposit: 999,
          total_expense: 500,
          total_due: 125,
          net_cash: 88_888,
        },
        cash_closing: { net_cash_movement: -250, cash_in_hand: 9_999 },
        collection_sources: [],
        payment_methods: [],
        expenses: [],
        details: [{ transaction_type: 'CashSales', amount: 12_345 }],
      },
    });

    expect(html).toContain('৳1,900.00');
    expect(html).toContain('৳12,345.00');
    expect(html).toContain('৳345.00');
    expect(html).toContain('৳500.00');
    expect(html).toContain('৳125.00');
    expect(html).toContain('৳-250.00');
    expect(html).not.toContain('৳99,999.00');
    expect(html).not.toContain('৳88,888.00');
    expect(html).not.toContain('৳9,999.00');
    expect(html).toContain('No collection source data found.');
    expect(html).toContain('No payment method data found.');
    expect(html).toContain('No expense data found.');
    expect(html).not.toContain('Transaction Details');
    expect(html).not.toContain('Cash sales');
  });

  it('keeps doctor visit net equal to visit collection even when visit payable exceeds collection', () => {
    const html = buildReportBody('doctorPerformance', {
      includeSummary: true,
      includeDetails: true,
      pageSize: 'a4',
      orientation: 'portrait',
      collection: {
        doctor_summaries: [
          {
            doctor_name: 'Dr. Visit Payable',
            patient_count: 19,
            doctor_visit_count: 19,
            doctor_visit_amount: 5300,
            consultation_commission_amount: 5600,
            test_order_count: 0,
            test_count: 0,
            test_collection_amount: 0,
            test_commission_amount: 0,
            referral_commission_amount: 0,
            commission_amount: 5600,
          },
        ],
      },
    });

    expect(html).toContain('Consultation / Doctor Visit');
    expect(html).toContain('৳5,300.00');
    expect(html).toContain('৳5,600.00');
    expect(html).not.toContain('৳-300.00');
  });

  it('builds the daily closing PDF pack from the priority end-of-day reports', () => {
    const html = buildDailyClosingPackBody({
      includeSummary: true,
      includeDetails: false,
      pageSize: 'a4',
      orientation: 'portrait',
      collection: {
        bill_summary: {},
        finance_summary: {},
        summary: {},
        service_summary: {},
        service_collection_summary: {},
        by_payment_method: [],
        details: [],
        doctor_summaries: [],
      },
      dueBills: { bills: [] },
      cashActivity: { activity: [] },
      shift: { reports: [] },
    });

    expect(html).toContain('Daily Collection Report');
    expect(html).toContain('Doctor Performance Report');
    expect(html).toContain('Payment Method Report');
    expect(html).toContain('Shift Handover Report');
    expect(html).toContain('report-pack-section-break');
  });

  it('uses the server management totals in the daily closing pack header', () => {
    const html = buildDailyClosingPackBody({
      ...reportData,
      collection: {
        ...collectionFixture,
        summary: {
          ...collectionFixture.summary,
          total_collection: 15_000,
          total_expense: 7_718,
          net_income: 7_282,
          net_cash: 7_282,
        },
        finance_summary: {
          ...collectionFixture.finance_summary,
          total_received: 99_999,
          total_returns: 9_999,
        },
      },
    });

    const managementHeader = html.split('report-pack-section-break')[0];
    expect(managementHeader).toContain('Management Closing Position');
    expect(managementHeader).toContain('<span>Total Collection</span><strong>৳15,000.00</strong>');
    expect(managementHeader).toContain('<span>Total Expense</span><strong>৳7,718.00</strong>');
    expect(managementHeader).toContain('<span>Net Income</span><strong>৳7,282.00</strong>');
    expect(managementHeader).toContain('<span>Physical Net Cash</span><strong>৳7,282.00</strong>');
    expect(managementHeader).not.toContain('Net Receipts After Returns &amp; Expenses');
    expect(managementHeader).not.toContain('৳99,999.00');
  });

  it('renders every report safely with empty API data', () => {
    for (const option of reportOptions) {
      expect(() => buildReportBody(option.value, {
        includeSummary: true,
        includeDetails: true,
        pageSize: 'a4',
        orientation: 'portrait',
      })).not.toThrow();
      const html = buildReportBody(option.value, {
        includeSummary: true,
        includeDetails: true,
        pageSize: 'a4',
        orientation: 'portrait',
      });
      expect(html, option.value).not.toContain('undefined');
      expect(html, option.value).not.toContain('[object Object]');
    }
  });

  it.each(detailToggleCases)('hides $type detail rows when details are disabled', ({ type, marker }) => {
    const html = buildReportBody(type, { ...reportData, includeDetails: false });
    expect(html).not.toContain(marker);
  });

  it('uses approval_status as expense request truth and shows payment status separately', () => {
    const html = buildReportBody('expenses', {
      ...reportData,
      expenses: {
        expenses: [
          {
            date: '2026-07-12',
            category: 'Utilities',
            description: 'Generator fuel',
            approval_status: 'approved',
            status: 'pending',
            payment_status: 'paid',
            amount: 3_020,
          },
          {
            date: '2026-07-12',
            category: 'Supplies',
            description: 'Pending stationery',
            approval_status: 'pending',
            status: 'approved',
            payment_status: 'unpaid',
            amount: 1_600,
          },
        ],
      },
    });

    expect(html).toContain('<span>Approved Requests</span><strong>৳3,020.00</strong>');
    expect(html).toContain('<span>Pending Requests</span><strong>৳1,600.00</strong>');
    expect(html).toContain('<th>Approval</th>');
    expect(html).toContain('<th>Payment</th>');
  });

  it('keeps every A5 report table at five columns or fewer', () => {
    for (const option of reportOptions) {
      const html = buildReportBody(option.value, {
        ...reportData,
        pageSize: 'a5',
        orientation: 'landscape',
      });
      expect(maxHeaderColumnCount(html), option.value).toBeLessThanOrEqual(5);
    }
  });

  it('keeps every A4 portrait report table at seven columns or fewer', () => {
    for (const option of reportOptions) {
      const html = buildReportBody(option.value, {
        ...reportData,
        pageSize: 'a4',
        orientation: 'portrait',
      });
      expect(maxHeaderColumnCount(html), option.value).toBeLessThanOrEqual(7);
    }
  });

  it('labels A4 detail truncation instead of silently dropping rows', () => {
    const users = Array.from({ length: 501 }, (_, index) => ({
      employee_name: `User ${index + 1}`,
      cash_sales: 100,
      collection_from_receivable: 0,
      cash_discount_given: 0,
      sales_return: 0,
      deposit_return: 0,
      net: 100,
    }));
    const html = buildReportBody('userCollection', {
      ...reportData,
      pageSize: 'a4',
      orientation: 'portrait',
      collection: { ...collectionFixture, by_employee: users },
    });

    expect(html).toContain('User-wise Collection (first 500)');
    expect(html).toContain('User 500');
    expect(html).not.toContain('User 501');
  });
});

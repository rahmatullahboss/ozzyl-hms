import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvoiceItemsTab from './InvoiceItemsTab';
import InvoicePaymentsTab from './InvoicePaymentsTab';
import InvoiceDiscountTab from './InvoiceDiscountTab';
import InvoiceCompensationTab from './InvoiceCompensationTab';
import InvoiceAuditTab from './InvoiceAuditTab';
import type {
  InvoiceInspectorAuditEvent,
  InvoiceInspectorCompensation,
  InvoiceInspectorDeposit,
  InvoiceInspectorDiscountAllocation,
  InvoiceInspectorItem,
  InvoiceInspectorPayment,
} from '../../types/invoiceInspector';

const items: InvoiceInspectorItem[] = [{
  id: 11,
  category: 'test',
  description: 'CBC',
  quantity: 1,
  rate: 1200,
  lineTotal: 1000,
  orderingDoctorName: 'Dr. Ordering',
  referringDoctorName: 'Dr. Referrer',
  performingDoctorName: 'Dr. Performer',
  verifyingDoctorName: 'Dr. Verifier',
}];

const payments: InvoiceInspectorPayment[] = [{
  id: 21,
  receiptNo: 'RCPT-21',
  method: 'cash',
  paymentType: 'partial',
  amount: 600,
  collectorName: 'Cashier One',
  counterName: 'Main Counter',
  paidAt: '2026-07-30 11:00:00',
  status: 'posted',
}];

const deposits: InvoiceInspectorDeposit[] = [{
  id: 31,
  referenceNo: 'DEP-31',
  amount: 200,
  adjustmentType: 'applied',
  paymentMethod: 'cash',
  occurredAt: '2026-07-30 11:05:00',
  status: 'active',
}];

const discounts: InvoiceInspectorDiscountAllocation[] = [{
  id: 41,
  amount: 200,
  referenceName: 'Welfare desk',
  reason: 'Patient support',
  sourceType: 'hospital_funded',
  funderType: 'hospital',
}];

const compensation: InvoiceInspectorCompensation[] = [{
  id: 51,
  doctorId: 7,
  doctorName: 'Dr. Referrer',
  sourceType: 'lab_test',
  incentiveType: 'prescriber',
  ruleId: 77,
  ruleVersion: 4,
  grossAmount: 1000,
  discountAmount: 200,
  performerReserveAmount: 100,
  eligibleBaseAmount: 700,
  rateLabel: '12.50%',
  earnedAmount: 100,
  waiverAmount: 20,
  adjustmentAmount: -5,
  payableAmount: 75,
  paidAmount: 30,
  outstandingAmount: 45,
  status: 'partially_paid',
  reasonCode: 'doctor_waived',
  reasonLabel: 'Doctor waived commission',
  settlementNo: 'SET-7',
}];

const audit: InvoiceInspectorAuditEvent[] = [{
  id: 'payment:21',
  occurredAt: '2026-07-30 11:00:00',
  eventType: 'payment',
  actorName: 'Cashier One',
  referenceNo: 'RCPT-21',
  status: 'posted',
  description: 'Payment collected',
}];

describe('invoice inspector evidence tabs', () => {
  it('shows item doctor roles separately in responsive cards', () => {
    render(<InvoiceItemsTab items={items} />);
    expect(screen.getByText('CBC')).toBeInTheDocument();
    expect(screen.getByText('Ordering doctor')).toBeInTheDocument();
    expect(screen.getByText('Dr. Ordering')).toBeInTheDocument();
    expect(screen.getByText('Referring doctor')).toBeInTheDocument();
    expect(screen.getByText('Dr. Referrer')).toBeInTheDocument();
    expect(screen.getByText('Performing doctor')).toBeInTheDocument();
    expect(screen.getByText('Dr. Performer')).toBeInTheDocument();
    expect(screen.getByText('Verifying doctor')).toBeInTheDocument();
    expect(screen.getByText('Dr. Verifier')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps cash payments and deposit adjustments in separate sections', () => {
    render(<InvoicePaymentsTab payments={payments} deposits={deposits} />);
    expect(screen.getByRole('heading', { name: 'Cash and other payments' })).toBeInTheDocument();
    expect(screen.getByText('RCPT-21')).toBeInTheDocument();
    expect(screen.getByText('Cashier One')).toBeInTheDocument();
    expect(screen.getByText('Main Counter')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deposit adjustments' })).toBeInTheDocument();
    expect(screen.getByText('DEP-31')).toBeInTheDocument();
    expect(screen.getByText(/Applied/)).toBeInTheDocument();
  });

  it('shows discount source and funder rather than only a reference name', () => {
    render(<InvoiceDiscountTab discounts={discounts} />);
    expect(screen.getByText('Welfare desk')).toBeInTheDocument();
    expect(screen.getByText('Patient support')).toBeInTheDocument();
    expect(screen.getByText('Hospital Funded')).toBeInTheDocument();
    expect(screen.getByText('Hospital')).toBeInTheDocument();
  });

  it('uses the shared commission calculation bridge', () => {
    render(<InvoiceCompensationTab compensation={compensation} />);
    expect(screen.getByLabelText('Dr. Referrer compensation calculation')).toBeInTheDocument();
    expect(screen.getByText('Rule 77 · version 4')).toBeInTheDocument();
    expect(screen.getByText('Doctor waived commission')).toBeInTheDocument();
    expect(screen.getByText('৳-5.00')).toBeInTheDocument();
  });

  it('shows audit time, event, actor, and reference without raw payloads', () => {
    render(<InvoiceAuditTab audit={audit} />);
    expect(screen.getByText('Payment collected')).toBeInTheDocument();
    expect(screen.getByText('Cashier One')).toBeInTheDocument();
    expect(screen.getByText('RCPT-21')).toBeInTheDocument();
    expect(screen.getByText(/2026-07-30 11:00:00/)).toBeInTheDocument();
    expect(screen.queryByText(/old_value|new_value|payload/i)).not.toBeInTheDocument();
  });

  it('explains empty evidence sections', () => {
    const { rerender } = render(<InvoiceItemsTab items={[]} />);
    expect(screen.getByText('No invoice items or tests were found.')).toBeInTheDocument();
    rerender(<InvoicePaymentsTab payments={[]} deposits={[]} />);
    expect(screen.getByText('No payments or deposit adjustments were found.')).toBeInTheDocument();
    rerender(<InvoiceDiscountTab discounts={[]} />);
    expect(screen.getByText('No discount or referral allocations were found.')).toBeInTheDocument();
    rerender(<InvoiceCompensationTab compensation={[]} />);
    expect(screen.getByText('No doctor compensation rows were found.')).toBeInTheDocument();
    rerender(<InvoiceAuditTab audit={[]} />);
    expect(screen.getByText('No invoice audit events were found.')).toBeInTheDocument();
  });
});

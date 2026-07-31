import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DiagnosticInvoiceBody from './DiagnosticInvoiceBody';

const labels = {
  patient: 'Patient',
  patientId: 'Patient ID',
  ageGender: 'Age / Gender',
  referredBy: 'Referred By',
  self: 'Self',
  testName: 'Test Name',
  category: 'Category',
  amount: 'Amount (BDT)',
};

const patient = {
  name: 'Setu',
  code: 'P-000046',
  mobile: '',
  address: '',
  age: '27',
  gender: 'female',
};

const item = {
  id: 1,
  item_category: 'test',
  description: 'Blood Grouping',
  quantity: 1,
  unit_price: 100,
};

describe('DiagnosticInvoiceBody', () => {
  it('renders patient name, mobile, patient ID, age/gender, and Self referrer boxes', () => {
    render(
      <DiagnosticInvoiceBody
        patient={{ ...patient, mobile: '01700000000' }}
        items={[item]}
        money={(amount) => `৳${amount}.00`}
        labels={labels}
      />,
    );

    expect(screen.getByText('Patient')).toBeInTheDocument();
    expect(screen.getByText('Setu')).toBeInTheDocument();
    expect(screen.getByText('01700000000')).toBeInTheDocument();
    expect(screen.getByText('Patient ID')).toBeInTheDocument();
    expect(screen.getByText('P-000046')).toBeInTheDocument();
    expect(screen.getByText('Age / Gender')).toBeInTheDocument();
    expect(screen.getByText('27 / female')).toBeInTheDocument();
    expect(screen.getByText('Referred By')).toBeInTheDocument();
    expect(screen.getByText('Self')).toBeInTheDocument();
  });

  it('renders a doctor name in the wider referrer box when supplied', () => {
    render(
      <DiagnosticInvoiceBody
        patient={patient}
        referredBy="Dr. Khandakar Rejwanur Rahman"
        items={[item]}
        money={(amount) => `৳${amount}.00`}
        labels={labels}
      />,
    );

    expect(screen.getByText('Referred By')).toBeInTheDocument();
    expect(screen.getByText('Dr. Khandakar Rejwanur Rahman')).toBeInTheDocument();
  });
});

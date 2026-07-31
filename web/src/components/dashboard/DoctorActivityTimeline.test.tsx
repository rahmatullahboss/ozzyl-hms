import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DoctorActivityTimeline from './DoctorActivityTimeline';
import type { DoctorActivityRow } from '../../types/executiveDashboard';

const rows: DoctorActivityRow[] = [
  {
    eventId: 'commission:91',
    eventType: 'commission_accrued',
    occurredAt: '2026-07-30 14:00:00',
    sourceType: 'doctor_commission_accrual',
    sourceId: '91',
    doctorId: 17,
    billId: 701,
    invoiceNo: 'INV-701',
    patientId: 41,
    patientName: 'Patient One',
    patientIdentityRedacted: false,
    title: 'CBC commission',
    amount: 125,
    status: 'accrued',
    reasonCode: 'rule_matched',
  },
  {
    eventId: 'settlement:11',
    eventType: 'commission_settled',
    occurredAt: '2026-07-28 16:30:00',
    sourceType: 'doctor_commission_settlement',
    sourceId: '11',
    doctorId: 17,
    billId: null,
    invoiceNo: null,
    patientId: null,
    patientName: null,
    patientIdentityRedacted: false,
    title: 'Commission settlement SET-11',
    amount: 75,
    status: 'paid',
    reasonCode: null,
  },
];

describe('DoctorActivityTimeline', () => {
  it('renders occurrence-ordered evidence as stacked timeline cards', () => {
    render(<DoctorActivityTimeline rows={rows} />);
    expect(screen.getByRole('list', { name: 'Doctor activity timeline' })).toBeInTheDocument();
    expect(screen.getByText('CBC commission')).toBeInTheDocument();
    expect(screen.getByText('Commission settlement SET-11')).toBeInTheDocument();
    expect(screen.getByText('Patient One')).toBeInTheDocument();
    expect(screen.getByText('Rule matched')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('opens invoices only for events with a stable bill ID', () => {
    const onInvoiceOpen = vi.fn();
    render(<DoctorActivityTimeline rows={rows} onInvoiceOpen={onInvoiceOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-701' }));
    expect(onInvoiceOpen).toHaveBeenCalledWith(701);
    expect(screen.queryByRole('button', { name: /SET-11/ })).not.toBeInTheDocument();
  });

  it('explains server-side patient redaction', () => {
    render(<DoctorActivityTimeline rows={[{
      ...rows[0],
      patientId: null,
      patientName: null,
      patientIdentityRedacted: true,
    }]} />);
    expect(screen.getByText('Patient identity hidden by permission')).toBeInTheDocument();
  });
});

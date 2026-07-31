import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { buildProvisionalChargePayload, getIpdProvisionalDisplayTotal, ProvisionalBillingModal } from './ProvisionalBillingModal';
import { api } from '../../lib/apiClient';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));


vi.mock('../ipd/DoctorRoundForm', () => ({
  default: (props: any) => (
    <div data-testid="doctor-round-form">
      <span>{props.patientName}|{props.admissionNo}|{props.entrySource}</span>
      <button type="button" onClick={props.onSuccess}>Mock round success</button>
      <button type="button" onClick={props.onCancel}>Mock round cancel</button>
    </div>
  ),
}));

vi.mock('../../lib/apiClient', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockApiGet = vi.mocked(api.get);
const mockApiPost = vi.mocked(api.post);
const mockApiPut = vi.mocked(api.put);
const mockApiDelete = vi.mocked(api.delete);

function formatBDT(value: number) {
  return `৳${Number(value).toLocaleString('en-BD')}`;
}

describe('ProvisionalBillingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiPut.mockResolvedValue({ success: true });
    mockApiPost.mockResolvedValue({ success: true });
    mockApiDelete.mockResolvedValue({ success: true });
    mockApiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ip-billing/patients')) {
        return {
          data: [
            {
              admission_id: 53,
              admission_number: 'ADM-000053',
              patient_id: 277,
              patient_name: 'Clean-Discharge-1779346407553',
              patient_code: 'P-000277',
              ward_name: 'ward B',
              bed_number: 'a87',
              doctor_name: 'Dr. Dr Rahman',
              date_of_birth: '1991-01-01',
              patient_address: 'Mirpur, Dhaka',
              admitted_date: '2026-07-26T08:45:00+06:00',
              total_charges: 300780,
              total_paid: 233050,
              balance: 468170,
              deposit_balance: 468170,
            },
          ],
        };
      }
      if (url === '/api/ip-billing/pending/53') {
        return {
          items: [],
          bed_charges: { segments: [], bed_total: 0 },
          settled_bills: [
            {
              id: 901,
              invoice_no: 'BL-000901',
              created_at: '2026-05-22T10:20:00',
              total: 233050,
              paid: 0,
              deposit_deducted: 233050,
              due: 0,
              status: 'paid',
            },
          ],
          summary: {
            provisional_total: 0,
            bed_total: 0,
            grand_total: 0,
            running_total: 0,
            settled_total: 233050,
            settled_cash_paid: 0,
            settled_deposit_used: 233050,
            deposit_balance: 468170,
            deposit_total: 1002000,
            deposit_used: 233050,
            net_payable: 0,
            refund_available: 468170,
          },
        };
      }
      if (url.startsWith('/api/billing-master/service-departments')) return { data: [] };
      if (url.startsWith('/api/billing-master/service-items')) return { data: [] };
      if (url === '/api/doctors') return { doctors: [{ id: 7, name: 'Dr. Surgeon', specialty: 'Surgery' }] };
      if (url === '/api/admissions/available-beds-with-pricing') {
        return {
          beds: [{
            id: 88,
            ward_name: 'Cabin',
            bed_number: 'C-02',
            bed_type: 'cabin',
            effective_rate: 2500,
          }],
        };
      }
      return {};
    });
  });

  it('shows patient name, age, address, admission time, and one normalized doctor prefix', async () => {
    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
      />,
    );

    const patientButton = await screen.findByRole('button', { name: /Clean-Discharge-1779346407553/ });
    const content = patientButton.textContent ?? '';

    const ageText = within(patientButton).getByText(/^\d+Y(?: \d+M)?$/).textContent ?? '';
    expect(ageText).not.toBe('');
    expect(within(patientButton).getByText('Mirpur, Dhaka')).toBeInTheDocument();
    expect(within(patientButton).getByText(/Admitted 26-07-2026 08:45:00 AM/)).toBeInTheDocument();
    expect(within(patientButton).getByText(/Dr\. Rahman/)).toBeInTheDocument();
    expect(within(patientButton).queryByText(/Dr\. Dr/)).not.toBeInTheDocument();
    expect(content.indexOf('Clean-Discharge-1779346407553')).toBeLessThan(content.indexOf(ageText));
    expect(content.indexOf(ageText)).toBeLessThan(content.indexOf('Mirpur, Dhaka'));

    fireEvent.click(screen.getByText('Clean-Discharge-1779346407553'));
    expect(await screen.findByText('Mirpur, Dhaka')).toBeInTheDocument();
    expect(screen.getAllByText(ageText).length).toBeGreaterThan(0);
    expect(screen.getByText(/Admitted 26-07-2026 08:45:00 AM/)).toBeInTheDocument();
  });

  it('uses canonical UTC admission time and keeps patient identity readable on one line', async () => {
    mockApiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ip-billing/patients')) {
        return {
          data: [{
            admission_id: 1146,
            admission_number: 'ADM-001146',
            patient_id: 1146,
            patient_name: 'Sohorab Sikder',
            patient_code: 'P-001146',
            date_of_birth: '1956-01-01',
            patient_address: 'Dholua',
            ward_name: 'General Ward 305',
            bed_number: '2',
            admitted_date: '2026-07-29 05:46:53',
            admitted_at_utc: '2026-07-29T05:46:53.000Z',
            total_charges: 400,
            total_paid: 0,
            balance: 400,
          }],
        };
      }
      if (url === '/api/ip-billing/pending/1146') {
        return {
          items: [],
          bed_charges: { segments: [], bed_total: 0 },
          settled_bills: [],
          summary: {
            provisional_total: 400,
            bed_total: 0,
            grand_total: 400,
            running_total: 400,
            settled_total: 0,
            settled_cash_paid: 0,
            settled_deposit_used: 0,
            deposit_balance: 0,
            deposit_total: 0,
            deposit_used: 0,
            net_payable: 400,
            refund_available: 0,
          },
        };
      }
      return {};
    });

    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
      />,
    );

    const patientButton = await screen.findByRole('button', { name: /Sohorab Sikder/ });
    const name = within(patientButton).getByText('Sohorab Sikder');
    const age = within(patientButton).getByText(/^\d+Y(?: \d+M)?$/);
    const address = within(patientButton).getByText('Dholua');
    const identityLine = name.parentElement;

    expect(identityLine).not.toBeNull();
    expect(identityLine).toContainElement(age);
    expect(identityLine).toContainElement(address);
    expect(identityLine).toHaveClass('whitespace-nowrap', 'overflow-hidden', 'text-sm', 'font-semibold');
    expect(name).not.toHaveClass('text-xs');
    expect(age).not.toHaveClass('text-xs');
    expect(address).not.toHaveClass('text-xs');

    const metadata = within(patientButton).getByText(/P-001146/);
    expect(metadata).toHaveClass('text-sm', 'font-medium');
    expect(metadata).not.toHaveClass('text-[var(--color-text-muted)]');

    const admitted = within(patientButton).getByText('Admitted 29-07-2026 11:46:53 AM');
    expect(admitted).toHaveClass('text-sm', 'font-medium');
    expect(admitted).not.toHaveClass('text-[var(--color-text-muted)]');

    fireEvent.click(name);
    const selectedName = await screen.findByText('Sohorab Sikder');
    const selectedIdentityLine = selectedName.parentElement;
    expect(selectedIdentityLine).toHaveClass('whitespace-nowrap', 'overflow-hidden', 'text-sm', 'font-semibold');
    expect(screen.getByText('Admitted 29-07-2026 11:46:53 AM')).toHaveClass('text-sm', 'font-medium');
  });

  it('formats running and settled billing timestamps in Dhaka regardless of host timezone', async () => {
    mockApiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ip-billing/patients')) {
        return {
          data: [{
            admission_id: 53,
            admission_number: 'ADM-000053',
            patient_id: 277,
            patient_name: 'Time Patient',
            patient_code: 'P-000277',
            date_of_birth: '1991-01-01',
            patient_address: 'Mirpur, Dhaka',
            admitted_date: '2026-06-18T08:00:00Z',
            total_charges: 300,
            total_paid: 0,
            balance: 300,
          }],
        };
      }
      if (url === '/api/ip-billing/pending/53') {
        return {
          items: [{
            id: 1,
            item_name: 'Doctor Visit',
            item_category: 'doctor_round',
            unit_price: 100,
            quantity: 1,
            total_amount: 100,
            created_at: '2026-06-18T08:00:00Z',
            bill_status: 'provisional',
          }],
          bed_charges: {
            segments: [{
              id: 2,
              rate_per_day: 200,
              days: 1,
              charge_amount: 200,
              started_on: '2026-06-18T09:00:00Z',
            }],
            bed_total: 200,
          },
          settled_bills: [{
            id: 3,
            invoice_no: 'BL-000003',
            created_at: '2026-06-18T10:00:00Z',
            total: 300,
            paid: 300,
            deposit_deducted: 0,
            due: 0,
            status: 'paid',
          }],
          summary: {
            provisional_total: 100,
            bed_total: 200,
            grand_total: 300,
            running_total: 300,
            settled_total: 300,
            settled_cash_paid: 300,
            settled_deposit_used: 0,
            deposit_balance: 0,
            deposit_total: 0,
            deposit_used: 0,
            net_payable: 300,
            refund_available: 0,
          },
        };
      }
      return {};
    });

    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
      />,
    );

    fireEvent.click(await screen.findByText('Time Patient'));

    expect(await screen.findByText('18-06-2026 02:00:00 PM')).toBeInTheDocument();
    expect(screen.getByText('18-06-2026 03:00:00 PM')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Settled Bills/i));
    expect(await screen.findByText('18-06-2026 04:00:00 PM')).toBeInTheDocument();
  });

  it('shows finalized bills paid from deposit in the settled bills tab', async () => {
    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={53}
        initialPatientId={277}
      />,
    );

    fireEvent.click(await screen.findByText('Clean-Discharge-1779346407553'));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/ip-billing/pending/53'));

    fireEvent.click(screen.getByText(/Settled Bills/i));

    const invoiceCell = await screen.findByText('BL-000901');
    const billRow = invoiceCell.closest('tr');

    expect(billRow).not.toBeNull();
    expect(within(billRow as HTMLTableRowElement).getAllByText('৳233,050')).toHaveLength(2);
    expect(screen.getAllByText('Deposit').length).toBeGreaterThan(0);
  });

  it('shows explicit IPD wallet labels instead of overloaded total names', async () => {
    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={53}
        initialPatientId={277}
      />,
    );

    fireEvent.click(await screen.findByText('Clean-Discharge-1779346407553'));

    expect(await screen.findByText(/Deposit received/i)).toBeInTheDocument();
    expect(screen.getByText(/Deposit used/i)).toBeInTheDocument();
    expect(screen.getByText(/Deposit balance/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Running charges/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Refund available/i)).toBeInTheDocument();
  });


  it('sends manual operation charges with doctor payable metadata', async () => {
    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={53}
        initialPatientId={277}
      />,
    );

    fireEvent.click(await screen.findByText('Clean-Discharge-1779346407553'));
    fireEvent.click(screen.getByText(/Manual charge/i));
    fireEvent.change(screen.getByPlaceholderText(/Charge description/i), { target: { value: 'Appendectomy operation fee' } });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'operation' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '15000' } });
    fireEvent.click(screen.getByLabelText(/Create doctor payable/i));
    fireEvent.change(screen.getByRole('combobox', { name: /Payable doctor/i }), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText(/Payable amount/i), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: /btn.addCharge/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/billing-provisional', {
        patient_id: 277,
        admission_id: 53,
        items: [expect.objectContaining({
          is_manual: true,
          item_category: 'operation',
          item_name: 'Appendectomy operation fee',
          unit_price: 15000,
          doctor_id: 7,
          doctor_name: 'Dr. Surgeon',
          doctor_payable_amount: 10000,
        })],
      });
    });
  });


  it('keeps doctor round billing inside the provisional popup workflow', async () => {
    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={53}
        initialPatientId={277}
      />,
    );

    fireEvent.click(await screen.findByText('Clean-Discharge-1779346407553'));
    fireEvent.click(await screen.findByRole('button', { name: /Doctor round/i }));

    expect(screen.getByText(/fee auto-loads from profile/i)).toBeInTheDocument();
    expect(screen.getByTestId('doctor-round-form')).toHaveTextContent('Clean-Discharge-1779346407553|ADM-000053|ipd_billing');

    fireEvent.click(screen.getByText('Mock round success'));
    await waitFor(() => {
      expect(mockApiGet.mock.calls.filter(([url]) => url === '/api/ip-billing/pending/53').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('does not expose generic remove action for doctor round provisional charges', async () => {
    mockApiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ip-billing/patients')) {
        return {
          data: [{
            admission_id: 53,
            admission_number: 'ADM-000053',
            patient_id: 277,
            patient_name: 'Clean-Discharge-1779346407553',
            patient_code: 'P-000277',
            ward_name: 'ward B',
            bed_number: 'a87',
            doctor_name: 'E2E Test',
            admitted_date: '2026-05-21',
            total_charges: 700,
            total_paid: 0,
            balance: 700,
            deposit_balance: 0,
          }],
        };
      }
      if (url === '/api/ip-billing/pending/53') {
        return {
          items: [{
            id: 701,
            item_category: 'doctor_round',
            item_name: 'Doctor Round - Dr. E2E Test',
            quantity: 1,
            unit_price: 700,
            discount_percent: 0,
            total_amount: 700,
            bill_status: 'provisional',
            created_at: '2026-05-22T10:20:00',
          }],
          bed_charges: { segments: [], bed_total: 0 },
          settled_bills: [],
          summary: {
            provisional_total: 700,
            bed_total: 0,
            grand_total: 700,
            running_total: 700,
            settled_total: 0,
            settled_cash_paid: 0,
            settled_deposit_used: 0,
            deposit_balance: 0,
            deposit_total: 0,
            deposit_used: 0,
            net_payable: 700,
            refund_available: 0,
          },
        };
      }
      if (url.startsWith('/api/billing-master/service-departments')) return { data: [] };
      if (url.startsWith('/api/billing-master/service-items')) return { data: [] };
      return {};
    });

    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={53}
        initialPatientId={277}
      />,
    );

    fireEvent.click(await screen.findByText('Clean-Discharge-1779346407553'));

    expect(await screen.findByText('Doctor Round - Dr. E2E Test')).toBeInTheDocument();
    expect(screen.getByText('Managed via Doctor Rounds')).toBeInTheDocument();
    expect(screen.queryByTitle('Remove item')).not.toBeInTheDocument();
  });


  it('allows removing auto bed charges from the reception IPD billing modal', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ip-billing/patients')) {
        return {
          data: [{
            admission_id: 53,
            admission_number: 'ADM-000053',
            patient_id: 277,
            patient_name: 'Bed Charge Patient',
            patient_code: 'P-000277',
            ward_name: 'Vip',
            bed_number: '303',
            doctor_name: 'E2E Test',
            admitted_date: '2026-06-28',
            total_charges: 3500,
            total_paid: 0,
            balance: 3500,
            deposit_balance: 0,
          }],
        };
      }
      if (url === '/api/ip-billing/pending/53') {
        return {
          items: [],
          bed_charges: {
            segments: [{
              id: 302,
              ward_name: 'Vip',
              bed_number: '303',
              bed_type: 'vip',
              rate_per_day: 3500,
              days: 1,
              charge_amount: 3500,
              started_on: '2026-06-28T14:41:00',
            }],
            bed_total: 3500,
          },
          settled_bills: [],
          summary: {
            provisional_total: 0,
            bed_total: 3500,
            grand_total: 3500,
            running_total: 3500,
            settled_total: 0,
            settled_cash_paid: 0,
            settled_deposit_used: 0,
            deposit_balance: 0,
            deposit_total: 0,
            deposit_used: 0,
            net_payable: 3500,
            refund_available: 0,
          },
        };
      }
      if (url.startsWith('/api/billing-master/service-departments')) return { data: [] };
      if (url.startsWith('/api/billing-master/service-items')) return { data: [] };
      return {};
    });

    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={53}
        initialPatientId={277}
      />,
    );

    fireEvent.click(await screen.findByText('Bed Charge Patient'));
    await waitFor(() => expect(screen.getAllByText(/Vip - Bed 303/i).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /Remove auto charge/i }));

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('/api/ip-billing/pending/53/bed-charges/302');
    });
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockApiGet.mock.calls.filter(([url]) => url === '/api/ip-billing/pending/53').length).toBeGreaterThanOrEqual(2);
    });
    confirmSpy.mockRestore();
  });


  it('keeps bed transfer inside the reception IPD billing modal and refreshes running charges', async () => {
    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={53}
        initialPatientId={277}
      />,
    );

    fireEvent.click(await screen.findByText('Clean-Discharge-1779346407553'));
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/ip-billing/pending/53'));

    fireEvent.click(screen.getByRole('button', { name: /Transfer Bed/i }));

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/api/admissions/available-beds-with-pricing'));
    expect(screen.getByText('Current bed')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '88' } });
    fireEvent.change(screen.getByPlaceholderText(/shifted to cabin/i), { target: { value: 'Need cabin shift' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Transfer/i }));

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/admissions/53/transfer', {
        new_bed_id: 88,
        reason: 'Need cabin shift',
        pending_receive: false,
      });
    });
    await waitFor(() => {
      expect(mockApiGet.mock.calls.filter(([url]) => url === '/api/ip-billing/pending/53').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByText('Confirm Transfer')).not.toBeInTheDocument();
  });


  it('includes package total in the provisional display total fallback', () => {
    expect(getIpdProvisionalDisplayTotal({
      provisional_total: 1200,
      package_total: 25000,
      bed_total: 3000,
    })).toBe(29200);
  });

  it('builds an explicit manual charge payload without a service item reference', () => {
    expect(buildProvisionalChargePayload({
      mode: 'manual',
      manualCategory: 'service',
      manualDescription: 'Charge description',
      manualDepartment: 'Manual',
      quantity: '1',
      unitPrice: '5000',
    })).toEqual({
      is_manual: true,
      item_category: 'service',
      item_name: 'Charge description',
      department: 'Manual',
      quantity: 1,
      unit_price: 5000,
      discount_percent: 0,
    });
  });

  it('shows package-only admissions as a running charge instead of an empty ledger', async () => {
    mockApiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ip-billing/patients')) {
        return {
          data: [{
            admission_id: 54,
            admission_number: 'ADM-000054',
            patient_id: 278,
            patient_name: 'Package Patient',
            patient_code: 'P-000278',
            ward_name: 'Cabin',
            bed_number: 'C1',
            doctor_name: 'E2E Test',
            admitted_date: '2026-05-21',
            total_charges: 25000,
            total_paid: 0,
            balance: 25000,
            deposit_balance: 0,
          }],
        };
      }
      if (url === '/api/ip-billing/pending/54') {
        return {
          items: [],
          bed_charges: { segments: [], bed_total: 0 },
          settled_bills: [],
          package: {
            id: 12,
            package_name: 'Normal Delivery Package',
            package_code: 'NDP',
            description: 'Includes admission package services',
            total_price: 25000,
            included_bed_days: 3,
            extra_bed_rate: 1500,
            package_type: 'package_included_days',
          },
          summary: {
            provisional_total: 0,
            package_total: 25000,
            bed_total: 0,
            grand_total: 25000,
            running_total: 25000,
            settled_total: 0,
            settled_cash_paid: 0,
            settled_deposit_used: 0,
            deposit_balance: 0,
            deposit_total: 0,
            deposit_used: 0,
            net_payable: 25000,
            refund_available: 0,
          },
        };
      }
      if (url.startsWith('/api/billing-master/service-departments')) return { data: [] };
      if (url.startsWith('/api/billing-master/service-items')) return { data: [] };
      return {};
    });

    render(
      <ProvisionalBillingModal
        onClose={vi.fn()}
        formatBDT={formatBDT}
        basePath="/h/demo-hospital/reception"
        initialAdmissionId={54}
        initialPatientId={278}
      />,
    );

    fireEvent.click(await screen.findByText('Package Patient'));

    await waitFor(() => expect(screen.getAllByText('Normal Delivery Package').length).toBeGreaterThan(1));
    expect(screen.getByText('admission_package')).toBeInTheDocument();
    expect(screen.queryByText(/No charges added yet/i)).not.toBeInTheDocument();
  });
});

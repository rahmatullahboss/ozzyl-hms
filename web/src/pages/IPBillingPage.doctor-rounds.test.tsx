import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IPBillingPage from './IPBillingPage';
import { api } from '../lib/apiClient';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }), useNavigate: () => vi.fn() }));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('../components/dashboard/KPICard', () => ({ default: () => <div /> }));
vi.mock('../components/dashboard/EmptyState', () => ({ default: () => <div>No data</div> }));
vi.mock('../components/HelpButton', () => ({ default: () => <button>Help</button> }));
vi.mock('../components/WhatsAppButton', () => ({ default: () => null }));
vi.mock('../components/HelpPanel', () => ({ default: () => null }));
vi.mock('../components/reception/ProvisionalBillingModal', () => ({ ProvisionalBillingModal: () => null }));
vi.mock('../components/ipd/DoctorRoundForm', () => ({
  default: (props: any) => (
    <div data-testid="doctor-round-form">
      {props.patientName}|{props.admissionNo}|{props.entrySource}
    </div>
  ),
}));
vi.mock('../lib/apiClient', () => ({
  ApiClientError: class extends Error {},
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const get = api.get as ReturnType<typeof vi.fn>;

describe('IPBillingPage doctor rounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (path: string) => {
      if (path === '/api/ip-billing/patients') return { data: [{
        admission_id: 21,
        admission_number: 'ADM-21',
        patient_id: 9,
        patient_name: 'Test Patient',
        patient_code: 'P-9',
        date_of_birth: '1990-01-01',
        patient_address: 'Uttara, Dhaka',
        admitted_date: '2026-07-29 05:46:53',
        admitted_at_utc: '2026-07-29T05:46:53.000Z',
        billing_status: 'pending',
        total_charges: 700,
        total_paid: 0,
        balance: 700,
      }] };
      if (path.startsWith('/api/ip-billing/stats?')) return {};
      if (path === '/api/admissions/21/detail') return { admission: {
        id: 21,
        admission_no: 'ADM-21',
        patient_id: 9,
        patient_name: 'Test Patient',
        patient_code: 'P-9',
        date_of_birth: '1990-01-01',
        patient_address: 'Uttara, Dhaka',
        admission_date: '2026-07-29 05:46:53',
        admitted_at_utc: '2026-07-29T05:46:53.000Z',
        admission_type: 'emergency',
        status: 'admitted',
      } };
      if (path === '/api/ip-billing/pending/21') return { items: [{
        id: 45,
        item_name: 'Doctor Round',
        item_category: 'doctor_round',
        department: 'IPD',
        reference_id: 91,
        unit_price: 700,
        quantity: 1,
        discount_percent: 0,
        discount_amount: 0,
        total_amount: 700,
        created_at: '2026-06-18T08:35:00Z',
        bill_status: 'provisional',
      }], bed_charges: { segments: [], bed_total: 0 }, summary: null };
      if (path === '/api/deposits/balance/9') return { balance: 0 };
      if (path === '/api/ip-billing/timeline/9') return { timeline: [] };
      if (path === '/api/ipd-doctor-rounds?admission_id=21') return { rounds: [{
        id: 91,
        doctor_name_snapshot: 'Dr Round',
        rounded_at: '2026-06-18 14:35:00',
        round_fee_snapshot: 700,
        entry_source: 'nurse_station',
        entered_by_name: 'Nurse Rina',
        bill_status: 'provisional',
      }] };
      throw new Error(`Unhandled GET ${path}`);
    });
  });

  it('shows name, age, address, and Dhaka admission time in list and detail views', async () => {
    render(<IPBillingPage />);

    const patientName = await screen.findByText('Test Patient');
    const patientCell = patientName.closest('td');
    expect(patientCell).not.toBeNull();

    const content = patientCell?.textContent ?? '';
    const ageText = within(patientCell as HTMLTableCellElement).getByText(/^\d+Y(?: \d+M)?$/).textContent ?? '';
    expect(ageText).not.toBe('');
    expect(within(patientCell as HTMLTableCellElement).getByText('Uttara, Dhaka')).toBeInTheDocument();
    expect(content.indexOf('Test Patient')).toBeLessThan(content.indexOf(ageText));
    expect(content.indexOf(ageText)).toBeLessThan(content.indexOf('Uttara, Dhaka'));
    expect(screen.getByText('29-07-2026 11:46:53 AM')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('View billing detail'));

    expect(await screen.findByText('Uttara, Dhaka')).toBeInTheDocument();
    expect(screen.getAllByText(ageText).length).toBeGreaterThan(0);
    expect(screen.getAllByText('29-07-2026 11:46:53 AM').length).toBeGreaterThan(0);
  });

  it('opens the shared billing form and shows complete doctor round history', async () => {
    render(<IPBillingPage />);
    await screen.findByText('Test Patient');
    fireEvent.click(screen.getByTitle('View billing detail'));

    await screen.findByText(/IP Billing/);
    fireEvent.click(screen.getByRole('button', { name: 'Doctor Round' }));
    expect(screen.getByTestId('doctor-round-form')).toHaveTextContent('Test Patient|ADM-21|ipd_billing');

    await waitFor(() => expect(screen.getByText('Dr Round')).toBeInTheDocument());
    expect(screen.getAllByText('৳700.00').length).toBeGreaterThan(0);
    expect(screen.getByText('nurse station')).toBeInTheDocument();
    expect(screen.getByText('Nurse Rina')).toBeInTheDocument();
    expect(screen.getByText('provisional')).toBeInTheDocument();
    expect(screen.getByText('Managed via Doctor Rounds')).toBeInTheDocument();
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument();
  });
});

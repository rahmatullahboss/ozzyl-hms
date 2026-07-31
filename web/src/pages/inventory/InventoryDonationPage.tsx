import { useState } from 'react';
import { useParams } from 'react-router';
import { Gift, Plus, Search, Edit, Trash2, Eye, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

interface Donation {
  DonationId: number;
  DonationName: string;
  DonorName?: string;
  DonationDate?: string;
  TotalValue: number;
  Remarks?: string;
  CreatedBy?: number;
  CreatedOn?: string;
}

export default function InventoryDonationPage({ role = 'hospital_admin' }: { role?: string }) {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Donation | null>(null);
  const [viewing, setViewing] = useState<Donation | null>(null);

  const { data, isLoading } = useApiQuery<{ data: Donation[] }>(
    ['inventory', 'donations', search],
    `/api/inventory/donations?page=1&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
  );
  const donations = data?.data ?? [];

  const deleteDonation = useApiMutation<any, unknown>('delete', '', {
    onSuccess: () => { toast.success('Donation deleted'); queryClient.invalidateQueries({ queryKey: ['inventory', 'donations'] }); },
    onError: err => toast.error(err.message),
  });

  const handleDelete = (id: number) => {
    if (!confirm('Are you sure you want to delete this donation?')) return;
    deleteDonation.mutate(`/api/inventory/donations/${id}`);
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><Gift className="w-6 h-6 inline mr-2" />Donations</h1>
            <p className="section-subtitle">Manage fixed asset donations</p>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input className="input pl-9" placeholder="Search donations..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn-primary text-sm" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Plus className="w-4 h-4" /> Add Donation
          </button>
        </div>

        {showForm && (
          <DonationForm
            donation={editing}
            onClose={() => { setShowForm(false); setEditing(null); }}
            onSaved={() => { setShowForm(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ['inventory', 'donations'] }); }}
          />
        )}

        {viewing && (
          <DonationDetail donation={viewing} onClose={() => setViewing(null)} />
        )}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Donation Name</th>
                  <th>Donor</th>
                  <th>Date</th>
                  <th>Total Value</th>
                  <th>Remarks</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {donations.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{isLoading ? 'Loading...' : 'No donations found'}</td></tr>
                ) : donations.map(d => (
                  <tr key={d.DonationId}>
                    <td className="font-medium">{d.DonationName}</td>
                    <td>{d.DonorName || '—'}</td>
                    <td>{d.DonationDate || '—'}</td>
                    <td>{d.TotalValue?.toLocaleString() || '0'}</td>
                    <td className="max-w-[200px] truncate">{d.Remarks || '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn-icon" title="View" onClick={() => setViewing(d)}>
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="btn-icon" title="Edit" onClick={() => { setEditing(d); setShowForm(true); }}>
                          <Edit className="w-4 h-4" />
                        </button>
                        <button className="btn-icon text-red-500" title="Delete" onClick={() => handleDelete(d.DonationId)}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function DonationForm({ donation, onClose, onSaved }: { donation: Donation | null; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    DonationName: donation?.DonationName || '',
    DonorName: donation?.DonorName || '',
    DonationDate: donation?.DonationDate || new Date().toISOString().split('T')[0],
    TotalValue: donation?.TotalValue || 0,
    Remarks: donation?.Remarks || '',
  });

  const createDonation = useApiMutation<any, any>('post', '/api/inventory/donations', {
    onSuccess: () => { toast.success('Donation created'); onSaved(); },
    onError: err => toast.error(err.message),
  });

  const updateDonation = useApiMutation<any, any>('put', `/api/inventory/donations/${donation?.DonationId}`, {
    onSuccess: () => { toast.success('Donation updated'); onSaved(); },
    onError: err => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!form.DonationName) { toast.error('Donation name is required'); return; }
    if (donation) {
      updateDonation.mutate(form);
    } else {
      createDonation.mutate(form);
    }
  };

  return (
    <div className="card p-5">
      <h3 className="text-lg font-semibold mb-4">{donation ? 'Edit Donation' : 'New Donation'}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Donation Name *</label>
          <input className="input" required value={form.DonationName} onChange={e => setForm({ ...form, DonationName: e.target.value })} />
        </div>
        <div>
          <label className="label">Donor Name</label>
          <input className="input" value={form.DonorName} onChange={e => setForm({ ...form, DonorName: e.target.value })} />
        </div>
        <div>
          <label className="label">Donation Date</label>
          <input className="input" type="date" value={form.DonationDate} onChange={e => setForm({ ...form, DonationDate: e.target.value })} />
        </div>
        <div>
          <label className="label">Total Value</label>
          <input className="input" type="number" value={form.TotalValue} onChange={e => setForm({ ...form, TotalValue: Number(e.target.value) })} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Remarks</label>
          <input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button className="btn-primary" onClick={handleSubmit}>
          {donation ? 'Update' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function DonationDetail({ donation, onClose }: { donation: Donation; onClose: () => void }) {
  return (
    <div className="card p-5">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold">Donation Details</h3>
        <button className="btn-secondary text-sm" onClick={onClose}>Close</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Donation Name</p>
          <p className="font-medium">{donation.DonationName}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Donor Name</p>
          <p className="font-medium">{donation.DonorName || '—'}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Donation Date</p>
          <p className="font-medium">{donation.DonationDate || '—'}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Total Value</p>
          <p className="font-medium">{donation.TotalValue?.toLocaleString() || '0'}</p>
        </div>
        <div className="md:col-span-2">
          <p className="text-sm text-[var(--color-text-muted)]">Remarks</p>
          <p className="font-medium">{donation.Remarks || '—'}</p>
        </div>
      </div>
    </div>
  );
}

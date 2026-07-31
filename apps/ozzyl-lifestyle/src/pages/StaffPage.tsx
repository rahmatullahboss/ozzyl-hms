import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, X, Search, DollarSign, UserCheck } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

interface Staff {
  id: number;
  name: string;
  address: string;
  position: string;
  salary: number;
  bank_account: string;
  mobile: string;
  joining_date: string;
  status: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

export default function StaffPage({ role = 'md' }: { role?: string }) {
  const [staff, setStaff]     = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const { t } = useTranslation(['staff', 'common']);

  // Add staff modal
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm] = useState({
    name: '', position: '', mobile: '', salary: '',
    bank_account: '', address: '', joining_date: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setForm({ name: '', position: '', mobile: '', salary: '', bank_account: '', address: '', joining_date: new Date().toISOString().split('T')[0] }); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/staff', { headers: authHeader() });
      setStaff(data.staff || []);
    } catch { toast.error(t('fetchFailed', { defaultValue: 'Failed to fetch staff' })); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.position.toLowerCase().includes(search.toLowerCase()) ||
    s.mobile.includes(search)
  );

  const totalSalary  = staff.reduce((sum, s) => sum + (s.salary || 0), 0);
  const activeCount  = staff.filter(s => s.status === 'active').length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/staff', {
        name: form.name,
        address: form.address,
        position: form.position,
        mobile: form.mobile,
        salary: form.salary ? parseFloat(form.salary) : 0,
        bankAccount: form.bank_account,
        joiningDate: form.joining_date || undefined,
      }, { headers: authHeader() });
      toast.success(t('staffAdded', { defaultValue: 'Staff member added' }));
      setShowCreate(false);
      setForm({ name: '', position: '', mobile: '', salary: '', bank_account: '', address: '', joining_date: new Date().toISOString().split('T')[0] });
      fetchStaff();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('failed', { defaultValue: 'Failed' }) : t('failed', { defaultValue: 'Failed' }));
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('staffManagement', { defaultValue: 'Staff Management' })}</h1>
              <p className="section-subtitle">{t('manageHospitalStaff', { defaultValue: 'Manage hospital staff and salaries' })}</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('addStaff', { defaultValue: 'Add Staff' })}
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('totalStaff',    { defaultValue: 'Total Staff' })}    value={staff.length}    loading={loading} icon={<Users className="w-5 h-5" />}     iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('monthlySalary', { defaultValue: 'Monthly Salary' })} value={fmt(totalSalary)} loading={loading} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600"   index={1} />
          <KPICard title={t('activeStaff',   { defaultValue: 'Active Staff' })}   value={activeCount}      loading={loading} icon={<UserCheck className="w-5 h-5" />}  iconBg="bg-emerald-50 text-emerald-600" index={2} />
        </div>

        {/* Search */}
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            placeholder={t('search', { ns: 'common' })}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9"
          />
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('name',       { ns: 'common' })}</th>
                  <th>{t('position',   { defaultValue: 'Position' })}</th>
                  <th>{t('phone',      { ns: 'common' })}</th>
                  <th>{t('bankAccount',{ defaultValue: 'Bank Account' })}</th>
                  <th className="text-right">{t('salary', { defaultValue: 'Salary' })}</th>
                  <th>{t('joined',     { defaultValue: 'Joined' })}</th>
                  <th className="text-center">{t('status', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 rounded" /></td>)}</tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7}>
                    <EmptyState
                      icon={<Users className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('noStaffFound', { defaultValue: 'No staff found' })}
                      description={t('noStaffFoundDesc', { defaultValue: 'No staff members match your search.' })}
                      action={<button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('addFirstStaff', { defaultValue: 'Add First Staff' })}</button>}
                    />
                  </td></tr>
                ) : (
                  filtered.map(member => (
                    <tr key={member.id}>
                      <td className="font-medium">{member.name}</td>
                      <td className="text-sm text-[var(--color-text-secondary)]">{member.position}</td>
                      <td className="font-data text-sm">{member.mobile}</td>
                      <td className="font-data text-sm text-[var(--color-text-muted)]">{member.bank_account || '—'}</td>
                      <td className="text-right font-medium">{fmt(member.salary || 0)}</td>
                      <td className="font-data text-sm text-[var(--color-text-muted)]">
                        {member.joining_date ? new Date(member.joining_date).toLocaleDateString('en-GB') : '—'}
                      </td>
                      <td className="text-center">
                        <span className={`badge ${member.status === 'active' ? 'badge-success' : 'badge-secondary'}`}>
                          {member.status || 'active'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Staff Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('addStaffMember', { defaultValue: 'Add Staff Member' })}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div><label className="label">{t('nameLabel', { defaultValue: 'Name *' })}</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('fullNameStaff', { defaultValue: 'Full name' })} /></div>
              <div><label className="label">{t('positionLabel', { defaultValue: 'Position *' })}</label><input className="input" required value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} placeholder={t('positionPlaceholder', { defaultValue: 'e.g. Nurse, Receptionist, Lab Tech' })} /></div>
              <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t('mobileLabel', { defaultValue: 'Mobile *' })}</label><input className="input" required value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} placeholder={t('mobilePlaceholder', { defaultValue: '01XXXXXXXXX' })} /></div>
                <div><label className="label">{t('salaryLabel', { defaultValue: 'Salary (৳)' })}</label><input className="input" type="number" value={form.salary} onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('bankAccountLabel', { defaultValue: 'Bank Account *' })}</label><input className="input" required value={form.bank_account} onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))} /></div>
              <div><label className="label">{t('addressLabel', { defaultValue: 'Address *' })}</label><input className="input" required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
              <div><label className="label">{t('joiningDateLabel', { defaultValue: 'Joining Date' })}</label><input className="input" type="date" value={form.joining_date} onChange={e => setForm(f => ({ ...f, joining_date: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('adding', { defaultValue: 'Adding…' }) : t('addStaffBtn', { defaultValue: 'Add Staff' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

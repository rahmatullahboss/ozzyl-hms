import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ChevronLeft, Building2, Eye, Edit2, Save,
  Users, Activity, TrendingUp,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { saveToken } from '../hooks/useAuth';

interface HospitalDetail {
  hospital: {
    id: number;
    name: string;
    subdomain: string;
    status: string;
    plan: string;
    created_at: string;
    updated_at?: string;
  };
  users: Array<{
    id: number;
    email: string;
    name: string;
    role: string;
    created_at: string;
  }>;
  stats: {
    patients: number;
    totalBilled: number;
    totalPaid: number;
  };
}

export default function SuperAdminHospitalDetail() {
  const { t } = useTranslation(['super-admin', 'common']);
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<HospitalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', status: '', plan: '' });
  const navigate = useNavigate();

  useEffect(() => { if (id) fetchDetail(); }, [id]);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data: res } = await axios.get(`/api/admin/hospitals/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res);
      setEditForm({
        name: res.hospital.name,
        status: res.hospital.status,
        plan: res.hospital.plan,
      });
    } catch {
      toast.error(t('super-admin.failed_to_load_hospital'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const token = localStorage.getItem('hms_token');
      await axios.put(`/api/admin/hospitals/${id}`, editForm, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success(t('super-admin.hospital_updated'));
      setEditing(false);
      fetchDetail();
    } catch {
      toast.error(t('super-admin.failed_to_update'));
    }
  };

  const handleImpersonate = async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const { data: res } = await axios.post(`/api/admin/impersonate/${id}`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const currentToken = localStorage.getItem('hms_token');
      if (currentToken) localStorage.setItem('hms_super_token', currentToken);

      saveToken(res.token);
      localStorage.setItem('hms_impersonating', JSON.stringify({
        tenantName: res.tenant.name,
        tenantId: res.tenant.id,
      }));

      window.open(res.redirectUrl, '_blank');
    } catch {
      toast.error(t('super-admin.failed_to_impersonate'));
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="skeleton h-8 w-1/3 mb-6" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[...Array(3)].map((_, i) => <div key={i} className="card p-5"><div className="skeleton h-16 w-full" /></div>)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--color-text-muted)]">{t('super-admin:hospitalList')}</p>
      </div>
    );
  }

  const { hospital, users, stats } = data;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/super-admin/hospitals')} className="btn-ghost p-2">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                <Building2 className="w-6 h-6 text-[var(--color-primary)]" />
                {hospital.name}
              </h1>
              <p className="text-sm text-[var(--color-text-muted)] font-data">{hospital.subdomain}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleImpersonate} className="btn-secondary">
              <Eye className="w-4 h-4" /> {t('common:view')}
            </button>
            {!editing ? (
              <button onClick={() => setEditing(true)} className="btn-ghost">
                <Edit2 className="w-4 h-4" /> {t('common:edit')}
              </button>
            ) : (
              <button onClick={handleSave} className="btn-primary">
                <Save className="w-4 h-4" /> {t('common:save')}
              </button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="card p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Activity className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">{t('super-admin:totalPatientsLabel')}</p>
              <p className="text-xl font-bold text-[var(--color-text-primary)]">{stats.patients.toLocaleString()}</p>
            </div>
          </div>
          <div className="card p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">{t('super-admin:revenue')}</p>
              <p className="text-xl font-bold text-[var(--color-text-primary)]">৳{stats.totalBilled.toLocaleString()}</p>
            </div>
          </div>
          <div className="card p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">{t('super-admin:hospitalUsers')}</p>
              <p className="text-xl font-bold text-[var(--color-text-primary)]">{users.length}</p>
            </div>
          </div>
        </div>

        {/* Hospital Info */}
        <div className="card p-5 mb-6">
          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4">{t('super-admin:hospitalInfo')}</h3>
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">{t('super-admin:hospitalName')}</label>
                <input
                  className="input-field w-full"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">{t('common:status')}</label>
                <select
                  className="input-field w-full"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="active">{t('super-admin:activeStatus')}</option>
                  <option value="inactive">{t('super-admin:inactiveStatus')}</option>
                  <option value="suspended">{t('super-admin:suspendedStatus')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">{t('super-admin:planType')}</label>
                <select
                  className="input-field w-full"
                  value={editForm.plan}
                  onChange={(e) => setEditForm({ ...editForm, plan: e.target.value })}
                >
                  <option value="basic">{t('super-admin:basic')}</option>
                  <option value="professional">{t('super-admin:professional')}</option>
                  <option value="enterprise">{t('super-admin:enterprise')}</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-[var(--color-text-muted)]">{t('super-admin:subdomain')}</p>
                <p className="font-medium font-data">{hospital.subdomain}</p>
              </div>
              <div>
                <p className="text-[var(--color-text-muted)]">{t('super-admin:plan')}</p>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                  hospital.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                  hospital.plan === 'professional' ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-700'
                }`}>
                  {t(`super-admin:${hospital.plan}`)}
                </span>
              </div>
              <div>
                <p className="text-[var(--color-text-muted)]">{t('common:status')}</p>
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                  hospital.status === 'active' ? 'text-emerald-600' : 'text-slate-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    hospital.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
                  }`} />
                  {t(`super-admin:${hospital.status}Status`) || hospital.status}
                </span>
              </div>
              <div>
                <p className="text-[var(--color-text-muted)]">{t('common:date')}</p>
                <p className="font-medium text-sm">{new Date(hospital.created_at).toLocaleDateString('en-GB')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Users Table */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
              {t('super-admin:hospitalUsers')} ({users.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('common:name')}</th>
                  <th>{t('common:email')}</th>
                  <th>{t('common:status')}</th>
                  <th>{t('common:date')}</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-[var(--color-text-muted)]">{t('common:noData')}</td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id}>
                      <td className="font-medium">{u.name}</td>
                      <td className="font-data text-sm text-[var(--color-text-secondary)]">{u.email}</td>
                      <td>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                          {u.role}
                        </span>
                      </td>
                      <td className="text-sm text-[var(--color-text-muted)]">
                        {new Date(u.created_at).toLocaleDateString('en-GB')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}

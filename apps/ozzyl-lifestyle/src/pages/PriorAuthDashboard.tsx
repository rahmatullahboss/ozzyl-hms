import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Plus, X, User, Activity, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  const { t } = useTranslation('billing');
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface PriorAuth {
  AuthId: number;
  PatientId: number;
  PatientName: string;
  ProviderName: string;
  RequestType: string;
  AuthStatus: string;
  Priority: string;
  ServiceCode: string;
  ServiceDescription: string;
  RequestDate: string;
}

export default function PriorAuthDashboard({ role }: { role?: string }) {
  const [auths, setAuths] = useState<PriorAuth[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAuth, setNewAuth] = useState({
    PatientId: '',
    EncounterId: '1', // Defaulting to 1 for MVP
    OrderingProviderId: '1',
    RequestType: 'medication',
    Priority: 'routine',
    ServiceCode: '',
    ServiceDescription: '',
    DiagnosisCodes: 'A00'
  });

  const loadAuths = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/prior-auth?limit=100`, { headers: authHeaders() });
      setAuths(res.data?.Results ?? []);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to load prior authorizations');
      } else {
        toast.error(t('billing.failed_to_load_prior_authorizations'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuths();
  }, [loadAuths]);

  const handleSaveAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAuth.PatientId || !newAuth.ServiceCode) return toast.error(t('billing.please_fill_required_fields'));
    
    setSaving(true);
    try {
      await axios.post('/api/prior-auth', {
        PatientId: Number(newAuth.PatientId),
        EncounterId: Number(newAuth.EncounterId),
        OrderingProviderId: Number(newAuth.OrderingProviderId),
        RequestType: newAuth.RequestType,
        Priority: newAuth.Priority,
        ServiceCode: newAuth.ServiceCode,
        ServiceDescription: newAuth.ServiceDescription,
        DiagnosisCodes: newAuth.DiagnosisCodes.split(',').map(s => s.trim()),
      }, { headers: authHeaders() });
      
      toast.success(t('billing.prior_authorization_requested_successfully'));
      setShowModal(false);
      setNewAuth({ ...newAuth, ServiceCode: '', ServiceDescription: '' });
      loadAuths();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to submit request');
      } else {
        toast.error(t('billing.failed_to_submit_request'));
      }
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'approved': return 'bg-emerald-100 text-emerald-700';
      case 'denied': return 'bg-red-100 text-red-700';
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      case 'cancelled': return 'bg-gray-100 text-gray-700';
      default: return 'bg-blue-100 text-blue-700';
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="page-header flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Prior Authorizations</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Manage insurance pre-approvals</p>
            </div>
          </div>
          <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Request
          </button>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
             <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
          ) : auths.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium mb-4">No prior authorizations found.</p>
              <button onClick={() => setShowModal(true)} className="btn btn-secondary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create First Request
              </button>
            </div>
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Type</th>
                  <th>Service</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {auths.map(pa => (
                  <tr key={pa.AuthId}>
                    <td className="font-data">{new Date(pa.RequestDate).toLocaleDateString()}</td>
                    <td className="font-semibold">{pa.PatientName || `Patient #${pa.PatientId}`}</td>
                    <td className="capitalize">{pa.RequestType.replace('_', ' ')}</td>
                    <td className="max-w-[200px] truncate">
                      <span className="font-mono text-xs bg-[var(--color-bg-secondary)] px-1 py-0.5 rounded mr-1">
                        {pa.ServiceCode}
                      </span>
                      {pa.ServiceDescription}
                    </td>
                    <td>
                      <span className={`text-xs font-semibold ${pa.Priority === 'urgent' ? 'text-red-600' : pa.Priority === 'expedited' ? 'text-orange-600' : 'text-[var(--color-text-muted)]'}`}>
                        {pa.Priority.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusBadge(pa.AuthStatus)}`}>
                        {pa.AuthStatus.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <button className="text-indigo-600 hover:text-indigo-700 text-xs font-semibold">Manage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--color-card)] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-500 rounded p-1.5"><Activity className="w-5 h-5 text-white" /></div>
                <div>
                  <h3 className="font-bold text-[var(--color-text)]">New Prior Authorization</h3>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleSaveAuth} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('auth.patient_id')}</label>
                  <input
                    required
                    type="number"
                    className="input w-full"
                    placeholder={t("auth.eg_1")}
                    value={newAuth.PatientId}
                    onChange={e => setNewAuth(p => ({...p, PatientId: e.target.value}))}
                  />
                </div>
                <div>
                  <label className="label">{t('auth.provider_id')}</label>
                  <input
                    required
                    type="number"
                    className="input w-full"
                    value={newAuth.OrderingProviderId}
                    onChange={e => setNewAuth(p => ({...p, OrderingProviderId: e.target.value}))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('auth.request_type')}</label>
                  <select 
                    className="input w-full"
                    value={newAuth.RequestType}
                    onChange={e => setNewAuth(p => ({...p, RequestType: e.target.value}))}
                  >
                    <option value="medication">Medication</option>
                    <option value="procedure">Procedure</option>
                    <option value="imaging">Imaging</option>
                    <option value="durable_equipment">Durable Equipment</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('auth.priority')}</label>
                  <select 
                    className="input w-full"
                    value={newAuth.Priority}
                    onChange={e => setNewAuth(p => ({...p, Priority: e.target.value}))}
                  >
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="expedited">Expedited</option>
                  </select>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="label">{t('auth.service_code')}</label>
                  <input
                    required
                    className="input w-full"
                    placeholder={t("auth.cpthcpcs")}
                    value={newAuth.ServiceCode}
                    onChange={e => setNewAuth(p => ({...p, ServiceCode: e.target.value}))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">{t('auth.description')}</label>
                  <input
                    required
                    className="input w-full"
                    placeholder={t("auth.service_details")}
                    value={newAuth.ServiceDescription}
                    onChange={e => setNewAuth(p => ({...p, ServiceDescription: e.target.value}))}
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('auth.diagnosis_codes_comma_separated')}</label>
                <input
                  required
                  className="input w-full font-mono text-sm"
                  placeholder={t("auth.icd10_codes")}
                  value={newAuth.DiagnosisCodes}
                  onChange={e => setNewAuth(p => ({...p, DiagnosisCodes: e.target.value}))}
                />
              </div>

              <div className="flex gap-2 pt-4 border-t border-[var(--color-border)] justify-end">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn btn-primary min-w-[120px]">
                  {saving ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

import { useState, useEffect, useCallback } from 'react';
import {
  Stethoscope, Plus, X, RefreshCw, MessageSquare, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiClientError } from '../../lib/apiClient';
import EmptyState from '../dashboard/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConsultationRequest {
  id: number;
  patient_id: number;
  visit_id: number;
  requested_on: string;
  requesting_doctor_id: number;
  requesting_doctor_name: string;
  purpose: string;
  consulting_doctor_id: number;
  consulting_doctor_name: string;
  consultant_response: string | null;
  consulted_on: string | null;
  status: 'pending' | 'accepted' | 'responded' | 'cancelled';
}

interface Doctor {
  id: number;
  name: string;
}

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  visit_id?: number;
}

interface ConsultationRequestsTabProps {
  patients: Patient[];
  selectedPatient: number | null;
  onSelectPatient: (id: number | null) => void;
}

// ─── Status Badge ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ConsultationRequest['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  accepted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  responded: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ConsultationRequestsTab({ patients, selectedPatient, onSelectPatient }: ConsultationRequestsTabProps) {
  const { t } = useTranslation('nursing');
  const [requests, setRequests] = useState<ConsultationRequest[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showRespondModal, setShowRespondModal] = useState(false);
  const [respondingTo, setRespondingTo] = useState<ConsultationRequest | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [newForm, setNewForm] = useState({
    consulting_doctor_id: '',
    purpose: '',
  });

  const [responseText, setResponseText] = useState('');

  const fetchRequests = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '20' });
      if (selectedPatient) qs.set('patient_id', String(selectedPatient));
      const data = await apiFetch<{ Results?: ConsultationRequest[]; pagination?: { total?: number } }>(`/api/nursing/consultation-requests?${qs}`);
      setRequests(data.Results ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error(t('consultation.failedToLoad'));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPatient, t]);

  const fetchDoctors = useCallback(async () => {
    try {
      const data = await apiFetch<{ Results?: Doctor[] } | Doctor[]>('/api/doctors');
      setDoctors(Array.isArray(data) ? data : data.Results ?? []);
    } catch {
      setDoctors([]);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchDoctors(); }, [fetchDoctors]);

  const handleCreate = async () => {
    if (!selectedPatient || !newForm.consulting_doctor_id || !newForm.purpose.trim()) {
      toast.error(t('consultation.fieldsRequired'));
      return;
    }

    const patient = patients.find(p => p.patient_id === selectedPatient);

    try {
      await apiFetch('/api/nursing/consultation-requests', {
        method: 'POST',
        body: {
          patient_id: selectedPatient,
          visit_id: patient?.visit_id ?? 0,
          requesting_doctor_id: 0,
          purpose: newForm.purpose.trim(),
          consulting_doctor_id: parseInt(newForm.consulting_doctor_id),
        },
      });
      toast.success(t('consultation.created'));
      setShowNewModal(false);
      setNewForm({ consulting_doctor_id: '', purpose: '' });
      fetchRequests(page);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('consultation.failed'));
    }
  };

  const handleRespond = async () => {
    if (!respondingTo || !responseText.trim()) {
      toast.error(t('consultation.responseRequired'));
      return;
    }

    try {
      await apiFetch(`/api/nursing/consultation-requests/${respondingTo.id}/respond`, {
        method: 'PUT',
        body: { consultant_response: responseText.trim() },
      });
      toast.success(t('consultation.responded'));
      setShowRespondModal(false);
      setRespondingTo(null);
      setResponseText('');
      fetchRequests(page);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('consultation.respondFailed'));
    }
  };

  const openRespondModal = (req: ConsultationRequest) => {
    setRespondingTo(req);
    setResponseText('');
    setShowRespondModal(true);
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('consultation.patient')}:</label>
          <select
            value={selectedPatient ?? ''}
            onChange={e => onSelectPatient(e.target.value ? parseInt(e.target.value) : null)}
            className="input max-w-xs"
          >
            <option value="">{t('consultation.allPatients')}</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{p.name} ({p.patient_code})</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fetchRequests(page)} className="btn-ghost p-2" aria-label={t('consultation.refresh')}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setNewForm({ consulting_doctor_id: '', purpose: '' });
              setShowNewModal(true);
            }}
            disabled={!selectedPatient}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> {t('consultation.newRequest')}
          </button>
        </div>
      </div>

      {/* ── Requests Table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {t('consultation.title')}
            {total > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({total})</span>}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('consultation.date')}</th>
                <th>{t('consultation.requestedTo')}</th>
                <th>{t('consultation.purpose')}</th>
                <th>{t('consultation.status')}</th>
                <th>{t('consultation.response')}</th>
                <th>{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                ))
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<Stethoscope className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title={t('consultation.noRequests')}
                      description={t('consultation.noRequestsDesc')}
                    />
                  </td>
                </tr>
              ) : (
                requests.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td className="font-data text-xs text-[var(--color-text-muted)]">
                      {r.requested_on ? new Date(r.requested_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="text-sm font-medium">{r.consulting_doctor_name}</td>
                    <td className="text-sm max-w-48 truncate">{r.purpose}</td>
                    <td>
                      <span className={`badge ${STATUS_STYLES[r.status]}`}>
                        {t(`consultation.statuses.${r.status}`)}
                      </span>
                    </td>
                    <td className="text-sm max-w-48 truncate">
                      {r.consultant_response || '—'}
                      {r.consulted_on && (
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          {new Date(r.consulted_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </td>
                    <td>
                      {r.status === 'pending' && (
                        <button onClick={() => openRespondModal(r)} className="btn-ghost p-1.5 text-blue-600" title={t('consultation.respond')}>
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 20 && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">{t('consultation.page')} {page} {t('consultation.of')} {Math.ceil(total / 20)}</span>
            <div className="flex gap-2">
              <button onClick={() => fetchRequests(page - 1)} disabled={page <= 1} className="btn-secondary text-xs">{t('common:previous')}</button>
              <button onClick={() => fetchRequests(page + 1)} disabled={page >= Math.ceil(total / 20)} className="btn-secondary text-xs">{t('common:next')}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── New Request Modal ── */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('consultation.newRequest')}</h3>
              <button onClick={() => setShowNewModal(false)} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">{t('consultation.consultingDoctor')} *</label>
                <select
                  value={newForm.consulting_doctor_id}
                  onChange={e => setNewForm(f => ({ ...f, consulting_doctor_id: e.target.value }))}
                  className="input"
                  required
                >
                  <option value="">{t('consultation.selectDoctor')}</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">{t('consultation.purpose')} *</label>
                <textarea
                  value={newForm.purpose}
                  onChange={e => setNewForm(f => ({ ...f, purpose: e.target.value }))}
                  placeholder={t('consultation.purposePlaceholder')}
                  className="input min-h-[100px] resize-y"
                  rows={4}
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setShowNewModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button
                  onClick={handleCreate}
                  disabled={!newForm.consulting_doctor_id || !newForm.purpose.trim()}
                  className="btn-primary"
                >
                  {t('common:create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Respond Modal ── */}
      {showRespondModal && respondingTo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('consultation.respondTitle')}</h3>
              <button onClick={() => { setShowRespondModal(false); setRespondingTo(null); }} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="card p-3 bg-[var(--color-surface)] text-sm">
                <p className="text-[var(--color-text-muted)] text-xs mb-1">{t('consultation.originalRequest')}</p>
                <p className="font-medium">{respondingTo.requesting_doctor_name}</p>
                <p className="text-[var(--color-text-secondary)] mt-1">{respondingTo.purpose}</p>
              </div>

              <div>
                <label className="label">{t('consultation.response')} *</label>
                <textarea
                  value={responseText}
                  onChange={e => setResponseText(e.target.value)}
                  placeholder={t('consultation.responsePlaceholder')}
                  className="input min-h-[120px] resize-y"
                  rows={5}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => { setShowRespondModal(false); setRespondingTo(null); }} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleRespond} disabled={!responseText.trim()} className="btn-primary">
                  <Send className="w-4 h-4" /> {t('consultation.sendResponse')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

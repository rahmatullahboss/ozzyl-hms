import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Plus, X, Printer, Ban, Search, Filter, PenTool, AlertCircle, RefreshCw, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

/* ── Types ── */
interface Consent {
  id: number;
  patient_id: number;
  patient_name: string;
  template_id?: number;
  template_name?: string;
  consent_type: string;
  procedure_name: string;
  status: 'pending' | 'signed' | 'revoked';
  signed_at?: string;
  revoked_at?: string;
  revoke_reason?: string;
  witness_name?: string;
  guardian_name?: string;
  created_at: string;
}

interface ConsentTemplate {
  id: number;
  name: string;
  consent_type: string;
  body_text: string;
}

interface Patient {
  id: number;
  name: string;
  patient_id_display?: string;
}

const STATUS_OPTIONS = ['all', 'pending', 'signed', 'revoked'];
const CONSENT_TYPES = ['surgical', 'anesthesia', 'blood_transfusion', 'research', 'treatment', 'discharge', 'general'];

/* ── Helpers ── */
function statusBadge(status: string): string {
  const map: Record<string, string> = { pending: 'badge-warning', signed: 'badge-success', revoked: 'badge-danger' };
  return map[status] ?? 'badge-secondary';
}

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(4)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Create Consent Modal ── */
function CreateConsentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['common']);
  const [templates, setTemplates] = useState<ConsentTemplate[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [form, setForm] = useState({
    template_id: '', patient_id: '', procedure_name: '', consent_type: 'surgical',
    risks_explained: false, alternatives_explained: false, questions_answered: false,
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const load = async () => {
      try {
        const [tRes, pRes] = await Promise.all([
          api.get<{ data?: ConsentTemplate[] }>('/api/consents/templates'),
          api.get<{ data?: Patient[] }>('/api/patients?limit=200'),
        ]);
        setTemplates((tRes as any).data ?? (tRes as any) ?? []);
        setPatients((pRes as any).data ?? (pRes as any) ?? []);
      } catch {
        toast.error('Failed to load form data');
      }
    };
    load();
  }, []);

  const createMutation = useApiMutation<any, any>('post', '/api/consents', {
    onSuccess: () => {
      toast.success('Consent created');
      onSaved();
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || 'Failed');
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.risks_explained || !form.alternatives_explained || !form.questions_answered) {
      toast.error('All acknowledgment checkboxes must be checked');
      return;
    }
    createMutation.mutate({
      ...form,
      template_id: form.template_id ? parseInt(form.template_id) : null,
      patient_id: parseInt(form.patient_id),
    });
  };

  return (
    <Modal title="Create Consent" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Patient</label>
            <select className="input" required value={form.patient_id} onChange={e => set('patient_id', e.target.value)}>
              <option value="">Select patient...</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.name} {p.patient_id_display ? `(${p.patient_id_display})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Template</label>
            <select className="input" value={form.template_id} onChange={e => set('template_id', e.target.value)}>
              <option value="">No template</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Procedure Name</label>
            <input className="input" required value={form.procedure_name} onChange={e => set('procedure_name', e.target.value)} placeholder="e.g. Appendectomy" />
          </div>
          <div>
            <label className="label">Consent Type</label>
            <select className="input" value={form.consent_type} onChange={e => set('consent_type', e.target.value)}>
              {CONSENT_TYPES.map(ct => <option key={ct} value={ct}>{ct.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-2 p-4 bg-[var(--color-border-light)] rounded-xl">
          <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2">Patient Acknowledgments</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.risks_explained} onChange={e => set('risks_explained', e.target.checked)} className="rounded" />
            <span className="text-sm">Risks and complications have been explained</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.alternatives_explained} onChange={e => set('alternatives_explained', e.target.checked)} className="rounded" />
            <span className="text-sm">Alternative treatments have been discussed</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.questions_answered} onChange={e => set('questions_answered', e.target.checked)} className="rounded" />
            <span className="text-sm">Patient's questions have been answered</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('cancel')}</button>
          <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving') : 'Create Consent'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Sign Consent Modal ── */
function SignConsentModal({ consent, onClose, onSaved }: { consent: Consent; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['common']);
  const [form, setForm] = useState({ signature_text: '', witness_name: '', guardian_name: '', guardian_relationship: '' });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const signMutation = useApiMutation<any, any>('post', `/api/consents/${consent.id}/sign`, {
    onSuccess: () => {
      toast.success('Consent signed');
      onSaved();
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || 'Failed');
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    signMutation.mutate(form);
  };

  return (
    <Modal title={`Sign Consent - ${consent.procedure_name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="label">Signature (Type full name)</label>
          <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-4 bg-[var(--color-border-light)]">
            <input
              className="input text-center text-lg font-semibold italic"
              required
              value={form.signature_text}
              onChange={e => set('signature_text', e.target.value)}
              placeholder="Type full legal name as signature"
            />
            <p className="text-xs text-[var(--color-text-muted)] text-center mt-2">By typing your name, you acknowledge this as your electronic signature</p>
          </div>
        </div>
        <div>
          <label className="label">Witness Name</label>
          <input className="input" value={form.witness_name} onChange={e => set('witness_name', e.target.value)} placeholder="Witness full name" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Guardian Name (if applicable)</label>
            <input className="input" value={form.guardian_name} onChange={e => set('guardian_name', e.target.value)} placeholder="Guardian full name" />
          </div>
          <div>
            <label className="label">Guardian Relationship</label>
            <input className="input" value={form.guardian_relationship} onChange={e => set('guardian_relationship', e.target.value)} placeholder="e.g. Parent, Spouse" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('cancel')}</button>
          <button type="submit" disabled={signMutation.isPending} className="btn-primary">{signMutation.isPending ? t('saving') : 'Sign Consent'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Revoke Modal ── */
function RevokeModal({ consent, onClose, onSaved }: { consent: Consent; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['common']);
  const [reason, setReason] = useState('');

  const revokeMutation = useApiMutation<any, any>('post', `/api/consents/${consent.id}/revoke`, {
    onSuccess: () => {
      toast.success('Consent revoked');
      onSaved();
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || 'Failed');
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    revokeMutation.mutate({ reason });
  };

  return (
    <Modal title={`Revoke Consent - ${consent.procedure_name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">
          This will revoke the consent for <strong>{consent.patient_name}</strong> regarding <strong>{consent.procedure_name}</strong>. This action cannot be undone.
        </p>
        <div>
          <label className="label">Reason for Revocation</label>
          <textarea className="input min-h-[80px]" required value={reason} onChange={e => setReason(e.target.value)} placeholder="Provide reason for revoking this consent..." />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('cancel')}</button>
          <button type="submit" disabled={revokeMutation.isPending} className="btn-primary bg-red-600 hover:bg-red-700">{revokeMutation.isPending ? t('saving') : 'Revoke Consent'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Main Page ── */
export default function ConsentManagement({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['common']);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [signConsent, setSignConsent] = useState<Consent | null>(null);
  const [revokeConsent, setRevokeConsent] = useState<Consent | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const queryParams = new URLSearchParams();
  if (filterStatus !== 'all') queryParams.set('status', filterStatus);
  if (filterType !== 'all') queryParams.set('consent_type', filterType);
  if (searchQuery.trim()) queryParams.set('search', searchQuery.trim());
  const qs = queryParams.toString();
  const path = `/api/consents${qs ? `?${qs}` : ''}`;

  const filters = { status: filterStatus, type: filterType, search: searchQuery };
  const { data: consentsRaw, isLoading: loading, isError, refetch } = useApiQuery<any>(
    queryKeys.consents.list(filters),
    path,
  );
  const consents: Consent[] = consentsRaw?.data ?? consentsRaw ?? [];

  const invalidateConsents = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.consents.all });
  };

  const handlePrint = (id: number) => {
    window.open(`/api/consents/${id}/print?autoprint=1`, '_blank');
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Consent Management</h1>
              <p className="section-subtitle">Manage patient consents, signatures, and revocations</p>
            </div>
          </div>
        </div>

        {/* Filters & Actions */}
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              className="input pl-9"
              placeholder="Search by patient name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
            <select className="input w-auto" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select className="input w-auto" value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              {CONSENT_TYPES.map(ct => <option key={ct} value={ct}>{ct.replace('_', ' ')}</option>)}
            </select>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" />Create Consent</button>
        </div>

        {/* Table */}
        {isError ? (
          <div className="card p-8 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-[var(--color-text-secondary)] mb-3">Failed to load consents</p>
            <button onClick={() => refetch()} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('retry')}</button>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Procedure</th>
                    <th className="hidden sm:table-cell">Type</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? <SkeletonRows cols={6} />
                    : consents.length === 0 ? (
                      <tr><td colSpan={6}>
                        <EmptyState
                          icon={<ShieldCheck className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title="No consents found"
                          description="Create a new consent form to get started."
                          action={<button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />Create Consent</button>}
                        />
                      </td></tr>
                    ) : consents.map(c => (
                      <tr key={c.id} className="hover:bg-[var(--color-border-light)]">
                        <td className="font-medium">{c.patient_name}</td>
                        <td>{c.procedure_name}</td>
                        <td className="hidden sm:table-cell capitalize text-sm">{c.consent_type.replace('_', ' ')}</td>
                        <td><span className={`badge ${statusBadge(c.status)}`}>{c.status}</span></td>
                        <td className="hidden md:table-cell text-sm text-[var(--color-text-secondary)] whitespace-nowrap">{formatDisplayDate(c.created_at)}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            {c.status === 'pending' && (
                              <button onClick={() => setSignConsent(c)} className="btn-ghost p-1.5 text-emerald-600" title="Sign"><PenTool className="w-4 h-4" /></button>
                            )}
                            {c.status === 'signed' && (
                              <button onClick={() => setRevokeConsent(c)} className="btn-ghost p-1.5 text-red-500" title="Revoke"><Ban className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => handlePrint(c.id)} className="btn-ghost p-1.5" title="Print"><Printer className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modals */}
        {showCreate && <CreateConsentModal onClose={() => setShowCreate(false)} onSaved={invalidateConsents} />}
        {signConsent && <SignConsentModal consent={signConsent} onClose={() => setSignConsent(null)} onSaved={invalidateConsents} />}
        {revokeConsent && <RevokeModal consent={revokeConsent} onClose={() => setRevokeConsent(null)} onSaved={invalidateConsents} />}
      </div>
    </DashboardLayout>
  );
}

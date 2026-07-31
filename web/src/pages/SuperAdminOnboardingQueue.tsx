import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Inbox, ChevronLeft, RefreshCw, Check, X, Phone, Rocket, Copy, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

interface OnboardingRequest {
  id: number;
  hospital_name: string;
  bed_count: string;
  contact_name: string | null;
  whatsapp_number: string;
  email: string | null;
  status: string;
  notes: string | null;
  tenant_id: number | null;
  created_at: string;
}

const STATUS_TABS = ['pending', 'contacted', 'approved', 'rejected', 'provisioned'] as const;
const STATUS_COLORS: Record<string, string> = { pending: 'bg-amber-100 text-amber-700', contacted: 'bg-blue-100 text-blue-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700', provisioned: 'bg-purple-100 text-purple-700' };

export default function SuperAdminOnboardingQueue() {
  const [activeTab, setActiveTab] = useState<string>('pending');
  const [showProvision, setShowProvision] = useState<OnboardingRequest | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{ hospital: { slug: string }; credentials: { email: string; password: string; loginUrl: string }; whatsappMessage: string } | null>(null);
  const navigate = useNavigate();
  const { t } = useTranslation(['super-admin', 'common']);
  const queryClient = useQueryClient();

  const { data: requestsData, isLoading: loading } = useApiQuery<{ requests: OnboardingRequest[] }>(
    queryKeys.superAdmin.onboarding(activeTab),
    `/api/admin/onboarding?status=${activeTab}`,
  );
  const requests = requestsData?.requests ?? [];

  const updateStatus = async (id: number, status: string, notes?: string) => {
    try {
      await api.put(`/api/admin/onboarding/${id}`, { status, notes });
      toast.success(t('superAdmin.statusUpdated', { status }));
      queryClient.invalidateQueries({ queryKey: queryKeys.superAdmin.all });
    } catch { toast.error(t('super-admin.failed_to_update')); }
  };

  const handleProvision = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showProvision) return;
    setProvisioning(true);
    const formData = new FormData(e.currentTarget);
    try {
      const data = await api.post<typeof provisionResult>(`/api/admin/onboarding/${showProvision.id}/provision`, {
        slug: formData.get('slug'), adminEmail: formData.get('adminEmail'), adminName: formData.get('adminName'), plan: formData.get('plan') || 'basic',
      });
      setProvisionResult(data);
      toast.success(t('super-admin.hospital_provisioned'));
      queryClient.invalidateQueries({ queryKey: queryKeys.superAdmin.all });
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || 'Provisioning failed';
      toast.error(errMsg);
    } finally { setProvisioning(false); }
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast.success(t('super-admin.copied')); };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/super-admin/dashboard')} className="btn-ghost p-2"><ChevronLeft className="w-5 h-5" /></button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2"><Inbox className="w-6 h-6 text-[var(--color-primary)]" />Onboarding Queue</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Applications from the founding hospital program</p>
            </div>
          </div>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.superAdmin.onboarding(activeTab) })} className="btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex gap-1 bg-[var(--color-bg-secondary)] rounded-lg p-1 mb-6 overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm rounded-md font-medium transition-colors whitespace-nowrap ${activeTab === tab ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {loading ? ([...Array(3)].map((_, i) => (<div key={i} className="card p-5"><div className="skeleton h-6 w-1/3 mb-3" /><div className="skeleton h-4 w-2/3" /></div>)))
          : requests.length === 0 ? (
            <div className="card p-10 text-center"><Inbox className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-3" /><p className="text-[var(--color-text-muted)]">No {activeTab} requests</p></div>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="card p-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-[var(--color-text-primary)] text-lg">{req.hospital_name}</h3>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[req.status]}`}>{req.status}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-[var(--color-text-secondary)]">
                      <div>Beds: <span className="font-medium">{req.bed_count}</span></div>
                      <div>WhatsApp: <span className="font-medium">{req.whatsapp_number}</span></div>
                      {req.contact_name && <div>Contact: <span className="font-medium">{req.contact_name}</span></div>}
                      {req.email && <div>Email: <span className="font-medium">{req.email}</span></div>}
                      <div>Applied: <span className="font-medium">{formatDisplayDate(req.created_at)}</span></div>
                    </div>
                    {req.notes && <p className="mt-2 text-sm bg-[var(--color-bg-secondary)] p-2 rounded text-[var(--color-text-muted)] italic">{req.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {req.status === 'pending' && (<>
                      <button onClick={() => updateStatus(req.id, 'contacted')} className="btn-secondary text-sm"><Phone className="w-3.5 h-3.5" /> Contacted</button>
                      <button onClick={() => updateStatus(req.id, 'approved')} className="btn-primary text-sm"><Check className="w-3.5 h-3.5" /> Approve</button>
                      <button onClick={() => updateStatus(req.id, 'rejected')} className="btn-ghost text-sm text-red-500"><X className="w-3.5 h-3.5" /> Reject</button>
                    </>)}
                    {req.status === 'contacted' && (<>
                      <button onClick={() => updateStatus(req.id, 'approved')} className="btn-primary text-sm"><Check className="w-3.5 h-3.5" /> Approve</button>
                      <button onClick={() => updateStatus(req.id, 'rejected')} className="btn-ghost text-sm text-red-500"><X className="w-3.5 h-3.5" /> Reject</button>
                    </>)}
                    {req.status === 'approved' && (<button onClick={() => { setShowProvision(req); setProvisionResult(null); }} className="btn-primary text-sm"><Rocket className="w-3.5 h-3.5" /> Provision Now</button>)}
                    {req.status === 'provisioned' && req.tenant_id && (<button onClick={() => navigate(`/super-admin/hospitals/${req.tenant_id}`)} className="btn-secondary text-sm">View Hospital →</button>)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {showProvision && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="card max-w-lg w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
              {provisionResult ? (
                <div>
                  <div className="text-center mb-5">
                    <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3"><Check className="w-8 h-8 text-emerald-600" /></div>
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Hospital Provisioned!</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{showProvision.hospital_name}</p>
                  </div>
                  <div className="space-y-3 mb-5">
                    <div className="bg-[var(--color-bg-secondary)] rounded-lg p-3"><p className="text-xs font-medium text-[var(--color-text-muted)] mb-1">Login URL</p><p className="font-data text-sm">{provisionResult.credentials.loginUrl}</p></div>
                    <div className="bg-[var(--color-bg-secondary)] rounded-lg p-3"><p className="text-xs font-medium text-[var(--color-text-muted)] mb-1">Email</p><p className="font-data text-sm">{provisionResult.credentials.email}</p></div>
                    <div className="bg-[var(--color-bg-secondary)] rounded-lg p-3"><p className="text-xs font-medium text-[var(--color-text-muted)] mb-1">Password</p><p className="font-data text-sm">{provisionResult.credentials.password}</p></div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => copyToClipboard(provisionResult.whatsappMessage)} className="btn-primary flex-1"><Copy className="w-4 h-4" /> Copy WhatsApp Message</button>
                    <a href={`https://wa.me/${showProvision.whatsapp_number}?text=${encodeURIComponent(provisionResult.whatsappMessage)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Send</a>
                  </div>
                  <button onClick={() => { setShowProvision(null); setProvisionResult(null); }} className="btn-ghost w-full mt-3">Close</button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Provision: {showProvision.hospital_name}</h2>
                    <button onClick={() => setShowProvision(null)} className="btn-ghost p-1"><X className="w-5 h-5" /></button>
                  </div>
                  <form onSubmit={handleProvision} className="space-y-4">
                    <div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Subdomain (Slug)</label><input name="slug" required className="input-field w-full" placeholder={t("super-admin.eg_citygeneral")} pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$" defaultValue={showProvision.hospital_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')} /></div>
                    <div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Admin Name</label><input name="adminName" required className="input-field w-full" defaultValue={showProvision.contact_name || ''} /></div>
                    <div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Admin Email</label><input name="adminEmail" type="email" required className="input-field w-full" defaultValue={showProvision.email || ''} /></div>
                    <div><label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Plan</label><select name="plan" className="input-field w-full"><option value="basic">Basic</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></div>
                    <div className="flex gap-3 pt-2"><button type="button" onClick={() => setShowProvision(null)} className="btn-ghost flex-1">Cancel</button><button type="submit" disabled={provisioning} className="btn-primary flex-1"><Rocket className="w-4 h-4" /> {provisioning ? 'Provisioning...' : 'Provision'}</button></div>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

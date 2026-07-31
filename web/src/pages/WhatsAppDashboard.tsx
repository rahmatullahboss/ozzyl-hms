import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Plus, X, Send, RefreshCw, CheckCircle, AlertTriangle, Settings, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface WaMessage { id: number; recipient_phone: string; recipient_name?: string; template_name?: string; message_body?: string; status: string; sent_at?: string; delivered_at?: string; read_at?: string; error_message?: string; created_at: string; }
interface WaTemplate { id: number; template_name: string; template_type: string; language: string; body_text: string; status: string; }
interface WaConfig { phone_number_id?: string; is_active?: number; }
interface Stats { total: number; sent: number; delivered: number; read_count: number; failed: number; today_count: number; }

const MSG_STATUS: Record<string, string> = { queued: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700', delivered: 'bg-cyan-100 text-cyan-700', read: 'badge-success', failed: 'bg-red-100 text-red-700' };
const TABS = ['messages', 'send', 'templates', 'config'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('notifications');
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

function MessagesTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const queryClient = useQueryClient();

  const filterParams: Record<string, string> = statusFilter ? { status: statusFilter } : {};
  const messagesPath = statusFilter
    ? `/api/whatsapp/messages?status=${encodeURIComponent(statusFilter)}`
    : '/api/whatsapp/messages';

  const { data: messagesData, isLoading: messagesLoading } = useApiQuery<{ data: WaMessage[] }>(
    queryKeys.whatsapp.messages(filterParams),
    messagesPath,
  );

  const { data: statsData } = useApiQuery<Stats>(
    queryKeys.whatsapp.stats(),
    '/api/whatsapp/stats',
  );

  const items = messagesData?.data ?? [];
  const stats = statsData ?? null;
  const loading = messagesLoading;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.all });
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { l: 'Total', v: stats.total }, { l: 'Sent', v: stats.sent, c: 'text-blue-600' },
            { l: 'Delivered', v: stats.delivered, c: 'text-cyan-600' }, { l: 'Read', v: stats.read_count, c: 'text-green-600' },
            { l: 'Failed', v: stats.failed, c: 'text-red-500' }, { l: 'Today', v: stats.today_count, c: 'text-[var(--color-primary)]' },
          ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-xl font-bold mt-1 ${k.c ?? ''}`}>{k.v}</p></div>)}
        </div>
      )}
      <div className="flex gap-3 items-end">
        <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All</option><option value="sent">Sent</option><option value="delivered">Delivered</option>
          <option value="read">Read</option><option value="failed">Failed</option>
        </select>
        <button onClick={handleRefresh} className="btn-ghost"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Recipient</th><th>Phone</th><th>Template</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Read</th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">No messages</td></tr>
        : items.map(m => (
          <tr key={m.id}>
            <td className="font-medium">{m.recipient_name ?? '—'}</td>
            <td className="font-mono text-xs">{m.recipient_phone}</td>
            <td className="text-xs"><span className="badge-neutral">{m.template_name ?? '—'}</span></td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${MSG_STATUS[m.status] ?? ''}`}>{m.status}</span></td>
            <td className="text-xs">{m.sent_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
            <td className="text-xs">{m.delivered_at ? <CheckCircle className="w-3.5 h-3.5 text-cyan-500 inline" /> : '—'}</td>
            <td className="text-xs">{m.read_at ? <CheckCircle className="w-3.5 h-3.5 text-green-500 inline" /> : '—'}</td>
          </tr>
        ))}
      </tbody></table></div></div>
    </div>
  );
}

function SendTab() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ phone: '', recipient_name: '', template_name: 'appointment_reminder', parameters: '' });
  const [bulkDate, setBulkDate] = useState('');
  const [apptId, setApptId] = useState('');

  const sendSingleMutation = useApiMutation<unknown, { phone: string; recipient_name: string; template_name: string; parameters: string[] }>(
    'post',
    '/api/whatsapp/send',
    {
      onSuccess: () => {
        toast.success(t('message_sent'));
        queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.all });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const sendReminderMutation = useApiMutation<{ message: string }, { appointment_id: number }>(
    'post',
    '/api/whatsapp/send-appointment-reminder',
    {
      onSuccess: (data) => {
        toast.success(data.message);
        queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.all });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const sendBulkMutation = useApiMutation<{ sent: number; failed: number }, { date: string; days_before: number }>(
    'post',
    '/api/whatsapp/send-bulk',
    {
      onSuccess: (data) => {
        toast.success(t('messagesSent', { sent: data.sent, failed: data.failed }));
        queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.all });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const sendSingle = (e: React.FormEvent) => {
    e.preventDefault();
    const params = form.parameters.split(',').map(p => p.trim()).filter(Boolean);
    sendSingleMutation.mutate({ ...form, parameters: params });
  };

  const sendReminder = () => {
    if (!apptId) { toast.error(t('enter_appointment_id')); return; }
    sendReminderMutation.mutate({ appointment_id: Number(apptId) });
  };

  const sendBulk = () => {
    if (!bulkDate) { toast.error(t('select_date')); return; }
    sendBulkMutation.mutate({ date: bulkDate, days_before: 1 });
  };

  const sending = sendSingleMutation.isPending || sendReminderMutation.isPending;
  const bulkSending = sendBulkMutation.isPending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card p-5">
        <h3 className="section-title mb-3">Send to Single Patient</h3>
        <form onSubmit={sendSingle} className="space-y-3">
          <div><label className="label">Phone *</label><input className="input w-full" required value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder={t("880_or_01")} /></div>
          <div><label className="label">{t('name')}</label><input className="input w-full" value={form.recipient_name} onChange={e => setForm({...form, recipient_name: e.target.value})} /></div>
          <div><label className="label">{t('template_name_')}</label><input className="input w-full" required value={form.template_name} onChange={e => setForm({...form, template_name: e.target.value})} /></div>
          <div><label className="label">Parameters (comma-separated)</label><input className="input w-full" value={form.parameters} onChange={e => setForm({...form, parameters: e.target.value})} placeholder={t("patient_name_date_time_doctor")} /></div>
          <button type="submit" disabled={sending} className="btn-primary w-full"><Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send WhatsApp'}</button>
        </form>
      </div>

      <div className="space-y-5">
        <div className="card p-5">
          <h3 className="section-title mb-3">Quick: Appointment Reminder</h3>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder={t("appointment_id")} value={apptId} onChange={e => setApptId(e.target.value)} />
            <button onClick={sendReminder} disabled={sending} className="btn-primary"><Send className="w-4 h-4" /> Send</button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">Auto-fills patient name, date, time, doctor from the appointment.</p>
        </div>

        <div className="card p-5">
          <h3 className="section-title mb-3">Bulk: All Appointments for Date</h3>
          <div className="flex gap-2">
            <input type="date" className="input flex-1" value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
            <button onClick={sendBulk} disabled={bulkSending} className="btn-primary"><Send className="w-4 h-4" /> {bulkSending ? 'Sending...' : 'Send All'}</button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">Sends reminder to all scheduled appointments on this date.</p>
        </div>
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ template_name: '', template_type: 'appointment', language: 'en', body_text: '', meta_template_id: '' });

  const { data: templatesData, isLoading: loading } = useApiQuery<{ data: WaTemplate[] }>(
    queryKeys.whatsapp.templates(),
    '/api/whatsapp/templates',
  );

  const items = templatesData?.data ?? [];

  const saveMutation = useApiMutation<unknown, typeof form & { status: string }>(
    'post',
    '/api/whatsapp/templates',
    {
      onSuccess: () => {
        toast.success('Template saved');
        setShowForm(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.templates() });
      },
      onError: () => toast.error('Failed'),
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...form, status: form.meta_template_id ? 'approved' : 'draft' });
  };

  const saving = saveMutation.isPending;
  const STATUS_B: Record<string, string> = { draft: 'badge-neutral', pending_approval: 'badge-warning', approved: 'badge-success', rejected: 'bg-red-100 text-red-700' };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> Add Template</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Name</th><th>Type</th><th>Language</th><th>Body</th><th>Status</th></tr></thead><tbody>
        {loading ? [...Array(2)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">No templates. Add your Meta-approved templates here.</td></tr>
        : items.map(t => (
          <tr key={t.id}>
            <td className="font-mono text-sm font-medium">{t.template_name}</td>
            <td className="text-xs"><span className="badge-neutral">{t.template_type}</span></td>
            <td className="text-sm">{t.language}</td>
            <td className="text-xs text-[var(--color-text-muted)] max-w-64 truncate">{t.body_text}</td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_B[t.status] ?? ''}`}>{t.status}</span></td>
          </tr>
        ))}
      </tbody></table></div></div>
      {showForm && (
        <Modal title="Add WhatsApp Template" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">Template Name *</label><input className="input w-full" required value={form.template_name} onChange={e => setForm({...form, template_name: e.target.value})} placeholder={t("appointment_reminder")} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('type')}</label><select className="input w-full" value={form.template_type} onChange={e => setForm({...form, template_type: e.target.value})}><option value="appointment">Appointment</option><option value="lab_result">Lab Result</option><option value="prescription">Prescription</option><option value="discharge">Discharge</option><option value="billing">Billing</option><option value="general">General</option></select></div>
              <div><label className="label">{t('language')}</label><select className="input w-full" value={form.language} onChange={e => setForm({...form, language: e.target.value})}><option value="en">English</option><option value="bn">Bangla</option></select></div>
            </div>
            <div><label className="label">Body Text * (use {'{{1}}'}, {'{{2}}'} for variables)</label><textarea className="input w-full" required rows={4} value={form.body_text} onChange={e => setForm({...form, body_text: e.target.value})} placeholder={t("dear_1_your_appointment_is_on_2_at_3_with_4")} /></div>
            <div><label className="label">Meta Template ID (if approved)</label><input className="input w-full" value={form.meta_template_id} onChange={e => setForm({...form, meta_template_id: e.target.value})} placeholder={t("leave_empty_for_draft")} /></div>
            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ConfigTab() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ phone_number_id: '', business_account_id: '', access_token: '', default_template_name: 'appointment_reminder', default_language: 'en' });

  const { data: configData, isLoading: loading } = useApiQuery<{ data: WaConfig }>(
    queryKeys.whatsapp.config(),
    '/api/whatsapp/config',
  );

  const config = configData?.data ?? null;

  // Populate form when config loads
  useEffect(() => {
    if (config?.phone_number_id) {
      setForm(f => ({ ...f, phone_number_id: config.phone_number_id! }));
    }
  }, [config?.phone_number_id]);

  const saveMutation = useApiMutation<unknown, typeof form>(
    'post',
    '/api/whatsapp/config',
    {
      onSuccess: () => {
        toast.success('Config saved');
        queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.config() });
      },
      onError: () => toast.error('Failed'),
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const saving = saveMutation.isPending;

  if (loading) return <div className="card p-8 text-center text-[var(--color-text-muted)]">Loading...</div>;

  return (
    <div className="card p-5 max-w-lg">
      <h3 className="section-title mb-4">WhatsApp Business API Configuration</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
          <p className="font-medium mb-1">Setup Guide:</p>
          <ol className="list-decimal ml-4 space-y-1 text-xs">
            <li>Go to <strong>Meta Business Suite</strong> → WhatsApp → API Setup</li>
            <li>Copy your <strong>Phone Number ID</strong> and <strong>Access Token</strong></li>
            <li>Create message templates and get them approved by Meta</li>
            <li>Set webhook URL: <code className="bg-white px-1 rounded">https://yoursite.com/api/whatsapp/webhook</code></li>
          </ol>
        </div>
        <div><label className="label">Phone Number ID *</label><input className="input w-full" required value={form.phone_number_id} onChange={e => setForm({...form, phone_number_id: e.target.value})} placeholder={t("from_meta_business_whatsapp_api_setup")} /></div>
        <div><label className="label">{t('business_account_id')}</label><input className="input w-full" value={form.business_account_id} onChange={e => setForm({...form, business_account_id: e.target.value})} /></div>
        <div><label className="label">Access Token *</label><input className="input w-full" required type="password" value={form.access_token} onChange={e => setForm({...form, access_token: e.target.value})} placeholder={t("permanent_token_from_meta")} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">{t('default_template')}</label><input className="input w-full" value={form.default_template_name} onChange={e => setForm({...form, default_template_name: e.target.value})} /></div>
          <div><label className="label">{t('language')}</label><select className="input w-full" value={form.default_language} onChange={e => setForm({...form, default_language: e.target.value})}><option value="en">English</option><option value="bn">Bangla</option></select></div>
        </div>
        <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving...' : 'Save Configuration'}</button>
      </form>
      {config?.is_active ? <p className="mt-3 text-sm text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> WhatsApp is connected</p> : <p className="mt-3 text-sm text-amber-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> WhatsApp not configured yet</p>}
    </div>
  );
}

export default function WhatsAppDashboard({ role }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('messages');
  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20"><MessageCircle className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">WhatsApp</h1><p className="section-subtitle">Appointment reminders, notifications & messaging via WhatsApp Business</p></div>
        </div></div>
        <div className="card p-1.5 flex gap-1 flex-wrap">{TABS.map(t => (<button key={t} onClick={() => setTab(t)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
          {t === 'messages' ? <><MessageCircle className="w-4 h-4" />Messages</> : t === 'send' ? <><Send className="w-4 h-4" />Send</> : t === 'templates' ? <><FileText className="w-4 h-4" />Templates</> : <><Settings className="w-4 h-4" />Config</>}
        </button>))}</div>
        {tab === 'messages' && <MessagesTab />}{tab === 'send' && <SendTab />}{tab === 'templates' && <TemplatesTab />}{tab === 'config' && <ConfigTab />}
      </div>
    </DashboardLayout>
  );
}

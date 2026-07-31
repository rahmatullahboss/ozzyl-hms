import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Mail, Server, Bell, Send } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useSettingsForm } from '../hooks/useSettingsForm';
import { useApiMutation } from '../hooks/useApiQuery';
import toast from 'react-hot-toast';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface EmailSettingsData {
  provider: string;
  from_name: string;
  from_address: string;
  api_key: string;
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  smtp_secure: boolean;
  enabled: boolean;
  appointment_reminder: boolean;
  lab_report_ready: boolean;
  invoice_sent: boolean;
  welcome_user: boolean;
  password_reset: boolean;
  due_reminder: boolean;
}

// ─── Reusable Components ────────────────────────────────────────────────────────

function Section({ icon, title, desc, children }: {
  icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md bg-[var(--color-primary-light)] flex items-center justify-center">
          <span className="text-[var(--color-primary)]">{icon}</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
          {desc && <p className="text-xs text-[var(--color-text-muted)]">{desc}</p>}
        </div>
      </div>
      <div className="space-y-4 pl-10">{children}</div>
    </div>
  );
}

function Field({ id, label, type = 'text', value, onChange, placeholder, hint }: {
  id: string; label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} aria-label={label} type={type} className="input" value={value}
        onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange, hint, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
        {hint && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-label={label} aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)} disabled={disabled}
        className={`relative w-10 h-6 rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'right-1' : 'left-1'}`} />
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function EmailSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');
  const [testEmail, setTestEmail] = useState('');

  const { values: settings, update, save, loading: isLoading, saving } = useSettingsForm<EmailSettingsData>({
    queryKey: ['settings', 'email'],
    prefix: 'email_',
    defaultValues: {
      provider: 'resend',
      from_name: '',
      from_address: '',
      api_key: '',
      smtp_host: '',
      smtp_port: '587',
      smtp_username: '',
      smtp_password: '',
      smtp_secure: true,
      enabled: true,
      appointment_reminder: true,
      lab_report_ready: true,
      invoice_sent: true,
      welcome_user: true,
      password_reset: true,
      due_reminder: false,
    },
  });

  const testEmailMutation = useApiMutation<{ message: string }, { to: string }>(
    'post',
    '/api/settings/email/test',
    {
      onSuccess: (data) => toast.success(data.message || 'Test email sent'),
      onError: () => toast.error('Failed to send test email'),
    },
  );

  const sendTestEmail = () => {
    if (!testEmail.trim()) {
      toast.error('Enter a test email address');
      return;
    }
    testEmailMutation.mutate({ to: testEmail.trim() });
  };

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div>
          <h1 className="page-title">Email Settings</h1>
          <p className="section-subtitle mt-1">Configure email provider, SMTP, and notification events</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-32 w-full rounded-xl" />)}
          </div>
        ) : (
          <>
            {/* ── Master Toggle ── */}
            <Section icon={<Mail className="w-4 h-4" />} title="Email Provider" desc="Enable email notifications and choose your provider">
              <Toggle label="Email Enabled" checked={settings.enabled}
                onChange={v => update('enabled', v)}
                hint="Master switch for all email notifications" />
              <div>
                <label htmlFor="email-provider" className="label">Email Provider</label>
                <select id="email-provider" aria-label="Email Provider" className="input"
                  value={settings.provider}
                  onChange={e => update('provider', e.target.value)}>
                  <option value="resend">Resend</option>
                  <option value="smtp">SMTP</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field id="from-name" label="From Name" value={settings.from_name}
                  onChange={v => update('from_name', v)}
                  placeholder="e.g. City Care Hospital" />
                <Field id="from-address" label="From Address" type="email" value={settings.from_address}
                  onChange={v => update('from_address', v)}
                  placeholder="e.g. noreply@hospital.com" />
              </div>
              {settings.provider === 'resend' && (
                <Field id="api-key" label="API Key" type="password" value={settings.api_key}
                  onChange={v => update('api_key', v)}
                  placeholder="re_xxxxxxxxxxxx"
                  hint="Get your API key from resend.com" />
              )}
            </Section>

            {/* ── SMTP Configuration ── */}
            {settings.provider === 'smtp' && (
              <Section icon={<Server className="w-4 h-4" />} title="SMTP Configuration" desc="Configure SMTP server details">
                <div className="grid grid-cols-2 gap-4">
                  <Field id="smtp-host" label="SMTP Host" value={settings.smtp_host}
                    onChange={v => update('smtp_host', v)}
                    placeholder="e.g. smtp.gmail.com" />
                  <Field id="smtp-port" label="SMTP Port" value={settings.smtp_port}
                    onChange={v => update('smtp_port', v)}
                    placeholder="e.g. 587" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field id="smtp-username" label="SMTP Username" value={settings.smtp_username}
                    onChange={v => update('smtp_username', v)}
                    placeholder="e.g. user@gmail.com" />
                  <Field id="smtp-password" label="SMTP Password" type="password" value={settings.smtp_password}
                    onChange={v => update('smtp_password', v)}
                    placeholder="App password" />
                </div>
                <Toggle label="Use SSL/TLS" checked={settings.smtp_secure}
                  onChange={v => update('smtp_secure', v)}
                  hint="Enable for port 465, disable for port 587 (STARTTLS)" />
              </Section>
            )}

            {/* ── Email Events ── */}
            <Section icon={<Bell className="w-4 h-4" />} title="Email Events" desc="Choose which events trigger email notifications">
              <Toggle label="Appointment Reminder" checked={settings.appointment_reminder}
                onChange={v => update('appointment_reminder', v)} disabled={!settings.enabled} />
              <Toggle label="Lab Report Ready" checked={settings.lab_report_ready}
                onChange={v => update('lab_report_ready', v)} disabled={!settings.enabled} />
              <Toggle label="Invoice Sent" checked={settings.invoice_sent}
                onChange={v => update('invoice_sent', v)} disabled={!settings.enabled} />
              <Toggle label="Welcome User" checked={settings.welcome_user}
                onChange={v => update('welcome_user', v)} disabled={!settings.enabled} />
              <Toggle label="Password Reset" checked={settings.password_reset}
                onChange={v => update('password_reset', v)} disabled={!settings.enabled} />
              <Toggle label="Due Reminder" checked={settings.due_reminder}
                onChange={v => update('due_reminder', v)} disabled={!settings.enabled} />
            </Section>

            {/* ── Test Email ── */}
            <Section icon={<Send className="w-4 h-4" />} title="Test Email" desc="Send a test email to verify your configuration">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label htmlFor="test-email-address" className="label">Test Email Address</label>
                  <input id="test-email-address" aria-label="Test Email Address" type="email"
                    className="input" value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    placeholder="test@example.com" />
                </div>
                <div className="flex items-end">
                  <button onClick={sendTestEmail} disabled={testEmailMutation.isPending}
                    className="btn-secondary">
                    <Send className="w-4 h-4" />
                    {testEmailMutation.isPending ? 'Sending...' : 'Send Test Email'}
                  </button>
                </div>
              </div>
            </Section>

            {/* ── Save Button ── */}
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className="btn-primary">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

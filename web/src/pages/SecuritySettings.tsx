import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Shield, Lock, Clock, Key, Globe } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useSettingsForm } from '../hooks/useSettingsForm';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface SecuritySettingsData {
  min_password_length: number;
  require_uppercase: boolean;
  require_number: boolean;
  require_special_char: boolean;
  force_password_change_days: number;
  session_timeout_minutes: number;
  max_login_attempts: number;
  lockout_duration_minutes: number;
  two_factor_enabled: boolean;
  ip_restriction_enabled: boolean;
  allowed_ips: string;
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

function Field({ id, label, type = 'text', value, onChange, placeholder, hint, min, max }: {
  id: string; label: string; type?: string; value: string | number;
  onChange: (v: string) => void; placeholder?: string; hint?: string; min?: number; max?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} aria-label={label} type={type} className="input" value={value}
        onChange={e => onChange(e.target.value)} placeholder={placeholder}
        min={min} max={max} />
      {hint && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
        {hint && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-label={label} aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'right-1' : 'left-1'}`} />
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function SecuritySettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');

  const { values: settings, update, save, loading: isLoading, saving } = useSettingsForm<SecuritySettingsData>({
    queryKey: ['settings', 'security'],
    prefix: 'security_',
    defaultValues: {
      min_password_length: 8,
      require_uppercase: true,
      require_number: true,
      require_special_char: false,
      force_password_change_days: 90,
      session_timeout_minutes: 30,
      max_login_attempts: 5,
      lockout_duration_minutes: 15,
      two_factor_enabled: false,
      ip_restriction_enabled: false,
      allowed_ips: '',
    },
  });

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div>
          <h1 className="page-title">Security Settings</h1>
          <p className="section-subtitle mt-1">Password policy, session timeout, login protection, 2FA</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-32 w-full rounded-xl" />)}
          </div>
        ) : (
          <>
            {/* ── Password Policy ── */}
            <Section icon={<Lock className="w-4 h-4" />} title="Password Policy" desc="Minimum requirements for user passwords">
              <div className="grid grid-cols-2 gap-4">
                <Field id="min-password-length" label="Minimum Password Length" type="number"
                  value={settings.min_password_length}
                  onChange={v => update('min_password_length', Number(v))}
                  min={6} max={32} hint="Recommended: 8 or more" />
                <Field id="force-password-change" label="Force Password Change (Days)" type="number"
                  value={settings.force_password_change_days}
                  onChange={v => update('force_password_change_days', Number(v))}
                  min={0} hint="0 = never force change" />
              </div>
              <Toggle label="Require Uppercase Letter" checked={settings.require_uppercase}
                onChange={v => update('require_uppercase', v)} />
              <Toggle label="Require Number" checked={settings.require_number}
                onChange={v => update('require_number', v)} />
              <Toggle label="Require Special Character" checked={settings.require_special_char}
                onChange={v => update('require_special_char', v)}
                hint="e.g. !@#$%^&*" />
            </Section>

            {/* ── Session Settings ── */}
            <Section icon={<Clock className="w-4 h-4" />} title="Session Settings" desc="Auto-logout after inactivity">
              <Field id="session-timeout" label="Session Timeout (Minutes)" type="number"
                value={settings.session_timeout_minutes}
                onChange={v => update('session_timeout_minutes', Number(v))}
                min={5} max={480} hint="User will be logged out after this period of inactivity" />
            </Section>

            {/* ── Login Protection ── */}
            <Section icon={<Shield className="w-4 h-4" />} title="Login Protection" desc="Lockout after failed attempts">
              <div className="grid grid-cols-2 gap-4">
                <Field id="max-login-attempts" label="Max Login Attempts" type="number"
                  value={settings.max_login_attempts}
                  onChange={v => update('max_login_attempts', Number(v))}
                  min={3} max={20} />
                <Field id="lockout-duration" label="Lockout Duration (Minutes)" type="number"
                  value={settings.lockout_duration_minutes}
                  onChange={v => update('lockout_duration_minutes', Number(v))}
                  min={5} max={1440} />
              </div>
            </Section>

            {/* ── Two-Factor Authentication ── */}
            <Section icon={<Key className="w-4 h-4" />} title="Two-Factor Authentication" desc="Extra security layer for admin accounts">
              <Toggle label="Enable Two-Factor Authentication" checked={settings.two_factor_enabled}
                onChange={v => update('two_factor_enabled', v)}
                hint="Admins will need an authenticator app to log in" />
            </Section>

            {/* ── IP Restriction ── */}
            <Section icon={<Globe className="w-4 h-4" />} title="IP Restriction" desc="Limit access to specific IP addresses">
              <Toggle label="Enable IP Restriction" checked={settings.ip_restriction_enabled}
                onChange={v => update('ip_restriction_enabled', v)}
                hint="Only allowed IPs can access the system" />
              {settings.ip_restriction_enabled && (
                <Field id="allowed-ips" label="Allowed IPs" value={settings.allowed_ips}
                  onChange={v => update('allowed_ips', v)}
                  placeholder="e.g. 103.0.0.1, 192.168.1.0/24"
                  hint="Comma-separated list of IPs or CIDR ranges" />
              )}
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

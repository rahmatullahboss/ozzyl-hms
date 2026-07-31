import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Calendar, Hash, Users, Clock } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useSettingsForm } from '../hooks/useSettingsForm';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface AppointmentSettingsData {
  appointment_mode: 'serial' | 'time_slot' | 'both';
  token_prefix: string;
  token_reset: 'daily' | 'monthly' | 'never';
  token_print_size: 'a5' | 'pos';
  show_fee_on_token: boolean;
  auto_next_serial: boolean;
  manual_call_patient: boolean;
  skip_patient_allowed: boolean;
  no_show_mark_allowed: boolean;
  doctor_can_call_next: boolean;
  followup_validity_days: number;
  followup_fee: number;
  followup_serial_priority: boolean;
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
  id: string; label: string; type?: string; value: string | number;
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

function Select({ id, label, value, onChange, options }: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; options: { label: string; value: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} aria-label={label} className="input" value={value}
        onChange={e => onChange(e.target.value)}>
        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </div>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      <button type="button" role="switch" aria-label={label} aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'right-1' : 'left-1'}`} />
      </button>
    </div>
  );
}

function RadioGroup({ label, name, value, onChange, options }: {
  label: string; name: string; value: string;
  onChange: (v: string) => void; options: { label: string; value: string }[];
}) {
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex flex-wrap gap-3">
        {options.map(opt => (
          <label key={opt.value} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-all ${
            value === opt.value
              ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]'
              : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
          }`}>
            <input type="radio" name={name} aria-label={opt.label} value={opt.value}
              checked={value === opt.value} onChange={() => onChange(opt.value)}
              className="sr-only" />
            <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              value === opt.value ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'
            }`}>
              {value === opt.value && <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />}
            </span>
            <span className="text-sm font-medium">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function AppointmentSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');

  const { values: settings, update, save, loading: isLoading, saving } = useSettingsForm<AppointmentSettingsData>({
    queryKey: ['settings', 'appointments'],
    prefix: 'appointment_',
    defaultValues: {
      appointment_mode: 'serial',
      token_prefix: 'OPD',
      token_reset: 'daily',
      token_print_size: 'a5',
      show_fee_on_token: true,
      auto_next_serial: true,
      manual_call_patient: true,
      skip_patient_allowed: false,
      no_show_mark_allowed: true,
      doctor_can_call_next: true,
      followup_validity_days: 7,
      followup_fee: 0,
      followup_serial_priority: true,
    },
  });

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Appointment Settings</h1>
            <p className="section-subtitle mt-1">Configure serial, token, queue, and follow-up rules</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-32 w-full rounded-xl" />)}
          </div>
        ) : (
          <>
            {/* ── Appointment Mode ── */}
            <Section icon={<Calendar className="w-4 h-4" />} title="Appointment Mode" desc="How patients book appointments">
              <RadioGroup
                label="Mode"
                name="appointment_mode"
                value={settings.appointment_mode}
                onChange={v => update('appointment_mode', v as AppointmentSettingsData['appointment_mode'])}
                options={[
                  { label: 'Serial Based', value: 'serial' },
                  { label: 'Time Slot Based', value: 'time_slot' },
                  { label: 'Both', value: 'both' },
                ]}
              />
            </Section>

            {/* ── Token Settings ── */}
            <Section icon={<Hash className="w-4 h-4" />} title="Token Settings" desc="Token prefix, reset, print format">
              <div className="grid grid-cols-2 gap-4">
                <Field id="token-prefix" label="Token Prefix" value={settings.token_prefix}
                  onChange={v => update('token_prefix', v)} placeholder="OPD" />
                <Select id="token-reset" label="Token Reset" value={settings.token_reset}
                  onChange={v => update('token_reset', v as AppointmentSettingsData['token_reset'])}
                  options={[
                    { label: 'Daily', value: 'daily' },
                    { label: 'Monthly', value: 'monthly' },
                    { label: 'Never', value: 'never' },
                  ]} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select id="token-print-size" label="Print Size" value={settings.token_print_size}
                  onChange={v => update('token_print_size', v as AppointmentSettingsData['token_print_size'])}
                  options={[
                    { label: 'A5', value: 'a5' },
                    { label: 'POS Receipt', value: 'pos' },
                  ]} />
                <div />
              </div>
              <Toggle label="Show Fee on Token" checked={settings.show_fee_on_token}
                onChange={v => update('show_fee_on_token', v)} />
            </Section>

            {/* ── Queue Settings ── */}
            <Section icon={<Users className="w-4 h-4" />} title="Queue Settings" desc="How the OPD queue behaves">
              <Toggle label="Auto Next Serial" checked={settings.auto_next_serial}
                onChange={v => update('auto_next_serial', v)} />
              <Toggle label="Manual Call Patient" checked={settings.manual_call_patient}
                onChange={v => update('manual_call_patient', v)} />
              <Toggle label="Skip Patient Allowed" checked={settings.skip_patient_allowed}
                onChange={v => update('skip_patient_allowed', v)} />
              <Toggle label="No-Show Mark Allowed" checked={settings.no_show_mark_allowed}
                onChange={v => update('no_show_mark_allowed', v)} />
              <Toggle label="Doctor Can Call Next Patient" checked={settings.doctor_can_call_next}
                onChange={v => update('doctor_can_call_next', v)} />
            </Section>

            {/* ── Follow-up Settings ── */}
            <Section icon={<Clock className="w-4 h-4" />} title="Follow-up Settings" desc="Follow-up validity, fee, priority">
              <div className="grid grid-cols-2 gap-4">
                <Field id="followup-validity" label="Follow-up Validity (Days)" type="number"
                  value={settings.followup_validity_days}
                  onChange={v => update('followup_validity_days', Number(v))} />
                <Field id="followup-fee" label="Follow-up Fee" type="number"
                  value={settings.followup_fee}
                  onChange={v => update('followup_fee', Number(v))} />
              </div>
              <Toggle label="Follow-up Serial Priority" checked={settings.followup_serial_priority}
                onChange={v => update('followup_serial_priority', v)} />
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

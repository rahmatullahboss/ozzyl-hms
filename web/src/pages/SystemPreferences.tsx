import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Settings, Hash, Globe } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useSettingsForm } from '../hooks/useSettingsForm';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface PreferencesData {
  language: string;
  date_format: string;
  time_format: string;
  currency: string;
  timezone: string;
  default_page: string;
  items_per_page: number;
  patient_prefix: string;
  invoice_prefix: string;
  lab_sample_prefix: string;
  prescription_prefix: string;
  admission_prefix: string;
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

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function SystemPreferences({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');

  const { values: prefs, update, save, loading: isLoading, saving } = useSettingsForm<PreferencesData>({
    queryKey: ['settings', 'preferences'],
    prefix: 'pref_',
    defaultValues: {
      language: 'en',
      date_format: 'dd-mm-yyyy',
      time_format: '12',
      currency: 'BDT',
      timezone: 'Asia/Dhaka',
      default_page: 'dashboard',
      items_per_page: 20,
      patient_prefix: 'P',
      invoice_prefix: 'INV',
      lab_sample_prefix: 'LAB',
      prescription_prefix: 'RX',
      admission_prefix: 'ADM',
    },
  });

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div>
          <h1 className="page-title">System Preferences</h1>
          <p className="section-subtitle mt-1">Language, date/time format, currency, and number prefixes</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-32 w-full rounded-xl" />)}
          </div>
        ) : (
          <>
            {/* ── General ── */}
            <Section icon={<Globe className="w-4 h-4" />} title="General" desc="Language, format, and regional settings">
              <div className="grid grid-cols-2 gap-4">
                <Select id="language" label="Language" value={prefs.language}
                  onChange={v => update('language', v)}
                  options={[
                    { label: 'English', value: 'en' },
                    { label: 'বাংলা (Bangla)', value: 'bn' },
                  ]} />
                <Select id="date-format" label="Date Format" value={prefs.date_format}
                  onChange={v => update('date_format', v)}
                  options={[
                    { label: 'DD-MM-YYYY', value: 'dd-mm-yyyy' },
                    { label: 'MM-DD-YYYY', value: 'mm-dd-yyyy' },
                    { label: 'YYYY-MM-DD', value: 'yyyy-mm-dd' },
                  ]} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select id="time-format" label="Time Format" value={prefs.time_format}
                  onChange={v => update('time_format', v)}
                  options={[
                    { label: '12 Hour (AM/PM)', value: '12' },
                    { label: '24 Hour', value: '24' },
                  ]} />
                <Select id="currency" label="Currency" value={prefs.currency}
                  onChange={v => update('currency', v)}
                  options={[
                    { label: 'BDT (৳)', value: 'BDT' },
                    { label: 'USD ($)', value: 'USD' },
                    { label: 'EUR (€)', value: 'EUR' },
                    { label: 'GBP (£)', value: 'GBP' },
                    { label: 'INR (₹)', value: 'INR' },
                  ]} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select id="timezone" label="Timezone" value={prefs.timezone}
                  onChange={v => update('timezone', v)}
                  options={[
                    { label: 'Asia/Dhaka (BST)', value: 'Asia/Dhaka' },
                    { label: 'Asia/Kolkata (IST)', value: 'Asia/Kolkata' },
                    { label: 'UTC', value: 'UTC' },
                  ]} />
                <Field id="items-per-page" label="Items Per Page" type="number"
                  value={prefs.items_per_page}
                  onChange={v => update('items_per_page', Number(v))} />
              </div>
            </Section>

            {/* ── Number Prefixes ── */}
            <Section icon={<Hash className="w-4 h-4" />} title="Number Prefixes" desc="Prefixes for auto-generated IDs">
              <div className="grid grid-cols-2 gap-4">
                <Field id="patient-prefix" label="Patient Prefix" value={prefs.patient_prefix}
                  onChange={v => update('patient_prefix', v)} placeholder="P" />
                <Field id="invoice-prefix" label="Invoice Prefix" value={prefs.invoice_prefix}
                  onChange={v => update('invoice_prefix', v)} placeholder="INV" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field id="lab-sample-prefix" label="Lab Sample Prefix" value={prefs.lab_sample_prefix}
                  onChange={v => update('lab_sample_prefix', v)} placeholder="LAB" />
                <Field id="prescription-prefix" label="Prescription Prefix" value={prefs.prescription_prefix}
                  onChange={v => update('prescription_prefix', v)} placeholder="RX" />
              </div>
              <Field id="admission-prefix" label="Admission Prefix" value={prefs.admission_prefix}
                onChange={v => update('admission_prefix', v)} placeholder="ADM" />
            </Section>

            {/* ── Save Button ── */}
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className="btn-primary">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

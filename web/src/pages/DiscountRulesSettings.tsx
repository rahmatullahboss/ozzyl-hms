import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Percent, Wallet, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useSettingsForm } from '../hooks/useSettingsForm';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface DiscountRulesData {
  cashier_can_discount: boolean;
  max_discount_amount: number;
  max_discount_percentage: number;
  discount_reason_mandatory: boolean;
  approval_required_above: number;
  due_allowed_opd: boolean;
  due_allowed_ipd: boolean;
  due_allowed_pharmacy: boolean;
  due_collection_reminder: boolean;
  refund_allowed: boolean;
  refund_approval_required: boolean;
  invoice_cancel_allowed_within_hours: number;
  cancel_reason_mandatory: boolean;
  cancel_approval_required: boolean;
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

function Field({ id, label, type = 'text', value, onChange, hint, min, max, prefix }: {
  id: string; label: string; type?: string; value: string | number;
  onChange: (v: string) => void; hint?: string; min?: number; max?: number; prefix?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)]">{prefix}</span>}
        <input id={id} aria-label={label} type={type} className={`input ${prefix ? 'pl-8' : ''}`} value={value}
          onChange={e => onChange(e.target.value)} min={min} max={max} />
      </div>
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

export default function DiscountRulesSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');

  const { values: settings, update, save, loading: isLoading, saving } = useSettingsForm<DiscountRulesData>({
    queryKey: ['settings', 'discount-rules'],
    prefix: 'discount_',
    defaultValues: {
      cashier_can_discount: true,
      max_discount_amount: 500,
      max_discount_percentage: 10,
      discount_reason_mandatory: true,
      approval_required_above: 1000,
      due_allowed_opd: true,
      due_allowed_ipd: true,
      due_allowed_pharmacy: false,
      due_collection_reminder: true,
      refund_allowed: true,
      refund_approval_required: true,
      invoice_cancel_allowed_within_hours: 24,
      cancel_reason_mandatory: true,
      cancel_approval_required: true,
    },
  });

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div>
          <h1 className="page-title">Discount & Due Rules</h1>
          <p className="section-subtitle mt-1">Configure discount limits, due policies, refund and cancellation rules</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-32 w-full rounded-xl" />)}
          </div>
        ) : (
          <>
            {/* ── Discount Rules ── */}
            <Section icon={<Percent className="w-4 h-4" />} title="Discount Rules" desc="Who can give discounts and how much">
              <Toggle label="Cashier Can Discount" checked={settings.cashier_can_discount}
                onChange={v => update('cashier_can_discount', v)} />
              <div className="grid grid-cols-2 gap-4">
                <Field id="max-discount-amount" label="Max Discount Amount" type="number"
                  value={settings.max_discount_amount}
                  onChange={v => update('max_discount_amount', Number(v))}
                  prefix="৳" min={0} />
                <Field id="max-discount-percentage" label="Max Discount Percentage" type="number"
                  value={settings.max_discount_percentage}
                  onChange={v => update('max_discount_percentage', Number(v))}
                  prefix="%" min={0} max={100} />
              </div>
              <Toggle label="Discount Reason Mandatory" checked={settings.discount_reason_mandatory}
                onChange={v => update('discount_reason_mandatory', v)} />
              <Field id="approval-required-above" label="Approval Required Above" type="number"
                value={settings.approval_required_above}
                onChange={v => update('approval_required_above', Number(v))}
                prefix="৳" min={0} hint="Discounts above this amount need admin approval" />
            </Section>

            {/* ── Due Rules ── */}
            <Section icon={<Wallet className="w-4 h-4" />} title="Due Rules" desc="Which modules allow due payments">
              <Toggle label="Due Allowed for OPD" checked={settings.due_allowed_opd}
                onChange={v => update('due_allowed_opd', v)} />
              <Toggle label="Due Allowed for IPD" checked={settings.due_allowed_ipd}
                onChange={v => update('due_allowed_ipd', v)} />
              <Toggle label="Due Allowed for Pharmacy" checked={settings.due_allowed_pharmacy}
                onChange={v => update('due_allowed_pharmacy', v)} />
              <Toggle label="Due Collection Reminder" checked={settings.due_collection_reminder}
                onChange={v => update('due_collection_reminder', v)}
                hint="Send reminders for outstanding dues" />
            </Section>

            {/* ── Refund & Cancel Rules ── */}
            <Section icon={<XCircle className="w-4 h-4" />} title="Refund & Cancel Rules" desc="Refund and invoice cancellation policies">
              <Toggle label="Refund Allowed" checked={settings.refund_allowed}
                onChange={v => update('refund_allowed', v)} />
              <Toggle label="Refund Approval Required" checked={settings.refund_approval_required}
                onChange={v => update('refund_approval_required', v)} />
              <Field id="cancel-within-hours" label="Invoice Cancel Allowed Within (Hours)" type="number"
                value={settings.invoice_cancel_allowed_within_hours}
                onChange={v => update('invoice_cancel_allowed_within_hours', Number(v))}
                min={1} hint="Invoices can only be cancelled within this window" />
              <Toggle label="Cancel Reason Mandatory" checked={settings.cancel_reason_mandatory}
                onChange={v => update('cancel_reason_mandatory', v)} />
              <Toggle label="Cancel Approval Required" checked={settings.cancel_approval_required}
                onChange={v => update('cancel_approval_required', v)} />
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

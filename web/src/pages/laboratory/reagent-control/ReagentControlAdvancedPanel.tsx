import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Settings2, ShieldAlert, X } from 'lucide-react';
import type { ReagentControlPolicy, ReagentPolicySummary } from './reagentControlModel';

export type ReagentReadinessCheck = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
};

export type ReagentOperationLog = {
  id: number;
  log_type: string;
  quantity: number;
  description?: string | null;
  created_at: string;
  test_name?: string | null;
  consumable_name?: string | null;
};

const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

export default function ReagentControlAdvancedPanel({
  policy,
  policySummary,
  strictReady,
  strictAvailable = false,
  strictUnavailableMessage,
  readinessMessage,
  readinessChecks,
  logs,
  onPolicyChange,
  onApplySafePolicy,
  onEnableStrict,
  onOpenCatalog,
  onSyncLegacyStock,
  syncLegacyStockPending = false,
  labMonitoringHref,
  machineSettingsHref,
  integrationSummary,
  onClose,
}: {
  policy: ReagentControlPolicy;
  policySummary: ReagentPolicySummary;
  strictReady: boolean;
  strictAvailable?: boolean;
  strictUnavailableMessage?: string | null;
  readinessMessage: string | null;
  readinessChecks: ReagentReadinessCheck[];
  logs: ReagentOperationLog[];
  onPolicyChange: (patch: Partial<ReagentControlPolicy>) => void;
  onApplySafePolicy: () => void;
  onEnableStrict: () => void;
  onOpenCatalog?: () => void;
  onSyncLegacyStock?: () => void;
  syncLegacyStockPending?: boolean;
  labMonitoringHref?: string;
  machineSettingsHref?: string;
  integrationSummary?: { title: string; detail: string };
  onClose: () => void;
}) {
  const [policyOpen, setPolicyOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-violet-200 bg-[var(--color-bg-card)] p-5 shadow-sm" aria-label="Advanced reagent settings panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-violet-600" aria-hidden="true" />
            <h2 className="text-xl font-bold text-[var(--color-text)]">Advanced reagent settings</h2>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Policy, readiness and technical logs. Routine recipe work does not require these controls.</p>
        </div>
        <button type="button" aria-label="Close advanced settings" onClick={onClose} className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Current policy</p>
        <p className="mt-1 font-semibold text-[var(--color-text)]">{policySummary.title}</p>
        <div className="mt-3 grid gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-3">
          <p><span className="font-semibold text-[var(--color-text)]">Deduction:</span> {policySummary.timing}</p>
          <p><span className="font-semibold text-[var(--color-text)]">Service:</span> {policySummary.blocking}</p>
          <p><span className="font-semibold text-[var(--color-text)]">Recipes:</span> {policySummary.recipes}</p>
        </div>
      </div>

      {(onOpenCatalog || onSyncLegacyStock || labMonitoringHref || machineSettingsHref) && (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] p-4">
          <p className="text-sm font-semibold text-[var(--color-text)]">Advanced tools</p>
          {integrationSummary && (
            <div className="mt-3 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2">
              <p className="text-sm font-semibold text-[var(--color-text)]">{integrationSummary.title}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{integrationSummary.detail}</p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {onOpenCatalog && (
              <button type="button" onClick={onOpenCatalog} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700">
                Manage reagent catalog
              </button>
            )}
            {onSyncLegacyStock && (
              <button
                type="button"
                onClick={onSyncLegacyStock}
                disabled={syncLegacyStockPending}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncLegacyStockPending ? 'Syncing legacy stock…' : 'Sync legacy stock to Inventory'}
              </button>
            )}
            {labMonitoringHref && <a href={labMonitoringHref} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">Open full lab monitoring</a>}
            {machineSettingsHref && <a href={machineSettingsHref} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">Open machine settings</a>}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-[var(--color-border)]">
        <button
          type="button"
          aria-label="Automation policy controls"
          aria-expanded={policyOpen}
          onClick={() => setPolicyOpen(value => !value)}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-[var(--color-text)]">Automation policy controls</span>
            <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Change when deduction runs and whether unsafe cases can block completion.</span>
          </span>
          {policyOpen ? <ChevronDown className="h-5 w-5" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
        </button>

        {policyOpen && (
          <div className="space-y-4 border-t border-[var(--color-border)] p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-[var(--color-text)]">
                <span>Reagent control mode</span>
                <select
                  aria-label="Reagent control mode"
                  value={policy.lab_inventory_mode}
                  onChange={event => onPolicyChange({ lab_inventory_mode: event.target.value })}
                  className={inputClass}
                >
                  <option value="disabled">Off</option>
                  <option value="soft">Safe rollout</option>
                  <option value="strict" disabled={!strictAvailable}>Strict stock control (transactional billing required)</option>
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-[var(--color-text)]">
                <span>Deduct stock</span>
                <select
                  aria-label="Deduct stock"
                  value={policy.reagent_consumption_timing}
                  onChange={event => onPolicyChange({ reagent_consumption_timing: event.target.value })}
                  className={inputClass}
                >
                  <option value="billing">When billed</option>
                  <option value="result">When result is completed</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] p-3 text-sm">
                <input type="checkbox" checked={policy.allow_result_without_stock} onChange={event => onPolicyChange({ allow_result_without_stock: event.target.checked })} className="mt-0.5" />
                <span><span className="font-semibold text-[var(--color-text)]">Allow results when stock is missing</span><span className="mt-1 block text-xs text-[var(--color-text-muted)]">Recommended during safe rollout.</span></span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] p-3 text-sm">
                <input type="checkbox" checked={policy.require_test_mapping_for_completion} onChange={event => onPolicyChange({ require_test_mapping_for_completion: event.target.checked })} className="mt-0.5" />
                <span><span className="font-semibold text-[var(--color-text)]">Require a recipe for every test</span><span className="mt-1 block text-xs text-[var(--color-text-muted)]">Enable only after recipe coverage is complete.</span></span>
              </label>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" aria-hidden="true" /><p className="text-sm font-semibold">Strict-mode readiness</p></div>
              {!strictAvailable
                ? <p className="mt-1 text-xs">{strictUnavailableMessage || 'Strict mode is unavailable until transactional billing-stock control is implemented.'}</p>
                : readinessMessage
                  ? <p className="mt-1 text-xs">{readinessMessage}</p>
                  : <p className="mt-1 text-xs">All readiness checks are clear.</p>}
              {readinessChecks.length > 0 && (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {readinessChecks.map(check => (
                    <div key={check.id} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 font-semibold">{check.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />}{check.label}</div>
                      <p className="mt-1 opacity-80">{check.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onApplySafePolicy} className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700">Apply safe rollout policy</button>
              <button type="button" disabled={!strictAvailable || !strictReady} title={strictUnavailableMessage || readinessMessage || 'Enable strict stock control'} onClick={onEnableStrict} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50">Enable strict stock control</button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-border)]">
        <button
          type="button"
          aria-label="Operation logs"
          aria-expanded={logsOpen}
          onClick={() => setLogsOpen(value => !value)}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]"><ClipboardList className="h-4 w-4 text-violet-600" aria-hidden="true" />Operation logs</span>
          {logsOpen ? <ChevronDown className="h-5 w-5" aria-hidden="true" /> : <ChevronRight className="h-5 w-5" aria-hidden="true" />}
        </button>
        {logsOpen && (
          <div className="border-t border-[var(--color-border)] p-4">
            {logs.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No operation logs for the selected date.</p> : (
              <div className="space-y-2">
                {logs.map(log => (
                  <div key={log.id} className="rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm">
                    <p className="font-medium text-[var(--color-text)]">{log.description || log.log_type}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{log.test_name || log.consumable_name || log.log_type} · Qty {log.quantity} · {log.created_at}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

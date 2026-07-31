import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Settings2, ShieldCheck } from 'lucide-react';
import type {
  ReagentControlAction,
  ReagentControlSection,
  ReagentPolicySummary,
} from './reagentControlModel';

export type ReagentSetupStep = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  section: ReagentControlSection;
};

export type ReagentAttentionNotice = {
  id: string;
  title: string;
  detail: string;
};

export default function ReagentControlOverview({
  policySummary,
  actions,
  setupSteps,
  attentionNotices = [],
  onSectionChange,
  onOpenAdvanced,
}: {
  policySummary: ReagentPolicySummary;
  actions: ReagentControlAction[];
  setupSteps: ReagentSetupStep[];
  attentionNotices?: ReagentAttentionNotice[];
  onSectionChange: (section: ReagentControlSection) => void;
  onOpenAdvanced: () => void;
}) {
  const completedSteps = setupSteps.filter(step => step.done).length;
  const setupComplete = completedSteps === setupSteps.length;
  const toneClass = policySummary.tone === 'strict'
    ? 'border-red-200 bg-red-50 text-red-900'
    : policySummary.tone === 'off'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-emerald-200 bg-emerald-50 text-emerald-900';

  return (
    <div
      id="reagent-control-panel-overview"
      role="tabpanel"
      aria-labelledby="reagent-control-tab-overview"
      className="space-y-5"
    >
      <section className={`rounded-2xl border p-5 ${toneClass}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              Current reagent policy
            </div>
            <h2 className="mt-2 text-xl font-bold">{policySummary.title}</h2>
            <p className="mt-1 text-sm opacity-85">{policySummary.description}</p>
          </div>
          <button
            type="button"
            onClick={onOpenAdvanced}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-current/20 bg-white/70 px-3 py-2 text-sm font-semibold hover:bg-white"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Advanced settings
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Stock deduction</p>
            <p className="mt-1 text-sm font-semibold">{policySummary.timing}</p>
          </div>
          <div className="rounded-xl bg-white/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Service flow</p>
            <p className="mt-1 text-sm font-semibold">{policySummary.blocking}</p>
          </div>
          <div className="rounded-xl bg-white/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Test recipes</p>
            <p className="mt-1 text-sm font-semibold">{policySummary.recipes}</p>
          </div>
        </div>
      </section>

      {attentionNotices.length > 0 && (
        <section className="space-y-2" aria-label="Reagent control notices">
          {attentionNotices.map(notice => (
            <div key={notice.id} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">{notice.title}</p>
                <p className="mt-0.5 text-xs opacity-80">{notice.detail}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">What needs attention</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--color-text)]">Your next reagent-control tasks</h2>
        </div>
        {actions.length === 0 ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              Reagent control is running normally
            </div>
            <p className="mt-1 text-sm">No action is required right now.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {actions.slice(0, 3).map(action => (
              <button
                key={action.id}
                type="button"
                data-testid="reagent-next-action"
                aria-label={action.label}
                onClick={() => onSectionChange(action.section)}
                className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-left transition hover:border-violet-300 hover:shadow-sm"
              >
                <span className="flex items-center justify-between gap-3 text-sm font-semibold text-[var(--color-text)]">
                  {action.label}
                  <ChevronRight className="h-4 w-4 text-violet-500 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{action.description}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {!setupComplete && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Guided setup</p>
              <h2 className="mt-1 text-lg font-bold text-[var(--color-text)]">Finish reagent-control setup</h2>
            </div>
            <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold text-violet-700">
              {completedSteps} of {setupSteps.length} setup steps complete
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {setupSteps.map(step => (
              <button
                key={step.id}
                type="button"
                aria-label={step.label}
                onClick={() => onSectionChange(step.section)}
                className="rounded-xl border border-white/80 bg-white p-4 text-left shadow-sm transition hover:border-violet-300"
              >
                <span className="flex items-start gap-3">
                  {step.done
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                    : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />}
                  <span>
                    <span className="block text-sm font-semibold text-[var(--color-text)]">{step.label}</span>
                    <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{step.detail}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

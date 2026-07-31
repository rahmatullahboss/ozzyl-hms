import { Activity } from 'lucide-react';
import AuditFeedWidget from '../../widgets/AuditFeedWidget';

export default function AuditWorkspace() {
  return (
    <section data-testid="workspace-audit" className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Activity className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 data-command-center-workspace-heading tabIndex={-1} className="text-xl font-semibold text-[var(--color-text-primary)]">Audit</h2>
              <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">Live/current state</span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Latest staff activity is live/current state. Financial reconciliation status and invoice audit evidence remain available through their dedicated workspaces and the shared invoice inspector.
            </p>
          </div>
        </div>
      </div>
      <AuditFeedWidget />
    </section>
  );
}

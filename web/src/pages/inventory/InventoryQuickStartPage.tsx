import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ClipboardList, RefreshCw, Settings2 } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

type ReadinessMode = 'simple' | 'standard' | 'enterprise';
type ChecklistStatus = 'done' | 'warning' | 'missing' | 'action_required';

type ChecklistItem = {
  id: string;
  title: string;
  description: string;
  status: ChecklistStatus;
  priority: 'P0' | 'P1' | 'P2';
  action: string;
  href?: string;
  metric?: number | string;
};

type QuickStartReadiness = {
  mode: ReadinessMode;
  readinessScore: number;
  smallHospitalReady: boolean;
  enterpriseReady: boolean;
  strictModeReady: boolean;
  metrics: Record<string, number | boolean | string>;
  setupChecklist: ChecklistItem[];
  labChecklist: ChecklistItem[];
  dailyActions: ChecklistItem[];
  blockingIssues: ChecklistItem[];
  warnings: ChecklistItem[];
  recommendedNextActions: Pick<ChecklistItem, 'id' | 'title' | 'action' | 'href' | 'priority'>[];
  guidance: Record<ReadinessMode, string>;
};

type ProcessGuide = {
  mode: ReadinessMode;
  position: { smallHospital: string; enterprise: string };
  simpleHospitalProcess: string[];
  roleGuide: Array<{
    role: string;
    mode: ReadinessMode;
    responsibility: string;
    dailyTasks: string[];
    allowedActions: string[];
    avoid: string[];
  }>;
  remainingWork: Array<{ priority: string; item: string }>;
};

export function buildQuickStartReadinessPath(mode: ReadinessMode): string {
  return `/api/inventory/quick-start/readiness?mode=${mode}`;
}

export function buildDefaultStoresPath(): string {
  return '/api/inventory/quick-start/default-stores';
}

export function buildDefaultLabItemsPath(): string {
  return '/api/inventory/quick-start/default-lab-items';
}

export function buildProcessGuidePath(mode: ReadinessMode): string {
  return `/api/inventory/quick-start/process-guide?mode=${mode}`;
}

export function statusTone(status: ChecklistStatus): string {
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-red-200 bg-red-50 text-red-800';
}

export function readinessLabel(score: number): string {
  if (score >= 85) return 'Enterprise ready foundation';
  if (score >= 70) return 'Ready for small hospital use';
  if (score >= 45) return 'Setup needs attention';
  return 'Setup not ready';
}

export function readinessLabelKey(score: number): string {
  if (score >= 85) return 'quickStart.readinessLabels.enterpriseReady';
  if (score >= 70) return 'quickStart.readinessLabels.smallHospitalReady';
  if (score >= 45) return 'quickStart.readinessLabels.needsAttention';
  return 'quickStart.readinessLabels.notReady';
}

function statusIcon(status: ChecklistStatus) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4" />;
  return <AlertTriangle className="w-4 h-4" />;
}

function ChecklistSection({ title, subtitle, items }: { title: string; subtitle: string; items: ChecklistItem[] }) {
  const { t } = useTranslation(['inventory', 'common']);
  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className={`rounded-xl border p-4 ${statusTone(item.status)}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <span className="mt-0.5">{statusIcon(item.status)}</span>
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-sm mt-1 opacity-90">{item.description}</p>
                  <p className="text-xs font-medium mt-2">{t('quickStart.actionPrefix')}: {item.action}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="badge badge-secondary">{item.priority}</span>
                {item.metric !== undefined && <p className="font-data text-xs mt-2">{String(item.metric)}</p>}
              </div>
            </div>
            {item.href && <a className="inline-flex text-xs underline mt-3" href={item.href}>{t('quickStart.openRelatedPage')}</a>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InventoryQuickStartPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const [mode, setMode] = useState<ReadinessMode>('simple');
  const path = useMemo(() => buildQuickStartReadinessPath(mode), [mode]);
  const processPath = useMemo(() => buildProcessGuidePath(mode), [mode]);
  const { data, isLoading, refetch, isFetching } = useApiQuery<QuickStartReadiness>(['inventory', 'quick-start', mode], path);
  const { data: processGuide } = useApiQuery<ProcessGuide>(['inventory', 'quick-start-process', mode], processPath);
  const defaultStores = useApiMutation('post', buildDefaultStoresPath(), {
    onSuccess: () => refetch(),
  });
  const defaultLabItems = useApiMutation('post', buildDefaultLabItemsPath(), {
    onSuccess: () => refetch(),
  });

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('quickStart.title')}</h1>
            <p className="section-subtitle mt-1">{t('quickStart.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="input w-44" value={mode} onChange={event => setMode(event.target.value as ReadinessMode)}>
              <option value="simple">{t('quickStart.modes.simple')}</option>
              <option value="standard">{t('quickStart.modes.standard')}</option>
              <option value="enterprise">{t('quickStart.modes.enterprise')}</option>
            </select>
            <button
              className="btn-primary"
              onClick={() => defaultStores.mutate(undefined)}
              disabled={defaultStores.isPending}
            >
              <Settings2 className="w-4 h-4" /> {t('quickStart.createDefaultStores')}
            </button>
            <button
              className="btn-secondary"
              onClick={() => defaultLabItems.mutate(undefined)}
              disabled={defaultLabItems.isPending}
            >
              <ClipboardList className="w-4 h-4" /> {t('quickStart.createLabItemMaster')}
            </button>
            <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className="w-4 h-4" /> {t('refresh')}
            </button>
          </div>
        </div>

        {isLoading && !data ? (
          <div className="card p-10"><div className="skeleton h-8 w-72 rounded" /></div>
        ) : !data ? (
          <div className="card p-10">
            <EmptyState icon={<ClipboardList className="w-8 h-8" />} title={t('quickStart.readinessUnavailable')} description={t('quickStart.readinessUnavailableDesc')} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="card p-5 md:col-span-2">
                <p className="text-sm text-[var(--color-text-muted)]">{t('quickStart.readinessScore')}</p>
                <div className="flex items-end gap-3 mt-2">
                  <span className="text-5xl font-bold font-data">{data.readinessScore}</span>
                  <span className="text-lg font-semibold pb-1">/100</span>
                </div>
                <p className="mt-3 font-medium">{t(readinessLabelKey(data.readinessScore))}</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{data.guidance[mode]}</p>
              </div>
              <div className="card p-5">
                <p className="text-sm text-[var(--color-text-muted)]">{t('quickStart.smallHospitalReady')}</p>
                <p className="text-2xl font-bold mt-2">{data.smallHospitalReady ? t('yes') : t('quickStart.notYet')}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('quickStart.smallHospitalReadyDesc')}</p>
              </div>
              <div className="card p-5">
                <p className="text-sm text-[var(--color-text-muted)]">{t('quickStart.strictReagentReady')}</p>
                <p className="text-2xl font-bold mt-2">{data.strictModeReady ? t('yes') : t('no')}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('quickStart.strictReagentReadyDesc')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card p-5">
                <p className="text-sm text-[var(--color-text-muted)]">{t('quickStart.blockingIssues')}</p>
                <p className="text-3xl font-bold mt-2">{data.blockingIssues.length}</p>
              </div>
              <div className="card p-5">
                <p className="text-sm text-[var(--color-text-muted)]">{t('quickStart.warnings')}</p>
                <p className="text-3xl font-bold mt-2">{data.warnings.length}</p>
              </div>
              <div className="card p-5">
                <p className="text-sm text-[var(--color-text-muted)]">{t('quickStart.todaysTopAction')}</p>
                <p className="font-semibold mt-2">{data.recommendedNextActions[0]?.action ?? t('quickStart.noUrgentAction')}</p>
              </div>
            </div>

            {data.recommendedNextActions.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Settings2 className="w-5 h-5" />
                  <h2 className="text-lg font-semibold">{t('quickStart.recommendedNextActions')}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {data.recommendedNextActions.map(action => (
                    <a key={action.id} href={action.href || '#'} className="border border-[var(--color-border)] rounded-xl p-4 hover:bg-[var(--color-surface-muted)]">
                      <span className="badge badge-secondary">{action.priority}</span>
                      <p className="font-semibold mt-2">{action.title}</p>
                      <p className="text-sm text-[var(--color-text-muted)] mt-1">{action.action}</p>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {processGuide && (
              <div className="card p-5 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">{t('quickStart.whoDoesWhat')}</h2>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">{mode === 'enterprise' ? processGuide.position.enterprise : processGuide.position.smallHospital}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {processGuide.roleGuide.map(roleItem => (
                    <div key={roleItem.role} className="rounded-xl border border-[var(--color-border)] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">{roleItem.role}</p>
                        <span className="badge badge-secondary">{roleItem.mode}</span>
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)] mt-2">{roleItem.responsibility}</p>
                      <p className="text-xs font-semibold mt-3">{t('quickStart.dailyWork')}</p>
                      <ul className="text-xs text-[var(--color-text-muted)] mt-1 space-y-1 list-disc pl-4">
                        {roleItem.dailyTasks.slice(0, 3).map(task => <li key={task}>{task}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <ChecklistSection title={t('quickStart.simpleSetupChecklist')} subtitle={t('quickStart.simpleSetupChecklistDesc')} items={data.setupChecklist} />
              <ChecklistSection title={t('quickStart.labReagentReadiness')} subtitle={t('quickStart.labReagentReadinessDesc')} items={data.labChecklist} />
              <ChecklistSection title={t('quickStart.todaysInventoryActions')} subtitle={t('quickStart.todaysInventoryActionsDesc')} items={data.dailyActions} />
              <div className="card p-5 space-y-3">
                <h2 className="text-lg font-semibold">{t('quickStart.keyMetrics')}</h2>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {Object.entries(data.metrics).slice(0, 12).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-[var(--color-border)] p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">{key.replace(/([A-Z])/g, ' $1')}</p>
                      <p className="font-data font-semibold mt-1">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

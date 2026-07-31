import { useEffect, useMemo, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import {
  EXECUTIVE_DASHBOARD_SECTIONS,
  type ExecutiveDashboardKpiConfigItem,
  type ExecutiveDashboardKpiConfigResponse,
  type ExecutiveDashboardSection,
} from '../../hooks/useExecutiveDashboardKpis';
import {
  DASHBOARD_DIALOG_OVERLAY_CLASS,
  DashboardDialogPortal,
  useDashboardDialogLayer,
} from './DashboardDialogLayer';

interface Props {
  items: ExecutiveDashboardKpiConfigItem[];
  queryKeyScope: string;
}

interface SavePayload {
  items: Array<{
    metricKey: ExecutiveDashboardKpiConfigItem['metricKey'];
    enabled: boolean;
    position: number;
    labelOverride: string | null;
  }>;
}

const EDITOR_ROLES = new Set(['hospital_admin', 'md', 'director']);

export default function DashboardKpiConfigurator({ items, queryKeyScope }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ExecutiveDashboardKpiConfigItem[]>(items);
  const closeConfigurator = () => setOpen(false);
  const { dialogRef, initialFocusRef } = useDashboardDialogLayer({ open, onClose: closeConfigurator });

  useEffect(() => {
    if (!open) setDraft(items);
  }, [items, open]);

  const canEdit = EDITOR_ROLES.has(String(user?.role ?? '').toLowerCase());
  const sortedDraft = useMemo(
    () => [...draft].sort((a, b) => a.position - b.position || a.metricKey.localeCompare(b.metricKey)),
    [draft],
  );
  const sectionDrafts = useMemo(
    () => EXECUTIVE_DASHBOARD_SECTIONS.map((section) => ({
      ...section,
      items: sortedDraft.filter((item) => item.section === section.key),
    })),
    [sortedDraft],
  );

  const saveMutation = useApiMutation<ExecutiveDashboardKpiConfigResponse, SavePayload>(
    'put',
    '/api/dashboard/kpi-config',
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: [queryKeyScope, 'executive-kpis', 'config'] });
        setOpen(false);
      },
    },
  );

  if (!canEdit) return null;

  const updateItem = (
    metricKey: ExecutiveDashboardKpiConfigItem['metricKey'],
    patch: Partial<Pick<ExecutiveDashboardKpiConfigItem, 'enabled' | 'position' | 'labelOverride'>>,
  ) => {
    setDraft((current) => current.map((item) => {
      if (item.metricKey !== metricKey) return item;
      const next = { ...item, ...patch };
      return {
        ...next,
        label: next.labelOverride?.trim() || items.find((source) => source.metricKey === metricKey)?.label || item.label,
      };
    }));
  };

  const updateSection = (section: ExecutiveDashboardSection, enabled: boolean) => {
    setDraft((current) => current.map((item) => (
      item.section === section ? { ...item, enabled } : item
    )));
  };

  const save = () => {
    saveMutation.mutate({
      items: sortedDraft.map((item, index) => ({
        metricKey: item.metricKey,
        enabled: item.enabled,
        position: Number.isFinite(item.position) ? Math.max(0, Math.min(100, Math.trunc(item.position))) : index,
        labelOverride: item.labelOverride?.trim() || null,
      })),
    });
  };

  return (
    <>
      <button
        type="button"
        className="btn-secondary text-xs"
        onClick={() => { setDraft(items); setOpen(true); }}
        aria-label="Customize dashboard KPI cards"
      >
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        Customize dashboard
      </button>

      {open ? (
        <DashboardDialogPortal>
          <div className={`fixed inset-0 ${DASHBOARD_DIALOG_OVERLAY_CLASS} flex items-center justify-center bg-black/40 p-4`} role="presentation">
            <section ref={dialogRef} tabIndex={-1} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-[var(--color-bg-card)] p-5 shadow-xl" role="dialog" aria-modal="true" aria-label="Customize dashboard KPI cards">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Customize dashboard</h2>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Turn complete monitoring sections or individual cards and panels on and off, rename them, and set their order. Calculations remain server-controlled.</p>
              </div>
              <button ref={initialFocusRef} type="button" className="btn-icon" onClick={closeConfigurator} aria-label="Close dashboard customization">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {sectionDrafts.map((section) => {
                const enabledCount = section.items.filter((item) => item.enabled).length;
                const allEnabled = section.items.length > 0 && enabledCount === section.items.length;
                return (
                  <section key={section.key} className="rounded-2xl border border-[var(--color-border)] p-4" aria-labelledby={`dashboard-section-${section.key}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-3">
                      <div>
                        <h3 id={`dashboard-section-${section.key}`} className="font-semibold text-[var(--color-text-primary)]">{section.title}</h3>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{section.description}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                        <input
                          type="checkbox"
                          checked={allEnabled}
                          onChange={(event) => updateSection(section.key, event.target.checked)}
                          aria-label={`Enable ${section.title} section`}
                        />
                        {enabledCount}/{section.items.length} enabled
                      </label>
                    </div>

                    <div className="mt-3 space-y-3">
                      {section.items.map((item) => (
                        <div key={item.metricKey} className="grid gap-3 rounded-xl bg-[var(--color-bg-subtle)] p-3 sm:grid-cols-[auto_1fr_7rem] sm:items-end">
                          <label className="flex items-center gap-2 pb-2 text-sm font-medium text-[var(--color-text-primary)]">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={(event) => updateItem(item.metricKey, { enabled: event.target.checked })}
                              aria-label={`Show ${item.metricKey}`}
                            />
                            Show
                            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                              {item.kind === 'panel' ? 'Panel' : 'Card'}
                            </span>
                          </label>
                          <label className="text-xs font-medium text-[var(--color-text-muted)]">
                            Label
                            <input
                              className="input mt-1"
                              value={item.labelOverride ?? ''}
                              placeholder={item.label}
                              maxLength={60}
                              onChange={(event) => updateItem(item.metricKey, { labelOverride: event.target.value })}
                              aria-label={`Label for ${item.metricKey}`}
                            />
                          </label>
                          <label className="text-xs font-medium text-[var(--color-text-muted)]">
                            Order
                            <input
                              className="input mt-1"
                              type="number"
                              min={0}
                              max={100}
                              value={item.position}
                              onChange={(event) => updateItem(item.metricKey, { position: Number(event.target.value) })}
                              aria-label={`Order for ${item.metricKey}`}
                            />
                          </label>
                          <p className="text-xs text-[var(--color-text-muted)] sm:col-start-2 sm:col-span-2">{item.metricKey}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            {saveMutation.isError ? (
              <p className="mt-4 text-sm text-red-600" role="alert">Could not save dashboard settings. Please try again.</p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={closeConfigurator}>Cancel</button>
              <button type="button" className="btn-primary" onClick={save} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save dashboard'}
              </button>
            </div>
            </section>
          </div>
        </DashboardDialogPortal>
      ) : null}
    </>
  );
}

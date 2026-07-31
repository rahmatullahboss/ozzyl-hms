# Nursing Module UI/UX Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Nurse Station into a tablet-first, zero-learning-curve visual ward dashboard with color-coded bed grid, slide-drawer patient context, auto-save magic, and shift handover — matching the user's UI/UX blueprint.

**Architecture:** Replace the current list-based NurseStation with a visual bed grid map. Add a slide-over drawer component for patient context with 4 tabs (Vitals, MAR, Orders, Services). All backend APIs already exist — this is purely a frontend UI/UX overhaul. New components go in `web/src/components/nursing/`. The existing `NurseStation.tsx` gets replaced, and `NursingDashboard.tsx` remains as the full-featured module.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Hono (backend unchanged), D1 (database unchanged), React Query, lucide-react icons, react-i18next

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/components/nursing/WardBedGrid.tsx` | Create | Visual bed grid map with color-coded cards |
| `web/src/components/nursing/PatientDrawer.tsx` | Create | Slide-over drawer with 4 tabs (Vitals, MAR, Orders, Services) |
| `web/src/components/nursing/DrawerVitalsTab.tsx` | Create | Vitals tab with auto-save, trend graph |
| `web/src/components/nursing/DrawerMARTab.tsx` | Create | MAR tab with checkbox tap administration |
| `web/src/components/nursing/DrawerOrdersTab.tsx` | Create | Doctor's orders read-only view |
| `web/src/components/nursing/DrawerServicesTab.tsx` | Create | Service charges + pharmacy order actions |
| `web/src/components/nursing/ShiftHandoverModal.tsx` | Create | Auto-summary handover modal on logout |
| `web/src/pages/NurseStation.tsx` | Replace | New visual ward dashboard (replaces current 772-line file) |
| `web/src/hooks/useAutoSave.ts` | Create | Debounced auto-save hook for onBlur save |
| `web/public/locales/en/nursing.json` | Modify | Add new translation keys |
| `web/public/locales/bn/nursing.json` | Modify | Add Bengali translations |
| `src/routes/tenant/nursing/wards.ts` | Modify | Add endpoint for bed grid with patient + vitals + alerts data |
| `src/routes/tenant/nurseStation.ts` | Modify | Add medication-due count per patient for bed cards |

---

## Task 1: Backend — Enhanced Ward Bed Grid API

**Files:**
- Modify: `src/routes/tenant/nursing/wards.ts`
- Modify: `src/routes/tenant/nurseStation.ts`

The existing `/api/nursing/wards` endpoint returns ward-level aggregates. We need a new endpoint that returns **bed-level data with patient info, latest vitals, medication due count, and alert status** — all in one call for the visual grid.

- [ ] **Step 1: Add `/api/nursing/wards/bed-grid` endpoint**

In `src/routes/tenant/nursing/wards.ts`, add after the existing `GET /` route:

```typescript
// GET /wards/bed-grid — all beds with patient, vitals, med-due, alert status for visual grid
wardsRoutes.get('/bed-grid', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  // Get all beds with occupied patient info
  const { results: beds } = await db.$client.prepare(`
    SELECT
      b.id AS bed_id,
      b.ward_name,
      b.bed_number,
      b.bed_type,
      b.status AS bed_status,
      b.floor,
      b.rate_per_day,
      a.id AS admission_id,
      a.status AS admission_status,
      a.provisional_diagnosis,
      p.id AS patient_id,
      p.name AS patient_name,
      p.patient_code,
      p.blood_group,
      d.name AS doctor_name
    FROM beds b
    LEFT JOIN admissions a ON a.bed_id = b.id AND a.tenant_id = b.tenant_id AND a.status IN ('admitted', 'critical')
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id
    WHERE b.tenant_id = ?
    ORDER BY b.ward_name, b.bed_number
  `).bind(tenantId).all();

  // For occupied beds, batch-fetch latest vitals + active alert count + med due count
  const occupiedBeds = (beds as Record<string, unknown>[]).filter(b => b.patient_id);
  const batchStatements: ReturnType<typeof db.$client.prepare>[] = [];

  for (const bed of occupiedBeds) {
    // Latest vitals
    batchStatements.push(
      db.$client.prepare(`
        SELECT systolic, diastolic, temperature, heart_rate, spo2, respiratory_rate, recorded_at
        FROM patient_vitals WHERE tenant_id = ? AND patient_id = ?
        ORDER BY recorded_at DESC LIMIT 1
      `).bind(tenantId, bed.patient_id)
    );
    // Active alerts count
    batchStatements.push(
      db.$client.prepare(`
        SELECT COUNT(*) AS cnt FROM vital_alerts
        WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
      `).bind(tenantId, bed.patient_id)
    );
    // Medication due count (from MAR schedules)
    batchStatements.push(
      db.$client.prepare(`
        SELECT COUNT(*) AS cnt FROM mar_schedules
        WHERE tenant_id = ? AND patient_id = ? AND status = 'pending'
          AND scheduled_time <= datetime('now', '+6 hours')
      `).bind(tenantId, bed.patient_id)
    );
  }

  let batchResults: { results: Record<string, unknown>[] }[] = [];
  if (batchStatements.length > 0) {
    batchResults = await db.$client.batch(batchStatements);
  }

  // Merge data
  const enrichedBeds = (beds as Record<string, unknown>[]).map(bed => {
    if (!bed.patient_id) {
      return { ...bed, latestVitals: null, activeAlerts: 0, medDueCount: 0, statusColor: 'empty' };
    }
    const idx = occupiedBeds.indexOf(bed);
    const vitals = batchResults[idx * 3]?.results[0] ?? null;
    const alerts = (batchResults[idx * 3 + 1]?.results[0] as { cnt: number })?.cnt ?? 0;
    const medDue = (batchResults[idx * 3 + 2]?.results[0] as { cnt: number })?.cnt ?? 0;

    // Determine status color
    let statusColor = 'stable'; // blue
    if (alerts > 0 || bed.admission_status === 'critical') statusColor = 'critical'; // red
    else if (medDue > 0) statusColor = 'medication-due'; // yellow

    return { ...bed, latestVitals: vitals, activeAlerts: alerts, medDueCount: medDue, statusColor };
  });

  return c.json({ beds: enrichedBeds });
});
```

- [ ] **Step 2: Verify the endpoint works**

Run: `curl http://localhost:8787/api/nursing/wards/bed-grid -H "Authorization: Bearer test"`
Expected: JSON with `beds` array, each bed having `statusColor`, `latestVitals`, `activeAlerts`, `medDueCount`

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/nursing/wards.ts
git commit -m "feat(nursing): add bed-grid API endpoint for visual ward map"
```

---

## Task 2: Auto-Save Hook

**Files:**
- Create: `web/src/hooks/useAutoSave.ts`

- [ ] **Step 1: Create the useAutoSave hook**

```typescript
import { useRef, useCallback, useEffect } from 'react';
import { useApiMutation, useQueryClient } from './useApiQuery';

interface UseAutoSaveOptions {
  endpoint: string;
  method?: 'post' | 'put';
  invalidateKeys?: unknown[][];
  debounceMs?: number;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export function useAutoSave({
  endpoint,
  method = 'post',
  invalidateKeys = [],
  debounceMs = 1500,
  onSuccess,
  onError,
}: UseAutoSaveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<Record<string, unknown> | null>(null);
  const queryClient = useQueryClient();

  const mutation = useApiMutation<unknown, Record<string, unknown>>(
    method,
    endpoint,
    {
      onSuccess: () => {
        for (const key of invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        onSuccess?.();
      },
      onError: (err) => {
        onError?.(err);
      },
    },
  );

  const save = useCallback((data: Record<string, unknown>) => {
    pendingDataRef.current = data;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (pendingDataRef.current) {
        mutation.mutate(pendingDataRef.current);
        pendingDataRef.current = null;
      }
    }, debounceMs);
  }, [mutation, debounceMs]);

  const saveImmediate = useCallback((data: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingDataRef.current = null;
    mutation.mutate(data);
  }, [mutation]);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingDataRef.current) {
      mutation.mutate(pendingDataRef.current);
      pendingDataRef.current = null;
    }
  }, [mutation]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    save,
    saveImmediate,
    flush,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/hooks/useAutoSave.ts
git commit -m "feat(hooks): add useAutoSave hook for debounced auto-save on blur"
```

---

## Task 3: Ward Bed Grid Component

**Files:**
- Create: `web/src/components/nursing/WardBedGrid.tsx`

This is the core visual component — color-coded bed cards in a responsive grid.

- [ ] **Step 1: Create WardBedGrid component**

```typescript
import { useState, useMemo } from 'react';
import { Users, Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface BedGridItem {
  bed_id: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  bed_status: string;
  floor?: string;
  rate_per_day?: number;
  admission_id?: number;
  admission_status?: string;
  provisional_diagnosis?: string;
  patient_id?: number;
  patient_name?: string;
  patient_code?: string;
  blood_group?: string;
  doctor_name?: string;
  latestVitals?: {
    systolic?: number;
    diastolic?: number;
    temperature?: number;
    heart_rate?: number;
    spo2?: number;
    recorded_at?: string;
  } | null;
  activeAlerts?: number;
  medDueCount?: number;
  statusColor?: 'empty' | 'stable' | 'medication-due' | 'critical';
}

interface WardBedGridProps {
  beds: BedGridItem[];
  onBedClick: (bed: BedGridItem) => void;
  filterMyPatients?: boolean;
  myPatientIds?: Set<number>;
}

const STATUS_STYLES: Record<string, { bg: string; border: string; badge: string; label: string }> = {
  empty:          { bg: 'bg-gray-50 dark:bg-gray-900/40',    border: 'border-gray-300 dark:border-gray-700', badge: 'bg-gray-200 text-gray-600', label: 'Empty' },
  stable:         { bg: 'bg-blue-50 dark:bg-blue-900/30',    border: 'border-blue-400 dark:border-blue-600', badge: 'bg-blue-100 text-blue-700', label: 'Stable' },
  'medication-due': { bg: 'bg-amber-50 dark:bg-amber-900/30', border: 'border-amber-400 dark:border-amber-600', badge: 'bg-amber-100 text-amber-700', label: 'Med Due' },
  critical:       { bg: 'bg-red-50 dark:bg-red-900/30',      border: 'border-red-400 dark:border-red-600',   badge: 'bg-red-100 text-red-700',   label: 'Critical' },
};

export default function WardBedGrid({ beds, onBedClick, filterMyPatients, myPatientIds }: WardBedGridProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const [wardFilter, setWardFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const wards = useMemo(() => {
    const set = new Set(beds.map(b => b.ward_name));
    return Array.from(set).sort();
  }, [beds]);

  const filteredBeds = useMemo(() => {
    let result = beds;
    if (wardFilter !== 'all') result = result.filter(b => b.ward_name === wardFilter);
    if (statusFilter !== 'all') result = result.filter(b => (b.statusColor ?? 'empty') === statusFilter);
    if (filterMyPatients && myPatientIds) result = result.filter(b => !b.patient_id || myPatientIds.has(b.patient_id));
    return result;
  }, [beds, wardFilter, statusFilter, filterMyPatients, myPatientIds]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          <select
            value={wardFilter}
            onChange={e => setWardFilter(e.target.value)}
            className="input input-sm max-w-48"
          >
            <option value="all">{t('allWards', { defaultValue: 'All Wards' })}</option>
            {wards.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5">
          {(['all', 'stable', 'medication-due', 'critical', 'empty'] as const).map(status => {
            const style = status === 'all' ? null : STATUS_STYLES[status];
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === status
                    ? 'bg-[var(--color-primary)] text-white'
                    : style?.badge ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {status === 'all' ? t('common:all') : style?.label ?? status}
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {filteredBeds.length} {t('beds', { defaultValue: 'beds' })}
        </span>
      </div>

      {/* Bed Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
        {filteredBeds.map(bed => {
          const status = bed.statusColor ?? 'empty';
          const style = STATUS_STYLES[status];
          const isOccupied = !!bed.patient_id;

          return (
            <button
              key={bed.bed_id}
              onClick={() => onBedClick(bed)}
              className={`relative rounded-xl border-2 p-3 text-left transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] min-h-[120px] ${style.bg} ${style.border} ${
                isOccupied ? 'cursor-pointer' : 'cursor-default opacity-60'
              }`}
            >
              {/* Bed number badge */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--color-text)]">
                  {bed.ward_name} — {bed.bed_number}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${style.badge}`}>
                  {style.label}
                </span>
              </div>

              {isOccupied ? (
                <>
                  {/* Patient info */}
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">
                    {bed.patient_name}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                    {bed.patient_code} {bed.blood_group ? `· ${bed.blood_group}` : ''}
                  </p>

                  {/* Vitals mini summary */}
                  {bed.latestVitals && (
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {bed.latestVitals.systolic && (
                        <span>{bed.latestVitals.systolic}/{bed.latestVitals.diastolic}</span>
                      )}
                      {bed.latestVitals.heart_rate && <span>HR {bed.latestVitals.heart_rate}</span>}
                      {bed.latestVitals.spo2 && <span>SpO₂ {bed.latestVitals.spo2}%</span>}
                    </div>
                  )}

                  {/* Alert + Med Due badges */}
                  <div className="mt-1.5 flex gap-1">
                    {(bed.activeAlerts ?? 0) > 0 && (
                      <span className="text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                        {bed.activeAlerts} {t('alerts', { defaultValue: 'alerts' })}
                      </span>
                    )}
                    {(bed.medDueCount ?? 0) > 0 && (
                      <span className="text-[10px] bg-amber-500 text-white rounded-full px-1.5 py-0.5 font-bold">
                        {bed.medDueCount} {t('medDue', { defaultValue: 'med due' })}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs text-[var(--color-text-muted)]">{t('empty', { defaultValue: 'Empty' })}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {filteredBeds.length === 0 && (
        <div className="text-center py-12 text-[var(--color-text-muted)]">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>{t('noBedsFound', { defaultValue: 'No beds found matching filters' })}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/WardBedGrid.tsx
git commit -m "feat(nursing): add WardBedGrid visual component with color-coded bed cards"
```

---

## Task 4: Patient Drawer Component (Shell)

**Files:**
- Create: `web/src/components/nursing/PatientDrawer.tsx`

The slide-over drawer that opens when a bed card is clicked. Contains 4 tabs.

- [ ] **Step 1: Create PatientDrawer shell**

```typescript
import { useState, useEffect } from 'react';
import { X, HeartPulse, Pill, ClipboardList, Receipt, MoreVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BedGridItem } from './WardBedGrid';
import DrawerVitalsTab from './DrawerVitalsTab';
import DrawerMARTab from './DrawerMARTab';
import DrawerOrdersTab from './DrawerOrdersTab';
import DrawerServicesTab from './DrawerServicesTab';

interface PatientDrawerProps {
  bed: BedGridItem | null;
  onClose: () => void;
}

type DrawerTab = 'vitals' | 'mar' | 'orders' | 'services';

const DRAWER_TABS: { key: DrawerTab; icon: React.ReactNode; labelKey: string }[] = [
  { key: 'vitals',   icon: <HeartPulse className="w-4 h-4" />, labelKey: 'drawer.tabs.vitals' },
  { key: 'mar',      icon: <Pill className="w-4 h-4" />,       labelKey: 'drawer.tabs.mar' },
  { key: 'orders',   icon: <ClipboardList className="w-4 h-4" />, labelKey: 'drawer.tabs.orders' },
  { key: 'services', icon: <Receipt className="w-4 h-4" />,    labelKey: 'drawer.tabs.services' },
];

export default function PatientDrawer({ bed, onClose }: PatientDrawerProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const [activeTab, setActiveTab] = useState<DrawerTab>('vitals');
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Reset tab when bed changes
  useEffect(() => {
    setActiveTab('vitals');
    setShowMoreMenu(false);
  }, [bed?.bed_id]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (bed) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [bed, onClose]);

  if (!bed || !bed.patient_id) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-[var(--color-bg)] shadow-2xl z-50 flex flex-col transition-transform">
        {/* Sticky Patient Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
              {bed.patient_name?.charAt(0) ?? '?'}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-[var(--color-text)] truncate">{bed.patient_name}</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                {bed.ward_name} — {bed.bed_number} · {bed.patient_code}
                {bed.blood_group ? ` · ${bed.blood_group}` : ''}
              </p>
              {bed.doctor_name && (
                <p className="text-xs text-[var(--color-text-muted)]">{bed.doctor_name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* More menu trigger */}
            <div className="relative">
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="btn-ghost p-2"
                aria-label="More actions"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {showMoreMenu && (
                <MoreActionsMenu
                  bed={bed}
                  onClose={() => setShowMoreMenu(false)}
                />
              )}
            </div>
            <button onClick={onClose} className="btn-ghost p-2" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Allergy Alert Banner */}
        {bed.admission_status === 'critical' && (
          <div className="px-5 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              ⚠️ {t('drawer.criticalPatient', { defaultValue: 'Critical Patient — Monitor closely' })}
            </p>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-[var(--color-border)] px-2">
          {DRAWER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{t(tab.labelKey)}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'vitals' && <DrawerVitalsTab bed={bed} />}
          {activeTab === 'mar' && <DrawerMARTab bed={bed} />}
          {activeTab === 'orders' && <DrawerOrdersTab bed={bed} />}
          {activeTab === 'services' && <DrawerServicesTab bed={bed} />}
        </div>
      </div>
    </>
  );
}

// ─── More Actions Dropdown ─────────────────────────────────────────────────

function MoreActionsMenu({ bed, onClose }: { bed: BedGridItem; onClose: () => void }) {
  const { t } = useTranslation(['nursing']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;

  const actions = [
    { label: t('drawer.more.intakeOutput', { defaultValue: 'I/O Chart' }), href: `${basePath}/nursing?tab=io&patient=${bed.patient_id}` },
    { label: t('drawer.more.nursingNotes', { defaultValue: 'Nursing Notes' }), href: `${basePath}/nursing?tab=notes&patient=${bed.patient_id}` },
    { label: t('drawer.more.returnMedicine', { defaultValue: 'Return Medicine' }), action: 'return-med' },
    { label: t('drawer.more.transferBed', { defaultValue: 'Transfer Bed' }), href: `${basePath}/admissions` },
    { label: t('drawer.more.dischargeClearance', { defaultValue: 'Discharge Clearance' }), href: `${basePath}/admissions` },
  ];

  return (
    <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--color-bg)] rounded-xl shadow-xl border border-[var(--color-border)] py-2 z-50">
      {actions.map((action, i) => (
        <a
          key={i}
          href={action.href ?? '#'}
          onClick={() => { onClose(); }}
          className="block px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-border-light)] transition-colors"
        >
          {action.label}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/PatientDrawer.tsx
git commit -m "feat(nursing): add PatientDrawer slide-over component with 4 tabs"
```

---

## Task 5: Drawer Tab — Vitals with Auto-Save

**Files:**
- Create: `web/src/components/nursing/DrawerVitalsTab.tsx`

- [ ] **Step 1: Create DrawerVitalsTab**

```typescript
import { useState, useCallback } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import VitalsTrend from '../VitalsTrend';
import type { BedGridItem } from './WardBedGrid';

interface DrawerVitalsTabProps {
  bed: BedGridItem;
}

interface VitalTrendData {
  vitals: Record<string, unknown>[];
  thresholds: Record<string, unknown>[];
}

export default function DrawerVitalsTab({ bed }: DrawerVitalsTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    systolic: '',
    diastolic: '',
    temperature: '',
    heart_rate: '',
    spo2: '',
    respiratory_rate: '',
    weight: '',
    notes: '',
  });
  const [savedFields, setSavedFields] = useState<Set<string>>(new Set());

  const { save, isPending } = useAutoSave({
    endpoint: '/api/nurse-station/vitals',
    method: 'post',
    debounceMs: 1500,
    invalidateKeys: [queryKeys.nurseStation.all],
    onSuccess: () => {
      setSavedFields(new Set(Object.keys(form).filter(k => form[k as keyof typeof form])));
      setTimeout(() => setSavedFields(new Set()), 2000);
      setForm({ systolic: '', diastolic: '', temperature: '', heart_rate: '', spo2: '', respiratory_rate: '', weight: '', notes: '' });
    },
  });

  const trendQuery = useApiQuery<VitalTrendData>(
    queryKeys.nurseStation.vitalsTrends(bed.patient_id!),
    `/api/nurse-station/vitals-trends/${bed.patient_id}?days=1`,
  );

  const handleBlur = useCallback((field: string, value: string) => {
    if (!value.trim()) return;
    const body: Record<string, unknown> = { patient_id: bed.patient_id, admission_id: bed.admission_id };
    body[field] = field === 'temperature' || field === 'weight' ? parseFloat(value) : parseInt(value);
    save(body);
  }, [bed.patient_id, bed.admission_id, save]);

  const getBorderColor = (field: string): string => {
    const val = form[field as keyof typeof form];
    if (!val) return '';
    const num = parseFloat(val);
    if (field === 'systolic' && (num > 160 || num < 80)) return 'border-red-400 focus:ring-red-400';
    if (field === 'diastolic' && (num > 100 || num < 50)) return 'border-red-400 focus:ring-red-400';
    if (field === 'spo2' && num < 92) return 'border-red-400 focus:ring-red-400';
    if (field === 'heart_rate' && (num > 120 || num < 50)) return 'border-red-400 focus:ring-red-400';
    if (field === 'temperature' && (num > 101 || num < 96)) return 'border-red-400 focus:ring-red-400';
    return 'border-[var(--color-border)] focus:ring-[var(--color-primary)]';
  };

  const vitalsFields = [
    { key: 'systolic', label: t('systolic'), placeholder: '120', type: 'number' },
    { key: 'diastolic', label: t('diastolic'), placeholder: '80', type: 'number' },
    { key: 'temperature', label: t('temp_f'), placeholder: '98.6', type: 'number', step: '0.1' },
    { key: 'heart_rate', label: t('heart_rate'), placeholder: '72', type: 'number' },
    { key: 'spo2', label: 'SpO₂', placeholder: '98', type: 'number' },
    { key: 'respiratory_rate', label: t('resp_rate'), placeholder: '18', type: 'number' },
    { key: 'weight', label: t('weight_kg'), placeholder: '65', type: 'number', step: '0.1' },
  ];

  return (
    <div className="space-y-5">
      {/* Latest Vitals Display */}
      {bed.latestVitals && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'BP', value: `${bed.latestVitals.systolic ?? '-'}/${bed.latestVitals.diastolic ?? '-'}`, unit: 'mmHg' },
            { label: 'HR', value: String(bed.latestVitals.heart_rate ?? '-'), unit: 'bpm' },
            { label: 'SpO₂', value: `${bed.latestVitals.spo2 ?? '-'}`, unit: '%' },
            { label: 'Temp', value: String(bed.latestVitals.temperature ?? '-'), unit: '°F' },
          ].map(v => (
            <div key={v.label} className="bg-[var(--color-border-light)] rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{v.label}</p>
              <p className="text-lg font-bold text-[var(--color-text)]">{v.value}</p>
              <p className="text-[10px] text-[var(--color-text-muted)]">{v.unit}</p>
            </div>
          ))}
        </div>
      )}

      {/* Vitals Input Form — Auto-save on blur */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">
          {t('recordVitals')}
          {isPending && <span className="ml-2 text-xs text-amber-500">Saving...</span>}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {vitalsFields.map(field => (
            <div key={field.key} className="relative">
              <label className="label text-xs">{field.label}</label>
              <div className="relative">
                <input
                  type={field.type}
                  step={field.step}
                  value={form[field.key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  onBlur={e => handleBlur(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className={`input pr-8 ${getBorderColor(field.key)}`}
                />
                {savedFields.has(field.key) && (
                  <Check className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <label className="label text-xs">{t('notes')}</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            onBlur={e => {
              if (e.target.value.trim()) {
                save({ patient_id: bed.patient_id, admission_id: bed.admission_id, notes: e.target.value });
              }
            }}
            rows={2}
            placeholder={t('additional_observations')}
            className="input resize-none"
          />
        </div>
      </div>

      {/* 24h Trend */}
      {trendQuery.data?.vitals && trendQuery.data.vitals.length > 1 && (
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">
            {t('drawer.vitals.trend24h', { defaultValue: '24h Trend' })}
          </h3>
          <VitalsTrend
            vitals={trendQuery.data.vitals.map(v => ({
              recorded_at: String(v.recorded_at ?? ''),
              systolic: v.systolic as number | undefined,
              diastolic: v.diastolic as number | undefined,
              heart_rate: v.heart_rate as number | undefined,
              spo2: v.spo2 as number | undefined,
              temperature: v.temperature as number | undefined,
            }))}
            thresholds={trendQuery.data.thresholds as any}
            compact
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/DrawerVitalsTab.tsx
git commit -m "feat(nursing): add DrawerVitalsTab with auto-save and trend graph"
```

---

## Task 6: Drawer Tab — MAR with Checkbox Tap

**Files:**
- Create: `web/src/components/nursing/DrawerMARTab.tsx`

- [ ] **Step 1: Create DrawerMARTab**

```typescript
import { useState } from 'react';
import { Check, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';
import type { BedGridItem } from './WardBedGrid';

interface DrawerMARTabProps {
  bed: BedGridItem;
}

interface MARSchedule {
  schedule_id: number;
  medication_name: string;
  generic_name?: string;
  dose: string;
  route: string;
  frequency: string;
  scheduled_time: string;
  status: string;
  administered_at?: string;
  administered_by?: string;
}

export default function DrawerMARTab({ bed }: DrawerMARTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();

  const today = new Date().toISOString().split('T')[0];
  const scheduleQuery = useApiQuery<{ Results: MARSchedule[] }>(
    queryKeys.nursing.marSchedule(bed.patient_id!, today),
    `/api/nursing/mar/schedule?patient_id=${bed.patient_id}&date=${today}`,
  );
  const schedules = scheduleQuery.data?.Results ?? [];

  const administerMutation = useApiMutation<unknown, { _id: number; status: string }>(
    'put',
    (vars) => `/api/nursing/mar/${vars._id}/administer`,
    {
      onSuccess: () => {
        toast.success(t('mar.administered', { defaultValue: 'Medication administered' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.marSchedule(bed.patient_id!, today) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
      },
      onError: () => toast.error(t('mar.administerFailed', { defaultValue: 'Failed to record administration' })),
    },
  );

  const handleAdminister = (scheduleId: number) => {
    administerMutation.mutate({ _id: scheduleId, status: 'given' });
  };

  // Group by time slot
  const grouped = schedules.reduce<Record<string, MARSchedule[]>>((acc, s) => {
    const hour = s.scheduled_time ? new Date(s.scheduled_time).getHours() : 0;
    const slot = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    (acc[slot] ??= []).push(s);
    return acc;
  }, {});

  const slotLabels: Record<string, string> = {
    morning: t('mar.slots.morning', { defaultValue: '🌅 Morning (6AM-12PM)' }),
    afternoon: t('mar.slots.afternoon', { defaultValue: '☀️ Afternoon (12PM-5PM)' }),
    evening: t('mar.slots.evening', { defaultValue: '🌙 Evening (5PM-12AM)' }),
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {t('drawer.mar.title', { defaultValue: 'Medication Administration' })}
        <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
          {today}
        </span>
      </h3>

      {schedules.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
          {t('drawer.mar.noScheduled', { defaultValue: 'No medications scheduled for today' })}
        </p>
      ) : (
        Object.entries(grouped).map(([slot, items]) => (
          <div key={slot}>
            <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">
              {slotLabels[slot] ?? slot}
            </h4>
            <div className="space-y-2">
              {items.map(s => {
                const isGiven = s.status === 'given';
                const time = s.scheduled_time
                  ? new Date(s.scheduled_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                  : '';

                return (
                  <div
                    key={s.schedule_id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      isGiven
                        ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'
                        : 'bg-[var(--color-bg)] border-[var(--color-border)]'
                    }`}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => !isGiven && handleAdminister(s.schedule_id)}
                      disabled={isGiven || administerMutation.isPending}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${
                        isGiven
                          ? 'bg-emerald-500 text-white'
                          : 'border-2 border-[var(--color-border)] hover:border-emerald-400 hover:bg-emerald-50 active:scale-90'
                      }`}
                    >
                      {isGiven && <Check className="w-5 h-5" />}
                    </button>

                    {/* Medication info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isGiven ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
                        {s.medication_name}
                        {s.generic_name && <span className="text-xs text-[var(--color-text-muted)] ml-1">({s.generic_name})</span>}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {s.dose} · {s.route} · {s.frequency}
                      </p>
                      {isGiven && s.administered_at && (
                        <p className="text-xs text-emerald-600 mt-0.5">
                          ✓ {t('mar.givenAt', { defaultValue: 'Given at' })} {new Date(s.administered_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>

                    {/* Time badge */}
                    <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 flex-shrink-0">
                      <Clock className="w-3 h-3" /> {time}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/DrawerMARTab.tsx
git commit -m "feat(nursing): add DrawerMARTab with checkbox tap medication administration"
```

---

## Task 7: Drawer Tab — Doctor's Orders (Read-Only)

**Files:**
- Create: `web/src/components/nursing/DrawerOrdersTab.tsx`

- [ ] **Step 1: Create DrawerOrdersTab**

```typescript
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface DrawerOrdersTabProps {
  bed: BedGridItem;
}

interface MedicationOrder {
  id: number;
  medication_name: string;
  generic_name?: string;
  dose: string;
  route: string;
  frequency: string;
  duration?: string;
  instructions?: string;
  priority: string;
  status: string;
  start_datetime?: string;
}

export default function DrawerOrdersTab({ bed }: DrawerOrdersTabProps) {
  const { t } = useTranslation(['nursing', 'common']);

  const ordersQuery = useApiQuery<{ Results: MedicationOrder[] }>(
    queryKeys.nursing.medicationOrders(bed.patient_id),
    `/api/nursing/medication-orders?patient_id=${bed.patient_id}&status=active`,
  );
  const orders = ordersQuery.data?.Results ?? [];

  const priorityColors: Record<string, string> = {
    stat: 'bg-red-100 text-red-700',
    urgent: 'bg-amber-100 text-amber-700',
    routine: 'bg-blue-100 text-blue-700',
    prn: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {t('drawer.orders.title', { defaultValue: "Doctor's Orders" })}
      </h3>

      {orders.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
          {t('drawer.orders.noActive', { defaultValue: 'No active orders' })}
        </p>
      ) : (
        <ul className="space-y-3">
          {orders.map(order => (
            <li
              key={order.id}
              className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {order.medication_name}
                    {order.generic_name && (
                      <span className="text-xs text-[var(--color-text-muted)] ml-1">({order.generic_name})</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {order.dose} · {order.route} · {order.frequency}
                    {order.duration ? ` · ${order.duration}` : ''}
                  </p>
                  {order.instructions && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 italic">
                      {order.instructions}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${priorityColors[order.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                  {order.priority.toUpperCase()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/DrawerOrdersTab.tsx
git commit -m "feat(nursing): add DrawerOrdersTab read-only doctor's orders view"
```

---

## Task 8: Drawer Tab — Services & Pharmacy Requisition

**Files:**
- Create: `web/src/components/nursing/DrawerServicesTab.tsx`

- [ ] **Step 1: Create DrawerServicesTab**

```typescript
import { useState } from 'react';
import { Plus, Pill, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';
import type { BedGridItem } from './WardBedGrid';

interface DrawerServicesTabProps {
  bed: BedGridItem;
}

export default function DrawerServicesTab({ bed }: DrawerServicesTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showPharmacyForm, setShowPharmacyForm] = useState(false);
  const [serviceForm, setServiceForm] = useState({ service_name: '', quantity: '1', remarks: '' });
  const [pharmacyForm, setPharmacyForm] = useState({ medication_name: '', quantity: '1', urgency: 'routine', remarks: '' });

  const addServiceMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/ipd-charges',
    {
      onSuccess: () => {
        toast.success(t('drawer.services.added', { defaultValue: 'Service charge added' }));
        setShowServiceForm(false);
        setServiceForm({ service_name: '', quantity: '1', remarks: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.ipd.all });
      },
      onError: () => toast.error(t('drawer.services.failed', { defaultValue: 'Failed to add service' })),
    },
  );

  const orderPharmacyMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/ward-supply/requisitions',
    {
      onSuccess: () => {
        toast.success(t('drawer.pharmacy.ordered', { defaultValue: 'Pharmacy order sent' }));
        setShowPharmacyForm(false);
        setPharmacyForm({ medication_name: '', quantity: '1', urgency: 'routine', remarks: '' });
      },
      onError: () => toast.error(t('drawer.pharmacy.failed', { defaultValue: 'Failed to send pharmacy order' })),
    },
  );

  const handleAddService = () => {
    if (!serviceForm.service_name.trim()) { toast.error(t('drawer.services.nameRequired', { defaultValue: 'Service name required' })); return; }
    addServiceMutation.mutate({
      patient_id: bed.patient_id,
      admission_id: bed.admission_id,
      service_name: serviceForm.service_name.trim(),
      quantity: parseInt(serviceForm.quantity) || 1,
      remarks: serviceForm.remarks || undefined,
    });
  };

  const handleOrderPharmacy = () => {
    if (!pharmacyForm.medication_name.trim()) { toast.error(t('drawer.pharmacy.medRequired', { defaultValue: 'Medication name required' })); return; }
    orderPharmacyMutation.mutate({
      patient_id: bed.patient_id,
      admission_id: bed.admission_id,
      items: [{ medication_name: pharmacyForm.medication_name.trim(), quantity: parseInt(pharmacyForm.quantity) || 1 }],
      urgency: pharmacyForm.urgency,
      remarks: pharmacyForm.remarks || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {t('drawer.services.title', { defaultValue: 'Services & Requisitions' })}
      </h3>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setShowServiceForm(!showServiceForm)}
          className="btn-secondary justify-center py-4"
        >
          <Plus className="w-5 h-5" />
          <span>{t('drawer.services.addService', { defaultValue: '+ Add Service' })}</span>
        </button>
        <button
          onClick={() => setShowPharmacyForm(!showPharmacyForm)}
          className="btn-secondary justify-center py-4"
        >
          <Pill className="w-5 h-5" />
          <span>{t('drawer.pharmacy.orderPharmacy', { defaultValue: '💊 Order Pharmacy' })}</span>
        </button>
      </div>

      {/* Add Service Form */}
      {showServiceForm && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3">
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            {t('drawer.services.addService', { defaultValue: 'Add Service Charge' })}
          </h4>
          <div>
            <label className="label text-xs">{t('drawer.services.serviceName', { defaultValue: 'Service Name' })} *</label>
            <input
              className="input"
              value={serviceForm.service_name}
              onChange={e => setServiceForm(f => ({ ...f, service_name: e.target.value }))}
              placeholder={t('drawer.services.servicePlaceholder', { defaultValue: 'e.g., Cannulation, Dressing, Injection' })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">{t('common:quantity', { defaultValue: 'Quantity' })}</label>
              <input type="number" min="1" className="input" value={serviceForm.quantity} onChange={e => setServiceForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">{t('common:remarks', { defaultValue: 'Remarks' })}</label>
              <input className="input" value={serviceForm.remarks} onChange={e => setServiceForm(f => ({ ...f, remarks: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowServiceForm(false)} className="btn-secondary text-sm">{t('common:cancel')}</button>
            <button onClick={handleAddService} disabled={addServiceMutation.isPending} className="btn-primary text-sm">
              {addServiceMutation.isPending ? t('common:saving') : t('common:add')}
            </button>
          </div>
        </div>
      )}

      {/* Pharmacy Order Form */}
      {showPharmacyForm && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3">
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            {t('drawer.pharmacy.emergencyOrder', { defaultValue: 'Emergency Pharmacy Order' })}
          </h4>
          <div>
            <label className="label text-xs">{t('drawer.pharmacy.medicationName', { defaultValue: 'Medication' })} *</label>
            <input
              className="input"
              value={pharmacyForm.medication_name}
              onChange={e => setPharmacyForm(f => ({ ...f, medication_name: e.target.value }))}
              placeholder={t('drawer.pharmacy.medPlaceholder', { defaultValue: 'Medicine name' })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">{t('common:quantity', { defaultValue: 'Quantity' })}</label>
              <input type="number" min="1" className="input" value={pharmacyForm.quantity} onChange={e => setPharmacyForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">{t('common:urgency', { defaultValue: 'Urgency' })}</label>
              <select className="input" value={pharmacyForm.urgency} onChange={e => setPharmacyForm(f => ({ ...f, urgency: e.target.value }))}>
                <option value="routine">{t('common:routine', { defaultValue: 'Routine' })}</option>
                <option value="urgent">{t('common:urgent', { defaultValue: 'Urgent' })}</option>
                <option value="stat">{t('common:stat', { defaultValue: 'STAT' })}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label text-xs">{t('common:remarks', { defaultValue: 'Remarks' })}</label>
            <input className="input" value={pharmacyForm.remarks} onChange={e => setPharmacyForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowPharmacyForm(false)} className="btn-secondary text-sm">{t('common:cancel')}</button>
            <button onClick={handleOrderPharmacy} disabled={orderPharmacyMutation.isPending} className="btn-primary text-sm">
              <Send className="w-3 h-3" />
              {orderPharmacyMutation.isPending ? t('common:sending') : t('drawer.pharmacy.send', { defaultValue: 'Send Order' })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/DrawerServicesTab.tsx
git commit -m "feat(nursing): add DrawerServicesTab with service charges and pharmacy orders"
```

---

## Task 9: Shift Handover Modal

**Files:**
- Create: `web/src/components/nursing/ShiftHandoverModal.tsx`

- [ ] **Step 1: Create ShiftHandoverModal**

```typescript
import { useState } from 'react';
import { X, ArrowRightLeft, AlertTriangle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';

interface ShiftHandoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoSummary: {
    pendingVitals: number;
    overdueMeds: number;
    criticalPatients: number;
    notes: string[];
  };
}

export default function ShiftHandoverModal({ isOpen, onClose, autoSummary }: ShiftHandoverModalProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [handoverNotes, setHandoverNotes] = useState('');

  const handoverMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/nursing/handover',
    {
      onSuccess: () => {
        toast.success(t('handover.completed', { defaultValue: 'Handover completed' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.all });
        onClose();
      },
      onError: () => toast.error(t('handover.failed', { defaultValue: 'Handover failed' })),
    },
  );

  const handleComplete = () => {
    const content = [
      autoSummary.pendingVitals > 0 ? `Pending vitals: ${autoSummary.pendingVitals} patients` : '',
      autoSummary.overdueMeds > 0 ? `Overdue medications: ${autoSummary.overdueMeds}` : '',
      autoSummary.criticalPatients > 0 ? `Critical patients: ${autoSummary.criticalPatients}` : '',
      ...autoSummary.notes,
      handoverNotes ? `Additional notes: ${handoverNotes}` : '',
    ].filter(Boolean).join('\n');

    if (!content.trim()) {
      toast.error(t('handover.nothingToHandover', { defaultValue: 'Nothing to handover' }));
      return;
    }

    handoverMutation.mutate({
      shift: new Date().getHours() < 14 ? 'morning' : 'evening',
      content,
      situation: autoSummary.criticalPatients > 0 ? `${autoSummary.criticalPatients} critical patients` : 'All stable',
      background: handoverNotes || undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[var(--color-bg)] rounded-2xl shadow-xl border border-[var(--color-border)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {t('handover.title', { defaultValue: 'Shift Handover' })}
              </h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('handover.subtitle', { defaultValue: 'Review and complete your shift handover' })}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Auto Summary */}
        <div className="px-5 py-4 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t('handover.autoSummary', { defaultValue: 'Automatic Summary' })}
          </h3>

          {autoSummary.pendingVitals > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t('handover.pendingVitals', { defaultValue: '{{count}} patients have pending vitals', count: autoSummary.pendingVitals })}
              </p>
            </div>
          )}

          {autoSummary.overdueMeds > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20">
              <Clock className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">
                {t('handover.overdueMeds', { defaultValue: '{{count}} overdue medications', count: autoSummary.overdueMeds })}
              </p>
            </div>
          )}

          {autoSummary.criticalPatients > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">
                {t('handover.criticalPatients', { defaultValue: '{{count}} critical patients', count: autoSummary.criticalPatients })}
              </p>
            </div>
          )}

          {autoSummary.pendingVitals === 0 && autoSummary.overdueMeds === 0 && autoSummary.criticalPatients === 0 && (
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                {t('handover.allClear', { defaultValue: 'All clear — no pending tasks or alerts' })}
              </p>
            </div>
          )}
        </div>

        {/* Handover Notes */}
        <div className="px-5 pb-4">
          <label className="label text-sm">
            {t('handover.notesLabel', { defaultValue: 'Additional notes for next shift' })}
          </label>
          <textarea
            value={handoverNotes}
            onChange={e => setHandoverNotes(e.target.value)}
            rows={3}
            placeholder={t('handover.notesPlaceholder', { defaultValue: 'Any special instructions or observations...' })}
            className="input resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-[var(--color-border)]">
          <button onClick={onClose} className="btn-secondary">
            {t('common:cancel')}
          </button>
          <button onClick={handleComplete} disabled={handoverMutation.isPending} className="btn-primary">
            {handoverMutation.isPending ? t('common:saving') : t('handover.complete', { defaultValue: 'Complete Handover' })}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/nursing/ShiftHandoverModal.tsx
git commit -m "feat(nursing): add ShiftHandoverModal with auto-summary"
```

---

## Task 10: Replace NurseStation.tsx — Visual Ward Dashboard

**Files:**
- Replace: `web/src/pages/NurseStation.tsx`

This is the main page — replaces the current 772-line file with the new visual ward dashboard.

- [ ] **Step 1: Rewrite NurseStation.tsx**

```typescript
import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import {
  Stethoscope, ChevronRight, RefreshCw, Users, AlertCircle,
  HeartPulse, Activity, CheckCircle, Printer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import WardBedGrid, { type BedGridItem } from '../components/nursing/WardBedGrid';
import PatientDrawer from '../components/nursing/PatientDrawer';
import ShiftHandoverModal from '../components/nursing/ShiftHandoverModal';

interface DashboardData {
  beds: BedGridItem[];
}

interface VitalsData {
  vitals: Record<string, unknown>[];
}

export default function NurseStation({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['nursing', 'dashboard', 'common']);
  const queryClient = useQueryClient();

  // ── State ──
  const [selectedBed, setSelectedBed] = useState<BedGridItem | null>(null);
  const [filterMyPatients, setFilterMyPatients] = useState(false);
  const [showHandover, setShowHandover] = useState(false);

  // ── Data fetching ──
  const { data: bedGridData, isLoading: bedsLoading } = useApiQuery<DashboardData>(
    [...queryKeys.nursing.wards(), 'bed-grid'],
    '/api/nursing/wards/bed-grid',
  );

  const { data: vitalsData } = useApiQuery<VitalsData>(
    queryKeys.nurseStation.vitals(),
    '/api/nurse-station/vitals?limit=10',
  );

  const alertsQuery = useApiQuery<{ alerts: Record<string, unknown>[] }>(
    [...queryKeys.nurseStation.all, 'active-alerts'],
    '/api/nurse-station/active-alerts?limit=10',
  );

  const medDueQuery = useApiQuery<{ summary: { overdue: number; upcoming: number; total: number } }>(
    queryKeys.nursing.medicationDue(),
    '/api/nursing/medication-due',
  );

  const favouritesQuery = useApiQuery<{ Results: { patient_id: number }[] }>(
    queryKeys.nursing.favourites(),
    '/api/nursing/favourites',
  );

  const beds = bedGridData?.beds ?? [];
  const vitalsLog = vitalsData?.vitals ?? [];
  const activeAlerts = alertsQuery.data?.alerts ?? [];
  const medDue = medDueQuery.data?.summary ?? { overdue: 0, upcoming: 0, total: 0 };
  const myPatientIds = new Set((favouritesQuery.data?.Results ?? []).map(f => f.patient_id));

  // ── Computed stats ──
  const stats = useMemo(() => {
    const occupied = beds.filter(b => b.patient_id);
    const critical = beds.filter(b => b.statusColor === 'critical');
    const pendingVitals = occupied.filter(b => !b.latestVitals);
    return {
      activePatients: occupied.length,
      pendingVitals: pendingVitals.length,
      medicationsDue: medDue.total,
      roundsCompleted: occupied.length - pendingVitals.length,
      totalRounds: occupied.length,
      activeAlerts: activeAlerts.length,
    };
  }, [beds, medDue.total, activeAlerts.length]);

  // ── Handover auto-summary ──
  const handoverSummary = useMemo(() => ({
    pendingVitals: stats.pendingVitals,
    overdueMeds: medDue.overdue,
    criticalPatients: beds.filter(b => b.statusColor === 'critical').length,
    notes: [] as string[],
  }), [stats.pendingVitals, medDue.overdue, beds]);

  // ── Handlers ──
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
    queryClient.invalidateQueries({ queryKey: [...queryKeys.nursing.wards(), 'bed-grid'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.nursing.medicationDue() });
    queryClient.invalidateQueries({ queryKey: queryKeys.nursing.favourites() });
  };

  const handleBedClick = (bed: BedGridItem) => {
    if (bed.patient_id) {
      setSelectedBed(bed);
    }
  };

  const kpis = [
    { label: t('stats.activePatients'), value: stats.activePatients, icon: <Users className="w-5 h-5 text-blue-500" />, bg: 'bg-blue-50' },
    { label: t('stats.pendingVitals'), value: stats.pendingVitals, icon: <AlertCircle className="w-5 h-5 text-amber-500" />, bg: 'bg-amber-50' },
    { label: t('stats.medicationsDue'), value: stats.medicationsDue, icon: <Activity className="w-5 h-5 text-red-500" />, bg: 'bg-red-50' },
    { label: t('stats.rounds'), value: `${stats.roundsCompleted}/${stats.totalRounds}`, icon: <CheckCircle className="w-5 h-5 text-emerald-500" />, bg: 'bg-emerald-50' },
  ];

  const printNursingSheet = (title: string, body: string) => {
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${title}</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #bbb;padding:6px;text-align:left}
      h1{font-size:18px}
      @media print{button{display:none}}
    </style></head><body><h1>${title}</h1>${body}<button onclick="window.print()">Print</button></body></html>`);
    win.document.close();
  };

  const printHandoverSheet = () => printNursingSheet('Nursing Handover Report',
    `<table><thead><tr><th>Patient</th><th>Ward/Bed</th><th>Diagnosis</th><th>Latest Vitals</th><th>Status</th></tr></thead><tbody>${
      beds.filter(b => b.patient_id).map(b => `<tr>
        <td>${b.patient_name ?? ''}</td>
        <td>${b.ward_name ?? ''}/${b.bed_number ?? ''}</td>
        <td>${b.provisional_diagnosis ?? ''}</td>
        <td>${b.latestVitals ? `${b.latestVitals.systolic ?? ''}/${b.latestVitals.diastolic ?? ''}, SpO2 ${b.latestVitals.spo2 ?? ''}` : 'Pending'}</td>
        <td>${b.statusColor ?? ''}</td>
      </tr>`).join('')
    }</tbody></table>`
  );

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('dashboard', { ns: 'common' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('nurseStation')}</span>
            </div>
            <h1 className="page-title flex items-center gap-2">
              <Stethoscope className="w-6 h-6" /> {t('nurseStation')}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterMyPatients(v => !v)}
              className={`text-sm ${filterMyPatients ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Users className="w-4 h-4" />
              {t('myPatients', { defaultValue: 'My Patients' })}
            </button>
            <button onClick={printHandoverSheet} className="btn-secondary text-sm">
              <Printer className="w-4 h-4" /> {t('handover.print', { defaultValue: 'Handover' })}
            </button>
            <button
              onClick={() => setShowHandover(true)}
              className="btn-secondary text-sm"
            >
              {t('handover.shiftHandover', { defaultValue: 'Shift Handover' })}
            </button>
            <button onClick={handleRefresh} className="btn-ghost p-2" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className="card p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.bg}`}>{k.icon}</div>
              <div>
                <p className="text-2xl font-bold text-[var(--color-text)]">{k.value}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{k.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Active Alerts Banner */}
        {activeAlerts.length > 0 && (
          <div className="card p-4 border-l-4 border-l-red-500">
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              {t('activeAlerts', { defaultValue: 'Active Alerts' })} ({activeAlerts.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {activeAlerts.slice(0, 4).map((alert, idx) => (
                <div key={String(alert.id ?? idx)} className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm">
                  <p className="font-medium text-red-800">
                    {String(alert.patient_name ?? 'Patient')} · {String(alert.vital_type ?? 'vital')}
                  </p>
                  <p className="text-xs text-red-600">
                    {String(alert.recorded_value ?? '')} outside {String(alert.threshold_min ?? '')}-{String(alert.threshold_max ?? '')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Visual Ward Bed Grid */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">
            {t('wardMap', { defaultValue: 'Ward Map' })}
          </h2>
          {bedsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="skeleton h-[120px] rounded-xl" />
              ))}
            </div>
          ) : (
            <WardBedGrid
              beds={beds}
              onBedClick={handleBedClick}
              filterMyPatients={filterMyPatients}
              myPatientIds={myPatientIds}
            />
          )}
        </div>

        {/* Recent Vitals Log */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('recentVitalsLog')}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('time', { ns: 'common' })}</th>
                  <th>{t('patient', { ns: 'common' })}</th>
                  <th className="text-center">{t('bp', { ns: 'common' })}</th>
                  <th className="text-center">{t('temp', { ns: 'common' })}</th>
                  <th className="text-center">{t('heart_rate')}</th>
                  <th className="text-center">{t('spo₂_')}</th>
                </tr>
              </thead>
              <tbody>
                {vitalsLog.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--color-text-muted)]">{t('nursing.no_vitals_recorded', { defaultValue: 'No vitals recorded' })}</td></tr>
                ) : (
                  vitalsLog.slice(0, 5).map((v: Record<string, unknown>, i: number) => (
                    <tr key={i}>
                      <td className="text-xs text-[var(--color-text-muted)]">{String(v.recorded_at ?? '')}</td>
                      <td className="font-medium">{String(v.patient_name ?? '')}</td>
                      <td className="text-center">{v.systolic ?? '-'}/{v.diastolic ?? '-'}</td>
                      <td className="text-center">{v.temperature ?? '-'}°F</td>
                      <td className="text-center">{v.heart_rate ?? '-'}</td>
                      <td className="text-center">{v.spo2 ?? '-'}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Patient Drawer */}
      <PatientDrawer
        bed={selectedBed}
        onClose={() => setSelectedBed(null)}
      />

      {/* Shift Handover Modal */}
      <ShiftHandoverModal
        isOpen={showHandover}
        onClose={() => setShowHandover(false)}
        autoSummary={handoverSummary}
      />
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/NurseStation.tsx
git commit -m "feat(nursing): replace NurseStation with visual ward dashboard"
```

---

## Task 11: Translation Keys

**Files:**
- Modify: `web/public/locales/en/nursing.json`
- Modify: `web/public/locales/bn/nursing.json`

- [ ] **Step 1: Add English translation keys**

Add these keys to `web/public/locales/en/nursing.json`:

```json
{
  "allWards": "All Wards",
  "beds": "beds",
  "noBedsFound": "No beds found matching filters",
  "wardMap": "Ward Map",
  "myPatients": "My Patients",
  "empty": "Empty",
  "stable": "Stable",
  "medDue": "med due",
  "alerts": "alerts",
  "drawer": {
    "tabs": {
      "vitals": "Vitals",
      "mar": "MAR",
      "orders": "Orders",
      "services": "Services"
    },
    "criticalPatient": "Critical Patient — Monitor closely",
    "vitals": {
      "trend24h": "24h Trend"
    },
    "mar": {
      "title": "Medication Administration",
      "noScheduled": "No medications scheduled for today",
      "administered": "Medication administered",
      "administerFailed": "Failed to record administration",
      "givenAt": "Given at",
      "slots": {
        "morning": "Morning (6AM-12PM)",
        "afternoon": "Afternoon (12PM-5PM)",
        "evening": "Evening (5PM-12AM)"
      }
    },
    "orders": {
      "title": "Doctor's Orders",
      "noActive": "No active orders"
    },
    "services": {
      "title": "Services & Requisitions",
      "addService": "+ Add Service",
      "added": "Service charge added",
      "failed": "Failed to add service",
      "nameRequired": "Service name required",
      "serviceName": "Service Name",
      "servicePlaceholder": "e.g., Cannulation, Dressing, Injection"
    },
    "pharmacy": {
      "orderPharmacy": "💊 Order Pharmacy",
      "emergencyOrder": "Emergency Pharmacy Order",
      "medicationName": "Medication",
      "medPlaceholder": "Medicine name",
      "ordered": "Pharmacy order sent",
      "failed": "Failed to send pharmacy order",
      "medRequired": "Medication name required",
      "send": "Send Order"
    },
    "more": {
      "intakeOutput": "I/O Chart",
      "nursingNotes": "Nursing Notes",
      "returnMedicine": "Return Medicine",
      "transferBed": "Transfer Bed",
      "dischargeClearance": "Discharge Clearance"
    }
  },
  "handover": {
    "title": "Shift Handover",
    "subtitle": "Review and complete your shift handover",
    "autoSummary": "Automatic Summary",
    "pendingVitals": "{{count}} patients have pending vitals",
    "overdueMeds": "{{count}} overdue medications",
    "criticalPatients": "{{count}} critical patients",
    "allClear": "All clear — no pending tasks or alerts",
    "notesLabel": "Additional notes for next shift",
    "notesPlaceholder": "Any special instructions or observations...",
    "complete": "Complete Handover",
    "completed": "Handover completed",
    "failed": "Handover failed",
    "nothingToHandover": "Nothing to handover",
    "print": "Handover",
    "shiftHandover": "Shift Handover"
  }
}
```

- [ ] **Step 2: Add Bengali translation keys**

Add corresponding Bengali translations to `web/public/locales/bn/nursing.json`.

- [ ] **Step 3: Commit**

```bash
git add web/public/locales/en/nursing.json web/public/locales/bn/nursing.json
git commit -m "feat(i18n): add nursing visual dashboard translation keys"
```

---

## Task 12: Query Keys

**Files:**
- Modify: `web/src/lib/queryKeys.ts`

- [ ] **Step 1: Add missing query keys**

Add these to the existing query keys file:

```typescript
// Add to nurseStation section:
vitalsTrends: (patientId: number) => [...nurseStation.all, 'vitals-trends', patientId] as const,

// Add to nursing section if not present:
marSchedule: (patientId: number, date: string) => [...nursing.all, 'mar-schedule', patientId, date] as const,
medicationOrders: (patientId?: number | null) => [...nursing.all, 'medication-orders', patientId] as const,
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/queryKeys.ts
git commit -m "feat(query-keys): add nursing visual dashboard query keys"
```

---

## Task 13: Final Integration & Build Verification

- [ ] **Step 1: Run TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run lint**

```bash
cd web && npm run lint
```

Expected: No errors.

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: Successful build.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(nursing): resolve build issues for visual dashboard"
```

---

## Summary

| Task | Component | Lines (est.) |
|------|-----------|-------------|
| 1 | Backend bed-grid API | ~60 |
| 2 | useAutoSave hook | ~60 |
| 3 | WardBedGrid | ~150 |
| 4 | PatientDrawer shell | ~150 |
| 5 | DrawerVitalsTab | ~150 |
| 6 | DrawerMARTab | ~130 |
| 7 | DrawerOrdersTab | ~80 |
| 8 | DrawerServicesTab | ~150 |
| 9 | ShiftHandoverModal | ~130 |
| 10 | NurseStation.tsx replace | ~250 |
| 11 | Translations | ~80 |
| 12 | Query keys | ~10 |
| 13 | Build verification | — |
| **Total** | | **~1,400** |

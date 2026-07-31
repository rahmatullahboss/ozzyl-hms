import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw,
  RotateCcw, Layers, Umbrella, Clock, Trash2, Users, X,
  PartyPopper,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import Modal from '../components/shared/Modal';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Staff {
  id: number;
  name: string;
  position: string;
  department: string;
}

interface Shift {
  id: number;
  shift_name: string;
  short_code?: string;
  start_time: string;
  end_time: string;
  color?: string;
}

interface RosterAssignment {
  rosterId: number;
  staffId: number;
  staffName: string;
  position: string;
  department: string | null;
  shiftId: number;
  shiftName: string;
  shiftShortCode: string | null;
  shiftStartTime: string;
  shiftEndTime: string;
  shiftColor: string | null;
  rosterDate: string;
  status: 'scheduled' | 'swapped' | 'cancelled';
  swappedWithStaffId: number | null;
  remarks: string | null;
  version: number;
}

interface RotationPattern {
  patternId: number;
  patternName: string;
  cycleDays: number;
  isActive: boolean;
  days: RotationDay[];
}

interface RotationDay {
  dayNumber: number;
  shiftId: number | null;
  shiftName: string | null;
  isOff: boolean;
}

interface Holiday {
  holidayId: number;
  name: string;
  date: string;
  type: 'public' | 'optional' | 'restricted';
  isActive: boolean;
}

interface OvertimeRule {
  ruleId: number;
  ruleName: string;
  multiplier: number;
  minHoursBeforeOvertime: number;
  maxOvertimeHoursPerDay: number;
  appliesOn: 'weekday' | 'weekend' | 'holiday' | 'all';
  isActive: boolean;
}

// ─── API response wrappers ─────────────────────────────────────────────────

interface ListResponse<T> {
  data?: T[];
}

interface MutationResponse<T> {
  data: T;
}

interface BulkRosterResult {
  created: number;
  updated: number;
  skipped: number;
}

interface GenerateRosterResult {
  created: number;
  unchanged: number;
  skipped: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtShort(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d);
}

function fmtFull(d: string): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d));
  } catch { return d; }
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DEFAULT_SHIFT_COLORS: Record<string, string> = {
  morning: '#3B82F6',
  evening: '#F59E0B',
  night: '#6366F1',
};

function getShiftColor(shift: Shift): string {
  if (shift.color) return shift.color;
  const name = shift.shift_name?.toLowerCase() ?? '';
  for (const [key, color] of Object.entries(DEFAULT_SHIFT_COLORS)) {
    if (name.includes(key)) return color;
  }
  return '#64748b';
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function avatarColor(id: number): string {
  const colors = [
    'from-cyan-500 to-teal-600',
    'from-violet-500 to-purple-600',
    'from-amber-500 to-orange-600',
    'from-emerald-500 to-green-600',
    'from-rose-500 to-pink-600',
    'from-blue-500 to-indigo-600',
    'from-fuchsia-500 to-pink-500',
    'from-lime-500 to-emerald-500',
  ];
  return colors[id % colors.length];
}

function safeMutationError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHIFT POPOVER (inline, no portal)
// ═══════════════════════════════════════════════════════════════════════════

function ShiftPopover({
  shifts,
  selectedId,
  onSelect,
  onCancel,
  onSwap,
  onClose,
  isEdit,
  saving,
}: {
  shifts: Shift[];
  selectedId: string;
  onSelect: (shiftId: string) => void;
  onCancel: () => void;
  onSwap: () => void;
  onClose: () => void;
  isEdit: boolean;
  saving: boolean;
}) {
  const { t } = useTranslation(['duty-roster', 'common']);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-[var(--color-border)] p-3 min-w-[200px] animate-fade-in-up"
    >
      <div className="space-y-1.5">
        {shifts.map((sh) => {
          const color = getShiftColor(sh);
          const isSelected = String(sh.id) === selectedId;
          return (
            <button
              key={sh.id}
              onClick={() => onSelect(String(sh.id))}
              disabled={saving}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                isSelected
                  ? 'bg-[var(--color-bg-secondary)] ring-1 ring-[var(--color-primary)]'
                  : 'hover:bg-[var(--color-bg-secondary)]'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium text-[var(--color-text)]">{sh.shift_name}</span>
              <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                {sh.start_time?.slice(0, 5)}–{sh.end_time?.slice(0, 5)}
              </span>
            </button>
          );
        })}
      </div>
      {isEdit && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={onSwap}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('roster.swapAssignment')}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('roster.cancelAssignment')}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROSTER GRID TAB
// ═══════════════════════════════════════════════════════════════════════════

function RosterGridTab({
  staffList,
  shifts,
}: {
  staffList: Staff[];
  shifts: Shift[];
}) {
  const { t } = useTranslation(['duty-roster', 'common']);
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));

  // Popover state
  const [popover, setPopover] = useState<{
    staffId: number;
    dateStr: string;
    existing?: RosterAssignment;
  } | null>(null);

  // Drag-and-drop state
  const [dragData, setDragData] = useState<{ shiftId: number; shiftName: string; shiftColor: string } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  // Modals
  const [showBulk, setShowBulk] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [assignmentAction, setAssignmentAction] = useState<{
    mode: 'cancel' | 'swap';
    assignment: RosterAssignment;
  } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [swapWithStaffId, setSwapWithStaffId] = useState('');

  // Bulk form
  const [bulkForm, setBulkForm] = useState({
    staff_ids: [] as number[],
    shift_id: '',
    from_date: '',
    to_date: '',
  });

  // Generate form
  const [genDate, setGenDate] = useState({ from: '', to: '' });

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const from = fmtDate(weekStart);
  const to = fmtDate(weekEnd);

  // ── Fetch roster for the current week ─────────────────────────────────
  const { data: rosterData, isLoading: loading } = useApiQuery<ListResponse<RosterAssignment> & RosterAssignment[]>(
    queryKeys.dutyRoster.roster(from, to),
    `/api/hr/roster?from=${from}&to=${to}`,
  );

  const assignments: RosterAssignment[] = useMemo(
    () => (rosterData as ListResponse<RosterAssignment>)?.data || (rosterData as RosterAssignment[]) || [],
    [rosterData],
  );

  // ── Fetch holidays for the year ───────────────────────────────────────
  const year = String(weekStart.getFullYear());
  const { data: holidaysData } = useApiQuery<ListResponse<Holiday> & Holiday[]>(
    queryKeys.dutyRoster.holidays(),
    `/api/hr/roster/holidays?year=${year}`,
  );

  const holidays: Holiday[] = useMemo(
    () => (holidaysData as ListResponse<Holiday>)?.data || (holidaysData as Holiday[]) || [],
    [holidaysData],
  );

  const holidayMap = useMemo(() => {
    const map: Record<string, Holiday> = {};
    holidays.forEach((h) => {
      map[h.date?.slice(0, 10)] = h;
    });
    return map;
  }, [holidays]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const assignMutation = useApiMutation<unknown, { staffId: number; shiftId: number; rosterDate: string; idempotencyKey: string }>(
    'post',
    '/api/hr/roster',
    {
      onSuccess: () => {
        toast.success(t('toast.shiftAssigned'));
        setPopover(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: (error) => toast.error(safeMutationError(error, t('toast.failedAssignShift'))),
    },
  );

  const cancelMutation = useApiMutation<unknown, { id: string; reason: string; idempotencyKey: string }>(
    'delete',
    (vars) => `/api/hr/roster/${vars.id}`,
    {
      body: ({ reason, idempotencyKey }) => ({ reason, idempotencyKey }),
      onSuccess: () => {
        toast.success(t('toast.assignmentRemoved'));
        setPopover(null);
        setAssignmentAction(null);
        setActionReason('');
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: (error) => toast.error(safeMutationError(error, t('toast.failedRemoveAssignment'))),
    },
  );

  const swapMutation = useApiMutation<unknown, {
    id: string;
    swapWithStaffId: number;
    reason: string;
    idempotencyKey: string;
  }>(
    'put',
    (vars) => `/api/hr/roster/${vars.id}/swap`,
    {
      body: ({ swapWithStaffId, reason, idempotencyKey }) => ({ swapWithStaffId, reason, idempotencyKey }),
      onSuccess: () => {
        toast.success(t('toast.assignmentSwapped'));
        setPopover(null);
        setAssignmentAction(null);
        setActionReason('');
        setSwapWithStaffId('');
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: (error) => toast.error(safeMutationError(error, t('toast.failedSwapAssignment'))),
    },
  );

  const bulkMutation = useApiMutation<MutationResponse<BulkRosterResult>, {
    assignments: Array<{ staffId: number; shiftId: number }>;
    startDate: string;
    endDate: string;
    dateMode: 'all_dates' | 'configured_working_days';
    idempotencyKey: string;
  }>(
    'post',
    '/api/hr/roster/bulk',
    {
      onSuccess: ({ data }) => {
        toast.success(t('toast.bulkAssignmentResult', {
          created: data.created,
          updated: data.updated,
          skipped: data.skipped,
        }));
        setShowBulk(false);
        setBulkForm({ staff_ids: [], shift_id: '', from_date: '', to_date: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: (error) => toast.error(safeMutationError(error, t('toast.bulkAssignmentFailed'))),
    },
  );

  const generateMutation = useApiMutation<MutationResponse<GenerateRosterResult>, {
    startDate: string;
    endDate: string;
    replaceExisting: false;
    idempotencyKey: string;
  }>(
    'post',
    '/api/hr/roster/generate',
    {
      onSuccess: ({ data }) => {
        toast.success(t('toast.generationResult', {
          created: data.created,
          unchanged: data.unchanged,
          skipped: data.skipped,
        }));
        setShowGenerate(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: (error) => toast.error(safeMutationError(error, t('toast.generationFailed'))),
    },
  );

  const saving = assignMutation.isPending || cancelMutation.isPending || swapMutation.isPending;

  const prevWeek = () => setWeekStart(addDays(weekStart, -7));
  const nextWeek = () => setWeekStart(addDays(weekStart, 7));
  const goToday = () => setWeekStart(getMonday(new Date()));

  // Build lookup: staffId-date -> assignment
  const rosterMap = useMemo(() => {
    const map: Record<string, RosterAssignment> = {};
    assignments.forEach((a) => {
      map[`${a.staffId}-${a.rosterDate.slice(0, 10)}`] = a;
    });
    return map;
  }, [assignments]);

  const isToday = (d: Date) => fmtDate(d) === fmtDate(new Date());

  const handleShiftSelect = useCallback(
    (shiftId: string) => {
      if (!popover) return;
      assignMutation.mutate({
        staffId: popover.staffId,
        shiftId: Number(shiftId),
        rosterDate: popover.dateStr,
        idempotencyKey: `roster:assign:${popover.staffId}:${popover.dateStr}:${shiftId}`,
      });
    },
    [popover, assignMutation],
  );

  const openAssignmentAction = useCallback((mode: 'cancel' | 'swap') => {
    if (!popover?.existing) return;
    setAssignmentAction({ mode, assignment: popover.existing });
    setActionReason('');
    setSwapWithStaffId('');
  }, [popover]);

  const handleConfirmAssignmentAction = () => {
    if (!assignmentAction) return;
    const reason = actionReason.trim();
    if (reason.length < 3) {
      toast.error(t('roster.reasonRequired'));
      return;
    }

    const assignment = assignmentAction.assignment;
    if (assignmentAction.mode === 'cancel') {
      cancelMutation.mutate({
        id: String(assignment.rosterId),
        reason,
        idempotencyKey: `roster:cancel:${assignment.rosterId}:${assignment.version}:${reason.length}`,
      });
      return;
    }

    const targetStaffId = Number(swapWithStaffId);
    if (!Number.isInteger(targetStaffId) || targetStaffId <= 0 || targetStaffId === assignment.staffId) {
      toast.error(t('roster.swapTargetRequired'));
      return;
    }
    swapMutation.mutate({
      id: String(assignment.rosterId),
      swapWithStaffId: targetStaffId,
      reason,
      idempotencyKey: `roster:swap:${assignment.rosterId}:${targetStaffId}:${assignment.version}:${reason.length}`,
    });
  };

  const toggleBulkStaff = (id: number) => {
    setBulkForm((prev) => ({
      ...prev,
      staff_ids: prev.staff_ids.includes(id)
        ? prev.staff_ids.filter((x) => x !== id)
        : [...prev.staff_ids, id],
    }));
  };

  const handleBulk = () => {
    if (!bulkForm.staff_ids.length || !bulkForm.shift_id || !bulkForm.from_date || !bulkForm.to_date) {
      toast.error(t('toast.allFieldsRequired'));
      return;
    }
    bulkMutation.mutate({
      assignments: bulkForm.staff_ids.map((staffId) => ({ staffId, shiftId: Number(bulkForm.shift_id) })),
      startDate: bulkForm.from_date,
      endDate: bulkForm.to_date,
      dateMode: 'all_dates',
      idempotencyKey: `roster:bulk:${bulkForm.from_date}:${bulkForm.to_date}:${bulkForm.staff_ids.join(',')}:${bulkForm.shift_id}`,
    });
  };

  const handleGenerate = () => {
    if (!genDate.from || !genDate.to) {
      toast.error(t('toast.selectDateRange'));
      return;
    }
    generateMutation.mutate({
      startDate: genDate.from,
      endDate: genDate.to,
      replaceExisting: false,
      idempotencyKey: `roster:generate:${genDate.from}:${genDate.to}`,
    });
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="btn-ghost p-2" aria-label="Previous week">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={goToday} className="btn-secondary text-sm px-3 py-1.5">
            {t('roster.thisWeek')}
          </button>
          <button onClick={nextWeek} className="btn-ghost p-2" aria-label="Next week">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {fmtShort(weekStart)} &ndash; {fmtShort(weekEnd)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulk(true)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Layers className="w-4 h-4" /> {t('roster.bulkAssign')}
          </button>
          <button onClick={() => setShowGenerate(true)} className="btn-secondary text-sm flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" /> {t('roster.generateFromRotations')}
          </button>
        </div>
      </div>

      {/* Shift Palette — drag from here */}
      {shifts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--color-text-muted)] font-medium">{t('roster.dragToAssign', { defaultValue: 'Drag shift:' })}</span>
          {shifts.map((sh) => (
            <div
              key={sh.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(sh.id));
                setDragData({ shiftId: sh.id, shiftName: sh.shift_name, shiftColor: getShiftColor(sh) });
              }}
              onDragEnd={() => setDragData(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--color-border)] bg-white dark:bg-slate-800 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow text-sm"
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getShiftColor(sh) }} />
              <span className="font-medium">{sh.shift_name}</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">{sh.start_time?.slice(0, 5)}–{sh.end_time?.slice(0, 5)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="card overflow-x-auto">
        <div className="min-w-[900px]">
          {/* Header row */}
          <div className="grid grid-cols-[200px_repeat(7,1fr)] border-b border-[var(--color-border)]">
            <div className="p-3 sticky left-0 z-20 bg-[var(--color-bg-secondary)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              {t('roster.staff')}
            </div>
            {weekDays.map((d, i) => {
              const today = isToday(d);
              const dateStr = fmtDate(d);
              const holiday = holidayMap[dateStr];
              return (
                <div
                  key={i}
                  className={`p-3 text-center border-l border-[var(--color-border)] ${
                    today ? 'bg-cyan-50/60 dark:bg-cyan-900/20' : ''
                  }`}
                >
                  <div className="text-xs text-[var(--color-text-muted)] font-medium">{DAY_LABELS[i]}</div>
                  <div className={`text-base font-bold mt-0.5 ${today ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]'}`}>
                    {d.getDate()}
                  </div>
                  {holiday && (
                    <div className="flex items-center justify-center gap-1 mt-1">
                      <PartyPopper className="w-3 h-3 text-amber-500" />
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium truncate max-w-[80px]">
                        {holiday.name}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Loading */}
          {loading && (
            <div className="p-12 text-center text-[var(--color-text-muted)]">
              {t('roster.loadingRoster')}
            </div>
          )}

          {/* Empty */}
          {!loading && staffList.length === 0 && (
            <div className="p-12 text-center text-[var(--color-text-muted)]">
              {t('roster.noStaffFound')}
            </div>
          )}

          {/* Staff rows */}
          {!loading && staffList.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-[200px_repeat(7,1fr)] border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-secondary)]/30 transition-colors"
            >
              {/* Staff name cell — sticky left */}
              <div className="p-3 sticky left-0 z-10 bg-white dark:bg-slate-800 flex items-center gap-2.5 border-r border-[var(--color-border)]">
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarColor(s.id)} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}>
                  {initials(s.name)}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm text-[var(--color-text)] truncate">{s.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)] truncate">{s.position}</div>
                </div>
              </div>

              {/* Day cells */}
              {weekDays.map((d, di) => {
                const dateStr = fmtDate(d);
                const key = `${s.id}-${dateStr}`;
                const assignment = rosterMap[key];
                const today = isToday(d);
                const holiday = holidayMap[dateStr];
                const isOpen = popover?.staffId === s.id && popover?.dateStr === dateStr;
                const isDragOver = dragOverCell === key;

                const cellDropHandlers = {
                  onDragOver: (e: React.DragEvent) => {
                    e.preventDefault();
                    setDragOverCell(key);
                  },
                  onDragLeave: () => setDragOverCell(null),
                  onDrop: async (e: React.DragEvent) => {
                    e.preventDefault();
                    setDragOverCell(null);
                    const shiftId = parseInt(e.dataTransfer.getData('text/plain'));
                    if (!shiftId) return;
                    const assignmentInput = {
                      staffId: s.id,
                      shiftId,
                      rosterDate: dateStr,
                      idempotencyKey: `roster:assign:${s.id}:${dateStr}:${shiftId}`,
                    };
                    assignMutation.mutate(assignmentInput);
                  },
                };

                return (
                  <div
                    key={di}
                    {...cellDropHandlers}
                    className={`relative p-2 border-l border-[var(--color-border)] flex items-center justify-center min-h-[56px] ${
                      today ? 'bg-cyan-50/40 dark:bg-cyan-900/10' : ''
                    } ${holiday ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''} ${
                      isDragOver ? 'bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-400 ring-inset' : ''
                    }`}
                  >
                    {assignment ? (
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', String(assignment.shiftId));
                          setDragData({ shiftId: assignment.shiftId, shiftName: assignment.shiftName, shiftColor: assignment.shiftColor || getShiftColor(shifts.find((sh) => sh.id === assignment.shiftId) || shifts[0]) || '#64748b' });
                        }}
                        onDragEnd={() => setDragData(null)}
                        className="cursor-grab active:cursor-grabbing"
                      >
                        <button
                          onClick={() => setPopover({ staffId: s.id, dateStr, existing: assignment })}
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold text-white shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
                            dragData?.shiftId === assignment.shiftId ? 'opacity-50' : ''
                          }`}
                          style={{ backgroundColor: assignment.shiftColor || getShiftColor(shifts.find((sh) => sh.id === assignment.shiftId) || shifts[0]) || '#64748b' }}
                        >
                          {assignment.shiftShortCode || assignment.shiftName}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPopover({ staffId: s.id, dateStr })}
                        className="w-7 h-7 rounded-full border-2 border-dashed border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors opacity-0 group-hover:opacity-100"
                        style={{ opacity: 1 }}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}

                    {/* Popover */}
                    {isOpen && (
                      <ShiftPopover
                        shifts={shifts}
                        selectedId={assignment ? String(assignment.shiftId) : ''}
                        onSelect={handleShiftSelect}
                        onCancel={() => openAssignmentAction('cancel')}
                        onSwap={() => openAssignmentAction('swap')}
                        onClose={() => setPopover(null)}
                        isEdit={!!assignment}
                        saving={saving}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Assignment lifecycle modal */}
      {assignmentAction && (
        <Modal
          title={t(
            assignmentAction.mode === 'cancel'
              ? 'roster.cancelAssignmentTitle'
              : 'roster.swapAssignmentTitle',
          )}
          onClose={() => {
            setAssignmentAction(null);
            setActionReason('');
            setSwapWithStaffId('');
          }}
        >
          {assignmentAction.mode === 'swap' && (
            <div>
              <label className="label">{t('roster.swapWithStaff')}</label>
              <select
                className="input"
                value={swapWithStaffId}
                onChange={(event) => setSwapWithStaffId(event.target.value)}
                disabled={swapMutation.isPending}
              >
                <option value="">{t('roster.selectSwapStaff')}</option>
                {staffList
                  .filter((staff) => staff.id !== assignmentAction.assignment.staffId)
                  .map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.name}</option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">{t('roster.reason')}</label>
            <textarea
              className="input min-h-24"
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              placeholder={t(
                assignmentAction.mode === 'cancel'
                  ? 'roster.cancelReasonPlaceholder'
                  : 'roster.swapReasonPlaceholder',
              )}
              disabled={cancelMutation.isPending || swapMutation.isPending}
            />
          </div>
          <button
            onClick={handleConfirmAssignmentAction}
            disabled={cancelMutation.isPending || swapMutation.isPending}
            className={`w-full ${assignmentAction.mode === 'cancel' ? 'btn-danger' : 'btn-primary'}`}
          >
            {assignmentAction.mode === 'cancel'
              ? t('roster.confirmCancel')
              : t('roster.confirmSwap')}
          </button>
        </Modal>
      )}

      {/* Bulk Assign Modal */}
      {showBulk && (
        <Modal title={t('roster.bulkAssignTitle')} onClose={() => setShowBulk(false)} wide>
          <div>
            <label className="label">{t('roster.selectStaffLabel')}</label>
            <div className="border border-[var(--color-border)] rounded-xl p-3 max-h-48 overflow-y-auto space-y-1">
              {staffList.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--color-bg-secondary)] p-1.5 rounded-lg">
                  <input
                    type="checkbox"
                    checked={bulkForm.staff_ids.includes(s.id)}
                    onChange={() => toggleBulkStaff(s.id)}
                    className="rounded border-[var(--color-border)]"
                  />
                  <span>{s.name}</span>
                  <span className="text-[var(--color-text-muted)]">({s.position})</span>
                </label>
              ))}
            </div>
            {bulkForm.staff_ids.length > 0 && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {t('roster.staffSelected', { count: bulkForm.staff_ids.length })}
              </p>
            )}
          </div>
          <div>
            <label className="label">{t('roster.shift')}</label>
            <select
              className="input"
              value={bulkForm.shift_id}
              onChange={(e) => setBulkForm((p) => ({ ...p, shift_id: e.target.value }))}
            >
              <option value="">{t('roster.selectShift')}</option>
              {shifts.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.shift_name} ({sh.start_time} - {sh.end_time})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('roster.fromDate')}</label>
              <input
                type="date"
                className="input"
                value={bulkForm.from_date}
                onChange={(e) => setBulkForm((p) => ({ ...p, from_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('roster.toDate')}</label>
              <input
                type="date"
                className="input"
                value={bulkForm.to_date}
                onChange={(e) => setBulkForm((p) => ({ ...p, to_date: e.target.value }))}
              />
            </div>
          </div>
          <button onClick={handleBulk} disabled={bulkMutation.isPending} className="btn-primary w-full">
            {bulkMutation.isPending ? t('roster.assigning') : t('roster.bulkAssignButton')}
          </button>
        </Modal>
      )}

      {/* Generate from Rotations Modal */}
      {showGenerate && (
        <Modal title={t('roster.generateFromRotationsTitle')} onClose={() => setShowGenerate(false)}>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t('roster.generateDescription')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('roster.fromDate')}</label>
              <input
                type="date"
                className="input"
                value={genDate.from}
                onChange={(e) => setGenDate((p) => ({ ...p, from: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('roster.toDate')}</label>
              <input
                type="date"
                className="input"
                value={genDate.to}
                onChange={(e) => setGenDate((p) => ({ ...p, to: e.target.value }))}
              />
            </div>
          </div>
          <button onClick={handleGenerate} disabled={generateMutation.isPending} className="btn-primary w-full">
            {generateMutation.isPending ? t('roster.generating') : t('roster.generateRoster')}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROTATIONS TAB
// ═══════════════════════════════════════════════════════════════════════════

function RotationsTab({
  staffList,
  shifts,
}: {
  staffList: Staff[];
  shifts: Shift[];
}) {
  const { t } = useTranslation(['duty-roster', 'common']);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showAssignStaff, setShowAssignStaff] = useState(false);

  const [patternName, setPatternName] = useState('');
  const [cycleDays, setCycleDays] = useState(7);
  const [dayRows, setDayRows] = useState<{ day_number: number; shift_id: string; is_day_off: boolean }[]>([]);

  const [assignStaffForm, setAssignStaffForm] = useState({
    staff_id: '',
    rotation_id: '',
    start_date: '',
    offset: '0',
  });

  const { data: rotationsData, isLoading: loading } = useApiQuery<ListResponse<RotationPattern> & RotationPattern[]>(
    queryKeys.dutyRoster.rotations(),
    '/api/hr/roster/rotations',
  );

  const rotations: RotationPattern[] = useMemo(
    () => (rotationsData as ListResponse<RotationPattern>)?.data || (rotationsData as RotationPattern[]) || [],
    [rotationsData],
  );

  useEffect(() => {
    setDayRows(
      Array.from({ length: cycleDays }, (_, i) => ({
        day_number: i + 1,
        shift_id: '',
        is_day_off: false,
      })),
    );
  }, [cycleDays]);

  const createRotationMutation = useApiMutation<unknown, {
    patternName: string;
    cycleDays: number;
    days: Array<{ dayNumber: number; shiftId: number | null; isOff: boolean }>;
    idempotencyKey: string;
  }>(
    'post',
    '/api/hr/roster/rotation',
    {
      onSuccess: () => {
        toast.success(t('toast.rotationCreated'));
        setShowCreate(false);
        setPatternName('');
        setCycleDays(7);
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: () => toast.error(t('toast.failedCreateRotation')),
    },
  );

  const assignStaffMutation = useApiMutation<unknown, {
    staffId: number;
    patternId: number;
    startDate: string;
    cycleOffset: number;
    idempotencyKey: string;
  }>(
    'post',
    '/api/hr/roster/rotation/assign',
    {
      onSuccess: () => {
        toast.success(t('toast.staffAssignedRotation'));
        setShowAssignStaff(false);
        setAssignStaffForm({ staff_id: '', rotation_id: '', start_date: '', offset: '0' });
      },
      onError: () => toast.error(t('toast.failedAssignStaff')),
    },
  );

  const saving = createRotationMutation.isPending || assignStaffMutation.isPending;

  const updateDayRow = (idx: number, field: string, value: string | boolean) => {
    setDayRows((prev) =>
      prev.map((r, i) =>
        i === idx
          ? {
              ...r,
              [field]: value,
              ...(field === 'is_day_off' && value === true ? { shift_id: '' } : {}),
            }
          : r,
      ),
    );
  };

  const handleCreateRotation = () => {
    if (!patternName.trim()) {
      toast.error(t('toast.patternNameRequired'));
      return;
    }
    createRotationMutation.mutate({
      patternName,
      cycleDays,
      days: dayRows.map((r) => ({
        dayNumber: r.day_number,
        shiftId: r.is_day_off ? null : Number(r.shift_id) || null,
        isOff: r.is_day_off,
      })),
      idempotencyKey: `rotation:create:${patternName.trim().toLowerCase().replace(/\s+/g, '-')}:${cycleDays}`,
    });
  };

  const handleAssignStaff = () => {
    const { staff_id, rotation_id, start_date } = assignStaffForm;
    if (!staff_id || !rotation_id || !start_date) {
      toast.error(t('toast.allFieldsRequired'));
      return;
    }
    assignStaffMutation.mutate({
      staffId: Number(staff_id),
      patternId: Number(rotation_id),
      startDate: start_date,
      cycleOffset: Number(assignStaffForm.offset) || 0,
      idempotencyKey: `rotation:assign:${staff_id}:${rotation_id}:${start_date}`,
    });
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">
          {t('rotations.rotationPattern', { count: rotations.length })}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAssignStaff(true)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Users className="w-4 h-4" /> {t('rotations.assignStaff')}
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> {t('rotations.newRotation')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-[var(--color-text-muted)]">{t('rotations.loadingRotations')}</div>
      ) : rotations.length === 0 ? (
        <div className="card p-8 text-center text-[var(--color-text-muted)]">
          {t('rotations.noRotations')}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rotations.map((rot) => (
            <div key={rot.patternId} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-[var(--color-text)]">{rot.patternName}</h4>
                <span className="badge-neutral text-xs">{t('rotations.dayCycle', { count: rot.cycleDays })}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(rot.days || []).map((d) => (
                  <span
                    key={d.dayNumber}
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      d.isOff
                        ? 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
                        : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
                    }`}
                  >
                    {t('rotations.day')} {d.dayNumber}: {d.isOff ? t('rotations.dayOff') : d.shiftName || `${t('roster.shift')} ${d.shiftId}`}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title={t('rotations.newRotationPattern')} onClose={() => setShowCreate(false)} wide>
          <div>
            <label className="label">{t('rotations.patternName')}</label>
            <input
              className="input"
              placeholder={t('rotations.patternNamePlaceholder')}
              value={patternName}
              onChange={(e) => setPatternName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('rotations.cycleDays')}</label>
            <input
              type="number"
              className="input"
              min={1}
              max={90}
              value={cycleDays}
              onChange={(e) => setCycleDays(Math.max(1, Math.min(90, Number(e.target.value))))}
            />
          </div>
          <div>
            <label className="label mb-2">{t('rotations.dailySchedule')}</label>
            <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">{t('rotations.day')}</th>
                    <th className="p-2 text-left">{t('roster.shift')}</th>
                    <th className="p-2 text-center">{t('rotations.dayOffLabel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((row, idx) => (
                    <tr key={idx} className="border-t border-[var(--color-border)]">
                      <td className="p-2 font-medium">{t('rotations.day')} {row.day_number}</td>
                      <td className="p-2">
                        <select
                          className="input py-1.5 text-sm"
                          value={row.shift_id}
                          disabled={row.is_day_off}
                          onChange={(e) => updateDayRow(idx, 'shift_id', e.target.value)}
                        >
                          <option value="">{t('roster.selectShift')}</option>
                          {shifts.map((sh) => (
                            <option key={sh.id} value={sh.id}>
                              {sh.shift_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={row.is_day_off}
                          onChange={(e) => updateDayRow(idx, 'is_day_off', e.target.checked)}
                          className="rounded border-[var(--color-border)]"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <button onClick={handleCreateRotation} disabled={saving} className="btn-primary w-full">
            {saving ? t('rotations.creating') : t('rotations.createRotation')}
          </button>
        </Modal>
      )}

      {showAssignStaff && (
        <Modal title={t('rotations.assignStaffToRotation')} onClose={() => setShowAssignStaff(false)}>
          <div>
            <label className="label">{t('roster.staff')}</label>
            <select
              className="input"
              value={assignStaffForm.staff_id}
              onChange={(e) => setAssignStaffForm((p) => ({ ...p, staff_id: e.target.value }))}
            >
              <option value="">{t('roster.selectStaff')}</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('rotations.rotationPattern')}</label>
            <select
              className="input"
              value={assignStaffForm.rotation_id}
              onChange={(e) => setAssignStaffForm((p) => ({ ...p, rotation_id: e.target.value }))}
            >
              <option value="">{t('rotations.selectPattern')}</option>
              {rotations.map((r) => (
                <option key={r.patternId} value={r.patternId}>
                  {r.patternName} ({t('rotations.dayCycle', { count: r.cycleDays })})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('rotations.startDate')}</label>
              <input
                type="date"
                className="input"
                value={assignStaffForm.start_date}
                onChange={(e) => setAssignStaffForm((p) => ({ ...p, start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('rotations.offsetDays')}</label>
              <input
                type="number"
                className="input"
                min={0}
                value={assignStaffForm.offset}
                onChange={(e) => setAssignStaffForm((p) => ({ ...p, offset: e.target.value }))}
              />
            </div>
          </div>
          <button onClick={handleAssignStaff} disabled={saving} className="btn-primary w-full">
            {saving ? t('rotations.assigning') : t('rotations.assignToRotation')}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOLIDAYS TAB
// ═══════════════════════════════════════════════════════════════════════════

function HolidaysTab() {
  const { t } = useTranslation(['duty-roster', 'common']);
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', type: 'public' as Holiday['type'] });

  const { data: holidaysData, isLoading: loading } = useApiQuery<ListResponse<Holiday> & Holiday[]>(
    queryKeys.dutyRoster.holidays(),
    '/api/hr/roster/holidays',
  );

  const holidays: Holiday[] = useMemo(
    () => (holidaysData as ListResponse<Holiday>)?.data || (holidaysData as Holiday[]) || [],
    [holidaysData],
  );

  const addMutation = useApiMutation<unknown, { holidayName: string; holidayDate: string; holidayType: Holiday['type'] }>(
    'post',
    '/api/hr/roster/holidays',
    {
      onSuccess: () => {
        toast.success(t('toast.holidayAdded'));
        setShowModal(false);
        setForm({ name: '', date: '', type: 'public' });
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: () => toast.error(t('toast.failedAddHoliday')),
    },
  );

  const deleteMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/hr/roster/holidays/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('toast.holidayRemoved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: () => toast.error(t('toast.failedDeleteHoliday')),
    },
  );

  const saving = addMutation.isPending;

  const handleAdd = () => {
    if (!form.name.trim() || !form.date) {
      toast.error(t('toast.nameDateRequired'));
      return;
    }
    addMutation.mutate({
      holidayName: form.name,
      holidayDate: form.date,
      holidayType: form.type,
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id });
  };

  const typeBadge: Record<Holiday['type'], string> = {
    public: 'badge-success',
    optional: 'badge-warning',
    restricted: 'badge-neutral',
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">
          {t('holidays.holiday', { count: holidays.length })}
        </p>
        <button onClick={() => setShowModal(true)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> {t('holidays.addHoliday')}
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base w-full">
          <thead>
            <tr>
              <th className="text-left p-3">{t('holidays.holidayName')}</th>
              <th className="text-left p-3">{t('roster.date')}</th>
              <th className="text-left p-3">{t('holidays.type')}</th>
              <th className="text-right p-3">{t('common:actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="text-center p-8 text-[var(--color-text-muted)]">
                  {t('holidays.loadingHolidays')}
                </td>
              </tr>
            ) : holidays.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center p-8 text-[var(--color-text-muted)]">
                  {t('holidays.noHolidays')}
                </td>
              </tr>
            ) : (
              holidays.map((h) => (
                <tr key={h.holidayId} className="border-t border-[var(--color-border)]">
                  <td className="p-3 font-medium text-[var(--color-text)]">{h.name}</td>
                  <td className="p-3 text-sm text-[var(--color-text-muted)]">
                    {fmtFull(h.date)}
                  </td>
                  <td className="p-3">
                    <span className={`${typeBadge[h.type] ?? 'badge-neutral'} text-xs capitalize`}>
                      {t(`holidays.${h.type}`)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDelete(h.holidayId)} className="btn-ghost p-1.5 text-red-500 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={t('holidays.addHolidayTitle')} onClose={() => setShowModal(false)}>
          <div>
            <label className="label">{t('holidays.holidayName')}</label>
            <input
              className="input"
              placeholder={t('holidays.holidayNamePlaceholder')}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">{t('roster.date')}</label>
            <input
              type="date"
              className="input"
              value={form.date}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">{t('holidays.type')}</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as Holiday['type'] }))}
            >
              <option value="public">{t('holidays.public')}</option>
              <option value="optional">{t('holidays.optional')}</option>
              <option value="restricted">{t('holidays.restricted')}</option>
            </select>
          </div>
          <button onClick={handleAdd} disabled={saving} className="btn-primary w-full">
            {saving ? t('holidays.saving') : t('holidays.addHolidayButton')}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERTIME RULES TAB
// ═══════════════════════════════════════════════════════════════════════════

function OvertimeRulesTab() {
  const { t } = useTranslation('duty-roster');
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    rule_name: '',
    multiplier: '1.5',
    min_hours: '8',
    max_ot_per_day: '4',
    applies_on: 'weekday' as OvertimeRule['appliesOn'],
  });

  const { data: rulesData, isLoading: loading } = useApiQuery<ListResponse<OvertimeRule> & OvertimeRule[]>(
    queryKeys.dutyRoster.overtimeRules(),
    '/api/hr/biometric/overtime/rules',
  );

  const rules: OvertimeRule[] = useMemo(
    () => (rulesData as ListResponse<OvertimeRule>)?.data || (rulesData as OvertimeRule[]) || [],
    [rulesData],
  );

  const addMutation = useApiMutation<unknown, {
    ruleName: string;
    multiplier: number;
    minHoursBeforeOt: number;
    maxOtHoursPerDay: number;
    appliesOn: OvertimeRule['appliesOn'];
  }>(
    'post',
    '/api/hr/biometric/overtime/rules',
    {
      onSuccess: () => {
        toast.success(t('toast.overtimeCreated'));
        setShowModal(false);
        setForm({ rule_name: '', multiplier: '1.5', min_hours: '8', max_ot_per_day: '4', applies_on: 'weekday' });
        queryClient.invalidateQueries({ queryKey: queryKeys.dutyRoster.all });
      },
      onError: () => toast.error(t('toast.failedCreateRule')),
    },
  );

  const saving = addMutation.isPending;

  const handleAdd = () => {
    if (!form.rule_name.trim()) {
      toast.error(t('toast.ruleNameRequired'));
      return;
    }
    addMutation.mutate({
      ruleName: form.rule_name,
      multiplier: parseFloat(form.multiplier),
      minHoursBeforeOt: parseFloat(form.min_hours),
      maxOtHoursPerDay: parseFloat(form.max_ot_per_day),
      appliesOn: form.applies_on,
    });
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">
          {t('overtime.rule', { count: rules.length })}
        </p>
        <button onClick={() => setShowModal(true)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> {t('overtime.addRule')}
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base w-full">
          <thead>
            <tr>
              <th className="text-left p-3">{t('overtime.ruleName')}</th>
              <th className="text-center p-3">{t('overtime.multiplier')}</th>
              <th className="text-center p-3">{t('overtime.minHours')}</th>
              <th className="text-center p-3">{t('overtime.maxOtPerDay')}</th>
              <th className="text-left p-3">{t('overtime.appliesOn')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center p-8 text-[var(--color-text-muted)]">
                  {t('overtime.loadingRules')}
                </td>
              </tr>
            ) : rules.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center p-8 text-[var(--color-text-muted)]">
                  {t('overtime.noRules')}
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.ruleId} className="border-t border-[var(--color-border)]">
                  <td className="p-3 font-medium text-[var(--color-text)]">{r.ruleName}</td>
                  <td className="p-3 text-center">
                    <span className="badge-warning text-xs">{r.multiplier}x</span>
                  </td>
                  <td className="p-3 text-center text-sm">{r.minHoursBeforeOvertime}h</td>
                  <td className="p-3 text-center text-sm">{r.maxOvertimeHoursPerDay}h</td>
                  <td className="p-3">
                    <span className="badge-neutral text-xs capitalize">
                      {t(`overtime.${r.appliesOn}`)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={t('overtime.addRuleTitle')} onClose={() => setShowModal(false)}>
          <div>
            <label className="label">{t('overtime.ruleName')}</label>
            <input
              className="input"
              placeholder={t('overtime.ruleNamePlaceholder')}
              value={form.rule_name}
              onChange={(e) => setForm((p) => ({ ...p, rule_name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('overtime.multiplier')}</label>
              <input
                type="number"
                step="0.25"
                min="1"
                className="input"
                value={form.multiplier}
                onChange={(e) => setForm((p) => ({ ...p, multiplier: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('overtime.minHours')}</label>
              <input
                type="number"
                step="0.5"
                min="0"
                className="input"
                value={form.min_hours}
                onChange={(e) => setForm((p) => ({ ...p, min_hours: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('overtime.maxOtPerDay')}</label>
              <input
                type="number"
                step="0.5"
                min="0"
                className="input"
                value={form.max_ot_per_day}
                onChange={(e) => setForm((p) => ({ ...p, max_ot_per_day: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('overtime.appliesOn')}</label>
              <select
                className="input"
                value={form.applies_on}
                onChange={(e) => setForm((p) => ({ ...p, applies_on: e.target.value as OvertimeRule['appliesOn'] }))}
              >
                <option value="weekday">{t('overtime.weekdays')}</option>
                <option value="weekend">{t('overtime.weekends')}</option>
                <option value="holiday">{t('overtime.holidays')}</option>
                <option value="all">{t('overtime.allDays')}</option>
              </select>
            </div>
          </div>
          <button onClick={handleAdd} disabled={saving} className="btn-primary w-full">
            {saving ? t('overtime.saving') : t('overtime.addRuleButton')}
          </button>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

type TabKey = 'roster' | 'rotations' | 'holidays' | 'overtime';

export default function DutyRoster({ role }: { role?: string }) {
  const { t } = useTranslation('duty-roster');
  const [activeTab, setActiveTab] = useState<TabKey>('roster');

  const { data: staffData } = useApiQuery<{ data?: Staff[] } & Staff[]>(
    queryKeys.staff.list(),
    '/api/staff',
  );

  const { data: shiftsData } = useApiQuery<{ data?: Shift[] } & Shift[]>(
    queryKeys.hr.shifts(),
    '/api/hr/attendance/shifts',
  );

  const staffList: Staff[] = useMemo(
    () => (staffData as { data?: Staff[] })?.data || (staffData as { staff?: Staff[] })?.staff || (staffData as Staff[]) || [],
    [staffData],
  );

  const shifts: Shift[] = useMemo(
    () => (shiftsData as { data?: Shift[] })?.data || (shiftsData as Shift[]) || [],
    [shiftsData],
  );

  const tabDefs = useMemo(
    () => [
      { key: 'roster' as const, label: t('tabs.roster'), icon: CalendarDays },
      { key: 'rotations' as const, label: t('tabs.rotations'), icon: RotateCcw },
      { key: 'holidays' as const, label: t('tabs.holidays'), icon: Umbrella },
      { key: 'overtime' as const, label: t('tabs.overtime'), icon: Clock },
    ],
    [t],
  );

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-6">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-[var(--color-border)] overflow-x-auto">
          {tabDefs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'roster' && <RosterGridTab staffList={staffList} shifts={shifts} />}
        {activeTab === 'rotations' && <RotationsTab staffList={staffList} shifts={shifts} />}
        {activeTab === 'holidays' && <HolidaysTab />}
        {activeTab === 'overtime' && <OvertimeRulesTab />}
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, RefreshCw,
  RotateCcw, Layers, Umbrella, Clock, Trash2, Users, Download,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

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
  id: number;
  staff_id: number;
  staff_name: string;
  shift_id: number;
  shift_name: string;
  short_code?: string;
  color?: string;
  date: string;
}

interface RotationPattern {
  id: number;
  pattern_name: string;
  cycle_days: number;
  days: RotationDay[];
}

interface RotationDay {
  day_number: number;
  shift_id: number | null;
  shift_name?: string;
  is_day_off: boolean;
}

interface Holiday {
  id: number;
  name: string;
  date: string;
  type: 'public' | 'optional' | 'restricted';
}

interface OvertimeRule {
  id: number;
  rule_name: string;
  multiplier: number;
  min_hours: number;
  max_ot_per_day: number;
  applies_on: string;
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Reusable Modal ────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div
        className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${
          wide ? 'max-w-2xl' : 'max-w-lg'
        } max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold text-[var(--color-text)]">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROSTER TAB
// ═══════════════════════════════════════════════════════════════════════════

function RosterTab({
  staffList,
  shifts,
}: {
  staffList: Staff[];
  shifts: Shift[];
}) {
  const { t } = useTranslation('duty-roster');
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [assignments, setAssignments] = useState<RosterAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  // Modals
  const [showAssign, setShowAssign] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  // Single assign form
  const [assignForm, setAssignForm] = useState({
    staff_id: '',
    shift_id: '',
    date: '',
    existing_id: '',
  });

  // Bulk form
  const [bulkForm, setBulkForm] = useState({
    staff_ids: [] as number[],
    shift_id: '',
    from_date: '',
    to_date: '',
  });

  // Generate form
  const [genDate, setGenDate] = useState({ from: '', to: '' });
  const [saving, setSaving] = useState(false);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const fetchRoster = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/hr/roster', {
        params: { from: fmtDate(weekStart), to: fmtDate(weekEnd) },
        headers: authHeader(),
      });
      setAssignments(res.data.data || res.data || []);
    } catch {
      toast.error(t('toast.failedLoadRoster'));
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const prevWeek = () => setWeekStart(addDays(weekStart, -7));
  const nextWeek = () => setWeekStart(addDays(weekStart, 7));
  const goToday = () => setWeekStart(getMonday(new Date()));

  // Build lookup: staffId-date -> assignment
  const rosterMap = useMemo(() => {
    const map: Record<string, RosterAssignment> = {};
    assignments.forEach((a) => {
      map[`${a.staff_id}-${a.date?.slice(0, 10)}`] = a;
    });
    return map;
  }, [assignments]);

  const openCell = (staffId: number, date: Date, existing?: RosterAssignment) => {
    setAssignForm({
      staff_id: String(staffId),
      shift_id: existing ? String(existing.shift_id) : '',
      date: fmtDate(date),
      existing_id: existing ? String(existing.id) : '',
    });
    setShowAssign(true);
  };

  const handleAssign = async () => {
    if (!assignForm.staff_id || !assignForm.shift_id || !assignForm.date) {
      toast.error(t('toast.allFieldsRequired'));
      return;
    }
    setSaving(true);
    try {
      await axios.post(
        '/api/hr/roster',
        {
          staff_id: Number(assignForm.staff_id),
          shift_id: Number(assignForm.shift_id),
          date: assignForm.date,
        },
        { headers: authHeader() },
      );
      toast.success(t('toast.shiftAssigned'));
      setShowAssign(false);
      fetchRoster();
    } catch {
      toast.error(t('toast.failedAssignShift'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!assignForm.existing_id) return;
    setSaving(true);
    try {
      await axios.delete(`/api/hr/roster/${assignForm.existing_id}`, {
        headers: authHeader(),
      });
      toast.success(t('toast.assignmentRemoved'));
      setShowAssign(false);
      fetchRoster();
    } catch {
      toast.error(t('toast.failedRemoveAssignment'));
    } finally {
      setSaving(false);
    }
  };

  const handleBulk = async () => {
    if (!bulkForm.staff_ids.length || !bulkForm.shift_id || !bulkForm.from_date || !bulkForm.to_date) {
      toast.error(t('toast.allFieldsRequired'));
      return;
    }
    setSaving(true);
    try {
      await axios.post('/api/hr/roster/bulk', bulkForm, { headers: authHeader() });
      toast.success(t('toast.bulkAssignmentDone'));
      setShowBulk(false);
      setBulkForm({ staff_ids: [], shift_id: '', from_date: '', to_date: '' });
      fetchRoster();
    } catch {
      toast.error(t('toast.bulkAssignmentFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!genDate.from || !genDate.to) {
      toast.error(t('toast.selectDateRange'));
      return;
    }
    setSaving(true);
    try {
      await axios.post('/api/hr/roster/generate', genDate, { headers: authHeader() });
      toast.success(t('toast.rosterGenerated'));
      setShowGenerate(false);
      fetchRoster();
    } catch {
      toast.error(t('toast.generationFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleBulkStaff = (id: number) => {
    setBulkForm((prev) => ({
      ...prev,
      staff_ids: prev.staff_ids.includes(id)
        ? prev.staff_ids.filter((x) => x !== id)
        : [...prev.staff_ids, id],
    }));
  };

  const isToday = (d: Date) => fmtDate(d) === fmtDate(new Date());

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Week navigation bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="btn-ghost p-2">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={goToday} className="btn-secondary text-sm px-3 py-1.5">
            {t('roster.thisWeek')}
          </button>
          <button onClick={nextWeek} className="btn-ghost p-2">
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-[var(--color-text)]">
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

      {/* Calendar grid */}
      <div className="card overflow-x-auto">
        <table className="table-base w-full min-w-[800px]">
          <thead>
            <tr>
              <th className="text-left p-3 w-48 sticky left-0 bg-[var(--color-bg-secondary)] z-10">Staff</th>
              {weekDays.map((d, i) => (
                <th
                  key={i}
                  className={`text-center p-3 ${isToday(d) ? 'bg-cyan-50 dark:bg-cyan-900/20' : ''}`}
                >
                  <div className="text-xs text-[var(--color-text-muted)]">{DAY_LABELS[i]}</div>
                  <div className={`text-sm font-semibold ${isToday(d) ? 'text-[var(--color-primary)]' : ''}`}>
                    {d.getDate()}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center p-8 text-[var(--color-text-muted)]">
                  {t('roster.loadingRoster')}
                </td>
              </tr>
            ) : staffList.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center p-8 text-[var(--color-text-muted)]">
                  {t('roster.noStaffFound')}
                </td>
              </tr>
            ) : (
              staffList.map((s) => (
                <tr key={s.id} className="border-t border-[var(--color-border)]">
                  <td className="p-3 sticky left-0 bg-white dark:bg-slate-800 z-10">
                    <div className="font-medium text-sm text-[var(--color-text)]">{s.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{s.position}</div>
                  </td>
                  {weekDays.map((d, di) => {
                    const key = `${s.id}-${fmtDate(d)}`;
                    const assignment = rosterMap[key];
                    return (
                      <td
                        key={di}
                        className={`text-center p-2 cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors ${
                          isToday(d) ? 'bg-cyan-50/50 dark:bg-cyan-900/10' : ''
                        }`}
                        onClick={() => openCell(s.id, d, assignment)}
                      >
                        {assignment ? (
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white"
                            style={{
                              backgroundColor: assignment.color || '#64748b',
                            }}
                          >
                            {assignment.short_code || assignment.shift_name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors">
                            <Plus className="w-3 h-3" />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Single Assign / Edit Modal */}
      {showAssign && (
        <Modal title={assignForm.existing_id ? t('roster.editAssignment') : t('roster.assignShift')} onClose={() => setShowAssign(false)}>
          <div>
            <label className="label">{t('roster.staff')}</label>
            <select
              className="input"
              value={assignForm.staff_id}
              onChange={(e) => setAssignForm((p) => ({ ...p, staff_id: e.target.value }))}
            >
              <option value="">{t('roster.selectStaff')}</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('roster.date')}</label>
            <input
              type="date"
              className="input"
              value={assignForm.date}
              onChange={(e) => setAssignForm((p) => ({ ...p, date: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">{t('roster.shift')}</label>
            <select
              className="input"
              value={assignForm.shift_id}
              onChange={(e) => setAssignForm((p) => ({ ...p, shift_id: e.target.value }))}
            >
              <option value="">{t('roster.selectShift')}</option>
              {shifts.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.shift_name} ({sh.start_time} - {sh.end_time})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button onClick={handleAssign} disabled={saving} className="btn-primary flex-1">
              {saving ? t('roster.saving') : t('roster.save')}
            </button>
            {assignForm.existing_id && (
              <button onClick={handleDelete} disabled={saving} className="btn-ghost text-red-600 px-4 py-2">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
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
          <button onClick={handleBulk} disabled={saving} className="btn-primary w-full">
            {saving ? t('roster.assigning') : t('roster.bulkAssignButton')}
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
          <button onClick={handleGenerate} disabled={saving} className="btn-primary w-full">
            {saving ? t('roster.generating') : t('roster.generateRoster')}
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
  const { t } = useTranslation('duty-roster');
  const [rotations, setRotations] = useState<RotationPattern[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssignStaff, setShowAssignStaff] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create form
  const [patternName, setPatternName] = useState('');
  const [cycleDays, setCycleDays] = useState(7);
  const [dayRows, setDayRows] = useState<{ day_number: number; shift_id: string; is_day_off: boolean }[]>([]);

  // Assign form
  const [assignStaffForm, setAssignStaffForm] = useState({
    staff_id: '',
    rotation_id: '',
    start_date: '',
    offset: '0',
  });

  const fetchRotations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/hr/roster/rotations', { headers: authHeader() });
      setRotations(res.data.data || res.data || []);
    } catch {
      toast.error(t('toast.failedLoadRotations'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRotations();
  }, [fetchRotations]);

  // Rebuild day rows when cycleDays changes
  useEffect(() => {
    setDayRows(
      Array.from({ length: cycleDays }, (_, i) => ({
        day_number: i + 1,
        shift_id: '',
        is_day_off: false,
      })),
    );
  }, [cycleDays]);

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

  const handleCreateRotation = async () => {
    if (!patternName.trim()) {
      toast.error(t('toast.patternNameRequired'));
      return;
    }
    setSaving(true);
    try {
      await axios.post(
        '/api/hr/roster/rotation',
        {
          pattern_name: patternName,
          cycle_days: cycleDays,
          days: dayRows.map((r) => ({
            day_number: r.day_number,
            shift_id: r.is_day_off ? null : Number(r.shift_id) || null,
            is_day_off: r.is_day_off,
          })),
        },
        { headers: authHeader() },
      );
      toast.success(t('toast.rotationCreated'));
      setShowCreate(false);
      setPatternName('');
      setCycleDays(7);
      fetchRotations();
    } catch {
      toast.error(t('toast.failedCreateRotation'));
    } finally {
      setSaving(false);
    }
  };

  const handleAssignStaff = async () => {
    const { staff_id, rotation_id, start_date } = assignStaffForm;
    if (!staff_id || !rotation_id || !start_date) {
      toast.error(t('toast.allFieldsRequired'));
      return;
    }
    setSaving(true);
    try {
      await axios.post(
        '/api/hr/roster/rotation/assign',
        {
          staff_id: Number(staff_id),
          rotation_id: Number(rotation_id),
          start_date,
          offset: Number(assignStaffForm.offset) || 0,
        },
        { headers: authHeader() },
      );
      toast.success(t('toast.staffAssignedRotation'));
      setShowAssignStaff(false);
      setAssignStaffForm({ staff_id: '', rotation_id: '', start_date: '', offset: '0' });
    } catch {
      toast.error(t('toast.failedAssignStaff'));
    } finally {
      setSaving(false);
    }
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
            <div key={rot.id} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-[var(--color-text)]">{rot.pattern_name}</h4>
                <span className="badge-neutral text-xs">{t('rotations.dayCycle', { count: rot.cycle_days })}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(rot.days || []).map((d) => (
                  <span
                    key={d.day_number}
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      d.is_day_off
                        ? 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
                        : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
                    }`}
                  >
                    D{d.day_number}: {d.is_day_off ? t('rotations.dayOff') : d.shift_name || `Shift ${d.shift_id}`}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Rotation Modal */}
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

      {/* Assign Staff Modal */}
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
                <option key={r.id} value={r.id}>
                  {r.pattern_name} ({r.cycle_days}-day cycle)
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
  const { t } = useTranslation('duty-roster');
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', type: 'public' as Holiday['type'] });

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/hr/roster/holidays', { headers: authHeader() });
      setHolidays(res.data.data || res.data || []);
    } catch {
      toast.error(t('toast.failedLoadHolidays'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.date) {
      toast.error(t('toast.nameDateRequired'));
      return;
    }
    setSaving(true);
    try {
      await axios.post('/api/hr/roster/holidays', form, { headers: authHeader() });
      toast.success(t('toast.holidayAdded'));
      setShowModal(false);
      setForm({ name: '', date: '', type: 'public' });
      fetchHolidays();
    } catch {
      toast.error(t('toast.failedAddHoliday'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`/api/hr/roster/holidays/${id}`, { headers: authHeader() });
      toast.success(t('toast.holidayRemoved'));
      fetchHolidays();
    } catch {
      toast.error(t('toast.failedDeleteHoliday'));
    }
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
              <th className="text-right p-3">Actions</th>
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
                <tr key={h.id} className="border-t border-[var(--color-border)]">
                  <td className="p-3 font-medium text-[var(--color-text)]">{h.name}</td>
                  <td className="p-3 text-sm text-[var(--color-text-muted)]">
                    {new Date(h.date).toLocaleDateString('en-US', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  <td className="p-3">
                    <span className={`${typeBadge[h.type] ?? 'badge-neutral'} text-xs capitalize`}>
                      {t(`holidays.${h.type}`)}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDelete(h.id)} className="btn-ghost p-1.5 text-red-500 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Holiday Modal */}
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
  const [rules, setRules] = useState<OvertimeRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    rule_name: '',
    multiplier: '1.5',
    min_hours: '8',
    max_ot_per_day: '4',
    applies_on: 'weekdays',
  });

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/hr/biometric/overtime/rules', { headers: authHeader() });
      setRules(res.data.data || res.data || []);
    } catch {
      toast.error(t('toast.failedLoadOvertime'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleAdd = async () => {
    if (!form.rule_name.trim()) {
      toast.error(t('toast.ruleNameRequired'));
      return;
    }
    setSaving(true);
    try {
      await axios.post(
        '/api/hr/biometric/overtime/rules',
        {
          rule_name: form.rule_name,
          multiplier: parseFloat(form.multiplier),
          min_hours: parseFloat(form.min_hours),
          max_ot_per_day: parseFloat(form.max_ot_per_day),
          applies_on: form.applies_on,
        },
        { headers: authHeader() },
      );
      toast.success(t('toast.overtimeCreated'));
      setShowModal(false);
      setForm({ rule_name: '', multiplier: '1.5', min_hours: '8', max_ot_per_day: '4', applies_on: 'weekdays' });
      fetchRules();
    } catch {
      toast.error(t('toast.failedCreateRule'));
    } finally {
      setSaving(false);
    }
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
                <tr key={r.id} className="border-t border-[var(--color-border)]">
                  <td className="p-3 font-medium text-[var(--color-text)]">{r.rule_name}</td>
                  <td className="p-3 text-center">
                    <span className="badge-warning text-xs">{r.multiplier}x</span>
                  </td>
                  <td className="p-3 text-center text-sm">{r.min_hours}h</td>
                  <td className="p-3 text-center text-sm">{r.max_ot_per_day}h</td>
                  <td className="p-3">
                    <span className="badge-neutral text-xs capitalize">{r.applies_on}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add OT Rule Modal */}
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
                onChange={(e) => setForm((p) => ({ ...p, applies_on: e.target.value }))}
              >
                <option value="weekdays">{t('overtime.weekdays')}</option>
                <option value="weekends">{t('overtime.weekends')}</option>
                <option value="holidays">{t('overtime.holidays')}</option>
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
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const tabDefs = useMemo(
    () => [
      { key: 'roster' as const, label: t('tabs.roster'), icon: CalendarDays },
      { key: 'rotations' as const, label: t('tabs.rotations'), icon: RotateCcw },
      { key: 'holidays' as const, label: t('tabs.holidays'), icon: Umbrella },
      { key: 'overtime' as const, label: t('tabs.overtime'), icon: Clock },
    ],
    [t],
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [staffRes, shiftRes] = await Promise.all([
          axios.get('/api/staff', { headers: authHeader() }),
          axios.get('/api/hr/attendance/shifts', { headers: authHeader() }),
        ]);
        setStaffList(staffRes.data.data || staffRes.data || []);
        setShifts(shiftRes.data.data || shiftRes.data || []);
      } catch {
        toast.error(t('toast.failedLoadStaffOrShifts'));
      }
    };
    load();
  }, []);

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-6">
        {/* Page header */}
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

        {/* Tab bar */}
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

        {/* Tab content */}
        {activeTab === 'roster' && <RosterTab staffList={staffList} shifts={shifts} />}
        {activeTab === 'rotations' && <RotationsTab staffList={staffList} shifts={shifts} />}
        {activeTab === 'holidays' && <HolidaysTab />}
        {activeTab === 'overtime' && <OvertimeRulesTab />}
      </div>
    </DashboardLayout>
  );
}

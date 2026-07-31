import { useState, useMemo, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  ClipboardList, ChevronRight, RefreshCw, Pill, Heart, FlaskConical,
  Droplets, Stethoscope, CheckCircle, Clock, AlertTriangle, ArrowRight,
  ChevronDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { apiFetch } from '../lib/apiClient';
import toast from 'react-hot-toast';

// ─── Types ───────────────────────────────────────────────────────────────────

type TaskType = 'medication' | 'vitals' | 'sample' | 'iv_fluid' | 'doctor_order';
type TaskStatus = 'due' | 'overdue' | 'in_progress' | 'done';
type Priority = 'critical' | 'due_now' | 'upcoming' | 'completed';

interface NurseTask {
  id: string;
  patient_id: number;
  patient_name: string;
  bed_number: string;
  ward_name?: string;
  task_type: TaskType;
  title: string;
  description?: string;
  scheduled_time: string;
  status: TaskStatus;
  priority: Priority;
  source_id?: number;
  source_table?: string;
}

interface DashboardData {
  beds: Array<{
    patient_id?: number;
    patient_name?: string;
    bed_number: string;
    ward_name?: string;
    statusColor?: string;
    latestVitals?: Record<string, unknown>;
  }>;
}

interface MAREntry {
  id: number;
  patient_id: number;
  medication_name: string;
  dose?: string;
  route?: string;
  scheduled_time?: string;
  status?: string;
  patient_name?: string;
  bed_number?: string;
  ward_name?: string;
}

interface MedicationOrder {
  id: number;
  patient_id: number;
  medication_name: string;
  dose?: string;
  route?: string;
  frequency?: string;
  status?: string;
  priority?: string;
  patient_name?: string;
  bed_number?: string;
}

interface MARData {
  Results?: MAREntry[];
}

interface MedOrderData {
  Results?: MedicationOrder[];
}

interface AlertData {
  alerts: Array<{
    id?: number;
    patient_id?: number;
    patient_name?: string;
    vital_type?: string;
    recorded_value?: string;
    threshold_min?: string;
    threshold_max?: string;
    bed_number?: string;
    ward_name?: string;
  }>;
}

interface MedDueData {
  summary: {
    overdue: number;
    upcoming: number;
    total: number;
  };
  items?: Array<{
    id: number;
    patient_id: number;
    patient_name?: string;
    bed_number?: string;
    medication_name: string;
    scheduled_time: string;
    status?: string;
  }>;
}

// ─── Task type icons ─────────────────────────────────────────────────────────

const taskTypeIcons: Record<TaskType, React.ReactNode> = {
  medication: <Pill className="w-4 h-4" />,
  vitals: <Heart className="w-4 h-4" />,
  sample: <FlaskConical className="w-4 h-4" />,
  iv_fluid: <Droplets className="w-4 h-4" />,
  doctor_order: <Stethoscope className="w-4 h-4" />,
};

const taskTypeColors: Record<TaskType, string> = {
  medication: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20',
  vitals: 'text-red-600 bg-red-50 dark:bg-red-900/20',
  sample: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
  iv_fluid: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-900/20',
  doctor_order: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
};

const priorityConfig: Record<Priority, { label: string; color: string; bg: string; border: string }> = {
  critical: {
    label: 'Critical',
    color: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-900/10',
    border: 'border-red-200 dark:border-red-800',
  },
  due_now: {
    label: 'Due Now',
    color: 'text-orange-700 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-900/10',
    border: 'border-orange-200 dark:border-orange-800',
  },
  upcoming: {
    label: 'Upcoming',
    color: 'text-blue-700 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/10',
    border: 'border-blue-200 dark:border-blue-800',
  },
  completed: {
    label: 'Completed Today',
    color: 'text-slate-600 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-800/50',
    border: 'border-slate-200 dark:border-slate-700',
  },
};

const statusConfig: Record<TaskStatus, { label: string; color: string; icon: React.ReactNode }> = {
  due: {
    label: 'Due',
    color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30',
    icon: <Clock className="w-3 h-3" />,
  },
  overdue: {
    label: 'Overdue',
    color: 'text-red-600 bg-red-100 dark:bg-red-900/30',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
    icon: <RefreshCw className="w-3 h-3" />,
  },
  done: {
    label: 'Done',
    color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30',
    icon: <CheckCircle className="w-3 h-3" />,
  },
};

// ─── Helper functions ────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMinutesUntil(dateStr: string): number {
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 60000);
}

function determinePriority(
  scheduledTime: string,
  status: string | undefined,
  isCritical: boolean,
): Priority {
  if (status === 'given' || status === 'done' || status === 'completed') {
    return 'completed';
  }
  if (isCritical) return 'critical';

  const minutesUntil = getMinutesUntil(scheduledTime);
  if (minutesUntil <= 0) return 'due_now';
  if (minutesUntil <= 30) return 'upcoming';
  return 'upcoming';
}

function mapMARStatus(status?: string): TaskStatus {
  if (!status || status === 'pending') return 'due';
  if (status === 'given') return 'done';
  if (status === 'withheld' || status === 'refused') return 'done';
  return 'due';
}

// ─── Task Card Component ─────────────────────────────────────────────────────

function TaskCard({
  task,
  onMarkDone,
  basePath,
}: {
  task: NurseTask;
  onMarkDone: (task: NurseTask) => void;
  basePath: string;
}) {
  const { t } = useTranslation('nursing');
  const status = statusConfig[task.status];
  const typeColor = taskTypeColors[task.task_type];
  const minutesUntil = getMinutesUntil(task.scheduled_time);

  return (
    <div className="card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {/* Task type icon */}
        <div className={`p-2 rounded-lg ${typeColor}`}>
          {taskTypeIcons[task.task_type]}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-[var(--color-text)] truncate">
              {task.title}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
              {status.icon}
              {status.label}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-2">
            <span className="font-medium">{task.patient_name}</span>
            <span>·</span>
            <span>Bed {task.bed_number}</span>
            {task.ward_name && (
              <>
                <span>·</span>
                <span>{task.ward_name}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
            <span className="font-data">
              <Clock className="w-3 h-3 inline mr-1" />
              {formatTime(task.scheduled_time)}
            </span>
            {task.status !== 'done' && (
              <span className={minutesUntil <= 0 ? 'text-red-600 font-medium' : ''}>
                {minutesUntil <= 0
                  ? t('tasks.timeOverdue', { count: Math.abs(minutesUntil), defaultValue: '{{count}}m overdue' })
                  : t('tasks.timeUntil', { count: minutesUntil, defaultValue: 'in {{count}}m' })}
              </span>
            )}
            {task.description && (
              <span className="truncate">{task.description}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {task.status !== 'done' && (
            <button
              onClick={() => onMarkDone(task)}
              className="btn-primary text-xs px-3 py-1.5"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {t('tasks.markDone', { defaultValue: 'Mark Done' })}
            </button>
          )}
          <Link
            to={`${basePath}/patients/${task.patient_id}`}
            className="btn-secondary text-xs px-3 py-1.5"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            {t('tasks.goToPatient', { defaultValue: 'Go to Patient' })}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Priority Section Component ──────────────────────────────────────────────

function PrioritySection({
  priority,
  tasks,
  onMarkDone,
  basePath,
  defaultOpen = true,
}: {
  priority: Priority;
  tasks: NurseTask[];
  onMarkDone: (task: NurseTask) => void;
  basePath: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const config = priorityConfig[priority];

  if (tasks.length === 0) return null;

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-4 py-3 flex items-center justify-between ${config.color} font-semibold text-sm`}
      >
        <div className="flex items-center gap-2">
          <span>{config.label}</span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/80 dark:bg-slate-800">
            {tasks.length}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="p-3 space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onMarkDone={onMarkDone}
              basePath={basePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function NurseTasksPage({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [markingDone, setMarkingDone] = useState<string | null>(null);

  // Fetch dashboard data for bed/patient info
  const { data: bedGridData } = useApiQuery<DashboardData>(
    [...queryKeys.nursing.wards(), 'bed-grid'],
    '/api/nursing/wards/bed-grid',
  );

  // Fetch medication due data
  const { data: medDueData } = useApiQuery<MedDueData>(
    queryKeys.nursing.medicationDue(),
    '/api/nursing/medication-due',
  );

  // Fetch active alerts
  const { data: alertsData } = useApiQuery<AlertData>(
    [...queryKeys.nurseStation.all, 'active-alerts'],
    '/api/nurse-station/active-alerts?limit=50',
  );

  // Fetch MAR entries (today's medications)
  const today = new Date().toISOString().split('T')[0];
  const { data: marData } = useApiQuery<MARData>(
    queryKeys.nursing.marSchedule('all', today),
    `/api/nursing/mar?date=${today}&limit=100`,
  );

  // Build patient lookup from bed grid
  const patientLookup = useMemo(() => {
    const lookup: Record<number, { name: string; bed: string; ward?: string }> = {};
    const beds = bedGridData?.beds ?? [];
    for (const bed of beds) {
      if (bed.patient_id && bed.patient_name) {
        lookup[bed.patient_id] = {
          name: bed.patient_name,
          bed: bed.bed_number,
          ward: bed.ward_name,
        };
      }
    }
    return lookup;
  }, [bedGridData?.beds]);

  // Build task list from all data sources
  const allTasks = useMemo(() => {
    const tasks: NurseTask[] = [];
    const now = new Date();

    // 1. Process MAR entries (medications)
    const marEntries = marData?.Results ?? [];
    for (const entry of marEntries) {
      if (!entry.scheduled_time) continue;

      const patient = patientLookup[entry.patient_id];
      const isCompleted = entry.status === 'given' || entry.status === 'withheld' || entry.status === 'refused';
      const scheduledDate = new Date(entry.scheduled_time);
      const isToday = scheduledDate.toDateString() === now.toDateString();

      if (!isToday && isCompleted) continue;

      tasks.push({
        id: `mar-${entry.id}`,
        patient_id: entry.patient_id,
        patient_name: patient?.name ?? `Patient #${entry.patient_id}`,
        bed_number: patient?.bed ?? '-',
        ward_name: patient?.ward,
        task_type: 'medication',
        title: entry.medication_name,
        description: [entry.dose, entry.route].filter(Boolean).join(' · '),
        scheduled_time: entry.scheduled_time,
        status: mapMARStatus(entry.status),
        priority: determinePriority(entry.scheduled_time, entry.status, false),
        source_id: entry.id,
        source_table: 'mar',
      });
    }

    // 2. Process alerts (critical vitals)
    const alerts = alertsData?.alerts ?? [];
    for (const alert of alerts) {
      if (!alert.patient_id) continue;

      const patient = patientLookup[alert.patient_id];
      tasks.push({
        id: `alert-${alert.id ?? Math.random()}`,
        patient_id: alert.patient_id,
        patient_name: patient?.name ?? alert.patient_name ?? `Patient #${alert.patient_id}`,
        bed_number: patient?.bed ?? alert.bed_number ?? '-',
        ward_name: patient?.ward ?? alert.ward_name,
        task_type: 'vitals',
        title: `Critical ${alert.vital_type ?? 'vital'} alert`,
        description: `${alert.recorded_value ?? ''} outside ${alert.threshold_min ?? ''}-${alert.threshold_max ?? ''}`,
        scheduled_time: now.toISOString(),
        status: 'due',
        priority: 'critical',
        source_id: alert.id,
        source_table: 'alerts',
      });
    }

    // 3. Add vitals due tasks from bed grid (patients without vitals)
    const beds = bedGridData?.beds ?? [];
    for (const bed of beds) {
      if (!bed.patient_id || bed.latestVitals) continue;

      tasks.push({
        id: `vitals-${bed.patient_id}`,
        patient_id: bed.patient_id,
        patient_name: bed.patient_name ?? `Patient #${bed.patient_id}`,
        bed_number: bed.bed_number,
        ward_name: bed.ward_name,
        task_type: 'vitals',
        title: 'Vitals recording due',
        scheduled_time: now.toISOString(),
        status: 'due',
        priority: 'due_now',
      });
    }

    return tasks;
  }, [bedGridData?.beds, marData?.Results, alertsData?.alerts, patientLookup]);

  // Group tasks by priority
  const groupedTasks = useMemo(() => {
    const groups: Record<Priority, NurseTask[]> = {
      critical: [],
      due_now: [],
      upcoming: [],
      completed: [],
    };

    for (const task of allTasks) {
      groups[task.priority].push(task);
    }

    // Sort each group by scheduled time
    for (const priority of Object.keys(groups) as Priority[]) {
      groups[priority].sort(
        (a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime(),
      );
    }

    return groups;
  }, [allTasks]);

  // Stats
  const stats = useMemo(
    () => ({
      critical: groupedTasks.critical.length,
      dueNow: groupedTasks.due_now.length,
      upcoming: groupedTasks.upcoming.length,
      completed: groupedTasks.completed.length,
      total: allTasks.length,
    }),
    [groupedTasks, allTasks.length],
  );

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.nursing.wards() });
    queryClient.invalidateQueries({ queryKey: queryKeys.nursing.medicationDue() });
    queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
    queryClient.invalidateQueries({ queryKey: ['nursing', 'marSchedule'] });
    toast.success(t('tasks.refreshed', { defaultValue: 'Tasks refreshed' }));
  }, [queryClient, t]);

  const handleMarkDone = useCallback(
    async (task: NurseTask) => {
      setMarkingDone(task.id);
      try {
        if (task.source_table === 'mar' && task.source_id) {
          await apiFetch(`/api/nursing/mar/${task.source_id}/administer`, {
            method: 'PUT',
            body: {
              status: 'given',
              actual_time: new Date().toISOString(),
            },
          });
          toast.success(t('tasks.markedDone', { defaultValue: 'Task marked as done' }));
          handleRefresh();
        }
      } catch {
        toast.error(t('tasks.failedToMarkDone', { defaultValue: 'Failed to mark task as done' }));
      } finally {
        setMarkingDone(null);
      }
    },
    [handleRefresh, t],
  );

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">
                {t('dashboard', { ns: 'common' })}
              </Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">
                {t('tasks.myTasks', { defaultValue: 'My Tasks' })}
              </span>
            </div>
            <h1 className="page-title flex items-center gap-2">
              <ClipboardList className="w-6 h-6" />
              {t('tasks.myTasks', { defaultValue: 'My Tasks' })}
            </h1>
          </div>
          <button onClick={handleRefresh} className="btn-ghost p-2" aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-50">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{stats.critical}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('tasks.critical', { defaultValue: 'Critical' })}
              </p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-orange-50">
              <Clock className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{stats.dueNow}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('tasks.dueNow', { defaultValue: 'Due Now' })}
              </p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50">
              <Clock className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{stats.upcoming}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('tasks.upcoming', { defaultValue: 'Upcoming' })}
              </p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-50">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--color-text)]">{stats.completed}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('tasks.completedToday', { defaultValue: 'Completed Today' })}
              </p>
            </div>
          </div>
        </div>

        {/* Task Groups */}
        <div className="space-y-4">
          <PrioritySection
            priority="critical"
            tasks={groupedTasks.critical}
            onMarkDone={handleMarkDone}
            basePath={basePath}
          />
          <PrioritySection
            priority="due_now"
            tasks={groupedTasks.due_now}
            onMarkDone={handleMarkDone}
            basePath={basePath}
          />
          <PrioritySection
            priority="upcoming"
            tasks={groupedTasks.upcoming}
            onMarkDone={handleMarkDone}
            basePath={basePath}
          />
          <PrioritySection
            priority="completed"
            tasks={groupedTasks.completed}
            onMarkDone={handleMarkDone}
            basePath={basePath}
            defaultOpen={false}
          />
        </div>

        {/* Empty state */}
        {allTasks.length === 0 && (
          <div className="card p-8 text-center">
            <ClipboardList className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
              {t('tasks.noTasks', { defaultValue: 'No tasks for today' })}
            </h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('tasks.noTasksDesc', { defaultValue: 'All tasks are completed or no tasks are scheduled.' })}
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

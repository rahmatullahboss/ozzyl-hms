import { startTransition, type ReactNode, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  TestTube2,
  Truck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import ResultInput from '../components/lab/ResultInput';
import PanelResultEntry from '../components/lab/PanelResultEntry';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

type LabTab =
  | 'overview'
  | 'collection'
  | 'receiving'
  | 'result_entry'
  | 'verification'
  | 'validation'
  | 'delivery'
  | 'critical'
  | 'delayed';

interface WorklistItem {
  item_id: number;
  order_id: number;
  lab_test_id?: number;
  department_id?: number | null;
  patient_id: number;
  patient_name: string;
  patient_code?: string | null;
  mobile?: string | null;
  gender?: string | null;
  patient_age?: number | null;
  order_no: string;
  order_date?: string | null;
  ordered_at?: string | null;
  priority?: string | null;
  status: string;
  sample_status?: string | null;
  result_status?: string | null;
  is_draft?: number;
  result?: string | null;
  result_numeric?: number | null;
  abnormal_flag?: string | null;
  barcode?: string | null;
  specimen_num?: string | null;
  sample_type?: string | null;
  container_type?: string | null;
  test_name: string;
  test_code?: string | null;
  unit?: string | null;
  reference_range?: string | null;
  target_tat?: number | null;
  value_type?: 'numeric' | 'string' | 'memo' | 'coded' | 'ratio' | null;
  department_name?: string | null;
  report_id?: number | null;
  review_status?: string | null;
  report_status?: string | null;
  delivery_status?: string | null;
  result_id?: number | null;
  previous_result?: string | null;
  tat_minutes?: number | null;
  is_delayed?: boolean;
  next_action?: string;
  critical_ack_count?: number | null;
}

interface WorklistResponse {
  stage: string;
  items: WorklistItem[];
}

interface DashboardSummary {
  today_total_lab_orders: number;
  pending_sample_collection: number;
  sample_collected: number;
  in_progress_tests: number;
  pending_result_entry: number;
  pending_validation: number;
  completed_reports: number;
  delivered_reports: number;
  critical_results: number;
  rejected_samples: number;
  delayed_reports: number;
  machine_pending_tests: number;
  reagent_low_alerts: number;
  average_turnaround_time_minutes: number;
}

interface DashboardActions {
  pending_sample_collection: WorklistItem[];
  pending_result_entry: WorklistItem[];
  pending_approval: WorklistItem[];
  critical_value_alerts: WorklistItem[];
  rejected_samples: WorklistItem[];
  delayed_tat: WorklistItem[];
}

interface DashboardResponse {
  summary: DashboardSummary;
  actions: DashboardActions;
  generated_at: string;
}

interface ScanResponse {
  record: Partial<WorklistItem>;
  next_action: string;
}

interface LabDepartment {
  id: number;
  department_name: string;
}

interface DepartmentsResponse {
  departments: LabDepartment[];
}

type PanelMode = 'result' | 'correction';

function WorklistTable({
  t,
  title,
  subtitle,
  items,
  onPrimaryAction,
  onStartCorrection,
}: {
  t: (k: string) => string;
  title: string;
  subtitle: string;
  items: WorklistItem[];
  onPrimaryAction: (item: WorklistItem) => void;
  onStartCorrection: (item: WorklistItem) => void;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">{t('laboratoryDashboard.emptyQueue')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                <th className="px-4 py-3">{t('laboratoryDashboard.column.order')}</th>
                <th className="px-4 py-3">{t('laboratoryDashboard.column.patient')}</th>
                <th className="px-4 py-3">{t('laboratoryDashboard.column.test')}</th>
                <th className="px-4 py-3">{t('laboratoryDashboard.column.status')}</th>
                <th className="px-4 py-3">{t('laboratoryDashboard.column.reference')}</th>
                <th className="px-4 py-3">{t('laboratoryDashboard.column.tat')}</th>
                <th className="px-4 py-3 text-right">{t('laboratoryDashboard.column.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {items.map((item) => (
                <tr key={`${item.item_id}-${item.report_id ?? 'na'}`} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{item.order_no}</span>
                      {priorityLabel(item.priority) && (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priorityBadgeClass(item.priority)}`}>
                          {priorityLabel(item.priority)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.ordered_at ?? item.order_date, t)}</div>
                    {(() => {
                      const elapsed = formatElapsedTime(item.ordered_at, t);
                      return elapsed.text ? (
                        <div className={`mt-1 text-xs font-medium ${elapsed.isOverdue ? 'text-red-600' : 'text-slate-400'}`}>
                          {t('laboratoryDashboard.ordered')} {elapsed.text}
                        </div>
                      ) : null;
                    })()}
                    {item.barcode && <div className="mt-1 text-xs text-cyan-700">{item.barcode}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{item.patient_name}</div>
                    <div className="mt-1 text-xs text-slate-500">#{item.patient_id} • {formatAge(item.patient_age, item.gender, t)}</div>
                    {item.mobile && <div className="mt-1 text-xs text-slate-500">{item.mobile}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{item.test_name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.department_name ?? t('laboratoryDashboard.general')}
                      {item.sample_type ? ` • ${item.sample_type}` : ''}
                    </div>
                    {item.result && (
                      <div className="mt-2 text-xs text-slate-700">
                        {t('laboratoryDashboard.resultLabel')}: <span className="font-medium">{item.result}</span>
                        {item.unit ? ` ${item.unit}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>{statusChip(item.status, t)}</div>
                    {item.is_draft === 1 && (
                      <div className="mt-2">
                        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                          {t('laboratoryDashboard.draft')}
                        </span>
                      </div>
                    )}
                    {item.abnormal_flag && (
                      <div className="mt-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(item.abnormal_flag)}`}>
                          {item.abnormal_flag}
                        </span>
                      </div>
                    )}
                    {item.critical_ack_count ? (
                      <div className="mt-2 text-xs text-slate-500">{t('laboratoryDashboard.acknowledgedCount').replace('{{count}}', String(item.critical_ack_count))}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-700">{item.reference_range ?? t('laboratoryDashboard.na')}</div>
                    {item.previous_result && (
                      <div className="mt-1 text-xs text-slate-500">{t('laboratoryDashboard.previous')}: {item.previous_result}</div>
                    )}
                    {item.specimen_num && (
                      <div className="mt-1 text-xs text-slate-500">{t('laboratoryDashboard.sample')}: {item.specimen_num}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className={`font-medium ${item.is_delayed ? 'text-red-600' : 'text-slate-700'}`}>
                      {formatTat(item.tat_minutes, t)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{t('laboratoryDashboard.target')} {formatTat(item.target_tat, t)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => onPrimaryAction(item)}
                        className="inline-flex items-center rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-700"
                      >
                        {nextActionLabel(item, t)}
                      </button>
                      {item.report_status === 'published' && item.result_id ? (
                        <button
                          type="button"
                          onClick={() => onStartCorrection(item)}
                          className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          {t('laboratoryDashboard.correct')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatDateTime(value: string | null | undefined, t: (k: string) => string) {
  if (!value) return t('laboratoryDashboard.notRecorded');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatAge(age: number | null | undefined, gender: string | null | undefined, t: (k: string) => string) {
  const ageText = age ? `${age}${t('laboratoryDashboard.yearsShort')}` : t('laboratoryDashboard.ageNA');
  return gender ? `${ageText} • ${gender}` : ageText;
}

function formatTat(minutes: number | null | undefined, t: (k: string) => string) {
  if (!minutes || minutes <= 0) return t('laboratoryDashboard.na');
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}${t('laboratoryDashboard.minShort')}`;
  return `${hours}${t('laboratoryDashboard.hourShort')} ${mins}${t('laboratoryDashboard.minShort')}`;
}

function badgeClass(flag?: string | null) {
  switch (flag) {
    case 'critical':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'high':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'low':
      return 'bg-sky-100 text-sky-700 border-sky-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function priorityBadgeClass(priority?: string | null) {
  switch (priority) {
    case 'stat':
      return 'bg-red-600 text-white';
    case 'urgent':
      return 'bg-amber-500 text-white';
    case 'asap':
      return 'bg-orange-500 text-white';
    default:
      return null;
  }
}

function priorityLabel(priority?: string | null) {
  switch (priority) {
    case 'stat':
      return 'STAT';
    case 'urgent':
      return 'URGENT';
    case 'asap':
      return 'ASAP';
    default:
      return null;
  }
}

function formatElapsedTime(orderedAt: string | null | undefined, t: (k: string) => string): { text: string; isOverdue: boolean } {
  if (!orderedAt) return { text: '', isOverdue: false };
  const ordered = new Date(orderedAt);
  if (Number.isNaN(ordered.getTime())) return { text: '', isOverdue: false };

  const now = new Date();
  const diffMs = now.getTime() - ordered.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 0) return { text: t('laboratoryDashboard.justNow'), isOverdue: false };

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  let text: string;
  if (hours > 0) {
    text = `${hours}${t('laboratoryDashboard.hourShort')} ${minutes}${t('laboratoryDashboard.minShort')} ${t('laboratoryDashboard.ago')}`;
  } else {
    text = `${minutes}${t('laboratoryDashboard.minShort')} ${t('laboratoryDashboard.ago')}`;
  }

  return { text, isOverdue: diffMinutes > 30 };
}

function statusChip(status: string | null | undefined, t: (k: string) => string) {
  return (
    <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.08em] text-slate-700">
      {status ?? t('laboratoryDashboard.pending')}
    </span>
  );
}

function nextActionLabel(item: WorklistItem, t: (k: string) => string) {
  switch (item.next_action) {
    case 'collect':
      return t('laboratoryDashboard.action.collect');
    case 'receive':
      return t('laboratoryDashboard.action.receive');
    case 'enter_result':
      return t('laboratoryDashboard.action.enterResult');
    case 'verify':
      return t('laboratoryDashboard.action.verify');
    case 'validate':
      return t('laboratoryDashboard.action.validate');
    case 'deliver':
      return t('laboratoryDashboard.action.deliver');
    case 'acknowledge':
      return t('laboratoryDashboard.action.acknowledge');
    default:
      return t('laboratoryDashboard.action.view');
  }
}

function overviewActionToTab(nextAction?: string): LabTab {  switch (nextAction) {
    case 'collect':
      return 'collection';
    case 'receive':
      return 'receiving';
    case 'enter_result':
      return 'result_entry';
    case 'verify':
      return 'verification';
    case 'validate':
      return 'validation';
    case 'deliver':
      return 'delivery';
    case 'acknowledge':
      return 'critical';
    default:
      return 'overview';
  }
}

function StatCard({
  label,
  value,
  tone = 'slate',
  icon,
}: {
  label: string;
  value: number | string;
  tone?: 'slate' | 'cyan' | 'amber' | 'red' | 'emerald';
  icon: ReactNode;
}) {
  const tones: Record<NonNullable<typeof tone>, string> = {
    slate: 'from-slate-50 to-white border-slate-200 text-slate-900',
    cyan: 'from-cyan-50 to-white border-cyan-200 text-cyan-900',
    amber: 'from-amber-50 to-white border-amber-200 text-amber-900',
    red: 'from-rose-50 to-white border-rose-200 text-rose-900',
    emerald: 'from-emerald-50 to-white border-emerald-200 text-emerald-900',
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${tones[tone]} p-4 shadow-sm`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
        <div className="text-slate-500">{icon}</div>
      </div>
      <div className="text-3xl font-semibold">{value}</div>
    </div>
  );
}

const STAGE_BY_TAB: Record<Exclude<LabTab, 'overview'>, WorklistResponse['stage']> = {
  collection: 'collection',
  receiving: 'receiving',
  result_entry: 'result_entry',
  verification: 'verification',
  validation: 'validation',
  delivery: 'delivery',
  critical: 'critical',
  delayed: 'delayed',
};

export default function LaboratoryDashboard({ role = 'laboratory' }: { role?: string }) {
  const { t } = useTranslation(['tenantLab']);
  const location = useLocation();
  const queryClient = useQueryClient();

  const defaultTab = location.pathname.endsWith('/tests') ? 'result_entry' : 'overview';
  const [activeTab, setActiveTab] = useState<LabTab>(defaultTab);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [scanCode, setScanCode] = useState('');
  const [selectedItem, setSelectedItem] = useState<WorklistItem | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('result');
  const [resultValue, setResultValue] = useState('');
  const [resultNotes, setResultNotes] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');
  const deferredSearch = useDeferredValue(search);
  const deferredPriority = useDeferredValue(priorityFilter);
  const deferredDepartment = useDeferredValue(departmentFilter);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const dashboardQuery = useApiQuery<DashboardResponse>(
    queryKeys.laboratory.workflowDashboard(deferredDepartment || undefined),
    `/api/lab-workflow/dashboard${deferredDepartment ? `?department_id=${deferredDepartment}` : ''}`,
    { refetchInterval: 30_000 },
  );

  const departmentsQuery = useApiQuery<DepartmentsResponse>(
    queryKeys.laboratory.departments(),
    '/api/lab-workflow/departments',
  );

  const priorityParam = deferredPriority ? `&priority=${deferredPriority}` : '';
  const departmentParam = deferredDepartment ? `&department_id=${deferredDepartment}` : '';
  const worklistPath = activeTab === 'overview'
    ? '/api/lab-workflow/worklists?stage=collection&limit=1'
    : `/api/lab-workflow/worklists?stage=${STAGE_BY_TAB[activeTab as Exclude<LabTab, 'overview'>]}&limit=50${deferredSearch ? `&search=${encodeURIComponent(deferredSearch)}` : ''}${priorityParam}${departmentParam}`;

  const worklistQuery = useApiQuery<WorklistResponse>(
    queryKeys.laboratory.worklist(activeTab, { search: deferredSearch, priority: deferredPriority, department: deferredDepartment }),
    worklistPath,
    { enabled: activeTab !== 'overview' },
  );

  const isPanelTest = !!selectedItem?.lab_test_id;
  const componentsQuery = useApiQuery<{ data: Array<{
    component_id: number;
    lab_test_id: number;
    test_name: string;
    unit: string | null;
    reference_range: string | null;
    value_type: string;
    display_sequence: number;
    critical_low: number | null;
    critical_high: number | null;
  }> }>(
    queryKeys.laboratory.testComponents(selectedItem?.lab_test_id ?? 0),
    `/api/lab/tests/${selectedItem?.lab_test_id}/components`,
    { enabled: isPanelTest },
  );

  const panelComponents = (componentsQuery.data?.data ?? []) as Array<{
    lab_test_id: number;
    component_id: number;
    test_name: string;
    unit?: string | null;
    reference_range?: string | null;
    value_type?: string | null;
    display_sequence?: number;
    critical_low?: number | null;
    critical_high?: number | null;
  }>;
  const isPanel = isPanelTest && panelComponents.length > 0;

  const invalidateLab = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
  };

  const scanMutation = useApiMutation<ScanResponse, { code: string }>(
    'post',
    '/api/lab-workflow/scan/resolve',
    {
      onSuccess: (data) => {
        const tab = overviewActionToTab(data.next_action);
        startTransition(() => setActiveTab(tab));
        setSelectedItem((previous) => ({
          ...previous,
          ...(data.record as WorklistItem),
        }));
        setScanCode('');
        toast.success(t('laboratoryDashboard.toast.loaded', { id: data.record.order_no ?? t('laboratoryDashboard.labRecord') }));
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.scanNotMatched')),
    },
  );

  const collectMutation = useApiMutation<unknown, { itemId: number }>(
    'post',
    ({ itemId }) => `/api/lab-workflow/items/${itemId}/collect`,
    {
      onSuccess: () => {
        toast.success(t('laboratoryDashboard.toast.sampleCollected'));
        invalidateLab();
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.sampleCollectionFailed')),
    },
  );

  const receiveMutation = useApiMutation<unknown, { itemId: number }>(
    'post',
    ({ itemId }) => `/api/lab-workflow/items/${itemId}/receive`,
    {
      onSuccess: () => {
        toast.success(t('laboratoryDashboard.toast.sampleReceived'));
        invalidateLab();
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.sampleReceivingFailed')),
    },
  );

  const resultMutation = useApiMutation<unknown, { itemId: number; result: string; notes?: string; is_draft?: boolean }>(
    'put',
    ({ itemId }) => `/api/lab/items/${itemId}/result`,
    {
      onSuccess: (_data, variables) => {
        toast.success(variables.is_draft ? t('laboratoryDashboard.toast.draftSaved') : t('laboratoryDashboard.toast.resultSaved'));
        setSelectedItem(null);
        setResultValue('');
        setResultNotes('');
        invalidateLab();
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : t('laboratoryDashboard.toast.resultEntryFailed');
        toast.error(msg);
      },
    },
  );

  const verifyMutation = useApiMutation<unknown, { reportId: number }>(
    'post',
    ({ reportId }) => `/api/lab-workflow/reports/${reportId}/verify`,
    {
      onSuccess: () => {
        toast.success(t('laboratoryDashboard.toast.reportVerified'));
        invalidateLab();
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.verificationFailed')),
    },
  );

  const validateMutation = useApiMutation<unknown, { reportId: number }>(
    'post',
    ({ reportId }) => `/api/lab-workflow/reports/${reportId}/validate`,
    {
      onSuccess: () => {
        toast.success(t('laboratoryDashboard.toast.reportValidated'));
        invalidateLab();
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.validationFailed')),
    },
  );

  const deliverMutation = useApiMutation<unknown, { reportId: number; delivery_method: 'print'; copy_count: number }>(
    'post',
    ({ reportId }) => `/api/lab-workflow/reports/${reportId}/deliver`,
    {
      onSuccess: () => {
        toast.success(t('laboratoryDashboard.toast.reportDelivered'));
        invalidateLab();
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.deliveryUpdateFailed')),
    },
  );

  const acknowledgeMutation = useApiMutation<unknown, { itemId: number }>(
    'post',
    ({ itemId }) => `/api/lab-workflow/critical/${itemId}/acknowledge`,
    {
      onSuccess: () => {
        toast.success(t('laboratoryDashboard.toast.criticalAck'));
        invalidateLab();
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.ackFailed')),
    },
  );

  const correctionMutation = useApiMutation<
    unknown,
    { reportId: number; reason: string; notes?: string; results: Array<{ result_id: number; result_value: string; comments?: string }> }
  >(
    'post',
    ({ reportId }) => `/api/lab-workflow/reports/${reportId}/correct`,
    {
      onSuccess: () => {
        toast.success(t('laboratoryDashboard.toast.correctionSaved'));
        setSelectedItem(null);
        setCorrectionReason('');
        setCorrectionNotes('');
        setResultValue('');
        invalidateLab();
      },
      onError: () => toast.error(t('laboratoryDashboard.toast.correctionFailed')),
    },
  );

  const summary = dashboardQuery.data?.summary;
  const overviewActions = dashboardQuery.data?.actions;

  const summaryCards = useMemo(() => [
    {
      label: t('laboratoryDashboard.card.todayOrders'),
      value: summary?.today_total_lab_orders ?? 0,
      tone: 'cyan' as const,
      icon: <FlaskConical className="h-5 w-5" />,
    },
    {
      label: t('laboratoryDashboard.card.pendingCollection'),
      value: summary?.pending_sample_collection ?? 0,
      tone: 'amber' as const,
      icon: <PackageCheck className="h-5 w-5" />,
    },
    {
      label: t('laboratoryDashboard.card.pendingResultEntry'),
      value: summary?.pending_result_entry ?? 0,
      tone: 'slate' as const,
      icon: <TestTube2 className="h-5 w-5" />,
    },
    {
      label: t('laboratoryDashboard.card.pendingValidation'),
      value: summary?.pending_validation ?? 0,
      tone: 'amber' as const,
      icon: <ShieldCheck className="h-5 w-5" />,
    },
    {
      label: t('laboratoryDashboard.card.criticalResults'),
      value: summary?.critical_results ?? 0,
      tone: 'red' as const,
      icon: <AlertTriangle className="h-5 w-5" />,
    },
    {
      label: t('laboratoryDashboard.card.completedReports'),
      value: summary?.completed_reports ?? 0,
      tone: 'emerald' as const,
      icon: <CheckCircle2 className="h-5 w-5" />,
    },
    {
      label: t('laboratoryDashboard.card.deliveredReports'),
      value: summary?.delivered_reports ?? 0,
      tone: 'emerald' as const,
      icon: <Truck className="h-5 w-5" />,
    },
    {
      label: t('laboratoryDashboard.card.lowReagentAlerts'),
      value: summary?.reagent_low_alerts ?? 0,
      tone: 'red' as const,
      icon: <ClipboardCheck className="h-5 w-5" />,
    },
  ], [summary, t]);

  const activeItems = activeTab === 'overview' ? [] : (worklistQuery.data?.items ?? []);

  const openPrintReport = (item: WorklistItem) => {
    window.open(`/api/lab/orders/${item.order_id}/report/print`, '_blank', 'noopener,noreferrer');
  };

  const handlePrimaryAction = (item: WorklistItem) => {
    switch (item.next_action) {
      case 'collect':
        collectMutation.mutate({ itemId: item.item_id });
        return;
      case 'receive':
        receiveMutation.mutate({ itemId: item.item_id });
        return;
      case 'enter_result':
        setPanelMode('result');
        setSelectedItem(item);
        setResultValue(item.result ?? '');
        setResultNotes('');
        return;
      case 'verify':
        if (!item.report_id) {
          toast.error(t('laboratoryDashboard.toast.reportNotAvailable'));
          return;
        }
        verifyMutation.mutate({ reportId: item.report_id });
        return;
      case 'validate':
        if (!item.report_id) {
          toast.error(t('laboratoryDashboard.toast.reportNotAvailable'));
          return;
        }
        validateMutation.mutate({ reportId: item.report_id });
        return;
      case 'deliver':
        if (!item.report_id) {
          toast.error(t('laboratoryDashboard.toast.publishedReportNotAvailable'));
          return;
        }
        openPrintReport(item);
        deliverMutation.mutate({ reportId: item.report_id, delivery_method: 'print', copy_count: 1 });
        return;
      case 'acknowledge':
        acknowledgeMutation.mutate({ itemId: item.item_id });
        return;
      default:
        if (activeTab === 'critical') {
          acknowledgeMutation.mutate({ itemId: item.item_id });
          return;
        }
        openPrintReport(item);
    }
  };

  const handleStartCorrection = (item: WorklistItem) => {
    if (!item.report_id || !item.result_id) {
      toast.error(t('laboratoryDashboard.toast.correctionNeedsPublished'));
      return;
    }
    setPanelMode('correction');
    setSelectedItem(item);
    setResultValue(item.result ?? '');
    setCorrectionReason('');
    setCorrectionNotes('');
  };

  const handleSubmitResult = (isDraft?: boolean) => {
    if (!selectedItem || !resultValue.trim()) {
      toast.error(t('laboratoryDashboard.toast.resultValueRequired'));
      return;
    }
    resultMutation.mutate({
      itemId: selectedItem.item_id,
      result: resultValue.trim(),
      notes: resultNotes.trim() || undefined,
      is_draft: isDraft,
    });
  };

  const handleSubmitCorrection = () => {
    if (!selectedItem?.report_id || !selectedItem.result_id) {
      toast.error(t('laboratoryDashboard.toast.publishedResultNotAvailable'));
      return;
    }
    if (!correctionReason.trim() || !resultValue.trim()) {
      toast.error(t('laboratoryDashboard.toast.correctionReasonRequired'));
      return;
    }
    correctionMutation.mutate({
      reportId: selectedItem.report_id,
      reason: correctionReason.trim(),
      notes: correctionNotes.trim() || undefined,
      results: [
        {
          result_id: selectedItem.result_id,
          result_value: resultValue.trim(),
          comments: correctionNotes.trim() || undefined,
        },
      ],
    });
  };

  const TAB_CONFIG: Array<{ key: LabTab; label: string }> = [
    { key: 'overview', label: t('laboratoryDashboard.tab.overview') },
    { key: 'collection', label: t('laboratoryDashboard.tab.collection') },
    { key: 'receiving', label: t('laboratoryDashboard.tab.receiving') },
    { key: 'result_entry', label: t('laboratoryDashboard.tab.resultEntry') },
    { key: 'verification', label: t('laboratoryDashboard.tab.verification') },
    { key: 'validation', label: t('laboratoryDashboard.tab.validation') },
    { key: 'delivery', label: t('laboratoryDashboard.tab.delivery') },
    { key: 'critical', label: t('laboratoryDashboard.tab.critical') },
    { key: 'delayed', label: t('laboratoryDashboard.tab.delayed') },
  ];

  const stageTitle = TAB_CONFIG.find((tab) => tab.key === activeTab)?.label ?? t('laboratoryDashboard.tab.overview');

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-cyan-50 via-white to-slate-50 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">{t('laboratoryDashboard.hero.system')}</div>
              <h1 className="mt-2 text-3xl font-semibold text-slate-900">{t('laboratoryDashboard.hero.title')}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                {t('laboratoryDashboard.hero.subtitle')}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-[280px]">
                <Barcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-700" />
                <input
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && scanCode.trim()) {
                      scanMutation.mutate({ code: scanCode.trim() });
                    }
                  }}
                  placeholder={t('laboratoryDashboard.scanPlaceholder')}
                  className="w-full rounded-2xl border border-cyan-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-cyan-500"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  dashboardQuery.refetch();
                  if (activeTab !== 'overview') {
                    worklistQuery.refetch();
                  }
                }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <RefreshCw className="h-4 w-4" />
                {t('laboratoryDashboard.refresh')}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} tone={card.tone} icon={card.icon} />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                  activeTab === tab.key
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {activeTab !== 'overview' ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">{stageTitle} {t('laboratoryDashboard.queue')}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {t('laboratoryDashboard.searchHint')}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative min-w-[260px]">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('laboratoryDashboard.searchPlaceholder', { stage: stageTitle.toLowerCase() })}
                        className="w-full rounded-2xl border border-slate-200 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-cyan-500"
                      />
                    </div>
                    <select
                      value={departmentFilter}
                      onChange={(event) => setDepartmentFilter(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white py-3 px-4 text-sm outline-none transition focus:border-cyan-500"
                    >
                      <option value="">{t('laboratoryDashboard.allDepartments')}</option>
                      {(departmentsQuery.data?.departments ?? []).map((dept) => (
                        <option key={dept.id} value={String(dept.id)}>
                          {dept.department_name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={priorityFilter}
                      onChange={(event) => setPriorityFilter(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white py-3 px-4 text-sm outline-none transition focus:border-cyan-500"
                    >
                      <option value="">{t('laboratoryDashboard.allPriorities')}</option>
                      <option value="stat">STAT</option>
                      <option value="urgent">{t('laboratoryDashboard.priority.urgent')}</option>
                      <option value="asap">ASAP</option>
                      <option value="routine">{t('laboratoryDashboard.priority.routine')}</option>
                    </select>
                  </div>
                </div>
              </div>

              <WorklistTable
                t={t}
                title={`${stageTitle} ${t('laboratoryDashboard.worklist')}`}
                subtitle={t('laboratoryDashboard.showingRecords', { count: activeItems.length })}
                items={activeItems}
                onPrimaryAction={handlePrimaryAction}
                onStartCorrection={handleStartCorrection}
              />
            </div>

            <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  {panelMode === 'correction' ? t('laboratoryDashboard.resultCorrection') : t('laboratoryDashboard.resultEntry')}
                </h2>
                {selectedItem ? (
                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="text-xs font-medium text-slate-500 transition hover:text-slate-700"
                  >
                    {t('laboratoryDashboard.clear')}
                  </button>
                ) : null}
              </div>

              {!selectedItem ? (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  {t('laboratoryDashboard.selectRowHint')}
                </div>
              ) : isPanel && panelMode !== 'correction' ? (
                <div className="mt-5">
                  <PanelResultEntry
                    orderId={selectedItem.order_id}
                    labTestId={selectedItem.lab_test_id!}
                    patientId={selectedItem.patient_id}
                    testName={selectedItem.test_name}
                    components={panelComponents}
                    onComplete={() => {
                      setSelectedItem(null);
                      invalidateLab();
                    }}
                  />
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{selectedItem.order_no}</div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">{selectedItem.patient_name}</div>
                    <div className="mt-1 text-sm text-slate-600">{selectedItem.test_name}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatAge(selectedItem.patient_age, selectedItem.gender, t)}
                      {selectedItem.barcode ? ` • ${selectedItem.barcode}` : ''}
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      {panelMode === 'correction' ? t('laboratoryDashboard.revisedResult') : t('laboratoryDashboard.result')}
                    </span>
                    <ResultInput
                      valueType={selectedItem.value_type}
                      value={resultValue}
                      onChange={setResultValue}
                      placeholder={selectedItem.reference_range ? `${t('laboratoryDashboard.refPrefix')} ${selectedItem.reference_range}` : t('laboratoryDashboard.enterResult')}
                      testName={selectedItem.test_name}
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-100 p-3 text-sm">
                      <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('laboratoryDashboard.referenceRange')}</div>
                      <div className="mt-1 font-medium text-slate-900">{selectedItem.reference_range ?? t('laboratoryDashboard.na')}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 p-3 text-sm">
                      <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('laboratoryDashboard.previousResult')}</div>
                      <div className="mt-1 font-medium text-slate-900">{selectedItem.previous_result ?? t('laboratoryDashboard.na')}</div>
                    </div>
                  </div>

                  {panelMode === 'correction' ? (
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">{t('laboratoryDashboard.correctionReason')}</span>
                      <textarea
                        value={correctionReason}
                        onChange={(event) => setCorrectionReason(event.target.value)}
                        rows={3}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-500"
                        placeholder={t('laboratoryDashboard.correctionReasonPlaceholder')}
                      />
                    </label>
                  ) : null}

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      {panelMode === 'correction' ? t('laboratoryDashboard.correctionNotes') : t('laboratoryDashboard.technicianNotes')}
                    </span>
                    <textarea
                      value={panelMode === 'correction' ? correctionNotes : resultNotes}
                      onChange={(event) => panelMode === 'correction' ? setCorrectionNotes(event.target.value) : setResultNotes(event.target.value)}
                      rows={3}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-500"
                      placeholder={panelMode === 'correction' ? t('laboratoryDashboard.correctionNotesPlaceholder') : t('laboratoryDashboard.entryNotePlaceholder')}
                    />
                  </label>

                  <div className="flex flex-wrap gap-3">
                    {panelMode !== 'correction' && (
                      <button
                        type="button"
                        onClick={() => handleSubmitResult(true)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
                      >
                        <TestTube2 className="h-4 w-4" />
                        {t('laboratoryDashboard.saveDraft')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={panelMode === 'correction' ? handleSubmitCorrection : () => handleSubmitResult()}
                      className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-700"
                    >
                      {panelMode === 'correction' ? <ShieldCheck className="h-4 w-4" /> : <TestTube2 className="h-4 w-4" />}
                      {panelMode === 'correction' ? t('laboratoryDashboard.saveCorrection') : t('laboratoryDashboard.saveResult')}
                    </button>
                    {selectedItem.report_status === 'published' ? (
                      <button
                        type="button"
                        onClick={() => openPrintReport(selectedItem)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        <Printer className="h-4 w-4" />
                        {t('laboratoryDashboard.printReport')}
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </aside>
          </section>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <WorklistTable
                t={t}
                title={t('laboratoryDashboard.overview.pendingSampleCollection')}
                subtitle={t('laboratoryDashboard.overview.pendingSampleCollectionSub')}
                items={overviewActions?.pending_sample_collection ?? []}
                onPrimaryAction={handlePrimaryAction}
                onStartCorrection={handleStartCorrection}
              />
              <WorklistTable
                t={t}
                title={t('laboratoryDashboard.overview.pendingResultEntry')}
                subtitle={t('laboratoryDashboard.overview.pendingResultEntrySub')}
                items={overviewActions?.pending_result_entry ?? []}
                onPrimaryAction={handlePrimaryAction}
                onStartCorrection={handleStartCorrection}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <WorklistTable
                t={t}
                title={t('laboratoryDashboard.overview.pendingApproval')}
                subtitle={t('laboratoryDashboard.overview.pendingApprovalSub')}
                items={overviewActions?.pending_approval ?? []}
                onPrimaryAction={handlePrimaryAction}
                onStartCorrection={handleStartCorrection}
              />
              <WorklistTable
                t={t}
                title={t('laboratoryDashboard.overview.criticalValueAlerts')}
                subtitle={t('laboratoryDashboard.overview.criticalValueAlertsSub')}
                items={overviewActions?.critical_value_alerts ?? []}
                onPrimaryAction={(item) => acknowledgeMutation.mutate({ itemId: item.item_id })}
                onStartCorrection={handleStartCorrection}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <WorklistTable
                t={t}
                title={t('laboratoryDashboard.overview.rejectedSamples')}
                subtitle={t('laboratoryDashboard.overview.rejectedSamplesSub')}
                items={overviewActions?.rejected_samples ?? []}
                onPrimaryAction={(item) => startTransition(() => setActiveTab(overviewActionToTab(item.next_action)))}
                onStartCorrection={handleStartCorrection}
              />
              <WorklistTable
                t={t}
                title={t('laboratoryDashboard.overview.delayedTAT')}
                subtitle={t('laboratoryDashboard.overview.delayedTATSub')}
                items={overviewActions?.delayed_tat ?? []}
                onPrimaryAction={handlePrimaryAction}
                onStartCorrection={handleStartCorrection}
              />
            </div>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t('laboratoryDashboard.snapshot.title')}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t('laboratoryDashboard.snapshot.summary', { tat: formatTat(summary?.average_turnaround_time_minutes, t), machine: summary?.machine_pending_tests ?? 0, reagent: summary?.reagent_low_alerts ?? 0 })}
                  </p>
                </div>
                <div className="text-sm text-slate-500">{t('laboratoryDashboard.snapshot.lastRefreshed', { time: formatDateTime(dashboardQuery.data?.generated_at, t) })}</div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('laboratoryDashboard.snapshot.delayedReports')}</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{summary?.delayed_reports ?? 0}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('laboratoryDashboard.snapshot.inProgressTests')}</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{summary?.in_progress_tests ?? 0}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500">{t('laboratoryDashboard.snapshot.samplesCollected')}</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{summary?.sample_collected ?? 0}</div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

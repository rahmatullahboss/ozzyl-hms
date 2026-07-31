import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Activity, AlertTriangle, CheckCircle2, ClipboardList, PackageCheck, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { api } from '../../lib/apiClient';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

export type ConsumptionAutomationMode = 'rules' | 'queue' | 'exceptions';
export type ConsumptionQueueStatusFilter = 'pending_confirmation' | 'confirmed' | 'variance_review' | 'posted';

export function buildConsumptionQueueEndpoint(status: ConsumptionQueueStatusFilter): string {
  return `/api/inventory/consumption-events?status=${status}&limit=100`;
}

export function buildConsumptionQueueEmptyStateMessage(status: ConsumptionQueueStatusFilter): string {
  if (status === 'confirmed') return 'No confirmed events ready to post. Confirm actual usage first, then stock deduction can be posted.';
  if (status === 'variance_review') return 'No variance events pending review. Variance events will appear here when actual usage differs from expected usage.';
  if (status === 'posted') return 'No posted consumption history for this queue view yet. Posted stock deductions will appear here after confirmation.';
  return 'No pending consumption events. Complete billing/procedure/OT workflows or check rule coverage if expected events are missing.';
}

export function buildConsumptionExceptionEmptyStateMessage(input: { totalRows?: number; visibleRows?: number; severity?: string } = {}): string {
  const severity = String(input.severity || 'all');
  if (severity !== 'all' && Number(input.totalRows ?? 0) > 0 && Number(input.visibleRows ?? 0) === 0) {
    return `No ${severity} exceptions in the current filter. Clear the severity filter to review other open exceptions.`;
  }
  return 'No open consumption exceptions. Any missing rules, stock shortages, scan blocks, approval blocks, and variance issues will appear here when they need admin review.';
}

export type ConsumptionExceptionSeverityFilter = 'all' | 'critical' | 'warning' | 'info';

export function filterConsumptionExceptionsBySeverity<T extends { Severity?: string | null }>(rows: T[], severity: ConsumptionExceptionSeverityFilter): T[] {
  if (severity === 'all') return rows;
  return rows.filter((row) => String(row.Severity || '').toLowerCase() === severity);
}

export type ConsumptionReconciliationFilters = { from?: string; to?: string; department?: string };
export type ConsumptionRuleCoverageFilters = ConsumptionReconciliationFilters & { triggerType?: string };

export function buildConsumptionReconciliationEndpoint(filters: ConsumptionReconciliationFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.department?.trim()) params.set('department', filters.department.trim());
  const query = params.toString();
  return query ? `/api/inventory/consumption-reports/reconciliation?${query}` : '/api/inventory/consumption-reports/reconciliation';
}

export function buildConsumptionRuleCoverageEndpoint(filters: ConsumptionRuleCoverageFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.department?.trim()) params.set('department', filters.department.trim());
  if (filters.triggerType?.trim()) params.set('triggerType', filters.triggerType.trim());
  const query = params.toString();
  return query ? `/api/inventory/consumption-reports/rule-coverage?${query}` : '/api/inventory/consumption-reports/rule-coverage';
}

export function consumptionDeductionModeLabel(mode?: string | null): string {
  switch (mode) {
    case 'auto': return 'Auto deduct';
    case 'suggest_confirm': return 'Suggest + confirm';
    case 'scan_required': return 'Scan required';
    case 'approval_required': return 'Approval required';
    case 'manual_only': return 'Manual only';
    default: return 'Suggest + confirm';
  }
}

export function consumptionEventStatusLabel(status?: string | null): string {
  switch (status) {
    case 'expected': return 'Expected';
    case 'pending_confirmation': return 'Pending confirmation';
    case 'confirmed': return 'Confirmed';
    case 'posted': return 'Posted';
    case 'reversed': return 'Reversed';
    case 'cancelled': return 'Cancelled';
    case 'blocked_missing_rule': return 'Missing rule';
    case 'blocked_stock_shortage': return 'Stock shortage';
    case 'blocked_scan_required': return 'Scan required';
    case 'blocked_approval_required': return 'Approval required';
    case 'variance_review': return 'Variance review';
    default: return status || 'Unknown';
  }
}

export function canPostConsumptionFromUiStatus(status?: string | null): boolean {
  return status === 'confirmed';
}

export function canReviewConsumptionVarianceFromUiStatus(status?: string | null): boolean {
  return status === 'variance_review';
}

export function normalizeVarianceReviewNote(value?: string | null): string {
  const note = String(value ?? '').trim();
  return note || 'Accepted actual usage after review';
}

export function formatConsumptionVarianceQty(value?: number | string | null): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric === 0) return '0';
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildConsumptionReconciliationCsv(rows: ConsumptionReconciliationRow[]): string {
  const header = ['Department', 'Status', 'Events', 'Expected', 'Actual', 'Difference'];
  const body = rows.map((row) => [
    row.Department || 'Unassigned',
    consumptionEventStatusLabel(row.Status),
    row.EventCount,
    row.ExpectedQty,
    row.ActualQty,
    formatConsumptionVarianceQty(row.VarianceQty),
  ].map(csvCell).join(','));
  return [header.join(','), ...body].join('\n');
}

export function buildConsumptionRuleCoverageCsv(rows: ConsumptionRuleCoverageRow[]): string {
  const header = ['Trigger Type', 'Trigger ID', 'Trigger Code', 'Department', 'Events', 'Rules', 'Matched Events', 'Missing Events', 'Coverage'];
  const body = rows.map((row) => [
    row.TriggerType,
    row.TriggerId ?? '',
    row.TriggerCode ?? '',
    row.Department || 'Unassigned',
    row.EventCount,
    row.RuleCount,
    row.MatchedRuleEvents,
    row.MissingRuleEvents,
    Number(row.HasActiveRule ?? 0) > 0 ? 'Covered' : 'Missing',
  ].map(csvCell).join(','));
  return [header.join(','), ...body].join('\n');
}

export function buildConsumptionExceptionsCsv(rows: ConsumptionException[]): string {
  const header = ['Exception ID', 'Event ID', 'Reason', 'Severity', 'Status', 'Message'];
  const body = rows.map((row) => [
    row.ExceptionId,
    row.EventId ?? '',
    row.Reason,
    row.Severity,
    row.Status,
    row.Message,
  ].map(csvCell).join(','));
  return [header.join(','), ...body].join('\n');
}

export function buildRuleCoverageEmptyStateMessage(input: { totalRows: number; visibleRows: number; filtersActive?: boolean; missingOnly?: boolean }): string {
  if (input.visibleRows > 0) return '';
  if (input.missingOnly && input.totalRows > 0) return 'No missing triggers in the current coverage result. Coverage looks healthy for this filter.';
  if (input.filtersActive) return 'No rule coverage rows match these filters. Clear filters or widen the date range.';
  return 'No consumption triggers found yet. Load starter rules or complete a billing/procedure/OT workflow to generate coverage.';
}

export function buildHighVarianceReconciliationRows(rows: ConsumptionReconciliationRow[], limit = 5): ConsumptionReconciliationRow[] {
  return [...rows]
    .filter((row) => Math.abs(Number(row.VarianceQty ?? 0)) > 0)
    .sort((a, b) => Math.abs(Number(b.VarianceQty ?? 0)) - Math.abs(Number(a.VarianceQty ?? 0)))
    .slice(0, limit);
}

export function buildMissingTriggerRuleDraft(row: ConsumptionRuleCoverageRow): ConsumptionRuleFormState {
  const triggerLabel = row.TriggerCode || row.TriggerId || row.TriggerType;
  return {
    ...defaultConsumptionRuleForm,
    ruleName: `${row.TriggerType.replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase())} rule ${triggerLabel}`,
    triggerType: row.TriggerType,
    triggerId: row.TriggerId ? String(row.TriggerId) : '',
    department: row.Department || '',
    deductionMode: 'suggest_confirm',
  };
}

export function consumptionExceptionSeverityClass(severity?: string | null): string {
  switch (severity) {
    case 'critical': return 'bg-red-50 text-red-700 border-red-200';
    case 'warning': return 'bg-amber-50 text-amber-700 border-amber-200';
    default: return 'bg-sky-50 text-sky-700 border-sky-200';
  }
}

export type ConsumptionRuleFormItemState = {
  itemId: string;
  quantity: string;
  unit: string;
  requiresScan: boolean;
  requiresApproval: boolean;
  highValueFlag: boolean;
  varianceToleranceQty: string;
  varianceTolerancePercent: string;
};

export type ConsumptionRuleFormState = {
  ruleName: string;
  triggerType: string;
  triggerId: string;
  department: string;
  defaultStoreId: string;
  deductionMode: string;
  items: ConsumptionRuleFormItemState[];
  itemId?: string;
  quantity?: string;
  unit?: string;
  requiresScan?: boolean;
  requiresApproval?: boolean;
  highValueFlag?: boolean;
  varianceToleranceQty?: string;
  varianceTolerancePercent?: string;
};

export const defaultConsumptionRuleForm: ConsumptionRuleFormState = {
  ruleName: '',
  triggerType: 'billing_item',
  triggerId: '',
  department: '',
  defaultStoreId: '',
  deductionMode: 'suggest_confirm',
  items: [{
    itemId: '',
    quantity: '1',
    unit: 'pcs',
    requiresScan: false,
    requiresApproval: false,
    highValueFlag: false,
    varianceToleranceQty: '0',
    varianceTolerancePercent: '0',
  }],
};

function optionalNumber(value?: string | null): number | undefined {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Numeric fields must be positive');
  return numeric;
}

export function buildConsumptionRulePayload(form: ConsumptionRuleFormState) {
  const ruleName = form.ruleName.trim();
  if (!ruleName) throw new Error('Rule name is required');
  const sourceItems = form.items?.length ? form.items : [{
    itemId: form.itemId || '',
    quantity: form.quantity || '',
    unit: form.unit || '',
    requiresScan: Boolean(form.requiresScan),
    requiresApproval: Boolean(form.requiresApproval),
    highValueFlag: Boolean(form.highValueFlag),
    varianceToleranceQty: form.varianceToleranceQty || '0',
    varianceTolerancePercent: form.varianceTolerancePercent || '0',
  }];
  const items = sourceItems.map((item, index) => {
    const itemId = optionalNumber(item.itemId);
    const quantity = optionalNumber(item.quantity);
    if (!itemId) throw new Error(`Inventory item id is required for item ${index + 1}`);
    if (!quantity) throw new Error(`Quantity is required for item ${index + 1}`);
    return {
      itemId,
      quantity,
      unit: item.unit.trim() || undefined,
      requiresScan: item.requiresScan,
      requiresApproval: item.requiresApproval,
      highValueFlag: item.highValueFlag,
      varianceToleranceQty: Number(item.varianceToleranceQty || 0),
      varianceTolerancePercent: Number(item.varianceTolerancePercent || 0),
    };
  });
  return {
    ruleName,
    triggerType: form.triggerType,
    triggerId: optionalNumber(form.triggerId),
    department: form.department.trim() || undefined,
    defaultStoreId: optionalNumber(form.defaultStoreId),
    deductionMode: form.deductionMode,
    items,
  };
}

export type ConsumptionConfirmItemState = {
  eventItemId: number;
  expectedQuantity: number;
  actualQuantity: string;
  varianceReason: string;
};

export function buildConsumptionConfirmationPayload(items: ConsumptionConfirmItemState[]) {
  return {
    items: items.map((item) => ({
      eventItemId: item.eventItemId,
      expectedQuantity: Number(item.expectedQuantity),
      actualQuantity: Number(item.actualQuantity),
      varianceReason: item.varianceReason.trim() || undefined,
    })),
  };
}

interface ConsumptionRule {
  RuleId: number;
  RuleName: string;
  TriggerType: string;
  Department?: string | null;
  DeductionMode: string;
  IsActive?: number;
}

interface ConsumptionEventItemDetail {
  EventItemId: number;
  ItemId: number;
  ItemName?: string | null;
  ItemCode?: string | null;
  ExpectedQuantity: number;
  ActualQuantity?: number | null;
  Unit?: string | null;
  VarianceReason?: string | null;
}

interface ConsumptionEventDetail {
  event: ConsumptionEvent;
  items: ConsumptionEventItemDetail[];
}

interface ConsumptionEvent {
  EventId: number;
  EventNo: string;
  TriggerType: string;
  PatientId?: number | null;
  Department?: string | null;
  DeductionMode: string;
  Status: string;
  ExpectedAt?: string;
}

interface ConsumptionReconciliationSummary {
  totalEvents: number;
  expectedQty: number;
  actualQty: number;
  varianceQty: number;
  highVarianceRows: number;
}

interface ConsumptionReconciliationRow {
  Department?: string | null;
  Status?: string | null;
  EventCount: number;
  ExpectedQty: number;
  ActualQty: number;
  VarianceQty: number;
}

interface ConsumptionReconciliationReport {
  rows: ConsumptionReconciliationRow[];
  summary: ConsumptionReconciliationSummary;
}

interface ConsumptionRuleCoverageSummary {
  totalTriggers: number;
  coveredTriggers: number;
  missingTriggers: number;
  eventCount: number;
  missingRuleEvents: number;
}

interface ConsumptionRuleCoverageRow {
  TriggerType: string;
  TriggerId?: number | null;
  TriggerCode?: string | null;
  Department?: string | null;
  EventCount: number;
  MatchedRuleEvents: number;
  MissingRuleEvents: number;
  RuleCount: number;
  HasActiveRule: number;
}

interface ConsumptionRuleCoverageReport {
  rows: ConsumptionRuleCoverageRow[];
  summary: ConsumptionRuleCoverageSummary;
}

interface ConsumptionException {
  ExceptionId: number;
  EventId?: number | null;
  Reason: string;
  Severity: string;
  Status: string;
  Message: string;
  CreatedOn?: string;
}

interface InventoryItemOption {
  ItemId: number;
  ItemName: string;
  ItemCode?: string | null;
}

interface InventoryStoreOption {
  StoreId: number;
  StoreName: string;
  StoreCode?: string | null;
}

function inventoryConsumptionSeedToast(summary?: { rules?: number; created?: number; skipped?: number }): string {
  if (!summary) return 'Starter consumption rules checked.';
  return `Starter consumption rules checked: ${Number(summary.rules ?? 0)} rules, ${Number(summary.created ?? 0)} created, ${Number(summary.skipped ?? 0)} skipped.`;
}

function modeMeta(mode: ConsumptionAutomationMode) {
  if (mode === 'queue') return { title: 'Consumption Queue', icon: Activity, description: 'Confirm actual OT/procedure/ward usage before stock posting.' };
  if (mode === 'exceptions') return { title: 'Consumption Exceptions', icon: AlertTriangle, description: 'Review missing rule, stock shortage, scan, approval, and variance issues.' };
  return { title: 'Consumption Rules', icon: ClipboardList, description: 'Map service/procedure/OT triggers to expected inventory items.' };
}

export default function InventoryConsumptionAutomation({ role = 'hospital_admin', mode = 'rules' }: { role?: string; mode?: ConsumptionAutomationMode }) {
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const meta = modeMeta(mode);
  const Icon = meta.icon;
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<ConsumptionRuleFormState>(defaultConsumptionRuleForm);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedEventItems, setSelectedEventItems] = useState<ConsumptionEventItemDetail[]>([]);
  const [selectedEventStatus, setSelectedEventStatus] = useState<string | null>(null);
  const [varianceReviewNote, setVarianceReviewNote] = useState('Accepted actual usage after review');
  const [confirmItems, setConfirmItems] = useState<ConsumptionConfirmItemState[]>([]);
  const [queueStatusFilter, setQueueStatusFilter] = useState<ConsumptionQueueStatusFilter>('pending_confirmation');
  const [exceptionSeverityFilter, setExceptionSeverityFilter] = useState<ConsumptionExceptionSeverityFilter>('all');
  const [ruleCoverageMissingOnly, setRuleCoverageMissingOnly] = useState(false);
  const [ruleCoverageFilters, setRuleCoverageFilters] = useState<ConsumptionRuleCoverageFilters>({});
  const [reconciliationFilters, setReconciliationFilters] = useState<ConsumptionReconciliationFilters>({});

  const { data: rulesData, isLoading: loadingRules } = useApiQuery<{ data: ConsumptionRule[] }>(
    ['inventory', 'consumption-rules'],
    '/api/inventory/consumption-rules',
    { enabled: mode === 'rules' },
  );
  const { data: inventoryItemsData } = useApiQuery<{ data: InventoryItemOption[] }>(
    ['inventory', 'consumption-rule-items'],
    '/api/inventory/items?page=1&limit=300',
    { enabled: mode === 'rules' },
  );
  const { data: inventoryStoresData } = useApiQuery<{ data: InventoryStoreOption[] }>(
    ['inventory', 'consumption-rule-stores'],
    '/api/inventory/stores?page=1&limit=100',
    { enabled: mode === 'rules' },
  );
  const { data: ruleCoverageData } = useApiQuery<{ data: ConsumptionRuleCoverageReport }>(
    ['inventory', 'consumption-rule-coverage', ruleCoverageFilters.from, ruleCoverageFilters.to, ruleCoverageFilters.department, ruleCoverageFilters.triggerType],
    buildConsumptionRuleCoverageEndpoint(ruleCoverageFilters),
    { enabled: mode === 'rules' },
  );
  const { data: eventsData, isLoading: loadingEvents } = useApiQuery<{ data: ConsumptionEvent[] }>(
    ['inventory', 'consumption-events', queueStatusFilter],
    buildConsumptionQueueEndpoint(queueStatusFilter),
    { enabled: mode === 'queue' },
  );
  const { data: exceptionsData, isLoading: loadingExceptions } = useApiQuery<{ data: ConsumptionException[] }>(
    ['inventory', 'consumption-exceptions', 'open'],
    '/api/inventory/consumption-exceptions?status=open&limit=100',
    { enabled: mode === 'exceptions' },
  );
  const { data: reconciliationData } = useApiQuery<{ data: ConsumptionReconciliationReport }>(
    ['inventory', 'consumption-reconciliation', reconciliationFilters.from, reconciliationFilters.to, reconciliationFilters.department],
    buildConsumptionReconciliationEndpoint(reconciliationFilters),
    { enabled: mode === 'queue' },
  );

  const rules = rulesData?.data ?? [];
  const events = eventsData?.data ?? [];
  const exceptions = exceptionsData?.data ?? [];
  const visibleExceptions = filterConsumptionExceptionsBySeverity(exceptions, exceptionSeverityFilter);
  const inventoryItems = inventoryItemsData?.data ?? [];
  const inventoryStores = inventoryStoresData?.data ?? [];
  const reconciliationSummary = reconciliationData?.data?.summary;
  const reconciliationRows = reconciliationData?.data?.rows ?? [];
  const highVarianceRows = buildHighVarianceReconciliationRows(reconciliationRows);
  const ruleCoverageSummary = ruleCoverageData?.data?.summary;
  const ruleCoverageRows = ruleCoverageData?.data?.rows ?? [];
  const visibleRuleCoverageRows = ruleCoverageMissingOnly ? ruleCoverageRows.filter((row) => Number(row.MissingRuleEvents ?? 0) > 0 || Number(row.HasActiveRule ?? 0) === 0) : ruleCoverageRows;
  const hasRuleCoverageFilters = Boolean(ruleCoverageFilters.from || ruleCoverageFilters.to || ruleCoverageFilters.department || ruleCoverageFilters.triggerType);
  const ruleCoverageEmptyStateMessage = buildRuleCoverageEmptyStateMessage({ totalRows: ruleCoverageRows.length, visibleRows: visibleRuleCoverageRows.length, filtersActive: hasRuleCoverageFilters, missingOnly: ruleCoverageMissingOnly });

  function updateConsumptionRuleItem(index: number, patch: Partial<ConsumptionRuleFormItemState>) {
    setRuleForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  function addConsumptionRuleItem() {
    setRuleForm((current) => ({
      ...current,
      items: [...current.items, { ...defaultConsumptionRuleForm.items[0] }],
    }));
  }

  function removeConsumptionRuleItem(index: number) {
    setRuleForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((_, itemIndex) => itemIndex !== index) : current.items,
    }));
  }

  function startRuleFromMissingTrigger(row: ConsumptionRuleCoverageRow) {
    setRuleForm(buildMissingTriggerRuleDraft(row));
    setShowRuleForm(true);
  }

  async function handleSeedStarterConsumptionRules() {
    try {
      const result = await api.post<{ summary?: { rules?: number; created?: number; skipped?: number } }>('/api/inventory/consumption-rules/defaults/seed', {});
      toast.success(inventoryConsumptionSeedToast(result.summary));
      queryClient.invalidateQueries({ queryKey: ['inventory', 'consumption-rules'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to load starter consumption rules');
    }
  }

  async function saveConsumptionRule(event: React.FormEvent) {
    event.preventDefault();
    try {
      const payload = buildConsumptionRulePayload(ruleForm);
      await api.post('/api/inventory/consumption-rules', payload);
      toast.success('Consumption rule saved');
      setRuleForm(defaultConsumptionRuleForm);
      setShowRuleForm(false);
      queryClient.invalidateQueries({ queryKey: ['inventory', 'consumption-rules'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to save consumption rule');
    }
  }

  async function openConfirmEvent(eventId: number) {
    setBusyId(eventId);
    try {
      const detail = await api.get<{ data: ConsumptionEventDetail }>(`/api/inventory/consumption-events/${eventId}`);
      const items = detail.data.items ?? [];
      setSelectedEventId(eventId);
      setSelectedEventItems(items);
      setSelectedEventStatus(detail.data.event?.Status ?? null);
      setVarianceReviewNote('Accepted actual usage after review');
      setConfirmItems(items.map((item) => ({
        eventItemId: item.EventItemId,
        expectedQuantity: Number(item.ExpectedQuantity ?? 0),
        actualQuantity: String(item.ActualQuantity ?? item.ExpectedQuantity ?? 0),
        varianceReason: item.VarianceReason ?? '',
      })));
    } catch (err: any) {
      toast.error(err.message || 'Failed to load consumption event');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmEvent(eventId: number) {
    setBusyId(eventId);
    try {
      const result = await api.post<{ data?: { status?: string } }>(`/api/inventory/consumption-events/${eventId}/confirm`, buildConsumptionConfirmationPayload(confirmItems));
      setSelectedEventStatus(result.data?.status ?? null);
      toast.success(result.data?.status === 'variance_review' ? 'Variance sent for review' : 'Consumption event confirmed');
      queryClient.invalidateQueries({ queryKey: ['inventory', 'consumption-events', 'pending'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to confirm consumption event');
    } finally {
      setBusyId(null);
    }
  }

  async function reviewConsumptionVarianceEvent(eventId: number) {
    setBusyId(eventId);
    try {
      const note = normalizeVarianceReviewNote(varianceReviewNote);
      const result = await api.post<{ data?: { status?: string } }>(`/api/inventory/consumption-events/${eventId}/review-variance`, { note });
      setSelectedEventStatus(result.data?.status ?? 'confirmed');
      setVarianceReviewNote('Accepted actual usage after review');
      toast.success('Variance reviewed and confirmed');
      queryClient.invalidateQueries({ queryKey: ['inventory', 'consumption-events', queueStatusFilter] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to review variance');
    } finally {
      setBusyId(null);
    }
  }

  async function postConsumptionEvent(eventId: number) {
    setBusyId(eventId);
    try {
      await api.post(`/api/inventory/consumption-events/${eventId}/post`, {});
      toast.success('Stock deduction posted');
      setSelectedEventStatus('posted');
      setSelectedEventId(null);
      setSelectedEventItems([]);
      setConfirmItems([]);
      queryClient.invalidateQueries({ queryKey: ['inventory', 'consumption-events', 'pending'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to post stock deduction');
    } finally {
      setBusyId(null);
    }
  }

  async function reviewException(exceptionId: number) {
    setBusyId(exceptionId);
    try {
      await api.post(`/api/inventory/consumption-exceptions/${exceptionId}/review`, { status: 'reviewed', resolutionNote: 'Reviewed from inventory consumption UI' });
      toast.success('Exception marked reviewed');
      queryClient.invalidateQueries({ queryKey: ['inventory', 'consumption-exceptions', 'open'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to review exception');
    } finally {
      setBusyId(null);
    }
  }

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportReconciliationCsv() {
    downloadCsv(buildConsumptionReconciliationCsv(reconciliationRows), 'consumption-reconciliation.csv');
  }

  function exportRuleCoverageCsv() {
    downloadCsv(buildConsumptionRuleCoverageCsv(visibleRuleCoverageRows), 'consumption-rule-coverage.csv');
  }

  function exportConsumptionExceptionsCsv() {
    downloadCsv(buildConsumptionExceptionsCsv(visibleExceptions), 'consumption-exceptions.csv');
  }

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><Icon className="w-6 h-6 inline mr-2" />{meta.title}</h1>
            <p className="section-subtitle">{meta.description}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link to={`${base}/inventory/consumption-rules`} className={`btn-secondary text-sm ${mode === 'rules' ? 'ring-2 ring-violet-300' : ''}`}>Rules</Link>
            <Link to={`${base}/inventory/consumption-queue`} className={`btn-secondary text-sm ${mode === 'queue' ? 'ring-2 ring-violet-300' : ''}`}>Queue</Link>
            <Link to={`${base}/inventory/consumption-exceptions`} className={`btn-secondary text-sm ${mode === 'exceptions' ? 'ring-2 ring-violet-300' : ''}`}>Exceptions</Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="card p-4"><p className="text-xs text-[var(--color-text-muted)]">Rules</p><p className="text-2xl font-semibold">{rules.length}</p></div>
          <div className="card p-4"><p className="text-xs text-[var(--color-text-muted)]">Queue results</p><p className="text-2xl font-semibold">{events.length}</p></div>
          <div className="card p-4"><p className="text-xs text-[var(--color-text-muted)]">Open exceptions</p><p className="text-2xl font-semibold">{exceptions.length}</p></div>
          {mode === 'rules' && <div data-testid="consumption-rule-coverage-card" className="card p-4 md:col-span-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><p className="text-xs text-[var(--color-text-muted)]">Rule coverage</p><p className="text-sm mt-2">Triggers {ruleCoverageSummary?.totalTriggers ?? 0} · Covered {ruleCoverageSummary?.coveredTriggers ?? 0} · Missing {ruleCoverageSummary?.missingTriggers ?? 0} · Missing events {ruleCoverageSummary?.missingRuleEvents ?? 0}</p></div><div className="flex items-center gap-3"><label className="text-xs flex items-center gap-2"><input data-testid="rule-coverage-missing-only" type="checkbox" checked={ruleCoverageMissingOnly} onChange={(event) => setRuleCoverageMissingOnly(event.target.checked)} /> Missing only</label><button data-testid="export-rule-coverage-csv" type="button" className="btn-secondary text-xs" disabled={visibleRuleCoverageRows.length === 0} onClick={exportRuleCoverageCsv}>Export CSV</button></div></div><div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3"><input data-testid="rule-coverage-from" className="input" type="date" value={ruleCoverageFilters.from || ''} onChange={(event) => setRuleCoverageFilters((current) => ({ ...current, from: event.target.value || undefined }))} /><input data-testid="rule-coverage-to" className="input" type="date" value={ruleCoverageFilters.to || ''} onChange={(event) => setRuleCoverageFilters((current) => ({ ...current, to: event.target.value || undefined }))} /><input data-testid="rule-coverage-department" className="input" placeholder="Department filter" value={ruleCoverageFilters.department || ''} onChange={(event) => setRuleCoverageFilters((current) => ({ ...current, department: event.target.value || undefined }))} /><select data-testid="rule-coverage-trigger-type" className="input" value={ruleCoverageFilters.triggerType || ''} onChange={(event) => setRuleCoverageFilters((current) => ({ ...current, triggerType: event.target.value || undefined }))}><option value="">All trigger types</option><option value="billing_item">Billing item</option><option value="procedure">Procedure</option><option value="ot_procedure">OT procedure</option><option value="nursing_task">Nursing task</option><option value="emergency_service">Emergency service</option><option value="package">Package</option></select></div>{visibleRuleCoverageRows.length > 0 ? <div className="overflow-x-auto mt-4" data-testid="consumption-rule-coverage-table"><table className="table"><thead><tr><th>Trigger</th><th>Department</th><th>Events</th><th>Rules</th><th>Missing</th><th>Action</th></tr></thead><tbody>{visibleRuleCoverageRows.map((row, index) => <tr key={`${row.TriggerType}-${row.TriggerId || row.TriggerCode || index}`}><td>{row.TriggerType}{row.TriggerId ? ` #${row.TriggerId}` : row.TriggerCode ? ` ${row.TriggerCode}` : ''}</td><td>{row.Department || 'Unassigned'}</td><td>{row.EventCount}</td><td>{row.RuleCount}</td><td>{row.MissingRuleEvents}</td><td>{(Number(row.MissingRuleEvents ?? 0) > 0 || Number(row.HasActiveRule ?? 0) === 0) && <button data-testid="create-rule-from-missing-trigger" type="button" className="btn-secondary text-xs" onClick={() => startRuleFromMissingTrigger(row)}>Create rule</button>}</td></tr>)}</tbody></table></div> : <div data-testid="rule-coverage-empty-state" className="mt-4 rounded-2xl border border-dashed p-4 text-sm text-[var(--color-text-muted)]"><p>{ruleCoverageEmptyStateMessage}</p>{hasRuleCoverageFilters && <button data-testid="clear-rule-coverage-filters" type="button" className="btn-secondary text-xs mt-3" onClick={() => setRuleCoverageFilters({})}>Clear filters</button>}</div>}</div>}
          {mode === 'queue' && <div data-testid="consumption-reconciliation-card" className="card p-4 md:col-span-3">
            <p className="text-xs text-[var(--color-text-muted)]">Expected vs actual</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
              <input data-testid="consumption-reconciliation-from" className="input" type="date" value={reconciliationFilters.from || ''} onChange={(event) => setReconciliationFilters((current) => ({ ...current, from: event.target.value || undefined }))} />
              <input data-testid="consumption-reconciliation-to" className="input" type="date" value={reconciliationFilters.to || ''} onChange={(event) => setReconciliationFilters((current) => ({ ...current, to: event.target.value || undefined }))} />
              <input data-testid="consumption-reconciliation-department" className="input" placeholder="Department filter" value={reconciliationFilters.department || ''} onChange={(event) => setReconciliationFilters((current) => ({ ...current, department: event.target.value || undefined }))} />
            </div>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mt-2">
              <p className="text-sm">Events {reconciliationSummary?.totalEvents ?? 0} · Expected {reconciliationSummary?.expectedQty ?? 0} · Actual {reconciliationSummary?.actualQty ?? 0} · Difference {formatConsumptionVarianceQty(reconciliationSummary?.varianceQty)} · Review rows {reconciliationSummary?.highVarianceRows ?? 0}</p>
              <button data-testid="export-reconciliation-csv" type="button" className="btn-secondary text-xs" disabled={reconciliationRows.length === 0} onClick={exportReconciliationCsv}>Export CSV</button>
            </div>
            {highVarianceRows.length > 0 && <div data-testid="high-variance-reconciliation-alerts" className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-800">High variance alerts</p><div className="grid gap-2 mt-2 md:grid-cols-2">{highVarianceRows.map((row, index) => <div key={`${row.Department || 'none'}-${row.Status || 'none'}-${index}`} className="rounded-xl bg-white/80 border border-amber-100 p-3 text-sm"><p className="font-semibold">{row.Department || 'Unassigned'} · {consumptionEventStatusLabel(row.Status)}</p><p className="text-[var(--color-text-muted)]">Expected {row.ExpectedQty}, Actual {row.ActualQty}, Difference {formatConsumptionVarianceQty(row.VarianceQty)}</p></div>)}</div></div>}
            {reconciliationRows.length > 0 && <div className="overflow-x-auto mt-4" data-testid="consumption-reconciliation-table"><table className="table"><thead><tr><th>Department</th><th>Status</th><th>Events</th><th>Expected</th><th>Actual</th><th>Difference</th></tr></thead><tbody>{reconciliationRows.map((row, index) => <tr key={`${row.Department || 'none'}-${row.Status || 'none'}-${index}`}><td>{row.Department || 'Unassigned'}</td><td>{consumptionEventStatusLabel(row.Status)}</td><td>{row.EventCount}</td><td>{row.ExpectedQty}</td><td>{row.ActualQty}</td><td>{formatConsumptionVarianceQty(row.VarianceQty)}</td></tr>)}</tbody></table></div>}
          </div>}
        </div>

        {mode === 'rules' && (
          <div className="card p-5" data-testid="consumption-rules-panel">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Consumption Rules</h2>
              <div className="flex gap-2"><button data-testid="seed-inventory-consumption-rules" className="btn-secondary text-sm" type="button" onClick={handleSeedStarterConsumptionRules}>Load starter rules</button><button className="btn-primary text-sm" type="button" onClick={() => setShowRuleForm((value) => !value)}><Plus className="w-4 h-4" /> Add rule</button></div>
            </div>
            {showRuleForm && (
              <form data-testid="create-consumption-rule-form" onSubmit={saveConsumptionRule} className="mb-5 rounded-2xl border border-violet-100 bg-violet-50/40 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <input className="input" aria-label="Rule name" value={ruleForm.ruleName} onChange={e => setRuleForm({ ...ruleForm, ruleName: e.target.value })} placeholder="Rule name, e.g. Dressing Small" />
                <select className="input" aria-label="Trigger type" value={ruleForm.triggerType} onChange={e => setRuleForm({ ...ruleForm, triggerType: e.target.value })}><option value="billing_item">Billing item</option><option value="procedure">Procedure</option><option value="ot_procedure">OT procedure</option><option value="nursing_task">Nursing task</option><option value="emergency_service">Emergency service</option><option value="package">Package</option></select>
                <input className="input" aria-label="Department" value={ruleForm.department} onChange={e => setRuleForm({ ...ruleForm, department: e.target.value })} placeholder="Department" />
                <select className="input" aria-label="Deduction mode" value={ruleForm.deductionMode} onChange={e => setRuleForm({ ...ruleForm, deductionMode: e.target.value })}><option value="auto">Auto deduct</option><option value="suggest_confirm">Suggest + confirm</option><option value="scan_required">Scan required</option><option value="approval_required">Approval required</option><option value="manual_only">Manual only</option></select>
                <input className="input" aria-label="Trigger ID" inputMode="numeric" value={ruleForm.triggerId} onChange={e => setRuleForm({ ...ruleForm, triggerId: e.target.value })} placeholder="Trigger ID optional" />
                <select className="input" aria-label="Default store" value={ruleForm.defaultStoreId} onChange={e => setRuleForm({ ...ruleForm, defaultStoreId: e.target.value })}><option value="">Select default store</option>{inventoryStores.map(store => <option key={store.StoreId} value={store.StoreId}>{store.StoreName}{store.StoreCode ? ` (${store.StoreCode})` : ''}</option>)}</select>
                <div className="md:col-span-4 space-y-3">
                  <div className="flex items-center justify-between"><h3 className="font-semibold text-sm">Expected inventory items</h3><button type="button" className="btn-secondary text-xs" onClick={addConsumptionRuleItem}>Add item</button></div>
                  {ruleForm.items.map((item, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-6 gap-2 rounded-xl border bg-white/70 p-3">
                      <select className="input" aria-label={`Inventory item ${index + 1}`} value={item.itemId} onChange={e => updateConsumptionRuleItem(index, { itemId: e.target.value })}><option value="">Select inventory item</option>{inventoryItems.map(option => <option key={option.ItemId} value={option.ItemId}>{option.ItemName}{option.ItemCode ? ` (${option.ItemCode})` : ''}</option>)}</select>
                      <input className="input" aria-label={`Quantity ${index + 1}`} inputMode="decimal" value={item.quantity} onChange={e => updateConsumptionRuleItem(index, { quantity: e.target.value })} placeholder="Qty" />
                      <input className="input" aria-label={`Unit ${index + 1}`} value={item.unit} onChange={e => updateConsumptionRuleItem(index, { unit: e.target.value })} placeholder="Unit" />
                      <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={item.requiresScan} onChange={e => updateConsumptionRuleItem(index, { requiresScan: e.target.checked })} /> Scan</label>
                      <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={item.requiresApproval} onChange={e => updateConsumptionRuleItem(index, { requiresApproval: e.target.checked })} /> Approval</label>
                      <div className="flex items-center justify-end"><button type="button" className="btn-secondary text-xs" onClick={() => removeConsumptionRuleItem(index)}>Remove item</button></div>
                    </div>
                  ))}
                </div>
                <div className="md:col-span-4 flex justify-end gap-2"><button type="button" className="btn-secondary text-sm" onClick={() => setShowRuleForm(false)}>Cancel</button><button type="submit" className="btn-primary text-sm">Save rule</button></div>
              </form>
            )}
            {loadingRules ? <p className="text-sm text-[var(--color-text-muted)]">Loading rules…</p> : rules.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No consumption rules yet. Start with procedure and OT starter rules.</p> : (
              <div className="overflow-x-auto"><table className="table"><thead><tr><th>Rule</th><th>Trigger</th><th>Department</th><th>Mode</th><th>Status</th></tr></thead><tbody>{rules.map(rule => <tr key={rule.RuleId}><td>{rule.RuleName}</td><td>{rule.TriggerType}</td><td>{rule.Department || '—'}</td><td>{consumptionDeductionModeLabel(rule.DeductionMode)}</td><td>{rule.IsActive === 0 ? 'Inactive' : 'Active'}</td></tr>)}</tbody></table></div>
            )}
          </div>
        )}

        {mode === 'queue' && (
          <div className="card p-5" data-testid="consumption-queue-panel">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4"><PackageCheck className="w-5 h-5" /> Consumption Queue</h2>
            <select data-testid="consumption-queue-status-filter" className="input max-w-xs mb-4" value={queueStatusFilter} onChange={(event) => setQueueStatusFilter(event.target.value as ConsumptionQueueStatusFilter)}>
              <option value="pending_confirmation">Pending confirmation</option>
              <option value="confirmed">Confirmed ready to post</option>
              <option value="variance_review">Variance review</option>
              <option value="posted">Posted history</option>
            </select>
            {selectedEventId && (
              <form data-testid="confirm-actual-usage-form" onSubmit={(event) => { event.preventDefault(); void confirmEvent(selectedEventId); }} className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between"><h3 className="font-semibold">Confirm actual usage</h3><button type="button" className="btn-secondary text-xs" onClick={() => { setSelectedEventId(null); setSelectedEventItems([]); setSelectedEventStatus(null); setConfirmItems([]); }}>Close</button></div>
                {confirmItems.map((item, index) => { const detail = selectedEventItems.find(row => row.EventItemId === item.eventItemId); return <div key={item.eventItemId} className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-xl border bg-white/70 p-3"><div><p className="font-medium text-sm">{detail?.ItemName || `Item ${detail?.ItemId || item.eventItemId}`}</p><p className="text-xs text-[var(--color-text-muted)]">Expected: {item.expectedQuantity} {detail?.Unit || ''}</p></div><input className="input" aria-label={`Actual quantity ${index + 1}`} inputMode="decimal" value={item.actualQuantity} onChange={e => setConfirmItems(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, actualQuantity: e.target.value } : row))} /><input className="input" aria-label={`Variance reason ${index + 1}`} value={item.varianceReason} onChange={e => setConfirmItems(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, varianceReason: e.target.value } : row))} placeholder="Variance reason if changed" /><div className="flex items-center justify-end"><span className="badge">{Number(item.actualQuantity || 0) - item.expectedQuantity}</span></div></div>; })}
                {canReviewConsumptionVarianceFromUiStatus(selectedEventStatus) && <div data-testid="variance-review-note-form" className="rounded-xl border bg-white/70 p-3"><label className="text-sm font-medium" htmlFor="variance-review-note">Variance review note</label><textarea id="variance-review-note" data-testid="variance-review-note" className="input mt-2 min-h-24" value={varianceReviewNote} onChange={(event) => setVarianceReviewNote(event.target.value)} /></div>}<div className="flex justify-end gap-2"><button type="submit" className="btn-primary text-sm" disabled={busyId === selectedEventId}>Confirm actual usage</button>{canReviewConsumptionVarianceFromUiStatus(selectedEventStatus) && <button data-testid="review-variance-action" type="button" className="btn-secondary text-sm" disabled={busyId === selectedEventId} onClick={() => void reviewConsumptionVarianceEvent(selectedEventId)}>Review variance</button>}{canPostConsumptionFromUiStatus(selectedEventStatus) && <button data-testid="post-stock-deduction" type="button" className="btn-secondary text-sm" disabled={busyId === selectedEventId} onClick={() => void postConsumptionEvent(selectedEventId)}>Post stock deduction</button>}</div>
              </form>
            )}
            {loadingEvents ? <p className="text-sm text-[var(--color-text-muted)]">Loading queue…</p> : events.length === 0 ? <div data-testid="consumption-queue-empty-state" className="rounded-2xl border border-dashed p-4 text-sm text-[var(--color-text-muted)]"><p>{buildConsumptionQueueEmptyStateMessage(queueStatusFilter)}</p><p className="mt-2">Use another queue filter or review rule coverage if an expected workflow did not create a consumption event.</p></div> : (
              <div className="space-y-3">{events.map(event => <div key={event.EventId} className="rounded-xl border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><p className="font-semibold">{event.EventNo}</p><p className="text-sm text-[var(--color-text-muted)]">{event.TriggerType} · {event.Department || 'No department'} · Patient {event.PatientId || '—'}</p><span className="badge mt-2">{consumptionEventStatusLabel(event.Status)}</span></div><button type="button" className="btn-secondary text-sm" disabled={busyId === event.EventId} onClick={() => openConfirmEvent(event.EventId)}><CheckCircle2 className="w-4 h-4" /> Confirm actual</button></div>)}</div>
            )}
          </div>
        )}

        {mode === 'exceptions' && (
          <div className="card p-5" data-testid="consumption-exceptions-panel">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4"><h2 className="text-lg font-semibold flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Open Exceptions</h2><div className="flex items-center gap-2"><select data-testid="consumption-exception-severity-filter" className="input max-w-xs" value={exceptionSeverityFilter} onChange={(event) => setExceptionSeverityFilter(event.target.value as ConsumptionExceptionSeverityFilter)}><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select><button data-testid="export-consumption-exceptions-csv" type="button" className="btn-secondary text-xs" disabled={visibleExceptions.length === 0} onClick={exportConsumptionExceptionsCsv}>Export CSV</button></div></div>
            {loadingExceptions ? <p className="text-sm text-[var(--color-text-muted)]">Loading exceptions…</p> : visibleExceptions.length === 0 ? <div data-testid="consumption-exceptions-empty-state" className="rounded-2xl border border-dashed p-4 text-sm text-[var(--color-text-muted)]"><p>{buildConsumptionExceptionEmptyStateMessage({ totalRows: exceptions.length, visibleRows: visibleExceptions.length, severity: exceptionSeverityFilter })}</p>{exceptionSeverityFilter !== 'all' && <button data-testid="clear-consumption-exception-severity-filter" type="button" className="btn-secondary text-xs mt-3" onClick={() => setExceptionSeverityFilter('all')}>Clear severity filter</button>}</div> : (
              <div className="space-y-3">{visibleExceptions.map(exception => <div key={exception.ExceptionId} className="rounded-xl border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><p className="font-semibold">{exception.Reason.replace(/_/g, ' ')}</p><p className="text-sm text-[var(--color-text-muted)]">{exception.Message}</p><span className={`inline-flex mt-2 px-2 py-1 rounded-full border text-xs ${consumptionExceptionSeverityClass(exception.Severity)}`}>{exception.Severity}</span></div><button type="button" className="btn-secondary text-sm" disabled={busyId === exception.ExceptionId} onClick={() => reviewException(exception.ExceptionId)}><RefreshCw className="w-4 h-4" /> Mark reviewed</button></div>)}</div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

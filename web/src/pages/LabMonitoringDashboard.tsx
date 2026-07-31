import { useState, useMemo, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical, Package, AlertTriangle, TrendingUp, Calendar,
  Plus, Search, Filter, ArrowUpDown, Beaker, Film, Printer,
  Activity, Trash2, Pencil, X, ChevronRight, HelpCircle,
  RefreshCw, Boxes, ClipboardList, BarChart3, Clock, Cpu, CheckCircle2, Circle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import ReagentControlTabs from './laboratory/reagent-control/ReagentControlTabs';
import ReagentControlOverview from './laboratory/reagent-control/ReagentControlOverview';
import ReagentRecipeManager from './laboratory/reagent-control/ReagentRecipeManager';
import ReagentControlIssues from './laboratory/reagent-control/ReagentControlIssues';
import ReagentControlAdvancedPanel from './laboratory/reagent-control/ReagentControlAdvancedPanel';
import {
  REAGENT_CONTROL_PRIMARY_TABS,
  initialReagentControlSection,
  reagentControlNextActions,
  reagentControlQueryState,
  reagentPolicySummary,
  type ReagentControlSection,
} from './laboratory/reagent-control/reagentControlModel';

/* ─── Types ─── */
interface Consumable {
  id: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  unit_price: number;
  reorder_level: number;
  reorder_qty: number;
  total_stock: number;
  expiring_lots: number;
}

interface AlertData {
  low_stock: Consumable[];
  expiring: Array<{
    id: number; name: string; lot_number: string; expiry_date: string;
    quantity_available: number; days_remaining: number;
  }>;
}

interface DailySummary {
  summary_date: string;
  total_orders: number;
  total_tests_done: number;
  total_tests_pending: number;
  total_reports_printed: number;
  total_reagents_used: number;
  total_films_used: number;
  revenue_from_lab: number;
  abnormal_results: number;
}

interface OperationLog {
  id: number;
  log_type: string;
  test_name?: string;
  consumable_name?: string;
  machine_name?: string;
  quantity: number;
  description?: string;
  performed_by_name?: string;
  created_at: string;
}

interface LabStockLocation {
  id: number;
  location_code: string;
  location_name: string;
  location_type: string;
  description?: string | null;
}

interface LabMachine {
  id: number;
  machine_name?: string | null;
  machine_code?: string | null;
  status?: string | null;
}

interface AnalyzerMachineHealth {
  machine_id: number;
  machine_name: string;
  machine_code?: string | null;
  open_unmatched_results: number;
  active_assignments: number;
  needs_attention: boolean;
}

export interface LabInventoryPolicy {
  lab_inventory_mode: 'disabled' | 'soft' | 'strict';
  reagent_consumption_timing: 'billing' | 'result';
  allow_result_without_stock: boolean;
  require_test_mapping_for_completion: boolean;
}

interface LabInventoryCapabilities {
  strict_mode_available: boolean;
  strict_billing_atomicity_ready: boolean;
  reason: string;
}

export const FIRST_HOSPITAL_LAB_INVENTORY_POLICY: LabInventoryPolicy = {
  lab_inventory_mode: 'soft',
  reagent_consumption_timing: 'billing',
  allow_result_without_stock: true,
  require_test_mapping_for_completion: false,
};

export const STRICT_PRODUCTION_LAB_INVENTORY_POLICY: LabInventoryPolicy = {
  lab_inventory_mode: 'strict',
  reagent_consumption_timing: 'billing',
  allow_result_without_stock: false,
  require_test_mapping_for_completion: true,
};

interface LabInventoryException {
  id: number;
  lab_order_id?: number | null;
  lab_order_item_id?: number | null;
  lab_test_id?: number | null;
  consumable_id?: number | null;
  source_event: string;
  severity: 'warning' | 'error' | string;
  reason: string;
  message: string;
  metadata_json?: string | null;
  status: 'open' | 'resolved' | 'ignored' | string;
  created_by?: string | number | null;
  resolved_by?: string | number | null;
  resolved_at?: string | null;
  resolution_remarks?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface AnalyzerHealth {
  open_unmatched_results: number;
  machines_total: number;
  active_assignments: number;
  machines_with_active_assignment: number;
  inventory_reagent_lots: number;
  unassigned_inventory_lots: number;
  machine_breakdown?: AnalyzerMachineHealth[];
}

type LisGoLiveStatus = 'ready' | 'warning' | 'blocked';

interface LisGoLiveCheck {
  id: string;
  label: string;
  status: LisGoLiveStatus;
  detail: string;
  action?: string | null;
}

interface LisGoLiveReadiness {
  overall_status: LisGoLiveStatus;
  readiness_score: number;
  machine_id?: number | null;
  checks: LisGoLiveCheck[];
  summary: { blockers: number; warnings: number; ready: number };
}

interface LisDeploymentChecklistItem {
  id: string;
  title: string;
  owner: string;
  evidence: string;
  endpoint?: string | null;
  notes?: string | null;
}

interface LisDeploymentChecklistStage {
  id: string;
  title: string;
  purpose: string;
  items: LisDeploymentChecklistItem[];
}

interface StockLot {
  id: number;
  consumable_id?: number;
  consumable_name?: string | null;
  consumable_code?: string | null;
  consumable_unit?: string | null;
  lot_number?: string | null;
  expiry_date?: string | null;
  quantity_available: number;
  location_id?: number | null;
  qc_status?: string;
  opened_at?: string | null;
  onboard_expires_at?: string | null;
  location_name?: string | null;
  active_assignment_id?: number | null;
  assigned_machine_id?: number | null;
  assigned_machine_name?: string | null;
  assigned_machine_code?: string | null;
  analyzer_location_id?: number | null;
  analyzer_location_name?: string | null;
  analyzer_location_code?: string | null;
  analyzer_assigned_at?: string | null;
  analyzer_assignment_remarks?: string | null;
  ledger_type?: 'lab' | 'inventory' | string;
}


interface LabTestCatalogItem {
  id: number;
  code: string;
  name: string;
  category?: string | null;
}

interface TestConsumableMapping {
  id: number;
  lab_test_id: number;
  consumable_id: number;
  qty_per_test: number;
  is_mandatory: number | boolean;
  notes?: string | null;
  test_name: string;
  test_code?: string | null;
  consumable_name: string;
  consumable_code?: string | null;
  unit?: string | null;
  category?: string | null;
}



interface MappingCoverageRow {
  lab_test_id: number;
  code?: string | null;
  name: string;
  category?: string | null;
  department?: string | null;
  test_type?: string | null;
  mapping_count: number;
  mandatory_count: number;
  expected_quantity: number;
  status: 'mapped' | 'missing' | string;
}

interface MappingCoverageSummary {
  total_tests: number;
  mapped_tests: number;
  missing_tests: number;
  expected_quantity: number;
  coverage_percent: number;
  coverage_target_min?: number;
  qc_failed_usable_lots?: number;
  open_stock_shortage_exceptions?: number;
  strict_mode_ready: boolean;
}

interface ReagentReconciliationRow {
  lab_order_item_id: number;
  lab_order_id: number;
  lab_test_id: number;
  test_name: string;
  order_no?: string | null;
  patient_name?: string | null;
  bill_id: number;
  invoice_no?: string | null;
  bill_date?: string | null;
  expected_quantity: number;
  consumed_quantity: number;
  consumed_cost: number;
  exception_count: number;
  status: 'ok' | 'missing' | 'exception' | string;
  status_meaning?: string | null;
}

interface ReagentReconciliationSummary {
  tests: number;
  ok: number;
  missing: number;
  exception: number;
  expected_quantity: number;
  consumed_quantity: number;
  consumed_cost: number;
  exceptions: number;
}

interface WasteRequest {
  id: number;
  stock_id: number;
  consumable_name: string;
  consumable_code?: string;
  lot_number?: string | null;
  location_name?: string | null;
  quantity: number;
  reason: string;
  remarks?: string | null;
  status: string;
  requested_by_name?: string | null;
  reviewed_by_name?: string | null;
  requested_at?: string | null;
  reviewed_at?: string | null;
  review_remarks?: string | null;
}

interface LabCatalogTest {
  id: number;
  code?: string | null;
  name: string;
  category?: string | null;
}

interface ReagentUsageRule {
  id: number;
  lab_test_id: number;
  consumable_id: number;
  qty_per_test: number;
  is_mandatory: number | boolean;
  notes?: string | null;
  test_name?: string | null;
  test_code?: string | null;
  consumable_name?: string | null;
  consumable_code?: string | null;
  unit?: string | null;
  category?: string | null;
}

/* ─── Helpers ─── */
function categoryIcon(cat: string) {
  switch (cat) {
    case 'reagent': return <Beaker className="w-4 h-4" />;
    case 'film': return <Film className="w-4 h-4" />;
    case 'tube': return <Activity className="w-4 h-4" />;
    default: return <Package className="w-4 h-4" />;
  }
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    reagent: 'Reagent', tube: 'Tube', strip: 'Strip', film: 'Film',
    chemical: 'Chemical', kit: 'Kit', slide: 'Slide', syringe: 'Syringe', other: 'Other',
  };
  return map[cat] || cat;
}

function moneyInputToPaisa(value: string): number {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function paisaToTakaInput(value: number | null | undefined): string {
  const taka = Number(value ?? 0) / 100;
  return Number.isFinite(taka) ? String(Number(taka.toFixed(2))) : '0';
}

function logTypeIcon(type: string) {
  switch (type) {
    case 'test_performed': return <FlaskConical className="w-4 h-4 text-sky-500" />;
    case 'reagent_used': return <Beaker className="w-4 h-4 text-amber-500" />;
    case 'film_used': return <Film className="w-4 h-4 text-fuchsia-500" />;
    case 'print_made': return <Printer className="w-4 h-4 text-emerald-500" />;
    case 'machine_run': return <Activity className="w-4 h-4 text-blue-500" />;
    case 'waste_disposed': return <Trash2 className="w-4 h-4 text-red-500" />;
    default: return <ClipboardList className="w-4 h-4 text-slate-500" />;
  }
}

function logTypeLabel(type: string) {
  const map: Record<string, string> = {
    test_performed: 'Test Performed',
    reagent_used: 'Reagent Used',
    film_used: 'Film Used',
    print_made: 'Print Made',
    machine_run: 'Machine Run',
    qc_performed: 'QC Performed',
    calibration: 'Calibration',
    maintenance: 'Maintenance',
    waste_disposed: 'Waste Disposed',
  };
  return map[type] || type;
}

export function isInventoryBackedStockLot(lot: Pick<StockLot, 'ledger_type'>): boolean {
  return lot.ledger_type === 'inventory';
}

export function canUseLabMonitoringLotMetadataAction(_lot: Pick<StockLot, 'ledger_type'>): boolean {
  return true;
}

export function canUseLegacyLabStockOnlyAction(lot: Pick<StockLot, 'ledger_type'>): boolean {
  return !isInventoryBackedStockLot(lot);
}

const PRODUCTION_USABLE_QC_STATUSES = new Set(['accepted', 'passed', 'not_required']);

export function normalizeStockLotQcStatus(status?: string | null): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized || 'not_required';
}

export function isProductionUsableStockLot(lot: Pick<StockLot, 'qc_status'>): boolean {
  return PRODUCTION_USABLE_QC_STATUSES.has(normalizeStockLotQcStatus(lot.qc_status));
}

export function stockLotProductionLockLabel(lot: Pick<StockLot, 'qc_status'>): string {
  const status = normalizeStockLotQcStatus(lot.qc_status);
  if (PRODUCTION_USABLE_QC_STATUSES.has(status)) return 'Production usable';
  if (status === 'pending') return 'Production locked until QC Pass';
  if (status === 'failed') return 'Production blocked: QC failed';
  return 'Production blocked by QC status';
}

function stockLotQcBadgeClass(lot: Pick<StockLot, 'qc_status'>): string {
  const status = normalizeStockLotQcStatus(lot.qc_status);
  if (PRODUCTION_USABLE_QC_STATUSES.has(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

type OpenVialTone = 'neutral' | 'success' | 'warning' | 'danger';

type OpenVialFormState = {
  stock_id: string;
  onboard_expiry_days: string;
  remarks: string;
  ledger_type: string;
};

type MachineAssignmentFormState = {
  stock_id: string;
  machine_id: string;
  location_id: string;
  remarks: string;
};

export const WASTE_REASON_OPTIONS = [
  { value: 'expired', label: 'Expired', help: 'Use when the reagent lot is past expiry or open-vial expiry.' },
  { value: 'broken', label: 'Broken', help: 'Use when bottle, kit, tube, or packaging is physically damaged.' },
  { value: 'qc_failed', label: 'QC failed', help: 'Use when the lot failed QC and must not be used in production.' },
  { value: 'spillage', label: 'Spillage', help: 'Use when reagent was lost due to spill, leakage, or handling incident.' },
  { value: 'temperature_breach', label: 'Temperature breach', help: 'Use when cold-chain or storage temperature was breached.' },
  { value: 'other', label: 'Other', help: 'Use only with clear remarks when the reason does not match the standard categories.' },
] as const;

export type WasteReason = typeof WASTE_REASON_OPTIONS[number]['value'];

export type WasteFormState = {
  stock_id: string;
  quantity: string;
  reason: string;
  remarks: string;
};

const WASTE_REASON_SET = new Set<string>(WASTE_REASON_OPTIONS.map(option => option.value));

export function normalizedWasteReason(reason?: string | null): WasteReason {
  const normalized = String(reason ?? '').trim().toLowerCase();
  return WASTE_REASON_SET.has(normalized) ? normalized as WasteReason : 'other';
}

export function wasteReasonLabel(reason?: string | null): string {
  return WASTE_REASON_OPTIONS.find(option => option.value === normalizedWasteReason(reason))?.label ?? 'Other';
}

export function wasteReasonHelp(reason?: string | null): string {
  return WASTE_REASON_OPTIONS.find(option => option.value === normalizedWasteReason(reason))?.help ?? WASTE_REASON_OPTIONS[WASTE_REASON_OPTIONS.length - 1].help;
}

export function isWasteRequestFormReady(form: WasteFormState): boolean {
  const stockId = Number(form.stock_id);
  const quantity = Number(form.quantity);
  const reason = String(form.reason ?? '').trim().toLowerCase();
  const remarks = String(form.remarks ?? '').trim();
  return Number.isInteger(stockId)
    && stockId > 0
    && Number.isInteger(quantity)
    && quantity > 0
    && WASTE_REASON_SET.has(reason)
    && form.remarks.length <= 500
    && (reason !== 'other' || remarks.length > 0);
}

export function wasteRequestPayload(form: WasteFormState): { stock_id: number; quantity: number; reason: WasteReason; remarks?: string } {
  const stockId = parsePositiveInteger(form.stock_id, 'Enter a valid stock lot ID');
  const quantity = parsePositiveInteger(form.quantity, 'Enter a valid waste quantity');
  const reason = String(form.reason ?? '').trim().toLowerCase();
  const remarks = String(form.remarks ?? '').trim();

  if (!stockId) throw new Error('Enter a valid stock lot ID');
  if (!quantity) throw new Error('Enter a valid waste quantity');
  if (!WASTE_REASON_SET.has(reason)) throw new Error('Select waste reason');
  if (form.remarks.length > 500) throw new Error('Waste remarks must be within 500 characters');
  if (reason === 'other' && !remarks) throw new Error('Enter remarks for other waste reason');

  return {
    stock_id: stockId,
    quantity,
    reason: reason as WasteReason,
    ...(remarks ? { remarks } : {}),
  };
}

function wasteStatusClass(status?: string | null): string {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

export function bangladeshDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partMap = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

export function isOpenVialFormReady(form: OpenVialFormState): boolean {
  const stockId = Number(form.stock_id);
  const days = Number(form.onboard_expiry_days);
  return Number.isInteger(stockId)
    && stockId > 0
    && Number.isInteger(days)
    && days >= 1
    && days <= 365
    && form.remarks.length <= 500
    && (form.ledger_type === 'lab' || form.ledger_type === 'inventory');
}

export function isMachineAssignmentFormReady(form: MachineAssignmentFormState): boolean {
  const stockId = Number(form.stock_id);
  const machineId = form.machine_id ? Number(form.machine_id) : null;
  const locationId = form.location_id ? Number(form.location_id) : null;
  const machineValid = machineId === null || (Number.isInteger(machineId) && machineId > 0);
  const locationValid = locationId === null || (Number.isInteger(locationId) && locationId > 0);
  return Number.isInteger(stockId)
    && stockId > 0
    && machineValid
    && locationValid
    && Boolean(machineId || locationId)
    && form.remarks.length <= 500;
}

export function stockLotOpenVialStatus(
  lot: Pick<StockLot, 'opened_at' | 'onboard_expires_at'>,
  today: string = bangladeshDateString(),
): { label: string; tone: OpenVialTone } {
  const openedAt = String(lot.opened_at ?? '').slice(0, 10);
  const expiresAt = String(lot.onboard_expires_at ?? '').slice(0, 10);
  if (!openedAt && !expiresAt) return { label: 'Not opened', tone: 'neutral' };
  if (!expiresAt) return { label: 'Open-vial expiry not set', tone: 'warning' };
  if (expiresAt < today) return { label: `Open-vial expired ${expiresAt}`, tone: 'danger' };
  if (expiresAt === today) return { label: 'Open-vial expires today', tone: 'warning' };
  return { label: `Open-vial valid until ${expiresAt}`, tone: 'success' };
}

function stockLotOpenVialBadgeClass(status: { tone: OpenVialTone }): string {
  if (status.tone === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status.tone === 'danger') return 'bg-red-50 text-red-700 border-red-200';
  if (status.tone === 'warning') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function inventoryRoute(base: string, path: 'transfers' | 'write-off'): string {
  const normalizedBase = base.replace(/\/$/, '');
  return normalizedBase + '/inventory/' + path;
}

export function analyzerMachineNeedsAttention(machine?: Partial<AnalyzerMachineHealth> | null): boolean {
  if (!machine) return false;
  return Boolean(machine.needs_attention) || Number(machine.open_unmatched_results ?? 0) > 0 || Number(machine.active_assignments ?? 0) === 0;
}

export function analyzerHealthNeedsAttention(health?: Partial<AnalyzerHealth> | null): boolean {
  if (!health) return false;
  return Number(health.open_unmatched_results ?? 0) > 0
    || Number(health.unassigned_inventory_lots ?? 0) > 0
    || Boolean(health.machine_breakdown?.some(analyzerMachineNeedsAttention));
}

export function lisGoLiveStatusLabel(status?: string | null): string {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'ready') return 'Ready for go-live';
  if (normalized === 'blocked') return 'Blocked';
  if (normalized === 'warning') return 'Needs review';
  return 'Not checked';
}

export function lisGoLiveStatusClass(status?: string | null): string {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (normalized === 'blocked') return 'border-red-200 bg-red-50 text-red-800';
  if (normalized === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function lisGoLivePrimaryAction(readiness?: Partial<LisGoLiveReadiness> | null): { label: string; target: 'mappings' | 'stock' | 'exceptions' } {
  const checks = readiness?.checks ?? [];
  if (checks.some(check => check.id === 'test-mapping' && check.status === 'blocked')) return { label: 'Fix test mappings', target: 'mappings' };
  if (checks.some(check => check.id === 'reagent-readiness' && check.status !== 'ready')) return { label: 'Review reagent readiness', target: 'stock' };
  if (checks.some(check => check.status !== 'ready')) return { label: 'Review exceptions', target: 'exceptions' };
  return { label: 'Review deployment checklist', target: 'stock' };
}

export function lisDeploymentChecklistProgress(stages?: LisDeploymentChecklistStage[] | null): { stages: number; items: number } {
  const list = stages ?? [];
  return {
    stages: list.length,
    items: list.reduce((sum, stage) => sum + (stage.items?.length ?? 0), 0),
  };
}

export const MANUAL_USAGE_TYPE_OPTIONS = [
  { value: 'rerun', labelKey: 'manualUsageTypes.rerun.label', helpKey: 'manualUsageTypes.rerun.help' },
  { value: 'control', labelKey: 'manualUsageTypes.control.label', helpKey: 'manualUsageTypes.control.help' },
  { value: 'qc', labelKey: 'manualUsageTypes.qc.label', helpKey: 'manualUsageTypes.qc.help' },
  { value: 'calibration', labelKey: 'manualUsageTypes.calibration.label', helpKey: 'manualUsageTypes.calibration.help' },
  { value: 'manual', labelKey: 'manualUsageTypes.manual.label', helpKey: 'manualUsageTypes.manual.help' },
  { value: 'other', labelKey: 'manualUsageTypes.other.label', helpKey: 'manualUsageTypes.other.help' },
] as const;

export type ManualUsageType = typeof MANUAL_USAGE_TYPE_OPTIONS[number]['value'];

export type ManualUsageFormState = {
  consumable_id: string;
  quantity: string;
  usage_type: string;
  location_id: string;
  reference_id: string;
  remarks: string;
};

const MANUAL_USAGE_TYPE_SET = new Set<string>(MANUAL_USAGE_TYPE_OPTIONS.map(option => option.value));

function parsePositiveInteger(value: string, errorMessage: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) throw new Error(errorMessage);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(errorMessage);
  return parsed;
}

export function normalizedManualUsageType(usageType?: string | null): ManualUsageType {
  const normalized = usageType && usageType.trim() ? usageType.trim().toLowerCase() : 'manual';
  return MANUAL_USAGE_TYPE_SET.has(normalized) ? normalized as ManualUsageType : 'other';
}

export function manualUsageReferenceType(usageType?: string | null): string {
  return 'manual_' + normalizedManualUsageType(usageType);
}

export function manualUsageRecordPayload(form: ManualUsageFormState): { consumableId: number; body: { quantity: number; usage_type: ManualUsageType; reference_type: string; reference_id?: number; location_id?: number; remarks: string } } {
  const consumableId = parsePositiveInteger(form.consumable_id, 'Select consumable');
  const quantity = Number(form.quantity || '0');
  const usageType = normalizedManualUsageType(form.usage_type);
  const remarks = (form.remarks || '').trim();
  const referenceId = parsePositiveInteger(form.reference_id, 'Reference ID must be a positive number');
  const locationId = parsePositiveInteger(form.location_id, 'Location must be valid');

  if (!consumableId) throw new Error('Select consumable');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a valid quantity');
  if (!remarks) throw new Error('Enter remarks for the manual usage audit trail');

  return {
    consumableId,
    body: {
      quantity,
      usage_type: usageType,
      reference_type: manualUsageReferenceType(usageType),
      ...(referenceId ? { reference_id: referenceId } : {}),
      ...(locationId ? { location_id: locationId } : {}),
      remarks,
    },
  };
}

export function mappingUpdatePayload(qtyPerTest: string | number, isMandatory: boolean, notes?: string | null) {
  const qty = Number(qtyPerTest);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Qty per test must be greater than zero');
  return {
    qty_per_test: qty,
    is_mandatory: isMandatory,
    notes: notes && notes.trim() ? notes.trim() : null,
  };
}

export function labInventoryConsumptionPolicyLabel(value?: string | null): string {
  return value === 'result' ? 'Result/LIS auto finalization (future)' : 'Billing-time semi-auto recommended now';
}

export function labInventoryModeLabel(value?: string | null): string {
  if (value === 'strict') return 'Strict production mode';
  if (value === 'disabled') return 'Disabled';
  return 'Soft setup mode';
}

export function labInventoryPolicyMatchesFirstHospitalPreset(policy?: Partial<LabInventoryPolicy> | null): boolean {
  return Boolean(policy)
    && policy?.lab_inventory_mode === FIRST_HOSPITAL_LAB_INVENTORY_POLICY.lab_inventory_mode
    && policy?.reagent_consumption_timing === FIRST_HOSPITAL_LAB_INVENTORY_POLICY.reagent_consumption_timing
    && policy?.allow_result_without_stock === FIRST_HOSPITAL_LAB_INVENTORY_POLICY.allow_result_without_stock
    && policy?.require_test_mapping_for_completion === FIRST_HOSPITAL_LAB_INVENTORY_POLICY.require_test_mapping_for_completion;
}

export function labInventoryExceptionReasonLabel(value?: string | null): string {
  const map: Record<string, string> = {
    insufficient_stock: 'Stock shortage',
    missing_stock: 'Stock shortage',
    missing_test_mapping: 'Missing reagent mapping',
    claim_conflict: 'Duplicate/locked consumption',
    consumption_failed: 'Consumption failed',
    billing_time_consumption_failed: 'Billing-time consumption failed',
    qc_failed_lot: 'QC failed lot',
    qc_failed_usable_lot: 'QC failed usable lot',
  };
  return value ? map[value] || value.replace(/_/g, ' ') : 'Inventory exception';
}

export function labInventoryExceptionResolutionGuide(value?: string | null) {
  const guides: Record<string, { title: string; action: string; tab: 'mappings' | 'stock' | 'readiness' | 'exceptions'; retry: string }> = {
    missing_test_mapping: {
      title: 'Add the missing test-to-reagent mapping first.',
      action: 'Open Mappings, select the billed lab test, map the required reagent/consumable, set qty per test, then save.',
      tab: 'mappings',
      retry: 'After the mapping is saved, retry the exception so the billed test can deduct reagent stock.',
    },
    insufficient_stock: {
      title: 'Add available stock before retrying.',
      action: 'Open Stock controls and add GRN/opening stock, correct location, lot, expiry, unit cost, and available quantity.',
      tab: 'stock',
      retry: 'After stock is available, retry the exception to post the reagent consumption ledger.',
    },
    missing_stock: {
      title: 'Add available stock before retrying.',
      action: 'Open Stock controls and add GRN/opening stock, correct location, lot, expiry, unit cost, and available quantity.',
      tab: 'stock',
      retry: 'After stock is available, retry the exception to post the reagent consumption ledger.',
    },
    qc_failed_lot: {
      title: 'Do not consume from a failed QC lot.',
      action: 'Open Stock controls, quarantine/replace the failed lot, or pass another usable lot after QC review.',
      tab: 'stock',
      retry: 'After a usable lot is available, retry the exception; otherwise resolve/ignore with remarks after admin review.',
    },
    qc_failed_usable_lot: {
      title: 'Do not consume from a failed QC lot.',
      action: 'Open Stock controls, quarantine/replace the failed lot, or pass another usable lot after QC review.',
      tab: 'stock',
      retry: 'After a usable lot is available, retry the exception; otherwise resolve/ignore with remarks after admin review.',
    },
  };
  return guides[value || ''] || {
    title: 'Review the operational cause before closing.',
    action: 'Check mapping, stock, lot status, and the original source event. Fix the root cause before marking it reviewed.',
    tab: 'exceptions' as const,
    retry: 'Retry only when the root cause is fixed. If not applicable, resolve or ignore with a clear audit note.',
  };
}

export function labInventoryExceptionSeverityClass(value?: string | null): string {
  return value === 'warning'
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-red-50 text-red-700 border-red-200';
}

export function isMandatoryMapping(value: number | boolean | string | null | undefined): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}


export function mappingCoverageStatusClass(value?: string | null): string {
  return value === 'mapped'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
}

export function reagentReconciliationStatusClass(value?: string | null): string {
  if (value === 'ok') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (value === 'exception') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

export function reagentReconciliationStatusLabel(value?: string | null): string {
  if (value === 'ok') return 'OK';
  if (value === 'exception') return 'Exception';
  if (value === 'missing') return 'Missing';
  return value ? value.replace(/_/g, ' ') : 'Missing';
}

export function reagentReconciliationStatusMeaning(value?: string | null): string {
  if (value === 'ok') return 'Expected reagent deducted';
  if (value === 'exception') return 'Deduction failed/needs review';
  return 'Mapping/stock missing';
}

export const REAGENT_RECONCILIATION_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'ok', label: 'OK — expected reagent deducted' },
  { value: 'missing', label: 'Missing — mapping/stock missing' },
  { value: 'exception', label: 'Exception — deduction failed/needs review' },
] as const;

export const STRICT_MODE_COVERAGE_TARGET_MIN = 95;

type StrictModeReadinessCheck = {
  id: 'coverage' | 'missing-maps' | 'qc-failed-lots' | 'stock-shortage-exceptions';
  label: string;
  value: string;
  target: string;
  ready: boolean;
  detail: string;
};

export function buildStrictModeReadinessChecks(summary?: Partial<MappingCoverageSummary> | null): StrictModeReadinessCheck[] {
  const totalTests = Number(summary?.total_tests ?? 0);
  const mappedTests = Number(summary?.mapped_tests ?? 0);
  const missingTests = Number(summary?.missing_tests ?? 0);
  const coveragePercent = Number(summary?.coverage_percent ?? 0);
  const targetMin = Number(summary?.coverage_target_min ?? STRICT_MODE_COVERAGE_TARGET_MIN);
  const qcFailedUsableLots = Number(summary?.qc_failed_usable_lots ?? 0);
  const openStockShortageExceptions = Number(summary?.open_stock_shortage_exceptions ?? 0);

  return [
    {
      id: 'coverage',
      label: 'Coverage',
      value: totalTests > 0 ? `${coveragePercent}%` : 'Not checked',
      target: `${targetMin}–100%`,
      ready: totalTests > 0 && coveragePercent >= targetMin,
      detail: `${mappedTests}/${totalTests} active billing tests mapped.`,
    },
    {
      id: 'missing-maps',
      label: 'Missing maps',
      value: String(missingTests),
      target: '0 for active billing tests',
      ready: totalTests > 0 && missingTests === 0,
      detail: missingTests === 0 ? 'No active billing test mapping gaps.' : 'Complete reagent mapping before strict mode.',
    },
    {
      id: 'qc-failed-lots',
      label: 'QC failed usable lot',
      value: String(qcFailedUsableLots),
      target: '0',
      ready: qcFailedUsableLots === 0,
      detail: qcFailedUsableLots === 0 ? 'Failed QC lots are not usable for production.' : 'Quarantine, transfer out, or write off failed QC lots.',
    },
    {
      id: 'stock-shortage-exceptions',
      label: 'Stock shortage exception',
      value: String(openStockShortageExceptions),
      target: 'Resolved / 0 open',
      ready: openStockShortageExceptions === 0,
      detail: openStockShortageExceptions === 0 ? 'No open stock-shortage blocker.' : 'Resolve shortage exceptions before strict mode.',
    },
  ];
}

export function strictModeReadinessMessage(summary?: Partial<MappingCoverageSummary> | null): string {
  const totalTests = Number(summary?.total_tests ?? 0);
  if (!summary || totalTests === 0) return 'No active billing lab tests found for mapping coverage.';

  const missingTests = Number(summary.missing_tests ?? 0);
  const qcFailedUsableLots = Number(summary.qc_failed_usable_lots ?? 0);
  const openStockShortageExceptions = Number(summary.open_stock_shortage_exceptions ?? 0);
  const coveragePercent = Number(summary.coverage_percent ?? 0);
  const targetMin = Number(summary.coverage_target_min ?? STRICT_MODE_COVERAGE_TARGET_MIN);

  if (openStockShortageExceptions > 0) {
    return `${openStockShortageExceptions} open stock shortage exception${openStockShortageExceptions === 1 ? '' : 's'} must be resolved before strict mode.`;
  }
  if (qcFailedUsableLots > 0) {
    return `${qcFailedUsableLots} QC-failed usable stock lot${qcFailedUsableLots === 1 ? '' : 's'} must be quarantined, transferred out, or written off before strict mode.`;
  }
  if (missingTests > 0) {
    return `${missingTests} active billing lab test${missingTests === 1 ? ' still needs reagent mapping' : 's still need reagent mappings'} before strict mode.`;
  }
  if (coveragePercent < targetMin) {
    return `Coverage is ${coveragePercent}%. Target is ${targetMin}–100% before strict mode.`;
  }
  if (summary.strict_mode_ready) {
    return `Strict mode ready: coverage is ${coveragePercent}%, active billing tests have 0 missing maps, QC-failed usable lots are 0, and stock shortage exceptions are resolved.`;
  }
  return 'Strict mode is not ready yet. Review the readiness checks before enabling production blocking.';
}

export function buildReagentSetupChecklist(input: {
  consumableCount: number;
  locationCount: number;
  mappingSummary?: Partial<MappingCoverageSummary> | null;
  policy?: Partial<LabInventoryPolicy> | null;
}) {
  const mappedTests = Number(input.mappingSummary?.mapped_tests ?? 0);
  const missingTests = Number(input.mappingSummary?.missing_tests ?? 0);
  const billingTimeReady = input.policy?.reagent_consumption_timing === 'billing';
  const softModeReady = !input.policy?.lab_inventory_mode || input.policy.lab_inventory_mode === 'soft';

  return [
    { id: 'catalog', label: 'Load default catalog', done: input.consumableCount > 0, tab: 'mappings' as const, detail: 'Start with editable default test-equivalent reagent mappings.' },
    { id: 'locations', label: 'Create stock locations', done: input.locationCount > 0, tab: 'stock' as const, detail: 'Add lab store/fridge/shelf locations before stock-in.' },
    { id: 'mappings', label: 'Review test mappings', done: mappedTests > 0 && missingTests === 0, tab: 'readiness' as const, detail: missingTests > 0 ? `${missingTests} active lab tests still need mapping.` : 'Use readiness report to verify active tests.' },
    { id: 'policy', label: 'Keep soft billing-time policy', done: billingTimeReady && softModeReady, tab: 'mappings' as const, detail: 'Recommended rollout: soft mode + billing-time deduction.' },
    { id: 'reconcile', label: 'Reconcile after first billing day', done: false, tab: 'readiness' as const, detail: 'Use reconciliation to confirm billed tests match reagent deduction.' },
  ];
}

export function defaultReagentCatalogSeedToast(summary?: { tests?: number; consumables?: number; mappings?: number }): string {
  if (!summary) return 'Default reagent catalog loaded.';
  return `Default reagent catalog loaded: ${Number(summary.tests ?? 0)} tests checked, ${Number(summary.consumables ?? 0)} consumables checked, ${Number(summary.mappings ?? 0)} new mappings added.`;
}

function splitBulkMappingCsvLine(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  parts.push(current.trim());
  return parts;
}

function isBulkMappingHeaderRow(parts: string[]): boolean {
  const normalized = parts.map(part => part.toLowerCase().replace(/[^a-z_]/g, ''));
  return normalized[0] === 'lab_test_id' && normalized[1] === 'consumable_id';
}

export function parseBulkMappingCsvInput(value: string): Array<{ lab_test_id: number; consumable_id: number; qty_per_test: number; is_mandatory: boolean; notes?: string }> {
  return value
    .split(/\r?\n/)
    .map((rawLine, index) => ({ line: rawLine.trim(), lineNumber: index + 1 }))
    .filter(row => row.line && !row.line.startsWith('#'))
    .map(row => ({ ...row, parts: splitBulkMappingCsvLine(row.line) }))
    .filter(row => !isBulkMappingHeaderRow(row.parts))
    .map(({ parts, lineNumber }) => {
      const [testIdRaw, consumableIdRaw, qtyRaw = '1', mandatoryRaw = 'true', ...notesParts] = parts;
      const lab_test_id = Number(testIdRaw);
      const consumable_id = Number(consumableIdRaw);
      const qty_per_test = Number(qtyRaw || '1');
      if (!Number.isInteger(lab_test_id) || lab_test_id <= 0) throw new Error(`Line ${lineNumber}: invalid lab test id`);
      if (!Number.isInteger(consumable_id) || consumable_id <= 0) throw new Error(`Line ${lineNumber}: invalid consumable id`);
      if (!Number.isFinite(qty_per_test) || qty_per_test <= 0) throw new Error(`Line ${lineNumber}: invalid qty/test`);
      return {
        lab_test_id,
        consumable_id,
        qty_per_test,
        is_mandatory: !['false', '0', 'no', 'optional'].includes(String(mandatoryRaw || '').toLowerCase()),
        notes: notesParts.join(', ').trim() || undefined,
      };
    });
}

export function labInventoryPolicyStrictReadinessWarning(
  patch: Partial<LabInventoryPolicy>,
  currentPolicy: LabInventoryPolicy,
  summary?: Partial<MappingCoverageSummary> | null,
): string | null {
  const nextPolicy = { ...currentPolicy, ...patch };
  const enablingStrictMode = patch.lab_inventory_mode === 'strict' && currentPolicy.lab_inventory_mode !== 'strict';
  const enablingRequiredMappings = patch.require_test_mapping_for_completion === true && !currentPolicy.require_test_mapping_for_completion;
  if (!enablingStrictMode && !enablingRequiredMappings) return null;
  if (nextPolicy.lab_inventory_mode !== 'strict' && !nextPolicy.require_test_mapping_for_completion) return null;

  const totalTests = Number(summary?.total_tests ?? 0);
  const missingTests = Number(summary?.missing_tests ?? 0);
  const hasCoveragePercent = summary?.coverage_percent !== undefined && summary?.coverage_percent !== null;
  const coveragePercent = Number(summary?.coverage_percent ?? 0);
  const targetMin = Number(summary?.coverage_target_min ?? STRICT_MODE_COVERAGE_TARGET_MIN);
  const qcFailedUsableLots = Number(summary?.qc_failed_usable_lots ?? 0);
  const openStockShortageExceptions = Number(summary?.open_stock_shortage_exceptions ?? 0);
  const coverageReady = !hasCoveragePercent || coveragePercent >= targetMin;
  if (!summary || totalTests === 0) return 'Run mapping coverage before enabling strict reagent controls.';
  if (summary.strict_mode_ready && missingTests === 0 && coverageReady && qcFailedUsableLots === 0 && openStockShortageExceptions === 0) return null;
  if (missingTests > 0) return `${missingTests} active billing lab test${missingTests === 1 ? ' still needs reagent mapping' : 's still need reagent mappings'} before strict reagent controls.`;
  if (hasCoveragePercent && coveragePercent < targetMin) return `Mapping coverage is ${coveragePercent}%. Target is ${targetMin}–100% before strict reagent controls.`;
  if (qcFailedUsableLots > 0) return `${qcFailedUsableLots} QC-failed usable stock lot${qcFailedUsableLots === 1 ? '' : 's'} must be quarantined, transferred out, or written off before strict reagent controls.`;
  if (openStockShortageExceptions > 0) return `${openStockShortageExceptions} open stock shortage exception${openStockShortageExceptions === 1 ? '' : 's'} must be resolved before strict reagent controls.`;
  return 'Strict reagent controls are not ready yet. Review readiness checks first.';
}
type LabMonitoringTab = 'overview' | 'consumables' | 'stock' | 'readiness' | 'mappings' | 'exceptions' | 'logs' | 'alerts' | 'recipes' | 'issues';
export type LabMonitoringMode = 'lab-monitoring' | 'reagent-control';

export const REAGENT_CONTROL_MAIN_TABS = REAGENT_CONTROL_PRIMARY_TABS;

const LAB_MONITORING_TAB_ICONS: Record<LabMonitoringTab, typeof BarChart3> = {
  overview: BarChart3,
  consumables: Boxes,
  stock: Package,
  readiness: Activity,
  mappings: FlaskConical,
  exceptions: AlertTriangle,
  logs: ClipboardList,
  alerts: AlertTriangle,
  recipes: FlaskConical,
  issues: AlertTriangle,
};

export function initialLabMonitoringTab(mode: LabMonitoringMode = 'lab-monitoring'): LabMonitoringTab {
  return mode === 'reagent-control' ? initialReagentControlSection() : 'overview';
}

export function labMonitoringTabsForMode(
  mode: LabMonitoringMode = 'lab-monitoring',
  labels: Partial<Record<LabMonitoringTab, string>> = {},
): Array<{ id: LabMonitoringTab; label: string }> {
  if (mode === 'reagent-control') return [...REAGENT_CONTROL_MAIN_TABS];

  return [
    { id: 'overview', label: labels.overview ?? 'Overview' },
    { id: 'consumables', label: labels.consumables ?? 'Consumables' },
    { id: 'stock', label: labels.stock ?? 'Stock Controls' },
    { id: 'readiness', label: labels.readiness ?? 'Readiness' },
    { id: 'mappings', label: labels.mappings ?? 'Test Mapping' },
    { id: 'exceptions', label: labels.exceptions ?? 'Exceptions' },
    { id: 'logs', label: labels.logs ?? 'Operation Logs' },
    { id: 'alerts', label: labels.alerts ?? 'Alerts' },
  ];
}

type ReagentStarterCommandInput = {
  policyTiming?: 'billing' | 'result' | string | null;
  inventoryMode?: 'disabled' | 'soft' | 'strict' | string | null;
  mappedTests?: number | null;
  missingTests?: number | null;
  openExceptions?: number | null;
  reconciliationMissing?: number | null;
  reconciliationExceptions?: number | null;
};

type ReagentStarterAction = {
  tab: LabMonitoringTab;
  label: string;
  description: string;
};

type ReagentStarterCommandState = {
  headline: string;
  tone: 'warning' | 'success';
  description: string;
  summary: string;
  statusTitle: string;
  statusHint: string;
  actions: ReagentStarterAction[];
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function reagentStarterCommandState(input: ReagentStarterCommandInput): ReagentStarterCommandState {
  const mappedTests = Number(input.mappedTests ?? 0);
  const missingTests = Number(input.missingTests ?? 0);
  const openExceptions = Number(input.openExceptions ?? 0);
  const reconciliationMissing = Number(input.reconciliationMissing ?? 0);
  const reconciliationExceptions = Number(input.reconciliationExceptions ?? 0);
  const reconciliationIssues = reconciliationMissing + reconciliationExceptions;
  const billingFirst = input.policyTiming !== 'result';
  const inventoryDisabled = input.inventoryMode === 'disabled';
  const strictMode = input.inventoryMode === 'strict';
  const modeLabel = strictMode ? 'strict mode' : inventoryDisabled ? 'disabled mode' : 'soft mode';
  const hasRisk = inventoryDisabled || missingTests > 0 || openExceptions > 0 || reconciliationIssues > 0;
  const headline = inventoryDisabled
    ? 'Reagent stock deduction is currently disabled'
    : `${billingFirst ? 'Billing-time' : 'Result-time'} reagent deduction is running in ${modeLabel}`;
  const description = billingFirst
    ? 'When a lab test bill is created, HMS checks the reagent recipe and records stock deduction or exception. LIS machine automation can stay secondary until integration is ready.'
    : 'When a lab result is completed, HMS checks the reagent recipe and records stock deduction or exception. Switch to billing-time control when reception-led rollout is ready.';

  let statusTitle = 'Ready for pilot control';
  let statusHint = 'Soft mode is safe for rollout; move to strict mode when hospital stock data is verified.';

  if (inventoryDisabled) {
    statusTitle = 'Enable soft mode before rollout';
    statusHint = 'Turn on soft reagent control so billing can record deduction attempts and create exceptions without blocking service.';
  } else if (missingTests > 0) {
    statusTitle = `${missingTests} test ${pluralize(missingTests, 'mapping')} need setup`;
    statusHint = 'Map missing lab tests first; keep soft mode active until coverage is complete.';
  } else if (openExceptions > 0) {
    statusTitle = `${openExceptions} open ${pluralize(openExceptions, 'exception')} need review`;
    statusHint = 'Review the exception queue and correct stock or mapping issues before enabling strict mode.';
  } else if (reconciliationIssues > 0) {
    statusTitle = `${reconciliationIssues} reconciliation ${pluralize(reconciliationIssues, 'issue')} need review`;
    statusHint = 'Open reconciliation and clear missing or exception rows before enabling strict mode.';
  } else if (strictMode) {
    statusTitle = 'Strict mode ready and active';
    statusHint = 'All core checks are clean; billing-time deduction can block unsafe stock cases.';
  }

  return {
    headline,
    tone: hasRisk ? 'warning' : 'success',
    description,
    summary: `${mappedTests} tests mapped · ${missingTests} need mapping · ${openExceptions} exceptions open · ${reconciliationIssues} reconciliation issues`,
    statusTitle,
    statusHint,
    actions: [
      {
        tab: 'mappings',
        label: missingTests > 0 ? `Fix ${missingTests} missing ${pluralize(missingTests, 'mapping')}` : 'Review mappings',
        description: 'Open test-to-reagent recipes →',
      },
      {
        tab: 'readiness',
        label: strictMode ? 'Check strict readiness' : 'Prepare strict mode',
        description: 'Open rollout checklist →',
      },
      {
        tab: 'exceptions',
        label: openExceptions > 0 || reconciliationExceptions > 0 ? 'Resolve exceptions' : 'Review exceptions',
        description: 'Open exception queue →',
      },
    ],
  };
}

/* ─── Skeleton ─── */
function SkeletonCard() {
  return <div className="rounded-xl border border-[var(--color-border)] p-4 animate-pulse space-y-3">
    <div className="h-3 bg-[var(--color-bg-secondary)] rounded w-24" />
    <div className="h-8 bg-[var(--color-bg-secondary)] rounded w-16" />
  </div>;
}

/* ─── Main Page ─── */
export default function LabMonitoringDashboard({
  role = 'hospital_admin',
  mode = 'lab-monitoring',
}: {
  role?: string;
  mode?: LabMonitoringMode;
}) {
  const { t } = useTranslation(['laboratory', 'common']);
  const { slug } = useParams<{ slug: string }>();
  const base = slug ? '/h/' + slug : '';
  const queryClient = useQueryClient();
  const isReagentControlPage = mode === 'reagent-control';
  const canManageLabInventory = ['laboratory', 'lab', 'hospital_admin', 'director'].includes(role);
  const [tab, setTab] = useState<LabMonitoringTab>(initialLabMonitoringTab(mode));
  const [helpOpen, setHelpOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [stockAdvancedOpen, setStockAdvancedOpen] = useState(false);
  const [dedicatedUtilityView, setDedicatedUtilityView] = useState<'catalog' | null>(null);
  const reagentSection = (isReagentControlPage ? tab : 'overview') as ReagentControlSection;
  const reagentQueryState = isReagentControlPage
    ? reagentControlQueryState(reagentSection, { advancedOpen })
    : {
        loadRecipes: true,
        loadStockDetails: true,
        loadReconciliation: true,
        loadLogs: true,
        loadReadinessDetails: true,
      };

  // Date filter
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Consumable form modal
  const [showConsumableForm, setShowConsumableForm] = useState(false);
  const [editingConsumable, setEditingConsumable] = useState<Consumable | null>(null);
  const [consumableForm, setConsumableForm] = useState({
    code: '', name: '', category: 'reagent', unit: 'pcs', unit_price: '',
    reorder_level: '10', reorder_qty: '50', description: '', storage_condition: '',
  });

  // Stock-in modal
  const [showStockIn, setShowStockIn] = useState(false);
  const [stockInForm, setStockInForm] = useState({
    consumable_id: '', lot_number: '', expiry_date: '', quantity: '', purchase_price: '', remarks: '', location_id: '',
  });

  const [selectedConsumableId, setSelectedConsumableId] = useState('');
  const [editingLocation, setEditingLocation] = useState<LabStockLocation | null>(null);
  const [locationForm, setLocationForm] = useState({ location_code: '', location_name: '', location_type: 'store', description: '' });
  const [wasteStatusFilter, setWasteStatusFilter] = useState('pending');
  const [exceptionStatusFilter, setExceptionStatusFilter] = useState('open');
  const [openLotForm, setOpenLotForm] = useState({ stock_id: '', onboard_expiry_days: '30', remarks: '', ledger_type: '' });
  const [transferForm, setTransferForm] = useState({ stock_id: '', target_location_id: '', remarks: '' });
  const [wasteForm, setWasteForm] = useState({ stock_id: '', quantity: '', reason: 'expired', remarks: '' });
  const [mappingForm, setMappingForm] = useState({ lab_test_id: '', consumable_id: '', qty_per_test: '1', is_mandatory: true, notes: '' });
  const [bulkMappingText, setBulkMappingText] = useState('');
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [mappingEditForm, setMappingEditForm] = useState({ qty_per_test: '1', is_mandatory: true, notes: '' });
  const [coverageStatusFilter, setCoverageStatusFilter] = useState('all');
  const [reconciliationStatusFilter, setReconciliationStatusFilter] = useState('all');
  const [machineAssignForm, setMachineAssignForm] = useState({ stock_id: '', machine_id: '', location_id: '', remarks: '' });
  const [manualUsageForm, setManualUsageForm] = useState({ consumable_id: '', quantity: '', usage_type: 'rerun', location_id: '', reference_id: '', remarks: '' });

  // Search/filter
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: alertsData, isLoading: loadingAlerts } = useApiQuery<AlertData>(
    ['lab-monitoring', 'alerts'],
    '/api/lab-monitoring/alerts',
  );

  const { data: summaryData, isLoading: loadingSummary } = useApiQuery<{ summary: DailySummary }>(
    ['lab-monitoring', 'daily-summary', selectedDate],
    `/api/lab-monitoring/daily-summary?date=${selectedDate}`,
    { enabled: !isReagentControlPage },
  );

  const { data: consumablesData, isLoading: loadingConsumables } = useApiQuery<{ data: Consumable[] }>(
    ['lab-monitoring', 'consumables', categoryFilter, debouncedSearch],
    `/api/lab-monitoring/consumables?${categoryFilter ? `category=${categoryFilter}&` : ''}${debouncedSearch ? `search=${encodeURIComponent(debouncedSearch)}&` : ''}`,
  );

  const { data: logsData, isLoading: loadingLogs } = useApiQuery<{ data: OperationLog[] }>(
    ['lab-monitoring', 'logs', selectedDate],
    `/api/lab-monitoring/operation-logs?date=${selectedDate}`,
    { enabled: reagentQueryState.loadLogs },
  );

  const { data: locationsData } = useApiQuery<{ data: LabStockLocation[] }>(['lab-monitoring', 'stock-locations'], '/api/lab-monitoring/stock/locations');
  const { data: machinesData } = useApiQuery<{ data: LabMachine[] }>(
    ['lab-monitoring', 'machines'],
    '/api/lab-monitoring/machines',
    { enabled: !isReagentControlPage || reagentQueryState.loadStockDetails || reagentQueryState.loadReadinessDetails },
  );
  const { data: analyzerHealthData } = useApiQuery<{ data: AnalyzerHealth }>(
    ['lab-monitoring', 'analyzer-health'],
    '/api/lab-monitoring/analyzer-health',
    { enabled: reagentQueryState.loadReadinessDetails },
  );
  const { data: goLiveReadinessData } = useApiQuery<{ data: LisGoLiveReadiness }>(
    ['lab-monitoring', 'lis-go-live-readiness'],
    '/api/lab-monitoring/lis-go-live-readiness',
    { enabled: reagentQueryState.loadReadinessDetails },
  );
  const { data: bridgeChecklistData } = useApiQuery<{ data: { checklist: LisDeploymentChecklistStage[] } }>(
    ['lab-monitoring', 'lis-bridge-deployment-checklist'],
    '/api/lab-monitoring/lis-bridge-deployment-checklist',
    { enabled: reagentQueryState.loadReadinessDetails },
  );
  const { data: inventoryPolicyData } = useApiQuery<{ data: LabInventoryPolicy; capabilities: LabInventoryCapabilities }>(['lab-monitoring', 'inventory-policy'], '/api/lab-monitoring/inventory-policy');
  const { data: exceptionsData, isLoading: loadingExceptions } = useApiQuery<{ data: LabInventoryException[] }>(
    ['lab-monitoring', 'inventory-exceptions', exceptionStatusFilter],
    `/api/lab-monitoring/inventory-exceptions?status=${exceptionStatusFilter}`,
  );

  const stockLotsQuery = selectedConsumableId
    ? `/api/lab-monitoring/stock/lots?consumable_id=${selectedConsumableId}`
    : '/api/lab-monitoring/stock/lots';
  const { data: stockLotsData, isLoading: loadingStockLots } = useApiQuery<{ data: StockLot[] }>(
    [...queryKeys.laboratory.all, 'lab-monitoring', 'stock-lots', selectedConsumableId || 'all'],
    stockLotsQuery,
    { enabled: tab === 'stock' },
  );

  const { data: wasteRequestsData, isLoading: loadingWasteRequests } = useApiQuery<{ data: WasteRequest[] }>(
    ['lab-monitoring', 'waste-requests', wasteStatusFilter],
    `/api/lab-monitoring/stock/waste-requests?status=${wasteStatusFilter}`,
    { enabled: reagentQueryState.loadStockDetails },
  );

  const rulePath = '/api/lab-monitoring/' + 'test-' + 'consumable-map';
  const { data: labTestsData, isLoading: loadingLabTests } = useApiQuery<{ tests: LabCatalogTest[] }>(
    ['lab-monitoring', 'lab-tests'],
    '/api/lab?status=all',
    { enabled: reagentQueryState.loadRecipes },
  );
  const { data: mappingConsumablesData } = useApiQuery<{ data: Consumable[] }>(
    ['lab-monitoring', 'mapping-consumables'],
    '/api/lab-monitoring/consumables',
    { enabled: reagentQueryState.loadRecipes },
  );
  const { data: mappingsData, isLoading: loadingMappings } = useApiQuery<{ data: ReagentUsageRule[] }>(
    ['lab-monitoring', 'usage-rules'],
    rulePath,
    { enabled: reagentQueryState.loadRecipes },
  );
  const { data: mappingCoverageData, isLoading: loadingMappingCoverage } = useApiQuery<{ data: MappingCoverageRow[]; summary: MappingCoverageSummary; status: string }>(
    ['lab-monitoring', 'mapping-coverage', coverageStatusFilter],
    `/api/lab-monitoring/mapping-coverage?status=${coverageStatusFilter}`,
  );
  const { data: reagentReconciliationData, isLoading: loadingReagentReconciliation } = useApiQuery<{ data: ReagentReconciliationRow[]; summary: ReagentReconciliationSummary; status: string }>(
    ['lab-monitoring', 'reagent-reconciliation', selectedDate, reconciliationStatusFilter],
    `/api/lab-monitoring/reagent-reconciliation?from=${selectedDate}&to=${selectedDate}&status=${reconciliationStatusFilter}`,
    { enabled: reagentQueryState.loadReconciliation },
  );
  const consumables = consumablesData?.data ?? [];
  const alerts = alertsData ?? { low_stock: [], expiring: [] };
  const summary = summaryData?.summary;
  const logs = logsData?.data ?? [];
  const locations = locationsData?.data ?? [];
  const machines = machinesData?.data ?? [];
  const analyzerHealth = analyzerHealthData?.data;
  const goLiveReadiness = goLiveReadinessData?.data;
  const bridgeChecklist = bridgeChecklistData?.data?.checklist ?? [];
  const bridgeChecklistProgress = lisDeploymentChecklistProgress(bridgeChecklist);
  const goLiveAction = lisGoLivePrimaryAction(goLiveReadiness);
  const inventoryPolicy = inventoryPolicyData?.data ?? FIRST_HOSPITAL_LAB_INVENTORY_POLICY;
  const inventoryCapabilities = inventoryPolicyData?.capabilities ?? {
    strict_mode_available: false,
    strict_billing_atomicity_ready: false,
    reason: 'Strict mode availability could not be verified. Keep safe rollout mode active.',
  };
  const firstHospitalPolicyActive = labInventoryPolicyMatchesFirstHospitalPreset(inventoryPolicy);
  const strictProductionPolicyActive = inventoryPolicy.lab_inventory_mode === STRICT_PRODUCTION_LAB_INVENTORY_POLICY.lab_inventory_mode
    && inventoryPolicy.reagent_consumption_timing === STRICT_PRODUCTION_LAB_INVENTORY_POLICY.reagent_consumption_timing
    && inventoryPolicy.allow_result_without_stock === STRICT_PRODUCTION_LAB_INVENTORY_POLICY.allow_result_without_stock
    && inventoryPolicy.require_test_mapping_for_completion === STRICT_PRODUCTION_LAB_INVENTORY_POLICY.require_test_mapping_for_completion;
  const inventoryExceptions = exceptionsData?.data ?? [];
  const openInventoryExceptions = exceptionStatusFilter === 'open' ? inventoryExceptions : inventoryExceptions.filter(item => item.status === 'open');
  const stockLots = stockLotsData?.data ?? [];
  const inventoryBackedStockLotIds = useMemo(
    () => new Set(stockLots.filter(isInventoryBackedStockLot).map(lot => String(lot.id))),
    [stockLots],
  );
  const legacyLabStockLotIds = useMemo(
    () => new Set(stockLots.filter(lot => !isInventoryBackedStockLot(lot)).map(lot => String(lot.id))),
    [stockLots],
  );
  const selectedTransferStockId = transferForm.stock_id.trim();
  const selectedWasteStockId = wasteForm.stock_id.trim();
  const selectedTransferLotIsInventoryBacked = inventoryBackedStockLotIds.has(selectedTransferStockId) && !legacyLabStockLotIds.has(selectedTransferStockId);
  const selectedWasteLotIsInventoryBacked = inventoryBackedStockLotIds.has(selectedWasteStockId) && !legacyLabStockLotIds.has(selectedWasteStockId);
  const openLotReady = isOpenVialFormReady(openLotForm);
  const wasteRequestReady = isWasteRequestFormReady(wasteForm);
  const inventoryBackedLegacyActionTitle = 'This stock lot is backed by canonical InventoryStock. Use inventory transfer/write-off workflows instead of legacy lab stock transfer or waste actions.';
  const wasteRequests = wasteRequestsData?.data ?? [];
  const labTests = labTestsData?.tests ?? [];
  const mappingConsumables = mappingConsumablesData?.data ?? consumables;
  const mappings = mappingsData?.data ?? [];
  const mappingCoverageRows = mappingCoverageData?.data ?? [];
  const mappingCoverageSummary = mappingCoverageData?.summary;
  const strictProductionReady = inventoryCapabilities.strict_mode_available
    && inventoryCapabilities.strict_billing_atomicity_ready
    && Boolean(mappingCoverageSummary?.strict_mode_ready);
  const strictReadinessChecks = useMemo(() => buildStrictModeReadinessChecks(mappingCoverageSummary), [mappingCoverageSummary]);
  const reagentReconciliationRows = reagentReconciliationData?.data ?? [];
  const reagentReconciliationSummary = reagentReconciliationData?.summary;
  const reagentSetupChecklist = useMemo(() => buildReagentSetupChecklist({
    consumableCount: consumables.length,
    locationCount: locations.length,
    mappingSummary: mappingCoverageSummary,
    policy: inventoryPolicy,
  }), [consumables.length, inventoryPolicy, locations.length, mappingCoverageSummary]);
  const completedSetupSteps = reagentSetupChecklist.filter(step => step.done).length;

  const reagentStarterState = reagentStarterCommandState({
    policyTiming: inventoryPolicy.reagent_consumption_timing,
    inventoryMode: inventoryPolicy.lab_inventory_mode,
    mappedTests: mappingCoverageSummary?.mapped_tests,
    missingTests: mappingCoverageSummary?.missing_tests,
    openExceptions: openInventoryExceptions.length,
    reconciliationMissing: reagentReconciliationSummary?.missing,
    reconciliationExceptions: reagentReconciliationSummary?.exception,
  });
  const dedicatedPolicySummary = reagentPolicySummary(inventoryPolicy);
  const dedicatedNextActions = reagentControlNextActions({
    inventoryMode: inventoryPolicy.lab_inventory_mode,
    missingRecipes: Number(mappingCoverageSummary?.missing_tests ?? 0),
    lowStockCount: alerts.low_stock.length,
    expiringCount: alerts.expiring.length,
    openIssues: openInventoryExceptions.length,
    reconciliationIssues: Number(reagentReconciliationSummary?.missing ?? 0) + Number(reagentReconciliationSummary?.exception ?? 0),
  });
  const dedicatedSetupSteps = [
    {
      id: 'catalog',
      label: 'Load starter reagent catalog',
      detail: 'Create editable starter recipe items for common lab tests.',
      done: consumables.length > 0,
      section: 'recipes' as const,
    },
    {
      id: 'recipes',
      label: 'Review missing test recipes',
      detail: Number(mappingCoverageSummary?.missing_tests ?? 0) > 0
        ? `${Number(mappingCoverageSummary?.missing_tests ?? 0)} active tests still need a recipe.`
        : 'Active test recipe coverage is complete.',
      done: Number(mappingCoverageSummary?.mapped_tests ?? 0) > 0 && Number(mappingCoverageSummary?.missing_tests ?? 0) === 0,
      section: 'recipes' as const,
    },
    {
      id: 'stock',
      label: 'Add current stock and locations',
      detail: 'Record usable reagent lots, expiry and stock location.',
      done: locations.length > 0 && consumables.some(item => Number(item.total_stock ?? 0) > 0),
      section: 'stock' as const,
    },
    {
      id: 'policy',
      label: 'Start safe soft-mode control',
      detail: 'Keep billing and results running while warnings are collected.',
      done: inventoryPolicy.lab_inventory_mode === 'soft' && inventoryPolicy.reagent_consumption_timing === 'billing',
      section: 'overview' as const,
    },
  ];
  const dedicatedReadinessChecks = strictReadinessChecks.map(check => ({
    id: check.id,
    label: check.label,
    ready: check.ready,
    detail: `${check.detail} Target: ${check.target}.`,
  }));

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createConsumableMutation = useApiMutation<any, any>('post', '/api/lab-monitoring/consumables', {
    onSuccess: () => {
      toast.success(t('consumableCreated'));
      setShowConsumableForm(false);
      resetConsumableForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    },
    onError: (err: any) => toast.error(err.message || t('failed')),
  });

  const updateConsumableMutation = useApiMutation<any, any>('put', (vars: any) => `/api/lab-monitoring/consumables/${vars.id}`, {
    onSuccess: () => {
      toast.success(t('consumableUpdated'));
      setShowConsumableForm(false);
      setEditingConsumable(null);
      resetConsumableForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    },
    onError: (err: any) => toast.error(err.message || t('failed')),
  });

  const deleteConsumableMutation = useApiMutation<any, any>('delete', (vars: any) => `/api/lab-monitoring/consumables/${vars.id}`, {
    onSuccess: () => {
      toast.success(t('consumableDeleted'));
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    },
    onError: (err: any) => toast.error(err.message || t('failed')),
  });

  const stockInMutation = useApiMutation<any, any>('post', '/api/lab-monitoring/stock/in', {
    onSuccess: () => {
      toast.success(t('stockAdded'));
      setShowStockIn(false);
      resetStockInForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
    onError: (err: any) => toast.error(err.message || t('failed')),
  });

  const syncLegacyStockMutation = useApiMutation<any, any>('post', '/api/lab-monitoring/stock/backfill-canonical', {
    onSuccess: (response: any) => {
      const summary = response?.summary ?? {};
      toast.success(`Inventory sync complete: ${Number(summary.created ?? 0)} created, ${Number(summary.alreadyLinked ?? 0)} already linked.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
    onError: (err: any) => toast.error(err.message || t('failed')),
  });

  function resetConsumableForm() {
    setConsumableForm({ code: '', name: '', category: 'reagent', unit: 'pcs', unit_price: '', reorder_level: '10', reorder_qty: '50', description: '', storage_condition: '' });
  }

  function resetStockInForm() {
    setStockInForm({ consumable_id: '', lot_number: '', expiry_date: '', quantity: '', purchase_price: '', remarks: '', location_id: '' });
  }

  function resetLocationForm() {
    setLocationForm({ location_code: '', location_name: '', location_type: 'store', description: '' });
    setEditingLocation(null);
  }

  function resetMappingForm() {
    setMappingForm({ lab_test_id: '', consumable_id: '', qty_per_test: '1', is_mandatory: true, notes: '' });
  }

  function resetMappingEditForm() {
    setEditingMappingId(null);
    setMappingEditForm({ qty_per_test: '1', is_mandatory: true, notes: '' });
  }

  function startEditMapping(mapping: ReagentUsageRule) {
    setEditingMappingId(mapping.id);
    setMappingEditForm({
      qty_per_test: String(mapping.qty_per_test ?? 1),
      is_mandatory: isMandatoryMapping(mapping.is_mandatory),
      notes: mapping.notes ?? '',
    });
  }

  async function handleUpdateInventoryPolicy(patch: Partial<LabInventoryPolicy>) {
    const readinessWarning = labInventoryPolicyStrictReadinessWarning(patch, inventoryPolicy, mappingCoverageSummary);
    if (readinessWarning) {
      toast.error(readinessWarning);
      if (isReagentControlPage) setAdvancedOpen(true);
      else setTab('readiness');
      return;
    }
    try {
      await api.put('/api/lab-monitoring/inventory-policy', { ...inventoryPolicy, ...patch });
      toast.success('Lab inventory policy updated');
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'inventory-policy'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to update lab inventory policy');
    }
  }

  async function handleSeedDefaultReagentCatalog() {
    try {
      const result = await api.post('/api/lab-monitoring/default-reagent-catalog/seed', {});
      toast.success(defaultReagentCatalogSeedToast((result as any)?.summary));
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'lab-tests'] });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'usage-rules'] });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'mapping-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'reagent-reconciliation'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) {
      toast.error(err.message || 'Failed to load default reagent catalog');
    }
  }

  async function handleBulkMappingImport() {
    let mappings: Array<{ lab_test_id: number; consumable_id: number; qty_per_test: number; is_mandatory: boolean; notes?: string }>;
    try {
      mappings = parseBulkMappingCsvInput(bulkMappingText);
      if (mappings.length === 0) { toast.error('Paste at least one mapping row'); return; }
    } catch (err: any) {
      toast.error(err.message || 'Invalid bulk mapping CSV');
      return;
    }
    try {
      const result = await api.post(rulePath + '/bulk', { mappings });
      const summary = (result as any)?.summary;
      toast.success(summary ? `Bulk mapping imported: ${summary.created} created, ${summary.updated} updated, ${summary.reactivated} reactivated` : 'Bulk mapping imported');
      setBulkMappingText('');
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'usage-rules'] });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'mapping-coverage'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to import bulk mappings');
    }
  }

  async function handleSaveMapping() {
    const labTestId = parseInt(mappingForm.lab_test_id, 10);
    const consumableId = parseInt(mappingForm.consumable_id, 10);
    const qtyPerTest = Number(mappingForm.qty_per_test || '0');
    if (!labTestId || !consumableId || qtyPerTest <= 0) {
      toast.error('Select test, reagent/consumable, and a valid quantity');
      return;
    }
    try {
      await api.post(rulePath, {
        lab_test_id: labTestId,
        consumable_id: consumableId,
        qty_per_test: qtyPerTest,
        is_mandatory: mappingForm.is_mandatory,
        notes: mappingForm.notes || undefined,
      });
      toast.success('Test reagent mapping saved');
      resetMappingForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'usage-rules'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to save mapping');
    }
  }

  async function handleUpdateMapping(id: number) {
    try {
      const payload = mappingUpdatePayload(mappingEditForm.qty_per_test, mappingEditForm.is_mandatory, mappingEditForm.notes);
      await api.put(rulePath + '/' + id, payload);
      toast.success('Mapping updated');
      resetMappingEditForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'usage-rules'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to update mapping');
    }
  }

  async function handleDeleteMapping(id: number) {
    try {
      await api.delete(rulePath + '/' + id);
      toast.success('Mapping removed');
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'usage-rules'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove mapping');
    }
  }

  function handleSaveConsumable() {
    const payload = {
      ...consumableForm,
      unit_price: moneyInputToPaisa(consumableForm.unit_price),
      reorder_level: parseInt(consumableForm.reorder_level, 10),
      reorder_qty: parseInt(consumableForm.reorder_qty, 10),
    };
    if (editingConsumable) {
      updateConsumableMutation.mutate({ id: editingConsumable.id, ...payload });
    } else {
      createConsumableMutation.mutate(payload);
    }
  }

  function handleStockIn() {
    stockInMutation.mutate({
      consumable_id: parseInt(stockInForm.consumable_id, 10),
      lot_number: stockInForm.lot_number || undefined,
      expiry_date: stockInForm.expiry_date || undefined,
      quantity: parseInt(stockInForm.quantity, 10),
      purchase_price: parseInt(stockInForm.purchase_price || '0', 10),
      remarks: stockInForm.remarks || undefined,
      location_id: stockInForm.location_id ? parseInt(stockInForm.location_id, 10) : undefined,
      idempotency_key: `reagent-stock-${crypto.randomUUID()}`,
    });
  }

  async function handleQc(lot: StockLot, qc_status: string) {
    try {
      await api.post('/api/lab-monitoring/stock/' + lot.id + '/qc', { qc_status, ledger_type: isInventoryBackedStockLot(lot) ? 'inventory' : 'lab' });
      toast.success('QC status updated');
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleOpenLot() {
    const stockId = parseInt(openLotForm.stock_id, 10);
    const days = Number(openLotForm.onboard_expiry_days);
    if (!isOpenVialFormReady(openLotForm)) {
      toast.error('Enter stock lot, ledger, 1-365 open-vial days, and remarks within 500 characters');
      return;
    }
    try {
      await api.post('/api/lab-monitoring/stock/' + stockId + '/open', {
        onboard_expiry_days: days,
        remarks: openLotForm.remarks || undefined,
        ledger_type: openLotForm.ledger_type === 'inventory' ? 'inventory' : openLotForm.ledger_type === 'lab' ? 'lab' : undefined,
      });
      toast.success('Stock lot opened');
      setOpenLotForm({ stock_id: '', onboard_expiry_days: '30', remarks: '', ledger_type: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleAssignMachine() {
    const stockId = parseInt(machineAssignForm.stock_id, 10);
    const machineId = machineAssignForm.machine_id ? parseInt(machineAssignForm.machine_id, 10) : undefined;
    const locationId = machineAssignForm.location_id ? parseInt(machineAssignForm.location_id, 10) : undefined;
    if (!isMachineAssignmentFormReady(machineAssignForm)) { toast.error('Select a valid InventoryStock lot and machine or analyzer location'); return; }
    try {
      const path = '/api/lab-monitoring/stock/' + stockId + '/ana' + 'lyzer-' + 'assignment';
      await api.post(path, { machine_id: machineId, location_id: locationId, remarks: machineAssignForm.remarks || undefined });
      toast.success('Machine assignment updated');
      setMachineAssignForm({ stock_id: '', machine_id: '', location_id: '', remarks: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleManualUsage() {
    try {
      const payload = manualUsageRecordPayload(manualUsageForm);
      await api.post('/api/lab-monitoring/consumables/' + payload.consumableId + '/manual-usage', payload.body);
      toast.success('Manual reagent usage recorded');
      setManualUsageForm({ consumable_id: '', quantity: '', usage_type: 'rerun', location_id: '', reference_id: '', remarks: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'consumables'] });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'logs'] });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleTransferLot() {
    try {
      await api.post('/api/lab-monitoring/stock/' + parseInt(transferForm.stock_id, 10) + '/transfer-location', {
        target_location_id: parseInt(transferForm.target_location_id, 10),
        remarks: transferForm.remarks || undefined,
      });
      toast.success('Stock lot transferred');
      setTransferForm({ stock_id: '', target_location_id: '', remarks: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleWasteRequest() {
    try {
      const payload = wasteRequestPayload(wasteForm);
      await api.post('/api/lab-monitoring/stock/waste-requests', payload);
      toast.success('Waste request submitted for manager/admin review');
      setWasteForm({ stock_id: '', quantity: '', reason: 'expired', remarks: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'waste-requests'] });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleReviewWaste(id: number, action: 'approve' | 'reject') {
    try {
      await api.post('/api/lab-monitoring/stock/waste-requests/' + id + '/' + action, {});
      toast.success(action === 'approve' ? 'Waste request approved' : 'Waste request rejected');
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleReviewInventoryException(id: number, status: 'resolved' | 'ignored') {
    try {
      await api.post('/api/lab-monitoring/inventory-exceptions/' + id + '/review', { status });
      toast.success(status === 'resolved' ? 'Inventory exception resolved' : 'Inventory exception ignored');
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'inventory-exceptions'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleRetryInventoryException(id: number) {
    try {
      await api.post('/api/lab-monitoring/inventory-exceptions/' + id + '/retry-consumption', {});
      toast.success('Inventory exception retry completed');
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'inventory-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['lab-monitoring', 'reagent-reconciliation'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleSaveLocation() {
    try {
      const payload = {
        location_code: locationForm.location_code.trim(),
        location_name: locationForm.location_name.trim(),
        location_type: locationForm.location_type,
        description: locationForm.description || undefined,
      };
      if (editingLocation) {
        await api.put('/api/lab-monitoring/stock/locations/' + editingLocation.id, payload);
        toast.success('Stock location updated');
      } else {
        await api.post('/api/lab-monitoring/stock/locations', payload);
        toast.success('Stock location created');
      }
      resetLocationForm();
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  async function handleDeleteLocation(id: number) {
    try {
      await api.delete('/api/lab-monitoring/stock/locations/' + id);
      toast.success('Stock location deactivated');
      queryClient.invalidateQueries({ queryKey: queryKeys.laboratory.all });
    } catch (err: any) { toast.error(err.message || t('failed')); }
  }

  function startEditLocation(location: LabStockLocation) {
    setEditingLocation(location);
    setLocationForm({
      location_code: location.location_code,
      location_name: location.location_name,
      location_type: location.location_type,
      description: location.description ?? '',
    });
  }

  const tabs = (isReagentControlPage ? [] : labMonitoringTabsForMode(mode, {
    overview: t('overview'),
    consumables: t('consumables'),
    stock: 'Stock Controls',
    readiness: 'Readiness',
    mappings: 'Test Mapping',
    exceptions: 'Exceptions',
    logs: t('operationLogs'),
    alerts: t('alerts'),
  })).map(({ id, label }) => ({
    id,
    label,
    icon: LAB_MONITORING_TAB_ICONS[id],
  }));

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="lab_monitoring" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-100">
              <Activity className="w-6 h-6 text-violet-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)]">{isReagentControlPage ? 'Reagent Control' : t('labMonitoring')}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                {isReagentControlPage
                  ? 'Track reagent stock, set test recipes, and fix warnings without stopping routine lab work.'
                  : t('labMonitoringSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
            {(!isReagentControlPage || reagentSection === 'issues' || advancedOpen) && (
              <input
                aria-label={isReagentControlPage ? 'Reagent issue date' : 'Lab monitoring date'}
                type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            )}
          </div>
        </div>

        {isReagentControlPage && (
          <ReagentControlTabs
            active={reagentSection}
            onChange={section => {
              setAdvancedOpen(false);
              setDedicatedUtilityView(null);
              if (section !== 'stock') setStockAdvancedOpen(false);
              setTab(section);
            }}
          />
        )}

        {isReagentControlPage && advancedOpen && (
          <ReagentControlAdvancedPanel
            policy={inventoryPolicy}
            policySummary={dedicatedPolicySummary}
            strictReady={strictProductionReady}
            strictAvailable={inventoryCapabilities.strict_mode_available && inventoryCapabilities.strict_billing_atomicity_ready}
            strictUnavailableMessage={inventoryCapabilities.reason}
            readinessMessage={strictModeReadinessMessage(mappingCoverageSummary)}
            readinessChecks={dedicatedReadinessChecks}
            logs={logs}
            onPolicyChange={patch => handleUpdateInventoryPolicy(patch as Partial<LabInventoryPolicy>)}
            onApplySafePolicy={() => handleUpdateInventoryPolicy(FIRST_HOSPITAL_LAB_INVENTORY_POLICY)}
            onEnableStrict={() => handleUpdateInventoryPolicy(STRICT_PRODUCTION_LAB_INVENTORY_POLICY)}
            onOpenCatalog={() => {
              setAdvancedOpen(false);
              setDedicatedUtilityView('catalog');
              setTab('stock');
            }}
            onSyncLegacyStock={canManageLabInventory ? () => syncLegacyStockMutation.mutate({}) : undefined}
            syncLegacyStockPending={syncLegacyStockMutation.isPending}
            labMonitoringHref={`${base}/lab/monitoring`}
            machineSettingsHref={`${base}/lab-machines`}
            integrationSummary={goLiveReadiness || analyzerHealth ? {
              title: analyzerHealth && analyzerHealthNeedsAttention(analyzerHealth) ? 'Analyzer setup needs attention' : 'LIS and analyzer tools',
              detail: analyzerHealth
                ? `${analyzerHealth.open_unmatched_results} unmatched results · ${analyzerHealth.unassigned_inventory_lots} unassigned reagent lots.`
                : `${goLiveReadiness?.summary.blockers ?? 0} LIS readiness blockers remain.`,
            } : undefined}
            onClose={() => setAdvancedOpen(false)}
          />
        )}

        {isReagentControlPage && reagentSection === 'overview' && !advancedOpen && !dedicatedUtilityView && (
          <ReagentControlOverview
            policySummary={dedicatedPolicySummary}
            actions={dedicatedNextActions}
            setupSteps={dedicatedSetupSteps}
            onSectionChange={section => setTab(section)}
            onOpenAdvanced={() => setAdvancedOpen(true)}
          />
        )}

        {isReagentControlPage && reagentSection === 'recipes' && !advancedOpen && !dedicatedUtilityView && (
          <ReagentRecipeManager
            labTests={labTests}
            consumables={mappingConsumables}
            mappings={mappings}
            missingRecipeCount={Number(mappingCoverageSummary?.missing_tests ?? 0)}
            form={mappingForm}
            bulkText={bulkMappingText}
            editingId={editingMappingId}
            editForm={mappingEditForm}
            loading={loadingMappings || loadingLabTests}
            onFormChange={patch => setMappingForm(current => ({ ...current, ...patch }))}
            onSave={handleSaveMapping}
            onLoadStarterCatalog={handleSeedDefaultReagentCatalog}
            onBulkTextChange={setBulkMappingText}
            onBulkImport={handleBulkMappingImport}
            onStartEdit={mapping => startEditMapping(mapping as ReagentUsageRule)}
            onEditFormChange={patch => setMappingEditForm(current => ({ ...current, ...patch }))}
            onUpdate={handleUpdateMapping}
            onCancelEdit={resetMappingEditForm}
            onRemove={handleDeleteMapping}
          />
        )}

        {isReagentControlPage && reagentSection === 'issues' && !advancedOpen && !dedicatedUtilityView && (
          <ReagentControlIssues
            exceptions={inventoryExceptions}
            reconciliationRows={reagentReconciliationRows}
            onOpenRecipes={() => setTab('recipes')}
            onOpenStock={() => setTab('stock')}
            onRetry={handleRetryInventoryException}
            onReview={handleReviewInventoryException}
          />
        )}

        {!isReagentControlPage && <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5" data-testid="reagent-starter-command-center">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Starter HIS reagent control</p>
              <h2 className="mt-1 text-lg font-bold text-[var(--color-text)]">{reagentStarterState.headline}</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {reagentStarterState.description}
              </p>
              <p className="mt-2 font-data text-xs text-[var(--color-text-muted)]">{reagentStarterState.summary}</p>
            </div>
            <div className={`rounded-xl border px-4 py-3 text-sm ${reagentStarterState.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              <p className="font-semibold">{reagentStarterState.statusTitle}</p>
              <p className="mt-1 text-xs opacity-80">{reagentStarterState.statusHint}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {reagentStarterState.actions.map(action => (
              <button
                key={action.tab}
                type="button"
                onClick={() => setTab(action.tab)}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 text-left text-sm transition hover:border-violet-300 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              >
                <span className="font-semibold text-[var(--color-text)]">{action.label}</span>
                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{action.description}</span>
              </button>
            ))}
          </div>
        </section>}

        {/* Alert Banner */}
        {!isReagentControlPage && (alerts.low_stock.length > 0 || alerts.expiring.length > 0) && (
          <div className="flex flex-wrap gap-3">
            {alerts.low_stock.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>{alerts.low_stock.length} {t('lowStockAlert')}</span>
                <button onClick={() => setTab(isReagentControlPage ? 'exceptions' : 'alerts')} className="underline font-medium ml-1">{t('view')}</button>
              </div>
            )}
            {alerts.expiring.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
                <Clock className="w-4 h-4" />
                <span>{alerts.expiring.length} {t('expiringAlert')}</span>
                <button onClick={() => setTab(isReagentControlPage ? 'exceptions' : 'alerts')} className="underline font-medium ml-1">{t('view')}</button>
              </div>
            )}
          </div>
        )}
        {!isReagentControlPage && openInventoryExceptions.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span><strong>{openInventoryExceptions.length}</strong> lab reagent inventory exception{openInventoryExceptions.length === 1 ? '' : 's'} need review.</span>
            </div>
            <button onClick={() => setTab('exceptions')} className="underline font-medium">Review</button>
          </div>
        )}
        {!isReagentControlPage && goLiveReadiness && (
          <div data-testid="lis-go-live-readiness-card" className={`rounded-xl border p-4 ${lisGoLiveStatusClass(goLiveReadiness.overall_status)}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">LIS go-live readiness</p>
                <p className="text-xs opacity-80">OpenELIS-style bridge deployment readiness using existing HMS checks</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">{lisGoLiveStatusLabel(goLiveReadiness.overall_status)}</span>
                <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-data">{goLiveReadiness.readiness_score}%</span>
                <button onClick={() => setTab(goLiveAction.target)} className="px-3 py-1.5 rounded-lg bg-white/80 border border-white/80 text-xs font-medium hover:bg-white">{goLiveAction.label}</button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-lg font-bold">{goLiveReadiness.summary.ready}</div><div className="text-xs opacity-80">Ready checks</div></div>
              <div><div className="text-lg font-bold">{goLiveReadiness.summary.warnings}</div><div className="text-xs opacity-80">Warnings</div></div>
              <div><div className="text-lg font-bold">{goLiveReadiness.summary.blockers}</div><div className="text-xs opacity-80">Blockers</div></div>
              <div><div className="text-lg font-bold">{bridgeChecklistProgress.stages}/{bridgeChecklistProgress.items}</div><div className="text-xs opacity-80">Checklist stages/items</div></div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {goLiveReadiness.checks.slice(0, 4).map(check => (
                <div key={check.id} className="rounded-lg bg-white/70 border border-white/80 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{check.label}</span>
                    <span className={`rounded-full px-2 py-0.5 ${check.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : check.status === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{check.status}</span>
                  </div>
                  <p className="mt-1 opacity-80">{check.detail}</p>
                </div>
              ))}
            </div>
            {bridgeChecklist[0]?.items?.length ? (
              <div className="mt-4 rounded-lg bg-white/70 border border-white/80 px-3 py-2 text-xs">
                <p className="font-semibold">First deployment next step</p>
                <p className="mt-1 opacity-80">{bridgeChecklist[0].items[0].title}</p>
                <p className="mt-1 font-data opacity-70">{bridgeChecklist[0].items[0].endpoint ?? 'No endpoint required'}</p>
              </div>
            ) : null}
          </div>
        )}
        {!isReagentControlPage && analyzerHealth && (
          <div className={`rounded-xl border p-4 ${analyzerHealthNeedsAttention(analyzerHealth) ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Analyzer / LIS health</p>
                <p className="text-xs text-[var(--color-text-muted)]">Unmatched results, reagent assignment, and machine coverage</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${analyzerHealthNeedsAttention(analyzerHealth) ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {analyzerHealthNeedsAttention(analyzerHealth) ? 'Needs attention' : 'Healthy'}
                </span>
                <button onClick={() => setTab('stock')} className="px-3 py-1.5 rounded-lg bg-white/80 border border-slate-200 text-xs font-medium text-slate-700 hover:bg-white">Manage reagent assignment</button>
                <a href={`${base}/lab-machines`} className="px-3 py-1.5 rounded-lg bg-white/80 border border-slate-200 text-xs font-medium text-slate-700 hover:bg-white">Open machine settings</a>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
              <div><div className="text-lg font-bold">{analyzerHealth.open_unmatched_results}</div><div className="text-xs text-[var(--color-text-muted)]">Open LIS queue</div></div>
              <div><div className="text-lg font-bold">{analyzerHealth.active_assignments}</div><div className="text-xs text-[var(--color-text-muted)]">Active assignments</div></div>
              <div><div className="text-lg font-bold">{analyzerHealth.unassigned_inventory_lots}</div><div className="text-xs text-[var(--color-text-muted)]">Unassigned lots</div></div>
              <div><div className="text-lg font-bold">{analyzerHealth.machines_with_active_assignment}/{analyzerHealth.machines_total}</div><div className="text-xs text-[var(--color-text-muted)]">Machines covered</div></div>
            </div>
            {(analyzerHealth.machine_breakdown?.length ?? 0) > 0 && (
              <div className="mt-4 rounded-lg bg-white/70 border border-white/80 divide-y divide-slate-100">
                {analyzerHealth.machine_breakdown!.slice(0, 4).map(machine => (
                  <div key={machine.machine_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="font-medium text-slate-700">{machine.machine_name}{machine.machine_code ? ` (${machine.machine_code})` : ''}</div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <span>{machine.open_unmatched_results} open queue</span>
                      <span>{machine.active_assignments} assignments</span>
                      <span className={`px-2 py-0.5 rounded-full ${analyzerMachineNeedsAttention(machine) ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {analyzerMachineNeedsAttention(machine) ? 'Check' : 'OK'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        {!isReagentControlPage && (
          <div className="flex gap-1 border-b border-[var(--color-border)]">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === id ? 'border-violet-600 text-violet-600' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}>
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>
        )}

        {/* ── OVERVIEW TAB ── */}
        {!isReagentControlPage && tab === 'overview' && (
          <div className="space-y-6">
            <div data-testid="reagent-setup-checklist" className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-sky-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-violet-600" />
                    <h3 className="font-semibold text-[var(--color-text)]">Reagent setup checklist</h3>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">Follow these steps before turning on strict reagent controls. Default catalog values are editable starter values.</p>
                </div>
                <div className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-violet-700 border border-violet-200">{completedSetupSteps}/{reagentSetupChecklist.length} setup steps ready</div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {reagentSetupChecklist.map((step) => (
                  <button key={step.id} onClick={() => setTab(step.tab)} className="rounded-xl border border-white/70 bg-white/80 p-3 text-left shadow-sm hover:bg-white transition-colors">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                      {step.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4 text-amber-500" />}
                      {step.label}
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{step.detail}</p>
                  </button>
                ))}
              </div>
            </div>

            {loadingSummary ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : summary ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard icon={<FlaskConical className="w-5 h-5 text-sky-500" />} label={t('totalOrders')} value={summary.total_orders} />
                <KpiCard icon={<Beaker className="w-5 h-5 text-emerald-500" />} label={t('testsDone')} value={summary.total_tests_done} />
                <KpiCard icon={<Clock className="w-5 h-5 text-amber-500" />} label={t('testsPending')} value={summary.total_tests_pending} />
                <KpiCard icon={<Printer className="w-5 h-5 text-violet-500" />} label={t('reportsPrinted')} value={summary.total_reports_printed} />
                <KpiCard icon={<Beaker className="w-5 h-5 text-fuchsia-500" />} label={t('reagentsUsed')} value={summary.total_reagents_used} />
                <KpiCard icon={<Film className="w-5 h-5 text-pink-500" />} label={t('filmsUsed')} value={summary.total_films_used} />
                <KpiCard icon={<TrendingUp className="w-5 h-5 text-emerald-500" />} label={t('revenue')} value={`৳${((summary.revenue_from_lab || 0) / 100).toFixed(0)}`} />
                <KpiCard icon={<AlertTriangle className="w-5 h-5 text-red-500" />} label={t('abnormalResults')} value={summary.abnormal_results} />
              </div>
            ) : (
              <EmptyState icon={<BarChart3 className="w-10 h-10 text-[var(--color-text-muted)]" />} title={t('noData')} description={t('selectDateToView')} />
            )}
          </div>
        )}

        {/* ── CONSUMABLES TAB / DEDICATED CATALOG UTILITY ── */}
        {(tab === 'consumables' || (isReagentControlPage && dedicatedUtilityView === 'catalog')) && (
          <div className="space-y-4">
            {isReagentControlPage && dedicatedUtilityView === 'catalog' && (
              <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[var(--color-text)]">Reagent & consumable catalog</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">Create or edit the items used by test recipes and stock lots.</p>
                </div>
                <button type="button" onClick={() => setDedicatedUtilityView(null)} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">Back to stock</button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input type="text" placeholder={t('searchConsumables')} value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500">
                <option value="">{t('allCategories')}</option>
                {['reagent','tube','strip','film','chemical','kit','slide','syringe','other'].map(c => (
                        <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
              <button onClick={() => { setEditingConsumable(null); resetConsumableForm(); setShowConsumableForm(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors">
                <Plus className="w-4 h-4" />{t('addConsumable')}
              </button>
              <button onClick={() => { setShowStockIn(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
                <ArrowUpDown className="w-4 h-4" />{t('stockIn')}
              </button>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">{t('code')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('name')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('category')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('stock')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('reorderLevel')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('unitPrice')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loadingConsumables ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--color-text-muted)]">{t('loading')}</td></tr>
                  ) : consumables.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--color-text-muted)]">{t('noConsumables')}</td></tr>
                  ) : consumables.map(c => (
                    <tr key={c.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">{c.code}</td>
                      <td className="px-4 py-3 font-medium text-[var(--color-text)]">{c.name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600 border border-slate-200">
                          {categoryIcon(c.category)} {categoryLabel(c.category)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${(c.total_stock ?? 0) <= (c.reorder_level ?? 0) ? 'text-red-600' : 'text-emerald-600'}`}>
                          {c.total_stock ?? 0}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)] ml-1">{c.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.reorder_level}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">৳{((c.unit_price ?? 0) / 100).toFixed(0)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setEditingConsumable(c); setConsumableForm({
                            code: c.code, name: c.name, category: c.category, unit: c.unit,
                            unit_price: paisaToTakaInput(c.unit_price), reorder_level: String(c.reorder_level), reorder_qty: String(c.reorder_qty),
                            description: '', storage_condition: '',
                          }); setShowConsumableForm(true); }}
                            className="p-1.5 rounded hover:bg-sky-50 text-[var(--color-text-muted)] hover:text-sky-600 transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => {
                            if (confirm(t('confirmDeleteConsumable'))) deleteConsumableMutation.mutate({ id: c.id });
                          }} className="p-1.5 rounded hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-600 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}


        {/* ── STOCK CONTROLS TAB ── */}
        {tab === 'stock' && dedicatedUtilityView !== 'catalog' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)] space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">Reagent Stock</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">All active lots are shown. Select a reagent to filter by item, expiry and QC status.</p>
                </div>
                <button type="button" onClick={() => setShowStockIn(true)} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white">Add stock</button>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reagent or consumable</label>
                <select aria-label="Stock reagent or consumable" value={selectedConsumableId} onChange={e => setSelectedConsumableId(e.target.value)} className={inputCls}>
                  <option value="">All reagents and consumables</option>
                  {consumables.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Only QC Pass or not-required lots can be deducted. Failed and blocked lots stay visible for review.
              </div>
            </div>

            {isReagentControlPage && (
              <button
                type="button"
                aria-expanded={stockAdvancedOpen}
                onClick={() => setStockAdvancedOpen(value => !value)}
                className="flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-[var(--color-text)]">Stock setup & advanced actions</span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Locations, open-vial expiry, machine assignment, manual usage, transfer and waste.</span>
                </span>
                <span className="text-xs font-semibold text-violet-700">{stockAdvancedOpen ? 'Hide' : 'Show'}</span>
              </button>
            )}

            {(!isReagentControlPage || stockAdvancedOpen) && <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)] space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Stock locations</h3>
                {editingLocation && <button onClick={resetLocationForm} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel edit</button>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <input placeholder="Code" value={locationForm.location_code} onChange={e => setLocationForm(f => ({ ...f, location_code: e.target.value }))} className={inputCls} />
                <input placeholder="Name" value={locationForm.location_name} onChange={e => setLocationForm(f => ({ ...f, location_name: e.target.value }))} className={inputCls} />
                <select value={locationForm.location_type} onChange={e => setLocationForm(f => ({ ...f, location_type: e.target.value }))} className={inputCls}>
                  {['store','fridge','analyzer','rack','room','other'].map(type => <option key={type} value={type}>{type}</option>)}
                </select>
                <input placeholder="Description" value={locationForm.description} onChange={e => setLocationForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
                <button onClick={handleSaveLocation} disabled={!locationForm.location_code || !locationForm.location_name} className="rounded-lg bg-violet-600 text-white text-sm disabled:opacity-60">
                  {editingLocation ? 'Update' : 'Add location'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {locations.length === 0 ? (
                  <div className="text-sm text-[var(--color-text-muted)]">No locations yet</div>
                ) : locations.map(location => (
                  <div key={location.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{location.location_name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{location.location_code} • {location.location_type}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEditLocation(location)} className="px-2 py-1 text-xs rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]">Edit</button>
                      <button onClick={() => handleDeleteLocation(location.id)} className="px-2 py-1 text-xs rounded border border-red-200 text-red-600 hover:bg-red-50">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>}

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] font-semibold">Stock lots</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loadingStockLots ? (
                    <tr><td className="px-4 py-8 text-center text-[var(--color-text-muted)]">{t('loading')}</td></tr>
                  ) : stockLots.length === 0 ? (
                    <tr><td className="px-4 py-8 text-center text-[var(--color-text-muted)]">No active stock lots</td></tr>
                  ) : stockLots.map(lot => {
                    const inventoryBacked = isInventoryBackedStockLot(lot);
                    const productionUsableLot = isProductionUsableStockLot(lot);
                    const qcStatus = normalizeStockLotQcStatus(lot.qc_status);
                    const productionLockLabel = stockLotProductionLockLabel(lot);
                    const openVialStatus = stockLotOpenVialStatus(lot);
                    const legacyActionDisabledTitle = inventoryBacked ? inventoryBackedLegacyActionTitle : undefined;
                    const assignedMachine = lot.assigned_machine_name || lot.assigned_machine_code;
                    const assignedLocation = lot.analyzer_location_name || lot.analyzer_location_code;
                    const machineLabel = assignedMachine && assignedLocation ? assignedMachine + ' @ ' + assignedLocation : assignedMachine || assignedLocation || 'Not assigned';

                    return (
                      <tr key={(lot.ledger_type || 'lab') + '-' + lot.id} className="hover:bg-[var(--color-bg-secondary)]">
                        <td className="px-4 py-3">
                          <div className="text-xs font-semibold text-violet-700">
                            {lot.consumable_name || 'Reagent'}{lot.consumable_code ? ` (${lot.consumable_code})` : ''}
                          </div>
                          <div className="font-medium flex items-center gap-2">
                            <span>Lot {lot.lot_number || lot.id}</span>
                            {inventoryBacked && <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] border border-blue-200">InventoryStock</span>}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)] flex flex-wrap items-center gap-2">
                            <span>{lot.location_name || 'No location'} • Exp {lot.expiry_date || '—'}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${stockLotQcBadgeClass(lot)}`}>QC {qcStatus}</span>
                            <span data-testid="open-vial-expiry-status" className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${stockLotOpenVialBadgeClass(openVialStatus)}`}>{openVialStatus.label}</span>
                            <span className={productionUsableLot ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>{productionLockLabel}</span>
                          </div>
                          {inventoryBacked && (
                            <div className="text-xs text-blue-700 mt-1 space-y-1">
                              <div>Managed through canonical inventory. QC, open-vial metadata, and machine assignment can be updated here; transfer/write-off stays in inventory workflows.</div>
                              <div className="flex flex-wrap gap-2">
                                <Link to={inventoryRoute(base, 'transfers')} className="underline font-medium">Inventory transfer</Link>
                                <Link to={inventoryRoute(base, 'write-off')} className="underline font-medium">Inventory write-off</Link>
                              </div>
                              <div className="flex items-center gap-1 text-slate-700"><Cpu className="w-3 h-3" /> Machine: {machineLabel}</div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold">{lot.quantity_available}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button disabled={!canUseLabMonitoringLotMetadataAction(lot)} onClick={() => handleQc(lot, 'passed')} className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs border border-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed">QC Pass</button>
                            <button disabled={!canUseLabMonitoringLotMetadataAction(lot)} onClick={() => handleQc(lot, 'failed')} className="px-2 py-1 rounded bg-red-50 text-red-700 text-xs border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed">QC Fail</button>
                            <button disabled={!canUseLabMonitoringLotMetadataAction(lot)} onClick={() => setOpenLotForm(f => ({ ...f, stock_id: String(lot.id), ledger_type: isInventoryBackedStockLot(lot) ? 'inventory' : 'lab' }))} className="px-2 py-1 rounded bg-sky-50 text-sky-700 text-xs border border-sky-200 disabled:opacity-50 disabled:cursor-not-allowed">Open vial</button>
                            <button disabled={!inventoryBacked} title={inventoryBacked ? undefined : 'Machine assignment is only for canonical InventoryStock reagent lots.'} onClick={() => setMachineAssignForm(f => ({ ...f, stock_id: String(lot.id), machine_id: lot.assigned_machine_id ? String(lot.assigned_machine_id) : '', location_id: lot.analyzer_location_id ? String(lot.analyzer_location_id) : '', remarks: lot.analyzer_assignment_remarks || '' }))} className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs border border-blue-200 disabled:opacity-50 disabled:cursor-not-allowed">Assign machine</button>
                            <button disabled={!canUseLegacyLabStockOnlyAction(lot)} title={legacyActionDisabledTitle} onClick={() => setTransferForm(f => ({ ...f, stock_id: String(lot.id), target_location_id: '' }))} className="px-2 py-1 rounded bg-violet-50 text-violet-700 text-xs border border-violet-200 disabled:opacity-50 disabled:cursor-not-allowed">Transfer</button>
                            <button disabled={!canUseLegacyLabStockOnlyAction(lot)} title={legacyActionDisabledTitle} onClick={() => setWasteForm(f => ({ ...f, stock_id: String(lot.id), quantity: String(lot.quantity_available) }))} className="px-2 py-1 rounded bg-amber-50 text-amber-700 text-xs border border-amber-200 disabled:opacity-50 disabled:cursor-not-allowed">Waste</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(!isReagentControlPage || stockAdvancedOpen) && <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                <h3 className="font-semibold">Open vial / onboard expiry</h3>
                <p className="text-xs text-[var(--color-text-muted)]">Open vial → Days → Remarks → Open. Use this only when the reagent bottle/kit is physically opened or loaded onboard an analyzer.</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input placeholder="Stock lot ID" value={openLotForm.stock_id} onChange={e => setOpenLotForm(f => ({ ...f, stock_id: e.target.value }))} className={inputCls} />
                  <select aria-label="Ledger" value={openLotForm.ledger_type} onChange={e => setOpenLotForm(f => ({ ...f, ledger_type: e.target.value }))} className={inputCls}>
                    <option value="">Ledger</option>
                    <option value="lab">Lab stock</option>
                    <option value="inventory">InventoryStock</option>
                  </select>
                  <input type="number" min="1" max="365" step="1" placeholder="Days" value={openLotForm.onboard_expiry_days} onChange={e => setOpenLotForm(f => ({ ...f, onboard_expiry_days: e.target.value }))} className={inputCls} />
                  <button onClick={handleOpenLot} disabled={!openLotReady} className="rounded-lg bg-sky-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed">Open</button>
                </div>
                <input maxLength={500} placeholder="Remarks, e.g. Opened for hematology analyzer" value={openLotForm.remarks} onChange={e => setOpenLotForm(f => ({ ...f, remarks: e.target.value }))} className={inputCls} />
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                <h3 className="font-semibold">Assign to machine/location</h3>
                <p className="text-xs text-[var(--color-text-muted)]">Only canonical InventoryStock reagent lots can be assigned. This links the physical lot to the analyzer bench without changing stock quantity.</p>
                <input placeholder="InventoryStock lot ID" value={machineAssignForm.stock_id} onChange={e => setMachineAssignForm(f => ({ ...f, stock_id: e.target.value }))} className={inputCls} />
                <select value={machineAssignForm.machine_id} onChange={e => setMachineAssignForm(f => ({ ...f, machine_id: e.target.value }))} className={inputCls}>
                  <option value="">Machine</option>
                  {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.machine_name || machine.machine_code || String(machine.id)}</option>)}
                </select>
                <select value={machineAssignForm.location_id} onChange={e => setMachineAssignForm(f => ({ ...f, location_id: e.target.value }))} className={inputCls}>
                  <option value="">Analyzer location</option>
                  {locations.map(location => <option key={location.id} value={location.id}>{location.location_name}</option>)}
                </select>
                <input maxLength={500} placeholder="Remarks, e.g. CBC reagent loaded on Hematology Analyzer" value={machineAssignForm.remarks} onChange={e => setMachineAssignForm(f => ({ ...f, remarks: e.target.value }))} className={inputCls} />
                <button onClick={handleAssignMachine} disabled={!isMachineAssignmentFormReady(machineAssignForm)} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed">Assign</button>
              </div>


              <div data-testid="manual-reagent-usage-card" className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                <div>
                  <h3 className="font-semibold">{t('manualUsageTitle')}</h3>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('manualUsageSubtitle')}</p>
                </div>
                <select value={manualUsageForm.consumable_id} onChange={e => setManualUsageForm(f => ({ ...f, consumable_id: e.target.value }))} className={inputCls}>
                  <option value="">{t('selectReagentConsumable')}</option>
                  {mappingConsumables.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" min="0.0001" step="0.0001" placeholder={t('qty')} value={manualUsageForm.quantity} onChange={e => setManualUsageForm(f => ({ ...f, quantity: e.target.value }))} className={inputCls} />
                  <select aria-label={t('usageType')} value={manualUsageForm.usage_type} onChange={e => setManualUsageForm(f => ({ ...f, usage_type: e.target.value }))} className={inputCls}>
                    {MANUAL_USAGE_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
                  </select>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  {t(MANUAL_USAGE_TYPE_OPTIONS.find(option => option.value === normalizedManualUsageType(manualUsageForm.usage_type))?.helpKey || 'manualUsageTypes.manual.help')}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select value={manualUsageForm.location_id} onChange={e => setManualUsageForm(f => ({ ...f, location_id: e.target.value }))} className={inputCls}>
                    <option value="">{t('anyLocation')}</option>
                    {locations.map(location => <option key={location.id} value={location.id}>{location.location_name}</option>)}
                  </select>
                  <input inputMode="numeric" placeholder={t('referenceIdOrderItem')} value={manualUsageForm.reference_id} onChange={e => setManualUsageForm(f => ({ ...f, reference_id: e.target.value }))} className={inputCls} />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <input maxLength={500} placeholder={t('manualUsageRemarksPlaceholder')} value={manualUsageForm.remarks} onChange={e => setManualUsageForm(f => ({ ...f, remarks: e.target.value }))} className={inputCls} />
                  <button onClick={handleManualUsage} disabled={!manualUsageForm.consumable_id || !manualUsageForm.quantity || !manualUsageForm.remarks.trim()} className="px-4 rounded-lg bg-rose-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed">{t('record')}</button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">{t('manualUsageExample')}</p>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                <h3 className="font-semibold">Transfer location</h3>
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Stock lot ID" value={transferForm.stock_id} onChange={e => setTransferForm(f => ({ ...f, stock_id: e.target.value }))} className={inputCls} />
                  <select value={transferForm.target_location_id} onChange={e => setTransferForm(f => ({ ...f, target_location_id: e.target.value }))} className={inputCls}>
                    <option value="">Target location</option>
                    {locations.map(location => <option key={location.id} value={location.id}>{location.location_name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <input placeholder="Remarks" value={transferForm.remarks} onChange={e => setTransferForm(f => ({ ...f, remarks: e.target.value }))} className={inputCls} />
                  <button onClick={handleTransferLot} disabled={!transferForm.stock_id || !transferForm.target_location_id || selectedTransferLotIsInventoryBacked} title={selectedTransferLotIsInventoryBacked ? inventoryBackedLegacyActionTitle : undefined} className="px-4 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed">Transfer</button>
                </div>
              </div>

              <div data-testid="waste-request-card" className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                <div>
                  <h3 className="font-semibold flex items-center gap-2"><Trash2 className="w-4 h-4 text-amber-600" /> Waste request</h3>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Expired / broken / QC failed / spillage / temperature breach → submit request. Stock is deducted only after manager/admin approval.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input inputMode="numeric" placeholder="Stock lot ID" value={wasteForm.stock_id} onChange={e => setWasteForm(f => ({ ...f, stock_id: e.target.value }))} className={inputCls} />
                  <input type="number" min="1" step="1" placeholder="Qty" value={wasteForm.quantity} onChange={e => setWasteForm(f => ({ ...f, quantity: e.target.value }))} className={inputCls} />
                  <select aria-label="Waste reason" value={wasteForm.reason} onChange={e => setWasteForm(f => ({ ...f, reason: e.target.value }))} className={inputCls}>
                    {WASTE_REASON_OPTIONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                  </select>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  {wasteReasonHelp(wasteForm.reason)}
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <input maxLength={500} placeholder={wasteForm.reason === 'other' ? 'Remarks required for other reason' : 'Remarks, e.g. Daily control spillage'} value={wasteForm.remarks} onChange={e => setWasteForm(f => ({ ...f, remarks: e.target.value }))} className={inputCls} />
                  <button onClick={handleWasteRequest} disabled={!wasteRequestReady || selectedWasteLotIsInventoryBacked} title={selectedWasteLotIsInventoryBacked ? inventoryBackedLegacyActionTitle : undefined} className="px-4 rounded-lg bg-amber-600 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed">Submit</button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">Approval/rejection stays pending for manager/admin review; approved waste creates a stock movement and audit log.</p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                <span className="font-semibold">Waste requests</span>
                <select value={wasteStatusFilter} onChange={e => setWasteStatusFilter(e.target.value)} className="px-2 py-1 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg)]">
                  {['pending','approved','rejected','all'].map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <table className="w-full text-sm"><tbody className="divide-y divide-[var(--color-border)]">
                {loadingWasteRequests ? (
                  <tr><td className="px-4 py-8 text-center text-[var(--color-text-muted)]">{t('loading')}</td></tr>
                ) : wasteRequests.length === 0 ? (
                  <tr><td className="px-4 py-8 text-center text-[var(--color-text-muted)]">No waste requests</td></tr>
                ) : wasteRequests.map(req => (
                  <tr key={req.id} className="hover:bg-[var(--color-bg-secondary)]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{req.consumable_name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">Lot {req.lot_number || req.stock_id} • {req.location_name || 'No location'} • {wasteReasonLabel(req.reason)}</div>
                      {req.remarks && <div className="text-xs text-[var(--color-text-muted)] mt-1">Remarks: {req.remarks}</div>}
                    </td>
                    <td className="px-4 py-3 font-semibold">{req.quantity}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`inline-flex px-2 py-1 rounded-full border ${wasteStatusClass(req.status)}`}>{req.status}</span>
                      <div className="mt-1 text-[var(--color-text-muted)]">By {req.requested_by_name || 'operator'}{req.reviewed_by_name ? ` · Reviewed by ${req.reviewed_by_name}` : ''}</div>
                    </td>
                    <td className="px-4 py-3 text-right">{req.status === 'pending' && <div className="flex justify-end gap-2"><button onClick={() => handleReviewWaste(req.id, 'approve')} className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs border border-emerald-200">Approve</button><button onClick={() => handleReviewWaste(req.id, 'reject')} className="px-2 py-1 rounded bg-red-50 text-red-700 text-xs border border-red-200">Reject</button></div>}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
            </>}
          </div>
        )}


        {/* ── REAGENT READINESS TAB ── */}
        {tab === 'readiness' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[var(--color-text)]">Mapping coverage / strict-mode readiness</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">Check active billing lab tests, reagent mappings, QC-failed usable lots, and shortage exceptions before enabling strict production mode.</p>
                </div>
                <select value={coverageStatusFilter} onChange={e => setCoverageStatusFilter(e.target.value)} className={inputCls + ' w-44'}>
                  {['all','missing','mapped'].map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              {mappingCoverageSummary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <KpiCard icon={<FlaskConical className="w-5 h-5 text-violet-500" />} label="Active billing tests" value={mappingCoverageSummary.total_tests} />
                  <KpiCard icon={<Beaker className="w-5 h-5 text-emerald-500" />} label="Mapped tests" value={mappingCoverageSummary.mapped_tests} />
                  <KpiCard icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} label="Missing maps" value={mappingCoverageSummary.missing_tests} />
                  <KpiCard icon={<Activity className="w-5 h-5 text-sky-500" />} label="Coverage" value={`${mappingCoverageSummary.coverage_percent}%`} />
                  <KpiCard icon={<Package className="w-5 h-5 text-fuchsia-500" />} label="Expected qty" value={mappingCoverageSummary.expected_quantity} />
                </div>
              )}
              <div className={`rounded-lg border px-4 py-3 text-sm ${mappingCoverageSummary?.strict_mode_ready ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                {strictModeReadinessMessage(mappingCoverageSummary)}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4" data-testid="strict-readiness-checks">
                {strictReadinessChecks.map(check => (
                  <div key={check.id} className={`rounded-xl border p-3 ${check.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide">{check.label}</p>
                      {check.ready ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </div>
                    <p className="mt-2 text-2xl font-bold font-data">{check.value}</p>
                    <p className="mt-1 text-xs font-medium">Target: {check.target}</p>
                    <p className="mt-2 text-xs opacity-80">{check.detail}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Test</th>
                      <th className="text-left px-4 py-3 font-medium">Mappings</th>
                      <th className="text-left px-4 py-3 font-medium">Expected qty</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {loadingMappingCoverage ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-[var(--color-text-muted)]">Loading mapping coverage…</td></tr>
                    ) : mappingCoverageRows.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No lab tests found for this coverage filter.</td></tr>
                    ) : mappingCoverageRows.map(row => (
                      <tr key={row.lab_test_id} className="hover:bg-[var(--color-bg-secondary)]">
                        <td className="px-4 py-3"><div className="font-medium">{row.name}</div><div className="text-xs text-[var(--color-text-muted)]">{row.code || row.lab_test_id} • {row.category || row.department || 'Lab'}</div></td>
                        <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{row.mapping_count} total • {row.mandatory_count} mandatory</td>
                        <td className="px-4 py-3 font-semibold">{row.expected_quantity}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full border text-xs font-medium ${mappingCoverageStatusClass(row.status)}`}>{row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[var(--color-text)]">Billing-time reagent reconciliation</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">Audit each billed lab test against the expected reagent and the quantity actually deducted from stock.</p>
                </div>
                <select value={reconciliationStatusFilter} onChange={e => setReconciliationStatusFilter(e.target.value)} className={inputCls + ' w-72'}>
                  {REAGENT_RECONCILIATION_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="billing-reagent-reconciliation-legend">
                {(['ok', 'missing', 'exception'] as const).map(status => (
                  <div key={status} className={`rounded-xl border px-4 py-3 ${reagentReconciliationStatusClass(status)}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide">{reagentReconciliationStatusLabel(status)}</p>
                    <p className="mt-1 text-sm font-medium">{reagentReconciliationStatusMeaning(status)}</p>
                  </div>
                ))}
              </div>
              {reagentReconciliationSummary && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <KpiCard icon={<FlaskConical className="w-5 h-5 text-violet-500" />} label="Billed tests" value={reagentReconciliationSummary.tests} />
                  <KpiCard icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />} label="OK" value={reagentReconciliationSummary.ok} />
                  <KpiCard icon={<Beaker className="w-5 h-5 text-emerald-500" />} label="Deducted qty" value={reagentReconciliationSummary.consumed_quantity} />
                  <KpiCard icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} label="Missing" value={reagentReconciliationSummary.missing} />
                  <KpiCard icon={<AlertTriangle className="w-5 h-5 text-red-500" />} label="Exceptions" value={reagentReconciliationSummary.exception} />
                  <KpiCard icon={<TrendingUp className="w-5 h-5 text-sky-500" />} label="Cost" value={`৳${Number(reagentReconciliationSummary.consumed_cost || 0).toFixed(0)}`} />
                </div>
              )}
              <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Billing / test</th>
                      <th className="text-left px-4 py-3 font-medium">Expected reagent</th>
                      <th className="text-left px-4 py-3 font-medium">Deducted</th>
                      <th className="text-left px-4 py-3 font-medium">Cost</th>
                      <th className="text-left px-4 py-3 font-medium">Status / action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {loadingReagentReconciliation ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-muted)]">Loading billing-time reagent reconciliation…</td></tr>
                    ) : reagentReconciliationRows.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No billed lab reagent reconciliation rows for this filter.</td></tr>
                    ) : reagentReconciliationRows.map(row => (
                      <tr key={row.lab_order_item_id} className="hover:bg-[var(--color-bg-secondary)]">
                        <td className="px-4 py-3"><div className="font-medium">{row.test_name}</div><div className="text-xs text-[var(--color-text-muted)]">{row.invoice_no || row.bill_id} • {row.patient_name || 'Patient'} • {row.order_no || row.lab_order_id}</div></td>
                        <td className="px-4 py-3 font-semibold">{row.expected_quantity > 0 ? row.expected_quantity : 'Not mapped'}</td>
                        <td className="px-4 py-3 font-semibold">{row.consumed_quantity}</td>
                        <td className="px-4 py-3">৳{Number(row.consumed_cost || 0).toFixed(0)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full border text-xs font-medium ${reagentReconciliationStatusClass(row.status)}`}>{reagentReconciliationStatusLabel(row.status)}</span>
                          <div className="mt-1 text-xs text-[var(--color-text-muted)]">{row.status_meaning || reagentReconciliationStatusMeaning(row.status)}</div>
                          {row.exception_count > 0 && <div className="mt-1 text-xs font-semibold text-red-600">{row.exception_count} open exception{row.exception_count > 1 ? 's' : ''}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TEST-TO-REAGENT MAPPING TAB ── */}
        {tab === 'mappings' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)] space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-semibold text-[var(--color-text)]">Lab inventory policy</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">Current: {labInventoryModeLabel(inventoryPolicy.lab_inventory_mode)} • {labInventoryConsumptionPolicyLabel(inventoryPolicy.reagent_consumption_timing)}. First hospital go-live should stay soft so billing/result never stops while warnings and mapping gaps are collected.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${firstHospitalPolicyActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {firstHospitalPolicyActive ? 'First hospital safe preset active' : 'Review go-live preset'}
                  </span>
                  <button
                    type="button"
                    data-testid="apply-first-hospital-lab-policy"
                    onClick={() => handleUpdateInventoryPolicy(FIRST_HOSPITAL_LAB_INVENTORY_POLICY)}
                    disabled={firstHospitalPolicyActive}
                    className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Apply go-live safe policy
                  </button>
                  <button
                    type="button"
                    data-testid="enable-strict-production-lab-policy"
                    onClick={() => handleUpdateInventoryPolicy(STRICT_PRODUCTION_LAB_INVENTORY_POLICY)}
                    disabled={strictProductionPolicyActive || loadingMappingCoverage || !strictProductionReady}
                    title={strictProductionReady ? 'Enable strict production mode' : strictModeReadinessMessage(mappingCoverageSummary)}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Enable strict production
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Why soft mode now?</p>
                <p className="mt-1">At first hospital go-live, stock deduction failure must not block billing or result entry. Keep soft mode to record warnings/exceptions, clean reagent mappings, reconcile the first billing days, then move to strict production mode only after readiness is clean.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="space-y-1 text-xs font-medium text-[var(--color-text-muted)]">
                  <span>Mode</span>
                  <select
                    value={inventoryPolicy.lab_inventory_mode}
                    onChange={e => {
                      const mode = e.target.value as LabInventoryPolicy['lab_inventory_mode'];
                      handleUpdateInventoryPolicy(mode === 'strict' ? STRICT_PRODUCTION_LAB_INVENTORY_POLICY : { lab_inventory_mode: mode });
                    }}
                    className={inputCls}
                  >
                    <option value="disabled">Disabled</option>
                    <option value="soft">Soft setup mode</option>
                    <option value="strict">Strict production mode</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-[var(--color-text-muted)]">
                  <span>Consumption timing</span>
                  <select value={inventoryPolicy.reagent_consumption_timing} onChange={e => handleUpdateInventoryPolicy({ reagent_consumption_timing: e.target.value as 'billing' | 'result' })} className={inputCls}>
                    <option value="billing">Billing-time semi-auto recommended now</option>
                    <option value="result">Result/LIS auto finalization (future)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <input type="checkbox" checked={inventoryPolicy.allow_result_without_stock} onChange={e => handleUpdateInventoryPolicy({ allow_result_without_stock: e.target.checked })} />
                  Allow result without stock
                </label>
                <label className="flex items-center gap-2 text-sm rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <input type="checkbox" checked={inventoryPolicy.require_test_mapping_for_completion} onChange={e => handleUpdateInventoryPolicy({ require_test_mapping_for_completion: e.target.checked })} />
                  Require mappings
                </label>
              </div>
              <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3">
                <p className="text-xs font-semibold text-[var(--color-text)]">Recommended first-hospital go-live preset</p>
                <div className="grid grid-cols-1 gap-2 text-xs text-[var(--color-text-muted)] md:grid-cols-4">
                  <p><span className="font-semibold text-[var(--color-text)]">Mode:</span> Soft setup mode</p>
                  <p><span className="font-semibold text-[var(--color-text)]">Timing:</span> Billing-time semi-auto</p>
                  <p><span className="font-semibold text-[var(--color-text)]">Result block:</span> OFF during go-live</p>
                  <p><span className="font-semibold text-[var(--color-text)]">Mappings required:</span> OFF initially</p>
                </div>
              </div>
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs font-semibold text-red-900">Strict production preset after clean readiness</p>
                <div className="grid grid-cols-1 gap-2 text-xs text-red-800 md:grid-cols-4">
                  <p><span className="font-semibold">Mode:</span> Strict production mode</p>
                  <p><span className="font-semibold">Timing:</span> Billing-time</p>
                  <p><span className="font-semibold">Allow result without stock:</span> OFF</p>
                  <p><span className="font-semibold">Require mappings:</span> ON</p>
                </div>
                <p className="text-xs text-red-800">Readiness check runs before enabling. If catalog, stock, mappings, QC, or open exceptions are not clean, the API returns a 409 blocker instead of saving strict mode.</p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)] space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-semibold text-[var(--color-text)]">Test-to-reagent consumption mapping</h3>
                  <p className="text-sm text-[var(--color-text-muted)] mt-1">Configure expected reagent, tube, film, kit, or chemical usage per lab test. This enables LIS-less semi-auto stock deduction when the mapped test is billed under billing-time policy.</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">Default catalog uses safe test-equivalent starter values; hospital lab admins can edit, disable, or replace them per analyzer kit IFU/SOP.</p>
                </div>
                <button data-testid="seed-default-reagent-catalog" onClick={handleSeedDefaultReagentCatalog} className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100">Load default catalog</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <select value={mappingForm.lab_test_id} onChange={e => setMappingForm(f => ({ ...f, lab_test_id: e.target.value }))} className={inputCls}>
                  <option value="">Select lab test</option>
                  {labTests.map(test => <option key={test.id} value={test.id}>{test.name} ({test.code || test.id})</option>)}
                </select>
                <select value={mappingForm.consumable_id} onChange={e => setMappingForm(f => ({ ...f, consumable_id: e.target.value }))} className={inputCls}>
                  <option value="">Select reagent/consumable</option>
                  {mappingConsumables.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
                </select>
                <input type="number" min="0.0001" step="0.0001" placeholder="Qty/test" value={mappingForm.qty_per_test} onChange={e => setMappingForm(f => ({ ...f, qty_per_test: e.target.value }))} className={inputCls} />
                <label className="flex items-center gap-2 text-sm rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <input type="checkbox" checked={mappingForm.is_mandatory} onChange={e => setMappingForm(f => ({ ...f, is_mandatory: e.target.checked }))} />
                  Mandatory
                </label>
                <button onClick={handleSaveMapping} disabled={!mappingForm.lab_test_id || !mappingForm.consumable_id} className="rounded-lg bg-violet-600 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed">Save mapping</button>
              </div>
              <input placeholder="Notes, e.g. CBC analyzer reagent, EDTA tube, repeat-run rule" value={mappingForm.notes} onChange={e => setMappingForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} />
              <div data-testid="bulk-mapping-import" className="rounded-lg border border-dashed border-violet-200 bg-violet-50/50 p-3 space-y-2">
                <div>
                  <p className="text-sm font-semibold text-violet-800">Bulk mapping import</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Paste rows with or without header: lab_test_id, consumable_id, qty_per_test, mandatory(true/false), notes</p>
                </div>
                <textarea value={bulkMappingText} onChange={e => setBulkMappingText(e.target.value)} rows={4} className={inputCls} placeholder={`lab_test_id, consumable_id, qty_per_test, mandatory(true/false), notes
101, 5, 1, true, CBC reagent pack
101, 8, 1, true, EDTA tube
102, 9, 1, true, Glucose reagent`} />
                <div className="flex justify-end">
                  <button onClick={handleBulkMappingImport} disabled={!bulkMappingText.trim()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed">Import mappings</button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Test</th>
                    <th className="text-left px-4 py-3 font-medium">Reagent/Consumable</th>
                    <th className="text-left px-4 py-3 font-medium">Qty per test</th>
                    <th className="text-left px-4 py-3 font-medium">Mode</th>
                    <th className="text-left px-4 py-3 font-medium">Notes</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loadingMappings || loadingLabTests ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--color-text-muted)]">Loading mappings…</td></tr>
                  ) : mappings.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No test-to-reagent mapping yet. Add mappings to enable billing-time semi-auto reagent consumption.</td></tr>
                  ) : mappings.map(mapping => {
                    const isEditing = editingMappingId === mapping.id;
                    return (
                    <tr key={mapping.id} className="hover:bg-[var(--color-bg-secondary)]">
                      <td className="px-4 py-3"><div className="font-medium">{mapping.test_name || mapping.lab_test_id}</div><div className="text-xs text-[var(--color-text-muted)]">{mapping.test_code || mapping.lab_test_id}</div></td>
                      <td className="px-4 py-3"><div className="font-medium">{mapping.consumable_name || mapping.consumable_id}</div><div className="text-xs text-[var(--color-text-muted)]">{mapping.consumable_code || mapping.consumable_id} • {categoryLabel(mapping.category || 'reagent')}</div></td>
                      <td className="px-4 py-3 font-semibold">{isEditing ? <input aria-label="Qty per test" type="number" min="0.0001" step="0.0001" value={mappingEditForm.qty_per_test} onChange={e => setMappingEditForm(f => ({ ...f, qty_per_test: e.target.value }))} className={inputCls + ' w-28'} /> : <>{mapping.qty_per_test} <span className="text-xs text-[var(--color-text-muted)]">{mapping.unit || ''}</span></>}</td>
                      <td className="px-4 py-3">{isEditing ? <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={mappingEditForm.is_mandatory} onChange={e => setMappingEditForm(f => ({ ...f, is_mandatory: e.target.checked }))} /> Mandatory</label> : <span className={isMandatoryMapping(mapping.is_mandatory) ? 'text-red-600 text-xs font-medium' : 'text-slate-600 text-xs font-medium'}>{isMandatoryMapping(mapping.is_mandatory) ? 'Mandatory' : 'Optional'}</span>}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{isEditing ? <input aria-label="Mapping notes" value={mappingEditForm.notes} onChange={e => setMappingEditForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} /> : (mapping.notes || '—')}</td>
                      <td className="px-4 py-3 text-right">{isEditing ? <div className="flex justify-end gap-2"><button onClick={() => handleUpdateMapping(mapping.id)} className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs border border-emerald-200">Save</button><button onClick={resetMappingEditForm} className="px-2 py-1 rounded bg-slate-50 text-slate-700 text-xs border border-slate-200">Cancel</button></div> : <div className="flex justify-end gap-2"><button onClick={() => startEditMapping(mapping)} className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs border border-blue-200">Edit</button><button onClick={() => handleDeleteMapping(mapping.id)} className="px-2 py-1 rounded bg-red-50 text-red-700 text-xs border border-red-200">Remove</button></div>}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── INVENTORY EXCEPTIONS TAB ── */}
        {tab === 'exceptions' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[var(--color-text)]">Exception review & cleanup</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">Fix the root cause first, then Retry. If the event no longer needs deduction, close it as Resolve or Ignore with audit context.</p>
              </div>
              <select value={exceptionStatusFilter} onChange={e => setExceptionStatusFilter(e.target.value)} className={inputCls + ' w-44'} aria-label="Exception status filter">
                {['open','resolved','ignored','all'].map(status => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Missing mapping</div>
                <p className="mt-2 text-sm text-[var(--color-text)]">Add the test-to-reagent mapping, set qty per test, save, then Retry.</p>
                <button onClick={() => setTab('mappings')} className="mt-3 text-xs font-medium underline">Open Mappings</button>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Stock shortage</div>
                <p className="mt-2 text-sm text-[var(--color-text)]">Add GRN/opening stock with lot, expiry, location, and quantity, then Retry.</p>
                <button onClick={() => setTab('stock')} className="mt-3 text-xs font-medium underline">Open Stock</button>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">QC failed lot</div>
                <p className="mt-2 text-sm text-[var(--color-text)]">Quarantine/replace failed lot or pass a usable lot after QC review, then Retry.</p>
                <button onClick={() => setTab('stock')} className="mt-3 text-xs font-medium underline">Review Lots</button>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Issue</th>
                    <th className="text-left px-4 py-3 font-medium">Fix guidance</th>
                    <th className="text-left px-4 py-3 font-medium">Order/Test</th>
                    <th className="text-left px-4 py-3 font-medium">Source</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loadingExceptions ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--color-text-muted)]">{t('loading')}</td></tr>
                  ) : inventoryExceptions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-muted)]">
                        No exceptions need action for this filter. Keep soft-mode warnings reviewed before enabling strict reagent controls.
                      </td>
                    </tr>
                  ) : inventoryExceptions.map(item => {
                    const guide = labInventoryExceptionResolutionGuide(item.reason);
                    return (
                      <tr key={item.id} className="hover:bg-[var(--color-bg-secondary)] align-top">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${labInventoryExceptionSeverityClass(item.severity)}`}>{item.severity}</span>
                            <span className="font-medium">{labInventoryExceptionReasonLabel(item.reason)}</span>
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)] mt-1">{item.message}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] max-w-md">
                          <div className="font-medium text-[var(--color-text)]">{guide.title}</div>
                          <div className="mt-1">{guide.action}</div>
                          <div className="mt-1">{guide.retry}</div>
                          {guide.tab !== 'exceptions' ? <button onClick={() => setTab(guide.tab)} className="mt-2 font-medium underline">Open {guide.tab === 'mappings' ? 'Mappings' : 'Stock controls'}</button> : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                          <div>Order: {item.lab_order_id || '—'}</div>
                          <div>Item: {item.lab_order_item_id || '—'} • Test: {item.lab_test_id || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                          <div>{item.source_event || '—'}</div>
                          <div>{item.created_at || '—'}</div>
                        </td>
                        <td className="px-4 py-3"><span className="px-2 py-1 rounded-full bg-slate-50 text-slate-700 text-xs border border-slate-200">{item.status}</span></td>
                        <td className="px-4 py-3 text-right">
                          {item.status === 'open' ? (
                            <div className="flex flex-col items-end gap-2">
                              {item.lab_order_item_id && item.lab_test_id ? <button onClick={() => handleRetryInventoryException(item.id)} className="px-2 py-1 rounded bg-violet-50 text-violet-700 text-xs border border-violet-200">Retry after fix</button> : null}
                              <div className="flex justify-end gap-2">
                                <button onClick={() => handleReviewInventoryException(item.id, 'resolved')} className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs border border-emerald-200">Resolve</button>
                                <button onClick={() => handleReviewInventoryException(item.id, 'ignored')} className="px-2 py-1 rounded bg-slate-50 text-slate-700 text-xs border border-slate-200">Ignore</button>
                              </div>
                            </div>
                          ) : <span className="text-xs text-[var(--color-text-muted)]">{item.resolution_remarks || item.resolved_at || 'Reviewed'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── LOGS TAB ── */}
        {tab === 'logs' && (
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t('time')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('type')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('details')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('quantity')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('performedBy')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {loadingLogs ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-muted)]">{t('loading')}</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-muted)]">{t('noLogs')}</td></tr>
                ) : logs.map(l => (
                  <tr key={l.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                    <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs whitespace-nowrap">{l.created_at?.split('T')[1]?.substring(0, 5)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {logTypeIcon(l.log_type)}
                        <span className="text-xs">{logTypeLabel(l.log_type)}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text)]">
                      {l.test_name && <span className="block text-xs font-medium">{l.test_name}</span>}
                      {l.consumable_name && <span className="block text-xs text-[var(--color-text-muted)]">{l.consumable_name}</span>}
                      {l.description && <span className="block text-xs text-[var(--color-text-muted)]">{l.description}</span>}
                    </td>
                    <td className="px-4 py-3 font-medium">{l.quantity}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{l.performed_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── ALERTS TAB ── */}
        {tab === 'alerts' && (
          <div className="space-y-6">
            {/* Low Stock */}
            <div>
              <h3 className="text-lg font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />{t('lowStockItems')}
              </h3>
              {alerts.low_stock.length === 0 ? (
                <div className="rounded-xl border border-[var(--color-border)] p-6 text-center text-[var(--color-text-muted)]">{t('noLowStock')}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {alerts.low_stock.map(c => (
                    <div key={c.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        {categoryIcon(c.category)}
                        <span className="font-medium text-sm">{c.name}</span>
                      </div>
                      <p className="text-xs text-amber-800">
                        {t('stock')}: <strong>{c.total_stock}</strong> {c.unit} / {t('reorder')}: {c.reorder_level} {c.unit}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Expiring */}
            <div>
              <h3 className="text-lg font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-red-500" />{t('expiringItems')}
              </h3>
              {alerts.expiring.length === 0 ? (
                <div className="rounded-xl border border-[var(--color-border)] p-6 text-center text-[var(--color-text-muted)]">{t('noExpiringItems')}</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {alerts.expiring.map(e => (
                    <div key={`${e.id}-${e.lot_number}`} className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <div className="font-medium text-sm">{e.name}</div>
                      <p className="text-xs text-red-800 mt-1">
                        {t('lot')}: {e.lot_number || 'N/A'} | {t('qty')}: {e.quantity_available} | {t('expires')}: {e.expiry_date} ({Math.round(e.days_remaining)} {t('days')})
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MODAL: Consumable Form ── */}
        {showConsumableForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowConsumableForm(false); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-lg">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">{editingConsumable ? t('editConsumable') : t('addConsumable')}</h2>
                <button onClick={() => setShowConsumableForm(false)}><X className="w-5 h-5 text-[var(--color-text-muted)]" /></button>
              </div>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">{t('code')}</label><input value={consumableForm.code} onChange={e => setConsumableForm(f => ({ ...f, code: e.target.value }))} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t('name')}</label><input value={consumableForm.name} onChange={e => setConsumableForm(f => ({ ...f, name: e.target.value }))} className={inputCls} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">{t('category')}</label>
                    <select value={consumableForm.category} onChange={e => setConsumableForm(f => ({ ...f, category: e.target.value }))} className={inputCls}>
                      {['reagent','tube','strip','film','chemical','kit','slide','syringe','other'].map(c => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                      ))}
                    </select>
                  </div>
                  <div><label className="block text-sm font-medium mb-1">{t('unit')}</label><input value={consumableForm.unit} onChange={e => setConsumableForm(f => ({ ...f, unit: e.target.value }))} className={inputCls} /></div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div><label className="block text-sm font-medium mb-1">{t('unitPrice')}</label><input type="number" value={consumableForm.unit_price} onChange={e => setConsumableForm(f => ({ ...f, unit_price: e.target.value }))} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t('reorderLevel')}</label><input type="number" value={consumableForm.reorder_level} onChange={e => setConsumableForm(f => ({ ...f, reorder_level: e.target.value }))} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t('reorderQty')}</label><input type="number" value={consumableForm.reorder_qty} onChange={e => setConsumableForm(f => ({ ...f, reorder_qty: e.target.value }))} className={inputCls} /></div>
                </div>
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setShowConsumableForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('cancel')}</button>
                <button onClick={handleSaveConsumable} disabled={createConsumableMutation.isPending || updateConsumableMutation.isPending}
                  className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-60 transition-colors">
                  {createConsumableMutation.isPending || updateConsumableMutation.isPending ? t('saving') : t('save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL: Stock In ── */}
        {showStockIn && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowStockIn(false); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <h2 className="text-lg font-semibold text-[var(--color-text)]">{t('stockIn')}</h2>
                <button onClick={() => setShowStockIn(false)}><X className="w-5 h-5 text-[var(--color-text-muted)]" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('consumable')}</label>
                  <select value={stockInForm.consumable_id} onChange={e => setStockInForm(f => ({ ...f, consumable_id: e.target.value }))} className={inputCls}>
                    <option value="">{t('selectConsumable')}</option>
                    {consumables.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">{t('quantity')}</label><input type="number" value={stockInForm.quantity} onChange={e => setStockInForm(f => ({ ...f, quantity: e.target.value }))} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t('purchasePrice')}</label><input type="number" value={stockInForm.purchase_price} onChange={e => setStockInForm(f => ({ ...f, purchase_price: e.target.value }))} className={inputCls} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">{t('lotNumber')}</label><input value={stockInForm.lot_number} onChange={e => setStockInForm(f => ({ ...f, lot_number: e.target.value }))} className={inputCls} /></div>
                  <div><label className="block text-sm font-medium mb-1">{t('expiryDate')}</label><input type="date" value={stockInForm.expiry_date} onChange={e => setStockInForm(f => ({ ...f, expiry_date: e.target.value }))} className={inputCls} /></div>
                </div>
                <div><label className="block text-sm font-medium mb-1">Location</label><select value={stockInForm.location_id} onChange={e => setStockInForm(f => ({ ...f, location_id: e.target.value }))} className={inputCls}><option value="">No specific location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.location_name} ({location.location_code})</option>)}</select></div>
                <div><label className="block text-sm font-medium mb-1">{t('remarks')}</label><input value={stockInForm.remarks} onChange={e => setStockInForm(f => ({ ...f, remarks: e.target.value }))} className={inputCls} /></div>
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setShowStockIn(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('cancel')}</button>
                <button onClick={handleStockIn} disabled={stockInMutation.isPending}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                  {stockInMutation.isPending ? t('saving') : t('addStock')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

/* ─── KPI Card ─── */
function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4 bg-[var(--color-bg)]">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      </div>
      <div className="text-2xl font-bold text-[var(--color-text)]">{value}</div>
    </div>
  );
}

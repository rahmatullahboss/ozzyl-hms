import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Scan, FileText, Search, Plus, X, Activity, RefreshCw,
  ClipboardList, ImageIcon, Filter, AlertTriangle, CheckCircle2,
  Clock, ChevronRight, FlaskConical, Zap, RotateCcw, Ban, Eye,
  AlertCircle, Database, Edit2, Trash2, ExternalLink,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import ReportDetailModal from '../components/radiology/ReportDetailModal';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  pending: number;
  scanned: number;
  reported: number;
  cancelled: number;
  stat_pending: number;
}

interface ImagingType { id: number; name: string; code?: string; description?: string; }
interface ImagingItem { id: number; imaging_type_id: number; name: string; procedure_code?: string; price_paisa: number; }

interface Requisition {
  id: number;
  patient_id: number;
  patient_name?: string;
  imaging_type_name?: string;
  imaging_item_name?: string;
  urgency: 'normal' | 'urgent' | 'stat';
  order_status: 'pending' | 'scanned' | 'reported' | 'cancelled';
  imaging_date: string;
  is_scanned: number;
  is_report_saved: number;
  prescriber_name?: string;
  created_at: string;
}

interface Report {
  id: number;
  requisition_id: number;
  patient_id: number;
  patient_name?: string;
  imaging_type_name?: string;
  imaging_item_name?: string;
  radiology_number?: string;
  order_status: 'pending' | 'final';
  performer_name?: string;
  created_at: string;
}

interface DicomStudy {
  id: number;
  patient_id?: number;
  patient_name?: string;
  study_instance_uid: string;
  modality?: string;
  study_date?: string;
  study_description?: string;
  series_count?: number;
  image_count?: number;
  is_mapped: number;
  created_at: string;
}

interface Patient { id: number; name: string; }

interface RequisitionsResponse {
  requisitions: Requisition[];
  meta?: { total: number };
}

interface ReportsResponse {
  reports: Report[];
  meta?: { total: number };
}

interface CatalogTypesResponse {
  imaging_types: ImagingType[];
}

interface CatalogItemsResponse {
  imaging_items: ImagingItem[];
}

interface PacsResponse {
  studies: DicomStudy[];
  meta?: { total: number };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {[...Array(rows)].map((_, i) => (
        <tr key={i} className="animate-pulse">
          {[...Array(cols)].map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-[var(--color-bg-secondary)] rounded w-3/4" style={{ width: `${50 + Math.random() * 40}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function KPISkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="rounded-xl border border-[var(--color-border)] p-4 animate-pulse">
          <div className="h-3 bg-[var(--color-bg-secondary)] rounded w-16 mb-3" />
          <div className="h-7 bg-[var(--color-bg-secondary)] rounded w-10" />
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Badge({ text, variant }: { text: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'stat' }) {
  const map = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger:  'bg-red-50 text-red-700 border-red-200',
    info:    'bg-blue-50 text-blue-700 border-blue-200',
    muted:   'bg-zinc-50 text-zinc-500 border-zinc-200',
    stat:    'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[variant]}`}>
      {text}
    </span>
  );
}

function urgencyVariant(u: string): 'success' | 'warning' | 'stat' {
  if (u === 'stat')   return 'stat';
  if (u === 'urgent') return 'warning';
  return 'success';
}

function statusVariant(s: string): 'info' | 'warning' | 'success' | 'muted' {
  if (s === 'reported') return 'success';
  if (s === 'scanned')  return 'info';
  if (s === 'pending')  return 'warning';
  return 'muted';
}

function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel?: string }) {
  const { t } = useTranslation('radiology');
  return (
    <tr>
      <td colSpan={99} className="px-4 py-10 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600 mb-3">{message}</p>
        <button onClick={onRetry} className="px-4 py-2 text-xs rounded-lg bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition-colors">
          {retryLabel || t('retry')}
        </button>
      </td>
    </tr>
  );
}

// ─── URL Builders ────────────────────────────────────────────────────────────

function buildRequisitionsUrl(filters: Record<string, string>) {
  const params = new URLSearchParams();
  params.set('page', filters.page ?? '1');
  params.set('limit', '20');
  if (filters.status)  params.set('status', filters.status);
  if (filters.from_date) params.set('from_date', filters.from_date);
  if (filters.to_date) params.set('to_date', filters.to_date);
  if (filters.search)  params.set('search', filters.search);
  return `/api/radiology/requisitions?${params}`;
}

function buildReportsUrl(page: number) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '20');
  return `/api/radiology/reports?${params}`;
}

function buildPacsUrl(modality: string) {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (modality) params.set('modality', modality);
  return `/api/radiology/pacs?${params}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RadiologyDashboard() {
  const { t } = useTranslation('radiology');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'orders' | 'reports' | 'catalog' | 'pacs'>('orders');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery,  setSearchQuery]  = useState('');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');
  const [modalityFilter, setModalityFilter] = useState('');
  const [reqPage,  setReqPage]  = useState(1);
  // F-07: Reports pagination state
  const [repPage, setRepPage]           = useState(1);
  // F-11: Debounce ref for search
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // F-12: Server-side search query (debounced)
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Patient search (modal-only, uses api.get directly)
  const [patients, setPatients]         = useState<Patient[]>([]);

  // Modals
  const [showNewOrder,   setShowNewOrder]   = useState(false);
  const [showNewReport,  setShowNewReport]  = useState<number | null>(null);
  const [showCancel,     setShowCancel]     = useState<number | null>(null);
  const [cancelRemarks,  setCancelRemarks]  = useState('');
  const [viewReportId,   setViewReportId]   = useState<number | null>(null);

  // Scan modal state
  const [showScanModal,  setShowScanModal]  = useState<number | null>(null);
  const [scanFilmTypeId, setScanFilmTypeId] = useState('');
  const [scanFilmQty,    setScanFilmQty]    = useState('1');
  const [scanRemarks,    setScanRemarks]    = useState('');

  // DICOM viewer state
  const [viewStudyId,    setViewStudyId]    = useState<number | null>(null);
  const [studyViewerUrl, setStudyViewerUrl] = useState<string | null>(null);

  // Forms
  const [newOrder, setNewOrder] = useState({
    patient_id: '', imaging_type_id: '', imaging_item_id: '',
    urgency: 'normal', imaging_date: new Date().toISOString().split('T')[0],
    prescriber_name: '', requisition_remarks: '',
  });
  const [newReport, setNewReport] = useState({
    report_text: '', indication: '', performer_name: '', order_status: 'final',
  });

  const [helpOpen, setHelpOpen] = useState(false);

  // Catalog CRUD state
  const [editType, setEditType] = useState<{ mode: 'add' | 'edit'; id?: number; name: string; code: string; description: string } | null>(null);
  const [editItem, setEditItem] = useState<{ mode: 'add' | 'edit'; id?: number; name: string; imaging_type_id: string; procedure_code: string; price_bdt: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ kind: 'type' | 'item'; id: number; name: string } | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  // Stats
  const { data: stats } = useApiQuery<Stats>(
    queryKeys.radiology.stats(),
    '/api/radiology/stats',
    { placeholderData: { pending: 0, scanned: 0, reported: 0, cancelled: 0, stat_pending: 0 } },
  );

  // Requisitions — dynamic filters go into both the query key and the URL
  const reqFilters = useMemo(() => ({
    page: String(reqPage),
    status: statusFilter,
    from_date: fromDate,
    to_date: toDate,
    search: debouncedSearch,
  }), [reqPage, statusFilter, fromDate, toDate, debouncedSearch]);

  const {
    data: reqsData,
    isLoading: loadingOrders,
    isError: errOrders,
    refetch: refetchRequisitions,
  } = useApiQuery<RequisitionsResponse>(
    queryKeys.radiology.requisitions(reqFilters),
    buildRequisitionsUrl(reqFilters),
    { enabled: tab === 'orders' },
  );

  const requisitions = reqsData?.requisitions ?? [];
  const reqTotal = reqsData?.meta?.total ?? 0;

  // Reports
  const repFilters = useMemo(() => ({ page: String(repPage) }), [repPage]);

  const {
    data: repsData,
    isLoading: loadingReports,
    isError: errReports,
    refetch: refetchReports,
  } = useApiQuery<ReportsResponse>(
    queryKeys.radiology.reports(repFilters),
    buildReportsUrl(repPage),
    { enabled: tab === 'reports' },
  );

  const reports = repsData?.reports ?? [];
  const repTotal = repsData?.meta?.total ?? 0;

  // Catalog — types and items
  const { data: typesData } = useApiQuery<CatalogTypesResponse>(
    queryKeys.radiology.types(),
    '/api/radiology/imaging-types',
  );
  const imagingTypes = typesData?.imaging_types ?? [];

  const { data: itemsData } = useApiQuery<CatalogItemsResponse>(
    queryKeys.radiology.items(),
    '/api/radiology/imaging-items',
  );
  const imagingItems = itemsData?.imaging_items ?? [];

  // PACS — include modalityFilter in the query key so React Query refetches on change
  const pacsFilterKey = useMemo(() => ({ modality: modalityFilter }), [modalityFilter]);

  const {
    data: pacsData,
    isLoading: loadingPacs,
    isError: errPacs,
    refetch: refetchPacs,
  } = useApiQuery<PacsResponse>(
    [...queryKeys.radiology.dicom(), pacsFilterKey],
    buildPacsUrl(modalityFilter),
    { enabled: tab === 'pacs' },
  );

  const pacsStudies = pacsData?.studies ?? [];
  const pacsTotal = pacsData?.meta?.total ?? 0;

  // Film types (for scan modal)
  const { data: filmTypesData } = useApiQuery<{ film_types: Array<{ id: number; film_type: string; display_name?: string; type_name?: string }> }>(
    [...queryKeys.radiology.all, 'film-types'],
    '/api/radiology/film-types',
  );
  const filmTypes = filmTypesData?.film_types ?? [];

  // Report templates (for report editor)
  const { data: templatesData } = useApiQuery<{ templates: Array<{ id: number; name: string; code?: string }> }>(
    [...queryKeys.radiology.all, 'templates'],
    '/api/radiology/templates',
  );
  const templates = templatesData?.templates ?? [];

  // Selected template detail
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateHtml, setTemplateHtml] = useState('');

  // Doctors list (for performer dropdown)
  const { data: doctorsData } = useApiQuery<{ doctors?: Array<{ id: number; name: string }> }>(
    queryKeys.doctors.list(),
    '/api/doctors',
  );
  const doctors = doctorsData?.doctors ?? [];

  // Filtered items for the new-order form (derived, no network call)
  const [filteredItems, setFilteredItems] = useState<ImagingItem[]>([]);
  useEffect(() => {
    setFilteredItems(
      newOrder.imaging_type_id
        ? imagingItems.filter(i => String(i.imaging_type_id) === newOrder.imaging_type_id)
        : imagingItems,
    );
  }, [newOrder.imaging_type_id, imagingItems]);

  // ── Patient search (debounced, inside modal — use api.get directly) ───

  const loadPatients = useCallback(async (q: string) => {
    if (q.length < 2) return;
    try {
      const data = await api.get<{ patients?: Patient[]; data?: Patient[] }>(
        `/api/patients?search=${encodeURIComponent(q)}&limit=10`,
      );
      setPatients(data.patients ?? data.data ?? []);
    } catch { /* silent */ }
  }, []);

  // Load template HTML when template selected
  const loadTemplate = useCallback(async (templateId: string) => {
    if (!templateId) { setTemplateHtml(''); return; }
    try {
      const data = await api.get<{ template?: { template_html?: string } }>(`/api/radiology/templates/${templateId}`);
      const html = data.template?.template_html ?? '';
      setTemplateHtml(html);
      setNewReport(r => ({ ...r, report_text: html }));
    } catch { /* silent */ }
  }, []);

  // F-11 FIX: Debounce search input — sends to server after 300ms idle
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setReqPage(1);
    }, 300);
  }, []);

  // F-12: Client-side filtering removed — search is now server-side via debouncedSearch
  const filteredReqs = requisitions;

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidateOrdersAndStats = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.radiology.requisitions() });
    queryClient.invalidateQueries({ queryKey: queryKeys.radiology.stats() });
  };

  // Create order
  const createOrderMutation = useApiMutation<unknown, {
    patient_id: number; imaging_type_id: number; imaging_item_id: number;
    urgency: string; imaging_date: string;
    prescriber_name?: string; requisition_remarks?: string;
  }>(
    'post',
    '/api/radiology/requisitions',
    {
      onSuccess: () => {
        toast.success(t('messages.orderCreated'));
        setShowNewOrder(false);
        setNewOrder({ patient_id: '', imaging_type_id: '', imaging_item_id: '', urgency: 'normal', imaging_date: new Date().toISOString().split('T')[0], prescriber_name: '', requisition_remarks: '' });
        invalidateOrdersAndStats();
      },
      onError: (err) => {
        toast.error(err.message ?? t('messages.orderFailed'));
      },
    },
  );

  const handleCreateOrder = () => {
    if (createOrderMutation.isPending) return;
    if (!newOrder.patient_id || !newOrder.imaging_type_id || !newOrder.imaging_item_id) {
      toast.error(t('messages.missingFields')); return;
    }
    createOrderMutation.mutate({
      patient_id:     Number(newOrder.patient_id),
      imaging_type_id: Number(newOrder.imaging_type_id),
      imaging_item_id: Number(newOrder.imaging_item_id),
      urgency:          newOrder.urgency,
      imaging_date:     newOrder.imaging_date,
      prescriber_name:  newOrder.prescriber_name  || undefined,
      requisition_remarks: newOrder.requisition_remarks || undefined,
    });
  };

  // Scan
  const scanMutation = useApiMutation<unknown, { id: number; scan_remarks?: string; film_type_id?: number; film_quantity?: number }>(
    'patch',
    (vars) => `/api/radiology/requisitions/${vars.id}/scan`,
    {
      onSuccess: () => {
        toast.success(t('messages.markedScanned'));
        setShowScanModal(null);
        setScanFilmTypeId('');
        setScanFilmQty('1');
        setScanRemarks('');
        invalidateOrdersAndStats();
      },
      onError: () => { toast.error(t('messages.scannedFailed')); },
    },
  );

  const handleScan = (id: number) => {
    if (scanMutation.isPending) return;
    scanMutation.mutate({ id });
  };

  const handleScanWithDetails = () => {
    if (!showScanModal || scanMutation.isPending) return;
    scanMutation.mutate({
      id: showScanModal,
      scan_remarks: scanRemarks || undefined,
      film_type_id: scanFilmTypeId ? Number(scanFilmTypeId) : undefined,
      film_quantity: scanFilmQty ? Number(scanFilmQty) : undefined,
    });
  };

  // Un-scan
  const unscanMutation = useApiMutation<unknown, { id: number }>(
    'patch',
    (vars) => `/api/radiology/requisitions/${vars.id}/unscan`,
    {
      onSuccess: () => {
        toast.success(t('messages.unscanned'));
        invalidateOrdersAndStats();
      },
      onError: (err) => {
        toast.error(err.message ?? t('messages.unscanFailed'));
      },
    },
  );

  const handleUnscan = (id: number) => {
    if (unscanMutation.isPending) return;
    unscanMutation.mutate({ id });
  };

  // Cancel order
  const cancelMutation = useApiMutation<unknown, { id: number; cancel_remarks?: string }>(
    'patch',
    (vars) => `/api/radiology/requisitions/${vars.id}/cancel`,
    {
      onSuccess: () => {
        toast.success(t('messages.orderCancelled'));
        setShowCancel(null);
        setCancelRemarks('');
        invalidateOrdersAndStats();
      },
      onError: () => { toast.error(t('messages.cancelFailed')); },
    },
  );

  const handleConfirmCancel = () => {
    if (!showCancel || cancelMutation.isPending) return;
    cancelMutation.mutate({ id: showCancel, cancel_remarks: cancelRemarks || undefined });
  };

  // Create report
  const createReportMutation = useApiMutation<unknown, {
    requisition_id: number; patient_id: number;
    imaging_type_name?: string; imaging_item_name?: string;
    report_text: string; indication?: string; performer_name?: string; order_status: string;
  }>(
    'post',
    '/api/radiology/reports',
    {
      onSuccess: () => {
        toast.success(t('messages.reportCreated'));
        setShowNewReport(null);
        setNewReport({ report_text: '', indication: '', performer_name: '', order_status: 'final' });
        invalidateOrdersAndStats();
      },
      onError: (err) => {
        toast.error(err.message ?? t('messages.reportFailed'));
      },
    },
  );

  const handleCreateReport = (requisitionId: number, patientId: number) => {
    if (!newReport.report_text || createReportMutation.isPending) { toast.error(t('messages.missingReportText')); return; }
    const req = requisitions.find(r => r.id === requisitionId);
    createReportMutation.mutate({
      requisition_id:   requisitionId,
      patient_id:       patientId,
      imaging_type_name: req?.imaging_type_name,
      imaging_item_name: req?.imaging_item_name,
      report_text:      newReport.report_text,
      indication:       newReport.indication    || undefined,
      performer_name:   newReport.performer_name || undefined,
      order_status:     newReport.order_status,
    });
  };

  // Finalize report
  const finalizeReportMutation = useApiMutation<unknown, { id: number }>(
    'patch',
    (vars) => `/api/radiology/reports/${vars.id}/finalize`,
    {
      onSuccess: () => {
        toast.success(t('messages.reportFinalized'));
        queryClient.invalidateQueries({ queryKey: queryKeys.radiology.reports() });
      },
      onError: () => { toast.error(t('messages.finalizeFailed')); },
    },
  );

  const handleFinalizeReport = (id: number) => {
    if (finalizeReportMutation.isPending) return;
    finalizeReportMutation.mutate({ id });
  };

  // ── Catalog CRUD Mutations ────────────────────────────────────────────────

  const invalidateCatalog = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.radiology.types() });
    queryClient.invalidateQueries({ queryKey: queryKeys.radiology.items() });
  };

  // Save type — separate mutations for POST (add) and PUT (edit)
  const saveTypeMutation = useApiMutation<unknown, { name: string; code?: string; description?: string }>(
    'post',
    '/api/radiology/imaging-types',
    {
      onSuccess: () => {
        toast.success(t('catalog.typeCreated'));
        setEditType(null);
        invalidateCatalog();
      },
      onError: () => { toast.error(t('catalog.saveFailed')); },
    },
  );

  const updateTypeMutation = useApiMutation<unknown, { id: number; name: string; code?: string; description?: string }>(
    'put',
    (vars) => `/api/radiology/imaging-types/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('catalog.typeUpdated'));
        setEditType(null);
        invalidateCatalog();
      },
      onError: () => { toast.error(t('catalog.saveFailed')); },
    },
  );

  const handleSaveType = () => {
    if (!editType || saveTypeMutation.isPending || updateTypeMutation.isPending) return;
    if (!editType.name.trim()) { toast.error(t('messages.missingFields')); return; }
    const payload = { name: editType.name, code: editType.code || undefined, description: editType.description || undefined };
    if (editType.mode === 'add') {
      saveTypeMutation.mutate(payload);
    } else {
      updateTypeMutation.mutate({ id: editType.id!, ...payload });
    }
  };

  // Save item (add or edit)
  const saveItemMutation = useApiMutation<unknown, { name: string; imaging_type_id: number; procedure_code?: string; price_paisa: number }>(
    'post',
    '/api/radiology/imaging-items',
    {
      onSuccess: () => {
        toast.success(t('catalog.itemCreated'));
        setEditItem(null);
        invalidateCatalog();
      },
      onError: () => { toast.error(t('catalog.saveFailed')); },
    },
  );

  const updateItemMutation = useApiMutation<unknown, { id: number; name: string; procedure_code?: string; price_paisa: number }>(
    'put',
    (vars) => `/api/radiology/imaging-items/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('catalog.itemUpdated'));
        setEditItem(null);
        invalidateCatalog();
      },
      onError: () => { toast.error(t('catalog.saveFailed')); },
    },
  );

  const handleSaveItem = () => {
    if (!editItem || saveItemMutation.isPending || updateItemMutation.isPending) return;
    if (!editItem.name.trim() || !editItem.imaging_type_id) { toast.error(t('messages.missingFields')); return; }
    const pricePaisa = Math.round(parseFloat(editItem.price_bdt || '0') * 100);
    if (editItem.mode === 'add') {
      saveItemMutation.mutate({
        name: editItem.name, imaging_type_id: Number(editItem.imaging_type_id),
        procedure_code: editItem.procedure_code || undefined, price_paisa: pricePaisa,
      });
    } else {
      updateItemMutation.mutate({
        id: editItem.id!, name: editItem.name,
        procedure_code: editItem.procedure_code || undefined, price_paisa: pricePaisa,
      });
    }
  };

  // Delete catalog entry
  const deleteTypeMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/radiology/imaging-types/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('catalog.typeDeleted'));
        setDeleteConfirm(null);
        invalidateCatalog();
      },
      onError: () => { toast.error(t('catalog.deleteFailed')); },
    },
  );

  const deleteItemMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/radiology/imaging-items/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('catalog.itemDeleted'));
        setDeleteConfirm(null);
        invalidateCatalog();
      },
      onError: () => { toast.error(t('catalog.deleteFailed')); },
    },
  );

  const handleDeleteCatalog = () => {
    if (!deleteConfirm || deleteTypeMutation.isPending || deleteItemMutation.isPending) return;
    if (deleteConfirm.kind === 'type') {
      deleteTypeMutation.mutate({ id: deleteConfirm.id });
    } else {
      deleteItemMutation.mutate({ id: deleteConfirm.id });
    }
  };

  // ── Derived submitting state (for button disable — preserves JSX behavior) ─

  const submitting = (() => {
    if (createOrderMutation.isPending) return 'createOrder';
    if (scanMutation.isPending) return 'scan';
    if (unscanMutation.isPending && unscanMutation.variables) return `unscan-${unscanMutation.variables.id}`;
    if (cancelMutation.isPending) return 'cancel';
    if (createReportMutation.isPending) return 'createReport';
    if (finalizeReportMutation.isPending && finalizeReportMutation.variables) return `finalize-${finalizeReportMutation.variables.id}`;
    if (saveTypeMutation.isPending || updateTypeMutation.isPending) return 'saveType';
    if (saveItemMutation.isPending || updateItemMutation.isPending) return 'saveItem';
    if (deleteTypeMutation.isPending || deleteItemMutation.isPending) return 'deleteCatalog';
    return null;
  })();

  const tabs = [
    { id: 'orders',  label: t('tabs.orders'),  icon: ClipboardList },
    { id: 'reports', label: t('tabs.reports'), icon: FileText },
    { id: 'catalog', label: t('tabs.catalog'), icon: FlaskConical },
    { id: 'pacs',    label: t('tabs.pacs'),    icon: ImageIcon },
  ] as const;

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500';

  // Refresh handler for header button
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.radiology.stats() });
    if (tab === 'orders')  queryClient.invalidateQueries({ queryKey: queryKeys.radiology.requisitions() });
    else if (tab === 'reports') queryClient.invalidateQueries({ queryKey: queryKeys.radiology.reports() });
    else if (tab === 'pacs')    queryClient.invalidateQueries({ queryKey: queryKeys.radiology.dicom() });
  };

  // M-3: Escape key handler for modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editType) setEditType(null);
      else if (editItem) setEditItem(null);
      else if (deleteConfirm) setDeleteConfirm(null);
      else if (showNewOrder) setShowNewOrder(false);
      else if (showNewReport !== null) setShowNewReport(null);
      else if (showScanModal !== null) setShowScanModal(null);
      else if (showCancel !== null) setShowCancel(null);
      else if (viewReportId !== null) setViewReportId(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showNewOrder, showNewReport, showScanModal, showCancel, viewReportId, editType, editItem, deleteConfirm]);

  return (
    <DashboardLayout role="hospital_admin">
      <HelpPanel pageKey="radiology_catalog" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-100">
              <Scan className="w-6 h-6 text-sky-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('title')}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
            <button
              onClick={handleRefresh}
              className="p-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              title={t('refresh')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {tab === 'orders' && (
              <button
                onClick={() => setShowNewOrder(true)}
                id="btn-new-radiology-order"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('newOrder')}
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        {!stats ? <KPISkeleton /> : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <KPICard title={t('kpi.pending')}    value={stats.pending}     icon={<Clock        className="w-5 h-5 text-amber-500" />} />
            <KPICard title={t('kpi.scanned')}    value={stats.scanned}     icon={<Scan         className="w-5 h-5 text-blue-500" />} />
            <KPICard title={t('kpi.reported')}   value={stats.reported}    icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />} />
            <KPICard title={t('kpi.statOrders')} value={stats.stat_pending} icon={<Zap         className="w-5 h-5 text-fuchsia-500" />} />
            <KPICard title={t('kpi.cancelled')}  value={stats.cancelled}   icon={<X            className="w-5 h-5 text-red-500" />} />
          </div>
        )}

        {/* STAT alert */}
        {stats && stats.stat_pending > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-800 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t('statAlert', { count: stats.stat_pending })}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--color-border)]">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {/* ── ORDERS TAB ── */}
        {tab === 'orders' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  type="text" placeholder={t('orders.searchPlaceholder')}
                  value={searchQuery} onChange={e => handleSearchChange(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <select
                value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setReqPage(1); }}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">{t('orders.allStatuses')}</option>
                <option value="pending">{t('orders.statusPending')}</option>
                <option value="scanned">{t('orders.statusScanned')}</option>
                <option value="reported">{t('orders.statusReported')}</option>
                <option value="cancelled">{t('orders.statusCancelled')}</option>
              </select>
              <input
                type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setReqPage(1); }}
                title={t('orders.fromDate')}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <input
                type="date" value={toDate} onChange={e => { setToDate(e.target.value); setReqPage(1); }}
                title={t('orders.toDate')}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                  <tr>
                    {[t('orders.table.hash'), t('orders.table.patient'), t('orders.table.imagingTest'), t('orders.table.date'), t('orders.table.urgency'), t('orders.table.status'), t('orders.table.actions')].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loadingOrders ? (
                    <TableSkeleton cols={7} />
                  ) : errOrders ? (
                    <ErrorState message={t('orders.errorLoading')} onRetry={() => refetchRequisitions()} retryLabel={t('retry')} />
                  ) : filteredReqs.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--color-text-muted)]">{t('orders.noOrders')}</td></tr>
                  ) : filteredReqs.map(req => (
                    <tr key={req.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">#{req.id}</td>
                      <td className="px-4 py-3 font-medium text-[var(--color-text)]">{req.patient_name ?? t('orders.patientWithId', { id: req.patient_id })}</td>
                      <td className="px-4 py-3 text-[var(--color-text)]">
                        <div>{req.imaging_item_name ?? '—'}</div>
                        {req.imaging_type_name && <div className="text-xs text-[var(--color-text-muted)]">{req.imaging_type_name}</div>}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{req.imaging_date}</td>
                      <td className="px-4 py-3">
                        <Badge
                          text={t(`modals.newOrder.urgency${req.urgency.charAt(0).toUpperCase()}${req.urgency.slice(1)}`)}
                          variant={urgencyVariant(req.urgency)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          text={t(`orders.status${req.order_status.charAt(0).toUpperCase()}${req.order_status.slice(1)}`)}
                          variant={statusVariant(req.order_status)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {/* Scan */}
                          {req.order_status === 'pending' && !req.is_scanned && (
                            <button onClick={() => { setShowScanModal(req.id); setScanFilmTypeId(''); setScanFilmQty('1'); setScanRemarks(''); }}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors">
                              <Scan className="w-3 h-3" />{t('orders.scan')}
                            </button>
                          )}
                          {/* Un-scan */}
                          {req.order_status === 'scanned' && !req.is_report_saved && (
                            <button onClick={() => handleUnscan(req.id)} disabled={submitting === `unscan-${req.id}`}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors">
                              <RotateCcw className="w-3 h-3" />{submitting === `unscan-${req.id}` ? t('orders.unscanning') : t('orders.unscan')}
                            </button>
                          )}
                          {/* Report */}
                          {(req.order_status === 'scanned' || req.order_status === 'pending') && !req.is_report_saved && (
                            <button onClick={() => setShowNewReport(req.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                              <FileText className="w-3 h-3" />{t('orders.report')}
                            </button>
                          )}
                          {/* Reported badge */}
                          {req.is_report_saved === 1 && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600">
                              <CheckCircle2 className="w-3 h-3" />{t('orders.reportedLabel')}
                            </span>
                          )}
                          {/* Cancel */}
                          {req.order_status !== 'reported' && req.order_status !== 'cancelled' && (
                            <button onClick={() => { setShowCancel(req.id); setCancelRemarks(''); }}
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors">
                              <Ban className="w-3 h-3" />{t('orders.cancel')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reqTotal > 20 && (
                <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm text-[var(--color-text-muted)]">
                  <span>{t('orders.showingPage', { page: reqPage, total: reqTotal })}</span>
                  <div className="flex gap-2">
                    <button disabled={reqPage === 1} onClick={() => setReqPage(p => p - 1)} className="px-3 py-1 rounded border border-[var(--color-border)] disabled:opacity-40">{t('orders.prev')}</button>
                    <button disabled={reqPage * 20 >= reqTotal} onClick={() => setReqPage(p => p + 1)} className="px-3 py-1 rounded border border-[var(--color-border)] disabled:opacity-40">{t('orders.next')}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── REPORTS TAB ── */}
        {tab === 'reports' && (
          <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                <tr>
                  {[t('reports.table.radNum'), t('reports.table.patient'), t('reports.table.test'), t('reports.table.radiologist'), t('reports.table.status'), t('reports.table.date'), t('reports.table.actions')].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {loadingReports ? (
                  <TableSkeleton cols={7} />
                ) : errReports ? (
                  <ErrorState message={t('reports.errorLoading')} onRetry={() => refetchReports()} retryLabel={t('retry')} />
                ) : reports.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--color-text-muted)]">{t('reports.noReports')}</td></tr>
                ) : reports.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer" onClick={() => setViewReportId(r.id)}>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-sky-600">{r.radiology_number ?? `#${r.id}`}</td>
                    <td className="px-4 py-3 font-medium">{r.patient_name ?? t('orders.patientWithId', { id: r.patient_id })}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{r.imaging_item_name ?? r.imaging_type_name ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{r.performer_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge
                        text={r.order_status === 'final' ? t('modals.newReport.statusFinal') : t('modals.newReport.statusPreliminary')}
                        variant={r.order_status === 'final' ? 'success' : 'warning'}
                      />
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{r.created_at?.split('T')[0]}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1.5">
                        <button onClick={() => setViewReportId(r.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors">
                          <Eye className="w-3 h-3" />{t('reports.view')}
                        </button>
                        {r.order_status === 'pending' && (
                          <button onClick={() => handleFinalizeReport(r.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
                            <CheckCircle2 className="w-3 h-3" />{t('reports.finalize')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* F-07 FIX: Reports pagination controls */}
            {repTotal > 20 && (
              <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm text-[var(--color-text-muted)]">
                <span>{t('orders.showingPage', { page: repPage, total: repTotal })}</span>
                <div className="flex gap-2">
                  <button disabled={repPage === 1} onClick={() => setRepPage(p => p - 1)} className="px-3 py-1 rounded border border-[var(--color-border)] disabled:opacity-40">{t('orders.prev')}</button>
                  <button disabled={repPage * 20 >= repTotal} onClick={() => setRepPage(p => p + 1)} className="px-3 py-1 rounded border border-[var(--color-border)] disabled:opacity-40">{t('orders.next')}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CATALOG TAB ── */}
        {tab === 'catalog' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Imaging Types panel */}
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-[var(--color-text)]">{t('catalog.imagingTypes')}</h3>
                  <span className="text-xs text-[var(--color-text-muted)]">{t('catalog.typesCount', { count: imagingTypes.length })}</span>
                </div>
                <button onClick={() => setEditType({ mode: 'add', name: '', code: '', description: '' })}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-colors">
                  <Plus className="w-3 h-3" /> {t('catalog.addType')}
                </button>
              </div>
              <div className="divide-y divide-[var(--color-border)] max-h-80 overflow-y-auto">
                {imagingTypes.map(type => (
                  <div key={type.id} className="px-4 py-3 flex items-center justify-between hover:bg-[var(--color-bg-secondary)] group">
                    <div className="flex items-center gap-2">
                      {type.code && <span className="font-mono text-xs bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">{type.code}</span>}
                      <span className="text-sm text-[var(--color-text)]">{type.name}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditType({ mode: 'edit', id: type.id, name: type.name, code: type.code ?? '', description: type.description ?? '' })}
                        className="p-1 rounded hover:bg-sky-50 text-[var(--color-text-muted)] hover:text-sky-600 transition-colors" title={t('catalog.editType')}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteConfirm({ kind: 'type', id: type.id, name: type.name })}
                        className="p-1 rounded hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-600 transition-colors" title={t('catalog.deleteType')}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {imagingTypes.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">{t('catalog.noTypes')}</div>
                )}
              </div>
            </div>

            {/* Imaging Items panel */}
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-[var(--color-text)]">{t('catalog.imagingTests')}</h3>
                  <span className="text-xs text-[var(--color-text-muted)]">{t('catalog.testsCount', { count: imagingItems.length })}</span>
                </div>
                <button onClick={() => setEditItem({ mode: 'add', name: '', imaging_type_id: '', procedure_code: '', price_bdt: '' })}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-colors">
                  <Plus className="w-3 h-3" /> {t('catalog.addItem')}
                </button>
              </div>
              <div className="divide-y divide-[var(--color-border)] max-h-96 overflow-y-auto">
                {imagingItems.map(item => {
                  const typeName = imagingTypes.find(ty => ty.id === item.imaging_type_id)?.name;
                  return (
                    <div key={item.id} className="px-4 py-3 hover:bg-[var(--color-bg-secondary)] group">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[var(--color-text)]">{item.name}</span>
                        <div className="flex items-center gap-2">
                          {item.price_paisa > 0 && (
                            <span className="text-xs text-[var(--color-text-muted)]">৳{(item.price_paisa / 100).toFixed(0)}</span>
                          )}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setEditItem({ mode: 'edit', id: item.id, name: item.name, imaging_type_id: String(item.imaging_type_id), procedure_code: item.procedure_code ?? '', price_bdt: String(item.price_paisa / 100) })}
                              className="p-1 rounded hover:bg-sky-50 text-[var(--color-text-muted)] hover:text-sky-600 transition-colors" title={t('catalog.editItem')}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setDeleteConfirm({ kind: 'item', id: item.id, name: item.name })}
                              className="p-1 rounded hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-600 transition-colors" title={t('catalog.deleteItem')}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {typeName && <span className="text-xs text-[var(--color-text-muted)]">{typeName}</span>}
                        {item.procedure_code && <span className="font-mono text-xs text-sky-500">{item.procedure_code}</span>}
                      </div>
                    </div>
                  );
                })}
                {imagingItems.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">{t('catalog.noTests')}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── PACS TAB ── */}
        {tab === 'pacs' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <select
                value={modalityFilter}
                onChange={e => { setModalityFilter(e.target.value); }}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">{t('pacs.allModalities')}</option>
                {['CR', 'CT', 'MR', 'US', 'DX', 'MG', 'PT', 'NM', 'RF', 'XA'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="ml-auto text-sm text-[var(--color-text-muted)] self-center">
                {pacsTotal === 1 ? t('pacs.studyCount', { count: pacsTotal }) : t('pacs.studyCountPlural', { count: pacsTotal })}
              </span>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                  <tr>
                    {[t('pacs.table.studyUid'), t('pacs.table.patient'), t('pacs.table.modality'), t('pacs.table.date'), t('pacs.table.series'), t('pacs.table.images'), t('pacs.table.mapped')].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loadingPacs ? (
                    <TableSkeleton cols={7} />
                  ) : errPacs ? (
                    <ErrorState message={t('pacs.errorLoading')} onRetry={() => refetchPacs()} retryLabel={t('retry')} />
                  ) : pacsStudies.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center">
                        <Database className="w-10 h-10 text-[var(--color-text-muted)] opacity-30 mx-auto mb-3" />
                        <p className="text-sm text-[var(--color-text-muted)]">{t('pacs.noStudies')}</p>
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('pacs.description')}</p>
                      </td>
                    </tr>
                  ) : pacsStudies.map(s => (
                    <tr key={s.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-sky-600 max-w-32 truncate" title={s.study_instance_uid}>{s.study_instance_uid}</td>
                      <td className="px-4 py-3 font-medium">{s.patient_name ?? `#${s.patient_id ?? '—'}`}</td>
                      <td className="px-4 py-3"><Badge text={s.modality ?? '?'} variant="info" /></td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{s.study_date ?? '—'}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{s.series_count ?? '—'}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{s.image_count ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {s.is_mapped ? (
                            <Badge text={t('pacs.mapped')} variant="success" />
                          ) : (
                            <Badge text={t('pacs.unlinked')} variant="muted" />
                          )}
                          <button
                            onClick={async () => {
                              try {
                                const data = await api.get<{ study?: { viewer_url?: string }; note?: string }>(`/api/radiology/pacs/${s.id}`);
                                if (data.study?.viewer_url) {
                                  window.open(data.study.viewer_url, '_blank');
                                } else {
                                  toast.error(data.note || t('pacs.viewerNotConfigured'));
                                }
                              } catch {
                                toast.error(t('pacs.viewerLoadFailed'));
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-sky-50 text-sky-700 hover:bg-sky-100 transition-colors">
                            <ExternalLink className="w-3 h-3" />{t('pacs.view')}
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

        {/* ── MODAL: New Order ── */}
        {showNewOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-new-order-title" onClick={e => { if (e.target === e.currentTarget) setShowNewOrder(false); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-lg">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <h2 id="modal-new-order-title" className="text-lg font-semibold text-[var(--color-text)]">{t('modals.newOrder.title')}</h2>
                <button onClick={() => setShowNewOrder(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Patient */}
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newOrder.patientLabel')}</label>
                  <input type="text" placeholder={t('modals.newOrder.patientSearchPlaceholder')}
                    onChange={e => loadPatients(e.target.value)}
                    className={inputCls} />
                  {patients.length > 0 && (
                    <div className="mt-1 border border-[var(--color-border)] rounded-lg overflow-hidden max-h-32 overflow-y-auto">
                      {patients.map(p => (
                        <button key={p.id}
                          onClick={() => { setNewOrder(o => ({ ...o, patient_id: String(p.id) })); setPatients([]); }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)] ${newOrder.patient_id === String(p.id) ? 'bg-sky-50 text-sky-700 font-medium' : 'text-[var(--color-text)]'}`}>
                          {p.name} <span className="text-xs text-[var(--color-text-muted)]">(#{p.id})</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {newOrder.patient_id && <p className="mt-1 text-xs text-emerald-600">{t('modals.newOrder.patientSelected', { id: newOrder.patient_id })}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newOrder.typeLabel')}</label>
                    <select value={newOrder.imaging_type_id}
                      onChange={e => setNewOrder(o => ({ ...o, imaging_type_id: e.target.value, imaging_item_id: '' }))}
                      className={inputCls}>
                      <option value="">{t('modals.newOrder.typePlaceholder')}</option>
                      {imagingTypes.map(ty => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newOrder.testLabel')}</label>
                    <select value={newOrder.imaging_item_id}
                      onChange={e => setNewOrder(o => ({ ...o, imaging_item_id: e.target.value }))}
                      className={inputCls} disabled={!newOrder.imaging_type_id}>
                      <option value="">{t('modals.newOrder.testPlaceholder')}</option>
                      {filteredItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newOrder.urgencyLabel')}</label>
                    <select value={newOrder.urgency} onChange={e => setNewOrder(o => ({ ...o, urgency: e.target.value }))} className={inputCls}>
                      <option value="normal">{t('modals.newOrder.urgencyNormal')}</option>
                      <option value="urgent">{t('modals.newOrder.urgencyUrgent')}</option>
                      <option value="stat">{t('modals.newOrder.urgencyStat')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newOrder.dateLabel')}</label>
                    <input type="date" value={newOrder.imaging_date}
                      onChange={e => setNewOrder(o => ({ ...o, imaging_date: e.target.value }))}
                      className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newOrder.doctorLabel')}</label>
                  <input type="text" placeholder={t('modals.newOrder.doctorPlaceholder')} value={newOrder.prescriber_name}
                    onChange={e => setNewOrder(o => ({ ...o, prescriber_name: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newOrder.remarksLabel')}</label>
                  <textarea rows={2} placeholder={t('modals.newOrder.remarksPlaceholder')} value={newOrder.requisition_remarks}
                    onChange={e => setNewOrder(o => ({ ...o, requisition_remarks: e.target.value }))}
                    className={`${inputCls} resize-none`} />
                </div>
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setShowNewOrder(false)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('modals.newOrder.cancel')}</button>
                <button onClick={handleCreateOrder} disabled={submitting === 'createOrder'} className="flex-1 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60 transition-colors">{submitting === 'createOrder' ? t('modals.newOrder.submitting') : t('modals.newOrder.submit')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL: Create Report ── */}
        {showNewReport !== null && (() => {
          const req = requisitions.find(r => r.id === showNewReport);
          if (!req) return null;
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-new-report-title" onClick={e => { if (e.target === e.currentTarget) setShowNewReport(null); }}>
              <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-lg">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                  <div>
                    <h2 id="modal-new-report-title" className="text-lg font-semibold text-[var(--color-text)]">{t('modals.newReport.title')}</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">{req.imaging_item_name} — {req.patient_name}</p>
                  </div>
                  <button onClick={() => setShowNewReport(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
                </div>
                <div className="p-6 space-y-4">
                  {/* Template selector */}
                  {templates.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newReport.templateLabel')}</label>
                      <select
                        value={selectedTemplateId}
                        onChange={e => { setSelectedTemplateId(e.target.value); loadTemplate(e.target.value); }}
                        className={inputCls}>
                        <option value="">{t('modals.newReport.templatePlaceholder')}</option>
                        {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newReport.indicationLabel')}</label>
                    <input type="text" placeholder={t('modals.newReport.indicationPlaceholder')} value={newReport.indication}
                      onChange={e => setNewReport(r => ({ ...r, indication: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newReport.reportLabel')}</label>
                    <textarea rows={6} placeholder={t('modals.newReport.reportPlaceholder')} value={newReport.report_text}
                      onChange={e => setNewReport(r => ({ ...r, report_text: e.target.value }))}
                      className={`${inputCls} resize-none font-mono`} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newReport.radiologistLabel')}</label>
                      {doctors.length > 0 ? (
                        <select
                          value={newReport.performer_name}
                          onChange={e => setNewReport(r => ({ ...r, performer_name: e.target.value }))}
                          className={inputCls}>
                          <option value="">{t('modals.newReport.radiologistPlaceholder')}</option>
                          {doctors.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                        </select>
                      ) : (
                        <input type="text" placeholder={t('modals.newReport.radiologistPlaceholder')} value={newReport.performer_name}
                          onChange={e => setNewReport(r => ({ ...r, performer_name: e.target.value }))} className={inputCls} />
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.newReport.statusLabel')}</label>
                      <select value={newReport.order_status} onChange={e => setNewReport(r => ({ ...r, order_status: e.target.value }))} className={inputCls}>
                        <option value="final">{t('modals.newReport.statusFinal')}</option>
                        <option value="pending">{t('modals.newReport.statusPreliminary')}</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 px-6 pb-6">
                  <button onClick={() => setShowNewReport(null)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('modals.newReport.cancel')}</button>
                  <button onClick={() => handleCreateReport(req.id, req.patient_id)} disabled={submitting === 'createReport'} className="flex-1 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60 transition-colors">{submitting === 'createReport' ? t('modals.newReport.submitting') : t('modals.newReport.submit')}</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── MODAL: Scan Order ── */}
        {showScanModal !== null && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-scan-title" onClick={e => { if (e.target === e.currentTarget) setShowScanModal(null); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <Scan className="w-5 h-5 text-blue-500" />
                  <h2 id="modal-scan-title" className="text-lg font-semibold text-[var(--color-text)]">{t('modals.scan.title')}</h2>
                </div>
                <button onClick={() => setShowScanModal(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                {filmTypes.length > 0 && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.scan.filmTypeLabel')}</label>
                      <select value={scanFilmTypeId} onChange={e => setScanFilmTypeId(e.target.value)} className={inputCls}>
                        <option value="">{t('modals.scan.filmTypePlaceholder')}</option>
                        {filmTypes.map(ft => (
                          <option key={ft.id} value={ft.id}>{ft.display_name ?? ft.film_type}{ft.type_name ? ` (${ft.type_name})` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.scan.filmQtyLabel')}</label>
                      <input type="number" min="1" value={scanFilmQty} onChange={e => setScanFilmQty(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.scan.remarksLabel')}</label>
                  <textarea rows={2} placeholder={t('modals.scan.remarksPlaceholder')} value={scanRemarks}
                    onChange={e => setScanRemarks(e.target.value)}
                    className={`${inputCls} resize-none`} />
                </div>
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setShowScanModal(null)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('modals.scan.cancel')}</button>
                <button onClick={handleScanWithDetails} disabled={scanMutation.isPending} className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors">
                  {scanMutation.isPending ? t('modals.scan.submitting') : t('modals.scan.submit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL: Cancel Order ── */}
        {showCancel !== null && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-cancel-order-title" onClick={e => { if (e.target === e.currentTarget) setShowCancel(null); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h2 id="modal-cancel-order-title" className="text-lg font-semibold text-[var(--color-text)]">{t('modals.cancelOrder.title')}</h2>
                </div>
                <button onClick={() => setShowCancel(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6">
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('modals.cancelOrder.remarksLabel')}</label>
                <textarea rows={3} placeholder={t('modals.cancelOrder.remarksPlaceholder')} value={cancelRemarks}
                  onChange={e => setCancelRemarks(e.target.value)}
                  className={`${inputCls} resize-none`} />
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setShowCancel(null)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('modals.cancelOrder.cancel')}</button>
                <button onClick={handleConfirmCancel} disabled={submitting === 'cancel'} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60 transition-colors">{submitting === 'cancel' ? t('modals.cancelOrder.submitting') : t('modals.cancelOrder.submit')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL: Edit/Add Imaging Type ── */}
        {editType && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-edit-type-title" onClick={e => { if (e.target === e.currentTarget) setEditType(null); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <h2 id="modal-edit-type-title" className="text-lg font-semibold text-[var(--color-text)]">{editType.mode === 'add' ? t('catalog.addType') : t('catalog.editType')}</h2>
                <button onClick={() => setEditType(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('catalog.nameLabel')}</label>
                  <input type="text" placeholder={t('catalog.namePlaceholder')} value={editType.name}
                    onChange={e => setEditType(et => et ? { ...et, name: e.target.value } : et)} className={inputCls} autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('catalog.codeLabel')}</label>
                  <input type="text" placeholder={t('catalog.codePlaceholder')} value={editType.code}
                    onChange={e => setEditType(et => et ? { ...et, code: e.target.value } : et)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('catalog.descriptionLabel')}</label>
                  <input type="text" placeholder={t('catalog.descriptionPlaceholder')} value={editType.description}
                    onChange={e => setEditType(et => et ? { ...et, description: e.target.value } : et)} className={inputCls} />
                </div>
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setEditType(null)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('catalog.cancelBtn')}</button>
                <button onClick={handleSaveType} disabled={submitting === 'saveType'} className="flex-1 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60 transition-colors">{submitting === 'saveType' ? t('catalog.saving') : t('catalog.save')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL: Edit/Add Imaging Item ── */}
        {editItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-edit-item-title" onClick={e => { if (e.target === e.currentTarget) setEditItem(null); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <h2 id="modal-edit-item-title" className="text-lg font-semibold text-[var(--color-text)]">{editItem.mode === 'add' ? t('catalog.addItem') : t('catalog.editItem')}</h2>
                <button onClick={() => setEditItem(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('catalog.nameLabel')}</label>
                  <input type="text" placeholder={t('catalog.namePlaceholder')} value={editItem.name}
                    onChange={e => setEditItem(ei => ei ? { ...ei, name: e.target.value } : ei)} className={inputCls} autoFocus />
                </div>
                {editItem.mode === 'add' && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('catalog.typeSelectLabel')}</label>
                    <select value={editItem.imaging_type_id}
                      onChange={e => setEditItem(ei => ei ? { ...ei, imaging_type_id: e.target.value } : ei)} className={inputCls}>
                      <option value="">{t('catalog.typeSelectPlaceholder')}</option>
                      {imagingTypes.map(ty => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('catalog.procedureCodeLabel')}</label>
                    <input type="text" placeholder={t('catalog.procedureCodePlaceholder')} value={editItem.procedure_code}
                      onChange={e => setEditItem(ei => ei ? { ...ei, procedure_code: e.target.value } : ei)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">{t('catalog.priceLabel')}</label>
                    <input type="number" placeholder={t('catalog.pricePlaceholder')} value={editItem.price_bdt}
                      onChange={e => setEditItem(ei => ei ? { ...ei, price_bdt: e.target.value } : ei)} className={inputCls} min="0" step="1" />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setEditItem(null)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('catalog.cancelBtn')}</button>
                <button onClick={handleSaveItem} disabled={submitting === 'saveItem'} className="flex-1 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-60 transition-colors">{submitting === 'saveItem' ? t('catalog.saving') : t('catalog.save')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL: Delete Confirmation ── */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="modal-delete-confirm-title" onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
            <div className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <h2 id="modal-delete-confirm-title" className="text-lg font-semibold text-[var(--color-text)]">{deleteConfirm.kind === 'type' ? t('catalog.deleteType') : t('catalog.deleteItem')}</h2>
                </div>
                <button onClick={() => setDeleteConfirm(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t('common.close')}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6">
                <p className="text-sm text-[var(--color-text)]">
                  {deleteConfirm.kind === 'type' ? t('catalog.deleteConfirmType') : t('catalog.deleteConfirmItem')}
                </p>
                <p className="mt-2 text-sm font-medium text-[var(--color-text)]">{deleteConfirm.name}</p>
              </div>
              <div className="flex gap-3 px-6 pb-6">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">{t('catalog.cancelBtn')}</button>
                <button onClick={handleDeleteCatalog} disabled={submitting === 'deleteCatalog'} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60 transition-colors">{submitting === 'deleteCatalog' ? t('catalog.deleting') : t('catalog.confirmDelete')}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Report Detail Modal ── */}
        {viewReportId !== null && (
          <ReportDetailModal
            reportId={viewReportId}
            onClose={() => setViewReportId(null)}
            onFinalized={() => queryClient.invalidateQueries({ queryKey: queryKeys.radiology.reports() })}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

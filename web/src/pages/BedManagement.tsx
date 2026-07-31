import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import {
  BedDouble, Plus, RefreshCw, ChevronRight, X, Wrench, Check, User, Tag, BookmarkPlus, Search,
  Pencil, Trash2, List,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { printDepositReceipt } from '../lib/print/depositReceiptTemplate';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';

interface PatientOption {
  id: number;
  name: string;
  patient_code?: string;
  mobile?: string;
}

interface BedInfo {
  id?: number;
  bed_id?: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  status: string;
  floor: string;
  rate_per_day?: number;
  effective_rate?: number;
  feature_names?: string;
  patient_name?: string;
  patient_code?: string;
  patient_age?: number | string | null;
  patient_gender?: string | null;
  patient_mobile?: string | null;
  patient_blood_group?: string | null;
  admission_no?: string;
  admission_date?: string;
  doctor_name?: string | null;
  discharge_initiated?: number | boolean | null;
  discharge_approved?: number | boolean | null;
  equipment_count?: number;
  equipment_issue_count?: number;
}

interface BedsResponse {
  beds: BedInfo[];
}

interface AddBedPayload {
  ward_name: string;
  bed_number: string;
  bed_type: string;
  floor?: string;
  rate_per_day?: number;
}

interface EditBedPayload {
  ward_name: string;
  bed_number: string;
  bed_type: string;
  floor: string;
  rate_per_day?: number;
  status: string;
}

interface WardInfo {
  ward_name: string;
  total_beds: number;
  available_count: number;
}

interface BedFeature {
  id: number;
  name: string;
}

interface BedDetailInfo extends BedInfo {
  feature_ids?: number[];
}

interface BedEquipment {
  id?: number;
  equipment_name: string;
  required_qty?: number;
  status: 'available' | 'in_use' | 'faulty' | 'maintenance' | 'missing';
  fixed_asset_stock_id?: number | null;
  asset_name?: string | null;
  asset_code?: string | null;
  asset_barcode?: string | null;
  asset_serial?: string | null;
  notes?: string | null;
}

interface AssetOption {
  FixedAssetStockId: number;
  ItemName?: string;
  ItemCode?: string;
  BarCodeNumber?: string;
  serial_number?: string;
  asset_status?: string;
  location?: string;
  department?: string;
}

interface BedTimelineItem {
  label: string;
  at?: string | null;
  type?: string;
  reference_id?: number;
}

interface BedCommandDetail {
  timeline?: BedTimelineItem[];
  maintenanceLogs?: Record<string, unknown>[];
}

const BED_STATUS_STYLES: Record<string, { bg: string; border: string; dot: string; labelKey: string }> = {
  available:   { bg: 'bg-emerald-50',  border: 'border-emerald-300', dot: 'bg-emerald-500',  labelKey: 'available' },
  occupied:    { bg: 'bg-blue-50',     border: 'border-blue-300',    dot: 'bg-blue-500',     labelKey: 'occupied' },
  cleaning:    { bg: 'bg-sky-50',      border: 'border-sky-300',     dot: 'bg-sky-500',      labelKey: 'cleaning' },
  maintenance: { bg: 'bg-amber-50',    border: 'border-amber-300',   dot: 'bg-amber-500',    labelKey: 'maintenance' },
  reserved:    { bg: 'bg-orange-50',   border: 'border-orange-300',  dot: 'bg-orange-500',   labelKey: 'reserved' },
};

const BED_TYPE_OPTIONS = [
  { value: 'general', labelKey: 'general', defaultLabel: 'General' },
  { value: 'icu', labelKey: 'icu', defaultLabel: 'ICU' },
  { value: 'nicu', labelKey: 'nicu', defaultLabel: 'NICU' },
  { value: 'hdu', labelKey: 'hdu', defaultLabel: 'HDU' },
  { value: 'cabin', labelKey: 'cabin', defaultLabel: 'Cabin' },
  { value: 'vip', labelKey: 'vip', defaultLabel: 'VIP' },
] as const;

const BED_TYPE_LABELS: Record<string, string> = {
  general: 'general',
  icu: 'icu',
  nicu: 'nicu',
  hdu: 'hdu',
  cabin: 'cabin',
  vip: 'vip',
};

const BED_TYPE_DEFAULT_LABELS: Record<string, string> = Object.fromEntries(
  BED_TYPE_OPTIONS.map(option => [option.value, option.defaultLabel]),
);

export default function BedManagement({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['ipd', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const queryClient = useQueryClient();

  const [searchTerm,     setSearchTerm]     = useState('');
  const [wardFilter,     setWardFilter]     = useState('all');
  const [floorFilter,    setFloorFilter]    = useState('all');
  const [typeFilter,     setTypeFilter]     = useState('all');
  const [featureFilter,  setFeatureFilter]  = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [reserveBed, setReserveBed] = useState<BedInfo | null>(null);
  const [addForm, setAddForm] = useState({ ward_name: '', bed_number: '', bed_type: 'general', floor: '', rate_per_day: '' });
  const [reserveForm, setReserveForm] = useState({ patient_id: '', reserved_to: '', remarks: '' });
  const [reservePatientSearch, setReservePatientSearch] = useState('');
  const [reservePatientSearchDebounced, setReservePatientSearchDebounced] = useState('');
  const [showReservePatientDropdown, setShowReservePatientDropdown] = useState(false);
  const [showReserveDepositModal, setShowReserveDepositModal] = useState(false);
  const [reserveDepositForm, setReserveDepositForm] = useState({ patient_id: 0, amount: '', payment_method: 'cash', remarks: '' });
  const [reservedPatientName, setReservedPatientName] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [editBed, setEditBed] = useState<BedInfo | null>(null);
  const [editForm, setEditForm] = useState({ ward_name: '', bed_number: '', bed_type: 'general', floor: '', rate_per_day: '', status: 'available' });
  const [deleteBedId, setDeleteBedId] = useState<number | null>(null);
  const [showWardModal, setShowWardModal] = useState(false);
  const [editingWard, setEditingWard] = useState<string | null>(null);
  const [editWardName, setEditWardName] = useState('');
  const [detailBed, setDetailBed] = useState<BedInfo | null>(null);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([]);
  const [bedEquipmentRows, setBedEquipmentRows] = useState<BedEquipment[]>([]);
  const [assetSearchTerm, setAssetSearchTerm] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setReservePatientSearchDebounced(reservePatientSearch), 300);
    return () => clearTimeout(t);
  }, [reservePatientSearch]);

  // ─── Query: fetch beds ──────────────────────────────────────────────────────
  const bedsQuery = useApiQuery<BedsResponse>(
    [...queryKeys.admissions.beds(), 'ward-overview'],
    '/api/admissions/ward-bed-overview',
  );

  const beds = (bedsQuery.data?.beds ?? []).map(b => ({
    ...b,
    id: b.id ?? b.bed_id,
  }));
  const loading = bedsQuery.isLoading;

  const handleRetry = () => {
    handleRefresh();
  };

  // Patient search for reserve modal
  const { data: reservePatientsData } = useApiQuery<{ patients: PatientOption[] }>(
    [...queryKeys.patients.all, 'reserve-bed', reservePatientSearchDebounced],
    `/api/patients?search=${encodeURIComponent(reservePatientSearchDebounced)}&limit=8`,
    { enabled: reservePatientSearchDebounced.length >= 2 && !!reserveBed },
  );
  const reservePatients = reservePatientsData?.patients ?? [];

  // ─── Mutation: add bed ──────────────────────────────────────────────────────
  const addBedMutation = useApiMutation<unknown, AddBedPayload>(
    'post',
    '/api/admissions/beds',
    {
      onSuccess: () => {
        toast.success(t('ipd.bedAdded', { ward: addForm.ward_name, bed: addForm.bed_number }));
        setShowAddModal(false);
        setAddForm({ ward_name: '', bed_number: '', bed_type: 'general', floor: '', rate_per_day: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
      },
      onError: (err: Error) => {
        toast.error(err.message || 'Failed to add bed');
      },
    },
  );

  const reserveMutation = useApiMutation<unknown, { patient_id: number; bed_id: number; reserved_from: string; reserved_to?: string; remarks?: string }>(
    'post',
    '/api/admissions/bed-reservations',
    {
      onSuccess: (_, vars) => {
        toast.success(t('bedManagement.bedReserved', { defaultValue: 'Bed reserved' }));
        setReserveBed(null);
        setReserveForm({ patient_id: '', reserved_to: '', remarks: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
        // Prompt for deposit after reservation
        const patient = reservePatients.find(p => p.id === vars.patient_id);
        setReservedPatientName(patient?.name ?? 'Patient');
        setReserveDepositForm({ patient_id: vars.patient_id, amount: '', payment_method: 'cash', remarks: `Deposit for bed reservation` });
        setShowReserveDepositModal(true);
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to reserve bed'),
    },
  );

  const collectDepositMutation = useApiMutation<{ receiptNo: string; balance: number }, { patient_id: number; amount: number; payment_method: string; remarks?: string }>(
    'post',
    '/api/deposits',
    { onSuccess: () => toast.success('Deposit collected'), onError: (err) => toast.error(err.message || 'Failed to collect deposit') },
  );

  // ─── Query: wards ───────────────────────────────────────────────────────────
  const { data: wardsData } = useApiQuery<{ wards: WardInfo[] }>(
    [...queryKeys.admissions.beds(), 'wards'],
    '/api/admissions/wards',
    { enabled: showWardModal },
  );
  const wardsList = wardsData?.wards ?? [];

  // ─── Query: bed features ────────────────────────────────────────────────────
  const { data: featuresData } = useApiQuery<{ features: BedFeature[] }>(
    [...queryKeys.admissions.beds(), 'bed-features'],
    '/api/admissions/bed-features',
    { enabled: !!detailBed },
  );
  const allFeatures = featuresData?.features ?? [];

  // ─── Query: bed detail (for feature management) ─────────────────────────────
  const { data: bedDetailData } = useApiQuery<{ bed: BedDetailInfo }>(
    [...queryKeys.admissions.beds(), 'detail', detailBed?.id],
    `/api/admissions/beds/${detailBed?.id}`,
    { enabled: !!detailBed?.id },
  );

  const { data: bedEquipmentData } = useApiQuery<{ equipment: BedEquipment[] }>(
    [...queryKeys.admissions.beds(), 'bed-equipment', detailBed?.id],
    `/api/admissions/beds/${detailBed?.id}/equipment`,
    { enabled: !!detailBed?.id },
  );

  const { data: commandDetailData } = useApiQuery<BedCommandDetail>(
    [...queryKeys.admissions.beds(), 'command-detail', detailBed?.id],
    `/api/admissions/beds/${detailBed?.id}/command-detail`,
    { enabled: !!detailBed?.id },
  );

  const { data: assetPickerData } = useApiQuery<{ data?: AssetOption[]; Results?: AssetOption[] }>(
    [...queryKeys.assets.list({ scope: 'bed-equipment-picker', search: assetSearchTerm })],
    `/api/inventory/assets?status=active&limit=100${assetSearchTerm.trim() ? `&search=${encodeURIComponent(assetSearchTerm.trim())}` : ''}`,
    { enabled: !!detailBed?.id },
  );
  const assetOptions = assetPickerData?.data ?? assetPickerData?.Results ?? [];

  useEffect(() => {
    if (bedDetailData?.bed && detailBed?.id === bedDetailData.bed.id) {
      setSelectedFeatureIds(bedDetailData.bed.feature_ids ?? []);
    }
  }, [bedDetailData, detailBed]);

  useEffect(() => {
    if (!detailBed?.id) {
      setBedEquipmentRows([]);
      return;
    }
    setBedEquipmentRows(bedEquipmentData?.equipment ?? []);
  }, [bedEquipmentData, detailBed?.id]);

  // ─── Mutation: edit bed ─────────────────────────────────────────────────────
  const editBedMutation = useApiMutation<unknown, EditBedPayload>(
    'put',
    `/api/admissions/beds/${editBed?.id}`,
    {
      onSuccess: () => {
        toast.success('Bed updated');
        setEditBed(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to update bed'),
    },
  );

  // ─── Mutation: quick status change (reception) ─────────────────────────────
  const quickStatusMutation = useApiMutation<unknown, { bedId: number; status: string }>(
    'put',
    (vars) => `/api/admissions/beds/${vars.bedId}`,
    {
      onSuccess: () => {
        toast.success('Status updated');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to update status'),
    },
  );

  // ─── Mutation: delete bed ───────────────────────────────────────────────────
  const deleteBedMutation = useApiMutation(
    'delete',
    `/api/admissions/beds/${deleteBedId}`,
    {
      onSuccess: () => {
        toast.success('Bed deleted');
        setDeleteBedId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to delete bed'),
    },
  );

  // ─── Mutation: update ward name ─────────────────────────────────────────────
  const renameWardMutation = useApiMutation<unknown, { name: string }>(
    'put',
    `/api/admissions/wards/${editingWard}`,
    {
      onSuccess: () => {
        toast.success('Ward renamed');
        setEditingWard(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to rename ward'),
    },
  );

  // ─── Mutation: delete ward ──────────────────────────────────────────────────
  const deleteWardMutation = useApiMutation<unknown, { wardName: string }>(
    'delete',
    (vars) => `/api/admissions/wards/${vars.wardName}`,
    {
      onSuccess: () => {
        toast.success('Ward deleted');
        setEditingWard(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to delete ward'),
    },
  );

  // ─── Mutation: assign features to bed ───────────────────────────────────────
  const assignFeaturesMutation = useApiMutation<unknown, { feature_ids: number[] }>(
    'put',
    `/api/admissions/beds/${detailBed?.id}/features`,
    {
      onSuccess: () => {
        toast.success('Features updated');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
        queryClient.invalidateQueries({ queryKey: [...queryKeys.admissions.beds(), 'detail', detailBed?.id] });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to update features'),
    },
  );

  const saveEquipmentMutation = useApiMutation<{ equipment: BedEquipment[] }, { equipment: BedEquipment[] }>(
    'put',
    `/api/admissions/beds/${detailBed?.id}/equipment`,
    {
      onSuccess: (data) => {
        toast.success('Bed equipment updated');
        setBedEquipmentRows(data.equipment ?? []);
        queryClient.invalidateQueries({ queryKey: [...queryKeys.admissions.beds(), 'bed-equipment', detailBed?.id] });
        queryClient.invalidateQueries({ queryKey: [...queryKeys.admissions.beds(), 'command-detail', detailBed?.id] });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to update bed equipment'),
    },
  );

  const logEquipmentMaintenanceMutation = useApiMutation<unknown, { asset_stock_id: number; maintenance_type: string; description: string; performed_date: string }>(
    'post',
    '/api/inventory/assets/maintenance',
    {
      onSuccess: () => {
        toast.success('Maintenance ticket logged');
        queryClient.invalidateQueries({ queryKey: queryKeys.assets.maintenance() });
        queryClient.invalidateQueries({ queryKey: [...queryKeys.admissions.beds(), 'command-detail', detailBed?.id] });
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
      },
      onError: (err: Error) => toast.error(err.message || 'Failed to log maintenance'),
    },
  );

  const handleAddBed = () => {
    if (!addForm.ward_name || !addForm.bed_number) {
      toast.error(t('ipd.ward_and_bed_number_required'));
      return;
    }
    addBedMutation.mutate({
      ward_name: addForm.ward_name,
      bed_number: addForm.bed_number,
      bed_type: addForm.bed_type,
      floor: addForm.floor || undefined,
      rate_per_day: addForm.rate_per_day ? Number(addForm.rate_per_day) : undefined,
    });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds() });
  };

  const handleReserve = () => {
    const bedId = reserveBed?.id ?? reserveBed?.bed_id;
    const patientId = Number(reserveForm.patient_id);
    if (!bedId || !patientId) {
      toast.error(t('bedManagement.patientRequired', { defaultValue: 'Patient ID is required' }));
      return;
    }
    reserveMutation.mutate({
      bed_id: bedId,
      patient_id: patientId,
      reserved_from: new Date().toISOString(),
      reserved_to: reserveForm.reserved_to || undefined,
      remarks: reserveForm.remarks || undefined,
    });
  };

  const handleReserveDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reserveDepositForm.patient_id || !reserveDepositForm.amount) {
      toast.error('Patient and amount required');
      return;
    }
    collectDepositMutation.mutate({
      patient_id: reserveDepositForm.patient_id,
      amount: Number(reserveDepositForm.amount),
      payment_method: reserveDepositForm.payment_method,
      remarks: reserveDepositForm.remarks,
    }, {
      onSuccess: (data) => {
        setShowReserveDepositModal(false);
        setReserveDepositForm({ patient_id: 0, amount: '', payment_method: 'cash', remarks: '' });
        printDepositReceipt({
          receiptNo: data.receiptNo,
          date: new Date().toISOString(),
          patientName: reservedPatientName,
          amount: Number(reserveDepositForm.amount),
          paymentMethod: reserveDepositForm.payment_method,
          remarks: reserveDepositForm.remarks,
        });
      },
    });
  };

  const handleEditBed = () => {
    if (!editBed || !editForm.ward_name || !editForm.bed_number) {
      toast.error('Ward and bed number required');
      return;
    }
    editBedMutation.mutate({
      ward_name: editForm.ward_name,
      bed_number: editForm.bed_number,
      bed_type: editForm.bed_type,
      floor: editForm.floor,
      rate_per_day: editForm.rate_per_day ? Number(editForm.rate_per_day) : undefined,
      status: editForm.status,
    });
  };

  const handleDeleteBed = () => {
    if (!deleteBedId) return;
    deleteBedMutation.mutate({});
  };

  const handleRenameWard = () => {
    if (!editingWard || !editWardName.trim()) return;
    renameWardMutation.mutate({ name: editWardName.trim() });
  };

  const handleDeleteWard = (wardName: string) => {
    if (!confirm(`Delete ward "${wardName}"? This cannot be undone.`)) return;
    deleteWardMutation.mutate({ wardName });
  };

  const handleAssignFeatures = () => {
    if (!detailBed?.id) return;
    assignFeaturesMutation.mutate({ feature_ids: selectedFeatureIds });
  };

  const openEditModal = (bed: BedInfo) => {
    setEditBed(bed);
    setEditForm({
      ward_name: bed.ward_name,
      bed_number: bed.bed_number,
      bed_type: bed.bed_type,
      floor: bed.floor || '',
      rate_per_day: bed.rate_per_day != null ? String(bed.rate_per_day) : '',
      status: bed.status,
    });
  };

  const openDetailModal = (bed: BedInfo) => {
    setDetailBed(bed);
    const detailData = bedDetailData?.bed;
    if (detailData && detailData.id === bed.id) {
      setSelectedFeatureIds(detailData.feature_ids ?? []);
    } else {
      setSelectedFeatureIds([]);
    }
  };

  const formatAssetLabel = (asset?: AssetOption) => {
    if (!asset) return 'Select inventory asset...';
    const name = asset.ItemName || 'Unnamed Asset';
    const code = asset.ItemCode || asset.BarCodeNumber || asset.serial_number;
    return `${name}${code ? ` — ${code}` : ''}`;
  };

  const applyAssetToEquipmentRow = (rowIndex: number, assetId: number) => {
    const selectedAsset = assetOptions.find(asset => asset.FixedAssetStockId === assetId);
    setBedEquipmentRows(rows => rows.map((row, index) => index === rowIndex ? {
      ...row,
      fixed_asset_stock_id: assetId || null,
      equipment_name: selectedAsset?.ItemName || row.equipment_name,
      asset_name: selectedAsset?.ItemName || null,
      asset_code: selectedAsset?.ItemCode || null,
      asset_barcode: selectedAsset?.BarCodeNumber || null,
      asset_serial: selectedAsset?.serial_number || null,
    } : row));
  };

  const handleLogEquipmentMaintenance = (item: BedEquipment) => {
    if (!item.fixed_asset_stock_id) {
      toast.error('Select an inventory asset first');
      return;
    }
    logEquipmentMaintenanceMutation.mutate({
      asset_stock_id: item.fixed_asset_stock_id,
      maintenance_type: item.status === 'faulty' ? 'repair' : 'corrective',
      description: `${item.equipment_name} issue from bed ${detailBed?.bed_number || ''}${item.notes ? ` — ${item.notes}` : ''}`,
      performed_date: new Date().toISOString().slice(0, 10),
    });
  };

  const wards          = [...new Set(beds.map(b => b.ward_name))];
  const floors         = [...new Set(beds.map(b => b.floor || '').filter(Boolean))];
  const bedTypes       = [...new Set(beds.map(b => b.bed_type).filter(Boolean))];
  const features       = [...new Set(beds.flatMap(b => (b.feature_names || '').split(',').map(s => s.trim()).filter(Boolean)))];
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleBeds    = beds.filter((bed) => {
    const tagList = (bed.feature_names || '').split(',').map(s => s.trim()).filter(Boolean);
    const haystack = [bed.bed_number, bed.ward_name, bed.floor, bed.bed_type, bed.patient_name, bed.patient_code, bed.patient_mobile, bed.admission_no, bed.doctor_name]
      .map(value => String(value ?? '').toLowerCase())
      .join(' ');
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesWard = wardFilter === 'all' || bed.ward_name === wardFilter;
    const matchesFloor = floorFilter === 'all' || (bed.floor || '') === floorFilter;
    const matchesType = typeFilter === 'all' || bed.bed_type === typeFilter;
    const matchesFeature = featureFilter === 'all' || tagList.includes(featureFilter);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'equipment_issues' ? Number(bed.equipment_issue_count ?? 0) > 0 : bed.status === statusFilter);
    return matchesSearch && matchesWard && matchesFloor && matchesType && matchesFeature && matchesStatus;
  });
  const filteredWards  = wards.filter(ward => visibleBeds.some(bed => bed.ward_name === ward));
  const total          = beds.length;
  const available      = beds.filter(b => b.status === 'available').length;
  const occupied       = beds.filter(b => b.status === 'occupied').length;
  const cleaning       = beds.filter(b => b.status === 'cleaning').length;
  const maintenance    = beds.filter(b => b.status === 'maintenance').length;
  const reserved       = beds.filter(b => b.status === 'reserved').length;
  const equipmentIssues = beds.filter(b => Number(b.equipment_issue_count ?? 0) > 0).length;

  const kpis = [
    { key: 'all', label: t('bedManagement.totalBeds'),  value: total,       color: 'text-[var(--color-text)]',  bg: 'bg-[var(--color-surface)]' },
    { key: 'available', label: t('bedManagement.available'),   value: available,   color: 'text-emerald-600',           bg: 'bg-emerald-50' },
    { key: 'occupied', label: t('bedManagement.occupied'),    value: occupied,    color: 'text-blue-600',              bg: 'bg-blue-50' },
    { key: 'cleaning', label: t('bedManagement.cleaning', { defaultValue: 'Cleaning' }), value: cleaning, color: 'text-sky-600', bg: 'bg-sky-50' },
    { key: 'reserved', label: t('bedManagement.reserved', { defaultValue: 'Reserved' }), value: reserved, color: 'text-orange-600', bg: 'bg-orange-50' },
    { key: 'maintenance', label: t('bedManagement.maintenance'), value: maintenance, color: 'text-amber-600',             bg: 'bg-amber-50' },
    { key: 'equipment_issues', label: 'Equipment Issues', value: equipmentIssues, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 ipd-bed-command">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <nav className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('common:dashboard')}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/admissions`} className="hover:underline">{t('common:admissions')}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('bedManagement.title')}</span>
            </nav>
            <h1 className="page-title">{t('bedManagement.title')}</h1>
          </div>
          <div className="flex items-center gap-2">
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input min-w-[220px]" placeholder="Search bed or patient" />
            <select value={wardFilter} onChange={e => setWardFilter(e.target.value)} className="input">
              <option value="all">{t('bedManagement.allWards')}</option>
              {wards.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <select value={featureFilter} onChange={e => setFeatureFilter(e.target.value)} className="input">
              <option value="all">{t('bedManagement.allFeatures', { defaultValue: 'All features' })}</option>
              {features.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <button onClick={() => setShowAddModal(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> {t('addBed')}
            </button>
            {['hospital_admin', 'director', 'md'].includes(role) && (
              <button onClick={() => setShowWardModal(true)} className="btn-secondary">
                <List className="w-4 h-4" /> Manage Wards
              </button>
            )}
            <button onClick={handleRefresh} className="btn-ghost p-2" aria-label={t('common:refresh')}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
          {kpis.map(k => (
            <button
              key={k.key}
              type="button"
              onClick={() => setStatusFilter(k.key)}
              className={`card p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md ${k.bg} ${statusFilter === k.key ? 'ring-2 ring-[var(--color-primary)]' : ''}`}
            >
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{k.label}</p>
            </button>
          ))}
        </div>

        <div className="card p-4 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search bed, patient, ID, mobile, admission no, doctor..."
              className="input pl-9 w-full"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <select value={wardFilter} onChange={e => setWardFilter(e.target.value)} className="input">
              <option value="all">All Wards</option>
              {wards.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <select value={floorFilter} onChange={e => setFloorFilter(e.target.value)} className="input">
              <option value="all">All Floors</option>
              {floors.map(floor => <option key={floor} value={floor}>{floor}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input">
              <option value="all">All Bed Types</option>
              {bedTypes.map(type => <option key={type} value={type}>{BED_TYPE_DEFAULT_LABELS[type] ?? type}</option>)}
            </select>
            <select value={featureFilter} onChange={e => setFeatureFilter(e.target.value)} className="input">
              <option value="all">All Features</option>
              {features.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input">
              <option value="all">All Status</option>
              {Object.entries(BED_STATUS_STYLES).map(([key, st]) => <option key={key} value={key}>{st.labelKey}</option>)}
              <option value="equipment_issues">Equipment Issues</option>
            </select>
            <button type="button" className="btn-secondary justify-center" onClick={() => { setSearchTerm(''); setWardFilter('all'); setFloorFilter('all'); setTypeFilter('all'); setFeatureFilter('all'); setStatusFilter('all'); }}>Clear</button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Showing {visibleBeds.length} of {beds.length} beds after filters.</p>
        </div>

        {statusFilter !== 'all' ? (
          <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-sm">
            <span className="text-[var(--color-text-secondary)]">
              Showing {visibleBeds.length} {statusFilter} beds
            </span>
            <button type="button" className="btn-ghost text-sm" onClick={() => setStatusFilter('all')}>Clear bed filter</button>
          </div>
        ) : null}

        {/* ── Legend ── */}
        <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
          {Object.entries(BED_STATUS_STYLES).map(([key, st]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-full ${st.dot}`} /> {t(`bedManagement.${st.labelKey}`)}
            </span>
          ))}
        </div>

        {/* ── Visual Bed Map ── */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
        ) : bedsQuery.isError ? (
          <div className="card p-12 text-center">
            <p className="text-red-500 mb-3">Failed to load bed data</p>
            <button onClick={handleRetry} className="btn-primary">Retry</button>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredWards.map(ward => {
              const wardBeds = visibleBeds.filter(b => b.ward_name === ward);
              return (
                <div key={ward} className="ward-board-panel">
                  <h3 className="section-title mb-3 flex items-center gap-2">
                    <BedDouble className="w-4 h-4 text-[var(--color-primary)]" />
                    {ward}
                    <span className="text-xs text-[var(--color-text-muted)] font-normal">
                      ({wardBeds.filter(b => b.status === 'available').length}/{wardBeds.length} {t('bedManagement.available').toLowerCase()})
                    </span>
                  </h3>
                  <div className="bed-board-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {wardBeds.map(bed => {
                      const st = BED_STATUS_STYLES[bed.status] ?? BED_STATUS_STYLES.available;
                      const tags = (bed.feature_names || '').split(',').map(s => s.trim()).filter(Boolean);
                      const isAdmin = ['hospital_admin', 'director', 'md'].includes(role);
                      const isReception = role === 'reception';
                      return (
                        <div key={bed.id ?? `${bed.ward_name}-${bed.bed_number}`}
                          className={`bed-tile rounded-xl p-3 border-2 ${st.bg} ${st.border} ${bed.status === 'maintenance' ? 'border-dashed' : ''} transition-all hover:shadow-md cursor-pointer`}
                          onClick={() => openDetailModal(bed)}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono font-bold text-sm text-[var(--color-text)]">{bed.bed_number}</span>
                            <div className="flex items-center gap-1">
                              {isAdmin && (
                                <button type="button" onClick={(e) => { e.stopPropagation(); openEditModal(bed); }}
                                  className="p-1 rounded hover:bg-black/10 transition-colors" title="Edit bed">
                                  <Pencil className="w-3 h-3 text-[var(--color-text-muted)]" />
                                </button>
                              )}
                              {isAdmin && bed.status === 'available' && (
                                <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteBedId(bed.id ?? null); }}
                                  className="p-1 rounded hover:bg-red-100 transition-colors" title="Delete bed">
                                  <Trash2 className="w-3 h-3 text-red-500" />
                                </button>
                              )}
                              <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                            </div>
                          </div>
                          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1">
                            {t(`bedManagement.${BED_TYPE_LABELS[bed.bed_type] ?? bed.bed_type}`, {
                              defaultValue: BED_TYPE_DEFAULT_LABELS[bed.bed_type] ?? bed.bed_type,
                            })}
                          </p>
                          <div className="flex flex-wrap gap-1 min-h-[20px]">
                            {tags.slice(0, 3).map(tag => (
                              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
                                <Tag className="w-2.5 h-2.5" /> {tag}
                              </span>
                            ))}
                          </div>
                          {bed.status === 'occupied' && bed.patient_name ? (
                            <div className="mt-2 rounded-lg bg-white/80 border border-blue-100 p-2 text-xs text-blue-800 space-y-1">
                              <div className="flex items-center gap-1 font-semibold">
                                <User className="w-3 h-3" />
                                <span className="truncate">{bed.patient_name}</span>
                              </div>
                              <div className="text-[11px] text-blue-700 truncate">
                                {bed.patient_code || 'No ID'}{bed.patient_age ? ` · ${bed.patient_age}Y` : ''}{bed.patient_gender ? ` · ${bed.patient_gender}` : ''}
                              </div>
                              {bed.doctor_name && <div className="text-[11px] truncate">Dr: {bed.doctor_name}</div>}
                              {bed.patient_mobile && <div className="text-[11px] truncate">Mobile: {bed.patient_mobile}</div>}
                              {bed.admission_no && <div className="text-[11px] truncate">Admission: {bed.admission_no}</div>}
                              <div className="flex flex-wrap gap-1 pt-1">
                                {bed.discharge_initiated ? <span className="rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[10px]">Discharge started</span> : null}
                                {bed.discharge_approved ? <span className="rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px]">Approved</span> : null}
                              </div>
                            </div>
                          ) : bed.status === 'available' ? (
                            <div className="flex items-center gap-1 text-xs text-emerald-600 mt-1">
                              <Check className="w-3 h-3" /> {t('bedManagement.ready')}
                            </div>
                          ) : bed.status === 'cleaning' ? (
                            <div className="flex items-center gap-1 text-xs text-sky-700 mt-1">
                              <RefreshCw className="w-3 h-3" /> {t('bedManagement.cleaning', { defaultValue: 'Cleaning pending' })}
                            </div>
                          ) : bed.status === 'maintenance' ? (
                            <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                              <Wrench className="w-3 h-3" /> {t('bedManagement.maintenance')}
                            </div>
                          ) : bed.status === 'reserved' ? (
                            <div className="flex items-center gap-1 text-xs text-orange-700 mt-1">
                              <BookmarkPlus className="w-3 h-3" /> {t('bedManagement.reserved')}
                            </div>
                          ) : null}
                          {isReception && bed.status !== 'occupied' && (
                            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={bed.status}
                                onChange={(e) => {
                                  const bedId = bed.id ?? bed.bed_id;
                                  if (bedId) quickStatusMutation.mutate({ bedId, status: e.target.value });
                                }}
                                disabled={quickStatusMutation.isPending}
                                className="input text-xs py-1 px-2 w-full"
                              >
                                <option value="available">Available</option>
                                <option value="cleaning">Cleaning</option>
                                <option value="maintenance">Maintenance</option>
                                <option value="reserved">Reserved</option>
                              </select>
                            </div>
                          )}
                          {(bed.status === 'maintenance' || Number(bed.equipment_issue_count ?? 0) > 0 || (bed.feature_names || '').toLowerCase().includes('faulty')) && (
                            <div className="mt-2 rounded-lg bg-amber-100 text-amber-800 px-2 py-1 text-[10px] font-medium">
                              {Number(bed.equipment_issue_count ?? 0) > 0
                                ? `${Number(bed.equipment_issue_count)} equipment issue${Number(bed.equipment_issue_count) > 1 ? 's' : ''}`
                                : 'Equipment/maintenance attention needed'}
                            </div>
                          )}
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                              ৳{Number(bed.effective_rate ?? bed.rate_per_day ?? 0).toLocaleString()}/day
                            </span>
                            {bed.status === 'available' && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); setReserveBed(bed); setReserveForm({ patient_id: '', reserved_to: '', remarks: '' }); }}
                                className="text-[11px] text-orange-700 hover:text-orange-900 font-medium inline-flex items-center gap-1">
                                <BookmarkPlus className="w-3 h-3" /> {t('bedManagement.reserve', { defaultValue: 'Reserve' })}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Add Bed Modal ── */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">{t('addBed', { defaultValue: 'Add Bed' })}</h2>
                <button onClick={() => setShowAddModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="label">{t('ipd.ward_name_')}</label>
                  <input type="text" value={addForm.ward_name}
                    onChange={e => setAddForm(f => ({ ...f, ward_name: e.target.value }))}
                    placeholder={t("ipd.eg_ward_a")} className="input" />
                </div>
                <div>
                  <label className="label">{t('ipd.bed_number_')}</label>
                  <input type="text" value={addForm.bed_number}
                    onChange={e => setAddForm(f => ({ ...f, bed_number: e.target.value }))}
                    placeholder={t("ipd.eg_a6")} className="input" />
                </div>
                <div>
                  <label className="label">{t('bedManagement.bedType', { defaultValue: 'Bed type' })}</label>
                  <select value={addForm.bed_type}
                    onChange={e => setAddForm(f => ({ ...f, bed_type: e.target.value }))}
                    className="input">
                    {BED_TYPE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {t(`bedManagement.${option.labelKey}`, { defaultValue: option.defaultLabel })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('ipd.floor')}</label>
                  <input type="text" value={addForm.floor}
                    onChange={e => setAddForm(f => ({ ...f, floor: e.target.value }))}
                    placeholder={t("ipd.eg_1st_floor")} className="input" />
                </div>
                <div>
                  <label className="label">Rate per day (৳)</label>
                  <input type="number" min={0} step={0.01} value={addForm.rate_per_day}
                    onChange={e => setAddForm(f => ({ ...f, rate_per_day: e.target.value }))}
                    placeholder="e.g. 2000" className="input" />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 pb-5">
                <button onClick={() => setShowAddModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleAddBed} disabled={addBedMutation.isPending} className="btn-primary">
                  {addBedMutation.isPending ? t('common:adding', { defaultValue: 'Adding...' }) : t('addBed')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Reserve Bed Modal ── */}
        {reserveBed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setReserveBed(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">{t('bedManagement.reserveBed', { defaultValue: 'Reserve Bed' })}</h2>
                <button onClick={() => setReserveBed(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                  {reserveBed.ward_name} — {reserveBed.bed_number} · ৳{Number(reserveBed.effective_rate ?? reserveBed.rate_per_day ?? 0).toLocaleString()}/day
                </div>
                <div className="relative">
                  <label className="label">{t('patient', { ns: 'common', defaultValue: 'Patient' })}</label>
                  <input type="text" required
                    placeholder={t('searchPatientNameCode', { defaultValue: 'Search patient name or code' })}
                    className="input w-full"
                    value={reserveForm.patient_id ? (reservePatients.find(p => String(p.id) === reserveForm.patient_id)?.name ?? reservePatientSearch) : reservePatientSearch}
                    onChange={e => { setReservePatientSearch(e.target.value); setReserveForm(f => ({ ...f, patient_id: '' })); setShowReservePatientDropdown(true); }}
                    onFocus={() => setShowReservePatientDropdown(true)}
                  />
                  {showReservePatientDropdown && reservePatients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {reservePatients.map(p => (
                        <button key={p.id} type="button" onClick={() => { setReserveForm(f => ({ ...f, patient_id: String(p.id) })); setReservePatientSearch(`${p.name}${p.patient_code ? ` (${p.patient_code})` : ''}`); setShowReservePatientDropdown(false); }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code || ''}{p.mobile ? ` · ${p.mobile}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">{t('bedManagement.reservedTo', { defaultValue: 'Reserved until' })}</label>
                  <input type="datetime-local" value={reserveForm.reserved_to}
                    onChange={e => setReserveForm(f => ({ ...f, reserved_to: e.target.value }))}
                    className="input" />
                </div>
                <div>
                  <label className="label">{t('common:remarks', { defaultValue: 'Remarks' })}</label>
                  <textarea value={reserveForm.remarks}
                    onChange={e => setReserveForm(f => ({ ...f, remarks: e.target.value }))}
                    rows={3} className="input" />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 pb-5">
                <button onClick={() => setReserveBed(null)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleReserve} disabled={reserveMutation.isPending} className="btn-primary">
                  {reserveMutation.isPending ? t('common:saving') : t('bedManagement.reserve', { defaultValue: 'Reserve' })}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Reserve Deposit Modal ── */}
        {showReserveDepositModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowReserveDepositModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">{t('collectDeposit', { defaultValue: 'Collect Deposit' })}</h2>
                <button onClick={() => setShowReserveDepositModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleReserveDeposit} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('patient', { ns: 'common', defaultValue: 'Patient' })}</label>
                  <div className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-bg)]">
                    {reservedPatientName}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('depositAmount', { defaultValue: 'Amount (৳)' })}</label>
                    <input type="number" min={0} step={0.01} required
                      value={reserveDepositForm.amount} onChange={e => setReserveDepositForm(f => ({ ...f, amount: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" placeholder="e.g. 5000" />
                  </div>
                  <div>
                    <label className="label">{t('paymentMethod', { defaultValue: 'Payment Method' })}</label>
                    <select value={reserveDepositForm.payment_method} onChange={e => setReserveDepositForm(f => ({ ...f, payment_method: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bkash">bKash</option>
                      <option value="nagad">Nagad</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">{t('common:remarks')}</label>
                  <input type="text" value={reserveDepositForm.remarks} onChange={e => setReserveDepositForm(f => ({ ...f, remarks: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" placeholder="Optional remarks" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowReserveDepositModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                  <button type="submit" disabled={collectDepositMutation.isPending} className="btn-primary">
                    {collectDepositMutation.isPending ? t('common:saving') : t('collectDeposit', { defaultValue: 'Collect Deposit' })}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Edit Bed Modal ── */}
        {editBed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setEditBed(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">Edit Bed</h2>
                <button onClick={() => setEditBed(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="label">{t('ipd.ward_name_')}</label>
                  <input type="text" value={editForm.ward_name}
                    onChange={e => setEditForm(f => ({ ...f, ward_name: e.target.value }))}
                    className="input" />
                </div>
                <div>
                  <label className="label">{t('ipd.bed_number_')}</label>
                  <input type="text" value={editForm.bed_number}
                    onChange={e => setEditForm(f => ({ ...f, bed_number: e.target.value }))}
                    className="input" />
                </div>
                <div>
                  <label className="label">{t('bedManagement.bedType', { defaultValue: 'Bed type' })}</label>
                  <select value={editForm.bed_type}
                    onChange={e => setEditForm(f => ({ ...f, bed_type: e.target.value }))}
                    className="input">
                    {BED_TYPE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {t(`bedManagement.${option.labelKey}`, { defaultValue: option.defaultLabel })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('ipd.floor')}</label>
                  <input type="text" value={editForm.floor}
                    onChange={e => setEditForm(f => ({ ...f, floor: e.target.value }))}
                    className="input" />
                </div>
                <div>
                  <label className="label">Rate per day (৳)</label>
                  <input type="number" min={0} step={0.01} value={editForm.rate_per_day}
                    onChange={e => setEditForm(f => ({ ...f, rate_per_day: e.target.value }))}
                    className="input" />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select value={editForm.status}
                    onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                    className="input">
                    <option value="available">Available</option>
                    <option value="occupied">Occupied</option>
                    <option value="cleaning">Cleaning</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="reserved">Reserved</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 pb-5">
                <button onClick={() => setEditBed(null)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleEditBed} disabled={editBedMutation.isPending} className="btn-primary">
                  {editBedMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete Bed Confirmation ── */}
        {deleteBedId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteBedId(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="p-5 text-center">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2">Delete Bed?</h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-6">
                  This action cannot be undone. The bed will be permanently removed.
                </p>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setDeleteBedId(null)} className="btn-secondary">{t('common:cancel')}</button>
                  <button onClick={handleDeleteBed} disabled={deleteBedMutation.isPending}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors font-medium text-sm">
                    {deleteBedMutation.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Ward Management Modal ── */}
        {showWardModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => { setShowWardModal(false); setEditingWard(null); }}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">Manage Wards</h2>
                <button onClick={() => { setShowWardModal(false); setEditingWard(null); }} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 max-h-[60vh] overflow-y-auto">
                {wardsList.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No wards found</p>
                ) : (
                  <div className="space-y-3">
                    {wardsList.map(ward => (
                      <div key={ward.ward_name} className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                        <div className="flex-1 min-w-0">
                          {editingWard === ward.ward_name ? (
                            <div className="flex items-center gap-2">
                              <input type="text" value={editWardName}
                                onChange={e => setEditWardName(e.target.value)}
                                className="input flex-1" autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') handleRenameWard(); if (e.key === 'Escape') setEditingWard(null); }} />
                              <button onClick={handleRenameWard} disabled={renameWardMutation.isPending}
                                className="p-1.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditingWard(null)} className="p-1.5 rounded hover:bg-gray-100">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div>
                              <p className="font-medium text-sm text-[var(--color-text)]">{ward.ward_name}</p>
                              <p className="text-xs text-[var(--color-text-muted)]">
                                {ward.total_beds} beds · {(ward.available_count ?? (ward as { available?: number }).available ?? 0)} available
                              </p>
                            </div>
                          )}
                        </div>
                        {editingWard !== ward.ward_name && (
                          <div className="flex items-center gap-1 ml-3">
                            <button onClick={() => { setEditingWard(ward.ward_name); setEditWardName(ward.ward_name); }}
                              className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Rename ward">
                              <Pencil className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                            </button>
                            {ward.total_beds === 0 && (
                              <button onClick={() => handleDeleteWard(ward.ward_name)}
                                className="p-1.5 rounded hover:bg-red-100 transition-colors" title="Delete ward (0 beds)">
                                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end px-5 pb-5">
                <button onClick={() => { setShowWardModal(false); setEditingWard(null); }} className="btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bed Detail / Right Drawer ── */}
        {detailBed && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm" onClick={() => setDetailBed(null)}>
            <div className="bg-white dark:bg-slate-800 shadow-2xl w-full max-w-xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-[var(--color-text)]">
                  Bed {detailBed.bed_number} — {detailBed.ward_name}
                </h2>
                <button onClick={() => setDetailBed(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-[var(--color-text-muted)]">Type</span>
                    <p className="font-medium">
                      {t(`bedManagement.${BED_TYPE_LABELS[detailBed.bed_type] ?? detailBed.bed_type}`, {
                        defaultValue: BED_TYPE_DEFAULT_LABELS[detailBed.bed_type] ?? detailBed.bed_type,
                      })}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-muted)]">Floor</span>
                    <p className="font-medium">{detailBed.floor || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-muted)]">Rate</span>
                    <p className="font-medium">৳{Number(detailBed.effective_rate ?? detailBed.rate_per_day ?? 0).toLocaleString()}/day</p>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-muted)]">Status</span>
                    <p className="font-medium capitalize">{detailBed.status}</p>
                  </div>
                </div>

                {detailBed.status === 'occupied' && detailBed.patient_name && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-blue-700">
                        <User className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-blue-800 font-semibold truncate">{detailBed.patient_name}</p>
                        <p className="text-blue-600 text-xs">
                          {detailBed.patient_code || 'No ID'}{detailBed.patient_age ? ` · ${detailBed.patient_age}Y` : ''}{detailBed.patient_gender ? ` · ${detailBed.patient_gender}` : ''}{detailBed.patient_blood_group ? ` · ${detailBed.patient_blood_group}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-blue-700">
                      <span>Mobile: {detailBed.patient_mobile || '—'}</span>
                      <span>Doctor: {detailBed.doctor_name || '—'}</span>
                      <span>Admitted: {detailBed.admission_date ? new Date(detailBed.admission_date).toLocaleDateString() : '—'}</span>
                      <span>Admission: {detailBed.admission_no || '—'}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {detailBed.discharge_initiated ? <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-[11px]">Discharge initiated</span> : null}
                      {detailBed.discharge_approved ? <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px]">Discharge approved</span> : null}
                    </div>
                  </div>
                )}

                {Number(detailBed.equipment_issue_count ?? 0) > 0 && detailBed.status !== 'maintenance' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <p className="font-semibold">Equipment issue detected</p>
                        <p className="text-xs text-amber-700">This bed has {Number(detailBed.equipment_issue_count)} faulty/missing/maintenance equipment item(s). Consider marking the bed under maintenance until resolved.</p>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary text-xs py-1.5 whitespace-nowrap"
                        disabled={quickStatusMutation.isPending || !(detailBed.id ?? detailBed.bed_id)}
                        onClick={() => {
                          const bedId = detailBed.id ?? detailBed.bed_id;
                          if (!bedId) return;
                          quickStatusMutation.mutate({ bedId, status: 'maintenance' });
                          setDetailBed({ ...detailBed, status: 'maintenance' });
                        }}
                      >
                        <Wrench className="w-3 h-3" /> Mark bed maintenance
                      </button>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-[var(--color-text)]">Bed Timeline</h3>
                    <span className="text-xs text-[var(--color-text-muted)]">{commandDetailData?.maintenanceLogs?.length ?? 0} maintenance logs</span>
                  </div>
                  <div className="space-y-2">
                    {(commandDetailData?.timeline ?? []).slice(0, 6).length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)]">No timeline activity yet.</p>
                    ) : (commandDetailData?.timeline ?? []).slice(0, 6).map((item, index) => (
                      <div key={`${item.label}-${index}`} className="flex gap-2 text-xs">
                        <span className={`mt-1.5 h-2 w-2 rounded-full ${item.type === 'maintenance' ? 'bg-amber-500' : item.type === 'housekeeping' ? 'bg-sky-500' : 'bg-[var(--color-primary)]'}`} />
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--color-text)] truncate">{item.label}</p>
                          <div className="flex flex-wrap items-center gap-2 text-[var(--color-text-muted)]">
                            <span>{item.at ? new Date(item.at).toLocaleString() : '—'}</span>
                            {item.type === 'maintenance' && (
                              <Link to={`${basePath}/asset-management?tab=maintenance&log=${item.reference_id ?? ''}`} className="text-[var(--color-primary)] hover:underline">
                                Open maintenance
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="label mb-0">Room Assets / Bedside Equipment</label>
                    <button
                      type="button"
                      className="btn-secondary text-xs py-1.5"
                      onClick={() => setBedEquipmentRows(rows => [...rows, { equipment_name: 'Oxygen Outlet', required_qty: 1, status: 'available', notes: '' }])}
                    >
                      Add Equipment
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {['Oxygen Outlet', 'Patient Monitor', 'Suction', 'Infusion Pump', 'Wheelchair', 'AC', 'Attached Bathroom', 'TV'].map(name => (
                      <button
                        key={name}
                        type="button"
                        className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[11px] hover:bg-[var(--color-bg)]"
                        onClick={() => setBedEquipmentRows(rows => rows.some(item => item.equipment_name === name) ? rows : [...rows, { equipment_name: name, required_qty: 1, status: 'available', notes: '' }])}
                      >
                        + {name}
                      </button>
                    ))}
                  </div>
                  <input
                    className="input text-sm"
                    value={assetSearchTerm}
                    onChange={e => setAssetSearchTerm(e.target.value)}
                    placeholder="Search inventory asset by name, barcode or serial..."
                  />
                  <div className="space-y-2">
                    {bedEquipmentRows.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)]">No real equipment mapped yet. Add oxygen, monitor, suction or other bedside assets.</p>
                    ) : bedEquipmentRows.map((item, index) => (
                      <div key={`${item.id ?? 'new'}-${index}`} className="grid grid-cols-12 gap-2 rounded-lg bg-[var(--color-bg)] p-2">
                        <select
                          className="input col-span-12 text-sm"
                          value={item.fixed_asset_stock_id ?? ''}
                          onChange={e => applyAssetToEquipmentRow(index, Number(e.target.value))}
                        >
                          <option value="">Select inventory asset...</option>
                          {assetOptions.map(asset => (
                            <option key={asset.FixedAssetStockId} value={asset.FixedAssetStockId}>{formatAssetLabel(asset)}</option>
                          ))}
                        </select>
                        {item.fixed_asset_stock_id && (
                          <div className="col-span-12 text-[11px] text-[var(--color-text-muted)]">
                            Linked asset: {item.asset_name || item.equipment_name}{item.asset_barcode ? ` · ${item.asset_barcode}` : ''}{item.asset_serial ? ` · ${item.asset_serial}` : ''}
                          </div>
                        )}
                        <input
                          className="input col-span-12 md:col-span-4 text-sm"
                          value={item.equipment_name}
                          onChange={e => setBedEquipmentRows(rows => rows.map((row, i) => i === index ? { ...row, equipment_name: e.target.value } : row))}
                          placeholder="Equipment name"
                        />
                        <input
                          className="input col-span-4 md:col-span-2 text-sm"
                          type="number"
                          min={1}
                          value={item.required_qty ?? 1}
                          onChange={e => setBedEquipmentRows(rows => rows.map((row, i) => i === index ? { ...row, required_qty: Number(e.target.value) || 1 } : row))}
                        />
                        <select
                          className="input col-span-8 md:col-span-3 text-sm"
                          value={item.status}
                          onChange={e => setBedEquipmentRows(rows => rows.map((row, i) => i === index ? { ...row, status: e.target.value as BedEquipment['status'] } : row))}
                        >
                          <option value="available">Available</option>
                          <option value="in_use">In Use</option>
                          <option value="faulty">Faulty</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="missing">Missing</option>
                        </select>
                        <input
                          className="input col-span-10 md:col-span-2 text-sm"
                          value={item.notes ?? ''}
                          onChange={e => setBedEquipmentRows(rows => rows.map((row, i) => i === index ? { ...row, notes: e.target.value } : row))}
                          placeholder="Notes"
                        />
                        <button
                          type="button"
                          className="col-span-2 md:col-span-1 rounded-lg text-red-500 hover:bg-red-50 flex items-center justify-center"
                          onClick={() => setBedEquipmentRows(rows => rows.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {(item.status === 'faulty' || item.status === 'maintenance') && (
                          <button
                            type="button"
                            className="col-span-12 btn-secondary justify-center text-xs py-1.5"
                            disabled={logEquipmentMaintenanceMutation.isPending || !item.fixed_asset_stock_id}
                            onClick={() => handleLogEquipmentMaintenance(item)}
                          >
                            <Wrench className="w-3 h-3" /> Log maintenance ticket
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={saveEquipmentMutation.isPending}
                      onClick={() => saveEquipmentMutation.mutate({ equipment: bedEquipmentRows.filter(item => item.equipment_name.trim()) })}
                    >
                      {saveEquipmentMutation.isPending ? 'Saving...' : 'Save Equipment'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label mb-2">Features</label>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {selectedFeatureIds.length === 0 && (
                      <span className="text-xs text-[var(--color-text-muted)]">No features assigned</span>
                    )}
                    {selectedFeatureIds.map(fid => {
                      const feat = allFeatures.find(f => f.id === fid);
                      return feat ? (
                        <span key={fid} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-2 py-0.5 text-xs font-medium">
                          {feat.name}
                          <button type="button" onClick={() => setSelectedFeatureIds(ids => ids.filter(id => id !== fid))}
                            className="hover:text-red-500">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ) : null;
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <select className="input flex-1" onChange={e => {
                      const id = Number(e.target.value);
                      if (id && !selectedFeatureIds.includes(id)) {
                        setSelectedFeatureIds(ids => [...ids, id]);
                      }
                      e.target.value = '';
                    }}>
                      <option value="">Add feature...</option>
                      {allFeatures.filter(f => !selectedFeatureIds.includes(f.id)).map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 pb-5">
                <button onClick={() => setDetailBed(null)} className="btn-secondary">Close</button>
                <button onClick={handleAssignFeatures} disabled={assignFeaturesMutation.isPending} className="btn-primary">
                  {assignFeaturesMutation.isPending ? 'Saving...' : 'Save Features'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
      <HelpPanel pageKey="ipd" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </DashboardLayout>
  );
}

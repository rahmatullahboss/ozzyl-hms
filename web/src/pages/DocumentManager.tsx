import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Plus, X, Download, Search, Filter, Upload, FlaskConical, Camera, ArrowRight, FileText, File, Lock, AlertCircle, RefreshCw, Tag } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getToken } from '../hooks/useAuth';
import { getTenantSlugFromPath } from '../hooks/useTenantSlug';
import { formatDisplayDate } from '../lib/date-utils';

/* ── Types ── */
interface Document {
  id: number;
  patient_id: number;
  patient_name: string;
  document_type: string;
  title: string;
  description?: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  tags?: string[];
  is_confidential: boolean;
  uploaded_by: string;
  created_at: string;
}

interface Patient {
  id: number;
  name: string;
  patient_id_display?: string;
}

interface DocumentSummary {
  type: string;
  count: number;
}

const DOCUMENT_TYPES = ['lab_report', 'imaging', 'referral', 'prescription', 'discharge_summary', 'consent', 'insurance', 'operative_note', 'progress_note', 'other'];

/* ── Helpers ── */
function typeIcon(type: string) {
  const map: Record<string, React.ReactNode> = {
    lab_report: <FlaskConical className="w-4 h-4 text-purple-500" />,
    imaging: <Camera className="w-4 h-4 text-blue-500" />,
    referral: <ArrowRight className="w-4 h-4 text-orange-500" />,
    prescription: <FileText className="w-4 h-4 text-teal-500" />,
    discharge_summary: <FileText className="w-4 h-4 text-emerald-500" />,
    consent: <FileText className="w-4 h-4 text-green-500" />,
    insurance: <File className="w-4 h-4 text-amber-500" />,
    operative_note: <FileText className="w-4 h-4 text-red-500" />,
    progress_note: <FileText className="w-4 h-4 text-cyan-500" />,
  };
  return map[type] ?? <File className="w-4 h-4 text-gray-500" />;
}

function typeLabel(type: string, t: any) {
  return t(`types.${type}`, { defaultValue: type.replace(/_/g, ' ') });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(4)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Upload helpers ── */
async function uploadDocument(formData: FormData): Promise<unknown> {
  const token = getToken();
  const slug = getTenantSlugFromPath();

  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(slug ? { 'X-Tenant-Subdomain': slug } : {}),
    // Do NOT set Content-Type — browser sets multipart boundary automatically
  };

  const res = await fetch('/api/documents', {
    method: 'POST',
    headers,
    body: formData,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg =
      (data as { error?: string })?.error ??
      (data as { message?: string })?.message ??
      'Upload failed';
    throw new Error(errMsg);
  }

  return data;
}

/* ── Upload Modal ── */
function UploadModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['documents', 'common']);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    patient_id: '', document_type: 'lab_report', title: '', description: '', tags: '', is_confidential: false,
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const { data: patientsRaw } = useApiQuery<{ data?: Patient[] } | Patient[]>(
    queryKeys.patients.list({ limit: 200 }),
    '/api/patients?limit=200',
  );
  const patients: Patient[] = Array.isArray(patientsRaw)
    ? patientsRaw
    : (patientsRaw as { data?: Patient[] })?.data ?? [];

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => uploadDocument(formData),
    onSuccess: () => {
      toast.success(t('uploadSuccess'));
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message || t('uploadFailed'));
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { toast.error(t('selectFile')); return; }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('patient_id', form.patient_id);
    formData.append('document_type', form.document_type);
    formData.append('title', form.title);
    formData.append('description', form.description);
    formData.append('tags', form.tags);
    formData.append('is_confidential', String(form.is_confidential));
    uploadMutation.mutate(formData);
  };

  return (
    <Modal title={t('uploadDocument')} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Drag-drop zone */}
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragging ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'}`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 mx-auto mb-2 text-[var(--color-text-muted)]" />
          {file ? (
            <div>
              <p className="font-medium text-sm">{file.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{formatFileSize(file.size)}</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">{t('dropFile')}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('fileSupport')}</p>
            </div>
          )}
          <input ref={fileInputRef} type="file" className="hidden" onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('table.patient')}</label>
            <select className="input" required value={form.patient_id} onChange={e => set('patient_id', e.target.value)}>
              <option value="">{t('selectPatient')}</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.name} {p.patient_id_display ? `(${p.patient_id_display})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('documentType')}</label>
            <select className="input" value={form.document_type} onChange={e => set('document_type', e.target.value)}>
              {DOCUMENT_TYPES.map(dt => <option key={dt} value={dt}>{typeLabel(dt, t)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">{t('table.title')}</label>
          <input className="input" required value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('table.title')} />
        </div>
        <div>
          <label className="label">{t('description')}</label>
          <textarea className="input min-h-[60px]" value={form.description} onChange={e => set('description', e.target.value)} placeholder={t('descriptionPlaceholder')} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('tags')}</label>
            <input className="input" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder={t('tagsPlaceholder')} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_confidential} onChange={e => set('is_confidential', e.target.checked)} className="rounded" />
              <Lock className="w-4 h-4 text-amber-500" />
              <span className="text-sm">{t('confidential')}</span>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common:cancel')}</button>
          <button type="submit" disabled={uploadMutation.isPending} className="btn-primary">{uploadMutation.isPending ? t('common:saving') : t('upload')}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Sidebar ── */
function DocumentSidebar({ patientId }: { patientId: string }) {
  const { t } = useTranslation(['documents', 'common']);
  const { data: summaryRaw, isLoading: loading } = useApiQuery<{ data?: DocumentSummary[] } | DocumentSummary[]>(
    queryKeys.documents.summary(patientId),
    `/api/documents/summary/${patientId}`,
    { enabled: !!patientId },
  );
  const summary: DocumentSummary[] = Array.isArray(summaryRaw)
    ? summaryRaw
    : (summaryRaw as { data?: DocumentSummary[] })?.data ?? [];

  if (!patientId) return null;

  return (
    <div className="card p-4 space-y-3">
      <h3 className="font-semibold text-sm">{t('documentSummary')}</h3>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-6 rounded" />)}</div>
      ) : summary.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{t('noDocsPatient')}</p>
      ) : (
        <div className="space-y-1">
          {summary.map(s => (
            <div key={s.type} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[var(--color-border-light)]">
              <div className="flex items-center gap-2">
                {typeIcon(s.type)}
                <span className="text-sm capitalize">{typeLabel(s.type, t)}</span>
              </div>
              <span className="font-data text-sm font-semibold">{s.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Build URL with query params ── */
function buildDocumentsUrl(filters: {
  search: string;
  type: string;
  patient: string;
  dateFrom: string;
  dateTo: string;
}): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.type !== 'all') params.set('document_type', filters.type);
  if (filters.patient) params.set('patient_id', filters.patient);
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  const qs = params.toString();
  return qs ? `/api/documents?${qs}` : '/api/documents';
}

/* ── Main Page ── */
export default function DocumentManager({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['documents', 'common']);
  const [showUpload, setShowUpload] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterPatient, setFilterPatient] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = { search: searchQuery, type: filterType, patient: filterPatient, dateFrom, dateTo };
  const url = buildDocumentsUrl(filters);

  const { data: docsRaw, isLoading: loading, isError, refetch } = useApiQuery<{ data?: Document[] } | Document[]>(
    queryKeys.documents.list(filters),
    url,
  );
  const documents: Document[] = Array.isArray(docsRaw)
    ? docsRaw
    : (docsRaw as { data?: Document[] })?.data ?? [];

  const error = isError ? t('loadFailed') : null;

  const handleDownload = (id: number) => {
    window.open(`/api/documents/${id}/download`, '_blank');
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <FolderOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input className="input pl-9" placeholder={t('searchPlaceholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
            <select className="input w-auto" value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="all">{t('allTypes')}</option>
              {DOCUMENT_TYPES.map(dt => <option key={dt} value={dt}>{typeLabel(dt, t)}</option>)}
            </select>
            <input type="date" className="input w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title={t('fromDate')} />
            <input type="date" className="input w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} title={t('toDate')} />
          </div>
          <button onClick={() => setShowUpload(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('upload')}</button>
        </div>

        {/* Content */}
        <div className="flex flex-col lg:flex-row gap-5">
          <div className={`${filterPatient ? 'lg:w-3/4' : 'w-full'} space-y-4`}>
            {error ? (
              <div className="card p-8 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-[var(--color-text-secondary)] mb-3">{error}</p>
                <button onClick={() => refetch()} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('common:retry')}</button>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th></th>
                        <th>{t('table.title')}</th>
                        <th className="hidden sm:table-cell">{t('table.patient')}</th>
                        <th className="hidden md:table-cell">{t('table.type')}</th>
                        <th className="hidden lg:table-cell">{t('table.size')}</th>
                        <th className="hidden md:table-cell">{t('table.date')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? <SkeletonRows cols={7} />
                        : documents.length === 0 ? (
                          <tr><td colSpan={7}>
                            <EmptyState
                              icon={<FolderOpen className="w-8 h-8 text-[var(--color-text-muted)]" />}
                              title={t('noDocsFound')}
                              description={t('noDocsDescription')}
                              action={<button onClick={() => setShowUpload(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('uploadDocument')}</button>}
                            />
                          </td></tr>
                        ) : documents.map(doc => (
                          <tr key={doc.id} className="hover:bg-[var(--color-border-light)]" onClick={() => setFilterPatient(String(doc.patient_id))}>
                            <td className="w-8">{typeIcon(doc.document_type)}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{doc.title}</span>
                                {doc.is_confidential && <Lock className="w-3.5 h-3.5 text-amber-500" />}
                              </div>
                              {doc.tags && doc.tags.length > 0 && (
                                <div className="flex gap-1 mt-1">
                                  {doc.tags.slice(0, 3).map(tag => (
                                    <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-full bg-[var(--color-border-light)] text-[var(--color-text-muted)]">
                                      <Tag className="w-2.5 h-2.5" />{tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="hidden sm:table-cell text-sm">{doc.patient_name}</td>
                            <td className="hidden md:table-cell capitalize text-sm">{typeLabel(doc.document_type, t)}</td>
                            <td className="hidden lg:table-cell font-data text-sm">{formatFileSize(doc.file_size)}</td>
                            <td className="hidden md:table-cell text-sm text-[var(--color-text-secondary)] whitespace-nowrap">{formatDisplayDate(doc.created_at)}</td>
                            <td>
                              <button onClick={e => { e.stopPropagation(); handleDownload(doc.id); }} className="btn-ghost p-1.5" title="Download">
                                <Download className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          {filterPatient && (
            <div className="lg:w-1/4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">{t('patientDocuments')}</h3>
                <button onClick={() => setFilterPatient('')} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
              </div>
              <DocumentSidebar patientId={filterPatient} />
            </div>
          )}
        </div>

        {/* Modal */}
        {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
      </div>
    </DashboardLayout>
  );
}

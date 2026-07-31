import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, File as FileIcon, FileText, Image as ImageIcon, Loader2, Pencil, Plus, ScanLine, ShieldCheck, Trash2, UploadCloud, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { compressImage } from '../../lib/compressImage';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';
import {
  patientPortalQueryKeys,
  type PatientVaultDocument as VaultDocument,
  useDeletePatientVaultDocumentMutation,
  usePatientVaultQuery,
} from '../../hooks/patient-portal/usePatientPortalQueries';
import { DocumentScanner } from './DocumentScanner';

interface VaultUploadResponse {
  success?: boolean;
  document?: VaultDocument;
  medication_import?: {
    status?: string;
    extracted_count?: number;
    medications?: string[];
  };
}

export default function PatientVaultTab() {
  const { t } = useTranslation('patients');
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [editingDocument, setEditingDocument] = useState<VaultDocument | null>(null);
  const [uploadMode, setUploadMode] = useState<'file' | 'link'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const vaultQuery = usePatientVaultQuery();
  const deleteDocumentMutation = useDeletePatientVaultDocumentMutation();
  const documents = vaultQuery.data?.documents ?? [];
  const loading = vaultQuery.isLoading;

  // Form state
  const [uploadForm, setUploadForm] = useState({
    title: '',
    document_type: 'prescription',
    document_date: new Date().toISOString().split('T')[0],
    notes: '',
    documentUrl: '',
  });

  function resetUploadState() {
    setUploadMode('file');
    setSelectedFile(null);
    setEditingDocument(null);
    setUploadForm({
      title: '',
      document_type: 'prescription',
      document_date: new Date().toISOString().split('T')[0],
      notes: '',
      documentUrl: '',
    });
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadForm.title.trim()) {
      toast.error(t('vault.errors.documentNameRequired'));
      return;
    }

    setIsUploading(true);
    try {
      let response: Response;
      const isEditing = Boolean(editingDocument);
      const editingDocumentId = editingDocument?.id;

      if (isEditing && uploadMode === 'link' && !selectedFile) {
        if (!editingDocumentId) throw new Error(t('vault.errors.documentNotFound'));
        const payload = {
          title: uploadForm.title.trim(),
          document_type: uploadForm.document_type,
          document_date: uploadForm.document_date || null,
          notes: uploadForm.notes || null,
          ...(editingDocument?.source_kind === 'external_link' && uploadForm.documentUrl.trim()
            ? { document_url: uploadForm.documentUrl.trim() }
            : {}),
        };

        response = await fetch(`/api/patient-phr/vault/${editingDocumentId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else if (uploadMode === 'file') {
        if (!selectedFile) {
          toast.error(t('vault.errors.selectFile'));
          return;
        }

        const isImage = selectedFile.type.startsWith('image/');
        const processedBlob = isImage ? await compressImage(selectedFile, 1600, 0.82) : selectedFile;
        const outputName = isImage && processedBlob.type === 'image/webp'
          ? selectedFile.name.replace(/\.[^.]+$/, '') + '.webp'
          : selectedFile.name;

        const formData = new FormData();
        formData.append('file', processedBlob, outputName);
        formData.append('title', uploadForm.title.trim());
        formData.append('document_type', uploadForm.document_type);
        if (uploadForm.document_date) formData.append('document_date', uploadForm.document_date);
        if (uploadForm.notes) formData.append('notes', uploadForm.notes);

        if (isEditing && !editingDocumentId) throw new Error(t('vault.errors.documentNotFound'));
        response = await fetch(isEditing ? `/api/patient-phr/vault/${editingDocumentId}/replace` : '/api/patient-phr/vault/upload', {
          method: isEditing ? 'POST' : 'POST',
          credentials: 'include',
          body: formData,
        });
      } else {
        if (!uploadForm.documentUrl.trim()) {
          toast.error(t('vault.errors.documentLinkRequired'));
          return;
        }

        const payload = {
          document_url: uploadForm.documentUrl.trim(),
          document_type: uploadForm.document_type,
          document_date: uploadForm.document_date || null,
          title: uploadForm.title,
          notes: uploadForm.notes || null,
        };

        if (isEditing && !editingDocumentId) throw new Error(t('vault.errors.documentNotFound'));
        response = await fetch(isEditing ? `/api/patient-phr/vault/${editingDocumentId}/replace` : '/api/patient-phr/vault', {
          method: isEditing ? 'POST' : 'POST',
          credentials: 'include',
          headers: isEditing ? undefined : { 'Content-Type': 'application/json' },
          body: isEditing
            ? (() => {
              const formData = new FormData();
              formData.append('title', uploadForm.title.trim());
              formData.append('document_type', uploadForm.document_type);
              if (uploadForm.document_date) formData.append('document_date', uploadForm.document_date);
              if (uploadForm.notes) formData.append('notes', uploadForm.notes);
              formData.append('document_url', uploadForm.documentUrl.trim());
              return formData;
            })()
            : JSON.stringify(payload),
        });
      }

      if (!response.ok) throw new Error(t('vault.errors.uploadFailed'));

      const payload = await response.json().catch(() => ({})) as VaultUploadResponse;
      toast.success(isEditing ? t('toast.success.documentUpdated') : t('toast.success.documentUploaded'));
      if ((payload.medication_import?.status === 'imported') && (payload.medication_import.extracted_count ?? 0) > 0) {
        toast.success(`প্রেসক্রিপশন থেকে ${payload.medication_import.extracted_count}টি ওষুধ বর্তমান ওষুধ তালিকায় যোগ হয়েছে`);
      }

      await queryClient.invalidateQueries({ queryKey: patientPortalQueryKeys.vault });
      setShowUploadModal(false);
      resetUploadState();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.error.upload'));
    } finally {
      setIsUploading(false);
    }
  }

  function getIconForType(type: string) {
    switch (type) {
      case 'prescription':
        return <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />;
      case 'lab_report':
        return <FileIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" />;
      case 'discharge_summary':
      case 'scan':
      default:
        return <ImageIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
    }
  }

  function formatFileSize(fileSize: number | null | undefined) {
    if (!fileSize || fileSize <= 0) return '';
    if (fileSize >= 1024 * 1024) return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
    if (fileSize >= 1024) return `${Math.round(fileSize / 1024)} KB`;
    return `${fileSize} B`;
  }

  function isPreviewableImage(doc: VaultDocument) {
    return Boolean(doc.mime_type?.startsWith('image/'));
  }

  function openEditModal(doc: VaultDocument) {
    setEditingDocument(doc);
    setUploadMode(doc.source_kind === 'external_link' ? 'link' : 'file');
    setSelectedFile(null);
    setUploadForm({
      title: doc.title || '',
      document_type: doc.document_type || 'prescription',
      document_date: doc.document_date ? new Date(doc.document_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      notes: doc.notes || '',
      documentUrl: doc.source_kind === 'external_link' ? doc.document_url : '',
    });
    setShowUploadModal(true);
  }

  async function handleDelete(doc: VaultDocument) {
    if (!window.confirm(t('vault.confirmDelete'))) return;
    try {
      await deleteDocumentMutation.mutateAsync(doc.id);
      toast.success(t('toast.success.documentDeleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.error.delete'));
    }
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {/* Header and Upload Drop-zone */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-10 bg-white dark:bg-slate-900 rounded-3xl border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-center group hover:border-cyan-500 transition-colors cursor-pointer" onClick={() => { resetUploadState(); setShowUploadModal(true); }}>
          <div className="w-16 h-16 rounded-full bg-cyan-50 dark:bg-cyan-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <UploadCloud className="w-8 h-8 text-cyan-600 dark:text-cyan-400" />
          </div>
          <h3 className="font-bold text-xl mb-1 text-slate-900 dark:text-white">{t('vault.uploadDocument')}</h3>
          <p className="text-slate-500 text-sm mb-6 max-w-xs">{t('vault.uploadDescription')}</p>
          <button className="px-8 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-sm font-semibold hover:bg-cyan-600 hover:text-white dark:hover:bg-cyan-600 hover:border-cyan-600 transition-all text-slate-700 dark:text-slate-300">
            {t('vault.uploadFiles')}
          </button>
        </div>
        <div className="p-10 bg-white dark:bg-slate-900 rounded-3xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 flex flex-col items-center justify-center text-center group hover:border-indigo-500 transition-colors cursor-pointer" onClick={() => setShowScanner(true)}>
          <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <ScanLine className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="font-bold text-xl mb-1 text-slate-900 dark:text-white">Scan Document</h3>
          <p className="text-slate-500 text-sm mb-6 max-w-xs">Use your camera to scan prescriptions, lab reports, or discharge summaries.</p>
          <button className="px-8 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-sm font-semibold hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 hover:border-indigo-600 transition-all text-slate-700 dark:text-slate-300">
            Open Scanner
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-600" />
          <p className="mt-4 text-slate-500 dark:text-slate-400 font-medium">{t('common.loading')}</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-slate-50 dark:bg-slate-900/50 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <FileIcon className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('vault.emptyTitle')}</h3>
          <p className="mt-1 text-slate-500 dark:text-slate-400 text-center max-w-sm">
            {t('vault.emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {documents.map((doc) => (
            <div key={doc.id} className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-md p-4 rounded-[1.5rem] border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-cyan-100 dark:hover:shadow-cyan-900/20 transition-all flex flex-col gap-4">
              <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center relative group/img">
                {isPreviewableImage(doc) ? (
                  <img src={doc.document_url} alt={doc.title || t('vault.previewAlt')} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                    <FileText className="w-12 h-12 opacity-50" />
                  </div>
                )}
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity">
                  <button onClick={() => openEditModal(doc)} className="w-8 h-8 rounded-full bg-white/90 shadow text-slate-600 hover:text-cyan-600 flex items-center justify-center backdrop-blur-sm">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => void handleDelete(doc)} className="w-8 h-8 rounded-full bg-white/90 shadow text-slate-600 hover:text-rose-600 flex items-center justify-center backdrop-blur-sm">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 relative">
                <div className="flex justify-between items-start">
                  <h4 className="font-bold text-slate-900 dark:text-white line-clamp-1 flex-1 pr-2" title={doc.title || t('vault.untitledDocument')}>{doc.title || t('vault.untitledDocument')}</h4>
                  <a href={doc.document_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-cyan-600 transition flex-shrink-0">
                    <Download className="w-5 h-5" />
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-300 text-[10px] font-bold uppercase tracking-wider">
                    {doc.document_type.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {doc.document_date ? formatPatientDateMonthYear(doc.document_date) : ''}
                  </span>
                </div>
                {(doc.source_kind === 'uploaded_file' || doc.source_kind === 'external_link') ? (
                  <div className="mt-1 flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-teal-50 dark:bg-teal-500/10 w-fit">
                    <ShieldCheck className="text-teal-600 dark:text-teal-400 w-4 h-4" />
                    <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-300">{t('vault.securelyStored')}</span>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 w-fit">
                    <ShieldCheck className="text-emerald-600 dark:text-emerald-400 w-4 h-4" />
                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{t('vault.verifiedByDoctor')}</span>
                  </div>
                )}
                {doc.notes && <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-2 mt-1">{doc.notes}</p>}
                {(doc.file_size || doc.file_name) && (
                   <p className="text-[10px] text-slate-400 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                     {[formatFileSize(doc.file_size), doc.file_name?.split('.').pop()?.toUpperCase() || ''].filter(Boolean).join(' • ')}
                   </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Document Scanner Modal */}
      <DocumentScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onUploaded={() => {
          queryClient.invalidateQueries({ queryKey: patientPortalQueryKeys.vault });
          setShowScanner(false);
        }}
      />

      {/* Upload Modal UI */}
      {showUploadModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowUploadModal(false)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-xl font-bold font-headline text-slate-900">{editingDocument ? t('vault.updateDocument') : t('vault.uploadNewDocument')}</h3>
              <button onClick={() => { setShowUploadModal(false); resetUploadState(); }} className="text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-2 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUploadSubmit} className="p-6 space-y-4">
              <div className="rounded-2xl border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50/80 dark:bg-cyan-950/20 px-4 py-3">
                <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">{t('vault.secureVaultTitle')}</p>
                <p className="mt-1 text-xs text-cyan-700 dark:text-cyan-300">
                  {t('vault.secureVaultDescription')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUploadMode('file')}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${uploadMode === 'file' ? 'border-cyan-400 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
                >
                  <p className="text-sm font-semibold">{t('vault.fileUpload')}</p>
                  <p className="mt-1 text-xs">{t('vault.fileUploadDescription')}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('link')}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${uploadMode === 'link' ? 'border-cyan-400 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
                >
                  <p className="text-sm font-semibold">{t('vault.secureLink')}</p>
                  <p className="mt-1 text-xs">{t('vault.secureLinkDescription')}</p>
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('vault.documentName')} <span className="text-rose-500">*</span></label>
                <input
                  required
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                  placeholder={t('placeholders.documentName')}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                />
              </div>

              {uploadMode === 'file' ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('vault.file')} <span className="text-rose-500">*</span></label>
                  <input
                    required={uploadMode === 'file' && !editingDocument}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                  />
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                    {selectedFile ? (
                      <span>
                        {selectedFile.name} &middot; {formatFileSize(selectedFile.size)}{selectedFile.type.startsWith('image/') ? t('vault.imageCompressNote') : ''}
                      </span>
                    ) : (
                      <span>{editingDocument ? t('vault.replaceFileNote') : t('vault.uploadFormatsNote')}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('vault.documentLink')} <span className="text-rose-500">*</span></label>
                  <input
                    required={uploadMode === 'link'}
                    type="url"
                    value={uploadForm.documentUrl}
                    onChange={(e) => setUploadForm({ ...uploadForm, documentUrl: e.target.value })}
                    placeholder={t('placeholders.documentLink')}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('vault.category')}</label>
                  <select
                    value={uploadForm.document_type}
                    onChange={(e) => setUploadForm({ ...uploadForm, document_type: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                  >
                    <option value="prescription">{t('categories.prescription')}</option>
                    <option value="lab_report">{t('categories.labReport')}</option>
                    <option value="discharge_summary">{t('categories.dischargeSummary')}</option>
                    <option value="scan">{t('categories.scan')}</option>
                    <option value="other">{t('categories.other')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('vault.date')}</label>
                  <input
                    type="date"
                    value={uploadForm.document_date}
                    onChange={(e) => setUploadForm({ ...uploadForm, document_date: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('vault.notesOptional')}</label>
                <textarea
                  rows={2}
                  value={uploadForm.notes}
                  onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                  placeholder={t('placeholders.notes')}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-semibold text-sm shadow-lg shadow-cyan-500/20 hover:opacity-95 transition disabled:opacity-70"
                >
                  {isUploading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isUploading ? (editingDocument ? t('vault.updating') : t('vault.uploading')) : (editingDocument ? t('vault.update') : t('vault.save'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

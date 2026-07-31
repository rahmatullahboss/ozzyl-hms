import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download, Upload, FileSpreadsheet, Users, Receipt, FlaskConical,
  Pill, CheckCircle, AlertTriangle, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiMutation, useQueryClient } from '../hooks/useApiQuery';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

// ─── Reusable Components ────────────────────────────────────────────────────────

function Section({ icon, title, desc, children }: {
  icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-md bg-[var(--color-primary-light)] flex items-center justify-center">
          <span className="text-[var(--color-primary)]">{icon}</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
          {desc && <p className="text-xs text-[var(--color-text-muted)]">{desc}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ImportCard({ title, icon, uploadId, onImport, onDownloadSample, importing }: {
  title: string; icon: React.ReactNode; uploadId: string;
  onImport: (file: File) => void; onDownloadSample: () => void; importing?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleImport = () => {
    if (selectedFile) {
      onImport(selectedFile);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-4 p-4 bg-[var(--color-border-light)] rounded-xl">
      <div className="w-10 h-10 rounded-lg bg-[var(--color-primary-light)] flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>
        <div className="flex items-center gap-2 mt-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
            aria-label={`Upload ${title}`} onChange={handleFileChange} className="hidden" id={uploadId} />
          <label htmlFor={uploadId}
            className="btn-secondary text-xs !py-1.5 !px-3 cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Choose File
          </label>
          {selectedFile && (
            <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[150px]">
              {selectedFile.name}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onDownloadSample} className="btn-ghost text-xs !py-1.5 !px-3">
          <Download className="w-3.5 h-3.5" /> Sample
        </button>
        <button onClick={handleImport} disabled={!selectedFile || importing}
          className="btn-primary text-xs !py-1.5 !px-3">
          <Upload className="w-3.5 h-3.5" /> {importing ? 'Importing...' : `Import ${title}`}
        </button>
      </div>
    </div>
  );
}

function ExportCard({ title, icon, onExport, exporting }: {
  title: string; icon: React.ReactNode; onExport: () => void; exporting?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 p-4 bg-[var(--color-border-light)] rounded-xl">
      <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>
      </div>
      <button onClick={onExport} disabled={exporting}
        className="btn-secondary text-xs !py-1.5 !px-3">
        <Download className="w-3.5 h-3.5" /> {exporting ? 'Exporting...' : `Export ${title}`}
      </button>
    </div>
  );
}

function Select({ id, label, value, onChange, options }: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; options: { label: string; value: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} aria-label={label} className="input" value={value}
        onChange={e => onChange(e.target.value)}>
        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function ImportExportSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // ── Import mutations ──
  const importServicesMutation = useApiMutation<ImportResult, FormData>(
    'post',
    '/api/import/services',
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ['services'] });
        setImportResult(data);
        toast.success(`Imported ${data.success} services`);
      },
      onError: () => toast.error('Failed to import services'),
    },
  );

  const importMedicinesMutation = useApiMutation<ImportResult, FormData>(
    'post',
    '/api/import/medicines',
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ['medicines'] });
        setImportResult(data);
        toast.success(`Imported ${data.success} medicines`);
      },
      onError: () => toast.error('Failed to import medicines'),
    },
  );

  const importPatientsMutation = useApiMutation<ImportResult, FormData>(
    'post',
    '/api/import/patients',
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ['patients'] });
        setImportResult(data);
        toast.success(`Imported ${data.success} patients`);
      },
      onError: () => toast.error('Failed to import patients'),
    },
  );

  // ── Export mutations ──
  const exportPatientsMutation = useApiMutation<Blob, void>(
    'post',
    `/api/export/patients?format=${exportFormat}`,
    {
      onSuccess: (data) => {
        const url = URL.createObjectURL(data as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `patients.${exportFormat}`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Export complete');
      },
      onError: () => toast.error('Export failed'),
    },
  );

  const exportBillingMutation = useApiMutation<Blob, void>(
    'post',
    `/api/export/billing?format=${exportFormat}`,
    {
      onSuccess: (data) => {
        const url = URL.createObjectURL(data as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `billing.${exportFormat}`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Export complete');
      },
      onError: () => toast.error('Export failed'),
    },
  );

  const exportLabMutation = useApiMutation<Blob, void>(
    'post',
    `/api/export/lab?format=${exportFormat}`,
    {
      onSuccess: (data) => {
        const url = URL.createObjectURL(data as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lab-reports.${exportFormat}`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Export complete');
      },
      onError: () => toast.error('Export failed'),
    },
  );

  // ── Handlers ──
  const handleImport = (type: string) => (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    switch (type) {
      case 'services': importServicesMutation.mutate(formData); break;
      case 'medicines': importMedicinesMutation.mutate(formData); break;
      case 'patients': importPatientsMutation.mutate(formData); break;
    }
  };

  const handleDownloadSample = (type: string) => {
    const a = document.createElement('a');
    a.href = `/api/import/${type}/sample`;
    a.download = `${type}_sample.xlsx`;
    a.click();
  };

  return (
    <DashboardLayout role={role}>
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div>
          <h1 className="page-title">Import / Export</h1>
          <p className="section-subtitle mt-1">Bulk import data from Excel or export existing data</p>
        </div>

        {/* ── Import Result Banner ── */}
        {importResult && (
          <div className={`card p-4 flex items-start gap-3 ${importResult.failed > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
            {importResult.failed > 0 ? (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {importResult.success} imported, {importResult.failed} failed
              </p>
              {importResult.errors.length > 0 && (
                <ul className="mt-1 text-xs text-[var(--color-text-muted)] list-disc list-inside">
                  {importResult.errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Import Section ── */}
        <Section icon={<Upload className="w-4 h-4" />} title="Import Data"
          desc="Upload Excel files to bulk import data. Download sample format first.">
          <ImportCard title="Services" icon={<Receipt className="w-5 h-5 text-[var(--color-primary)]" />}
            uploadId="upload-services"
            onImport={handleImport('services')}
            onDownloadSample={() => handleDownloadSample('services')}
            importing={importServicesMutation.isPending} />
          <ImportCard title="Medicines" icon={<Pill className="w-5 h-5 text-[var(--color-primary)]" />}
            uploadId="upload-medicines"
            onImport={handleImport('medicines')}
            onDownloadSample={() => handleDownloadSample('medicines')}
            importing={importMedicinesMutation.isPending} />
          <ImportCard title="Patients" icon={<Users className="w-5 h-5 text-[var(--color-primary)]" />}
            uploadId="upload-patients"
            onImport={handleImport('patients')}
            onDownloadSample={() => handleDownloadSample('patients')}
            importing={importPatientsMutation.isPending} />
        </Section>

        {/* ── Export Section ── */}
        <Section icon={<Download className="w-4 h-4" />} title="Export Data"
          desc="Download your data as Excel or CSV files">
          <div className="max-w-xs">
            <Select id="export-format" label="Export Format" value={exportFormat}
              onChange={setExportFormat}
              options={[
                { label: 'Excel (.xlsx)', value: 'xlsx' },
                { label: 'CSV (.csv)', value: 'csv' },
              ]} />
          </div>
          <ExportCard title="Patients" icon={<Users className="w-5 h-5 text-emerald-600" />}
            onExport={() => exportPatientsMutation.mutate()}
            exporting={exportPatientsMutation.isPending} />
          <ExportCard title="Billing" icon={<Receipt className="w-5 h-5 text-emerald-600" />}
            onExport={() => exportBillingMutation.mutate()}
            exporting={exportBillingMutation.isPending} />
          <ExportCard title="Lab Reports" icon={<FlaskConical className="w-5 h-5 text-emerald-600" />}
            onExport={() => exportLabMutation.mutate()}
            exporting={exportLabMutation.isPending} />
        </Section>
      </div>
    </DashboardLayout>
  );
}

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Download, FileUp, Package, Upload, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation } from '../../hooks/useApiQuery';

export type ImportType = 'items' | 'vendors' | 'opening_stock';

export const ITEM_SAMPLE_CSV = `ItemCode,ItemName,ItemType,GenericName,BrandName,CategoryName,UOMName,StandardRate,PurchasePrice,SalePrice,ReOrderLevel,MinStockQuantity,IsBatchRequired,IsExpiryRequired,IsActive
ITM-001,Gloves (Box of 100),consumable,Nitrile Gloves,,Disposables,Piece,150,120,180,20,10,Yes,Yes,Yes
ITM-002,Syringe 5ml,consumable,,,Disposables,Piece,5,3,8,50,25,Yes,Yes,Yes`;

export const VENDOR_SAMPLE_CSV = `VendorCode,VendorName,ContactPerson,ContactPhone,ContactEmail,City,Country,CreditPeriod,IsActive
VND-001,MedSupply Co.,John Doe,+8801712345678,john@medsupply.com,Dhaka,Bangladesh,30,Yes
VND-002,PharmaCorp,Jane Smith,+8801812345678,jane@pharmacorp.com,Chittagong,Bangladesh,45,Yes`;

export const OPENING_STOCK_SAMPLE_CSV = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,ROCHE
EDTA-TUBE,LAB-STORE,LOT-EDTA-001,BATCH-EDTA-001,2028-01-31,1000,8,LOCAL
GLUCOSE-REAGENT,LAB-STORE,LOT-GLU-001,BATCH-GLU-001,2027-03-31,300,30,MINDRAY`;

export function sampleCsvForInventoryImportType(importType: ImportType): string {
  if (importType === 'items') return ITEM_SAMPLE_CSV;
  if (importType === 'vendors') return VENDOR_SAMPLE_CSV;
  return OPENING_STOCK_SAMPLE_CSV;
}

export function inventoryImportTypeLabel(importType: ImportType, t: (key: string) => string): string {
  if (importType === 'opening_stock') return 'Opening stock';
  return t(`inventory.importExport.${importType}`);
}

interface ImportResult {
  message: string;
  status?: 'validated' | 'posted';
  approvalStatus?: 'preview' | 'posted';
  referenceNo?: string;
  fileHash?: string;
  created: number;
  skipped: number;
  total: number;
  totalStockValue?: number;
  errors: string[];
  warnings?: string[];
  mirroredLabReagents?: number;
  createdStockIds?: number[];
  nextActions?: Array<{ id: string; title: string; href: string }>;
}

export default function InventoryImportExportPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [importType, setImportType] = useState<ImportType>('items');
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importItems = useApiMutation<ImportResult, { csv: string }>('post', '/api/inventory/import-export/import/items', {
    onSuccess: data => { setResult(data); toast.success(t('inventory.importExport.imported.items', { count: data.created })); },
    onError: err => toast.error(err.message),
  });
  const importVendors = useApiMutation<ImportResult, { csv: string }>('post', '/api/inventory/import-export/import/vendors', {
    onSuccess: data => { setResult(data); toast.success(t('inventory.importExport.imported.vendors', { count: data.created })); },
    onError: err => toast.error(err.message),
  });
  const importOpeningStock = useApiMutation<ImportResult, { csv: string }>('post', '/api/inventory/import-export/import/opening-stock', {
    onSuccess: data => { setResult(data); toast.success(`Opening stock imported: ${data.created} lot(s)`); },
    onError: err => toast.error(err.message),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      toast.success(t('inventory.importExport.loaded', { name: file.name, size: (file.size / 1024).toFixed(1) }));
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!csvText.trim()) { toast.error(t('inventory.importExport.errors.csvRequired')); return; }
    setResult(null);
    if (importType === 'items') importItems.mutate({ csv: csvText });
    else if (importType === 'vendors') importVendors.mutate({ csv: csvText });
    else importOpeningStock.mutate({ csv: csvText });
  };

  const isPending = importItems.isPending || importVendors.isPending || importOpeningStock.isPending;

  const downloadExport = (type: string) => {
    window.open(`/api/inventory/import-export/export/${type}`, '_blank');
  };

  const sampleCsvForType = sampleCsvForInventoryImportType(importType);
  const importTypeName = inventoryImportTypeLabel(importType, t);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><FileUp className="w-6 h-6 inline mr-2" />{t('inventory.importExport.title')}</h1>
            <p className="section-subtitle">{t('inventory.importExport.subtitle')}</p>
          </div>
        </div>

        {/* Export Section */}
        <div className="card p-5">
          <h3 className="font-semibold text-lg mb-4"><Download className="w-5 h-5 inline mr-2" />{t('inventory.importExport.export.heading')}</h3>
          <div className="flex flex-wrap gap-3">
            <button className="btn-secondary" onClick={() => downloadExport('items')}><Package className="w-4 h-4" /> {t('inventory.importExport.export.items')}</button>
            <button className="btn-secondary" onClick={() => downloadExport('stock')}><Package className="w-4 h-4" /> {t('inventory.importExport.export.stock')}</button>
            <button className="btn-secondary" onClick={() => downloadExport('vendors')}><Building2 className="w-4 h-4" /> {t('inventory.importExport.export.vendors')}</button>
          </div>
        </div>

        {/* Import Section */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-lg"><Upload className="w-5 h-5 inline mr-2" />{t('inventory.importExport.import.heading')}</h3>

          <div className="flex gap-4 items-center">
            <label className="label">{t('inventory.importExport.import.type')}</label>
            <select className="input w-48" value={importType} onChange={e => { setImportType(e.target.value as ImportType); setCsvText(''); setResult(null); }}>
              <option value="items">{t('inventory.importExport.items')}</option>
              <option value="vendors">{t('inventory.importExport.vendors')}</option>
              <option value="opening_stock">Opening stock</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('inventory.importExport.import.upload')}</label>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="input" />
            </div>
            <div>
              <label className="label">{t('inventory.importExport.import.paste')}</label>
              <textarea className="input h-24 font-mono text-xs" value={csvText} onChange={e => setCsvText(e.target.value)} placeholder={t('inventory.importExport.import.pastePlaceholder')} />
            </div>
          </div>

          <div className="flex gap-3">
            <button className="btn-primary" onClick={handleImport} disabled={isPending || !csvText.trim()}>
              <Upload className="w-4 h-4" /> {isPending ? t('inventory.importExport.import.importing') : t('inventory.importExport.import.importButton', { type: importTypeName })}
            </button>
            <button className="btn-secondary text-xs" onClick={() => setCsvText(sampleCsvForType)}>
              {t('inventory.importExport.import.loadSample')}
            </button>
          </div>

          {result && (
            <div className="p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
              <h4 className="font-semibold mb-2">{t('inventory.importExport.result.heading')}</h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div><span className="text-[var(--color-text-muted)]">{t('inventory.importExport.result.total')}</span> <span className="font-data">{result.total}</span></div>
                <div><span className="text-[var(--color-text-muted)]">{t('inventory.importExport.result.created')}</span> <span className="font-data text-green-600">{result.created}</span></div>
                <div><span className="text-[var(--color-text-muted)]">{t('inventory.importExport.result.skipped')}</span> <span className="font-data text-yellow-600">{result.skipped}</span></div>
                {typeof result.totalStockValue === 'number' && <div><span className="text-[var(--color-text-muted)]">Stock value</span> <span className="font-data">৳{result.totalStockValue.toLocaleString()}</span></div>}
                {result.referenceNo && <div><span className="text-[var(--color-text-muted)]">Opening ref</span> <span className="font-data">{result.referenceNo}</span></div>}
              </div>
              {typeof result.mirroredLabReagents === 'number' && (
                <div className="mt-3 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm text-violet-800">
                  Lab reagent lots mirrored: <span className="font-semibold font-data">{result.mirroredLabReagents}</span>. Review QC before use.
                </div>
              )}
              {result.nextActions && result.nextActions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.nextActions.map(action => <a key={action.id} href={`${base}${action.href}`} className="text-xs rounded-full border border-[var(--color-border)] px-3 py-1 hover:bg-[var(--color-bg-secondary)]">{action.title}</a>)}
                </div>
              )}
              {result.warnings && result.warnings.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm text-amber-600 font-medium">Hospital-grade checklist warnings</p>
                  <ul className="text-xs text-amber-600 list-disc ml-4">{result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm text-red-500 font-medium">{t('inventory.importExport.result.errors')}</p>
                  <ul className="text-xs text-red-400 list-disc ml-4">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* CSV Format Reference */}
        <div className="card p-5">
          <h3 className="font-semibold mb-3">{t('inventory.importExport.format.heading')}</h3>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1">{t('inventory.importExport.format.itemsColumns')}</h4>
              <code className="text-xs bg-[var(--color-surface)] p-2 rounded block overflow-x-auto">
                ItemCode, ItemName, ItemType, GenericName, BrandName, CategoryName, UOMName, StandardRate, PurchasePrice, SalePrice, ReOrderLevel, MinStockQuantity, IsBatchRequired, IsExpiryRequired, IsActive
              </code>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1">{t('inventory.importExport.format.vendorsColumns')}</h4>
              <code className="text-xs bg-[var(--color-surface)] p-2 rounded block overflow-x-auto">
                VendorCode, VendorName, ContactPerson, ContactPhone, ContactEmail, City, Country, CreditPeriod, IsActive
              </code>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1">Opening stock columns</h4>
              <code className="text-xs bg-[var(--color-surface)] p-2 rounded block overflow-x-auto">
                item_code, store_code, lot_number, batch_number, expiry_date, quantity, unit_cost, supplier_code
              </code>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Use this only for initial/onboarding stock. New purchases should use GRN.</p>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('inventory.importExport.format.note')}
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

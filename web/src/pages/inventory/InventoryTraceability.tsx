import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, MapPin, PackageCheck, QrCode, RefreshCw, Search, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { api } from '../../lib/apiClient';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

type LocationRow = {
  LocationId: number;
  LocationCode: string;
  LocationName: string;
  LocationType: string;
  WardId?: number;
  WardName?: string;
  RoomNo?: string;
};

type WardStockRow = {
  id: number;
  item_name: string;
  item_code?: string;
  current_quantity: number;
  min_stock_level: number;
  unit: string;
  LocationName?: string;
  room_no?: string;
  tag_code?: string;
};

type QrEntityType = 'item' | 'stock' | 'store' | 'location' | 'ward_stock' | 'fixed_asset' | 'purchase_order' | 'goods_receipt';

export default function InventoryTraceability({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [wardId, setWardId] = useState('1');
  const [locationId, setLocationId] = useState('');
  const [qrForm, setQrForm] = useState<{ EntityType: QrEntityType; EntityId: string; HumanLabel: string }>({
    EntityType: 'fixed_asset',
    EntityId: '',
    HumanLabel: '',
  });
  const [generatedQr, setGeneratedQr] = useState<{ tagCode: string; svg: string } | null>(null);
  const [locationForm, setLocationForm] = useState({
    LocationCode: '',
    LocationName: '',
    LocationType: 'room',
    WardId: '',
    WardName: '',
    RoomNo: '',
    Floor: '',
    Department: '',
  });
  const [consumptionForm, setConsumptionForm] = useState({
    tagCode: '',
    itemName: '',
    quantity: '1',
    patientId: '',
    remarks: '',
  });

  const locationsPath = useMemo(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (wardId) params.set('wardId', wardId);
    return `/api/inventory/locations?${params.toString()}`;
  }, [wardId]);

  const stockPath = useMemo(() => {
    const params = new URLSearchParams({ detailed: '1' });
    if (locationId) params.set('locationId', locationId);
    return `/api/ward-supply/stock/${wardId || 0}?${params.toString()}`;
  }, [locationId, wardId]);

  const locationsQuery = useApiQuery<{ data: LocationRow[] }>(['inventoryTraceability', 'locations', wardId], locationsPath);
  const stockQuery = useApiQuery<{ stock: WardStockRow[] }>(['inventoryTraceability', 'wardStock', wardId, locationId], stockPath, {
    enabled: Boolean(wardId),
  });

  const createLocation = useApiMutation('post', '/api/inventory/locations', {
    onSuccess: () => {
      toast.success(t('inventory.traceability.locationCreated'));
      setLocationForm({ LocationCode: '', LocationName: '', LocationType: 'room', WardId: wardId, WardName: '', RoomNo: '', Floor: '', Department: '' });
      queryClient.invalidateQueries({ queryKey: ['inventoryTraceability', 'locations'] });
    },
    onError: (err: any) => toast.error(err.message || t('inventory.traceability.locationCreateFailed')),
  });

  const consume = useApiMutation('post', '/api/ward-supply/consumption', {
    onSuccess: () => {
      toast.success(t('inventory.traceability.consumptionRecorded'));
      queryClient.invalidateQueries({ queryKey: ['inventoryTraceability', 'wardStock'] });
    },
    onError: (err: any) => toast.error(err.message || t('inventory.traceability.consumptionFailed')),
  });

  async function scan(code = scanCode) {
    if (!code.trim()) return toast.error(t('inventory.traceability.enterOrScanQr'));
    const result = await api.get<any>(`/api/inventory/qr/scan/${encodeURIComponent(code.trim())}`);
    setScanResult(result);
    setConsumptionForm(f => ({ ...f, tagCode: code.trim(), itemName: result?.entity?.item_name || result?.entity?.ItemName || f.itemName }));
  }

  async function generateQr() {
    if (!qrForm.EntityId) return toast.error(t('inventory.traceability.entityIdRequired'));
    const result = await api.post<{ tagCode: string; svg: string }>('/api/inventory/qr/generate', {
      EntityType: qrForm.EntityType,
      EntityId: Number(qrForm.EntityId),
      HumanLabel: qrForm.HumanLabel || undefined,
    });
    setGeneratedQr(result);
  }

  async function startCameraScan() {
    if (!('BarcodeDetector' in window)) {
      toast.error(t('inventory.traceability.cameraNotSupported'));
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    streamRef.current = stream;
    setCameraOpen(true);
    setTimeout(async () => {
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!videoRef.current || !cameraOpen) return;
        const codes = await detector.detect(videoRef.current).catch(() => []);
        if (codes.length > 0) {
          const rawValue = codes[0].rawValue;
          setScanCode(rawValue);
          stopCameraScan();
          await scan(rawValue);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, 100);
  }

  function stopCameraScan() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function submitLocation(e: React.FormEvent) {
    e.preventDefault();
    createLocation.mutate({
      ...locationForm,
      WardId: locationForm.WardId ? Number(locationForm.WardId) : undefined,
      IsActive: true,
    });
  }

  function submitConsumption(e: React.FormEvent) {
    e.preventDefault();
    consume.mutate({
      wardId: Number(wardId),
      locationId: locationId ? Number(locationId) : undefined,
      tagCode: consumptionForm.tagCode || undefined,
      itemName: consumptionForm.itemName,
      quantity: Number(consumptionForm.quantity),
      patientId: consumptionForm.patientId ? Number(consumptionForm.patientId) : undefined,
      remarks: consumptionForm.remarks || undefined,
    });
  }

  const locations = locationsQuery.data?.data ?? [];
  const stock = stockQuery.data?.stock ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('inventory.traceability.title')}</h1>
            <p className="section-subtitle">{t('inventory.traceability.subtitle')}</p>
          </div>
          <button className="btn-ghost" onClick={() => queryClient.invalidateQueries({ queryKey: ['inventoryTraceability'] })}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <section className="card p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><QrCode className="w-4 h-4" /> {t('inventory.traceability.qrGenerateScan')}</h2>
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={qrForm.EntityType} onChange={e => setQrForm(f => ({ ...f, EntityType: e.target.value as QrEntityType }))}>
                <option value="fixed_asset">{t('inventory.traceability.entityTypes.fixedAsset')}</option>
                <option value="stock">{t('inventory.traceability.entityTypes.stockBatch')}</option>
                <option value="item">{t('inventory.traceability.entityTypes.item')}</option>
                <option value="location">{t('inventory.traceability.entityTypes.location')}</option>
                <option value="ward_stock">{t('inventory.traceability.entityTypes.wardStock')}</option>
                <option value="store">{t('inventory.traceability.entityTypes.store')}</option>
                <option value="purchase_order">{t('inventory.traceability.entityTypes.purchaseOrder')}</option>
                <option value="goods_receipt">{t('inventory.traceability.entityTypes.goodsReceipt')}</option>
              </select>
              <input className="input" placeholder={t('inventory.traceability.entityId')} value={qrForm.EntityId} onChange={e => setQrForm(f => ({ ...f, EntityId: e.target.value }))} />
            </div>
            <input className="input w-full" placeholder={t('inventory.traceability.label')} value={qrForm.HumanLabel} onChange={e => setQrForm(f => ({ ...f, HumanLabel: e.target.value }))} />
            <button className="btn-primary w-full" onClick={generateQr}><QrCode className="w-4 h-4" /> {t('inventory.traceability.generateQr')}</button>
            {generatedQr && (
              <div className="border border-[var(--color-border)] rounded-lg p-3 text-center">
                <div className="mx-auto w-40" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(generatedQr.svg, { USE_PROFILES: { svg: true } }) }} />
                <p className="font-mono text-xs mt-2 break-all">{generatedQr.tagCode}</p>
              </div>
            )}
            <div className="flex gap-2">
              <input className="input flex-1" placeholder={t('inventory.traceability.scanCode')} value={scanCode} onChange={e => setScanCode(e.target.value)} />
              <button className="btn-secondary" onClick={() => scan()}><Search className="w-4 h-4" /></button>
              <button className="btn-secondary" onClick={startCameraScan}><Camera className="w-4 h-4" /></button>
            </div>
            {scanResult && (
              <pre className="text-xs bg-[var(--color-bg-muted)] rounded p-2 overflow-auto max-h-48">{JSON.stringify(scanResult.entity ?? scanResult.payload, null, 2)}</pre>
            )}
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4" /> {t('inventory.traceability.wardRoomLocations')}</h2>
            <div className="flex gap-2">
              <input className="input w-24" placeholder={t('inventory.traceability.ward')} value={wardId} onChange={e => setWardId(e.target.value)} />
              <select className="input flex-1" value={locationId} onChange={e => setLocationId(e.target.value)}>
                <option value="">{t('inventory.traceability.allLocations')}</option>
                {locations.map(l => <option key={l.LocationId} value={l.LocationId}>{l.LocationName}</option>)}
              </select>
            </div>
            <form className="grid grid-cols-2 gap-2" onSubmit={submitLocation}>
              <input className="input" required placeholder={t('inventory.traceability.code')} value={locationForm.LocationCode} onChange={e => setLocationForm(f => ({ ...f, LocationCode: e.target.value }))} />
              <input className="input" required placeholder={t('inventory.traceability.name')} value={locationForm.LocationName} onChange={e => setLocationForm(f => ({ ...f, LocationName: e.target.value }))} />
              <select className="input" value={locationForm.LocationType} onChange={e => setLocationForm(f => ({ ...f, LocationType: e.target.value }))}>
                <option value="ward">{t('inventory.traceability.locationTypes.ward')}</option>
                <option value="room">{t('inventory.traceability.locationTypes.room')}</option>
                <option value="bed">{t('inventory.traceability.locationTypes.bed')}</option>
                <option value="rack">{t('inventory.traceability.locationTypes.rack')}</option>
                <option value="department">{t('inventory.traceability.locationTypes.department')}</option>
              </select>
              <input className="input" placeholder={t('inventory.traceability.roomNo')} value={locationForm.RoomNo} onChange={e => setLocationForm(f => ({ ...f, RoomNo: e.target.value }))} />
              <input className="input" placeholder={t('inventory.traceability.wardId')} value={locationForm.WardId || wardId} onChange={e => setLocationForm(f => ({ ...f, WardId: e.target.value }))} />
              <input className="input" placeholder={t('inventory.traceability.wardName')} value={locationForm.WardName} onChange={e => setLocationForm(f => ({ ...f, WardName: e.target.value }))} />
              <button className="btn-primary col-span-2" disabled={createLocation.isPending}>{t('inventory.traceability.createLocation')}</button>
            </form>
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><PackageCheck className="w-4 h-4" /> {t('inventory.traceability.wardConsumption')}</h2>
            <form className="space-y-2" onSubmit={submitConsumption}>
              <input className="input w-full" placeholder={t('inventory.traceability.wardStockQrTag')} value={consumptionForm.tagCode} onChange={e => setConsumptionForm(f => ({ ...f, tagCode: e.target.value }))} />
              <input className="input w-full" required placeholder={t('inventory.traceability.itemName')} value={consumptionForm.itemName} onChange={e => setConsumptionForm(f => ({ ...f, itemName: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="number" min="1" value={consumptionForm.quantity} onChange={e => setConsumptionForm(f => ({ ...f, quantity: e.target.value }))} />
                <input className="input" placeholder={t('inventory.traceability.patientIdOptional')} value={consumptionForm.patientId} onChange={e => setConsumptionForm(f => ({ ...f, patientId: e.target.value }))} />
              </div>
              <textarea className="input w-full" rows={2} placeholder={t('inventory.traceability.remarks')} value={consumptionForm.remarks} onChange={e => setConsumptionForm(f => ({ ...f, remarks: e.target.value }))} />
              <button className="btn-primary w-full" disabled={consume.isPending}>{t('inventory.traceability.recordConsumption')}</button>
            </form>
          </section>
        </div>

        <section className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="font-semibold">{t('inventory.traceability.wardLocationStock')}</h2>
            <span className="text-sm text-[var(--color-text-muted)]">{stock.length} {t('inventory.traceability.lines')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('inventory.traceability.location')}</th><th>{t('inventory.traceability.itemCol')}</th><th>{t('inventory.traceability.codeCol')}</th><th>{t('inventory.traceability.qtyCol')}</th><th>{t('inventory.traceability.minCol')}</th><th>{t('inventory.traceability.unitCol')}</th><th>{t('inventory.traceability.qrTagCol')}</th></tr></thead>
              <tbody>
                {stock.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('inventory.traceability.noRoomStock')}</td></tr>
                ) : stock.map(row => (
                  <tr key={row.id} className={row.current_quantity <= row.min_stock_level ? 'bg-red-50' : ''}>
                    <td>{row.LocationName || row.room_no || t('inventory.traceability.wardStock')}</td>
                    <td className="font-medium">{row.item_name}</td>
                    <td className="font-mono text-xs">{row.item_code || '-'}</td>
                    <td className="font-data font-semibold">{row.current_quantity}</td>
                    <td>{row.min_stock_level}</td>
                    <td>{row.unit}</td>
                    <td className="font-mono text-xs">{row.tag_code || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {cameraOpen && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg p-4 w-full max-w-md space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{t('inventory.traceability.scanQr')}</h3>
                <button className="btn-ghost" onClick={stopCameraScan}><X className="w-4 h-4" /></button>
              </div>
              <video ref={videoRef} className="w-full aspect-video bg-black rounded" />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

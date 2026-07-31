import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Camera,
  CameraOff,
  CheckCircle,
  Clock,
  Keyboard,
  QrCode,
  Search,
  ShieldCheck,
  Stethoscope,
  UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { api } from '../lib/apiClient';
import { getRoleBasePath } from '../lib/handover';

interface ScanResponse {
  resolved: boolean;
  scope: 'registration' | 'clinical' | 'nursing_context' | 'billing';
  can_import: boolean;
  local_patient: { id: number; patient_code: string | null; name: string | null } | null;
  patient: {
    uhid: string;
    name: string;
    mobile?: string | null;
    email?: string | null;
    address?: string | null;
    age?: number | null;
    gender?: string | null;
    blood_group?: string | null;
    source_hospital_name?: string | null;
    source_patient_code?: string | null;
  };
  clinical_summaries?: Array<{ tenant_id: string; hospital_name: string | null; summary: unknown }>;
  nursing_context_required?: boolean;
}

interface ImportResponse {
  imported: boolean;
  already_linked?: boolean;
  patient: { id: number; patient_code: string | null; name: string | null; uhid?: string };
}

interface ScanHistoryItem {
  id: string;
  at: string;
  patientName: string;
  uhid: string;
  scope: string;
  localPatientId?: number;
  imported?: boolean;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};

export default function PatientCardScanner({ role = 'reception' }: { role?: string }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraOpenRef = useRef(false);
  const lastScanRef = useRef<{ payload: string; at: number } | null>(null);

  const [payload, setPayload] = useState('');
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'starting' | 'ready' | 'unsupported' | 'error'>('idle');

  const basePath = getRoleBasePath(slug, role);

  const focusScannerInput = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    focusScannerInput();
    const onVisibility = () => {
      if (!document.hidden) focusScannerInput();
    };
    window.addEventListener('focus', focusScannerInput);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', focusScannerInput);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [focusScannerInput]);

  const addHistory = useCallback((data: ScanResponse, imported = false) => {
    setHistory((items) => [
      {
        id: `${Date.now()}-${data.patient.uhid}`,
        at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        patientName: data.patient.name,
        uhid: data.patient.uhid,
        scope: data.scope.replace('_', ' '),
        localPatientId: data.local_patient?.id,
        imported,
      },
      ...items,
    ].slice(0, 8));
  }, []);

  const scanPayload = useCallback(async (nextPayload: string) => {
    const trimmed = nextPayload.trim();
    if (!trimmed) {
      toast.error(t('cardScanner.toastScanPayload'));
      focusScannerInput();
      return;
    }

    const now = Date.now();
    if (lastScanRef.current?.payload === trimmed && now - lastScanRef.current.at < 1500) {
      focusScannerInput();
      return;
    }
    lastScanRef.current = { payload: trimmed, at: now };

    setLoading(true);
    try {
      const data = await api.post<ScanResponse>('/api/health-record/card-qr/scan', { payload: trimmed });
      setPayload(trimmed);
      setResult(data);
      addHistory(data);
      if (data.local_patient) toast.success(t('cardScanner.toastLocalFound'));
      else toast.success(t('cardScanner.toastGlobalResolved'));
    } catch (err) {
      setResult(null);
      toast.error((err as { message?: string })?.message ?? t('cardScanner.toastScanFailed'));
    } finally {
      setLoading(false);
      focusScannerInput();
    }
  }, [addHistory, focusScannerInput]);

  const importPatient = async () => {
    if (!payload.trim()) return;
    setImporting(true);
    try {
      const data = await api.post<ImportResponse>('/api/health-record/card-qr/import', { payload });
      toast.success(data.already_linked ? t('cardScanner.toastAlreadyLinked') : t('cardScanner.toastImported'));
      if (result) addHistory({ ...result, local_patient: { id: data.patient.id, patient_code: data.patient.patient_code, name: data.patient.name } }, true);
      navigate(`${basePath}/patients/${data.patient.id}`);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? t('cardScanner.toastImportFailed'));
    } finally {
      setImporting(false);
      focusScannerInput();
    }
  };

  const stopCamera = useCallback(() => {
    cameraOpenRef.current = false;
    setCameraOpen(false);
    setCameraStatus('idle');
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    focusScannerInput();
  }, [focusScannerInput]);

  const startCamera = async () => {
    const detectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!detectorCtor) {
      setCameraStatus('unsupported');
      toast.error(t('cardScanner.toastCameraUnsupported'));
      focusScannerInput();
      return;
    }

    setCameraStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      cameraOpenRef.current = true;
      setCameraOpen(true);
      setCameraStatus('ready');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const detector = new detectorCtor({ formats: ['qr_code'] });
      const detectLoop = async () => {
        if (!cameraOpenRef.current || !videoRef.current) return;
        const codes = await detector.detect(videoRef.current).catch(() => []);
        const rawValue = codes[0]?.rawValue;
        if (rawValue) {
          stopCamera();
          await scanPayload(rawValue);
          return;
        }
        window.setTimeout(detectLoop, 250);
      };
      detectLoop();
    } catch {
      cameraOpenRef.current = false;
      setCameraOpen(false);
      setCameraStatus('error');
      toast.error(t('cardScanner.toastCameraError'));
      focusScannerInput();
    }
  };

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <DashboardLayout role={role}>
      <div className="max-w-7xl mx-auto px-4 py-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{t('cardScanner.workstation')}</h1>
              <p className="text-sm text-slate-500">{t('cardScanner.readyDesc')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                <CheckCircle className="w-3.5 h-3.5" />
                {t('cardScanner.focusLocked')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1">
                <Keyboard className="w-3.5 h-3.5" />
                {t('cardScanner.enterToScan')}
              </span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
          <div className="space-y-4">
            <section className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700" htmlFor="patient-card-qr-input">
                {t('cardScanner.scannerInput')}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={inputRef}
                  id="patient-card-qr-input"
                  autoFocus
                  value={payload}
                  onBlur={focusScannerInput}
                  onChange={(event) => setPayload(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') scanPayload(payload);
                  }}
                  className="input flex-1 font-mono text-sm"
                  placeholder={t('cardScanner.scanPlaceholder')}
                />
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary" onClick={() => scanPayload(payload)} disabled={loading}>
                    <Search className="w-4 h-4 mr-2" />
                    {loading ? t('cardScanner.scanning') : t('cardScanner.scan')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={cameraOpen ? stopCamera : startCamera}
                    disabled={cameraStatus === 'starting'}
                  >
                    {cameraOpen ? <CameraOff className="w-4 h-4 mr-2" /> : <Camera className="w-4 h-4 mr-2" />}
                    {cameraOpen ? t('cardScanner.stopCamera') : cameraStatus === 'starting' ? t('cardScanner.starting') : t('cardScanner.camera')}
                  </button>
                </div>
              </div>

              {cameraOpen && (
                <div className="rounded-lg border border-slate-200 bg-slate-950 p-3">
                  <video ref={videoRef} className="w-full max-h-[360px] rounded bg-black object-contain" muted playsInline />
                  <p className="mt-2 text-xs text-slate-300">{t('cardScanner.cameraHint')}</p>
                </div>
              )}

              {cameraStatus === 'unsupported' && (
                <p className="text-sm text-amber-700">{t('cardScanner.cameraUnsupported')}</p>
              )}
            </section>

            {result ? (
              <ResultPanel
                result={result}
                importing={importing}
                onImport={importPatient}
                onOpenLocal={(patientId) => navigate(`${basePath}/patients/${patientId}`)}
              />
            ) : (
              <section className="border border-dashed border-slate-300 rounded-lg bg-slate-50 p-8 text-center">
                <QrCode className="w-10 h-10 mx-auto text-slate-400" />
                <h2 className="mt-3 text-sm font-semibold text-slate-800">{t('cardScanner.waitingForScan')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('cardScanner.scanHint')}</p>
              </section>
            )}
          </div>

          <aside className="border border-slate-200 rounded-lg bg-white p-4 h-fit">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{t('cardScanner.recentScans')}</h2>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <div className="mt-3 space-y-2">
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">{t('cardScanner.noScansYet')}</p>
              ) : history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full text-left rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                  onClick={() => item.localPatientId && navigate(`${basePath}/patients/${item.localPatientId}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-slate-900 truncate">{item.patientName}</span>
                    <span className="text-xs text-slate-500">{item.at}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 font-mono truncate">{item.uhid}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.imported ? t('cardScanner.imported') : item.scope}</div>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}

function ResultPanel({
  result,
  importing,
  onImport,
  onOpenLocal,
}: {
  result: ScanResponse;
  importing: boolean;
  onImport: () => void;
  onOpenLocal: (patientId: number) => void;
}) {
  const { t } = useTranslation('common');
  return (
    <section className="border border-slate-200 rounded-lg bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('cardScanner.resolvedPatient')}</div>
          <h2 className="text-lg font-semibold text-slate-900">{result.patient.name}</h2>
          <p className="text-sm text-slate-500 font-mono">{result.patient.uhid}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.local_patient && (
            <button className="btn btn-secondary" onClick={() => onOpenLocal(result.local_patient!.id)}>
              {t('cardScanner.openLocalRecord')}
            </button>
          )}
          {!result.local_patient && result.can_import && (
            <button className="btn btn-primary" onClick={onImport} disabled={importing}>
              <UserPlus className="w-4 h-4 mr-2" />
              {importing ? t('cardScanner.importing') : t('cardScanner.importToHospital')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <Info label={t('mobile')} value={result.patient.mobile} />
        <Info label={t('cardScanner.ageGender')} value={[result.patient.age, result.patient.gender].filter(Boolean).join(' / ')} />
        <Info label={t('cardScanner.bloodGroup')} value={result.patient.blood_group} />
        <Info label={t('cardScanner.sourceHospital')} value={result.patient.source_hospital_name} />
        <Info label={t('cardScanner.sourceMRN')} value={result.patient.source_patient_code} />
        <Info label={t('cardScanner.scope')} value={result.scope.replace('_', ' ')} />
      </div>

      {result.scope === 'clinical' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 flex gap-2">
          <Stethoscope className="w-4 h-4 mt-0.5" />
          <span>{t('cardScanner.clinicalAccessEnabled', { count: result.clinical_summaries?.length ?? 0 })}</span>
        </div>
      )}

      {result.nursing_context_required && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
          <ShieldCheck className="w-4 h-4 mt-0.5" />
          <span>{t('cardScanner.nursingContextRequired')}</span>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-medium text-slate-900 break-words">{value || '-'}</div>
    </div>
  );
}

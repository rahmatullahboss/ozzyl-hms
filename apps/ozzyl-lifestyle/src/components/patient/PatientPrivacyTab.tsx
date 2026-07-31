import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, ShieldAlert, X, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  buildPatientGlobalHealthPath,
  formatPatientDateTimeMonthYear,
  PATIENT_SELECTED_HOSPITAL_STORAGE_KEY,
} from '../../lib/patientPortalUx';
import { useHospitalLinks } from '../../hooks/useConnectedCare';

interface BlockResponse {
  id: number;
  blocked_tenant_id: number | null;
  blocked_doctor_id: number | null;
  reason: string | null;
  created_at: string;
}

interface AccessLog {
  id: number;
  access_type: string;
  source_hospital: string | null;
  accessing_hospital: string | null;
  accessed_at: string;
}

interface AuditLog {
  access_log: AccessLog[];
}

export default function PatientPrivacyTab() {
  const { t } = useTranslation('patients');
  const [blocks, setBlocks] = useState<BlockResponse[]>([]);
  const [auditLog, setAuditLog] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [blockingDoctorId, setBlockingDoctorId] = useState('');
  const [blockingTenantId, setBlockingTenantId] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const hospitalLinksQuery = useHospitalLinks();
  const selectedHospital = (hospitalLinksQuery.data?.hospitals ?? []).find(
    (hospital) => hospital.tenant_id === selectedTenantId,
  );

  useEffect(() => {
    setSelectedTenantId(window.sessionStorage.getItem(PATIENT_SELECTED_HOSPITAL_STORAGE_KEY) ?? '');
  }, []);

  async function fetchGlobalHealthJson<T>(path: `/${string}`, init?: RequestInit): Promise<T> {
    if (!selectedTenantId) {
      throw new Error(t('privacySettings.hospitalContextRequired'));
    }

    const response = await fetch(buildPatientGlobalHealthPath(path), {
      credentials: 'include',
      headers: {
        'X-Tenant-ID': selectedTenantId,
        ...(init?.headers ?? {}),
      },
      ...init,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as { message?: string; error?: string }).message || (data as { error?: string }).error || 'Privacy request failed');
    }

    return data as T;
  }

  useEffect(() => {
    let mounted = true;

    if (!selectedTenantId) {
      setAuditLog([]);
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    async function loadData() {
      setLoading(true);
      try {
        const auditData = await fetchGlobalHealthJson<AuditLog>('/access-log');

        if (mounted) {
          setAuditLog(auditData.access_log || []);
        }
      } catch (error) {
        if (mounted) {
          toast.error(error instanceof Error ? error.message : t('privacySettings.loadFailed'));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadData();

    return () => {
      mounted = false;
    };
  }, [selectedTenantId]);

  async function handleBlock(type: 'tenant' | 'doctor') {
    const idValue = type === 'tenant' ? blockingTenantId : blockingDoctorId;
    if (!idValue) return;

    const payload = type === 'tenant' 
      ? { blocked_tenant_id: Number(idValue) } 
      : { blocked_doctor_id: Number(idValue) };

    const toastId = toast.loading(t('privacySettings.blocking'));
    try {
      await fetchGlobalHealthJson<{ id: number; message?: string }>('/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      toast.success(t('privacySettings.blockedSuccessfully'), { id: toastId });
      if (type === 'tenant') setBlockingTenantId('');
      if (type === 'doctor') setBlockingDoctorId('');
      // In a real app we'd fetch the block list here too.
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('privacySettings.blockFailed'), { id: toastId });
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Activity className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
      <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-[0_12px_40px_rgba(8,145,178,0.06)] border border-slate-100 space-y-8 animate-fade-in-up animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 sm:p-8 shadow-sm backdrop-blur-md relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-cyan-700/10 rounded-full blur-2xl"></div>
        <div className="absolute -left-12 -bottom-12 w-48 h-48 bg-rose-700/10 rounded-full blur-2xl"></div>
        <div className="relative z-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">{t('privacySettings.privacySecurityTitle')}</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold font-manrope text-slate-900 dark:text-white">{t('privacySettings.dataAccessControl')}</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
            {t('privacySettings.dataAccessDescription')}
          </p>
        </div>
      </div>

      {!selectedTenantId && (
        <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-medium text-amber-800">
          {t('privacySettings.selectHospitalFirst')}
        </div>
      )}

      {selectedTenantId && selectedHospital && (
        <div className="rounded-[1.5rem] border border-cyan-100 bg-cyan-50 px-5 py-4 text-sm text-cyan-900">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">
            Active hospital context
          </p>
          <p className="mt-2 font-semibold">
            {selectedHospital.hospital_name}
          </p>
          <p className="mt-1 text-cyan-700">
            Access audit and privacy actions on this page are currently scoped to the selected hospital connection.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Block List Section (takes 1 column) */}
        <div className="lg:col-span-1 space-y-6">
          <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 shadow-sm backdrop-blur-md overflow-hidden hover:shadow-lg hover:shadow-rose-100 dark:hover:shadow-rose-900/10 transition">
            <div className="p-6 border-b border-rose-100/50 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20">
              <h2 className="text-lg font-bold font-manrope text-slate-900 dark:text-white flex items-center gap-3">
                <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-900/40">
                  <ShieldAlert className="text-rose-600 dark:text-rose-400 h-5 w-5" />
                </div>
                {t('privacySettings.restrictAccess')}
              </h2>
            </div>
            <div className="p-6 space-y-6">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {t('privacySettings.restrictAccessDescription')}
              </p>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">{t('privacySettings.blockHospitalLabel')}</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      value={blockingTenantId}
                      onChange={(e) => setBlockingTenantId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-500 transition-shadow" 
                      placeholder={t("privacySettings.hospitalIdPlaceholder")} 
                    />
                    <button 
                      onClick={() => void handleBlock('tenant')}
                      disabled={!blockingTenantId}
                      className="shrink-0 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors"
                    >
                      {t('privacySettings.blockButton')}
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">{t('privacySettings.blockProviderLabel')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={blockingDoctorId}
                      onChange={(e) => setBlockingDoctorId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-rose-500 transition-shadow"
                      placeholder={t("privacySettings.providerIdPlaceholder")}
                    />
                    <button
                      onClick={() => void handleBlock('doctor')}
                      disabled={!blockingDoctorId}
                      className="shrink-0 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors"
                    >
                      {t('privacySettings.blockButton')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Audit Log / Break Glass Section (takes 2 columns) */}
        <div className="lg:col-span-2">
          <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 shadow-sm backdrop-blur-md overflow-hidden h-full flex flex-col">
            <div className="p-6 border-b border-cyan-100/50 dark:border-cyan-900/50 bg-cyan-50/50 dark:bg-cyan-950/20">
              <h2 className="text-lg font-bold font-manrope text-slate-900 dark:text-white flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-100 dark:bg-cyan-900/40">
                  <Shield className="text-cyan-600 dark:text-cyan-400 h-5 w-5" />
                </div>
                {t('privacySettings.accessAuditHistory')}
              </h2>
            </div>
            <div className="p-0 overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-100 dark:border-slate-800/80">
                    <th className="p-4 font-semibold pl-6">{t('privacySettings.timestamp')}</th>
                    <th className="p-4 font-semibold">{t('privacySettings.accessingEntity')}</th>
                    <th className="p-4 font-semibold pr-6">{t('privacySettings.accessEvent')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                  {auditLog.length > 0 ? auditLog.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                      <td className="p-4 text-slate-600 dark:text-slate-300 whitespace-nowrap pl-6">
                        {new Date(log.accessed_at).toLocaleString('bn-BD', { hour12: true, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-4 text-slate-900 dark:text-white font-bold">
                        {log.accessing_hospital || t('privacySettings.patientPortal')}
                      </td>
                      <td className="p-4 pr-6">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border
                          ${log.access_type === 'portal_view' 
                            ? 'bg-cyan-50 text-cyan-700 border-cyan-100 dark:bg-cyan-900/20 dark:text-cyan-400 dark:border-cyan-800' 
                            : 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800'
                          }`}
                        >
                          {log.access_type === 'portal_view' ? t('privacySettings.routineAccess') : t('privacySettings.emergencyOverride')}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="p-12 text-center">
                         <div className="mx-auto w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                           <Shield className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                         </div>
                         <p className="text-slate-500 dark:text-slate-400 font-medium">{t('privacySettings.noAccessLogs')}</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

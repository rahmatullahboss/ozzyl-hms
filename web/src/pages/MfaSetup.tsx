import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Shield, Smartphone, Key, QrCode, CheckCircle, RefreshCw, Plus, Trash2 } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { apiFetch } from '../lib/apiClient';

interface MFASetting {
  id: number;
  user_id: number;
  mfa_type: 'totp' | 'sms' | 'email' | 'backup_codes';
  is_enabled: number;
  is_verified: number;
  created_at: string;
  backup_codes_remaining?: number;
}

interface MFAEnrollResponse {
  secret: string;
  qr_code_url: string;
  backup_codes: string[];
}

export default function MfaSetup({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'status' | 'setup'>('status');
  const [verificationCode, setVerificationCode] = useState('');
  const [enrollData, setEnrollData] = useState<MFAEnrollResponse | null>(null);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  const { data: mfaStatus, isLoading } = useApiQuery<{ enabled: boolean; methods: MFASetting[]; backup_codes_remaining: number }>(
    queryKeys.settings.mfa(),
    '/api/mfa/status',
  );

  const regenerateBackupMutation = useApiMutation('post', '/api/mfa/regenerate-backup-codes', {
    onSuccess: (data: any) => {
      setEnrollData(data);
      setShowBackupCodes(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.mfa() });
    },
  });

  const disableMfaMutation = useApiMutation('post', '/api/mfa/disable', {
    onSuccess: () => {
      toast.success(t('mfa.disabled', 'MFA disabled'));
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.mfa() });
    },
  });

  const startEnroll = async (type: string) => {
    try {
      const data = await apiFetch<MFAEnrollResponse>('/api/mfa/enroll', { method: 'POST', body: { type } });
      setEnrollData(data);
      setActiveTab('setup');
    } catch (err: any) {
      toast.error(err?.message || t('mfa.enrollFailed', 'Failed to start enrollment'));
    }
  };

  const verifyEnroll = async () => {
    if (!verificationCode) { toast.error(t('mfa.enterCode', 'Enter verification code')); return; }
    try {
      await apiFetch('/api/mfa/verify-enroll', {
        method: 'POST',
        body: { code: verificationCode },
      });
      toast.success(t('mfa.verified', 'MFA verified successfully'));
      setEnrollData(null);
      setVerificationCode('');
      setActiveTab('status');
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.mfa() });
    } catch (err: any) {
      toast.error(err?.message || t('mfa.verifyFailed', 'Verification failed'));
    }
  };

  const isEnabled = mfaStatus?.enabled ?? false;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('mfa.title', 'Multi-Factor Authentication')}</h1>
              <p className="section-subtitle">{t('mfa.subtitle', 'Add an extra layer of security to your account')}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => { setActiveTab('status'); setEnrollData(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'status' ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400' : 'text-gray-600 hover:bg-gray-100'}`}>
            {t('mfa.status', 'Status')}
          </button>
          {!isEnabled && (
            <button onClick={() => setActiveTab('setup')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'setup' && !enrollData ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400' : 'text-gray-600 hover:bg-gray-100'}`}>
              {t('mfa.setup', 'Setup')}
            </button>
          )}
        </div>

        {activeTab === 'status' && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">{t('common:loading')}</div>
            ) : (
              <>
                <div className={`card p-6 flex items-center gap-4 ${isEnabled ? 'border-green-200 dark:border-green-900' : 'border-gray-200 dark:border-gray-800'}`}>
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                    {isEnabled ? <CheckCircle className="w-6 h-6 text-green-600" /> : <Shield className="w-6 h-6 text-gray-400" />}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{isEnabled ? t('mfa.enabled', 'MFA is Enabled') : t('mfa.notEnabled', 'MFA is Not Enabled')}</h3>
                    <p className="text-sm text-gray-500">
                      {isEnabled
                        ? t('mfa.enabledDesc', 'Your account has an extra layer of security.')
                        : t('mfa.notEnabledDesc', 'Enable MFA to protect your account with a second factor.')
                      }
                    </p>
                  </div>
                </div>

                {isEnabled && mfaStatus && (
                  <>
                    <div className="card p-4 space-y-3">
                      <h3 className="font-medium text-sm">{t('mfa.activeMethods', 'Active Methods')}</h3>
                      {mfaStatus.methods?.filter(m => m.is_enabled === 1).map(m => (
                        <div key={m.id} className="flex items-center gap-3 text-sm">
                          {m.mfa_type === 'totp' ? <Smartphone className="w-4 h-4 text-indigo-500" /> : m.mfa_type === 'sms' ? <Smartphone className="w-4 h-4 text-green-500" /> : <Key className="w-4 h-4 text-amber-500" />}
                          <span className="font-medium">{m.mfa_type.toUpperCase()}</span>
                          <span className="text-gray-500">• {m.is_verified ? t('mfa.verified', 'Verified') : t('mfa.pending', 'Pending')}</span>
                        </div>
                      ))}
                    </div>

                    <div className="card p-4 space-y-2">
                      <h3 className="font-medium text-sm">{t('mfa.backupCodes', 'Backup Codes')}</h3>
                      <p className="text-sm text-gray-500">
                        {t('mfa.backupCodesRemaining', '{{count}} backup codes remaining', { count: mfaStatus.backup_codes_remaining || 0 })}
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => regenerateBackupMutation.mutate({})} className="btn-ghost text-sm" disabled={regenerateBackupMutation.isPending}>
                          <RefreshCw className="w-4 h-4" /> {t('mfa.regenerateBackups', 'Regenerate')}
                        </button>
                        <button onClick={() => disableMfaMutation.mutate({})} className="btn-ghost text-sm text-red-600" disabled={disableMfaMutation.isPending}>
                          {t('mfa.disable', 'Disable MFA')}
                        </button>
                      </div>
                    </div>

                    {showBackupCodes && enrollData?.backup_codes && (
                      <div className="card p-4 border-2 border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10">
                        <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">{t('mfa.saveBackupCodes', 'Save these backup codes in a safe place!')}</h3>
                        <div className="grid grid-cols-2 gap-1 font-mono text-sm">
                          {enrollData.backup_codes.map((code, i) => (
                            <div key={i} className="bg-white dark:bg-gray-800 px-2 py-1 rounded border">{code}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'setup' && !enrollData && (
          <div className="space-y-4">
            <h3 className="font-medium">{t('mfa.chooseMethod', 'Choose MFA Method')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button onClick={() => startEnroll('totp')} className="card p-4 hover:border-indigo-300 transition-colors text-left">
                <Smartphone className="w-8 h-8 text-indigo-500 mb-2" />
                <h4 className="font-semibold text-sm">{t('mfa.totp', 'Authenticator App')}</h4>
                <p className="text-xs text-gray-500 mt-1">{t('mfa.totpDesc', 'Use Google Authenticator, Authy, or similar')}</p>
              </button>
              <button onClick={() => startEnroll('sms')} className="card p-4 hover:border-green-300 transition-colors text-left">
                <Smartphone className="w-8 h-8 text-green-500 mb-2" />
                <h4 className="font-semibold text-sm">{t('mfa.sms', 'SMS')}</h4>
                <p className="text-xs text-gray-500 mt-1">{t('mfa.smsDesc', 'Receive a code via SMS')}</p>
              </button>
              <button onClick={() => startEnroll('email')} className="card p-4 hover:border-amber-300 transition-colors text-left">
                <Key className="w-8 h-8 text-amber-500 mb-2" />
                <h4 className="font-semibold text-sm">{t('mfa.email', 'Email')}</h4>
                <p className="text-xs text-gray-500 mt-1">{t('mfa.emailDesc', 'Receive a code via email')}</p>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'setup' && enrollData && (
          <div className="card p-6 space-y-4 max-w-md mx-auto">
            <h3 className="font-semibold text-center">{t('mfa.verifySetup', 'Verify MFA Setup')}</h3>

            {enrollData.qr_code_url && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-gray-500">{t('mfa.scanQr', 'Scan this QR code with your authenticator app')}</p>
                <img src={enrollData.qr_code_url} alt="QR Code" className="w-48 h-48 border rounded-lg" />
                <p className="text-xs text-gray-400 font-mono break-all">{enrollData.secret}</p>
              </div>
            )}

            {enrollData.backup_codes && (
              <div className="border-2 border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10 p-3 rounded-lg">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">{t('mfa.saveBackupCodes', 'Save these backup codes!')}</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                  {enrollData.backup_codes.map((code, i) => (
                    <div key={i} className="bg-white dark:bg-gray-800 px-2 py-1 rounded border">{code}</div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="label">{t('mfa.verificationCode', 'Verification Code')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verificationCode}
                  onChange={e => setVerificationCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="input flex-1 text-center text-lg tracking-widest"
                  autoFocus
                />
                <button onClick={verifyEnroll} className="btn-primary">{t('mfa.verify', 'Verify')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

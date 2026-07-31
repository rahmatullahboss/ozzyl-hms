import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Download, Upload, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useSettingsForm } from '../hooks/useSettingsForm';
import { useApiMutation, useQueryClient } from '../hooks/useApiQuery';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface BackupData {
  last_backup_at: string | null;
  last_backup_status: 'success' | 'failed' | 'requested' | 'never';
  auto_backup_enabled: boolean;
  auto_backup_time: string;
  auto_backup_frequency: 'daily' | 'weekly' | 'monthly';
}

// ─── Reusable Components ────────────────────────────────────────────────────────

function Toggle({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
        {hint && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-label={label} aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'right-1' : 'left-1'}`} />
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

export default function BackupSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const { values: settings, update, save, loading: isLoading, saving } = useSettingsForm<BackupData>({
    queryKey: ['settings', 'backup'],
    prefix: 'backup_',
    defaultValues: {
      last_backup_at: null,
      last_backup_status: 'never',
      auto_backup_enabled: true,
      auto_backup_time: '02:00',
      auto_backup_frequency: 'daily',
    },
  });

  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [showRestore, setShowRestore] = useState(false);

  // ── Save settings mutation (for backup-specific actions) ──
  const createBackupMutation = useApiMutation<unknown, void>(
    'post',
    '/api/backup/create',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        queryClient.invalidateQueries({ queryKey: ['settings', 'backup'] });
        toast.success('Backup request recorded');
      },
      onError: () => toast.error('Failed to record backup request'),
    },
  );

  const statusColor = settings.last_backup_status === 'success' ? 'text-emerald-600' : settings.last_backup_status === 'failed' ? 'text-red-600' : 'text-[var(--color-text-muted)]';
  const statusIcon = settings.last_backup_status === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : settings.last_backup_status === 'failed' ? <AlertTriangle className="w-5 h-5 text-red-500" /> : <Clock className="w-5 h-5 text-[var(--color-text-muted)]" />;
  const backupStatusLabel = settings.last_backup_status === 'success'
    ? 'Successful'
    : settings.last_backup_status === 'failed'
      ? 'Failed'
      : settings.last_backup_status === 'requested'
        ? 'Requested'
        : 'Never backed up';

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div>
          <h1 className="page-title">Backup & Restore</h1>
          <p className="section-subtitle mt-1">Manage data backups, auto-backup schedule, and restore</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-32 w-full rounded-xl" />)}
          </div>
        ) : (
          <>
            {/* ── Last Backup Status ── */}
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {statusIcon}
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">Last Backup</p>
                    <p className={`text-xs ${statusColor}`}>
                      {settings.last_backup_at
                        ? `${new Date(settings.last_backup_at).toLocaleString()} — ${backupStatusLabel}`
                        : 'Never backed up'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createBackupMutation.mutate()} disabled={createBackupMutation.isPending}
                    className="btn-primary text-sm">
                    <Database className="w-4 h-4" />
                    {createBackupMutation.isPending ? 'Recording...' : 'Create Backup Request'}
                  </button>
                  <button className="btn-secondary text-sm">
                    <Download className="w-4 h-4" /> Download
                  </button>
                </div>
              </div>
            </div>

            {/* ── Auto Backup Settings ── */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-[var(--color-primary-light)] flex items-center justify-center">
                  <Clock className="w-4 h-4 text-[var(--color-primary)]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Auto Backup</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">Schedule automatic backups</p>
                </div>
              </div>
              <div className="pl-10 space-y-4">
                <Toggle label="Enable Auto Backup" checked={settings.auto_backup_enabled}
                  onChange={v => update('auto_backup_enabled', v)} />
                {settings.auto_backup_enabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <Select id="frequency" label="Frequency" value={settings.auto_backup_frequency}
                      onChange={v => update('auto_backup_frequency', v as BackupData['auto_backup_frequency'])}
                      options={[
                        { label: 'Daily', value: 'daily' },
                        { label: 'Weekly', value: 'weekly' },
                        { label: 'Monthly', value: 'monthly' },
                      ]} />
                    <div>
                      <label htmlFor="backup-time" className="label">Time</label>
                      <input id="backup-time" type="time" className="input" value={settings.auto_backup_time}
                        onChange={e => update('auto_backup_time', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Restore ── */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-red-50 flex items-center justify-center">
                  <Upload className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Restore Backup</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">Restore from a backup file — super admin only</p>
                </div>
              </div>
              <div className="pl-10">
                {!showRestore ? (
                  <button onClick={() => setShowRestore(true)} className="btn-secondary text-sm text-red-600 hover:text-red-700">
                    <Upload className="w-4 h-4" /> Restore Backup
                  </button>
                ) : (
                  <div className="space-y-3 p-4 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-sm text-red-700 font-medium">
                      ⚠ Restore will overwrite current data. This action is irreversible.
                    </p>
                    <div>
                      <label htmlFor="restore-confirm" className="label">Type RESTORE to confirm</label>
                      <input id="restore-confirm" type="text" className="input" value={restoreConfirm}
                        onChange={e => setRestoreConfirm(e.target.value)} placeholder="RESTORE" />
                    </div>
                    <div className="flex gap-2">
                      <button disabled={restoreConfirm !== 'RESTORE'} className="btn-primary text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50">
                        <Upload className="w-4 h-4" /> Confirm Restore
                      </button>
                      <button onClick={() => { setShowRestore(false); setRestoreConfirm(''); }} className="btn-ghost text-sm">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Save Button ── */}
            <div className="flex justify-end">
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

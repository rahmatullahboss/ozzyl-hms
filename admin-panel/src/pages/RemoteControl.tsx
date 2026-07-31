import { useState } from 'react';
import { Power, Bell, Shield, Send, Info } from 'lucide-react';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { api } from '../services/api';

export default function RemoteControl() {
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [selectedHospital, setSelectedHospital] = useState<'all' | 'active'>('all');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  const handleBroadcast = async (): Promise<void> => {
    const msg = broadcastMessage.trim();
    if (!msg) return;
    setPending(true);
    try {
      const target = selectedHospital === 'all' ? 'all' : 'all';
      // NOTE: 'active' is a UI filter; the backend stores one broadcast
      // and tenants decide whether to display it based on their own state.
      const res = await api.remote.broadcast(target, msg);
      toast('success', `Broadcast sent (${res.sent} record)`);
      setBroadcastMessage('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setPending(false);
    }
  };

  const handleToggleMaintenance = async (nextEnabled: boolean): Promise<void> => {
    setPending(true);
    try {
      await api.remote.setMaintenance(nextEnabled);
      setMaintenanceMode(nextEnabled);
      toast('success', `Maintenance mode ${nextEnabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setPending(false);
    }
  };

  const handleRevokeSessions = async (): Promise<void> => {
    setPending(true);
    try {
      const res = await api.remote.revokeSessions('admins');
      toast('success', `Revoked ${res.revoked} session(s). All admins must re-authenticate.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setPending(false);
    }
  };

  const handleConfirmAction = () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === 'maintenance') {
      void handleToggleMaintenance(true);
    } else if (action === 'revoke-sessions') {
      void handleRevokeSessions();
    }
    // 'shutdown' and 'password-reset' are demo-only — no-op
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-semibold text-slate-800">Remote Control</h2>
      </div>
      <div
        role="note"
        data-testid="demo-banner"
        className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900"
      >
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <strong>Caution:</strong> maintenance mode, broadcasts, and session revocation
          are live actions and take effect immediately. Emergency shutdown and force
          password reset remain disabled — they require an out-of-band ops process.
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Power className="w-5 h-5 text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-800">System Controls</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-900">Maintenance Mode</p>
              <p className="text-sm text-slate-500">Disable all user access for maintenance</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={maintenanceMode}
              aria-label="Maintenance mode"
              disabled={pending}
              onClick={() => {
                if (!maintenanceMode) setConfirmAction('maintenance');
                else void handleToggleMaintenance(false);
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                maintenanceMode ? 'bg-yellow-500' : 'bg-slate-300'
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  maintenanceMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg opacity-60">
            <div>
              <p className="font-medium text-slate-900">Emergency Shutdown</p>
              <p className="text-sm text-slate-500">
                Requires out-of-band ops process — not exposed in the panel
              </p>
            </div>
            <button
              disabled
              title="Disabled: requires ops process"
              className="px-4 py-2 bg-slate-100 text-slate-400 rounded-lg cursor-not-allowed font-medium"
            >
              Shutdown
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-800">Broadcast Message</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Target</label>
            <select
              value={selectedHospital}
              onChange={(e) => setSelectedHospital(e.target.value as 'all' | 'active')}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            >
              <option value="all">All Hospitals</option>
              <option value="active">Active Hospitals Only</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Message</label>
            <textarea
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
              placeholder="Enter your broadcast message…"
            />
          </div>
          <button
            onClick={handleBroadcast}
            disabled={!broadcastMessage.trim() || pending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
            Send Broadcast
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-800">Security Settings</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg opacity-60">
            <div>
              <p className="font-medium text-slate-900">Force Password Reset</p>
              <p className="text-sm text-slate-500">
                Requires a planned rollout — not exposed in the panel
              </p>
            </div>
            <button
              disabled
              title="Disabled: requires planned rollout"
              className="px-4 py-2 bg-slate-100 text-slate-400 rounded-lg cursor-not-allowed font-medium"
            >
              Trigger
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-900">Revoke All Admin Sessions</p>
              <p className="text-sm text-slate-500">Force all super_admins to re-authenticate</p>
            </div>
            <button
              onClick={() => setConfirmAction('revoke-sessions')}
              disabled={pending}
              className="px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors font-medium"
            >
              Revoke
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction === 'maintenance'
            ? 'Enable Maintenance Mode'
            : 'Revoke All Admin Sessions'
        }
        message={
          confirmAction === 'maintenance'
            ? 'This will disable access for all users across all tenants. Continue?'
            : 'All active super_admin sessions will be terminated. Admins will need to log in again. Continue?'
        }
        confirmLabel={confirmAction === 'maintenance' ? 'Enable' : 'Revoke'}
        variant={confirmAction === 'revoke-sessions' ? 'danger' : 'warning'}
        loading={pending}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

import { useState } from 'react';
import { Wind, Plus, StopCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';
import type { BedGridItem } from './WardBedGrid';

interface DrawerRespiratoryTabProps {
  bed: BedGridItem;
}

interface RespiratoryRecord {
  id: number;
  entry_type: 'oxygen' | 'nebulization';
  delivery_mode?: string;
  flow_rate?: number;
  spo2_before?: number;
  spo2_after?: number;
  status: 'active' | 'stopped';
  medicine_name?: string;
  dose?: string;
  response?: string;
  notes?: string;
  created_at?: string;
}

const O2_DELIVERY_MODES = ['Nasal Cannula', 'Face Mask', 'Non-rebreather', 'HFNC'];
const NEB_RESPONSES = ['improved', 'no_change', 'worse'];

export default function DrawerRespiratoryTab({ bed }: DrawerRespiratoryTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [showO2Form, setShowO2Form] = useState(false);
  const [showNebForm, setShowNebForm] = useState(false);

  const [o2Form, setO2Form] = useState({
    delivery_mode: 'Nasal Cannula',
    flow_rate: '',
    spo2_before: '',
    spo2_after: '',
    notes: '',
  });

  const [nebForm, setNebForm] = useState({
    medicine_name: '',
    dose: '',
    time_given: '',
    given_by: '',
    response: 'improved',
    notes: '',
  });

  const query = useApiQuery<{ Results: Record<string, unknown>[] }>(
    queryKeys.nurseStation.respiratory(bed.patient_id!),
    `/api/nursing/respiratory?patient_id=${bed.patient_id}${bed.admission_id ? `&admission_id=${bed.admission_id}` : ''}`,
  );

  const createMutation = useApiMutation('post', '/api/nursing/respiratory', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.respiratory(bed.patient_id!) });
      toast.success(t('drawer.respiratory.saved', { defaultValue: 'Saved successfully' }));
      setShowO2Form(false);
      setShowNebForm(false);
      setO2Form({ delivery_mode: 'Nasal Cannula', flow_rate: '', spo2_before: '', spo2_after: '', notes: '' });
      setNebForm({ medicine_name: '', dose: '', time_given: '', given_by: '', response: 'improved', notes: '' });
    },
    onError: () => {
      toast.error(t('drawer.respiratory.error', { defaultValue: 'Failed to save' }));
    },
  });

  const stopMutation = useApiMutation('post', '', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.respiratory(bed.patient_id!) });
      toast.success(t('drawer.respiratory.stopped', { defaultValue: 'O2 stopped' }));
    },
  });

  const records = query.data?.Results ?? [];

  const handleStartO2 = () => {
    if (!o2Form.flow_rate) return;
    createMutation.mutate({
      patient_id: bed.patient_id,
      admission_id: bed.admission_id,
      entry_type: 'oxygen',
      delivery_mode: o2Form.delivery_mode,
      flow_rate: parseFloat(o2Form.flow_rate),
      spo2_before: o2Form.spo2_before ? parseInt(o2Form.spo2_before) : undefined,
      spo2_after: o2Form.spo2_after ? parseInt(o2Form.spo2_after) : undefined,
      status: 'active',
      notes: o2Form.notes || undefined,
    });
  };

  const handleGiveNeb = () => {
    if (!nebForm.medicine_name) return;
    createMutation.mutate({
      patient_id: bed.patient_id,
      admission_id: bed.admission_id,
      entry_type: 'nebulization',
      medicine_name: nebForm.medicine_name,
      dose: nebForm.dose || undefined,
      time_given: nebForm.time_given || undefined,
      given_by: nebForm.given_by || undefined,
      response: nebForm.response as 'improved' | 'no_change' | 'worse',
      notes: nebForm.notes || undefined,
    });
  };

  const handleStopO2 = (id: number) => {
    stopMutation.mutate({ id });
  };

  return (
    <div className="space-y-4" data-testid="respiratory-tab">
      {/* Quick Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => { setShowO2Form(true); setShowNebForm(false); }}
          className="btn-primary flex items-center gap-1.5 text-sm"
          data-testid="start-o2-btn"
        >
          <Wind className="w-4 h-4" />
          {t('drawer.respiratory.startO2', { defaultValue: 'Start O₂' })}
        </button>
        <button
          onClick={() => { setShowNebForm(true); setShowO2Form(false); }}
          className="btn-primary flex items-center gap-1.5 text-sm"
          data-testid="give-neb-btn"
        >
          <Plus className="w-4 h-4" />
          {t('drawer.respiratory.giveNeb', { defaultValue: 'Give Nebulization' })}
        </button>
        <button
          onClick={() => {
            const activeO2 = records.find((r: Record<string, unknown>) => r.entry_type === 'oxygen' && r.status === 'active');
            if (activeO2) handleStopO2(activeO2.id as number);
            else toast.error(t('drawer.respiratory.noActiveO2', { defaultValue: 'No active O₂ to stop' }));
          }}
          className="btn-ghost flex items-center gap-1.5 text-sm text-red-600"
          data-testid="stop-o2-btn"
        >
          <StopCircle className="w-4 h-4" />
          {t('drawer.respiratory.stopO2', { defaultValue: 'Stop O₂' })}
        </button>
      </div>

      {/* O2 Form */}
      {showO2Form && (
        <div className="border border-[var(--color-border)] rounded-lg p-4 space-y-3" data-testid="o2-form">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">
            {t('drawer.respiratory.o2Title', { defaultValue: 'Oxygen Therapy' })}
          </h4>
          <div data-testid="o2-section" className="space-y-3">
            <div>
              <label className="label text-xs">{t('drawer.respiratory.deliveryMode', { defaultValue: 'Delivery Mode' })}</label>
              <select
                value={o2Form.delivery_mode}
                onChange={e => setO2Form(f => ({ ...f, delivery_mode: e.target.value }))}
                className="input"
                data-testid="o2-delivery-mode"
              >
                {O2_DELIVERY_MODES.map(mode => (
                  <option key={mode} value={mode}>{mode}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">{t('drawer.respiratory.flowRate', { defaultValue: 'Flow Rate (LPM)' })}</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="70"
                  value={o2Form.flow_rate}
                  onChange={e => setO2Form(f => ({ ...f, flow_rate: e.target.value }))}
                  placeholder="4"
                  className="input"
                  data-testid="o2-flow-rate"
                />
              </div>
              <div>
                <label className="label text-xs">{t('drawer.respiratory.status', { defaultValue: 'Status' })}</label>
                <input
                  type="text"
                  value="Active"
                  disabled
                  className="input bg-[var(--color-border-light)]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">{t('drawer.respiratory.spo2Before', { defaultValue: 'SpO₂ Before' })}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={o2Form.spo2_before}
                  onChange={e => setO2Form(f => ({ ...f, spo2_before: e.target.value }))}
                  placeholder="92"
                  className="input"
                  data-testid="spo2-before"
                />
              </div>
              <div>
                <label className="label text-xs">{t('drawer.respiratory.spo2After', { defaultValue: 'SpO₂ After' })}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={o2Form.spo2_after}
                  onChange={e => setO2Form(f => ({ ...f, spo2_after: e.target.value }))}
                  placeholder="98"
                  className="input"
                  data-testid="spo2-after"
                />
              </div>
            </div>
            <div>
              <label className="label text-xs">{t('notes', { defaultValue: 'Notes' })}</label>
              <textarea
                value={o2Form.notes}
                onChange={e => setO2Form(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="input resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleStartO2} className="btn-primary text-sm" disabled={createMutation.isPending}>
                {t('drawer.respiratory.save', { defaultValue: 'Save' })}
              </button>
              <button onClick={() => setShowO2Form(false)} className="btn-ghost text-sm">
                {t('cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nebulization Form */}
      {showNebForm && (
        <div className="border border-[var(--color-border)] rounded-lg p-4 space-y-3" data-testid="neb-form">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">
            {t('drawer.respiratory.nebTitle', { defaultValue: 'Nebulization' })}
          </h4>
          <div data-testid="neb-section" className="space-y-3">
            <div>
              <label className="label text-xs">{t('drawer.respiratory.medicine', { defaultValue: 'Medicine Name' })}</label>
              <input
                type="text"
                value={nebForm.medicine_name}
                onChange={e => setNebForm(f => ({ ...f, medicine_name: e.target.value }))}
                placeholder="Salbutamol"
                className="input"
                data-testid="neb-medicine"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">{t('drawer.respiratory.dose', { defaultValue: 'Dose' })}</label>
                <input
                  type="text"
                  value={nebForm.dose}
                  onChange={e => setNebForm(f => ({ ...f, dose: e.target.value }))}
                  placeholder="2.5mg"
                  className="input"
                  data-testid="neb-dose"
                />
              </div>
              <div>
                <label className="label text-xs">{t('drawer.respiratory.timeGiven', { defaultValue: 'Time Given' })}</label>
                <input
                  type="time"
                  value={nebForm.time_given}
                  onChange={e => setNebForm(f => ({ ...f, time_given: e.target.value }))}
                  className="input"
                  data-testid="neb-time"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">{t('drawer.respiratory.givenBy', { defaultValue: 'Given By' })}</label>
                <input
                  type="text"
                  value={nebForm.given_by}
                  onChange={e => setNebForm(f => ({ ...f, given_by: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="label text-xs">{t('drawer.respiratory.response', { defaultValue: 'Response' })}</label>
                <select
                  value={nebForm.response}
                  onChange={e => setNebForm(f => ({ ...f, response: e.target.value }))}
                  className="input"
                  data-testid="neb-response"
                >
                  {NEB_RESPONSES.map(r => (
                    <option key={r} value={r}>{t(`drawer.respiratory.response.${r}`, { defaultValue: r.replace('_', ' ') })}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label text-xs">{t('notes', { defaultValue: 'Notes' })}</label>
              <textarea
                value={nebForm.notes}
                onChange={e => setNebForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="input resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleGiveNeb} className="btn-primary text-sm" disabled={createMutation.isPending}>
                {t('drawer.respiratory.save', { defaultValue: 'Save' })}
              </button>
              <button onClick={() => setShowNebForm(false)} className="btn-ghost text-sm">
                {t('cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Records List */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">
          {t('drawer.respiratory.history', { defaultValue: 'Respiratory History' })}
        </h3>
        {records.length === 0 ? (
          <div className="text-center py-6 text-[var(--color-text-muted)]" data-testid="respiratory-empty">
            <Wind className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('drawer.respiratory.noRecords', { defaultValue: 'No respiratory records' })}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((record) => {
              const r = record as unknown as RespiratoryRecord;
              return (
              <div
                key={r.id}
                className="border border-[var(--color-border)] rounded-lg p-3"
                data-testid="respiratory-item"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      r.entry_type === 'oxygen'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    }`}>
                      {r.entry_type === 'oxygen' ? 'O₂' : 'Neb'}
                    </span>
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {r.entry_type === 'oxygen'
                        ? `${r.delivery_mode} @ ${r.flow_rate} LPM`
                        : `${r.medicine_name} ${r.dose || ''}`
                      }
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    r.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {r.status === 'active' ? 'Active' : 'Stopped'}
                  </span>
                </div>
                {r.entry_type === 'oxygen' && (r.spo2_before || r.spo2_after) && (
                  <div className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                    SpO₂: {r.spo2_before ?? '-'}% → {r.spo2_after ?? '-'}%
                  </div>
                )}
                {r.entry_type === 'nebulization' && r.response && (
                  <div className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                    Response: {r.response.replace('_', ' ')}
                  </div>
                )}
                {r.notes && (
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{r.notes}</p>
                )}
                <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                </p>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

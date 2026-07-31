import { useState } from 'react';
import {
  Users, Heart, ClipboardList, RefreshCw, AlertTriangle,
  UserCheck, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import toast from 'react-hot-toast';

interface AssignedPatient {
  admission_id: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  bed_number: string;
  ward_name: string;
  pending_tasks: number;
}

interface NurseAssignment {
  nurse_id: number;
  nurse_name: string;
  patient_count: number;
  total_pending_tasks: number;
  patients: AssignedPatient[];
}

interface AssignmentsResponse {
  Results: NurseAssignment[];
}

interface WorkloadStats {
  total_nurses: number;
  total_patients: number;
  avg_patients_per_nurse: number;
  busiest_nurse: {
    nurse_id: number;
    nurse_name: string;
    patient_count: number;
  } | null;
}

interface WardsResponse {
  Results: string[];
}

function getLoadColor(count: number): string {
  if (count > 8) return 'border-red-500 bg-red-50';
  if (count > 5) return 'border-yellow-500 bg-yellow-50';
  return 'border-green-500 bg-green-50';
}

function getLoadBadge(count: number, t: (key: string) => string): { label: string; className: string } {
  if (count > 8) return { label: t('nursing:workload.overloaded'), className: 'bg-red-100 text-red-700' };
  if (count > 5) return { label: t('nursing:workload.normal'), className: 'bg-yellow-100 text-yellow-700' };
  return { label: t('nursing:workload.normal'), className: 'bg-green-100 text-green-700' };
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className="p-2.5 bg-[var(--color-primary-light)] rounded-lg text-[var(--color-primary)]">
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-xl font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function NurseCard({ nurse, t }: { nurse: NurseAssignment; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const badge = getLoadBadge(nurse.patient_count, t);

  return (
    <div className={`bg-white rounded-xl border-l-4 ${getLoadColor(nurse.patient_count)} shadow-sm overflow-hidden`}>
      <div
        className="p-4 cursor-pointer flex items-center justify-between hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center text-[var(--color-primary)] font-semibold text-sm">
            {nurse.nurse_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="font-medium text-gray-900">{nurse.nurse_name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500">
                {nurse.patient_count} {t('nursing:workload.assignedPatients').toLowerCase()}
              </span>
              {nurse.total_pending_tasks > 0 && (
                <span className="text-xs text-orange-600">
                  {nurse.total_pending_tasks} {t('nursing:workload.pendingTasks').toLowerCase()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
            {badge.label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && nurse.patients.length > 0 && (
        <div className="border-t border-gray-100 px-4 pb-3">
          <div className="divide-y divide-gray-50">
            {nurse.patients.map((patient) => (
              <div key={patient.admission_id} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-400 w-16">{patient.bed_number || '—'}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{patient.patient_name}</p>
                    <p className="text-xs text-gray-400">{patient.patient_code}{patient.ward_name ? ` · ${patient.ward_name}` : ''}</p>
                  </div>
                </div>
                {patient.pending_tasks > 0 && (
                  <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                    {patient.pending_tasks}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {expanded && nurse.patients.length === 0 && (
        <div className="border-t border-gray-100 px-4 py-6 text-center text-sm text-gray-400">
          {t('nursing:workload.noNurses')}
        </div>
      )}
    </div>
  );
}

export default function NurseWorkloadPage({ role }: { role?: string }) {
  const { t } = useTranslation(['nursing', 'sidebar']);

  const [ward, setWard] = useState<string>('');

  const { data: assignments, isLoading, refetch } = useApiQuery<AssignmentsResponse>(
    queryKeys.nursing.assignments(ward ? { ward } : undefined),
    `/api/nursing/assignments${ward ? `?ward=${encodeURIComponent(ward)}` : ''}`,
  );

  const { data: stats } = useApiQuery<WorkloadStats>(
    queryKeys.nursing.workloadStats(),
    '/api/nursing/assignments/stats',
  );

  const { data: wards } = useApiQuery<WardsResponse>(
    ['nursing', 'wards'],
    '/api/nursing/assignments/wards',
  );

  const nurses = assignments?.Results ?? [];
  const sortedNurses = [...nurses].sort((a, b) => b.patient_count - a.patient_count);

  return (
    <DashboardLayout role={role ?? 'nurse'}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('nursing:workload.title')}</h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={ward}
              onChange={(e) => setWard(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            >
              <option value="">{t('nursing:workload.allWards')}</option>
              {wards?.Results?.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              title={t('nursing:medicationOrders.refresh')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label={t('nursing:workload.totalNurses')}
            value={stats?.total_nurses ?? '—'}
            icon={<Users className="w-5 h-5" />}
          />
          <StatCard
            label={t('nursing:workload.totalPatients')}
            value={stats?.total_patients ?? '—'}
            icon={<Heart className="w-5 h-5" />}
          />
          <StatCard
            label={t('nursing:workload.avgPerNurse')}
            value={stats?.avg_patients_per_nurse ?? '—'}
            icon={<ClipboardList className="w-5 h-5" />}
          />
          <StatCard
            label={t('nursing:workload.busiestNurse')}
            value={stats?.busiest_nurse?.nurse_name ?? '—'}
            icon={<AlertTriangle className="w-5 h-5" />}
          />
        </div>

        {/* Nurse cards */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            {t('nursing:carePlans.loading')}
          </div>
        ) : sortedNurses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <UserCheck className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">{t('nursing:workload.noNurses')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sortedNurses.map((nurse) => (
              <NurseCard key={nurse.nurse_id} nurse={nurse} t={t} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

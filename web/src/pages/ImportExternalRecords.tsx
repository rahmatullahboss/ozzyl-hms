import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, FileText, Building2, Shield, ShieldAlert,
  Heart, Pill, AlertTriangle, Activity, Stethoscope,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { api } from '../lib/apiClient';
import { ApiClientError } from '../lib/apiClient';

interface HospitalSummary {
  hospital_name: string;
  has_consent: boolean;
  summary: {
    patient: {
      name: string;
      age: number | null;
      gender: string | null;
      blood_group: string | null;
    };
    hospital: { name: string; generated_at: string };
    allergies: Array<{ allergen: string; severity: string | null; reaction: string | null }>;
    active_problems: Array<{ description: string; icd10_code: string | null; severity: string | null }>;
    current_medications: Array<{ medication_name: string; dosage: string | null; frequency: string | null; status: string }>;
    recent_diagnoses: Array<{ description: string | null; icd10_code: string | null }>;
    last_vitals: {
      recorded_at: string | null;
      temperature: number | null;
      pulse: number | null;
      systolic: number | null;
      diastolic: number | null;
      spo2: number | null;
    } | null;
    vaccinations: Array<{ vaccine_name: string; dose_number: number; administered_date: string; status: string }>;
    recent_lab_results: Array<{ test_name: string | null; result: string | null; abnormal_flag: string | null }>;
    last_discharge: { final_diagnosis: string | null; follow_up_instructions: string | null } | null;
  } | null;
}

interface LookupResult {
  found: boolean;
  national_id?: string;
  hospitals?: HospitalSummary[];
  message?: string;
}

export default function ImportExternalRecords({ role }: { role?: string }) {
  const { t } = useTranslation('patients');
  const [nidInput, setNidInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [tokenSummary, setTokenSummary] = useState<Record<string, unknown> | null>(null);
  const [mode, setMode] = useState<'nid' | 'token'>('nid');

  const handleNidLookup = async () => {
    if (!nidInput) return;
    setLoading(true);
    setLookupResult(null);
    try {
      const data = await api.get<LookupResult>(`/api/health-record/lookup?national_id=${nidInput}`);
      setLookupResult(data);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Lookup failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleTokenLookup = async () => {
    if (!tokenInput) return;
    setLoading(true);
    setTokenSummary(null);
    try {
      const data = await api.get<Record<string, unknown>>(`/api/health-record/summary/${tokenInput}`);
      setTokenSummary(data);
    } catch (err: unknown) {
      const status = (err as ApiClientError)?.status;
      if (status === 410) {
        toast.error(t('patients.token_expired_or_revoked'));
      } else if (status === 403) {
        toast.error(t('patients.patient_consent_has_been_revoked'));
      } else {
        toast.error(t('patients.invalid_or_expired_token'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <FileText className="w-7 h-7 text-teal-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Import External Records</h1>
            <p className="text-sm text-gray-500">External health record import</p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('nid')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'nid' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Search by NID
          </button>
          <button
            onClick={() => setMode('token')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'token' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Enter Token / QR Code
          </button>
        </div>

        {/* NID Search */}
        {mode === 'nid' && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">National ID Lookup</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={nidInput}
                onChange={(e) => setNidInput(e.target.value.replace(/\D/g, ''))}
                maxLength={17}
                placeholder={t("common.enter_10_or_17_digit_nid")}
                className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
              />
              <button
                onClick={handleNidLookup}
                disabled={loading || nidInput.length < 10}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Search className="w-4 h-4" /> {loading ? 'Searching...' : 'Search'}
              </button>
            </div>

            {lookupResult && !lookupResult.found && (
              <p className="text-sm text-gray-400">No patient found with this NID.</p>
            )}

            {lookupResult?.found && lookupResult.hospitals && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">NID: <span className="font-mono">{lookupResult.national_id}</span></p>
                {lookupResult.hospitals.map((h, i) => (
                  <HospitalCard key={i} hospital={h} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Token Input */}
        {mode === 'token' && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Access via Token</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value.trim())}
                placeholder={t("common.paste_health_record_access_token")}
                className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 focus:ring-teal-500"
              />
              <button
                onClick={handleTokenLookup}
                disabled={loading || tokenInput.length < 32}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Search className="w-4 h-4" /> {loading ? 'Loading...' : 'View'}
              </button>
            </div>

            {tokenSummary && (
              <SummaryDisplay summary={(tokenSummary as { summary: HospitalSummary['summary'] }).summary} />
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function HospitalCard({ hospital }: { hospital: HospitalSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
        onClick={() => hospital.has_consent && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium">{hospital.hospital_name}</span>
        </div>
        {hospital.has_consent ? (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Shield className="w-3 h-3" /> Consented
          </span>
        ) : (
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> No Consent
          </span>
        )}
      </div>
      {expanded && hospital.summary && (
        <div className="p-4 border-t">
          <SummaryDisplay summary={hospital.summary} />
        </div>
      )}
    </div>
  );
}

function SummaryDisplay({ summary }: { summary: HospitalSummary['summary'] }) {
  if (!summary) return <p className="text-sm text-gray-400">No data available.</p>;

  return (
    <div className="space-y-4">
      {/* Patient Info */}
      <div className="flex items-center gap-4 p-3 bg-teal-50 rounded-lg">
        <div>
          <p className="font-semibold text-gray-900">{summary.patient.name}</p>
          <p className="text-sm text-gray-500">
            {[
              summary.patient.age ? `${summary.patient.age} yrs` : null,
              summary.patient.gender,
              summary.patient.blood_group,
            ].filter(Boolean).join(' | ')}
          </p>
        </div>
      </div>

      {/* Allergies */}
      {summary.allergies.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> Allergies
          </h4>
          <div className="flex flex-wrap gap-2">
            {summary.allergies.map((a, i) => (
              <span key={i} className={`text-xs px-2 py-1 rounded-full ${
                a.severity === 'life_threatening' || a.severity === 'severe'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                {a.allergen}{a.severity ? ` (${a.severity})` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Active Problems */}
      {summary.active_problems.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
            <Heart className="w-3.5 h-3.5 text-rose-500" /> Active Problems
          </h4>
          <ul className="space-y-1">
            {summary.active_problems.map((p, i) => (
              <li key={i} className="text-sm text-gray-700">
                {p.description}
                {p.icd10_code && <span className="text-xs text-gray-400 ml-1">({p.icd10_code})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Medications */}
      {summary.current_medications.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
            <Pill className="w-3.5 h-3.5 text-blue-500" /> Current Medications
          </h4>
          <ul className="space-y-1">
            {summary.current_medications.map((m, i) => (
              <li key={i} className="text-sm text-gray-700">
                {m.medication_name}
                {m.dosage && <span className="text-gray-500"> {m.dosage}</span>}
                {m.frequency && <span className="text-gray-500"> {m.frequency}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Vitals */}
      {summary.last_vitals && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-green-500" /> Last Vitals
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {summary.last_vitals.systolic && (
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-400">BP</div>
                <div className="text-sm font-medium">{summary.last_vitals.systolic}/{summary.last_vitals.diastolic}</div>
              </div>
            )}
            {summary.last_vitals.pulse && (
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-400">Pulse</div>
                <div className="text-sm font-medium">{summary.last_vitals.pulse}</div>
              </div>
            )}
            {summary.last_vitals.spo2 && (
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-400">SpO2</div>
                <div className="text-sm font-medium">{summary.last_vitals.spo2}%</div>
              </div>
            )}
            {summary.last_vitals.temperature && (
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-400">Temp</div>
                <div className="text-sm font-medium">{summary.last_vitals.temperature}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Labs */}
      {summary.recent_lab_results.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
            <Stethoscope className="w-3.5 h-3.5 text-purple-500" /> Recent Lab Results
          </h4>
          <div className="space-y-1">
            {summary.recent_lab_results.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{l.test_name ?? 'Test'}</span>
                <span className={`font-medium ${
                  l.abnormal_flag && ['high', 'low', 'critical'].includes(l.abnormal_flag.toLowerCase())
                    ? 'text-red-600'
                    : 'text-gray-900'
                }`}>
                  {l.result ?? '—'}
                  {l.abnormal_flag && <span className="text-xs ml-1">({l.abnormal_flag})</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source */}
      <div className="text-xs text-gray-400 pt-2 border-t">
        Source: {summary.hospital.name} | Generated: {new Date(summary.hospital.generated_at).toLocaleString()}
      </div>
    </div>
  );
}

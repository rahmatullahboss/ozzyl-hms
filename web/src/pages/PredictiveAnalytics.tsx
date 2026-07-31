import { useParams } from 'react-router';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';

interface RiskData {
  sepsisScore?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  riskFactors?: string[];
  recommendation?: string;
  predictedLOS?: number;
  confidence?: string;
  factors?: {
    age?: number;
    diagnosisCount?: number;
    activeMeds?: number;
    gender?: string;
  };
  riskScore?: number;
  pendingLabs?: number;
  recentAdmissions?: number;
  vitalsMonitored?: number;
}

export default function PredictiveAnalytics() {
  const { slug, patientId } = useParams<{ slug: string; patientId: string }>();
  const { t } = useTranslation(['dashboard', 'common']);
  const basePath = `/h/${slug}`;

  const { data: sepsis, isLoading: l1 } = useApiQuery<RiskData>(
    patientId ? [...queryKeys.patientChart.detail(patientId), 'sepsis'] : ['sepsis', 'none'],
    patientId ? `/api/predictive/sepsis-risk/${patientId}` : '',
  );

  const { data: los, isLoading: l2 } = useApiQuery<RiskData>(
    patientId ? [...queryKeys.patientChart.detail(patientId), 'los'] : ['los', 'none'],
    patientId ? `/api/predictive/los-prediction/${patientId}` : '',
  );

  const { data: risk, isLoading: l3 } = useApiQuery<RiskData>(
    patientId ? [...queryKeys.patientChart.detail(patientId), 'risk'] : ['risk', 'none'],
    patientId ? `/api/predictive/patient-risk/${patientId}` : '',
  );

  const isLoading = l1 || l2 || l3;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--color-text-muted)]">Loading predictive analytics...</p>
        </div>
      </div>
    );
  }

  const getRiskColor = (level?: string) => {
    if (level === 'high') return 'bg-red-100 text-red-700 border-red-300';
    if (level === 'medium') return 'bg-amber-100 text-amber-700 border-amber-300';
    return 'bg-green-100 text-green-700 border-green-300';
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-4">
        {/* Header */}
        <div className="card p-4 flex items-center gap-3">
          <Link to={`${basePath}/patients/${patientId}/chart`} className="btn-ghost p-2">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-xl font-bold text-[var(--color-text)]">
            {t('predictiveAnalytics', { defaultValue: 'Predictive Analytics' })}
          </h1>
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">
            {t('epicCogito', { defaultValue: 'Epic Cogito Pattern' })}
          </span>
        </div>

        {/* Sepsis Risk Card */}
        {sepsis && (
          <div className={`card p-6 border-l-4 ${getRiskColor(sepsis.riskLevel)}`}>
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className={`w-8 h-8 ${sepsis.riskLevel === 'high' ? 'text-red-600' : sepsis.riskLevel === 'medium' ? 'text-amber-600' : 'text-green-600'}`} />
              <div>
                <h2 className="text-lg font-bold">Sepsis Risk Assessment</h2>
                <p className="text-sm opacity-80">SIRS-based prediction (Epic Cogito pattern)</p>
              </div>
              <div className="ml-auto text-right">
                <div className="text-3xl font-bold">{sepsis.sepsisScore}/4</div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${getRiskColor(sepsis.riskLevel)}`}>
                  {sepsis.riskLevel?.toUpperCase()}
                </span>
              </div>
            </div>
            {sepsis.riskFactors && sepsis.riskFactors.length > 0 && (
              <div className="mb-3">
                <h3 className="text-sm font-medium mb-2">Risk Factors:</h3>
                <div className="flex flex-wrap gap-2">
                  {sepsis.riskFactors.map((factor, i) => (
                    <span key={i} className="text-xs bg-[var(--color-bg)] px-2 py-1 rounded">
                      {factor}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-[var(--color-bg)]/50 p-3 rounded-lg">
              <p className="text-sm"><strong>Recommendation:</strong> {sepsis.recommendation}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LOS Prediction Card */}
          {los && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-[var(--color-primary)]" />
                <h2 className="font-semibold">Length of Stay Prediction</h2>
              </div>
              <div className="text-center mb-4">
                <div className="text-4xl font-bold text-[var(--color-primary)]">{los.predictedLOS}</div>
                <div className="text-sm text-[var(--color-text-muted)]">predicted days (Epic Cogito pattern)</div>
              </div>
              {los.factors && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Contributing Factors:</h3>
                  {los.factors.age && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--color-text-muted)]">Age</span>
                      <span className="font-medium">{los.factors.age}y</span>
                    </div>
                  )}
                  {los.factors.diagnosisCount !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--color-text-muted)]">Diagnoses</span>
                      <span className="font-medium">{los.factors.diagnosisCount}</span>
                    </div>
                  )}
                  {los.factors.activeMeds !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--color-text-muted)]">Active Meds</span>
                      <span className="font-medium">{los.factors.activeMeds}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-4 bg-[var(--color-bg)] p-3 rounded-lg">
                <p className="text-sm">{los.recommendation}</p>
              </div>
            </div>
          )}

          {/* Patient Risk Card */}
          {risk && (
            <div className={`card p-6 border-l-4 ${getRiskColor(risk.riskLevel)}`}>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className={`w-5 h-5 ${risk.riskLevel === 'high' ? 'text-red-600' : risk.riskLevel === 'medium' ? 'text-amber-600' : 'text-green-600'}`} />
                <h2 className="font-semibold">Overall Patient Risk</h2>
                <span className={`ml-auto text-xs px-2 py-1 rounded-full font-medium ${getRiskColor(risk.riskLevel)}`}>
                  {risk.riskLevel?.toUpperCase()} ({risk.riskScore}/3)
                </span>
              </div>
              {risk.pendingLabs !== undefined && (
                <div className="mb-3">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--color-text-muted)]">Pending Labs</span>
                    <span className={risk.pendingLabs > 0 ? 'text-amber-600 font-medium' : 'text-green-600'}>
                      {risk.pendingLabs}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--color-text-muted)]">Recent Admissions (90d)</span>
                    <span className="font-medium">{risk.recentAdmissions || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-text-muted)]">Vitals Monitored</span>
                    <span className={(risk.vitalsMonitored ?? 0) >= 3 ? 'text-green-600' : 'text-amber-600 font-medium'}>
                      {risk.vitalsMonitored ?? 0}/5 types
                    </span>
                  </div>
                </div>
              )}
              <div className="bg-[var(--color-bg)]/50 p-3 rounded-lg">
                <p className="text-sm"><strong>Recommendation:</strong> {risk.recommendation}</p>
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card p-4">
          <div className="flex gap-3">
            <Link to={`${basePath}/patients/${patientId}/chart`} className="btn-primary text-xs">
              Open Full Chart
            </Link>
            {sepsis?.riskLevel === 'high' && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`URGENT: Sepsis risk ${sepsis.sepsisScore}/4. ${sepsis.recommendation}`);
                  toast.success('Copied to clipboard');
                }}
                className="btn-ghost text-xs text-red-600"
              >
                Copy Alert to Clipboard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

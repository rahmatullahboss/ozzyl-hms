import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield, Search, Plus, X, QrCode, Link2, Eye, EyeOff,
  Clock, Trash2, ExternalLink, Building2, RefreshCw, AlertTriangle,
  BadgeCheck, ScanLine, Copy,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface LinkedRecord {
  hospital_name: string;
  is_current: boolean;
  linked_at: string;
}

interface Consent {
  id: number;
  consent_type: string;
  granted_to_tenant_id: number | null;
  is_active: number;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export default function HealthRecordSharing({ role }: { role?: string }) {
  const { t } = useTranslation('patients');
  const [patientId, setPatientId] = useState('');
  const [nationalIdDisplay, setNationalIdDisplay] = useState('');
  const [linkedRecords, setLinkedRecords] = useState<LinkedRecord[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(false);
  const [shareToken, setShareToken] = useState('');
  const [showNidForm, setShowNidForm] = useState(false);
  const [nidInput, setNidInput] = useState('');
  const [consentType, setConsentType] = useState<'view_summary' | 'view_full' | 'emergency_access'>('view_summary');
  const [durationHours, setDurationHours] = useState(720);
  const [showConsentForm, setShowConsentForm] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [tokenScope, setTokenScope] = useState<'summary' | 'full'>('summary');
  const [tokenDuration, setTokenDuration] = useState(24);
  const [uhid, setUhid] = useState<string | null>(null);
  const [showEmergencyForm, setShowEmergencyForm] = useState(false);
  const [emergencyNid, setEmergencyNid] = useState('');
  const [emergencyJustification, setEmergencyJustification] = useState('');
  const [emergencyResult, setEmergencyResult] = useState<Record<string, unknown> | null>(null);
  const [visitPassInput, setVisitPassInput] = useState('');
  const [visitPassResult, setVisitPassResult] = useState<{
    redeemed: boolean;
    scope: string;
    expires_at: string;
    hospitals: Array<{ tenant_id: string; hospital_name: string; summary: unknown }>;
  } | null>(null);
  const [visitPassLoading, setVisitPassLoading] = useState(false);

  const fetchLinkedRecords = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/health-record/linked-records?patient_id=${patientId}`, { headers: authHeader() });
      setLinkedRecords(data.linked_records ?? []);
      setNationalIdDisplay(data.national_id ?? '');
      setUhid(data.uhid ?? null);
    } catch {
      // NID not set yet
      setLinkedRecords([]);
      setNationalIdDisplay('');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const fetchConsents = useCallback(async () => {
    if (!patientId) return;
    try {
      const { data } = await axios.get(`/api/health-record/consents?patient_id=${patientId}`, { headers: authHeader() });
      setConsents(data.consents ?? []);
    } catch {
      setConsents([]);
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) {
      fetchLinkedRecords();
      fetchConsents();
    }
  }, [patientId, fetchLinkedRecords, fetchConsents]);

  const handleSetNid = async () => {
    if (!nidInput || !patientId) return;
    try {
      await axios.put(`/api/patients/${patientId}/national-id`, { national_id: nidInput }, { headers: authHeader() });
      toast.success(t('patients.national_id_updated'));
      setShowNidForm(false);
      setNidInput('');
      fetchLinkedRecords();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update NID';
      toast.error(msg);
    }
  };

  const handleGrantConsent = async () => {
    if (!patientId) return;
    try {
      await axios.post(`/api/health-record/consent?patient_id=${patientId}`, {
        consent_type: consentType,
        duration_hours: durationHours,
      }, { headers: authHeader() });
      toast.success(t('patients.consent_granted'));
      setShowConsentForm(false);
      fetchConsents();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to grant consent';
      toast.error(msg);
    }
  };

  const handleRevokeConsent = async (consentId: number) => {
    try {
      await axios.delete(`/api/health-record/consent/${consentId}`, {
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        data: { reason: 'Revoked by user' },
      });
      toast.success(t('patients.consent_revoked'));
      fetchConsents();
    } catch {
      toast.error(t('patients.failed_to_revoke_consent'));
    }
  };

  const handleGenerateToken = async () => {
    if (!patientId) return;
    try {
      const { data } = await axios.post(`/api/health-record/generate-token?patient_id=${patientId}`, {
        scope: tokenScope,
        duration_hours: tokenDuration,
      }, { headers: authHeader() });
      setShareToken(data.token);
      toast.success(t('patients.share_token_generated'));
      setShowTokenForm(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to generate token';
      toast.error(msg);
    }
  };

  const handlePrintQr = () => {
    if (!patientId) return;
    window.open(`/api/health-record/qr/${patientId}`, '_blank');
  };

  const consentTypeLabel = (type: string) => {
    switch (type) {
      case 'view_summary': return 'View Summary';
      case 'view_full': return 'View Full Record';
      case 'emergency_access': return 'Emergency Access';
      default: return type;
    }
  };

  const handleEmergencyAccess = async () => {
    if (!emergencyNid || !emergencyJustification) {
      toast.error(t('patients.both_nid_and_justification_are_required'));
      return;
    }
    if (emergencyJustification.length < 10) {
      toast.error(t('patients.justification_must_be_at_least_10_characters'));
      return;
    }
    try {
      const { data } = await axios.post('/api/health-record/emergency-access', {
        national_id: emergencyNid,
        justification: emergencyJustification,
      }, { headers: authHeader() });
      setEmergencyResult(data);
      setShowEmergencyForm(false);
      toast.success(t('patients.emergency_access_granted_4_hour_window'));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed';
      toast.error(msg);
    }
  };

  const handleRedeemVisitPass = async () => {
    if (!visitPassInput.trim()) {
      toast.error(t('patients.enter_a_visit_pass_token_or_code'));
      return;
    }
    setVisitPassLoading(true);
    try {
      const payload = visitPassInput.trim().startsWith('VP-')
        ? { pass_code: visitPassInput.trim() }
        : { token: visitPassInput.trim() };
      const { data } = await axios.post('/api/visit-pass/redeem', payload, { headers: authHeader() });
      setVisitPassResult(data);
      toast.success(t('patients.visit_pass_redeemed'));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to redeem visit pass';
      toast.error(msg);
    } finally {
      setVisitPassLoading(false);
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-7 h-7 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Health Record Sharing</h1>
              <p className="text-sm text-gray-500">স্বাস্থ্য রেকর্ড শেয়ারিং</p>
            </div>
          </div>
        </div>

        {/* Patient ID Input */}
        <div className="bg-white rounded-xl border p-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Patient ID</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              placeholder={t("staff.enter_patient_id")}
              className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
            <button
              onClick={() => { fetchLinkedRecords(); fetchConsents(); }}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 flex items-center gap-1"
            >
              <Search className="w-4 h-4" /> Load
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-teal-600" />
                Redeem Visit Pass
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                One simple code or QR token. Summary access only. No consent form needed.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold">
              <ScanLine className="w-3.5 h-3.5" />
              Hospital desk flow
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={visitPassInput}
              onChange={(e) => setVisitPassInput(e.target.value)}
              placeholder={t("staff.paste_token_or_enter_code_like_vpabc123")}
              className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
            />
            <button
              onClick={handleRedeemVisitPass}
              disabled={visitPassLoading}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60"
            >
              {visitPassLoading ? 'Redeeming...' : 'Redeem'}
            </button>
          </div>

          {visitPassResult && (
            <div className="p-4 bg-teal-50 border border-teal-200 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-teal-800 text-sm font-semibold">
                <Copy className="w-4 h-4" />
                Visit Pass Redeemed
              </div>
              <div className="text-xs text-gray-500">
                Summary access expires: {new Date(visitPassResult.expires_at).toLocaleString('en-BD')}
              </div>
              <div className="grid gap-2">
                {visitPassResult.hospitals.map((h) => (
                  <div key={h.tenant_id} className="rounded-lg bg-white border border-teal-100 p-3">
                    <div className="text-sm font-semibold text-gray-900">{h.hospital_name}</div>
                    <div className="text-xs text-gray-500 mt-1">Summary ready for viewing</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {patientId && (
          <>
            {/* NID & Linked Hospitals */}
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-teal-600" />
                  Linked Hospitals
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowNidForm(!showNidForm)}
                    className="text-sm px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Set NID
                  </button>
                  <button onClick={fetchLinkedRecords} className="p-1.5 text-gray-400 hover:text-gray-600">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {(nationalIdDisplay || uhid) && (
                <div className="flex items-center gap-3 flex-wrap">
                  {nationalIdDisplay && <p className="text-sm text-gray-500">NID: <span className="font-mono font-medium">{nationalIdDisplay}</span></p>}
                  {uhid && (
                    <span className="inline-flex items-center gap-1 text-sm font-mono font-bold bg-teal-50 text-teal-700 px-3 py-1 rounded-full">
                      <QrCode className="w-3.5 h-3.5" /> {uhid}
                    </span>
                  )}
                </div>
              )}

              {/* Emergency Access Button — clinical roles only */}
              {['doctor', 'nurse', 'hospital_admin'].includes(role ?? '') && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEmergencyForm(!showEmergencyForm)}
                  className="text-sm px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 flex items-center gap-1 font-medium"
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> Emergency Access
                </button>
              </div>
              )}

              {showEmergencyForm && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 text-red-700 text-sm font-semibold">
                    <AlertTriangle className="w-4 h-4" />
                    Break-Glass Emergency Access
                  </div>
                  <p className="text-xs text-red-600">This will grant immediate access to all records. The access is logged permanently and the patient will be notified.</p>
                  <input
                    type="text"
                    value={emergencyNid}
                    onChange={(e) => setEmergencyNid(e.target.value.replace(/\D/g, ''))}
                    placeholder={t("staff.patient_national_id_10_or_17_digits")}
                    maxLength={17}
                    className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:ring-2 focus:ring-red-400"
                  />
                  <textarea
                    value={emergencyJustification}
                    onChange={(e) => setEmergencyJustification(e.target.value)}
                    placeholder={t("staff.clinical_justification_required_min_10_chars")}
                    rows={2}
                    className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:ring-2 focus:ring-red-400 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleEmergencyAccess}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                    >
                      Declare Emergency &amp; Access Records
                    </button>
                    <button
                      onClick={() => setShowEmergencyForm(false)}
                      className="px-3 py-2 text-gray-500 text-sm hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {emergencyResult && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="text-sm font-semibold text-amber-800 mb-2">🚨 Emergency Access Active</div>
                  <pre className="text-xs text-gray-600 overflow-auto max-h-60 bg-white p-3 rounded">
                    {JSON.stringify(emergencyResult, null, 2)}
                  </pre>
                </div>
              )}

              {showNidForm && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">National ID (10 or 17 digits)</label>
                    <input
                      type="text"
                      value={nidInput}
                      onChange={(e) => setNidInput(e.target.value.replace(/\D/g, ''))}
                      maxLength={17}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                      placeholder={t("staff.eg_1234567890")}
                    />
                  </div>
                  <button onClick={handleSetNid} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">Save</button>
                  <button onClick={() => setShowNidForm(false)} className="p-2 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                </div>
              )}

              {loading ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : linkedRecords.length === 0 ? (
                <p className="text-sm text-gray-400">No linked hospitals. Set a National ID to enable cross-hospital sharing.</p>
              ) : (
                <div className="space-y-2">
                  {linkedRecords.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700">{r.hospital_name}</span>
                        {r.is_current && <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">Current</span>}
                      </div>
                      <span className="text-xs text-gray-400">{new Date(r.linked_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Consents */}
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-teal-600" />
                  Access Consents
                </h2>
                <button
                  onClick={() => setShowConsentForm(!showConsentForm)}
                  className="text-sm px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Grant Consent
                </button>
              </div>

              {showConsentForm && (
                <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Consent Type</label>
                    <select
                      value={consentType}
                      onChange={(e) => setConsentType(e.target.value as typeof consentType)}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    >
                      <option value="view_summary">View Summary</option>
                      <option value="view_full">View Full Record</option>
                      <option value="emergency_access">Emergency Access</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Duration (hours)</label>
                    <input
                      type="number"
                      value={durationHours}
                      onChange={(e) => setDurationHours(Number(e.target.value))}
                      min={1}
                      max={8760}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleGrantConsent} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">Grant</button>
                    <button onClick={() => setShowConsentForm(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
                  </div>
                </div>
              )}

              {consents.length === 0 ? (
                <p className="text-sm text-gray-400">No consents granted yet.</p>
              ) : (
                <div className="space-y-2">
                  {consents.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <div>
                        <span className="text-sm font-medium text-gray-700">{consentTypeLabel(c.consent_type)}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span className="text-xs text-gray-400">
                            Expires: {new Date(c.expires_at).toLocaleDateString()}
                          </span>
                          {c.revoked_at && <span className="text-xs text-red-500">Revoked</span>}
                        </div>
                      </div>
                      {c.is_active && !c.revoked_at ? (
                        <button
                          onClick={() => handleRevokeConsent(c.id)}
                          className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 flex items-center gap-1"
                        >
                          <EyeOff className="w-3 h-3" /> Revoke
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Inactive</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Share Actions */}
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-teal-600" />
                Share Health Record
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handlePrintQr}
                  className="flex items-center gap-2 px-4 py-3 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 text-sm font-medium"
                >
                  <QrCode className="w-5 h-5" />
                  <div className="text-left">
                    <div>Print QR Health Card</div>
                    <div className="text-xs text-teal-500 font-normal">কিউআর হেলথ কার্ড প্রিন্ট</div>
                  </div>
                </button>

                <button
                  onClick={() => setShowTokenForm(!showTokenForm)}
                  className="flex items-center gap-2 px-4 py-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium"
                >
                  <ExternalLink className="w-5 h-5" />
                  <div className="text-left">
                    <div>Generate Share Link</div>
                    <div className="text-xs text-blue-500 font-normal">শেয়ার লিংক তৈরি করুন</div>
                  </div>
                </button>
              </div>

              {showTokenForm && (
                <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Scope</label>
                      <select
                        value={tokenScope}
                        onChange={(e) => setTokenScope(e.target.value as 'summary' | 'full')}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      >
                        <option value="summary">Summary</option>
                        <option value="full">Full</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Duration (hours)</label>
                      <input
                        type="number"
                        value={tokenDuration}
                        onChange={(e) => setTokenDuration(Number(e.target.value))}
                        min={1}
                        max={720}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <button onClick={handleGenerateToken} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Generate Token</button>
                </div>
              )}

              {shareToken && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-xs text-green-700 mb-1 font-medium">Share this link (one-time display):</p>
                  <div className="flex gap-2">
                    <code className="flex-1 text-xs bg-white px-3 py-2 rounded border font-mono break-all">
                      {window.location.origin}/api/health-record/summary/{shareToken}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/api/health-record/summary/${shareToken}`);
                        toast.success(t('patients.copied_to_clipboard'));
                      }}
                      className="px-3 py-2 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

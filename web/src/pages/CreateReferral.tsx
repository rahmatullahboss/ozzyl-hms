import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import toast from 'react-hot-toast';
import {
  Send, Building2, User, Stethoscope, AlertTriangle, FileText,
  ChevronLeft, Plus, X, Clock,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';

interface Hospital {
  id: string;
  name: string;
  tenant_type: string;
  address: string | null;
}

interface Doctor {
  id: number;
  name: string;
  specialty: string | null;
}

interface Patient {
  id: number;
  name: string;
  patient_code: string;
  uhid: string;
}

interface ReferralDoc {
  document_type: string;
  title: string;
  storage_key?: string;
  document_url?: string;
}

export default function CreateReferral({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['referral', 'common', 'marketing']);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const referralHome = role === 'doctor' ? `/h/${slug}/doctor/referrals` : `/h/${slug}/referrals`;
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'emergency'>('routine');
  const [reason, setReason] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [documents, setDocuments] = useState<ReferralDoc[]>([]);
  const [searchHospital, setSearchHospital] = useState('');
  const [searchPatient, setSearchPatient] = useState('');

  const { data: hospitalsData, isLoading: loadingHospitals } = useApiQuery<{ data: Hospital[] }>(
    ['marketplace', 'hospitals', searchHospital],
    `/api/v1/marketplace/hospitals?q=${encodeURIComponent(searchHospital)}&limit=20`
  );
  const hospitals = hospitalsData?.data ?? [];

  const { data: doctorsData } = useApiQuery<{ data?: Doctor[]; doctors?: Doctor[] }>(
    ['doctors', 'list'],
    '/api/doctors'
  );
  const doctors = doctorsData?.doctors ?? doctorsData?.data ?? [];

  const { data: patientsData, isLoading: loadingPatients } = useApiQuery<{ patients: Patient[] }>(
    ['patients', 'search', searchPatient],
    `/api/patients?search=${encodeURIComponent(searchPatient)}&limit=20`
  );
  const patients = patientsData?.patients ?? [];

  const createReferralMutation = useApiMutation('post', '/api/v1/referrals', {
    onSuccess: () => {
      toast.success(t('create.actions.success'));
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      navigate(referralHome);
    },
    onError: (err: any) => toast.error(err.message || t('create.actions.failed')),
  });

  const canSubmit = selectedHospital && selectedPatient && reason.trim();

  const addDocument = () => {
    setDocuments([...documents, { document_type: 'clinical_note', title: '' }]);
  };

  const removeDocument = (idx: number) => {
    setDocuments(documents.filter((_, i) => i !== idx));
  };

  const updateDocument = (idx: number, field: keyof ReferralDoc, value: string) => {
    setDocuments(documents.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const handleSubmit = () => {
    if (!selectedHospital || !selectedPatient) return;
    createReferralMutation.mutate({
      to_tenant_id: selectedHospital.id,
      patient_global_id: selectedPatient.uhid,
      from_local_patient_id: selectedPatient.id,
      referring_doctor_id: selectedDoctor?.id ?? undefined,
      receiving_doctor_id: undefined,
      urgency,
      reason: reason.trim(),
      clinical_notes: clinicalNotes.trim() || undefined,
      documents: documents.filter(d => d.title.trim()).map(d => ({
        document_type: d.document_type,
        title: d.title.trim(),
        storage_key: d.storage_key,
        document_url: d.document_url,
      })),
    });
  };

  const urgencyColor = (u: string) => {
    if (u === 'emergency') return 'bg-red-100 text-red-700 border-red-300';
    if (u === 'urgent') return 'bg-amber-100 text-amber-700 border-amber-300';
    return 'bg-blue-100 text-blue-700 border-blue-300';
  };

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(referralHome)} className="btn-ghost p-2">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="page-title flex items-center gap-2">
              <Send className="w-6 h-6 text-[var(--color-primary)]" />
              {t('create.title')}
            </h1>
            <p className="section-subtitle mt-1">{t('create.subtitle')}</p>
          </div>
        </div>


        {/* Step 1: Select Hospital */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center text-sm font-bold">1</div>
            <h3 className="font-semibold">{t('create.steps.hospital')}</h3>
          </div>

          <input
            type="text"
            value={searchHospital}
            onChange={e => setSearchHospital(e.target.value)}
            placeholder={t('create.placeholders.searchHospital')}
            className="input w-full"
          />

          {loadingHospitals ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
          ) : hospitals.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('common:recordNotFound')}</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {hospitals.map(h => (
                <button
                  key={h.id}
                  onClick={() => setSelectedHospital(h)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${selectedHospital?.id === h.id ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-xl">
                      {h.tenant_type === 'chamber' ? '🩺' : '🏥'}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{h.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{h.address ?? t('common:n_a')}</p>
                    </div>
                    {selectedHospital?.id === h.id && <CheckIcon className="w-5 h-5 text-[var(--color-primary)] ml-auto" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: Select Patient */}
        {selectedHospital && (
          <div className="card p-5 space-y-4 animate-fade-in-up">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center text-sm font-bold">2</div>
              <h3 className="font-semibold">{t('create.steps.patient')}</h3>
            </div>

            <input
              type="text"
              value={searchPatient}
              onChange={e => setSearchPatient(e.target.value)}
              placeholder={t('create.placeholders.searchPatient')}
              className="input w-full"
            />

            {loadingPatients ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
            ) : patients.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('common:recordNotFound')}</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {patients.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatient(p)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${selectedPatient?.id === p.id ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center text-sm font-bold text-[var(--color-primary)]">
                        {p.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{p.patient_code}</p>
                      </div>
                      {selectedPatient?.id === p.id && <CheckIcon className="w-5 h-5 text-[var(--color-primary)] ml-auto" />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}


        {/* Step 3: Referral Details */}
        {selectedPatient && (
          <div className="card p-5 space-y-4 animate-fade-in-up">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center text-sm font-bold">3</div>
              <h3 className="font-semibold">{t('create.steps.details')}</h3>
            </div>

            {/* Urgency */}
            <div>
              <label className="label">{t('create.labels.urgency')}</label>
              <div className="flex gap-2">
                {(['routine', 'urgent', 'emergency'] as const).map(u => (
                  <button
                    key={u}
                    onClick={() => setUrgency(u)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border capitalize transition-all ${urgency === u ? urgencyColor(u) : 'bg-white border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
                  >
                    {u === 'emergency' ? <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> : u === 'urgent' ? <Clock className="w-3.5 h-3.5 inline mr-1" /> : null}
                    {t(`common:urgencies.${u}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Referring Doctor */}
            <div>
              <label className="label">{t('create.labels.doctor')}</label>
              <select
                value={selectedDoctor?.id ?? ''}
                onChange={e => {
                  const doc = doctors.find(d => d.id === Number(e.target.value));
                  setSelectedDoctor(doc ?? null);
                }}
                className="input w-full"
              >
                <option value="">{t('common:select') + ' ' + t('common:doctor')}...</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>{d.name} {d.specialty ? `(${t(`marketing:specialties.${d.specialty}`)})` : ''}</option>
                ))}
              </select>
            </div>

            {/* Reason */}
            <div>
              <label className="label">{t('create.labels.reason')}</label>
              <textarea
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('create.placeholders.reason')}
                className="input w-full resize-none"
              />
            </div>

            {/* Clinical Notes */}
            <div>
              <label className="label">{t('create.labels.clinicalNotes')}</label>
              <textarea
                rows={3}
                value={clinicalNotes}
                onChange={e => setClinicalNotes(e.target.value)}
                placeholder={t('create.placeholders.clinicalNotes')}
                className="input w-full resize-none"
              />
            </div>

            {/* Documents */}
            <div>
              <div className="flex items-center justify-between">
                <label className="label">{t('create.labels.attachedDocs')}</label>
                <button onClick={addDocument} className="btn-ghost text-xs flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> {t('create.actions.addDoc')}
                </button>
              </div>
              <div className="space-y-2 mt-2">
                {documents.map((doc, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <select
                      value={doc.document_type}
                      onChange={e => updateDocument(idx, 'document_type', e.target.value)}
                      className="input text-sm w-32 shrink-0"
                    >
                      {Object.entries(t('create.docTypes', { returnObjects: true })).map(([key, label]) => (
                        <option key={key} value={key}>{label as string}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={doc.title}
                      onChange={e => updateDocument(idx, 'title', e.target.value)}
                      placeholder={t('common:details') + '...'}
                      className="input text-sm flex-1"
                    />
                    <button onClick={() => removeDocument(idx)} className="btn-ghost text-red-600 p-1.5">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 bg-[var(--color-bg)] rounded-xl space-y-2">
              <h4 className="font-medium text-sm">{t('create.labels.summary')}</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <Building2 className="w-4 h-4" /> {t('common:to')}: <span className="font-medium text-[var(--color-text)]">{selectedHospital?.name}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <User className="w-4 h-4" /> {t('common:patient')}: <span className="font-medium text-[var(--color-text)]">{selectedPatient.name}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <AlertTriangle className="w-4 h-4" /> {t('create.labels.urgency')}: <span className={`font-medium capitalize ${urgency === 'emergency' ? 'text-red-600' : urgency === 'urgent' ? 'text-amber-600' : 'text-blue-600'}`}>{t(`common:urgencies.${urgency}`)}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <Stethoscope className="w-4 h-4" /> {t('create.labels.doctor')}: <span className="font-medium text-[var(--color-text)]">{selectedDoctor?.name ?? t('common:n_a')}</span>
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || createReferralMutation.isPending}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {createReferralMutation.isPending ? t('create.actions.sending') : t('create.actions.send')}
            </button>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

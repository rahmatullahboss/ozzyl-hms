import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { Calendar, User, FileText, Stethoscope, ChevronRight, Edit, Save, X, Clock, FlaskConical, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTimeGMT6 } from '../../lib/date-utils';

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface Visit {
  id: number;
  visit_number?: string;
  visit_date: string;
  visit_type?: string;
  status: string;
  doctor_name?: string;
  patient_id: number;
  patient_name?: string;
  patient_code?: string;
  chief_complaint?: string;
  notes?: string;
  diagnosis?: string;
  icd_codes?: string[];
  follow_up_date?: string;
  created_at: string;
  updated_at: string;
}

interface EncounterSummary {
  visit: Visit;
  soapNotes?: Array<{
    id: number;
    chief_complaint?: string;
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
    created_at: string;
  }>;
  prescriptions?: Array<{
    id: number;
    medication_name: string;
    dosage: string;
    frequency: string;
    created_at: string;
  }>;
  labOrders?: Array<{
    id: number;
    item_name: string;
    status: string;
    ordered_at: string;
    result?: string;
  }>;
  diagnoses?: Array<{
    id: number;
    diagnosis: string;
    icd_code?: string;
    status: string;
  }>;
  clinicalNotes?: Array<{
    id: number;
    note_type: string;
    title?: string;
    content: string;
    doctor_name?: string;
    created_at: string;
  }>;
}

type Tab = 'summary' | 'notes' | 'orders' | 'diagnosis';

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function VisitSummary({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('clinical');
  const { slug = '', id = '', visitId = '' } = useParams<{ slug: string; id: string; visitId: string }>();
  const queryClient = useQueryClient();
  const basePath = `/h/${slug}`;

  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [isEditing, setIsEditing] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editIcdCodes, setEditIcdCodes] = useState('');
  const [editChiefComplaint, setEditChiefComplaint] = useState('');
  const [editFollowUpDate, setEditFollowUpDate] = useState('');

  /* ── Data Fetching ─────────────────────────────────────────────────────── */

  const visitQuery = useApiQuery<{ visit: Visit }>(
    ['visits', 'detail', visitId],
    `/api/visits/${visitId}`,
    { enabled: !!visitId },
  );
  const visit = visitQuery.data?.visit;

  const summaryQuery = useApiQuery<EncounterSummary>(
    ['clinical', 'encounters', visitId, 'summary'],
    `/api/clinical/encounters/${visitId}/summary`,
    { enabled: !!visitId },
  );
  const summary = summaryQuery.data;

  /* ── Sync edit form with visit data ────────────────────────────────────── */

  useEffect(() => {
    if (visit) {
      setEditNotes(visit.notes || '');
      setEditIcdCodes((visit.icd_codes || []).join(', '));
      setEditChiefComplaint(visit.chief_complaint || '');
      setEditFollowUpDate(visit.follow_up_date || '');
    }
  }, [visit]);

  /* ── Mutations ─────────────────────────────────────────────────────────── */

  const updateVisitMutation = useApiMutation<unknown, { notes?: string; icdCodes?: string[]; chiefComplaint?: string; followUpDate?: string }>(
    'put',
    `/api/visits/${visitId}`,
    {
      onSuccess: () => {
        toast.success(t('clinical.visitUpdated', { defaultValue: 'Visit updated' }));
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: ['visits', 'detail', visitId] });
        queryClient.invalidateQueries({ queryKey: ['clinical', 'encounters', visitId, 'summary'] });
      },
      onError: () => toast.error(t('clinical.visitUpdateFailed', { defaultValue: 'Failed to update visit' })),
    },
  );

  /* ── Handlers ──────────────────────────────────────────────────────────── */

  const handleSave = () => {
    const icdCodes = editIcdCodes
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    updateVisitMutation.mutate({
      notes: editNotes || undefined,
      icdCodes: icdCodes.length > 0 ? icdCodes : undefined,
      chiefComplaint: editChiefComplaint || undefined,
      followUpDate: editFollowUpDate || undefined,
    });
  };

  const handleCancelEdit = () => {
    if (visit) {
      setEditNotes(visit.notes || '');
      setEditIcdCodes((visit.icd_codes || []).join(', '));
      setEditChiefComplaint(visit.chief_complaint || '');
      setEditFollowUpDate(visit.follow_up_date || '');
    }
    setIsEditing(false);
  };

  /* ── Loading / Error States ────────────────────────────────────────────── */

  if (visitQuery.isLoading) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--color-text-muted)]">{t('clinical.loadingVisit', { defaultValue: 'Loading visit data...' })}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (visitQuery.isError || !visit) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center text-[var(--color-text-muted)]">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>{t('clinical.visitNotFound', { defaultValue: 'Visit not found' })}</p>
            <Link to={`${basePath}/patients`} className="btn-primary mt-4 inline-block">
              {t('clinical.backToPatients', { defaultValue: 'Back to Patients' })}
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  /* ── Derived Data ──────────────────────────────────────────────────────── */

  const soapNotes = summary?.soapNotes ?? [];
  const prescriptions = summary?.prescriptions ?? [];
  const labOrders = summary?.labOrders ?? [];
  const diagnoses = summary?.diagnoses ?? [];
  const clinicalNotes = summary?.clinicalNotes ?? [];

  const tabs: { key: Tab; label: string; icon: typeof FileText; count?: number }[] = [
    { key: 'summary', label: t('clinical.summary', { defaultValue: 'Summary' }), icon: FileText },
    { key: 'notes', label: t('clinical.notes', { defaultValue: 'Notes' }), icon: FileText, count: clinicalNotes.length + soapNotes.length },
    { key: 'orders', label: t('clinical.orders', { defaultValue: 'Orders' }), icon: FlaskConical, count: labOrders.length },
    { key: 'diagnosis', label: t('clinical.diagnosis', { defaultValue: 'Diagnosis' }), icon: Stethoscope, count: diagnoses.length },
  ];

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <DashboardLayout role={role}>
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Link to={`${basePath}/patients`} className="hover:text-[var(--color-primary)]">
            {t('clinical.patients', { defaultValue: 'Patients' })}
          </Link>
          {visit.patient_id && (
            <>
              <ChevronRight className="w-4 h-4" />
              <Link to={`${basePath}/patients/${visit.patient_id}`} className="hover:text-[var(--color-primary)]">
                {visit.patient_name || `Patient #${visit.patient_id}`}
              </Link>
            </>
          )}
          <ChevronRight className="w-4 h-4" />
          <span className="text-[var(--color-text)] font-medium">
            {t('clinical.visit', { defaultValue: 'Visit' })} #{visit.visit_number || visit.id}
          </span>
        </div>

        {/* Visit Header */}
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
                <Calendar className="w-6 h-6 text-[var(--color-primary)]" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[var(--color-text)]">
                  {t('clinical.visit', { defaultValue: 'Visit' })} #{visit.visit_number || visit.id}
                </h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-[var(--color-text-muted)]">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDateTimeGMT6(visit.visit_date)}
                  </span>
                  {visit.visit_type && (
                    <span className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      {visit.visit_type}
                    </span>
                  )}
                  {visit.doctor_name && (
                    <span className="flex items-center gap-1.5">
                      <Stethoscope className="w-3.5 h-3.5" />
                      {visit.doctor_name}
                    </span>
                  )}
                  {visit.patient_name && (
                    <span className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" />
                      {visit.patient_name}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${
                    visit.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                    visit.status === 'active' ? 'bg-blue-100 text-blue-700' :
                    visit.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {visit.status}
                  </span>
                </div>
              </div>
            </div>
            {!isEditing ? (
              <button
                className="btn-ghost flex items-center gap-2 text-sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit className="w-4 h-4" />
                {t('clinical.edit', { defaultValue: 'Edit' })}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  className="btn-primary flex items-center gap-2 text-sm"
                  onClick={handleSave}
                  disabled={updateVisitMutation.isPending}
                >
                  <Save className="w-4 h-4" />
                  {updateVisitMutation.isPending
                    ? t('clinical.saving', { defaultValue: 'Saving...' })
                    : t('clinical.save', { defaultValue: 'Save' })}
                </button>
                <button
                  className="btn-ghost flex items-center gap-2 text-sm"
                  onClick={handleCancelEdit}
                >
                  <X className="w-4 h-4" />
                  {t('clinical.cancel', { defaultValue: 'Cancel' })}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="card p-0 overflow-hidden">
          <div className="flex overflow-x-auto border-b border-[var(--color-border)]">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-5">
            {/* ── Summary Tab ──────────────────────────────────────── */}
            {activeTab === 'summary' && (
              <div className="space-y-5">
                {/* Chief Complaint */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('clinical.chiefComplaint', { defaultValue: 'Chief Complaint' })}
                  </h3>
                  {isEditing ? (
                    <textarea
                      className="input min-h-[60px]"
                      value={editChiefComplaint}
                      onChange={e => setEditChiefComplaint(e.target.value)}
                      placeholder={t('clinical.chiefComplaintPlaceholder', { defaultValue: 'Main reason for visit...' })}
                    />
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {visit.chief_complaint || '—'}
                    </p>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('clinical.notes', { defaultValue: 'Notes' })}
                  </h3>
                  {isEditing ? (
                    <textarea
                      className="input min-h-[100px]"
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      placeholder={t('clinical.visitNotesPlaceholder', { defaultValue: 'Visit notes...' })}
                    />
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">
                      {visit.notes || '—'}
                    </p>
                  )}
                </div>

                {/* ICD Codes */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('clinical.icdCodes', { defaultValue: 'ICD-10 Codes' })}
                  </h3>
                  {isEditing ? (
                    <input
                      type="text"
                      className="input"
                      value={editIcdCodes}
                      onChange={e => setEditIcdCodes(e.target.value)}
                      placeholder={t('clinical.icdCodesPlaceholder', { defaultValue: 'e.g., J06.9, R05.9 (comma separated)' })}
                    />
                  ) : visit.icd_codes && visit.icd_codes.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {visit.icd_codes.map((code, i) => (
                        <span key={i} className="text-xs font-mono px-2.5 py-1 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                          {code}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)]">—</p>
                  )}
                </div>

                {/* Follow-up Date */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('clinical.followUpDate', { defaultValue: 'Follow-up Date' })}
                  </h3>
                  {isEditing ? (
                    <input
                      type="date"
                      className="input"
                      value={editFollowUpDate}
                      onChange={e => setEditFollowUpDate(e.target.value)}
                    />
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {visit.follow_up_date || '—'}
                    </p>
                  )}
                </div>

                {/* Latest SOAP Note Preview */}
                {soapNotes.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                      {t('clinical.latestSoap', { defaultValue: 'Latest SOAP Note' })}
                    </h3>
                    <div className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                      {soapNotes[0].chief_complaint && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-[var(--color-primary)]">CC:</span>
                          <p className="text-sm text-[var(--color-text)]">{soapNotes[0].chief_complaint}</p>
                        </div>
                      )}
                      {soapNotes[0].subjective && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-[var(--color-primary)]">S:</span>
                          <p className="text-sm text-[var(--color-text-muted)]">{soapNotes[0].subjective}</p>
                        </div>
                      )}
                      {soapNotes[0].objective && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-[var(--color-primary)]">O:</span>
                          <p className="text-sm text-[var(--color-text-muted)]">{soapNotes[0].objective}</p>
                        </div>
                      )}
                      {soapNotes[0].assessment && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-[var(--color-primary)]">A:</span>
                          <p className="text-sm text-[var(--color-text-muted)]">{soapNotes[0].assessment}</p>
                        </div>
                      )}
                      {soapNotes[0].plan && (
                        <div>
                          <span className="text-xs font-medium text-[var(--color-primary)]">P:</span>
                          <p className="text-sm text-[var(--color-text-muted)]">{soapNotes[0].plan}</p>
                        </div>
                      )}
                      <p className="text-xs text-[var(--color-text-muted)] mt-2">
                        {formatDateTimeGMT6(soapNotes[0].created_at)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Notes Tab ────────────────────────────────────────── */}
            {activeTab === 'notes' && (
              <div>
                {summaryQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <div key={i} className="skeleton h-20 rounded-lg" />)}
                  </div>
                ) : clinicalNotes.length > 0 || soapNotes.length > 0 ? (
                  <div className="space-y-3">
                    {/* SOAP Notes */}
                    {soapNotes.map(note => (
                      <div key={`soap-${note.id}`} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-700">SOAP</span>
                          <span className="text-xs text-[var(--color-text-muted)]">{formatDateTimeGMT6(note.created_at)}</span>
                        </div>
                        {note.chief_complaint && <p className="text-sm font-medium text-[var(--color-text)] mb-1">{note.chief_complaint}</p>}
                        {note.assessment && <p className="text-sm text-[var(--color-text-muted)]">{note.assessment}</p>}
                        {note.plan && <p className="text-xs text-[var(--color-text-muted)] mt-1">Plan: {note.plan}</p>}
                      </div>
                    ))}

                    {/* Clinical Notes */}
                    {clinicalNotes.map(note => (
                      <div key={`note-${note.id}`} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                              {note.note_type}
                            </span>
                            {note.title && <span className="text-sm font-medium text-[var(--color-text)]">{note.title}</span>}
                          </div>
                          <span className="text-xs text-[var(--color-text-muted)]">{formatDateTimeGMT6(note.created_at)}</span>
                        </div>
                        <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{note.content}</p>
                        {note.doctor_name && (
                          <p className="text-xs text-[var(--color-text-muted)] mt-1.5">{t('clinical.byDoctor', { defaultValue: 'By' })}: {note.doctor_name}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[var(--color-text-muted)]">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{t('clinical.noNotes', { defaultValue: 'No notes for this visit' })}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Orders Tab ───────────────────────────────────────── */}
            {activeTab === 'orders' && (
              <div>
                {summaryQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
                  </div>
                ) : labOrders.length > 0 ? (
                  <div className="space-y-2">
                    {labOrders.map(order => (
                      <div key={order.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <FlaskConical className="w-5 h-5 text-amber-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text)]">{order.item_name}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--color-text-muted)]">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDateTimeGMT6(order.ordered_at)}
                            </span>
                          </div>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          order.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                          order.status === 'result_ready' ? 'bg-green-100 text-green-700' :
                          order.status === 'collected' ? 'bg-blue-100 text-blue-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {order.status}
                        </span>
                        {order.result && (
                          <span className="text-xs text-[var(--color-text-muted)] max-w-[120px] truncate">{order.result}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[var(--color-text-muted)]">
                    <FlaskConical className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{t('clinical.noOrders', { defaultValue: 'No orders for this visit' })}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Diagnosis Tab ────────────────────────────────────── */}
            {activeTab === 'diagnosis' && (
              <div>
                {summaryQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
                  </div>
                ) : diagnoses.length > 0 ? (
                  <div className="space-y-2">
                    {diagnoses.map(dx => (
                      <div key={dx.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <Stethoscope className="w-5 h-5 text-[var(--color-primary)] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-text)]">{dx.diagnosis}</p>
                          {dx.icd_code && (
                            <span className="text-xs font-mono text-[var(--color-text-muted)]">{dx.icd_code}</span>
                          )}
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          dx.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                          dx.status === 'resolved' ? 'bg-slate-100 text-slate-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {dx.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-[var(--color-text-muted)]">
                    <Stethoscope className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{t('clinical.noDiagnoses', { defaultValue: 'No diagnoses recorded for this visit' })}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

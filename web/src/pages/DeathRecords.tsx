import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ChevronRight, Search, RefreshCw, Plus, X, FileText, AlertTriangle, Printer,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { printDeathCertificate } from '../lib/print/deathCertificateTemplate';
import { api } from '../lib/apiClient';

interface DeathRecord {
  id: number;
  admission_id: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  admission_no: string;
  date_of_death: string;
  time_of_death?: string;
  cause_of_death?: string;
  manner_of_death: string;
  certifying_doctor_name?: string;
  is_mlc: number;
  death_certificate_issued: number;
  ward?: string;
  bed_number?: string;
}

interface DeathRecordsResponse {
  records: DeathRecord[];
}

interface CreateDeathPayload {
  admission_id: number;
  patient_id: number;
  date_of_death: string;
  time_of_death?: string;
  cause_of_death?: string;
  secondary_cause?: string;
  manner_of_death: string;
  death_type_id?: number;
  certifying_doctor_id?: number;
  is_mlc: boolean;
  is_medico_legal?: boolean;
  is_autopsy_required: boolean;
  next_of_kin_name?: string;
  next_of_kin_relation?: string;
  next_of_kin_phone?: string;
  remarks?: string;
}

interface DeathType {
  id: number;
  name: string;
}

function fmt(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DeathRecords({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['ipd', 'common']);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    admission_id: 0,
    patient_id: 0,
    date_of_death: new Date().toISOString().split('T')[0],
    time_of_death: '',
    cause_of_death: '',
    secondary_cause: '',
    manner_of_death: 'natural',
    death_type_id: '',
    is_mlc: false,
    is_autopsy_required: false,
    next_of_kin_name: '',
    next_of_kin_relation: '',
    next_of_kin_phone: '',
    remarks: '',
  });

  const [admissionSearch, setAdmissionSearch] = useState('');

  const recordsQuery = useApiQuery<DeathRecordsResponse>(
    queryKeys.deathRecords.list({ search }),
    `/api/death-records?search=${encodeURIComponent(search)}`,
  );

  const admittedQuery = useApiQuery<{ admissions: { id: number; admission_no: string; patient_id: number; patient_name: string; patient_code: string }[] }>(
    queryKeys.admissions.list({ filter: 'admitted', search: admissionSearch }),
    `/api/admissions?status=admitted&search=${encodeURIComponent(admissionSearch)}`,
    { enabled: showForm },
  );

  const records = recordsQuery.data?.records ?? [];
  const admittedPatients = admittedQuery.data?.admissions ?? [];
  const deathTypesQuery = useApiQuery<{ death_types: DeathType[] }>(
    [...queryKeys.admissions.all, 'death-types'],
    '/api/admissions/death-types',
    { enabled: showForm },
  );
  const deathTypes = deathTypesQuery.data?.death_types ?? [];

  const createMutation = useApiMutation<{ success: boolean }, CreateDeathPayload>(
    'post',
    '/api/death-records',
    {
      onSuccess: () => {
        toast.success(t('deathRecords.recordedSuccess', { defaultValue: 'Death recorded successfully' }));
        setShowForm(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: queryKeys.deathRecords.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => {
        toast.error(err.message || t('deathRecords.failedToRecord', { defaultValue: 'Failed to record death' }));
      },
    },
  );

  const handlePrintCertificate = async (id: number) => {
    try {
      const res = await api.get<{ certificate: Record<string, any> }>(`/api/death-records/${id}/certificate`);
      const c = res.certificate;
      printDeathCertificate({
        certificateNo: c.death_certificate_no,
        patient: {
          name: c.patient_name,
          patientCode: c.patient_code,
          gender: c.gender,
          dateOfBirth: c.date_of_birth,
          address: c.address,
          nationalId: c.national_id,
        },
        admissionNo: c.admission_no,
        admissionDate: c.admission_date,
        dateOfDeath: c.date_of_death,
        timeOfDeath: c.time_of_death,
        causeOfDeath: c.cause_of_death,
        secondaryCause: c.secondary_cause,
        mannerOfDeath: c.manner_of_death,
        placeOfDeath: c.place_of_death,
        ward: c.ward_name,
        bed: c.bed_number,
        certifyingDoctor: c.certifying_doctor_name,
        isMlc: c.is_mlc === 1,
        nextOfKin: { name: c.next_of_kin_name, relation: c.next_of_kin_relation, phone: c.next_of_kin_phone },
      });
    } catch {
      toast.error(t('deathRecords.failedToLoadCert', { defaultValue: 'Failed to load certificate data' }));
    }
  };

  const resetForm = () => {
    setForm({
      admission_id: 0, patient_id: 0, date_of_death: new Date().toISOString().split('T')[0],
      time_of_death: '', cause_of_death: '', secondary_cause: '', manner_of_death: 'natural',
      death_type_id: '',
      is_mlc: false, is_autopsy_required: false, next_of_kin_name: '', next_of_kin_relation: '',
      next_of_kin_phone: '', remarks: '',
    });
    setAdmissionSearch('');
  };

  const handleSubmit = () => {
    if (!form.admission_id || !form.patient_id) {
      toast.error(t('deathRecords.pleaseSelectPatient', { defaultValue: 'Please select an admitted patient' }));
      return;
    }
    createMutation.mutate({
      ...form,
      time_of_death: form.time_of_death || undefined,
      cause_of_death: form.cause_of_death || undefined,
      secondary_cause: form.secondary_cause || undefined,
      death_type_id: form.death_type_id ? Number(form.death_type_id) : undefined,
      is_medico_legal: form.is_mlc,
      next_of_kin_name: form.next_of_kin_name || undefined,
      next_of_kin_relation: form.next_of_kin_relation || undefined,
      next_of_kin_phone: form.next_of_kin_phone || undefined,
      remarks: form.remarks || undefined,
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('dashboard', { ns: 'common' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/admissions`} className="hover:underline">{t('title')}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('deathRecords.title', { defaultValue: 'Death Records' })}</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('deathRecords.title', { defaultValue: 'Death Records' })}</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> {t('deathRecords.recordDeath', { defaultValue: 'Record Death' })}
            </button>
            <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.deathRecords.all })} className="btn-ghost p-2">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input type="text" placeholder={t('deathRecords.searchPlaceholder', { defaultValue: 'Search by patient name, code, or admission no...' })}
            value={search} onChange={e => setSearch(e.target.value)} className="input pl-10" />
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {recordsQuery.isLoading ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">{t('loading', { ns: 'common' })}</div>
          ) : records.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-10 h-10 mx-auto mb-2 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-[var(--color-text-muted)]">{t('deathRecords.noRecords', { defaultValue: 'No death records found' })}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg)]">
                  <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                    <th className="text-left px-4 py-3 font-medium">{t('deathRecords.patient', { defaultValue: 'Patient' })}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('deathRecords.admissionNo', { defaultValue: 'Admission No' })}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('deathRecords.dateOfDeath', { defaultValue: 'Date of Death' })}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('deathRecords.time', { defaultValue: 'Time' })}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('deathRecords.cause', { defaultValue: 'Cause' })}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('deathRecords.manner', { defaultValue: 'Manner' })}</th>
                    <th className="text-center px-4 py-3 font-medium">{t('deathRecords.mlc', { defaultValue: 'MLC' })}</th>
                    <th className="text-center px-4 py-3 font-medium">{t('deathRecords.certificate', { defaultValue: 'Certificate' })}</th>
                    <th className="text-center px-4 py-3 font-medium">{t('deathRecords.actions', { defaultValue: 'Actions' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {records.map(r => (
                    <tr key={r.id} className="hover:bg-[var(--color-bg)] transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--color-text)]">{r.patient_name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{r.patient_code}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--color-primary)]">{r.admission_no}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{fmt(r.date_of_death)}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{r.time_of_death || '—'}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)] max-w-[200px] truncate">{r.cause_of_death || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs capitalize bg-gray-100 rounded-full px-2 py-0.5">{t(`deathRecords.${r.manner_of_death}`, { defaultValue: r.manner_of_death })}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.is_mlc ? (
                          <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">{t('deathRecords.mlc', { defaultValue: 'MLC' })}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${r.death_certificate_issued ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {r.death_certificate_issued ? t('deathRecords.issued', { defaultValue: 'Issued' }) : t('deathRecords.pending', { defaultValue: 'Pending' })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => handlePrintCertificate(r.id)}
                          className="text-xs text-gray-600 hover:text-gray-800 font-medium flex items-center gap-1 mx-auto"
                          title="Print Death Certificate">
                          <Printer className="w-3 h-3" /> {t('deathRecords.printCertificate', { defaultValue: 'Certificate' })}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Record Death Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                  </div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">{t('deathRecords.recordInHospitalDeath', { defaultValue: 'Record In-Hospital Death' })}</h2>
                </div>
                <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Select Admitted Patient */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.admittedPatientRequired', { defaultValue: 'Admitted Patient *' })}</label>
                  <input type="text" placeholder={t('deathRecords.searchAdmittedPatients', { defaultValue: 'Search admitted patients...' })}
                    value={admissionSearch} onChange={e => setAdmissionSearch(e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                  {admittedPatients.length > 0 && admissionSearch.length >= 2 && !form.admission_id && (
                    <div className="mt-1 border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto bg-[var(--color-surface)]">
                      {admittedPatients.map(a => (
                        <button key={a.id} onClick={() => {
                          setForm(f => ({ ...f, admission_id: a.id, patient_id: a.patient_id }));
                          setAdmissionSearch(`${a.patient_name} (${a.admission_no})`);
                        }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)]">
                          <span className="font-medium">{a.patient_name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{a.admission_no}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.dateOfDeathRequired', { defaultValue: 'Date of Death *' })}</label>
                    <input type="date" value={form.date_of_death}
                      onChange={e => setForm(f => ({ ...f, date_of_death: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.timeOfDeath', { defaultValue: 'Time of Death' })}</label>
                    <input type="time" value={form.time_of_death}
                      onChange={e => setForm(f => ({ ...f, time_of_death: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.primaryCause', { defaultValue: 'Primary Cause of Death' })}</label>
                  <textarea value={form.cause_of_death}
                    onChange={e => setForm(f => ({ ...f, cause_of_death: e.target.value }))}
                    rows={2} placeholder={t('deathRecords.primaryCausePlaceholder', { defaultValue: 'Primary cause of death' })}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none" />
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.secondaryCause', { defaultValue: 'Secondary Cause' })}</label>
                  <input type="text" value={form.secondary_cause}
                    onChange={e => setForm(f => ({ ...f, secondary_cause: e.target.value }))}
                    placeholder={t('deathRecords.secondaryCausePlaceholder', { defaultValue: 'Contributing conditions' })}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.mannerOfDeath', { defaultValue: 'Manner of Death' })}</label>
                    <select value={form.manner_of_death}
                      onChange={e => setForm(f => ({ ...f, manner_of_death: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                      <option value="natural">{t('deathRecords.natural', { defaultValue: 'Natural' })}</option>
                      <option value="accident">{t('deathRecords.accident', { defaultValue: 'Accident' })}</option>
                      <option value="suicide">{t('deathRecords.suicide', { defaultValue: 'Suicide' })}</option>
                      <option value="homicide">{t('deathRecords.homicide', { defaultValue: 'Homicide' })}</option>
                      <option value="pending">{t('deathRecords.pendingInvestigation', { defaultValue: 'Pending Investigation' })}</option>
                      <option value="undetermined">{t('deathRecords.undetermined', { defaultValue: 'Undetermined' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.deathType', { defaultValue: 'Death Type' })}</label>
                    <select value={form.death_type_id}
                      onChange={e => setForm(f => ({ ...f, death_type_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                      <option value="">{t('deathRecords.select', { defaultValue: 'Select' })}</option>
                      {deathTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2 pt-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.is_mlc}
                        onChange={e => setForm(f => ({ ...f, is_mlc: e.target.checked }))}
                        className="rounded" />
                      {t('deathRecords.medicoLegalCase', { defaultValue: 'Medico-Legal Case (MLC)' })}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.is_autopsy_required}
                        onChange={e => setForm(f => ({ ...f, is_autopsy_required: e.target.checked }))}
                        className="rounded" />
                      {t('deathRecords.autopsyRequired', { defaultValue: 'Autopsy Required' })}
                    </label>
                  </div>
                </div>

                {/* Next of Kin */}
                <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-3 bg-[var(--color-bg)]">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('deathRecords.nextOfKin', { defaultValue: 'Next of Kin' })}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.nokName', { defaultValue: 'Name' })}</label>
                      <input type="text" value={form.next_of_kin_name}
                        onChange={e => setForm(f => ({ ...f, next_of_kin_name: e.target.value }))}
                        className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.nokRelation', { defaultValue: 'Relation' })}</label>
                      <input type="text" value={form.next_of_kin_relation}
                        onChange={e => setForm(f => ({ ...f, next_of_kin_relation: e.target.value }))}
                        className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.nokPhone', { defaultValue: 'Phone' })}</label>
                      <input type="tel" value={form.next_of_kin_phone}
                        onChange={e => setForm(f => ({ ...f, next_of_kin_phone: e.target.value }))}
                        className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('deathRecords.remarks', { defaultValue: 'Remarks' })}</label>
                  <textarea value={form.remarks}
                    onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                    rows={2} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none" />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button onClick={handleSubmit} disabled={createMutation.isPending || !form.admission_id}
                  className="btn-primary bg-red-600 hover:bg-red-700">
                  {createMutation.isPending ? t('deathRecords.recording', { defaultValue: 'Recording...' }) : t('deathRecords.recordDeath', { defaultValue: 'Record Death' })}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

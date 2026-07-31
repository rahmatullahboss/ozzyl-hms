import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import toast from 'react-hot-toast';
import {
  UserPlus, Globe, CheckCircle, ChevronRight, Building2, Stethoscope,
  CalendarDays, Star, AlertCircle, MapPin, Loader2,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';

interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  is_marketplace_visible?: number;
}

interface SetupStatus {
  doctors: { total: number; published: number };
  hospital: { isPublished: boolean; hasDescription: boolean; hasSpecialties: boolean; hasPhotos: boolean; hasLocation: boolean };
  schedules: { total: number };
  steps: { addDoctors: boolean; publishHospital: boolean; addSchedules: boolean; publishDoctors: boolean };
  isComplete: boolean;
}

const STEPS = [
  { key: 'doctors', label: 'Add Doctors', icon: Stethoscope },
  { key: 'hospital', label: 'Publish Hospital', icon: Building2 },
  { key: 'schedules', label: 'Set Schedules', icon: CalendarDays },
] as const;

export default function HospitalSetupWizard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['setup_wizard', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [showDoctorModal, setShowDoctorModal] = useState(false);

  // Doctor form
  const [docForm, setDocForm] = useState({
    name: '', specialty: '', mobileNumber: '', consultationFee: '',
    publicBio: '', languages: '', bmdcRegNo: '', qualifications: '',
    publishToMarketplace: true,
  });

  const { data: statusData, isLoading: loadingStatus } = useApiQuery<SetupStatus>(
    ['tenant', 'setup-status'],
    '/api/tenant/setup-status'
  );
  const status = statusData;

  const { data: doctorsData } = useApiQuery<{ data: Doctor[] }>(
    ['doctors', 'list'],
    '/api/doctors'
  );
  const doctors = doctorsData?.data ?? [];

  const createDoctorMutation = useApiMutation('post', '/api/doctors', {
    onSuccess: () => {
      toast.success(t('toasts.doctorAdded'));
      setShowDoctorModal(false);
      setDocForm({ name: '', specialty: '', mobileNumber: '', consultationFee: '', publicBio: '', languages: '', bmdcRegNo: '', qualifications: '', publishToMarketplace: true });
      queryClient.invalidateQueries({ queryKey: ['tenant', 'setup-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (err: any) => toast.error(err.message || t('toasts.doctorAddFailed')),
  });

  const publishHospitalMutation = useApiMutation('put', '/api/v1/marketplace/publish', {
    onSuccess: () => { toast.success(t('toasts.hospitalPublished')); queryClient.invalidateQueries({ queryKey: ['tenant', 'setup-status'] }); },
    onError: (err: any) => toast.error(err.message || t('toasts.failed')),
  });

  const publishDoctorMutation = useApiMutation('post', (vars: any) => `/api/doctors/${vars.id}/publish`, {
    onSuccess: () => { toast.success(t('toasts.doctorPublished')); queryClient.invalidateQueries({ queryKey: ['tenant', 'setup-status'] }); queryClient.invalidateQueries({ queryKey: ['doctors'] }); },
    onError: (err: any) => toast.error(err.message || t('toasts.failed')),
  });

  // Auto-advance step based on status
  useEffect(() => {
    if (!status) return;
    if (!status.steps.addDoctors) setActiveStep(0);
    else if (!status.steps.publishHospital) setActiveStep(1);
    else if (!status.steps.publishDoctors) setActiveStep(2);
    else setActiveStep(3);
  }, [status]);

  if (loadingStatus) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="page-title">{t('welcome.title')}</h1>
          <p className="section-subtitle">{t('welcome.subtitle')}</p>
        </div>

        {/* Progress Bar */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[var(--color-text-muted)]">{t('progress.title')}</span>
            <span className="text-sm font-bold text-[var(--color-primary)]">
              {status?.isComplete ? '100%' : `${Math.round(((status?.doctors.total ?? 0) > 0 ? 1 : 0) + (status?.hospital.isPublished ? 1 : 0) + (status?.steps.publishDoctors ? 1 : 0)) / 3 * 100}%`}
            </span>
          </div>
          <div className="w-full bg-[var(--color-border-light)] rounded-full h-2">
            <div
              className="h-2 rounded-full bg-[var(--color-primary)] transition-all"
              style={{ width: status?.isComplete ? '100%' : `${(((status?.doctors.total ?? 0) > 0 ? 1 : 0) + (status?.hospital.isPublished ? 1 : 0) + (status?.steps.publishDoctors ? 1 : 0)) / 3 * 100}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {/* Step 1: Add Doctors */}
          <div className={`card p-5 border-l-4 ${status?.steps.addDoctors ? 'border-emerald-500' : 'border-[var(--color-primary)]'}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${status?.steps.addDoctors ? 'bg-emerald-50 text-emerald-600' : 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'}`}>
                {status?.steps.addDoctors ? <CheckCircle className="w-5 h-5" /> : <Stethoscope className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{t('steps.addDoctors.title')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('steps.addDoctors.description')}</p>

                {doctors.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {doctors.map(d => (
                      <div key={d.id} className="flex items-center justify-between p-3 bg-[var(--color-bg)] rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center text-sm font-bold text-[var(--color-primary)]">
                            {d.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{d.name}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{d.specialty || t('steps.addDoctors.noSpecialty')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {d.is_marketplace_visible ? (
                            <span className="badge badge-success text-xs">{t('steps.addDoctors.published')}</span>
                          ) : (
                            <button onClick={() => publishDoctorMutation.mutate({ id: d.id })} className="btn-ghost text-xs text-blue-600">{t('steps.addDoctors.publish')}</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => setShowDoctorModal(true)} className="btn-primary text-sm mt-3 flex items-center gap-1">
                  <UserPlus className="w-4 h-4" /> {t('steps.addDoctors.button')}
                </button>
              </div>
            </div>
          </div>

          {/* Step 2: Publish Hospital */}
          <div className={`card p-5 border-l-4 ${status?.hospital.isPublished ? 'border-emerald-500' : status?.steps.addDoctors ? 'border-[var(--color-primary)]' : 'border-gray-200'}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${status?.hospital.isPublished ? 'bg-emerald-50 text-emerald-600' : status?.steps.addDoctors ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'bg-gray-50 text-gray-400'}`}>
                {status?.hospital.isPublished ? <CheckCircle className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{t('steps.publishHospital.title')}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('steps.publishHospital.description')}</p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasDescription ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasDescription ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {t('steps.publishHospital.descriptionLabel')}
                  </div>
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasSpecialties ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasSpecialties ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {t('steps.publishHospital.specialtiesLabel')}
                  </div>
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasPhotos ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasPhotos ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {t('steps.publishHospital.photosLabel')}
                  </div>
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasLocation ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasLocation ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {t('steps.publishHospital.locationLabel')}
                  </div>
                </div>

                <button
                  onClick={() => publishHospitalMutation.mutate({ body: { is_published: true } })}
                  disabled={!status?.steps.addDoctors || status?.hospital.isPublished}
                  className="btn-primary text-sm mt-3 flex items-center gap-1 disabled:opacity-50"
                >
                  <Globe className="w-4 h-4" />
                  {status?.hospital.isPublished ? t('steps.publishHospital.alreadyPublished') : t('steps.publishHospital.button')}
                </button>
              </div>
            </div>
          </div>

          {/* Step 3: Done */}
          {status?.isComplete && (
            <div className="card p-5 border-l-4 border-emerald-500 bg-emerald-50/50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-emerald-800">{t('steps.done.title')}</h3>
                  <p className="text-sm text-emerald-600">{t('steps.done.description')}</p>
                  <button onClick={() => navigate('/dashboard')} className="btn-primary text-sm mt-3">
                    {t('steps.done.goDashboard')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Doctor Modal */}
        {showDoctorModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold">{t('modal.addDoctor')}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="label">{t('modal.name')}</label><input className="input w-full" value={docForm.name} onChange={e => setDocForm((f: any) => ({ ...f, name: e.target.value }))} placeholder={t('modal.namePlaceholder')} /></div>
                <div><label className="label">{t('modal.specialty')}</label><input className="input w-full" value={docForm.specialty} onChange={e => setDocForm((f: any) => ({ ...f, specialty: e.target.value }))} placeholder={t('modal.specialtyPlaceholder')} /></div>
                <div><label className="label">{t('modal.fee')}</label><input type="number" className="input w-full" value={docForm.consultationFee} onChange={e => setDocForm((f: any) => ({ ...f, consultationFee: e.target.value }))} placeholder="0" /></div>
                <div><label className="label">{t('modal.mobile')}</label><input className="input w-full" value={docForm.mobileNumber} onChange={e => setDocForm((f: any) => ({ ...f, mobileNumber: e.target.value }))} placeholder={t('modal.mobilePlaceholder')} /></div>
                <div><label className="label">{t('modal.bmdc')}</label><input className="input w-full" value={docForm.bmdcRegNo} onChange={e => setDocForm((f: any) => ({ ...f, bmdcRegNo: e.target.value }))} placeholder={t('modal.bmdcPlaceholder')} /></div>
                <div className="col-span-2"><label className="label">{t('modal.qualifications')}</label><input className="input w-full" value={docForm.qualifications} onChange={e => setDocForm((f: any) => ({ ...f, qualifications: e.target.value }))} placeholder={t('modal.qualificationsPlaceholder')} /></div>
                <div className="col-span-2"><label className="label">{t('modal.languages')}</label><input className="input w-full" value={docForm.languages} onChange={e => setDocForm((f: any) => ({ ...f, languages: e.target.value }))} placeholder={t('modal.languagesPlaceholder')} /></div>
                <div className="col-span-2"><label className="label">{t('modal.bio')}</label><textarea rows={2} className="input w-full" value={docForm.publicBio} onChange={e => setDocForm((f: any) => ({ ...f, publicBio: e.target.value }))} placeholder={t('modal.bioPlaceholder')} /></div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" checked={docForm.publishToMarketplace} onChange={e => setDocForm((f: any) => ({ ...f, publishToMarketplace: e.target.checked }))} />
                  <label className="text-sm">{t('modal.publishImmediate')}</label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDoctorModal(false)} className="btn btn-secondary text-sm">{t('common.cancel')}</button>
                <button onClick={() => createDoctorMutation.mutate({
                  name: docForm.name,
                  specialty: docForm.specialty || undefined,
                  mobileNumber: docForm.mobileNumber || undefined,
                  consultationFee: Number(docForm.consultationFee) || 0,
                  publicBio: docForm.publicBio || undefined,
                  languages: docForm.languages ? docForm.languages.split(',').map((s: string) => s.trim()) : undefined,
                  bmdcRegNo: docForm.bmdcRegNo || undefined,
                  qualifications: docForm.qualifications || undefined,
                  publishToMarketplace: docForm.publishToMarketplace,
                })} disabled={createDoctorMutation.isPending || !docForm.name} className="btn btn-primary text-sm">{createDoctorMutation.isPending ? t('common.saving') : t('modal.addDoctor')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect } from 'react';
import { X, Percent } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import toast from 'react-hot-toast';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { Doctor } from './types';
import { VisitingHoursSelector } from './VisitingHoursSelector';
import { DoctorPhotoUploader } from './DoctorPhotoUploader';

interface Props {
  open: boolean;
  onClose: () => void;
  doctor: Doctor | null;
  onSuccess: () => void;
}

type AppointmentFeeType = 'new_patient' | 'old_patient' | 'follow_up' | 'report_show' | 'free_visit' | 'discounted_visit' | 'emergency';

interface DoctorAppointmentFeeDraft {
  appointmentType: AppointmentFeeType;
  fee: number;
  notes: string;
  isActive: boolean;
  eligibilityDays?: number;
}

interface DoctorFeeSetupResponse {
  doctor?: {
    id: number;
    name: string;
    consultationFee: number;
  };
  fees: Array<{
    id: number;
    appointment_type: AppointmentFeeType;
    fee: number;
    notes: string | null;
    is_active: number | boolean;
    eligibility_days?: number | null;
  }>;
}

interface CreateDoctorResponse {
  id: number;
  message: string;
  marketplacePublished?: boolean;
}

const FEE_TYPE_OPTIONS: Array<{ value: AppointmentFeeType; label: string }> = [
  { value: 'new_patient', label: 'New patient' },
  { value: 'old_patient', label: 'Follow up' },
  { value: 'report_show', label: 'Report show' },
  { value: 'free_visit', label: 'Free visit' },
  { value: 'emergency', label: 'Emergency' },
];

function defaultFeeForType(type: AppointmentFeeType, baseFee: number): number {
  return type === 'report_show' ? 0 : Math.max(0, Math.round(baseFee));
}

function defaultEligibilityDays(type: AppointmentFeeType): number | undefined {
  if (type === 'report_show') return 7;
  if (type === 'old_patient') return 30;
  return undefined;
}

function createDefaultFeeDrafts(baseFee: number): DoctorAppointmentFeeDraft[] {
  return FEE_TYPE_OPTIONS.map(option => ({
    appointmentType: option.value,
    fee: defaultFeeForType(option.value, baseFee),
    notes: '',
    isActive: true,
    eligibilityDays: defaultEligibilityDays(option.value),
  }));
}

function normalizeFeeDrafts(fees: DoctorAppointmentFeeDraft[]): DoctorAppointmentFeeDraft[] {
  return fees.map(row => ({
    ...row,
    fee: Math.max(0, Math.round(Number(row.fee || 0))),
    notes: row.notes.trim(),
    eligibilityDays: row.eligibilityDays ? Math.max(1, Math.round(Number(row.eligibilityDays))) : undefined,
  }));
}

export function DoctorDrawer({ open, onClose, doctor, onSuccess }: Props) {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'basic' | 'fees' | 'advanced' | 'marketplace'>('basic');

  const isEditing = !!doctor?.id;
  const baseConsultationFee = Number(doctor?.consultationFee ?? doctor?.consultation_fee ?? 0);

  const [form, setForm] = useState({
    name: doctor?.name ?? '',
    specialty: doctor?.specialty ?? '',
    department: doctor?.department ?? '',
    consultationFee: doctor?.consultationFee ?? doctor?.consultation_fee ?? 0,
    ipdRoundFee: doctor?.ipdRoundFee ?? doctor?.ipd_round_fee ?? 0,
    mobileNumber: doctor?.mobileNumber ?? doctor?.mobile_number ?? '',
    email: doctor?.email ?? '',
    bmdcRegNo: doctor?.bmdcRegNo ?? doctor?.bmdc_reg_no ?? '',
    qualifications: doctor?.qualifications ?? '',
    bio: doctor?.bio ?? '',
    publicBio: doctor?.publicBio ?? doctor?.public_bio ?? '',
    languages: doctor?.languages?.join(', ') ?? '',
    visitingHours: doctor?.visitingHours ?? doctor?.visiting_hours ?? '',
    photoKey: doctor?.photoKey ?? doctor?.photo_key ?? doctor?.profilePhotoKey ?? doctor?.profile_photo_key ?? '',
    displayOrder: doctor?.displayOrder ?? doctor?.display_order ?? 0,
    isAvailable: !!(doctor?.isAvailable ?? doctor?.is_available ?? 1),
    isMarketplaceVisible: !!(doctor?.isMarketplaceVisible ?? doctor?.is_marketplace_visible ?? 0),
  });
  const [feeDrafts, setFeeDrafts] = useState<DoctorAppointmentFeeDraft[]>(() => createDefaultFeeDrafts(baseConsultationFee));

  const feeSetupKey = ['doctor-fee-setup', doctor?.id ?? 'new'] as const;
  const { data: feeSetup, isLoading: feeSetupLoading } = useApiQuery<DoctorFeeSetupResponse>(
    feeSetupKey,
    `/api/appointments/fee-setup/${doctor?.id ?? 0}`,
    { enabled: open && isEditing },
  );

  useEffect(() => {
    const nextBaseFee = Number(doctor?.consultationFee ?? doctor?.consultation_fee ?? 0);
    setForm({
      name: doctor?.name ?? '',
      specialty: doctor?.specialty ?? '',
      department: doctor?.department ?? '',
      consultationFee: doctor?.consultationFee ?? doctor?.consultation_fee ?? 0,
      ipdRoundFee: doctor?.ipdRoundFee ?? doctor?.ipd_round_fee ?? 0,
      mobileNumber: doctor?.mobileNumber ?? doctor?.mobile_number ?? '',
      email: doctor?.email ?? '',
      bmdcRegNo: doctor?.bmdcRegNo ?? doctor?.bmdc_reg_no ?? '',
      qualifications: doctor?.qualifications ?? '',
      bio: doctor?.bio ?? '',
      publicBio: doctor?.publicBio ?? doctor?.public_bio ?? '',
      languages: doctor?.languages?.join(', ') ?? '',
      visitingHours: doctor?.visitingHours ?? doctor?.visiting_hours ?? '',
      photoKey: doctor?.photoKey ?? doctor?.photo_key ?? doctor?.profilePhotoKey ?? doctor?.profile_photo_key ?? '',
      displayOrder: doctor?.displayOrder ?? doctor?.display_order ?? 0,
      isAvailable: !!(doctor?.isAvailable ?? doctor?.is_available ?? 1),
      isMarketplaceVisible: !!(doctor?.isMarketplaceVisible ?? doctor?.is_marketplace_visible ?? 0),
    });
    setFeeDrafts(createDefaultFeeDrafts(nextBaseFee));
    setActiveTab('basic');
  }, [doctor]);

  useEffect(() => {
    if (!feeSetup) return;

    const currentBaseFee = Number(feeSetup.doctor?.consultationFee ?? baseConsultationFee);
    const rows = new Map(feeSetup.fees.map(row => [row.appointment_type, row]));
    setFeeDrafts(FEE_TYPE_OPTIONS.map(option => {
      const row = rows.get(option.value);
      return {
        appointmentType: option.value,
        fee: row ? Number(row.fee ?? 0) : defaultFeeForType(option.value, currentBaseFee),
        notes: row?.notes ?? '',
        isActive: row ? Boolean(Number(row.is_active)) : true,
        eligibilityDays: row?.eligibility_days ? Number(row.eligibility_days) : defaultEligibilityDays(option.value),
      };
    }));
  }, [feeSetup, baseConsultationFee]);

  const create = useApiMutation<CreateDoctorResponse, Record<string, unknown>>('post', '/api/doctors', {
    onError: () => toast.error(t('doctor.failedToSave', 'Failed to add doctor')),
  });

  const update = useApiMutation<unknown, Record<string, unknown>>(
    'put',
    () => `/api/doctors/${doctor!.id}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.updated', 'Doctor updated'));
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
        onSuccess();
      },
      onError: () => toast.error(t('doctor.failedToUpdate', 'Failed to update doctor')),
    },
  );

  const saveFeeSetup = useApiMutation<unknown, { doctorId: number; fees: DoctorAppointmentFeeDraft[] }>(
    'put',
    (variables) => `/api/appointments/fee-setup/${variables.doctorId}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.feeSetupSaved', 'Fee setup saved'));
        qc.invalidateQueries({ queryKey: feeSetupKey });
      },
      onError: (err) => toast.error(err.message || t('doctor.failedToSaveFees', 'Failed to save fee setup')),
    },
  );

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error(t('doctor.nameRequired', 'Doctor name is required'));
      return;
    }
    if (!form.consultationFee && form.consultationFee !== 0) {
      toast.error(t('doctor.feeRequired', 'Consultation fee is required'));
      return;
    }

    const languagesArray = form.languages
      ? form.languages.split(',').map(l => l.trim()).filter(Boolean)
      : undefined;

    const doctorPayload = {
      name: form.name,
      specialty: form.specialty || undefined,
      mobileNumber: form.mobileNumber || undefined,
      consultationFee: form.consultationFee,
      ipdRoundFee: form.ipdRoundFee,
      email: form.email || undefined,
      bmdcRegNo: form.bmdcRegNo || undefined,
      qualifications: form.qualifications || undefined,
      bio: form.bio || undefined,
      department: form.department || undefined,
      photoKey: form.photoKey || undefined,
      isAvailable: form.isAvailable,
      displayOrder: form.displayOrder,
      visitingHours: form.visitingHours || undefined,
      languages: languagesArray,
      publicBio: form.publicBio || undefined,
      isMarketplaceVisible: form.isMarketplaceVisible,
    };

    if (isEditing) {
      update.mutate(doctorPayload);
    } else {
      try {
        const created = await create.mutateAsync({
          ...doctorPayload,
          publishToMarketplace: form.isMarketplaceVisible,
        });

        await saveFeeSetup.mutateAsync({
          doctorId: created.id,
          fees: normalizeFeeDrafts(feeDrafts),
        });

        toast.success(t('doctor.created', 'Doctor added'));
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
        onSuccess();
      } catch {
        // Mutation-level toasts already show the specific failure.
      }
    }
  };

  const updateFeeDraft = (appointmentType: AppointmentFeeType, patch: Partial<DoctorAppointmentFeeDraft>) => {
    setFeeDrafts(prev => prev.map(row =>
      row.appointmentType === appointmentType ? { ...row, ...patch } : row,
    ));
  };

  const updateConsultationFee = (value: number) => {
    setForm({ ...form, consultationFee: value });
    if (!isEditing) {
      setFeeDrafts(createDefaultFeeDrafts(value));
    }
  };

  const handleSaveFeeSetup = () => {
    if (!isEditing) return;
    saveFeeSetup.mutate({
      doctorId: doctor.id,
      fees: normalizeFeeDrafts(feeDrafts),
    });
  };

  if (!open) return null;

  const tabs = [
    { key: 'basic' as const, label: t('doctor.basicInfo', 'Basic Info') },
    { key: 'fees' as const, label: t('doctor.fees', 'Fees') },
    { key: 'advanced' as const, label: t('doctor.details', 'Details') },
    { key: 'marketplace' as const, label: t('doctor.marketplace', 'Marketplace') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-[460px] bg-[var(--color-bg)] h-full overflow-y-auto shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {isEditing ? t('doctor.editDoctor', 'Edit Doctor') : t('doctor.addDoctor', 'Add New Doctor')}
            </h2>
            {isEditing && (
              <Link
                to={`/h/${slug}/commissions`}
                className="btn-secondary py-1 px-2 text-xs flex items-center gap-1.5"
                title={t('doctor.manageCommissions', 'Manage Commissions')}
              >
                <Percent className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">{t('doctor.commissions', 'Commissions')}</span>
              </Link>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Nav */}
        <div className="flex border-b border-[var(--color-border)] shrink-0">
          {tabs.map(tb => (
            <button
              key={tb.key}
              onClick={() => setActiveTab(tb.key)}
              className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tb.key
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ── Basic Info Tab ── */}
          {activeTab === 'basic' && (
            <>
              <div>
                <label className="label">{t('doctor.name', 'Name')} *</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="input"
                  placeholder={t('doctor.namePlaceholder')}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('doctor.specialty', 'Specialty')}</label>
                  <input
                    value={form.specialty}
                    onChange={e => setForm({ ...form, specialty: e.target.value })}
                    className="input"
                    placeholder={t('doctor.specialtyPlaceholder')}
                  />
                </div>
                <div>
                  <label className="label">{t('doctor.department', 'Department')}</label>
                  <input
                    value={form.department}
                    onChange={e => setForm({ ...form, department: e.target.value })}
                    className="input"
                    placeholder={t('doctor.departmentPlaceholder')}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('doctor.fee', 'Consultation Fee')} *</label>
                  <input
                    type="number"
                    value={form.consultationFee}
                    onChange={e => updateConsultationFee(Number(e.target.value))}
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="ipdRoundFee" className="label">{t('doctor.ipdRoundFee', 'IPD Round Fee')}</label>
                  <input
                    id="ipdRoundFee"
                    type="number"
                    min="0"
                    step="1"
                    value={form.ipdRoundFee}
                    onChange={e => setForm({ ...form, ipdRoundFee: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    className="input"
                  />
                </div>
              </div>
              <div>
                  <label className="label">{t('doctor.mobile', 'Mobile')}</label>
                  <input
                    value={form.mobileNumber}
                    onChange={e => setForm({ ...form, mobileNumber: e.target.value })}
                    className="input"
                    placeholder={t('doctor.mobilePlaceholder')}
                  />
              </div>
              <div>
                <label className="label">{t('doctor.email', 'Email')}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="input"
                  placeholder={t('doctor.emailPlaceholder')}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('doctor.bmdcNo', 'BMDC Reg No.')}</label>
                  <input
                    value={form.bmdcRegNo}
                    onChange={e => setForm({ ...form, bmdcRegNo: e.target.value })}
                    className="input"
                    placeholder={t('doctor.bmdcPlaceholder')}
                  />
                </div>
                <div>
                  <label className="label">{t('doctor.displayOrder', 'Display Order')}</label>
                  <input
                    type="number"
                    value={form.displayOrder}
                    onChange={e => setForm({ ...form, displayOrder: Number(e.target.value) })}
                    className="input"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isAvailable"
                  checked={form.isAvailable}
                  onChange={e => setForm({ ...form, isAvailable: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="isAvailable" className="text-sm text-[var(--color-text-secondary)]">
                  {t('doctor.availableForAppointments', 'Available for appointments')}
                </label>
              </div>
            </>
          )}

          {/* ── Fees Tab ── */}
          {activeTab === 'fees' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  {t('doctor.baseConsultationFee', 'Base consultation fee')}: ৳{Math.max(0, Math.round(Number(form.consultationFee || 0)))}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t('doctor.feeSetupHint', 'Appointment booking uses these server-side fees for new patient, follow-up, report-show, free, and emergency visits.')}
                </p>
              </div>

              {feeSetupLoading && isEditing ? (
                <div className="text-sm text-[var(--color-text-muted)]">{t('common.loading', 'Loading...')}</div>
              ) : (
                <div className="space-y-3">
                  {feeDrafts.map(row => {
                    const label = FEE_TYPE_OPTIONS.find(option => option.value === row.appointmentType)?.label ?? row.appointmentType;
                    return (
                      <div key={row.appointmentType} className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">
                              {row.appointmentType === 'free_visit'
                                ? t('doctor.freeVisitFeeHint', 'Original fee is stored for audit; final payable becomes zero.')
                                : row.appointmentType === 'report_show'
                                  ? t('doctor.reportShowFeeHint', 'Keep zero unless report-show visits should be billable.')
                                  : t('doctor.feeContextHint', 'Used when this appointment type is selected.')}
                            </p>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                            <input
                              type="checkbox"
                              checked={row.isActive}
                              onChange={e => updateFeeDraft(row.appointmentType, { isActive: e.target.checked })}
                              className="rounded"
                            />
                            {t('doctor.active', 'Active')}
                          </label>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] gap-3">
                          <div>
                            <label className="label">{t('doctor.fee', 'Fee')}</label>
                            <input
                              type="number"
                              min={0}
                              value={row.fee}
                              onChange={e => updateFeeDraft(row.appointmentType, { fee: Number(e.target.value) })}
                              className="input"
                            />
                          </div>
                          <div>
                            <label className="label">{t('doctor.notes', 'Notes')}</label>
                            <input
                              value={row.notes}
                              onChange={e => updateFeeDraft(row.appointmentType, { notes: e.target.value })}
                              className="input"
                              placeholder={t('doctor.feeNotesPlaceholder', 'Optional')}
                            />
                          </div>
                        </div>
                        {(row.appointmentType === 'report_show' || row.appointmentType === 'old_patient') && (
                          <div className="rounded-lg bg-[var(--color-border-light)] p-3">
                            <label className="label">
                              {row.appointmentType === 'report_show'
                                ? t('doctor.reportShowWindowDays', 'Report-show free window (days)')
                                : t('doctor.returningWindowDays', 'Follow-up discount window (days)')}
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={row.eligibilityDays ?? defaultEligibilityDays(row.appointmentType) ?? 1}
                              onChange={e => updateFeeDraft(row.appointmentType, { eligibilityDays: Number(e.target.value) })}
                              className="input max-w-[140px]"
                            />
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                              {row.appointmentType === 'report_show'
                                ? t('doctor.reportShowWindowHint', 'Reception can create report-show only if this doctor completed a visit in this many days.')
                                : t('doctor.returningWindowHint', 'Follow-up fee is allowed only if the patient completed a visit in this many days.')}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Details Tab ── */}
          {activeTab === 'advanced' && (
            <>
              <div>
                <label className="label">{t('doctor.qualifications', 'Qualifications')}</label>
                <input
                  value={form.qualifications}
                  onChange={e => setForm({ ...form, qualifications: e.target.value })}
                  className="input"
                  placeholder={t('doctor.qualificationsPlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('doctor.bio', 'Bio')}</label>
                <textarea
                  value={form.bio}
                  onChange={e => setForm({ ...form, bio: e.target.value })}
                  className="input"
                  rows={3}
                  placeholder={t('doctor.bioPlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('doctor.visitingHours', 'Visiting Hours')}</label>
                <VisitingHoursSelector
                  value={form.visitingHours}
                  onChange={val => setForm({ ...form, visitingHours: val })}
                />
              </div>
              <div>
                <DoctorPhotoUploader
                  photoKey={form.photoKey}
                  onUpload={key => setForm({ ...form, photoKey: key })}
                  onDelete={() => setForm({ ...form, photoKey: '' })}
                />
              </div>
            </>
          )}

          {/* ── Marketplace Tab ── */}
          {activeTab === 'marketplace' && (
            <>
              <div>
                <label className="label">{t('doctor.publicBio', 'Public Bio')}</label>
                <textarea
                  value={form.publicBio}
                  onChange={e => setForm({ ...form, publicBio: e.target.value })}
                  className="input"
                  rows={4}
                  placeholder={t('doctor.publicBioPlaceholder')}
                />
              </div>
              <div>
                <label className="label">{t('doctor.languages', 'Languages')}</label>
                <input
                  value={form.languages}
                  onChange={e => setForm({ ...form, languages: e.target.value })}
                  className="input"
                  placeholder={t('doctor.languagesPlaceholder')}
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t('doctor.languagesHint', 'Comma-separated list')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isMarketplaceVisible"
                  checked={form.isMarketplaceVisible}
                  onChange={e => setForm({ ...form, isMarketplaceVisible: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="isMarketplaceVisible" className="text-sm text-[var(--color-text-secondary)]">
                  {t('doctor.publishToMarketplace', 'Publish to public marketplace')}
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-[var(--color-border)] shrink-0">
          <button
            onClick={activeTab === 'fees' ? handleSaveFeeSetup : handleSubmit}
            disabled={create.isPending || update.isPending || saveFeeSetup.isPending || (activeTab === 'fees' && feeSetupLoading)}
            className="btn-primary flex-1"
          >
            {create.isPending || update.isPending || saveFeeSetup.isPending
              ? t('common.saving')
              : activeTab === 'fees'
                ? t('doctor.saveFeeSetup', 'Save fees')
              : isEditing
                ? t('common.update')
                : t('doctor.addDoctor')}
          </button>
          <button onClick={onClose} className="btn-secondary">
            {t('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useApiMutation } from '../../hooks/useApiQuery';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';

import { Doctor } from './types';
import { VisitingHoursSelector } from './VisitingHoursSelector';
import { DoctorPhotoUploader } from './DoctorPhotoUploader';
import { useTranslation } from 'react-i18next';

interface Props {
  doctor: Doctor | null;
  mode: 'detail' | 'drawer';
  onSuccess?: () => void;
}

export function DoctorForm({ doctor, mode, onSuccess }: Props) {
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: doctor?.name ?? '',
    specialty: doctor?.specialty ?? '',
    department: doctor?.department ?? '',
    consultationFee: doctor?.consultationFee ?? doctor?.consultation_fee ?? 0,
    mobileNumber: doctor?.mobileNumber ?? doctor?.mobile_number ?? '',
    email: doctor?.email ?? '',
    bio: doctor?.bio ?? '',
    bmdcRegNo: doctor?.bmdcRegNo ?? doctor?.bmdc_reg_no ?? '',
    qualifications: doctor?.qualifications ?? '',
    visitingHours: doctor?.visitingHours ?? doctor?.visiting_hours ?? '',
    photoKey: doctor?.photoKey ?? doctor?.photo_key ?? doctor?.profilePhotoKey ?? doctor?.profile_photo_key ?? '',
    displayOrder: doctor?.displayOrder ?? doctor?.display_order ?? 0,
    publicBio: doctor?.publicBio ?? doctor?.public_bio ?? '',
    languages: doctor?.languages?.join(', ') ?? '',
    isAvailable: !!(doctor?.isAvailable ?? doctor?.is_available ?? 1),
    isMarketplaceVisible: !!(doctor?.isMarketplaceVisible ?? doctor?.is_marketplace_visible ?? 0),
  });

  const update = useApiMutation<unknown, Record<string, unknown>>(
    'put',
    () => `/api/doctors/${doctor!.id}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.updated', 'Doctor updated'));
        qc.invalidateQueries({ queryKey: ['doctors'] });
        onSuccess?.();
      },
      onError: () => toast.error(t('doctor.failedToUpdate', 'Failed to update doctor')),
    },
  );

  const handleSubmit = () => {
    if (!doctor?.id) return;
    const languagesArray = form.languages
      ? form.languages.split(',').map(l => l.trim()).filter(Boolean)
      : undefined;
    update.mutate({
      name: form.name,
      specialty: form.specialty || undefined,
      mobileNumber: form.mobileNumber || undefined,
      consultationFee: form.consultationFee,
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
    });
  };

  const readonly = mode === 'detail';
  const inputClass = (extra = '') =>
    `w-full border rounded px-3 py-2 text-sm ${extra} ${readonly ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`;

  return (
    <div className="space-y-6">
      {/* Basic Info Section */}
      <div className="card p-6">
        <h3 className="section-title mb-4">{t('doctor.basicInfo', 'Basic Information')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('doctor.name', 'Name')}</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.specialty', 'Specialty')}</label>
            <input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.department', 'Department')}</label>
            <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.fee', 'Fee')} (BDT)</label>
            <input type="number" value={form.consultationFee} onChange={e => setForm({ ...form, consultationFee: Number(e.target.value) })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.mobile', 'Mobile')}</label>
            <input value={form.mobileNumber} onChange={e => setForm({ ...form, mobileNumber: e.target.value })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.email', 'Email')}</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.bmdcNo', 'BMDC Reg No.')}</label>
            <input value={form.bmdcRegNo} onChange={e => setForm({ ...form, bmdcRegNo: e.target.value })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.displayOrder', 'Display Order')}</label>
            <input type="number" value={form.displayOrder} onChange={e => setForm({ ...form, displayOrder: Number(e.target.value) })} className={inputClass()} readOnly={readonly} />
          </div>
        </div>
        <div className="mt-4">
          <label className="label">{t('doctor.bio', 'Bio')}</label>
          <textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} className={inputClass()} rows={3} readOnly={readonly} />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={form.isAvailable} onChange={e => setForm({ ...form, isAvailable: e.target.checked })} disabled={readonly} className="rounded" />
          <label className="text-sm">{t('doctor.availableForAppointments', 'Available for appointments')}</label>
        </div>
      </div>

      {/* Professional Details */}
      <div className="card p-6">
        <h3 className="section-title mb-4">{t('doctor.details', 'Professional Details')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('doctor.qualifications', 'Qualifications')}</label>
            <input value={form.qualifications} onChange={e => setForm({ ...form, qualifications: e.target.value })} className={inputClass()} readOnly={readonly} />
          </div>
          <div>
            <label className="label">{t('doctor.visitingHours', 'Visiting Hours')}</label>
            {readonly ? (
              <div className={inputClass()}>{form.visitingHours || t('common.notSet', 'Not set')}</div>
            ) : (
              <VisitingHoursSelector
                value={form.visitingHours}
                onChange={val => setForm({ ...form, visitingHours: val })}
              />
            )}
          </div>
          <div className="col-span-2">
            {readonly ? (
              <>
                <label className="label">{t('doctor.photoKey', 'Photo')}</label>
                {form.photoKey ? (
                  <img src={form.photoKey.startsWith('http') ? form.photoKey : `/api/doctors/photo/${encodeURIComponent(form.photoKey)}`} alt="Doctor" className="w-24 h-24 rounded-2xl object-cover border" />
                ) : (
                  <div className="text-sm text-gray-500 italic">{t('common.noPhoto', 'No photo uploaded')}</div>
                )}
              </>
            ) : (
              <DoctorPhotoUploader
                photoKey={form.photoKey}
                onUpload={key => setForm({ ...form, photoKey: key })}
                onDelete={() => setForm({ ...form, photoKey: '' })}
              />
            )}
          </div>
        </div>
      </div>

      {/* Marketplace Section */}
      <div className="card p-6">
        <h3 className="section-title mb-4">{t('doctor.marketplace', 'Marketplace Profile')}</h3>
        <div>
          <label className="label">{t('doctor.languages', 'Languages')}</label>
          <input value={form.languages} onChange={e => setForm({ ...form, languages: e.target.value })} className={inputClass()} readOnly={readonly} placeholder={t('doctor.languagesHint', 'Bangla, English')} />
        </div>
        <div className="mt-4">
          <label className="label">{t('doctor.publicBio', 'Public Bio')}</label>
          <textarea value={form.publicBio} onChange={e => setForm({ ...form, publicBio: e.target.value })} className={inputClass()} rows={4} readOnly={readonly} placeholder={t('doctor.publicBioHint', 'Bio visible on public marketplace...')} />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className={`badge ${form.isMarketplaceVisible ? 'badge-info' : 'badge-neutral'}`}>
            {form.isMarketplaceVisible ? t('doctor.published', 'Published to Marketplace') : t('doctor.private', 'Not on Marketplace')}
          </span>
        </div>
      </div>

      {!readonly && (
        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={update.isPending}
            className="btn-primary">
            {update.isPending ? t('common.saving', 'Saving...') : t('common.saveChanges', 'Save Changes')}
          </button>
        </div>
      )}
    </div>
  );
}

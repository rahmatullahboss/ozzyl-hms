import { useState, useEffect } from 'react';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface Doctor {
  id: number;
  name: string;
  specialty: string | null;
  department: string | null;
  mobile_number: string | null;
  email: string | null;
  consultation_fee: number;
  ipd_round_fee: number;
  bio: string | null;
  qualifications: string | null;
  visiting_hours: string | null;
  is_active: number;
  is_available: number;
  bmdc_reg_no: string | null;
  is_marketplace_visible: number;
}

export default function DoctorProfile() {
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();
  const { data, isLoading } = useApiQuery<{ doctors: Doctor[] }>(
    ['doctor', 'me'],
    '/api/doctors?status=all',
  );
  const me = data?.doctors?.[0];

  const [form, setForm] = useState<Partial<Doctor>>({});
  useEffect(() => {
    if (me) setForm(me);
  }, [me]);

  const update = useApiMutation<unknown, Partial<Doctor>>(
    'put',
    () => `/api/doctors/${me?.id}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.profile_saved', 'Profile updated'));
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t('doctor.update_failed', 'Update failed')),
    },
  );

  if (isLoading) {
    return (
      <DashboardLayout role="doctor">
        <div className="p-6">{t('common:loading', 'Loading…')}</div>
      </DashboardLayout>
    );
  }

  if (!me) {
    return (
      <DashboardLayout role="doctor">
        <div className="p-6">{t('doctor.no_profile', 'No doctor profile linked to your account. Contact admin.')}</div>
      </DashboardLayout>
    );
  }

  const field = (key: keyof Doctor, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <DashboardLayout role="doctor">
      <div className="space-y-4 max-w-3xl mx-auto p-6">
        <h1 className="page-title">{t('doctor.my_profile', 'My Profile')}</h1>

        <div className="card p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('doctor.name', 'Name')}</label>
              <input className="input" value={form.name ?? ''} onChange={(e) => field('name', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.specialty', 'Specialty')}</label>
              <input className="input" value={form.specialty ?? ''} onChange={(e) => field('specialty', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.department', 'Department')}</label>
              <input className="input" value={form.department ?? ''} onChange={(e) => field('department', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.mobile', 'Mobile')}</label>
              <input className="input" value={form.mobile_number ?? ''} onChange={(e) => field('mobile_number', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.email', 'Email')}</label>
              <input type="email" className="input" value={form.email ?? ''} onChange={(e) => field('email', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.bmdc', 'BMDC Reg No')}</label>
              <input className="input" value={form.bmdc_reg_no ?? ''} onChange={(e) => field('bmdc_reg_no', e.target.value)} />
            </div>
            <div>
              <label className="label">{t('doctor.consultation_fee', 'Consultation Fee')}</label>
              <input
                type="number"
                className="input"
                value={form.consultation_fee ?? 0}
                onChange={(e) => field('consultation_fee', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">{t('doctor.ipdRoundFee', 'IPD Round Fee')}</label>
              <input type="number" className="input bg-gray-100" value={form.ipd_round_fee ?? 0} disabled />
            </div>
            <div>
              <label className="label">{t('doctor.visiting_hours', 'Visiting Hours')}</label>
              <input className="input" value={form.visiting_hours ?? ''} onChange={(e) => field('visiting_hours', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">{t('doctor.qualifications', 'Qualifications')}</label>
              <input className="input" value={form.qualifications ?? ''} onChange={(e) => field('qualifications', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="label">{t('doctor.bio', 'Bio')}</label>
              <textarea
                className="input"
                rows={3}
                value={form.bio ?? ''}
                onChange={(e) => field('bio', e.target.value)}
              />
            </div>
            <div>
              <label className="label flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.is_marketplace_visible}
                  onChange={(e) => field('is_marketplace_visible', e.target.checked ? 1 : 0)}
                />
                {t('doctor.on_marketplace', 'Show on marketplace')}
              </label>
            </div>
            <div>
              <label className="label flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.is_available}
                  onChange={(e) => field('is_available', e.target.checked ? 1 : 0)}
                />
                {t('doctor.available', 'Available for appointments')}
              </label>
            </div>
            <div>
              <label className="label" title={t('doctor.is_active_tooltip', 'Contact admin to change')}>
                {t('doctor.is_active', 'Active')}
              </label>
              <input className="input bg-gray-100" value={form.is_active ? 'Yes' : 'No'} disabled />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {t('doctor.is_active_help', 'Only admins can change this')}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              className="btn-primary"
              onClick={() => {
                const { is_active, ...payload } = form as Doctor;
                update.mutate(payload);
              }}
              disabled={update.isPending}
            >
              {update.isPending ? t('common:saving', 'Saving…') : t('common:save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

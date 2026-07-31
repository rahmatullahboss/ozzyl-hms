import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/apiClient';
import { saveToken } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  User,
  Mail,
  Lock,
  Activity,
  Heart,
  Stethoscope,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

interface FormData {
  hospitalName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  confirmPassword: string;
}

export default function HospitalSignup() {
  const { t } = useTranslation('auth');

  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormData>({
    hospitalName: '',
    slug: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: '',
  });

  function toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function handleHospitalNameChange(value: string) {
    setForm((f) => ({
      ...f,
      hospitalName: value,
      slug: toSlug(value),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.adminPassword !== form.confirmPassword) {
      toast.error(t('passwordsNoMatch', { defaultValue: 'Passwords do not match' }));
      return;
    }
    if (form.slug.length < 3) {
      toast.error(t('slugTooShort', { defaultValue: 'Slug must be at least 3 characters' }));
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{
        token: string;
        slug: string;
        user: { role: string };
      }>('/api/register', {
        hospitalName: form.hospitalName,
        slug: form.slug,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
      });

      saveToken(res.token, res.slug);
      toast.success(t('welcomeHospital', { defaultValue: 'Welcome! Hospital "{{hospitalName}}" registered.', hospitalName: form.hospitalName }));
      navigate(`/h/${res.slug}/dashboard`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('registrationFailed', { defaultValue: 'Registration failed' });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left Panel: Form ── */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-24 bg-white dark:bg-slate-900 py-8">
        {/* Logo */}
        <div className="mb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              Ozzyl Health
            </span>
          </div>
        </div>

        {/* Heading */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white leading-tight">
            {t('registerHospital', { defaultValue: 'Register your hospital' })}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('signupSubtitle', { defaultValue: 'Set up your hospital management system in minutes — completely free.' })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          {/* Hospital Name */}
          <div>
            <label htmlFor="hospitalName" className="label">
              {t('hospitalNameLabel', { defaultValue: 'Hospital Name' })}
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="hospitalName"
                type="text"
                placeholder={t('hospitalNamePlaceholder', { defaultValue: 'City General Hospital' })}
                value={form.hospitalName}
                onChange={(e) => handleHospitalNameChange(e.target.value)}
                required
                autoFocus
                className="input pl-10"
              />
            </div>
          </div>

          {/* Slug preview */}
          {form.slug && (
            <div className="flex items-center gap-1.5 text-xs bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400">{t('yourUrl', { defaultValue: 'Your URL:' })}</span>
              <code className="font-mono text-cyan-600 dark:text-cyan-400">
                /h/{form.slug}/dashboard
              </code>
              {form.slug.length >= 3 && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
              )}
            </div>
          )}

          {/* Admin Name */}
          <div>
            <label htmlFor="adminName" className="label">
              {t('fullNameLabel', { defaultValue: 'Your Full Name' })}
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="adminName"
                type="text"
                placeholder={t('fullNamePlaceholder', { defaultValue: 'Dr. John Doe' })}
                value={form.adminName}
                onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
                required
                className="input pl-10"
              />
            </div>
          </div>

          {/* Admin Email */}
          <div>
            <label htmlFor="adminEmail" className="label">
              {t('adminEmailLabel', { defaultValue: 'Admin Email' })}
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="adminEmail"
                type="email"
                placeholder={t('adminEmailPlaceholder', { defaultValue: 'admin@hospital.com' })}
                value={form.adminEmail}
                onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                required
                className="input pl-10"
              />
            </div>
          </div>

          {/* Password row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="adminPassword" className="label">
                {t('passwordLabel', { defaultValue: 'Password' })}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="adminPassword"
                  type="password"
                  placeholder={t('passwordPlaceholder', { defaultValue: 'Min 8 chars' })}
                  value={form.adminPassword}
                  onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                  required
                  minLength={8}
                  className="input pl-10"
                />
              </div>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="label">
                {t('confirmPasswordLabel', { defaultValue: 'Confirm' })}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="confirmPassword"
                  type="password"
                  placeholder={t('repeatPasswordPlaceholder', { defaultValue: 'Repeat' })}
                  value={form.confirmPassword}
                  onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  required
                  minLength={8}
                  className="input pl-10"
                />
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="btn-primary w-full py-3 text-base font-semibold shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-all"
            disabled={loading}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('creatingAccount', { defaultValue: 'Creating account…' })}
              </>
            ) : (
              t('createHospitalAccountBtn', { defaultValue: 'Create Hospital Account' })
            )}
          </button>
        </form>

        {/* Sign in link */}
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          {t('haveAccount', { defaultValue: 'Already have an account?' })}{' '}
          <a
            href="/login"
            className="font-semibold text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
          >
            {t('signIn', { defaultValue: 'Sign in' })}
          </a>
        </p>

        {/* HIPAA badge */}
        <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-400 max-w-sm">
          <ShieldCheck className="w-3.5 h-3.5" />
          {t('hipaaProtected', { defaultValue: 'Protected by HIPAA-grade security' })}
        </div>
      </div>

      {/* ── Right Panel: Branding ── */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-teal-50 via-cyan-50/60 to-emerald-100 dark:from-slate-800 dark:via-teal-950/40 dark:to-slate-900 items-center justify-center relative overflow-hidden">
        {/* Decorative blurs */}
        <div className="absolute -top-32 -right-32 w-72 h-72 bg-teal-200/40 dark:bg-teal-800/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-cyan-200/40 dark:bg-cyan-800/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-40 h-40 bg-emerald-200/30 dark:bg-emerald-800/10 rounded-full blur-2xl" />

        <div className="relative z-10 text-center px-12">
          {/* Floating cards */}
          <div className="relative mb-12">
            <div className="absolute -top-6 -right-2 w-14 h-14 bg-white dark:bg-slate-700 rounded-2xl shadow-lg flex items-center justify-center rotate-6 animate-pulse">
              <Stethoscope className="w-7 h-7 text-teal-600 dark:text-teal-400" />
            </div>
            <div className="absolute -bottom-4 -left-4 w-12 h-12 bg-white dark:bg-slate-700 rounded-xl shadow-lg flex items-center justify-center -rotate-6">
              <Building2 className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
            </div>

            <div className="w-56 h-56 mx-auto bg-white/80 dark:bg-slate-700/60 backdrop-blur-sm rounded-3xl shadow-xl border border-white/60 dark:border-slate-600 flex items-center justify-center">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-400/30">
                <Heart className="w-14 h-14 text-white" fill="white" fillOpacity={0.2} />
              </div>
            </div>
          </div>

          {/* Features list */}
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white leading-snug">
            {t('everythingYouNeed', { defaultValue: 'Everything you need' })}
            <br />
            {t('toManageHospital', { defaultValue: 'to manage your hospital' })}
          </h2>

          <div className="mt-6 space-y-3 text-left max-w-xs mx-auto">
            {[
              t('featurePatient', { defaultValue: 'Patient management & billing' }),
              t('featureLab', { defaultValue: 'Lab, pharmacy & prescriptions' }),
              t('featureStaff', { defaultValue: 'Staff, doctors & appointments' }),
              t('featureReports', { defaultValue: 'Real-time reports & analytics' }),
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span className="text-sm text-slate-600 dark:text-slate-300">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

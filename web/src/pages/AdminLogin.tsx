import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/apiClient';
import { setAdminSession } from '../lib/adminSessionStore';
import toast from 'react-hot-toast';
import { Lock, Mail, ShieldCheck, Server } from 'lucide-react';

type PlatformStaffRole = 'platform_admin' | 'platform_setup' | 'platform_support' | 'platform_auditor';
type AdminLoginRole = 'super_admin' | PlatformStaffRole;
type AdminLoginUser = { id: string; name: string; email: string; role: string };

function isPlatformStaffRole(role: string): role is PlatformStaffRole {
  return role === 'platform_admin' || role === 'platform_setup' || role === 'platform_support' || role === 'platform_auditor';
}

function isAdminLoginRole(role: string): role is AdminLoginRole {
  return role === 'super_admin' || isPlatformStaffRole(role);
}

async function loginVia(path: string, email: string, password: string): Promise<AdminLoginUser> {
  const res = await api.post<{ user: AdminLoginUser }>(path, { email, password });
  return res.user;
}

export default function AdminLogin() {
  const { t } = useTranslation('auth');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // The backend never returns a token in the body for platform admin/staff
      // login. The JWT lives in the HttpOnly `admin_token` cookie; the SPA only
      // keeps a minimal user indicator for route guards.
      let user: AdminLoginUser;
      try {
        user = await loginVia('/api/admin/login', email, password);
      } catch {
        user = await loginVia('/api/admin/platform-staff/login', email, password);
      }

      if (!user || !isAdminLoginRole(user.role)) {
        toast.error(t('accessDeniedAdminOnly', { defaultValue: 'Platform access only' }));
        return;
      }

      setAdminSession({
        userId: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
      });
      window.location.href = user.role === 'super_admin'
        ? '/super-admin/dashboard'
        : '/super-admin/platform-staff';
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : t('invalidCredentials', { defaultValue: 'Invalid email or password' });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left: Form ── */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-24 bg-white dark:bg-slate-900">
        {/* Logo */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5">
            <img src="/ozzyl-logo.svg" alt="Ozzyl" className="w-9 h-9 rounded-lg shadow-md shadow-cyan-500/20" />
            <span className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              Ozzyl Health
            </span>
          </div>
        </div>

        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700 w-fit">
          <ShieldCheck className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
          <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wide">
            Super Admin
          </span>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white leading-tight">
            {t('adminTitle', { defaultValue: 'Platform admin login' })}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('adminDesc', { defaultValue: 'Manage hospitals, tenants, and platform settings.' })}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 max-w-sm">
          <div>
            <label htmlFor="admin-email" className="label">
              {t('adminEmailLabel', { defaultValue: 'Admin email' })}
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="admin-email"
                type="email"
                placeholder={t('adminEmailPlaceholder', { defaultValue: 'admin@hospital.com' })}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="input pl-10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="admin-password" className="label">
              {t('passwordLabel', { defaultValue: 'Password' })}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="admin-password"
                type="password"
                placeholder={t('passwordPlaceholder', { defaultValue: 'Minimum 8 characters' })}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="input pl-10"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-700 text-white font-semibold text-base shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 hover:opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('login.loggingIn', { defaultValue: 'Logging in...' })}
              </>
            ) : (
              t('adminSignInButton', { defaultValue: 'Sign in to admin panel' })
            )}
          </button>
        </form>

        {/* Hospital login link */}
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          {t('staffLoginCta', { defaultValue: 'Hospital staff?' })}{' '}
          <a href="https://hms.ozzyl.com/login" className="font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400">
            {t('signInHere', { defaultValue: 'Sign in here' })} →
          </a>
        </p>
      </div>

      {/* ── Right: Branding ── */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-violet-50 via-indigo-50/60 to-purple-100 dark:from-slate-800 dark:via-violet-950/40 dark:to-slate-900 items-center justify-center relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-72 h-72 bg-violet-200/40 dark:bg-violet-800/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-indigo-200/40 dark:bg-indigo-800/20 rounded-full blur-3xl" />

        <div className="relative z-10 text-center px-12">
          <div className="w-56 h-56 mx-auto bg-white/80 dark:bg-slate-700/60 backdrop-blur-sm rounded-3xl shadow-xl border border-white/60 dark:border-slate-600 flex items-center justify-center mb-10">
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-400/30">
              <Server className="w-14 h-14 text-white" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 dark:text-white leading-snug">
            Ozzyl Health Platform
          </h2>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Manage every hospital from one secure dashboard.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-4">
            {[
              { value: '50+',   label: 'Hospitals' },
              { value: 'SaaS',  label: 'Multi-tenant' },
              { value: 'D1',    label: 'Cloudflare DB' },
            ].map(stat => (
              <div key={stat.label} className="bg-white/60 dark:bg-slate-700/50 backdrop-blur-sm rounded-xl p-3 border border-white/50 dark:border-slate-600/50">
                <p className="text-lg font-bold text-violet-600 dark:text-violet-400 leading-none">{stat.value}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

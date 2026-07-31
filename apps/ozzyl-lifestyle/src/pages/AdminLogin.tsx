import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/apiClient';
import toast from 'react-hot-toast';
import { Lock, Mail, ShieldCheck, Activity, Server } from 'lucide-react';

export default function AdminLogin() {
  const { t } = useTranslation('auth');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post<{
        token: string;
        user: { id: string; name: string; email: string; role: string };
      }>('/api/admin/login', { email, password });

      if (res.token && res.user?.role === 'super_admin') {
        localStorage.setItem('hms_token', res.token);
        window.location.href = '/super-admin/dashboard';
      } else {
        toast.error(t('auth.access_denied_super_admin_only'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials';
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
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center shadow-md shadow-violet-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
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
            Platform Administration
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Sign in to manage hospitals, tenants, and platform settings.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 max-w-sm">
          <div>
            <label htmlFor="admin-email" className="label">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="admin-email"
                type="email"
                placeholder={t("auth.emailPlaceholder")}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="input pl-10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="admin-password" className="label">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="admin-password"
                type="password"
                placeholder={t("auth.passwordPlaceholder")}
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
                Signing in…
              </>
            ) : (
              'Sign in to Admin'
            )}
          </button>
        </form>

        {/* Hospital login link */}
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          Hospital staff?{' '}
          <a href="/login" className="font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400">
            Login here →
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
            Manage all hospitals from one place
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

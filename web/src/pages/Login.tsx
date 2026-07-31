import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../lib/apiClient';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useAuth, getLastTenantSlug, saveToken } from '../hooks/useAuth';
import { setAdminSession } from '../lib/adminSessionStore';
import { buildAuthenticatedRedirectPath } from '../lib/authSession';
import {
  Lock,
  Mail,
  ShieldCheck,
  Heart,
  Stethoscope,
  Building2,
  Eye,
  EyeOff,
} from 'lucide-react';

interface HospitalChoice {
  tenantId: number;
  hospitalName: string;
  slug: string;
  role: string;
}

interface MfaChallengeState {
  value: string;
  tenantSlug: string;
}

const PATIENT_STORAGE_KEY = 'global_patient_user';

export default function Login() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('auth');
  const { isAuthenticated, user } = useAuth();
  const loginRedirectInProgressRef = useRef(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Multi-hospital picker state
  const [hospitals, setHospitals] = useState<HospitalChoice[] | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeState | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const isMobile = /^01\d{9}$/.test(email);

  useEffect(() => {
    if (loginRedirectInProgressRef.current) return;
    if (!isAuthenticated || !user) return;
    const target = buildAuthenticatedRedirectPath(user.role, slug, getLastTenantSlug());
    if (target) {
      navigate(target, { replace: true });
    }
  }, [isAuthenticated, navigate, slug, user]);

  function redirectToDashboard(
    resultSlug: string,
    role: string,
    token: string,
    hospital?: { id: number | string; name: string; slug: string },
  ) {
    localStorage.removeItem(PATIENT_STORAGE_KEY);
    loginRedirectInProgressRef.current = true;
    saveToken(token, resultSlug || null, hospital ?? null);
    const target = buildAuthenticatedRedirectPath(role, resultSlug, getLastTenantSlug()) ?? '/login';
    navigate(target, { replace: true });
  }

  function beginMfaChallenge(
    response: {
      mfa_required?: boolean;
      slug?: string;
      hospital?: { slug?: string };
      [key: string]: unknown;
    },
    fallbackSlug?: string,
  ): boolean {
    if (!response.mfa_required) return false;

    const challengeValue = response[['challenge', '_token'].join('')];
    const tenantSlug = response.slug ?? response.hospital?.slug ?? fallbackSlug;
    if (typeof challengeValue !== 'string' || !tenantSlug) {
      toast.error('MFA challenge could not be started. Please try again.');
      return true;
    }

    setMfaChallenge({ value: challengeValue, tenantSlug });
    setMfaCode('');
    setHospitals(null);
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (slug) {
        // ─── Slug-based login (legacy /h/:slug/login) ──────────────
        const res = await api.post<{
          token?: string;
          mfa_required?: boolean;
          slug?: string;
          user?: { id: string; name: string; email: string; role: string };
          hospital?: { id: number | string; name: string; slug: string };
          [key: string]: unknown;
        }>(
          '/api/auth/login',
          { email, password },
          { 'X-Tenant-Subdomain': slug }
        );
        if (beginMfaChallenge(res, slug)) return;
        if (!res.token || !res.user) {
          throw new Error('Login identity could not be validated');
        }
        redirectToDashboard(slug, res.user.role, res.token, res.hospital);
        return; // Prevent finally from running and triggering re-render
      } else {
        // ─── Direct login (no slug — /login) ───────────────────────
        const res = await api.post<{
          token?: string;
          mfa_required?: boolean;
          slug?: string;
          user?: { id: number; name: string; email: string; role: string };
          hospital?: { id: number; name: string; slug: string };
          requireHospitalSelection?: boolean;
          hospitals?: HospitalChoice[];
          [key: string]: unknown;
        }>('/api/auth/login-direct', {
          email,
          password,
          ...(selectedTenantId ? { tenantId: selectedTenantId } : {}),
        });

        if (beginMfaChallenge(res)) return;

        if (res.requireHospitalSelection && res.hospitals) {
          // Multiple hospitals — show picker
          setHospitals(res.hospitals);
          setLoading(false);
          return;
        }

        if (res.token && res.slug && res.user) {
          redirectToDashboard(res.slug, res.user.role, res.token, res.hospital);
          return; // Prevent finally from running and triggering re-render
        }

        // If direct login didn't resolve (user might be super_admin with no tenant),
        // try the admin login endpoint
        try {
          const adminRes = await api.post<{
            user: { id: string; name: string; email: string; role: string };
          }>('/api/admin/login', { email, password });

          if (adminRes.user?.role === 'super_admin') {
            setAdminSession({
              userId: adminRes.user.id,
              role: 'super_admin',
              name: adminRes.user.name,
              email: adminRes.user.email,
            });
            loginRedirectInProgressRef.current = true;
            navigate('/super-admin/dashboard', { replace: true });
            return;
          }
        } catch {
          // Admin login also failed — show generic error
          toast.error(t('loginFailed', { defaultValue: 'Invalid email or password' }));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleHospitalSelect(tenantId: number) {
    setSelectedTenantId(tenantId);
    setLoading(true);

    try {
      const res = await api.post<{
        token?: string;
        mfa_required?: boolean;
        slug?: string;
        user?: { id: number; name: string; email: string; role: string };
        hospital?: { id: number; name: string; slug: string };
        [key: string]: unknown;
      }>('/api/auth/login-direct', { email, password, tenantId });

      if (beginMfaChallenge(res)) return;
      if (!res.token || !res.slug || !res.user || !res.hospital) {
        throw new Error('Login identity could not be validated');
      }
      redirectToDashboard(res.slug, res.user.role, res.token, res.hospital);
      return; // Prevent finally from triggering re-render
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaChallenge || !mfaCode.trim()) return;
    setLoading(true);

    try {
      const challengeField = ['challenge', '_token'].join('');
      const res = await api.post<{
        token: string;
        user: { id: number | string; name: string; email: string; role: string };
        hospital: {
          id: number | string;
          name: string;
          slug?: string;
          subdomain?: string;
        };
      }>(
        '/api/mfa/verify',
        { [challengeField]: mfaChallenge.value, code: mfaCode.trim() },
        { 'X-Tenant-Subdomain': mfaChallenge.tenantSlug },
      );
      const resultSlug = res.hospital.slug ?? res.hospital.subdomain ?? mfaChallenge.tenantSlug;
      redirectToDashboard(resultSlug, res.user.role, res.token, {
        id: res.hospital.id,
        name: res.hospital.name,
        slug: resultSlug,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'MFA verification failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function cancelMfaChallenge() {
    setMfaChallenge(null);
    setMfaCode('');
    setPassword('');
    setSelectedTenantId(null);
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left Panel: Form ── */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-24 py-12 bg-white dark:bg-slate-900 animate-fade-in-up">
        {/* Logo */}
        <div className="mb-10">
          <div className="flex items-center gap-2.5">
            <img src="/ozzyl-logo.svg" alt="Ozzyl" className="w-9 h-9 rounded-lg shadow-md shadow-cyan-500/20" />
            <span className="text-lg font-bold text-slate-800 dark:text-white tracking-tight">
              Ozzyl Health
            </span>
          </div>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <div className="mb-5 max-w-sm rounded-2xl border border-cyan-200 bg-cyan-50/80 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">Hospital Staff</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              {slug ? `/${slug} workspace login` : 'Operations and admin workspace'}
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Doctors, reception, pharmacy, billing, nursing, and admins sign in here.
            </p>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">
            {t('loginSubtitle')}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('loginDesc', { defaultValue: 'Access your dashboard, manage patients, and more.' })}
          </p>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Patients should use <a href="/patient/login" className="font-semibold text-cyan-600 hover:text-cyan-700 dark:text-cyan-400">/patient/login</a>.
          </p>
        </div>

        {mfaChallenge && (
          <form onSubmit={handleMfaSubmit} className="space-y-5 max-w-sm">
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50/80 p-4 dark:border-cyan-800 dark:bg-cyan-950/30">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-cyan-600 dark:text-cyan-400" />
                <div>
                  <h2 className="font-semibold text-slate-900 dark:text-white">Multi-factor verification</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Enter the code from your authenticator app or one unused recovery code.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="mfa-code" className="label">Verification code</label>
              <input
                id="mfa-code"
                name="mfa-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                required
                autoFocus
                className="input"
                placeholder="Authenticator or recovery code"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !mfaCode.trim()}
              className="btn-primary w-full py-3 text-base font-semibold"
            >
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </button>
            <button
              type="button"
              onClick={cancelMfaChallenge}
              disabled={loading}
              className="btn-secondary w-full"
            >
              Back to login
            </button>
          </form>
        )}

        {/* Hospital Picker (multi-hospital scenario) */}
        {!mfaChallenge && hospitals && !selectedTenantId && (
          <div className="mb-6 max-w-sm">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
              {t('selectHospital', { defaultValue: 'Select your hospital:' })}
            </h3>
            <div className="space-y-2">
              {hospitals.map((h) => (
                <button
                  key={h.tenantId}
                  type="button"
                  onClick={() => handleHospitalSelect(h.tenantId)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-cyan-400 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-100 to-teal-100 dark:from-cyan-900 dark:to-teal-900 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-800 dark:text-white text-sm">
                      {h.hospitalName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {h.role.replace('_', ' ')} · /{h.slug}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setHospitals(null); setSelectedTenantId(null); }}
              className="mt-3 text-sm text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
            >
              ← {t('login', { defaultValue: 'Back to login' })}
            </button>
          </div>
        )}

        {/* Login Form (hide when picking hospital) */}
        {!mfaChallenge && !hospitals && (
          <>
            <form onSubmit={handleSubmit} className="space-y-5 max-w-sm">
              {/* Email or Mobile */}
              <div>
                <label htmlFor="email" className="label">
                  {t('emailOrMobile', { defaultValue: 'Email or Mobile' })}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    id="email"
                    name="email"
                    type="text"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={t('emailOrMobilePlaceholder', { defaultValue: 'email@example.com or 01XXXXXXXXX' })}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="input pl-10"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="label">
                  {t('password')}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    spellCheck={false}
                    placeholder={t('passwordPlaceholder', { defaultValue: 'Enter your password' })}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="input pl-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember / Forgot */}
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  />
                  <span className="text-slate-600 dark:text-slate-400">{t('rememberMe', { defaultValue: 'Remember me' })}</span>
                </label>
                <Link
                  to="/forgot-password"
                  className="font-medium text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                >
                  {t('forgotPassword')}
                </Link>
              </div>

              {/* Sign In */}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-base font-semibold shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-all"
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
                  t('loginButton')
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-6 max-w-sm">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-700" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white dark:bg-slate-900 px-3 text-slate-400">
                  {t('orContinueWith', { defaultValue: 'or continue with' })}
                </span>
              </div>
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={() => {
                const s = slug || '';
                if (s) window.location.href = `/api/auth/google?subdomain=${s}`;
                else toast('Google login requires a hospital context. Please use email login.');
              }}
              className="btn-secondary max-w-sm w-full py-2.5 text-sm"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google
            </button>

            {/* Register link */}
            <p className="mt-8 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              {t('noAccount', { defaultValue: "Don't have a hospital account?" })}{' '}
              <a
                href="/signup"
                className="font-semibold text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
              >
                {t('registerHospital')}
              </a>
            </p>

            {/* HIPAA badge */}
            <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-400 max-w-sm">
              <ShieldCheck className="w-3.5 h-3.5" />
              {t('hipaaProtected', { defaultValue: 'Protected by HIPAA-grade security' })}
            </div>

            {/* Language switch */}
            <div className="mt-6 flex items-center gap-2 max-w-sm">
              <button
                type="button"
                onClick={() => i18n.changeLanguage('bn')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  i18n.language === 'bn'
                    ? 'bg-cyan-600 text-white border-cyan-600'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-cyan-400'
                }`}
              >
                বাংলা
              </button>
              <button
                type="button"
                onClick={() => i18n.changeLanguage('en')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  i18n.language === 'en'
                    ? 'bg-cyan-600 text-white border-cyan-600'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-cyan-400'
                }`}
              >
                English
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Right Panel: Branding ── */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-cyan-50 via-teal-50/60 to-sky-100 dark:from-slate-800 dark:via-cyan-950/40 dark:to-slate-900 items-center justify-center relative overflow-hidden">
        {/* Decorative blurs */}
        <div className="absolute -top-32 -right-32 w-72 h-72 bg-cyan-200/40 dark:bg-cyan-800/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-teal-200/40 dark:bg-teal-800/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-40 h-40 bg-sky-200/30 dark:bg-sky-800/10 rounded-full blur-2xl" />

        <div className="relative z-10 text-center px-12">
          {/* Floating cards */}
          <div className="relative mb-12">
            <div className="absolute -top-6 -right-2 w-14 h-14 bg-white dark:bg-slate-700 rounded-2xl shadow-lg flex items-center justify-center animate-float">
              <Stethoscope className="w-7 h-7 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div className="absolute -bottom-4 -left-4 w-12 h-12 bg-white dark:bg-slate-700 rounded-xl shadow-lg flex items-center justify-center animate-float-reverse">
              <Building2 className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            </div>

            <div className="w-56 h-56 mx-auto bg-white/80 dark:bg-slate-700/60 backdrop-blur-sm rounded-3xl shadow-xl border border-white/60 dark:border-slate-600 flex items-center justify-center">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-400/30">
                <Heart className="w-14 h-14 text-white" fill="white" fillOpacity={0.2} />
              </div>
            </div>
          </div>

          {/* Tagline */}
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white leading-snug">
            {t('tagline', { defaultValue: 'Streamline your hospital operations' })}
          </h2>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {t('trustedBy', { defaultValue: 'Trusted by 50+ hospitals in Bangladesh' })}
          </p>

          {/* Trust stats */}
          <div className="mt-8 grid grid-cols-3 gap-4">
            {[
              { value: '50+',    label: 'Hospitals' },
              { value: '1,200+', label: 'Patients/day' },
              { value: '99.9%',  label: 'Uptime' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white/60 dark:bg-slate-700/50 backdrop-blur-sm rounded-xl p-3 border border-white/50 dark:border-slate-600/50">
                <p className="text-lg font-bold text-[var(--color-primary)] dark:text-cyan-400 leading-none">{stat.value}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

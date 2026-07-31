import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  Activity,
  ArrowRight,
  Chrome,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getPatientAuthTabMeta,
  getPatientNidError,
  getPatientPhoneError,
  getPatientRegisterProgress,
  type PatientAuthTab,
} from '../lib/patientAuthUi';
import { getPatientPortalTopLevelPath } from '../lib/patientPortalRouting';
import { PatientAuthRail } from '../components/patient-auth/PatientAuthRail';
import { PatientAuthTabs } from '../components/patient-auth/PatientAuthTabs';

interface PatientAuthUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  national_id?: string | null;
  uhid: string | null;
  emailVerified: boolean;
}

interface PatientAuthResponse {
  user?: PatientAuthUser;
  error?: string;
  message?: string;
}

interface GoogleIdentityButtonOptions {
  theme: 'outline' | 'filled_blue' | 'filled_black';
  size: 'large' | 'medium' | 'small';
  type: 'standard' | 'icon';
  text: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
}

interface GoogleIdentityClient {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: { credential?: string }) => void | Promise<void>;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (element: HTMLElement, options: GoogleIdentityButtonOptions) => void;
    };
  };
}

const PATIENT_STORAGE_KEY = 'global_patient_user';
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '477759293578-ntjjr6v6hh72d8bss9ihfqanegnjrjkl.apps.googleusercontent.com';

export default function PatientLoginPage() {
  const { t, i18n } = useTranslation('patients');
  const navigate = useNavigate();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<PatientAuthTab>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);

  const phoneError = getPatientPhoneError(phone, t);
  const nidError = getPatientNidError(nationalId, t);
  const confirmPasswordError =
    confirmPassword && registerPassword !== confirmPassword
      ? t('patientLogin.confirmPasswordError')
      : '';
  const registerCanSubmit = !!name.trim()
    && !!registerPassword
    && !!confirmPassword
    && (Boolean(email.trim()) || Boolean(phone.trim()))
    && !phoneError
    && !nidError
    && !confirmPasswordError;
  const registerProgress = getPatientRegisterProgress({
    name,
    email,
    phone,
    registerPassword,
    confirmPassword,
  });

  useEffect(() => {
    const existingUser = localStorage.getItem(PATIENT_STORAGE_KEY);
    if (existingUser) {
      navigate(getPatientPortalTopLevelPath('home'), { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    const scriptId = 'google-gis-script';

    const renderGoogleButton = () => {
      const google = (window as Window & { google?: GoogleIdentityClient }).google;
      if (!googleButtonRef.current || !google || !GOOGLE_CLIENT_ID) return;

      googleButtonRef.current.innerHTML = '';
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response: { credential?: string }) => {
          if (!response.credential) {
            toast.error(t('patientLogin.googleCredentialUnavailable'));
            return;
          }

          try {
            const googleResponse = await fetch('/api/patient-auth/google', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ credential: response.credential }),
            });

            const data = await googleResponse.json() as PatientAuthResponse;
            if (!googleResponse.ok || !data.user) {
              throw new Error(data.error || data.message || t('patientLogin.googleSignInFailed'));
            }

            localStorage.setItem(PATIENT_STORAGE_KEY, JSON.stringify(data.user));
            window.location.replace(getPatientPortalTopLevelPath('home'));
          } catch (error) {
            const message = error instanceof Error ? error.message : t('patientLogin.googleSignInFailed');
            toast.error(message);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        text: activeTab === 'register' ? 'signup_with' : 'signin_with',
        shape: 'pill',
        width: 320,
      });

      if (!cancelled) {
        setGoogleReady(true);
      }
    };

    setGoogleReady(false);
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript) {
      const google = (window as Window & { google?: GoogleIdentityClient }).google;
      if (google) {
        renderGoogleButton();
      } else {
        existingScript.addEventListener('load', renderGoogleButton, { once: true });
      }
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.addEventListener('load', renderGoogleButton, { once: true });
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [activeTab, t]);

  async function persistUser(data: PatientAuthResponse) {
    if (!data.user) {
      throw new Error(data.error || data.message || t('patientLogin.userDataUnavailable'));
    }
    localStorage.setItem(PATIENT_STORAGE_KEY, JSON.stringify(data.user));
    window.location.replace(getPatientPortalTopLevelPath('home'));
  }

  async function handleLoginSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/patient-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password }),
      });

      const data = await response.json() as PatientAuthResponse;
      if (!response.ok) {
        throw new Error(data.error || data.message || t('patientLogin.loginFailed'));
      }

      await persistUser(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('patientLogin.loginFailed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registerCanSubmit) return;
    setLoading(true);

    try {
      const response = await fetch('/api/patient-auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          national_id: nationalId.trim() || undefined,
          password: registerPassword,
        }),
      });

      const data = await response.json() as PatientAuthResponse;
      if (!response.ok) {
        throw new Error(data.error || data.message || t('patientLogin.registrationFailed'));
      }

      await persistUser(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('patientLogin.registrationFailed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/patient-auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });

      const data = await response.json() as PatientAuthResponse;
      if (!response.ok) {
        throw new Error(data.error || data.message || t('patientLogin.passwordResetRequestFailed'));
      }

      toast.success(data.message || t('patientLogin.emailSent'));
      setActiveTab('login');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('patientLogin.passwordResetRequestFailed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  const tabMeta = getPatientAuthTabMeta(activeTab, t);

  const TogglePasswordButton = ({
    shown,
    onClick,
  }: {
    shown: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
    >
      {shown ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
    </button>
  );

  return (
    <div className="patient-auth-shell">
      <div className="patient-auth-panel">
        <div className="mb-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Ozzyl Health</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Universal Patient Access</p>
              </div>
            </div>

            {/* Language Toggle */}
            <button
              onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'bn' : 'en')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              aria-label="Toggle language"
            >
              <span className="text-base">{i18n.language === 'en' ? '🇧🇩' : '🇬🇧'}</span>
              <span>{i18n.language === 'en' ? 'বাংলা' : 'English'}</span>
            </button>
          </div>
        </div>

        <div className="mb-6 max-w-md">
          <div className="rounded-[2rem] border border-cyan-500/20 bg-cyan-500/10 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">Patient Portal</p>
            <p className="mt-2 text-base font-semibold text-white">Personal health access</p>
            <p className="mt-1 text-sm text-slate-300">Health card, records, wellness, visits, and account recovery.</p>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 text-teal-700 px-4 py-1.5 text-xs font-semibold border border-teal-100 dark:bg-teal-950/40 dark:text-teal-200 dark:border-teal-900">
            <ShieldCheck className="w-3.5 h-3.5" />
            {t('patientLogin.securePortal')}
          </span>
          <h1 className="mt-4 text-3xl font-bold text-slate-900 dark:text-white leading-tight">
            {tabMeta.title}
          </h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {tabMeta.description}
          </p>
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            Hospital staff should use{' '}
            <Link to="/login" className="font-semibold text-cyan-300 hover:text-cyan-200">
              /login
            </Link>
            {' '}or their hospital workspace login URL.
          </p>
          {activeTab === 'register' && (
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                t('patientLogin.badge.quick'),
                t('patientLogin.badge.emailPhone'),
                t('patientLogin.badge.nidLater'),
              ].map((item, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        <PatientAuthTabs
          activeTab={activeTab}
          onChange={setActiveTab}
          labels={{
            login: t('patientLogin.loginTab'),
            register: t('patientLogin.registerTab'),
            forgot: t('patientLogin.forgotTab'),
          }}
        />

        {activeTab === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-5 max-w-md">
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.identifierLabel')}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder={t('patientLogin.identifierPlaceholder')}
                  required
                  autoFocus
                  className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 pl-10 text-sm text-slate-900 dark:text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 dark:focus:ring-cyan-900/30 transition"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.passwordLabel')}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="password"
                  type={showLoginPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('patientLogin.passwordPlaceholder')}
                  required
                  minLength={8}
                  className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 pl-10 pr-11 text-sm text-slate-900 dark:text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 dark:focus:ring-cyan-900/30 transition"
                />
                <TogglePasswordButton shown={showLoginPassword} onClick={() => setShowLoginPassword((value) => !value)} />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-semibold text-base shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:opacity-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? t('patientLogin.loggingIn') : tabMeta.button}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        )}

        {activeTab === 'register' && (
          <form onSubmit={handleRegisterSubmit} className="space-y-5 max-w-md">
            <div className="rounded-2xl border border-cyan-100 bg-cyan-50/80 dark:bg-cyan-950/20 dark:border-cyan-900 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-200">Setup progress</p>
                  <p className="text-xs text-cyan-700 dark:text-cyan-300/80 mt-1">Only 4 essentials before you enter your dashboard.</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-cyan-900 dark:text-cyan-100">{registerProgress}/4</p>
                  <p className="text-[11px] uppercase tracking-widest text-cyan-700 dark:text-cyan-300/80">Complete</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className={`h-2 rounded-full ${index < registerProgress ? 'bg-cyan-500' : 'bg-cyan-100 dark:bg-cyan-900/60'}`}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Required to start</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Name, one contact method, and a password are enough. You can add NID after signup.</p>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.nameLabel')}
              </label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('patientLogin.namePlaceholder')}
                  required
                  minLength={2}
                  className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 pl-10 text-sm text-slate-900 dark:text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 dark:focus:ring-cyan-900/30 transition"
                />
              </div>
            </div>

            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.emailLabel')} <span className="text-slate-400">({t('patientLogin.optional')})</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="register-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('patientLogin.emailPlaceholder')}
                  className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 pl-10 text-sm text-slate-900 dark:text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 dark:focus:ring-cyan-900/30 transition"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Use email if you want recovery and Google-style account continuity.</p>
            </div>

            <div>
              <label htmlFor="register-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.phoneLabel')} <span className="text-slate-400">({t('patientLogin.phoneRequiredIfNoEmail')})</span>
              </label>
              <input
                id="register-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={t('patientLogin.phonePlaceholder')}
                className={`w-full rounded-xl border bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-4 transition ${
                  phoneError ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100 dark:focus:ring-rose-900/30' : 'border-slate-200 focus:border-cyan-400 focus:ring-cyan-100 dark:focus:ring-cyan-900/30'
                }`}
              />
              {phoneError && <p className="mt-1.5 text-xs text-rose-600">{phoneError}</p>}
              {!phoneError && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">If you skip email, phone becomes your main patient identity contact.</p>}
            </div>

            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/70 dark:bg-slate-950/30 p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add later or now</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">NID helps strengthen health card identity, but it is not required for first entry.</p>
                </div>
                <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Optional</span>
              </div>
              <label htmlFor="register-nid" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                NID <span className="text-slate-400">({t('patientLogin.nidOptional')})</span>
              </label>
              <input
                id="register-nid"
                type="text"
                value={nationalId}
                onChange={(event) => setNationalId(event.target.value)}
                placeholder={t('patientLogin.nidPlaceholder')}
                className={`w-full rounded-xl border bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-4 transition ${
                  nidError ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100 dark:focus:ring-rose-900/30' : 'border-slate-200 focus:border-cyan-400 focus:ring-cyan-100 dark:focus:ring-cyan-900/30'
                }`}
              />
              {nidError && <p className="mt-1.5 text-xs text-rose-600">{nidError}</p>}
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.passwordLabel')}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="register-password"
                  type={showRegisterPassword ? 'text' : 'password'}
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  placeholder={t('patientLogin.registerPasswordPlaceholder')}
                  required
                  minLength={8}
                  className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 pl-10 pr-11 text-sm text-slate-900 dark:text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 dark:focus:ring-cyan-900/30 transition"
                />
                <TogglePasswordButton shown={showRegisterPassword} onClick={() => setShowRegisterPassword((value) => !value)} />
              </div>
            </div>

            <div>
              <label htmlFor="register-confirm-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.confirmPasswordLabel')}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="register-confirm-password"
                  type={showRegisterConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={t('patientLogin.confirmPasswordPlaceholder')}
                  required
                  minLength={8}
                  className={`w-full rounded-xl border bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 pl-10 pr-11 text-sm text-slate-900 dark:text-white outline-none focus:ring-4 transition ${
                    confirmPasswordError ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100 dark:focus:ring-rose-900/30' : 'border-slate-200 focus:border-cyan-400 focus:ring-cyan-100 dark:focus:ring-cyan-900/30'
                  }`}
                />
                <TogglePasswordButton shown={showRegisterConfirmPassword} onClick={() => setShowRegisterConfirmPassword((value) => !value)} />
              </div>
              {confirmPasswordError && <p className="mt-1.5 text-xs text-rose-600">{confirmPasswordError}</p>}
            </div>

            <button
              type="submit"
              disabled={loading || !registerCanSubmit}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-semibold text-base shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:opacity-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? t('patientLogin.creatingAccount') : tabMeta.button}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        )}

        {activeTab === 'forgot' && (
          <form onSubmit={handleForgotSubmit} className="space-y-5 max-w-md">
            <div>
              <label htmlFor="forgot-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t('patientLogin.forgotEmailLabel')}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(event) => setForgotEmail(event.target.value)}
                  placeholder={t('patientLogin.emailPlaceholder')}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white dark:bg-slate-950 dark:border-slate-800 px-4 py-3 pl-10 text-sm text-slate-900 dark:text-white outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 dark:focus:ring-cyan-900/30 transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-semibold text-base shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:opacity-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? t('patientLogin.sendingReset') : tabMeta.button}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        )}

        <div className="max-w-md my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{t('patientLogin.or')}</span>
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>

        <div className="max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-300">
              <Chrome className="w-4.5 h-4.5" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">{tabMeta.googleTitle}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{tabMeta.googleSubtitle}</p>
            </div>
          </div>
          <div ref={googleButtonRef} className="flex justify-center" />
          {!googleReady && (
            <p className="mt-3 text-xs text-center text-slate-400">{t('patientLogin.googleButtonLoading')}</p>
          )}
        </div>

        <div className="mt-6 max-w-md rounded-2xl border border-teal-100 bg-teal-50/80 dark:bg-teal-950/20 dark:border-teal-900 p-4">
          <p className="text-sm font-semibold text-teal-800 dark:text-teal-200 mb-1">{t('patientLogin.securityTitle')}</p>
          <p className="text-sm text-teal-700 dark:text-teal-300/90">
            {t('patientLogin.securityDescription')}
          </p>
        </div>

        <div className="mt-4 max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-600 dark:text-slate-300">
          {t('patientLogin.googleSignupNote')}
        </div>

      </div>

      <PatientAuthRail dashboardCtaLabel={t('patientLogin.goToDashboard')} />
    </div>
  );
}

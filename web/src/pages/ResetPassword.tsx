import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/apiClient';

interface ResetContext {
  valid: boolean;
  email: string;
  hospitalName: string;
}

function isStrongValue(value: string): boolean {
  return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [context, setContext] = useState<ResetContext | null>(null);
  const [validating, setValidating] = useState(true);
  const [newValue, setNewValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError('This reset link is invalid or has expired.');
      setValidating(false);
      return undefined;
    }

    void api.get<ResetContext>(`/api/auth/reset-password/${encodeURIComponent(token)}`)
      .then((response) => {
        if (!cancelled) setContext(response);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'This reset link is invalid or has expired.');
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!isStrongValue(newValue)) {
      setError('Use at least 8 characters with uppercase, lowercase, and a number.');
      return;
    }
    if (newValue !== confirmation) {
      setError('The two values do not match.');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post<{ message?: string }>(
        `/api/auth/reset-password/${encodeURIComponent(token)}`,
        { password: newValue },
      );
      const successMessage = response.message ?? 'Password updated successfully. You can now sign in.';
      setMessage(successMessage);
      navigate('/login', { replace: true, state: { passwordResetMessage: successMessage } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <img src="/ozzyl-logo.svg" alt="Ozzyl" className="h-10 w-10 rounded-xl" />
          <div>
            <p className="font-bold text-slate-900 dark:text-white">Ozzyl Health</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Private staff account recovery</p>
          </div>
        </div>

        {validating ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Validating your reset link…</p>
        ) : message ? (
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Password updated</h1>
            <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {message}
            </p>
            <Link to="/login" className="mt-6 inline-flex w-full justify-center rounded-xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-700">
              Sign in now
            </Link>
          </div>
        ) : context ? (
          <>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Create a private password</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {context.hospitalName} · {context.email}. Only you should enter and know this password.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div>
                <label htmlFor="new-password" className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">New password</label>
                <input
                  id="new-password"
                  type="password"
                  value={newValue}
                  onChange={(event) => setNewValue(event.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                Minimum 8 characters with uppercase, lowercase, and a number.
              </p>
              {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </>
        ) : (
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reset link unavailable</h1>
            <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
            <Link to="/forgot-password" className="mt-6 inline-flex rounded-xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-700">
              Request a new link
            </Link>
          </div>
        )}

        <Link to="/login" className="mt-6 inline-flex text-sm font-semibold text-cyan-700 dark:text-cyan-300">
          Back to staff login
        </Link>
      </section>
    </main>
  );
}

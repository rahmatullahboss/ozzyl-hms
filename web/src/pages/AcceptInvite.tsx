import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router';
import { api } from '../lib/apiClient';
import { saveToken } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { DEFAULT_ROLE_ROUTES, TENANT_ROLE_LABELS } from '@shared/authz';
import { buildAuthenticatedRedirectPath } from '../lib/authSession';

interface InviteInfo {
  email: string | null;
  role: string;
  doctorId?: number | null;
  doctorName?: string | null;
  staffId?: number | null;
  staffName?: string | null;
  hospitalName: string;
  slug: string;
}

export default function AcceptInvite() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { t } = useTranslation('auth');

  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [inviteError, setInviteError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInviteError('No invitation token found.');
      setLoadingInvite(false);
      return;
    }

    (async () => {
      try {
        const data = await api.get<InviteInfo & { valid: boolean }>(
          `/api/invite/${token}`,
          { 'X-Tenant-Subdomain': slug ?? '' }
        );
        setInvite(data);
        setEmail(data.email ?? '');
      } catch (err) {
        setInviteError(err instanceof Error ? err.message : 'Invalid or expired invitation.');
      } finally {
        setLoadingInvite(false);
      }
    })();
  }, [token, slug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error(t('auth.passwords_do_not_match'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ token: string; user: { role: string } }>(
        `/api/invite/${token}/accept`,
        { name, email: email.trim(), password }
      );
      saveToken(res.token, invite?.slug ?? slug ?? null);
      toast.success(t('auth.account_created_welcome_aboard'));
      const target = buildAuthenticatedRedirectPath(res.user.role, invite?.slug ?? slug, invite?.slug ?? slug);
      navigate(target ?? `/h/${invite?.slug ?? slug}/dashboard`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('auth.acceptInviteFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingInvite) {
    return (
      <div className="invite-page">
        <div className="invite-card">
          <div className="invite-loading">Validating invitation…</div>
        </div>
      </div>
    );
  }

  if (inviteError || !invite) {
    return (
      <div className="invite-page">
        <div className="invite-card invite-error-card">
          <div className="invite-error-icon">❌</div>
          <h2>{t('invalidInvitation', { defaultValue: 'Invalid Invitation' })}</h2>
          <p>{inviteError || 'This invitation is invalid or has expired.'}</p>
          <a href="/signup" className="btn-secondary">Register your own hospital</a>
        </div>
      </div>
    );
  }

  return (
    <div className="invite-page">
      <div className="invite-card">
        <div className="invite-header">
          <div className="invite-icon">🏥</div>
          <h1>You're invited!</h1>
          <p>
            <strong>{invite.hospitalName}</strong> has invited you to join as{' '}
            <strong className="role-badge">
              {invite.doctorName ? `Dr. ${invite.doctorName}`
                : invite.staffName
                  ? invite.staffName
                  : (TENANT_ROLE_LABELS[invite.role as keyof typeof TENANT_ROLE_LABELS] ?? invite.role)}
            </strong>
          </p>
          {invite.doctorName && (
            <p className="invite-email">
              Linked to your doctor profile: <code>{invite.doctorName}</code>
            </p>
          )}
          {invite.staffName && (
            <p className="invite-email">
              Linked to your staff profile: <code>{invite.staffName}</code>
            </p>
          )}
          {invite.email ? (
            <p className="invite-email">Invitation sent to: <code>{invite.email}</code></p>
          ) : (
            <p className="invite-email">Enter your email to finish creating this doctor account.</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="invite-form">
          <div className="form-group">
            <label htmlFor="inv-name">Your Full Name</label>
            <input
              id="inv-name"
              type="text"
              placeholder={t("auth.enter_your_name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="inv-email">Email</label>
            <input
              id="inv-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={Boolean(invite.email)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="inv-password">Create Password</label>
            <input
              id="inv-password"
              type="password"
              placeholder={t("auth.min_8_characters")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}"
              title="Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number"
            />
          </div>

          <div className="form-group">
            <label htmlFor="inv-confirm">Confirm Password</label>
            <input
              id="inv-confirm"
              type="password"
              placeholder={t("auth.repeat_password")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}"
              title="Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number"
            />
          </div>

          <button type="submit" className="btn-primary invite-btn" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Accept & Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}

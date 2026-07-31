import { useState, useEffect } from 'react';
import { api, ApiClientError } from '../lib/apiClient';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { TENANT_ROLE_LABELS } from '@shared/authz';


const ROLES = [
  { value: 'doctor', label: 'Doctor' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'laboratory', label: 'Laboratory Staff' },
  { value: 'reception', label: 'Receptionist' },
  { value: 'md', label: 'Managing Director' },
  { value: 'director', label: 'Administration' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'accountant', label: 'Accountant' },
];

interface Invitation {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  invited_by_name: string;
}

interface InviteResult {
  invite: {
    email: string;
    role: string;
    inviteLink: string;
    expiresAt: string;
  };
}

export default function InviteStaff() {
  const { t } = useTranslation('staff');

  const [showModal, setShowModal] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('reception');
  const [submitting, setSubmitting] = useState(false);
  const [createdLink, setCreatedLink] = useState('');

  async function loadInvitations() {
    try {
      const data = await api.get<{ invitations: Invitation[] }>('/api/invitations');
      setInvitations(data.invitations);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadInvitations(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post<InviteResult>('/api/invitations', { email, role });
      const link = `${window.location.origin}${res.invite.inviteLink}`;
      setCreatedLink(link);
      toast.success(t('staff.invitationCreated', { email }));
      setEmail('');
      loadInvitations();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Failed to create invitation';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(createdLink);
    toast.success(t('staff.invite_link_copied'));
  }

  return (
    <div className="invite-staff-page">
      <div className="page-header">
        <h2>Staff Invitations</h2>
        <button className="btn-primary" onClick={() => { setShowModal(true); setCreatedLink(''); }}>
          + Invite Staff Member
        </button>
      </div>

      {/* Invitations table */}
      <div className="table-card">
        {loading ? (
          <div className="table-loading">Loading…</div>
        ) : invitations.length === 0 ? (
          <div className="table-empty">
            <p>No invitations yet. Invite your first staff member!</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Invited By</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const expired = new Date(inv.expires_at) < new Date();
                const status = inv.accepted_at ? 'accepted' : expired ? 'expired' : 'pending';
                return (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td><span className="role-chip">{TENANT_ROLE_LABELS[inv.role as keyof typeof TENANT_ROLE_LABELS] ?? inv.role}</span></td>
                    <td><span className={`status-chip status-${status}`}>{status}</span></td>
                    <td>{inv.invited_by_name ?? '—'}</td>
                    <td>{new Date(inv.expires_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('inviteStaff', { defaultValue: 'Invite Staff Member' })}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            {createdLink ? (
              <div className="invite-link-result">
                <p>✅ Invitation created! Share this link:</p>
                <div className="link-box">
                  <code>{createdLink}</code>
                  <button className="btn-copy" onClick={copyLink}>Copy</button>
                </div>
                <p className="link-hint">
                  The invitee can open this link to create their account.
                  Link expires in 7 days.
                </p>
                <button className="btn-secondary" onClick={() => setCreatedLink('')}>
                  Invite another
                </button>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="invite-modal-form">
                <div className="form-group">
                  <label htmlFor="inv-modal-email">Email Address</label>
                  <input
                    id="inv-modal-email"
                    type="email"
                    placeholder={t("auth.staffhospitalcom")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="inv-modal-role">Role</label>
                  <select
                    id="inv-modal-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Create Invitation Link'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

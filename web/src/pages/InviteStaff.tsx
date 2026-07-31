import { useEffect, useState } from 'react';
import { api, ApiClientError } from '../lib/apiClient';
import { useApiQuery } from '../hooks/useApiQuery';
import { useCurrentUserAccess } from '../hooks/useCurrentUserAccess';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { TENANT_ROLE_LABELS } from '@shared/authz';
import { formatDisplayDate } from '../lib/date-utils';

const ROLES = [
  { value: 'doctor', label: 'Doctor' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'laboratory', label: 'Laboratory Staff' },
  { value: 'reception', label: 'Receptionist' },
  { value: 'manager', label: 'Manager' },
  { value: 'md', label: 'CEO / Managing Director' },
  { value: 'director', label: 'Administration' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'shareholder_viewer', label: 'Shareholder Viewer' },
] as const;

const PRIVILEGED_ROLE_VALUES = new Set(['manager', 'md', 'director', 'accountant', 'shareholder_viewer']);

type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

interface Invitation {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at?: string | null;
  created_at: string;
  invited_by_name: string;
  status?: InvitationStatus;
}

interface InviteResult {
  invite: {
    email: string;
    role: string;
    inviteLink: string;
    expiresAt: string;
  };
}

interface ResendResult {
  message: string;
  inviteLink: string;
  expiresAt: string;
  emailSent?: boolean;
}

function getInvitationStatus(invitation: Invitation): InvitationStatus {
  if (invitation.status) return invitation.status;
  if (invitation.accepted_at) return 'accepted';
  if (invitation.revoked_at) return 'revoked';
  return new Date(invitation.expires_at) < new Date() ? 'expired' : 'pending';
}

export default function InviteStaff() {
  const { t } = useTranslation('staff');
  const currentUserAccess = useCurrentUserAccess(true);
  const effectivePermissions = currentUserAccess.data?.effective_permissions ?? [];
  const canManageRoles = effectivePermissions.includes('*') || effectivePermissions.includes('roles:manage');
  const availableRoles = canManageRoles
    ? ROLES
    : ROLES.filter((item) => !PRIVILEGED_ROLE_VALUES.has(item.value));

  const [showModal, setShowModal] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('reception');
  const [submitting, setSubmitting] = useState(false);
  const [actionInvitationId, setActionInvitationId] = useState<number | null>(null);
  const [createdLink, setCreatedLink] = useState('');

  const { data: unlinkedDoctors } = useApiQuery<{
    doctors: Array<{ id: number; name: string; specialty: string | null; email: string | null }>;
  }>(
    ['unlinked-doctors'],
    '/api/doctors?status=unlinked',
    { enabled: role === 'doctor' },
  );

  const [doctorId, setDoctorId] = useState<number | ''>('');

  useEffect(() => {
    if (role !== 'doctor') setDoctorId('');
  }, [role]);

  useEffect(() => {
    if (!availableRoles.some((item) => item.value === role)) {
      setRole('reception');
    }
  }, [availableRoles, role]);

  async function loadInvitations() {
    try {
      const data = await api.get<{ invitations: Invitation[] }>('/api/invitations');
      setInvitations(data.invitations);
    } catch {
      // The route guard already protects this page; keep the table empty on transient failures.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInvitations();
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (role === 'doctor' && !doctorId) {
      toast.error('Please select a doctor profile');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<InviteResult>('/api/invitations', {
        email,
        role,
        doctorId: role === 'doctor' ? Number(doctorId) : undefined,
      });
      setCreatedLink(`${window.location.origin}${res.invite.inviteLink}`);
      toast.success(t('staff.invitationCreated', { email }));
      setEmail('');
      await loadInvitations();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Failed to create invitation';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(invitation: Invitation) {
    setActionInvitationId(invitation.id);
    try {
      const result = await api.post<ResendResult>(`/api/invitations/${invitation.id}/resend`, undefined);
      setCreatedLink(`${window.location.origin}${result.inviteLink}`);
      setShowModal(true);
      toast.success(result.message || 'Invitation resent');
      await loadInvitations();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Failed to resend invitation';
      toast.error(msg);
    } finally {
      setActionInvitationId(null);
    }
  }

  async function handleRevoke(invitation: Invitation) {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
    setActionInvitationId(invitation.id);
    try {
      await api.delete(`/api/invitations/${invitation.id}`);
      toast.success('Invitation revoked');
      await loadInvitations();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Failed to revoke invitation';
      toast.error(msg);
    } finally {
      setActionInvitationId(null);
    }
  }

  function copyLink() {
    void navigator.clipboard.writeText(createdLink);
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => {
                const status = getInvitationStatus(invitation);
                const isUpdating = actionInvitationId === invitation.id;
                return (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td>
                      <span className="role-chip">
                        {TENANT_ROLE_LABELS[invitation.role as keyof typeof TENANT_ROLE_LABELS] ?? invitation.role}
                      </span>
                    </td>
                    <td><span className={`status-chip status-${status}`}>{status}</span></td>
                    <td>{invitation.invited_by_name ?? '—'}</td>
                    <td>{formatDisplayDate(invitation.expires_at)}</td>
                    <td>
                      {status === 'pending' && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={isUpdating}
                            onClick={() => void handleResend(invitation)}
                          >
                            Resend
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={isUpdating}
                            onClick={() => void handleRevoke(invitation)}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

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
                  The recipient must open this link and create their own password.
                </p>
                <p className="link-hint font-semibold text-amber-700 dark:text-amber-300">
                  Do not open or complete the invitation yourself.
                </p>
                <p className="link-hint">Link expires in 7 days.</p>
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
                    placeholder={t('auth.staffhospitalcom')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                {role === 'doctor' && (
                  <>
                    <div className="form-group">
                      <label htmlFor="inv-modal-doctor">Select Doctor Profile</label>
                      <select
                        id="inv-modal-doctor"
                        value={doctorId}
                        onChange={(e) => {
                          const id = e.target.value ? Number(e.target.value) : '';
                          setDoctorId(id);
                          if (id) {
                            const doctor = unlinkedDoctors?.doctors.find((item) => item.id === id);
                            if (doctor?.email) setEmail(doctor.email);
                          }
                        }}
                        required
                      >
                        <option value="">— pick a doctor —</option>
                        {unlinkedDoctors?.doctors.map((doctor) => (
                          <option key={doctor.id} value={doctor.id}>
                            {doctor.name}{doctor.specialty ? ` (${doctor.specialty})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input type="hidden" name="doctorId" value={doctorId} />
                  </>
                )}

                <div className="form-group">
                  <label htmlFor="inv-modal-role">Role</label>
                  <select
                    id="inv-modal-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    {availableRoles.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
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

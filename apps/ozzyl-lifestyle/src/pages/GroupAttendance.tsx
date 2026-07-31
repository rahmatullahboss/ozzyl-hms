import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Users, Calendar, ChevronRight, Plus, X } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

// ─── Types ───────────────────────────────────────────────────────────────────

type SessionType = 'therapy' | 'support' | 'education' | 'skills' | 'process';
type SessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
type ParticipationLevel = 'active' | 'moderate' | 'minimal' | 'none';

interface Session {
  SessionId: number;
  SessionName: string;
  SessionType: SessionType;
  ScheduledDate: string;
  Status: SessionStatus;
  FacilitatorId: number;
  Duration?: number;
  MaxMembers?: number;
  Notes?: string;
}

interface Member {
  PatientId: number;
  PatientName?: string;
  AttendanceStatus?: string;
}

/** API response shape for existing attendance records */
interface AttendanceRecord {
  PatientId: number;
  Status: AttendanceStatus;
  MoodRating?: number;
  ParticipationLevel?: ParticipationLevel;
}

/** Local editable form state per member (MoodRating is string for input binding) */
interface AttendanceForm {
  Status: AttendanceStatus;
  MoodRating: string;
  ParticipationLevel: ParticipationLevel | '';
}

interface NewSessionForm {
  SessionName: string;
  SessionType: string;
  ScheduledDate: string;
  Duration: string;
  MaxMembers: string;
  Notes: string;
}

// ─── Badge maps ───────────────────────────────────────────────────────────────

const SESSION_TYPE_BADGE: Record<SessionType, string> = {
  therapy:   'bg-blue-100 text-blue-700',
  support:   'bg-green-100 text-green-700',
  education: 'bg-amber-100 text-amber-700',
  skills:    'bg-purple-100 text-purple-700',
  process:   'bg-teal-100 text-teal-700',
};

const STATUS_BADGE: Record<SessionStatus, string> = {
  scheduled:   'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed:   'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-700',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: SessionType }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
        SESSION_TYPE_BADGE[type] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

const EMPTY_FORM: NewSessionForm = {
  SessionName: '',
  SessionType: '',
  ScheduledDate: '',
  Duration: '',
  MaxMembers: '',
  Notes: '',
};

const DEFAULT_ATTENDANCE: AttendanceForm = {
  Status: 'absent',
  MoodRating: '',
  ParticipationLevel: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function GroupAttendance({ role }: { role?: string }) {
  const { t } = useTranslation('staff');
  // View
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  // Sessions list
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Session detail
  const [members, setMembers] = useState<Member[]>([]);
  const [forms, setForms] = useState<Record<number, AttendanceForm>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  // New session modal
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newForm, setNewForm] = useState<NewSessionForm>(EMPTY_FORM);

  // ── Fetch sessions ──────────────────────────────────────────────────────────

  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await axios.get('/api/group-attendance', { headers: authHeaders() });
      setSessions(res.data?.Results ?? []);
    } catch {
      toast.error(t('groupAttendance.loadSessionsFailed'));
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // ── Fetch session detail ────────────────────────────────────────────────────

  const fetchSessionDetail = async (session: Session) => {
    setLoadingDetail(true);
    setMembers([]);
    setForms({});
    try {
      const [membersRes, attendanceRes] = await Promise.all([
        axios.get(`/api/group-attendance/${session.SessionId}/members`, {
          headers: authHeaders(),
        }),
        axios.get(`/api/group-attendance/${session.SessionId}/attendance`, {
          headers: authHeaders(),
        }),
      ]);

      const memberList: Member[] = membersRes.data?.Results ?? membersRes.data ?? [];
      const attendanceList: AttendanceRecord[] =
        attendanceRes.data?.Results ?? attendanceRes.data ?? [];

      // Build form map — start from existing records, fall back to defaults
      const formMap: Record<number, AttendanceForm> = {};
      const existingById: Record<number, AttendanceRecord> = {};
      attendanceList.forEach((a) => {
        existingById[a.PatientId] = a;
      });
      memberList.forEach((m) => {
        const ex = existingById[m.PatientId];
        formMap[m.PatientId] = ex
          ? {
              Status: ex.Status,
              MoodRating: ex.MoodRating != null ? String(ex.MoodRating) : '',
              ParticipationLevel: ex.ParticipationLevel ?? '',
            }
          : { ...DEFAULT_ATTENDANCE };
      });

      setMembers(memberList);
      setForms(formMap);
    } catch {
      toast.error(t('groupAttendance.loadSessionDetailsFailed'));
    } finally {
      setLoadingDetail(false);
    }
  };

  // ── Navigation ──────────────────────────────────────────────────────────────

  const handleSelectSession = (session: Session) => {
    setSelectedSession(session);
    setView('detail');
    fetchSessionDetail(session);
  };

  const handleBack = () => {
    setView('list');
    setSelectedSession(null);
    setMembers([]);
    setForms({});
  };

  // ── Create session ──────────────────────────────────────────────────────────

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.SessionName.trim() || !newForm.SessionType || !newForm.ScheduledDate) {
      toast.error(t('groupAttendance.sessionFieldsRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(
        '/api/group-attendance',
        {
          SessionName: newForm.SessionName.trim(),
          SessionType: newForm.SessionType,
          ScheduledDate: newForm.ScheduledDate,
          ...(newForm.Duration ? { Duration: parseInt(newForm.Duration, 10) } : {}),
          ...(newForm.MaxMembers ? { MaxMembers: parseInt(newForm.MaxMembers, 10) } : {}),
          ...(newForm.Notes.trim() ? { Notes: newForm.Notes.trim() } : {}),
        },
        { headers: authHeaders() },
      );
      toast.success(t('groupAttendance.sessionCreated'));
      setShowModal(false);
      setNewForm(EMPTY_FORM);
      fetchSessions();
    } catch {
      toast.error(t('groupAttendance.createSessionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Attendance field change ─────────────────────────────────────────────────

  const updateForm = (
    patientId: number,
    field: keyof AttendanceForm,
    value: string,
  ) => {
    setForms((prev) => ({
      ...prev,
      [patientId]: {
        ...(prev[patientId] ?? DEFAULT_ATTENDANCE),
        [field]: value,
      },
    }));
  };

  // ── Save attendance ─────────────────────────────────────────────────────────

  const handleSaveAttendance = async (patientId: number) => {
    if (!selectedSession) return;
    const f = forms[patientId];
    if (!f) return;

    setSaving((prev) => ({ ...prev, [patientId]: true }));
    try {
      await axios.post(
        `/api/group-attendance/${selectedSession.SessionId}/attendance`,
        {
          PatientId: patientId,
          Status: f.Status,
          ...(f.MoodRating !== '' ? { MoodRating: parseInt(f.MoodRating, 10) } : {}),
          ...(f.ParticipationLevel ? { ParticipationLevel: f.ParticipationLevel } : {}),
        },
        { headers: authHeaders() },
      );
      toast.success(t('groupAttendance.attendanceSaved'));
    } catch {
      toast.error(t('groupAttendance.saveAttendanceFailed'));
    } finally {
      setSaving((prev) => ({ ...prev, [patientId]: false }));
    }
  };

  // ── Stats ───────────────────────────────────────────────────────────────────

  const presentCount = members.filter(
    (m) => forms[m.PatientId]?.Status === 'present',
  ).length;
  const absentCount = members.filter(
    (m) => forms[m.PatientId]?.Status === 'absent',
  ).length;
  const totalCount = members.length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout role={role ?? ''}>
      <div className="p-6 space-y-6">

        {/* ═══════════════════════  SESSIONS LIST  ═══════════════════════════ */}

        {view === 'list' && (
          <>
            {/* Page header */}
            <div className="page-header flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users
                  className="w-6 h-6 shrink-0"
                  style={{ color: 'var(--color-primary)' }}
                />
                <h1 className="page-title">Group Attendance</h1>
              </div>
              <button
                className="btn btn-primary flex items-center gap-2"
                onClick={() => setShowModal(true)}
              >
                <Plus className="w-4 h-4" />
                New Session
              </button>
            </div>

            {/* Sessions table */}
            <div className="card overflow-hidden">
              {loadingSessions ? (
                <div
                  className="p-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Loading sessions…
                </div>
              ) : sessions.length === 0 ? (
                <div
                  className="p-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  No sessions found. Create a new session to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base w-full">
                    <thead>
                      <tr>
                        <th>Session Name</th>
                        <th>Type</th>
                        <th>Scheduled Date</th>
                        <th>Status</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => (
                        <tr
                          key={session.SessionId}
                          className="cursor-pointer transition-opacity hover:opacity-75"
                          onClick={() => handleSelectSession(session)}
                        >
                          <td style={{ color: 'var(--color-text)' }}>
                            {session.SessionName}
                          </td>
                          <td>
                            <TypeBadge type={session.SessionType} />
                          </td>
                          <td>
                            <span
                              className="flex items-center gap-1 text-sm"
                              style={{ color: 'var(--color-text-muted)' }}
                            >
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              {new Date(session.ScheduledDate).toLocaleDateString()}
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={session.Status} />
                          </td>
                          <td>
                            <ChevronRight
                              className="w-4 h-4"
                              style={{ color: 'var(--color-text-muted)' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════  SESSION DETAIL  ═══════════════════════════ */}

        {view === 'detail' && selectedSession && (
          <>
            {/* Back + session header */}
            <div className="page-header space-y-2">
              <button
                className="btn btn-ghost flex items-center gap-1 text-sm"
                onClick={handleBack}
              >
                ← Back to Sessions
              </button>

              <div className="flex flex-wrap items-center gap-3">
                <h1 className="page-title">{selectedSession.SessionName}</h1>
                <TypeBadge type={selectedSession.SessionType} />
                <StatusBadge status={selectedSession.Status} />
              </div>

              <p
                className="flex items-center gap-1 text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                {new Date(selectedSession.ScheduledDate).toLocaleString()}
              </p>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Present', value: presentCount, color: 'var(--color-primary)' },
                { label: 'Absent',  value: absentCount,  color: '#ef4444' },
                { label: 'Total',   value: totalCount,   color: 'var(--color-text-muted)' },
              ].map((stat) => (
                <div key={stat.label} className="card p-4 text-center">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: stat.color }}
                  >
                    {stat.value}
                  </p>
                  <p
                    className="mt-1 text-sm"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>

            {/* Members attendance table */}
            <div className="card overflow-hidden">
              <div className="px-5 pt-5 pb-3">
                <h2 className="section-title flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Member Attendance
                </h2>
              </div>

              {loadingDetail ? (
                <div
                  className="p-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Loading members…
                </div>
              ) : members.length === 0 ? (
                <div
                  className="p-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  No members found for this session.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base w-full">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Status</th>
                        <th>Mood (1–10)</th>
                        <th>Participation</th>
                        <th className="w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => {
                        const f = forms[member.PatientId] ?? DEFAULT_ATTENDANCE;
                        return (
                          <tr key={member.PatientId}>
                            {/* Member name */}
                            <td style={{ color: 'var(--color-text)' }}>
                              {member.PatientName ?? `Patient #${member.PatientId}`}
                            </td>

                            {/* Attendance status */}
                            <td>
                              <select
                                className="input"
                                value={f.Status}
                                onChange={(e) =>
                                  updateForm(
                                    member.PatientId,
                                    'Status',
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="present">Present</option>
                                <option value="absent">Absent</option>
                                <option value="late">Late</option>
                                <option value="excused">Excused</option>
                              </select>
                            </td>

                            {/* Mood rating */}
                            <td>
                              <input
                                type="number"
                                className="input w-20"
                                min={1}
                                max={10}
                                placeholder={t("groupAttendance.dashPlaceholder")}
                                value={f.MoodRating}
                                onChange={(e) =>
                                  updateForm(
                                    member.PatientId,
                                    'MoodRating',
                                    e.target.value,
                                  )
                                }
                              />
                            </td>

                            {/* Participation level */}
                            <td>
                              <select
                                className="input"
                                value={f.ParticipationLevel}
                                onChange={(e) =>
                                  updateForm(
                                    member.PatientId,
                                    'ParticipationLevel',
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="">— Select —</option>
                                <option value="active">Active</option>
                                <option value="moderate">Moderate</option>
                                <option value="minimal">Minimal</option>
                                <option value="none">None</option>
                              </select>
                            </td>

                            {/* Save button */}
                            <td>
                              <button
                                className="btn btn-primary text-xs px-3 py-1.5"
                                disabled={saving[member.PatientId]}
                                onClick={() => handleSaveAttendance(member.PatientId)}
                              >
                                {saving[member.PatientId] ? 'Saving…' : 'Save'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════  NEW SESSION MODAL  ════════════════════════ */}

        {showModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowModal(false);
            }}
          >
            <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto">
              {/* Modal header */}
              <div
                className="flex items-center justify-between px-6 py-4 border-b"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <h2 className="section-title">New Group Session</h2>
                <button
                  className="btn btn-ghost p-1"
                  onClick={() => setShowModal(false)}
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal form */}
              <form onSubmit={handleCreateSession} className="p-6 space-y-4">
                {/* Session name */}
                <div>
                  <label className="label">{t("staff.sessionNameRequired")} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    className="input w-full"
                    placeholder={t("groupAttendance.sessionNamePlaceholder")}
                    value={newForm.SessionName}
                    onChange={(e) =>
                      setNewForm((f) => ({ ...f, SessionName: e.target.value }))
                    }
                    required
                  />
                </div>

                {/* Session type */}
                <div>
                  <label className="label">{t("staff.sessionTypeRequired")} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    className="input w-full"
                    value={newForm.SessionType}
                    onChange={(e) =>
                      setNewForm((f) => ({ ...f, SessionType: e.target.value }))
                    }
                    required
                  >
                    <option value="">— Select type —</option>
                    <option value="therapy">Therapy</option>
                    <option value="support">Support</option>
                    <option value="education">Education</option>
                    <option value="skills">Skills</option>
                    <option value="process">Process</option>
                  </select>
                </div>

                {/* Scheduled date */}
                <div>
                  <label className="label">{t("staff.scheduledDateRequired")} <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="datetime-local"
                    className="input w-full"
                    value={newForm.ScheduledDate}
                    onChange={(e) =>
                      setNewForm((f) => ({ ...f, ScheduledDate: e.target.value }))
                    }
                    required
                  />
                </div>

                {/* Duration + Max members (2-col) */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('groupAttendance.durationMinutesLabel')}</label>
                    <input
                      type="number"
                      className="input w-full"
                      placeholder={t("groupAttendance.durationMinutes")}
                      min={1}
                      value={newForm.Duration}
                      onChange={(e) =>
                        setNewForm((f) => ({ ...f, Duration: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="label">{t('groupAttendance.maxMembersLabel')}</label>
                    <input
                      type="number"
                      className="input w-full"
                      placeholder={t("groupAttendance.maxMembers")}
                      min={1}
                      value={newForm.MaxMembers}
                      onChange={(e) =>
                        setNewForm((f) => ({ ...f, MaxMembers: e.target.value }))
                      }
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="label">{t('groupAttendance.notesLabel')}</label>
                  <textarea
                    className="input w-full"
                    rows={3}
                    placeholder={t("groupAttendance.notesPlaceholder")}
                    value={newForm.Notes}
                    onChange={(e) =>
                      setNewForm((f) => ({ ...f, Notes: e.target.value }))
                    }
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    className="btn btn-secondary flex-1"
                    onClick={() => setShowModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary flex-1"
                    disabled={submitting}
                  >
                    {submitting ? 'Creating…' : 'Create Session'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}

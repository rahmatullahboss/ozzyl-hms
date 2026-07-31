import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { ChevronRight, Video, Phone, Clock, Users, Plus, Search, Calendar, Activity } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TeleRoom {
  id: string;
  sessionId: string;
  appointmentId?: string;
  doctorId?: string;
  patientId?: string;
  doctorName: string;
  patientName: string;
  createdAt: string;
  status: 'waiting' | 'active' | 'in_progress' | 'ended';
}

interface UpcomingConsultation {
  id: number;
  patient_name: string;
  patient_code: string;
  doctor_name: string;
  time: string;
  type: string;
  status: 'scheduled' | 'in-progress' | 'completed';
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

function fmtTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function timeAgo(d: string): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}


// ─── Component ───────────────────────────────────────────────────────────────

export default function TelemedicineDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['telemedicine', 'common']);

  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<TeleRoom[]>([]);
  const [consultations, setConsultations] = useState<UpcomingConsultation[]>([]);
  const [, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');

  const tenantHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('hms_token')}`,
    'X-Tenant-Subdomain': slug,
  });

  useEffect(() => {
    fetchRooms();
    fetchConsultations();
  }, [slug]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/telemedicine/rooms', { headers: tenantHeaders() });
      if (res.data.rooms) setRooms(res.data.rooms);
    } catch {
      /* no rooms = ok */
    } finally {
      setLoading(false);
    }
  };

  const fetchConsultations = async () => {
    try {
      const res = await axios.get('/api/appointments?status=scheduled&limit=10', { headers: tenantHeaders() });
      const appts = res.data.appointments ?? res.data.data ?? [];
      setConsultations(appts.map((a: any) => ({
        id: a.id,
        patient_name: a.patient_name ?? a.name ?? '',
        patient_code: a.patient_code ?? '',
        doctor_name: a.doctor_name ?? '',
        time: a.appointment_date ?? a.scheduled_at ?? '',
        type: a.visit_type ?? a.type ?? 'Consultation',
        status: a.status ?? 'scheduled',
      })));
    } catch {
      /* appointments API unavailable */
    }
  };

  const createRoom = async (consultation?: UpcomingConsultation) => {
    setCreating(true);
    try {
      const doctorName = consultation?.doctor_name || 'Doctor';
      const patientName = consultation?.patient_name || 'Patient';
      const name = consultation ? `${doctorName} - ${patientName}` : 'Instant Consultation';
      const res = await axios.post('/api/telemedicine/rooms', {
        name,
        appointmentId: consultation?.id?.toString() || '',
        doctorName,
        patientName,
      }, { headers: tenantHeaders() });

      if (res.data.room) {
        navigate(`${basePath}/telemedicine/room/${res.data.room.id}`);
      }
    } catch (err) {
      console.error('Failed to create room:', err);
      alert('Failed to create telemedicine room. Check Cloudflare Realtime SFU configuration.');
    } finally {
      setCreating(false);
    }
  };

  const activeRooms = rooms.filter(r => r.status === 'active' || r.status === 'in_progress' || r.status === 'waiting');

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('title', { ns: 'telemedicine', defaultValue: 'Telemedicine' })}</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Telemedicine Dashboard</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Video consultations powered by Cloudflare Realtime SFU</p>
          </div>
          <button onClick={() => createRoom()} disabled={creating}
            className="btn-primary flex items-center gap-2 disabled:opacity-50">
            {creating ? <><Clock className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> New Room</>}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Active Rooms', value: activeRooms.length, icon: <Video className="w-5 h-5" />, color: '#10b981' },
            { label: "Today's Scheduled", value: consultations.length, icon: <Calendar className="w-5 h-5" />, color: '#6366f1' },
            { label: 'Waiting Patients', value: rooms.filter(r => r.status === 'waiting').length, icon: <Users className="w-5 h-5" />, color: '#f59e0b' },
            { label: 'Total This Month', value: 12, icon: <Activity className="w-5 h-5" />, color: '#088eaf' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0" style={{ background: color }}>
                {icon}
              </div>
              <div>
                <p className="text-xl font-bold text-[var(--color-text)]">{value}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Active Rooms */}
        {activeRooms.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-3">Active Rooms</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeRooms.map(room => (
                <div key={room.id} className="card p-4 border-l-4 border-l-emerald-500">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-medium text-emerald-600 uppercase">{room.status}</span>
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)]">{timeAgo(room.createdAt)}</span>
                  </div>
                  <p className="font-semibold text-sm mb-0.5">{room.doctorName}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mb-3">with {room.patientName}</p>
                  <Link to={`${basePath}/telemedicine/room/${room.id}`}
                    className="btn-primary text-xs w-full flex items-center justify-center gap-1.5">
                    <Video className="w-3.5 h-3.5" /> Join Room
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Consultations */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Upcoming Consultations</h2>
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--color-text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t("dashboard.search")} className="pl-8 pr-3 py-1.5 border border-[var(--color-border)] rounded-lg text-xs w-48" />
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                  <th className="text-left px-4 py-3">Patient</th>
                  <th className="text-left px-4 py-3">Doctor</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Time</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-center px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {consultations.filter(c => !search || c.patient_name.toLowerCase().includes(search.toLowerCase())).map(c => (
                  <tr key={c.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg)] transition">
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.patient_name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{c.patient_code}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.doctor_name}</td>
                    <td className="px-4 py-3"><span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">{c.type}</span></td>
                    <td className="px-4 py-3 text-xs">
                      <p>{fmtDate(c.time)}</p>
                      <p className="font-medium">{fmtTime(c.time)}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${
                        c.status === 'in-progress' ? 'bg-emerald-100 text-emerald-700' :
                        c.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                        'bg-amber-100 text-amber-700'
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => createRoom(c)} disabled={creating}
                        className="inline-flex items-center gap-1 text-xs text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                        <Phone className="w-3 h-3" /> Start
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

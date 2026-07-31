import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Clock, Pill, FlaskConical, BedDouble, FileText, Stethoscope, Calendar } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: number;
  type: 'visit' | 'prescription' | 'lab' | 'admission' | 'discharge' | 'appointment' | 'document' | 'referral' | 'consultation' | 'radiology_order' | 'radiology_report' | 'soap';
  title: string;
  description: string;
  date: string;
  doctor?: string;
  status?: string;
  details?: Record<string, string>;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  visit:        { icon: <Stethoscope className="w-4 h-4" />, color: '#088eaf', bg: '#088eaf15' },
  prescription: { icon: <Pill className="w-4 h-4" />,        color: '#6366f1', bg: '#6366f115' },
  lab:          { icon: <FlaskConical className="w-4 h-4" />, color: '#f59e0b', bg: '#f59e0b15' },
  admission:    { icon: <BedDouble className="w-4 h-4" />,    color: '#ef4444', bg: '#ef444415' },
  discharge:    { icon: <FileText className="w-4 h-4" />,     color: '#10b981', bg: '#10b98115' },
  appointment:  { icon: <Calendar className="w-4 h-4" />,     color: '#8b5cf6', bg: '#8b5cf615' },
  document:     { icon: <FileText className="w-4 h-4" />,     color: '#64748b', bg: '#64748b15' },
  referral:     { icon: <Stethoscope className="w-4 h-4" />,  color: '#0f766e', bg: '#0f766e15' },
  consultation: { icon: <Stethoscope className="w-4 h-4" />,  color: '#0ea5e9', bg: '#0ea5e915' },
  radiology_order:  { icon: <FlaskConical className="w-4 h-4" />, color: '#7c3aed', bg: '#7c3aed15' },
  radiology_report: { icon: <FileText className="w-4 h-4" />, color: '#16a34a', bg: '#16a34a15' },
  soap:         { icon: <FileText className="w-4 h-4" />,     color: '#f97316', bg: '#f9731615' },
};

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PatientTimeline({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['patients', 'common']);

  const { slug = '', id = '' } = useParams<{ slug: string; id: string }>();
  const basePath = `/h/${slug}`;

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [patientName, setPatientName] = useState('Mohammad Karim');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    axios.get(`/api/patients/${id}/timeline`, { headers: authHeaders() })
      .then(r => {
        setEvents(r.data.events ?? []);
        if (r.data.patient_name) setPatientName(r.data.patient_name);
      })
      .catch(() => {
        setEvents([]);
        setLoadError('Failed to load timeline');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
            <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
            <ChevronRight className="w-3 h-3" />
            <Link to={`${basePath}/patients`} className="hover:underline">Patients</Link>
            <ChevronRight className="w-3 h-3" />
            <Link to={`${basePath}/patients/${id}`} className="hover:underline">{patientName}</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[var(--color-text)] font-medium">{t('timeline', { defaultValue: 'Timeline' })}</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Medical Timeline</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Complete medical history for {patientName}</p>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2">
          {['all', 'visit', 'consultation', 'soap', 'prescription', 'lab', 'radiology_order', 'radiology_report', 'admission', 'discharge', 'appointment', 'document', 'referral'].map(t => (
            <button key={t} onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition capitalize ${
                filter === t
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-gray-100 text-[var(--color-text-muted)] hover:bg-gray-200'
              }`}>
              {t === 'all' ? `All (${events.length})` : `${t}s`}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="animate-pulse h-24 bg-gray-100 rounded-xl" />)}</div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-[var(--color-border)]" />

            <div className="space-y-4">
              {filtered.map(event => {
                const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.visit;
                return (
                  <div key={event.id} className="relative pl-14">
                    {/* Dot on timeline */}
                    <div className="absolute left-4 top-4 w-5 h-5 rounded-full border-2 border-white shadow-sm flex items-center justify-center"
                         style={{ background: cfg.color }}>
                      <div className="w-2 h-2 rounded-full bg-white" />
                    </div>

                    {/* Card */}
                    <div className="card p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: cfg.bg, color: cfg.color }}>
                            {cfg.icon}
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-[var(--color-text)]">{event.title}</p>
                            {event.doctor && <p className="text-xs text-[var(--color-text-muted)]">{event.doctor}</p>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-[var(--color-text-muted)]">{fmtDate(event.date)}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{fmtTime(event.date)}</p>
                        </div>
                      </div>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-2">{event.description}</p>

                      {/* Detail chips */}
                      {event.details && (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(event.details).map(([k, v]) => (
                            <span key={k} className="bg-gray-100 text-xs px-2 py-1 rounded-md text-[var(--color-text-muted)]">
                              <strong>{k}:</strong> {v}
                            </span>
                          ))}
                        </div>
                      )}

                      {event.status && (
                        <div className="mt-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${
                            event.status === 'completed' || event.status === 'final' ? 'bg-emerald-100 text-emerald-700' :
                            event.status === 'active' ? 'bg-blue-100 text-blue-700' :
                            event.status === 'upcoming' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {event.status}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-12 text-[var(--color-text-muted)]">
                <Clock className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">{loadError ?? 'No events found'}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

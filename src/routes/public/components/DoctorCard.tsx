/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  consultation_fee?: number;
  photo_key?: string;
  public_bio?: string;
  qualifications?: string;
  visiting_hours?: string;
}

interface Schedule {
  doctor_id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
  session_type?: string;
  chamber?: string;
  max_patients?: number;
}

interface DoctorCardProps {
  doctor: Doctor;
  basePath: string;
  uploadsBaseUrl?: string;
  schedules?: Schedule[];
}

const DAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getTodayDay(): string {
  return DAY_ORDER[new Date().getDay()];
}

export const DoctorCard: FC<DoctorCardProps> = ({ doctor, basePath, uploadsBaseUrl, schedules }) => {
  const photoUrl = doctor.photo_key && uploadsBaseUrl
    ? `${uploadsBaseUrl}/${doctor.photo_key}`
    : null;

  const docSchedules = (schedules || []).filter(s => s.doctor_id === doctor.id);
  const today = getTodayDay();
  const todaySchedules = docSchedules.filter(s => s.day_of_week === today);
  const isAvailableToday = todaySchedules.length > 0;

  return (
    <div class="card doctor-card">
      <div style="height:200px;background:#f0f4f8;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={`Photo of ${doctor.name}${doctor.specialty ? `, ${doctor.specialty}` : ''}`}
            loading="lazy"
            style="width:100%;height:100%;object-fit:cover"
          />
        ) : (
          <span style="font-size:4rem;opacity:0.3" aria-hidden="true">👨‍⚕️</span>
        )}
        {isAvailableToday && (
          <span style="position:absolute;top:10px;right:10px;background:#16a34a;color:#fff;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:600">
            Available Today
          </span>
        )}
      </div>
      <div class="card-body">
        <h3 style="font-size:1.1rem;font-weight:600;margin-bottom:0.25rem">{doctor.name}</h3>
        {doctor.specialty && (
          <p class="doctor-specialty" style="font-size:0.9rem;margin-bottom:0.5rem">
            {doctor.specialty}
          </p>
        )}
        {doctor.qualifications && (
          <p style="font-size:0.8rem;opacity:0.6;margin-bottom:0.5rem">{doctor.qualifications}</p>
        )}
        {docSchedules.length > 0 ? (
          <div style="margin:0.5rem 0;font-size:0.8rem">
            <p style="font-weight:600;margin-bottom:4px;opacity:0.8">Schedule:</p>
            <div style="display:flex;flex-wrap:wrap;gap:3px">
              {DAY_ORDER.map(day => {
                const daySlots = docSchedules.filter(s => s.day_of_week === day);
                if (daySlots.length === 0) return null;
                return (
                  <span
                    style={`display:inline-block;padding:2px 6px;border-radius:4px;font-size:0.7rem;${day === today ? 'background:var(--color-primary,#0891b2);color:#fff;font-weight:600' : 'background:#f0f4f8;color:#374151'}`}
                    title={daySlots.map(s => `${formatTime(s.start_time)}-${formatTime(s.end_time)}`).join(', ')}
                  >
                    {DAY_LABELS[day]}
                  </span>
                );
              })}
            </div>
            {todaySchedules.length > 0 && (
              <p style="font-size:0.75rem;opacity:0.7;margin-top:4px">
                Today: {todaySchedules.map(s => `${formatTime(s.start_time)}-${formatTime(s.end_time)}`).join(', ')}
              </p>
            )}
          </div>
        ) : doctor.visiting_hours ? (
          <p style="font-size:0.85rem;opacity:0.7">
            🕐 {doctor.visiting_hours}
          </p>
        ) : null}
        {doctor.consultation_fee != null && (
          <p class="doctor-fee" style="font-size:1rem;margin-top:0.5rem">
            ৳{doctor.consultation_fee}
          </p>
        )}
        <a
          href={`${basePath}/book?doctor=${doctor.id}`}
          class="btn btn-primary"
          style="display:block;text-align:center;margin-top:0.75rem;padding:0.5rem;font-size:0.85rem"
        >
          Book Appointment
        </a>
      </div>
    </div>
  );
};

interface DoctorListProps {
  doctors: Doctor[];
  basePath: string;
  uploadsBaseUrl?: string;
  schedules?: Schedule[];
}

export const DoctorList: FC<DoctorListProps> = ({ doctors, basePath, uploadsBaseUrl, schedules }) => (
  <div class="grid grid-3">
    {doctors.map((doc) => (
      <DoctorCard doctor={doc} basePath={basePath} uploadsBaseUrl={uploadsBaseUrl} schedules={schedules} />
    ))}
  </div>
);

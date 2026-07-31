import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import StarRating from '../../components/marketplace/StarRating';

const API = import.meta.env.VITE_API_URL || '';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function DoctorProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doctor, setDoctor] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [availability, setAvailability] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookMsg, setBookMsg] = useState('');

  useEffect(() => {
    const fetchDoctor = async () => {
      try {
        const [docRes, revRes] = await Promise.all([
          fetch(`${API}/api/v1/marketplace/doctors/${id}`),
          fetch(`${API}/api/v1/marketplace/doctors/${id}/reviews`),
        ]);
        if (docRes.ok) {
          const data = await docRes.json();
          setDoctor(data.doctor);
        } else {
          navigate('/marketplace/doctors', { replace: true });
        }
        if (revRes.ok) {
          const data = await revRes.json();
          setReviews(data.reviews || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchDoctor();
  }, [id, navigate]);

  useEffect(() => {
    const fetchAvailability = async () => {
      if (!bookDate || !id) return;
      try {
        const res = await fetch(`${API}/api/v1/marketplace/doctors/${id}/availability?date=${bookDate}`);
        if (res.ok) {
          const data = await res.json();
          setAvailability(data.slots || []);
        }
      } catch {
        setAvailability([]);
      }
    };
    fetchAvailability();
  }, [bookDate, id]);

  const handleBook = async () => {
    if (!bookDate || !bookTime) return;
    const token = localStorage.getItem('patient_token');
    if (!token) { navigate('/patient/login'); return; }
    setBooking(true);
    try {
      const res = await fetch(`${API}/api/v1/marketplace-patient/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ doctor_id: Number(id), tenant_id: doctor.tenant_id, booking_date: bookDate, booking_time: bookTime }),
      });
      const data = await res.json();
      setBookMsg(res.ok ? 'Appointment booked successfully!' : (data.error || 'Booking failed'));
    } catch {
      setBookMsg('Booking failed');
    } finally {
      setBooking(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!doctor) return null;

  const languages: string[] = doctor.languages ? JSON.parse(doctor.languages) : [];
  const feeDisplay = doctor.consultation_fee ? `৳${(doctor.consultation_fee / 100).toLocaleString()}` : 'N/A';
  const schedule: any[] = doctor.schedule || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2 text-sm text-gray-500">
          <Link to="/marketplace" className="hover:text-blue-600">Marketplace</Link>
          <span>/</span>
          <Link to="/marketplace/doctors" className="hover:text-blue-600">Doctors</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium truncate">{doctor.name}</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="grid md:grid-cols-3 gap-6">
          {/* Left: Doctor info */}
          <div className="md:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-3xl shrink-0">
                  👨‍⚕️
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{doctor.name}</h1>
                  <p className="text-blue-600 capitalize font-medium">{doctor.specialty}</p>
                  <p className="text-sm text-gray-500">
                    {doctor.tenant_type === 'chamber' ? 'Independent Chamber' : doctor.hospital_name}
                  </p>
                  <div className="mt-1.5">
                    <StarRating rating={doctor.avg_rating || 0} reviewCount={doctor.review_count || 0} size="md" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-gray-500 text-xs">Consultation Fee</p>
                  <p className="font-semibold text-green-700">{feeDisplay}</p>
                </div>
                {doctor.bmdc_reg_no && (
                  <div className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-gray-500 text-xs">BMDC Reg</p>
                    <p className="font-medium text-gray-800">{doctor.bmdc_reg_no}</p>
                  </div>
                )}
              </div>

              {doctor.qualifications && (
                <p className="mt-3 text-sm text-gray-600">{doctor.qualifications}</p>
              )}
              {doctor.public_bio && (
                <p className="mt-3 text-sm text-gray-600 leading-relaxed">{doctor.public_bio}</p>
              )}
              {languages.length > 0 && (
                <p className="mt-2 text-xs text-gray-500 capitalize">Languages: {languages.join(', ')}</p>
              )}
            </div>

            {/* Weekly schedule */}
            {schedule.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900 mb-3">Schedule</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {schedule.map((s: any) => (
                    <div key={s.id} className="text-sm bg-green-50 rounded-lg p-2">
                      <p className="font-medium text-gray-700">{DAYS[s.day_of_week]}</p>
                      <p className="text-gray-500">{s.start_time}–{s.end_time}</p>
                      <p className="text-xs text-gray-400">Max {s.max_patients} patients</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews */}
            <div>
              <h2 className="font-semibold text-gray-900 mb-3">Reviews ({reviews.length})</h2>
              {reviews.length === 0 ? (
                <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-6 text-center">No reviews yet</p>
              ) : (
                <div className="space-y-3">
                  {reviews.map((r: any) => (
                    <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-1">
                        <StarRating rating={r.rating} size="sm" />
                        <span className="text-xs text-gray-400">{r.created_at?.slice(0, 10)}</span>
                      </div>
                      {r.review_text && <p className="text-sm text-gray-600">{r.review_text}</p>}
                      {r.is_verified_visit === 1 && (
                        <span className="text-xs text-green-600 mt-1 inline-block">✓ Verified visit</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Booking panel */}
          <div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 sticky top-4">
              <h2 className="font-semibold text-gray-900 mb-3">Book Appointment</h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={bookDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => { setBookDate(e.target.value); setBookTime(''); }}
                    className="w-full rounded-lg border border-gray-300 text-sm px-2 py-1.5"
                  />
                </div>

                {bookDate && availability.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Available Times</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {availability.map((slot: any) => (
                        <button
                          key={slot.time}
                          onClick={() => setBookTime(slot.time)}
                          disabled={!slot.available}
                          className={`text-xs py-1.5 rounded-lg border transition-colors ${
                            bookTime === slot.time
                              ? 'bg-blue-600 text-white border-blue-600'
                              : slot.available
                              ? 'border-gray-300 hover:border-blue-300 hover:bg-blue-50'
                              : 'border-gray-100 text-gray-300 cursor-not-allowed'
                          }`}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {bookDate && availability.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">No slots available for this date</p>
                )}

                {bookMsg && (
                  <p className={`text-sm text-center py-1 rounded ${bookMsg.includes('success') ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                    {bookMsg}
                  </p>
                )}

                <button
                  onClick={handleBook}
                  disabled={!bookDate || !bookTime || booking}
                  className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {booking ? 'Booking...' : 'Confirm Appointment'}
                </button>

                <p className="text-xs text-gray-400 text-center">Fee: {feeDisplay} per visit</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

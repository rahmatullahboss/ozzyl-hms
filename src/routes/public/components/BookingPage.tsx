/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  consultation_fee?: number;
  photo_key?: string;
}

interface Schedule {
  doctor_id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
  session_type?: string;
  max_patients?: number;
}

interface BookingPageProps {
  doctors: Doctor[];
  schedules: Schedule[];
  basePath: string;
  hospitalName: string;
  subdomain: string;
}

const DAY_LABELS: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export const BookingPage: FC<BookingPageProps> = ({ doctors, schedules, basePath, hospitalName, subdomain }) => {
  // Group schedules by doctor
  const scheduleMap: Record<number, Schedule[]> = {};
  for (const s of schedules) {
    if (!scheduleMap[s.doctor_id]) scheduleMap[s.doctor_id] = [];
    scheduleMap[s.doctor_id].push(s);
  }

  return (
    <section class="section">
      <div class="container" style="max-width:900px">
        <h1 class="section-title text-center">Book an Appointment</h1>
        <p class="section-subtitle text-center">Select a doctor and choose your preferred time</p>

        {/* Doctor selection — SSR list */}
        <div id="booking-app" data-subdomain={subdomain} data-base-path={basePath}>
          <div class="grid grid-2" style="margin-top:2rem;gap:1rem">
            {doctors.map((doc) => {
              const docSchedule = scheduleMap[doc.id] || [];
              return (
                <div
                  class="card booking-doctor-card"
                  data-doctor-id={doc.id}
                  data-doctor-name={doc.name}
                  data-doctor-fee={doc.consultation_fee ?? 0}
                  style="cursor:pointer;transition:all 0.2s"
                >
                  <div class="card-body">
                    <h3 style="font-size:1.05rem;font-weight:600;margin-bottom:0.25rem">{doc.name}</h3>
                    {doc.specialty && (
                      <p style="font-size:0.85rem;color:var(--color-primary);margin-bottom:0.5rem">{doc.specialty}</p>
                    )}
                    {doc.consultation_fee != null && (
                      <p style="font-size:0.9rem;font-weight:600;margin-bottom:0.5rem">Fee: ৳{doc.consultation_fee}</p>
                    )}
                    {docSchedule.length > 0 && (
                      <div style="font-size:0.8rem;opacity:0.8">
                        {docSchedule.map(s => (
                          <p style="margin:2px 0">
                            {DAY_LABELS[s.day_of_week]}: {formatTime(s.start_time)} - {formatTime(s.end_time)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Booking form — initially hidden, shown via client JS */}
          <div id="booking-form" style="display:none;margin-top:2rem">
            <div class="card">
              <div class="card-body">
                <h3 id="selected-doctor-name" style="font-size:1.1rem;font-weight:600;margin-bottom:1rem"></h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
                  <div>
                    <label style="display:block;font-weight:500;margin-bottom:4px;font-size:0.9rem">Date</label>
                    <input type="date" id="booking-date" class="input" style="width:100%;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px" />
                  </div>
                  <div>
                    <label style="display:block;font-weight:500;margin-bottom:4px;font-size:0.9rem">Time (optional)</label>
                    <input type="time" id="booking-time" class="input" style="width:100%;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px" />
                  </div>
                </div>
                <div style="margin-top:1rem">
                  <label style="display:block;font-weight:500;margin-bottom:4px;font-size:0.9rem">Chief Complaint</label>
                  <textarea id="booking-complaint" rows={3} maxlength={500} placeholder="Briefly describe your concern..."
                    style="width:100%;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;resize:vertical;font-family:inherit" />
                </div>
                <div id="booking-status" style="margin-top:1rem;display:none"></div>
                <div style="margin-top:1.5rem;display:flex;gap:1rem">
                  <button id="booking-submit" class="btn btn-primary" style="flex:1;padding:0.75rem">
                    Confirm Booking
                  </button>
                  <button id="booking-cancel" class="btn btn-outline" style="padding:0.75rem">
                    Back
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Auth modal — shown when booking without login */}
          <div id="auth-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center">
            <div class="card" style="max-width:420px;width:90%;margin:auto;position:relative">
              <div class="card-body">
                <button id="auth-close" style="position:absolute;top:12px;right:12px;background:none;border:none;font-size:1.5rem;cursor:pointer;opacity:0.5">×</button>
                <h3 style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem">Login or Register</h3>
                <p style="font-size:0.85rem;opacity:0.7;margin-bottom:1rem">To complete your booking, please login or create an account.</p>

                <div id="auth-tabs" style="display:flex;gap:0;margin-bottom:1rem">
                  <button class="auth-tab active" data-tab="login" style="flex:1;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px 0 0 6px;cursor:pointer;font-weight:600;background:var(--color-primary,#0891b2);color:#fff">Login</button>
                  <button class="auth-tab" data-tab="register" style="flex:1;padding:0.5rem;border:1px solid #d1d5db;border-radius:0 6px 6px 0;cursor:pointer;background:#f9fafb">Register</button>
                </div>

                {/* Login form */}
                <div id="auth-login" style="display:block">
                  <input type="email" id="login-email" placeholder="Email address" style="width:100%;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;margin-bottom:0.75rem" />
                  <button id="login-submit" class="btn btn-primary" style="width:100%;padding:0.6rem">Send Login Link</button>
                </div>

                {/* Register form */}
                <div id="auth-register" style="display:none">
                  <input type="text" id="register-name" placeholder="Full name" style="width:100%;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;margin-bottom:0.5rem" />
                  <input type="email" id="register-email" placeholder="Email address" style="width:100%;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;margin-bottom:0.5rem" />
                  <input type="tel" id="register-mobile" placeholder="Mobile (optional)" style="width:100%;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;margin-bottom:0.75rem" />
                  <button id="register-submit" class="btn btn-primary" style="width:100%;padding:0.6rem;background:#16a34a">Create Account</button>
                </div>

                <div id="auth-status" style="margin-top:0.75rem;display:none"></div>

                {/* Email sent confirmation */}
                <div id="auth-email-sent" style="display:none;text-align:center;padding:1rem 0">
                  <p style="font-size:2rem;margin-bottom:0.5rem">📧</p>
                  <p style="font-weight:600;margin-bottom:0.5rem">Check your email!</p>
                  <p style="font-size:0.85rem;opacity:0.7">We've sent a login link to your email. Click the link to complete your booking.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Client-side booking JS */}
        <script dangerouslySetInnerHTML={{ __html: bookingScript() }} />
      </div>
    </section>
  );
};

function bookingScript(): string {
  return `
(function() {
  var selectedDoctor = null;
  var token = localStorage.getItem('patient_token');
  var bookingApp = document.getElementById('booking-app');
  var subdomain = bookingApp ? bookingApp.dataset.subdomain : '';

  // Select doctor
  document.querySelectorAll('.booking-doctor-card').forEach(function(card) {
    card.addEventListener('click', function() {
      selectedDoctor = {
        id: Number(this.dataset.doctorId),
        name: this.dataset.doctorName,
        fee: Number(this.dataset.doctorFee)
      };
      document.getElementById('selected-doctor-name').textContent = 'Booking with ' + selectedDoctor.name + (selectedDoctor.fee ? ' (Fee: \\u09F3' + selectedDoctor.fee + ')' : '');
      document.getElementById('booking-form').style.display = 'block';
      // Set min date to today
      var today = new Date().toISOString().split('T')[0];
      document.getElementById('booking-date').min = today;
      document.getElementById('booking-date').value = today;
      this.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  // Cancel
  var cancelBtn = document.getElementById('booking-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', function() {
    document.getElementById('booking-form').style.display = 'none';
    selectedDoctor = null;
  });

  // Submit booking
  var submitBtn = document.getElementById('booking-submit');
  if (submitBtn) submitBtn.addEventListener('click', function() {
    if (!selectedDoctor) return;
    var date = document.getElementById('booking-date').value;
    if (!date) { showStatus('booking-status', 'Please select a date', 'error'); return; }

    token = localStorage.getItem('patient_token');
    if (!token) {
      // Save pending booking and show auth modal
      sessionStorage.setItem('pending_booking', JSON.stringify({
        doctorId: selectedDoctor.id,
        apptDate: date,
        apptTime: document.getElementById('booking-time').value || undefined,
        chiefComplaint: document.getElementById('booking-complaint').value || undefined
      }));
      showAuthModal();
      return;
    }
    submitBooking(token);
  });

  function submitBooking(authToken) {
    var date = document.getElementById('booking-date').value;
    var time = document.getElementById('booking-time').value;
    var complaint = document.getElementById('booking-complaint').value;

    var body = { doctorId: selectedDoctor.id, apptDate: date };
    if (time) body.apptTime = time;
    if (complaint) body.chiefComplaint = complaint;

    showStatus('booking-status', 'Booking...', 'info');
    fetch('/api/patient-portal/book-appointment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
      body: JSON.stringify(body)
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (res.ok) {
        showStatus('booking-status', 'Appointment booked! Token #' + (res.data.appointment?.tokenNo || '') + ' — ' + (res.data.appointment?.doctorName || selectedDoctor.name) + ' on ' + (res.data.appointment?.date || ''), 'success');
        document.getElementById('booking-submit').style.display = 'none';
        sessionStorage.removeItem('pending_booking');
      } else {
        showStatus('booking-status', res.data.error || res.data.message || 'Booking failed', 'error');
      }
    }).catch(function() { showStatus('booking-status', 'Network error', 'error'); });
  }

  // Auth modal
  function showAuthModal() {
    var modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
  }

  var closeBtn = document.getElementById('auth-close');
  if (closeBtn) closeBtn.addEventListener('click', function() {
    document.getElementById('auth-modal').style.display = 'none';
  });

  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.auth-tab').forEach(function(t) { t.classList.remove('active'); t.style.background = '#f9fafb'; t.style.color = '#374151'; });
      this.classList.add('active'); this.style.background = 'var(--color-primary,#0891b2)'; this.style.color = '#fff';
      var tabName = this.dataset.tab;
      document.getElementById('auth-login').style.display = tabName === 'login' ? 'block' : 'none';
      document.getElementById('auth-register').style.display = tabName === 'register' ? 'block' : 'none';
      document.getElementById('auth-email-sent').style.display = 'none';
      document.getElementById('auth-status').style.display = 'none';
    });
  });

  // Login submit
  var loginBtn = document.getElementById('login-submit');
  if (loginBtn) loginBtn.addEventListener('click', function() {
    var email = document.getElementById('login-email').value;
    if (!email) { showStatus('auth-status', 'Please enter email', 'error'); return; }
    showStatus('auth-status', 'Sending login link...', 'info');
    fetch('/api/patient-portal/request-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    }).then(function(r) { return r.json(); })
    .then(function(data) {
      document.getElementById('auth-login').style.display = 'none';
      document.getElementById('auth-email-sent').style.display = 'block';
      document.getElementById('auth-status').style.display = 'none';
    }).catch(function() { showStatus('auth-status', 'Failed to send', 'error'); });
  });

  // Register submit
  var regBtn = document.getElementById('register-submit');
  if (regBtn) regBtn.addEventListener('click', function() {
    var name = document.getElementById('register-name').value;
    var email = document.getElementById('register-email').value;
    var mobile = document.getElementById('register-mobile').value;
    if (!name || !email) { showStatus('auth-status', 'Name and email required', 'error'); return; }
    showStatus('auth-status', 'Creating account...', 'info');
    fetch('/api/patient-portal/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, mobile: mobile || undefined })
    }).then(function(r) { return r.json(); })
    .then(function(data) {
      document.getElementById('auth-register').style.display = 'none';
      document.getElementById('auth-email-sent').style.display = 'block';
      document.getElementById('auth-status').style.display = 'none';
    }).catch(function() { showStatus('auth-status', 'Registration failed', 'error'); });
  });

  // Check for pending booking after magic link verification redirect
  if (token) {
    var pending = sessionStorage.getItem('pending_booking');
    if (pending) {
      try {
        var booking = JSON.parse(pending);
        selectedDoctor = { id: booking.doctorId, name: '' };
        submitBooking(token);
      } catch(e) { sessionStorage.removeItem('pending_booking'); }
    }
  }

  function showStatus(id, msg, type) {
    var el = document.getElementById(id);
    el.style.display = 'block';
    el.textContent = msg;
    el.style.padding = '0.5rem';
    el.style.borderRadius = '6px';
    el.style.fontSize = '0.85rem';
    if (type === 'error') { el.style.background = '#fef2f2'; el.style.color = '#dc2626'; }
    else if (type === 'success') { el.style.background = '#f0fdf4'; el.style.color = '#16a34a'; }
    else { el.style.background = '#eff6ff'; el.style.color = '#2563eb'; }
  }
})();
`;
}

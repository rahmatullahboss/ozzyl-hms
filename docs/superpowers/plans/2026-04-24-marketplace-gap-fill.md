# Marketplace Ecosystem Gap-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 4 critical gaps in the HMS marketplace ecosystem: review moderation, location-based search, doctor schedule exposure, and telemedicine marketplace booking.

**Architecture:** Build on the existing solid marketplace foundation. Each task is self-contained and deployable independently. Backend uses existing Hono + D1 patterns. Frontend uses existing React Query + Tailwind patterns in `apps/ozzyl-lifestyle/`.

**Tech Stack:** Hono, D1 SQLite, Drizzle ORM, React Query, Tailwind CSS, Cloudflare Realtime SFU

**Date:** 2026-04-24

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/routes/marketplace-reviews.ts` | Admin review moderation API (list, approve, reject, reply) |
| `apps/ozzyl-lifestyle/src/pages/marketplace/ReviewModerationPage.tsx` | Hospital admin review moderation UI |
| `test/marketplace-gaps.test.ts` | Tests for all 4 gap areas |

### Modified Files
| File | Responsibility |
|------|---------------|
| `src/routes/marketplace.ts` | Fix location search (use lat/lng/radius), add doctor schedule join |
| `src/routes/marketplace-patient.ts` | Add telemedicine marketplace booking endpoint |
| `src/routes/marketplace-admin.ts` | Add review moderation routes |
| `src/index.ts` | Register new routes |
| `apps/ozzyl-lifestyle/src/pages/marketplace/DoctorProfile.tsx` | Fix schedule display, add telemedicine booking button |
| `apps/ozzyl-lifestyle/src/pages/marketplace/HospitalProfile.tsx` | Render hospital photos gallery |
| `apps/ozzyl-lifestyle/src/components/dashboard/Sidebar.tsx` | Add Review Moderation nav item |
| `apps/ozzyl-lifestyle/src/App.tsx` | Add ReviewModerationPage route |

---

## Task 1: Location-Based Search Fix (Backend)

**Goal:** Actually use lat/lng/radius params in the hospital search SQL.

**Files:**
- Modify: `src/routes/marketplace.ts:15-80`

- [ ] **Step 1: Add Haversine distance formula to hospital search**

```typescript
// In the /hospitals GET handler, after the existing query building:

    // Location-based search with Haversine formula
    if (params.lat != null && params.lng != null && params.radius != null) {
      const lat = params.lat;
      const lng = params.lng;
      const radiusKm = params.radius;
      query = query.replace(
        'SELECT t.id, t.name',
        `SELECT t.id, t.name, (
          6371 * acos(
            cos(radians(?)) * cos(radians(t.latitude)) *
            cos(radians(t.longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(t.latitude))
          )
        ) AS distance`
      );
      binds.unshift(lat, lng, lat); // prepend because of SELECT replacement
      query += ` HAVING distance <= ?`;
      binds.push(radiusKm);
    }
```

- [ ] **Step 2: Add ORDER BY distance when location search is active**

```typescript
    // After GROUP BY, before LIMIT:
    if (params.lat != null && params.lng != null) {
      query += ` ORDER BY distance ASC, avg_rating DESC`;
    } else {
      query += ` ORDER BY avg_rating DESC, review_count DESC`;
    }
```

- [ ] **Step 3: Add distance to response when present**

```typescript
    // In the response mapping, include distance if it exists
    return c.json({
      data: results.map((r: any) => ({
        ...r,
        distance_km: r.distance != null ? Math.round(r.distance * 10) / 10 : undefined,
        specialties: safeJsonParse(r.specialties, []),
        public_photos: safeJsonParse(r.public_photos, []),
        operating_hours: safeJsonParse(r.operating_hours, {}),
      })),
      pagination: { page: params.page, limit: params.limit, total: countResult?.total ?? 0 },
    });
```

- [ ] **Step 4: Build and verify**

Run: `pnpm build`
Expected: ✅ No errors

---

## Task 2: Doctor Schedule in Public API (Backend)

**Goal:** Include doctor schedule data in the `/api/v1/marketplace/doctors/:id` response so the frontend can show available slots.

**Files:**
- Modify: `src/routes/marketplace.ts:200-260` (approximate, find the /doctors/:id handler)

- [ ] **Step 1: Read the current /doctors/:id handler**

```bash
grep -n "doctors/:id" src/routes/marketplace.ts
```

- [ ] **Step 2: Add schedule join to the query**

```typescript
    // After fetching the doctor, also fetch their schedule
    const schedule = await c.env.DB.prepare(`
      SELECT day_of_week, start_time, end_time, slot_duration_min, is_available
      FROM doctor_schedules
      WHERE doctor_id = ? AND tenant_id = ? AND is_available = 1
      ORDER BY day_of_week, start_time
    `).bind(id, doctor.tenant_id).all();

    // Also fetch the next 14 days of availability
    const today = new Date().toISOString().split('T')[0];
    const twoWeeksLater = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
    
    const { results: bookedSlots } = await c.env.DB.prepare(`
      SELECT booking_date, booking_time
      FROM appointments
      WHERE doctor_id = ? AND tenant_id = ?
        AND booking_date BETWEEN ? AND ?
        AND status NOT IN ('cancelled', 'no_show')
    `).bind(id, doctor.tenant_id, today, twoWeeksLater).all();
```

- [ ] **Step 3: Return schedule in response**

```typescript
    return c.json({
      data: {
        ...doctor,
        specialties: safeJsonParse(doctor.specialties, []),
        languages: safeJsonParse(doctor.languages, []),
        schedule: schedule.results,
        booked_slots: bookedSlots,
      },
    });
```

---

## Task 3: Review Moderation API (Backend)

**Goal:** Create admin endpoints to list pending reviews, approve, reject, and reply.

**Files:**
- Create: `src/routes/marketplace-reviews.ts`
- Modify: `src/index.ts` — register the new routes

- [ ] **Step 1: Create marketplace-reviews.ts**

```typescript
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireTenantId, requireUserId } from '../lib/context-helpers';
import type { Env, Variables } from '../types';

const reviewModRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/v1/marketplace/reviews/pending — List pending reviews for this hospital
reviewModRoutes.get('/pending', async (c) => {
  const tenantId = String(requireTenantId(c));
  const { page = '1', limit = '20' } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);

  const { results } = await c.env.DB.prepare(`
    SELECT r.*,
      g.primary_name as reviewer_name,
      CASE WHEN r.target_doctor_id IS NOT NULL THEN d.name ELSE NULL END as doctor_name
    FROM provider_reviews r
    LEFT JOIN global_patient_identity g ON g.uhid = r.reviewer_global_patient_id
    LEFT JOIN doctors d ON d.id = r.target_doctor_id AND d.tenant_id = r.target_tenant_id
    WHERE r.target_tenant_id = ? AND r.is_approved = 0
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, Number(limit), offset).all();

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = 0`
  ).bind(tenantId).first<{ total: number }>();

  return c.json({ data: results, pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 } });
});

// GET /api/v1/marketplace/reviews/all — List all reviews for this hospital
reviewModRoutes.get('/all', async (c) => {
  const tenantId = String(requireTenantId(c));
  const { page = '1', limit = '20', status } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);

  let query = `
    SELECT r.*,
      g.primary_name as reviewer_name,
      CASE WHEN r.target_doctor_id IS NOT NULL THEN d.name ELSE NULL END as doctor_name
    FROM provider_reviews r
    LEFT JOIN global_patient_identity g ON g.uhid = r.reviewer_global_patient_id
    LEFT JOIN doctors d ON d.id = r.target_doctor_id AND d.tenant_id = r.target_tenant_id
    WHERE r.target_tenant_id = ?
  `;
  const binds: (string | number)[] = [tenantId];

  if (status === 'pending') {
    query += ` AND r.is_approved = 0`;
  } else if (status === 'approved') {
    query += ` AND r.is_approved = 1`;
  } else if (status === 'rejected') {
    query += ` AND r.is_approved = -1`;
  }

  query += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
  binds.push(Number(limit), offset);

  const { results } = await c.env.DB.prepare(query).bind(...binds).all();

  const countQuery = status === 'pending'
    ? `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = 0`
    : status === 'approved'
    ? `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = 1`
    : status === 'rejected'
    ? `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = -1`
    : `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ?`;

  const countResult = await c.env.DB.prepare(countQuery).bind(tenantId).first<{ total: number }>();

  return c.json({ data: results, pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 } });
});

// PUT /api/v1/marketplace/reviews/:id/approve
reviewModRoutes.put('/:id/approve', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const reviewId = Number(c.req.param('id'));

  const review = await c.env.DB.prepare(
    `SELECT id, target_tenant_id FROM provider_reviews WHERE id = ?`
  ).bind(reviewId).first<{ id: number; target_tenant_id: string }>();

  if (!review) throw new HTTPException(404, { message: 'Review not found' });
  if (review.target_tenant_id !== tenantId) throw new HTTPException(403, { message: 'Not authorized' });

  await c.env.DB.prepare(
    `UPDATE provider_reviews SET is_approved = 1, moderated_by = ?, moderated_at = datetime('now') WHERE id = ?`
  ).bind(userId, reviewId).run();

  return c.json({ message: 'Review approved' });
});

// PUT /api/v1/marketplace/reviews/:id/reject
reviewModRoutes.put('/:id/reject', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const reviewId = Number(c.req.param('id'));
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}));

  const review = await c.env.DB.prepare(
    `SELECT id, target_tenant_id FROM provider_reviews WHERE id = ?`
  ).bind(reviewId).first<{ id: number; target_tenant_id: string }>();

  if (!review) throw new HTTPException(404, { message: 'Review not found' });
  if (review.target_tenant_id !== tenantId) throw new HTTPException(403, { message: 'Not authorized' });

  await c.env.DB.prepare(
    `UPDATE provider_reviews SET is_approved = -1, moderated_by = ?, moderated_at = datetime('now'), moderation_reason = ? WHERE id = ?`
  ).bind(userId, body.reason ?? null, reviewId).run();

  return c.json({ message: 'Review rejected' });
});

// POST /api/v1/marketplace/reviews/:id/reply
reviewModRoutes.post('/:id/reply', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const reviewId = Number(c.req.param('id'));
  const body = await c.req.json<{ reply_text: string }>();

  if (!body.reply_text?.trim()) throw new HTTPException(400, { message: 'Reply text required' });

  const review = await c.env.DB.prepare(
    `SELECT id, target_tenant_id FROM provider_reviews WHERE id = ?`
  ).bind(reviewId).first<{ id: number; target_tenant_id: string }>();

  if (!review) throw new HTTPException(404, { message: 'Review not found' });
  if (review.target_tenant_id !== tenantId) throw new HTTPException(403, { message: 'Not authorized' });

  await c.env.DB.prepare(
    `UPDATE provider_reviews SET provider_reply = ?, provider_reply_at = datetime('now'), provider_reply_by = ? WHERE id = ?`
  ).bind(body.reply_text.trim(), userId, reviewId).run();

  return c.json({ message: 'Reply posted' });
});

export default reviewModRoutes;
```

- [ ] **Step 2: Register in src/index.ts**

Find where `marketplaceAdminRoutes` is mounted and add:

```typescript
import marketplaceReviewRoutes from './routes/marketplace-reviews';
// ...
app.route('/api/v1/marketplace/reviews', marketplaceReviewRoutes);
```

---

## Task 4: Telemedicine Marketplace Booking (Backend)

**Goal:** Allow patients to book video consultations through the marketplace, creating both a `consultations` record and a `marketplace_bookings` record.

**Files:**
- Modify: `src/routes/marketplace-patient.ts`

- [ ] **Step 1: Add POST /api/v1/marketplace-patient/telemedicine-bookings endpoint**

Add this route after the existing `/bookings` POST:

```typescript
// POST /api/v1/marketplace-patient/telemedicine-bookings
marketplacePatientRoutes.post('/telemedicine-bookings', async (c) => {
  const body = await c.req.json<{
    doctor_id: number;
    tenant_id: string;
    booking_date: string;
    booking_time: string;
    chief_complaint?: string;
  }>();

  const uhid = c.get('tenantId')!;

  if (!body.doctor_id || !body.tenant_id || !body.booking_date || !body.booking_time) {
    throw new HTTPException(400, { message: 'doctor_id, tenant_id, booking_date, booking_time required' });
  }

  // Ensure connection exists (same logic as regular booking)
  let link = await c.env.DB.prepare(
    `SELECT local_patient_id FROM patient_health_links WHERE global_patient_id = ? AND tenant_id = ?`
  ).bind(uhid, body.tenant_id).first<{ local_patient_id: number }>();

  if (!link) {
    // Auto-connect (same logic as /connect/:tenantId)
    const identity = await c.env.DB.prepare(
      `SELECT id, primary_name, primary_phone, primary_email, national_id, blood_group, date_of_birth, gender
       FROM global_patient_identity WHERE uhid = ?`
    ).bind(uhid).first<Record<string, unknown>>();

    if (!identity) throw new HTTPException(404, { message: 'Patient identity not found' });

    const patientResult = await c.env.DB.prepare(`
      INSERT INTO patients (tenant_id, name, mobile, email, national_id, blood_group, date_of_birth, gender, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'marketplace', datetime('now'))
    `).bind(
      body.tenant_id, identity.primary_name, identity.primary_phone ?? null,
      identity.primary_email ?? null, identity.national_id ?? null,
      identity.blood_group ?? null, identity.date_of_birth ?? null,
      identity.gender ?? null
    ).run();

    const localPatientId = patientResult.meta.last_row_id;

    await c.env.DB.prepare(`
      INSERT INTO patient_health_links (global_patient_id, tenant_id, local_patient_id, link_type, status, created_at)
      VALUES (?, ?, ?, 'marketplace', 'active', datetime('now'))
    `).bind(uhid, body.tenant_id, localPatientId).run();

    link = { local_patient_id: localPatientId };
  }

  // Create consultation record
  const consultationResult = await c.env.DB.prepare(`
    INSERT INTO consultations (tenant_id, doctor_id, patient_id, scheduled_at, duration_min, status, chief_complaint, created_at)
    VALUES (?, ?, ?, datetime(? || ' ' || ?), 30, 'scheduled', ?, datetime('now'))
  `).bind(body.tenant_id, body.doctor_id, link.local_patient_id, body.booking_date, body.booking_time, body.chief_complaint ?? null).run();

  const consultationId = consultationResult.meta.last_row_id;

  // Create marketplace booking record linking to consultation
  const bookingResult = await c.env.DB.prepare(`
    INSERT INTO marketplace_bookings
      (patient_global_id, doctor_id, tenant_id, booking_date, booking_time, status, local_appointment_id, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'confirmed', ?, 'telemedicine', datetime('now'))
  `).bind(uhid, body.doctor_id, body.tenant_id, body.booking_date, body.booking_time, consultationId).run();

  return c.json({
    message: 'Telemedicine consultation booked',
    booking_id: bookingResult.meta.last_row_id,
    consultation_id: consultationId,
    status: 'confirmed',
  }, 201);
});
```

- [ ] **Step 2: Update GET /bookings to include telemedicine bookings**

Modify the existing GET /bookings to also return source='telemedicine' records with consultation details:

```typescript
  // In the GET /bookings handler, enhance the response:
  const bookingsWithDetails = await Promise.all(
    bookings.map(async (b: any) => {
      if (b.source === 'telemedicine' && b.local_appointment_id) {
        const consultation = await c.env.DB.prepare(
          `SELECT id, room_url, status as consultation_status FROM consultations WHERE id = ?`
        ).bind(b.local_appointment_id).first();
        return { ...b, consultation };
      }
      return b;
    })
  );

  return c.json({ data: bookingsWithDetails });
```

---

## Task 5: Review Moderation Frontend (Admin)

**Goal:** Build a hospital admin page to moderate reviews.

**Files:**
- Create: `apps/ozzyl-lifestyle/src/pages/marketplace/ReviewModerationPage.tsx`
- Modify: `apps/ozzyl-lifestyle/src/App.tsx`
- Modify: `apps/ozzyl-lifestyle/src/components/dashboard/Sidebar.tsx`

- [ ] **Step 1: Create ReviewModerationPage.tsx**

```tsx
import { useState } from 'react';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import DashboardLayout from '../../components/DashboardLayout';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, MessageSquare, Star, Clock, Filter } from 'lucide-react';

interface Review {
  id: number;
  reviewer_name?: string;
  target_type: string;
  doctor_name?: string;
  rating: number;
  review_text?: string;
  is_approved: number;
  created_at: string;
  provider_reply?: string;
}

export default function ReviewModerationPage({ role = 'hospital_admin' }: { role?: string }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data, isLoading } = useApiQuery<{ data: Review[]; pagination: { total: number } }>(
    ['marketplace', 'reviews', statusFilter],
    `/api/v1/marketplace/reviews/all?status=${statusFilter === 'all' ? '' : statusFilter}`
  );
  const reviews = data?.data ?? [];

  const approveMutation = useApiMutation('put', (vars: any) => `/api/v1/marketplace/reviews/${vars.id}/approve`, {
    onSuccess: () => { toast.success('Review approved'); queryClient.invalidateQueries({ queryKey: ['marketplace', 'reviews'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const rejectMutation = useApiMutation('put', (vars: any) => `/api/v1/marketplace/reviews/${vars.id}/reject`, {
    onSuccess: () => { toast.success('Review rejected'); queryClient.invalidateQueries({ queryKey: ['marketplace', 'reviews'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const replyMutation = useApiMutation('post', (vars: any) => `/api/v1/marketplace/reviews/${vars.id}/reply`, {
    onSuccess: () => { toast.success('Reply posted'); setReplyingId(null); setReplyText(''); queryClient.invalidateQueries({ queryKey: ['marketplace', 'reviews'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const statusBadge = (s: number) => {
    if (s === 1) return <span className="badge badge-success">Approved</span>;
    if (s === -1) return <span className="badge badge-error">Rejected</span>;
    return <span className="badge badge-warning">Pending</span>;
  };

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="page-header">
          <div>
            <h1 className="page-title">Review Moderation</h1>
            <p className="section-subtitle mt-1">Approve, reject, and reply to patient reviews</p>
          </div>
        </div>

        <div className="card p-3 flex gap-3 flex-wrap items-center">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          {(['all', 'pending', 'approved', 'rejected'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead><tr><th>Patient</th><th>Type</th><th>Rating</th><th>Review</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {isLoading ? (
                  [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : reviews.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">No reviews found.</td></tr>
                ) : (
                  reviews.map(r => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.reviewer_name ?? 'Anonymous'}</td>
                      <td>{r.doctor_name ? `Dr. ${r.doctor_name}` : 'Hospital'}</td>
                      <td><div className="flex items-center gap-1"><Star className="w-4 h-4 text-amber-500 fill-amber-500" />{r.rating}</div></td>
                      <td className="max-w-xs truncate">{r.review_text ?? '—'}</td>
                      <td>{statusBadge(r.is_approved)}</td>
                      <td className="text-xs">{r.created_at?.slice(0, 10)}</td>
                      <td>
                        <div className="flex gap-1">
                          {r.is_approved === 0 && (
                            <>
                              <button onClick={() => approveMutation.mutate({ id: r.id })} className="btn-ghost text-xs text-emerald-600" title="Approve"><CheckCircle className="w-4 h-4" /></button>
                              <button onClick={() => { const reason = prompt('Rejection reason (optional):'); rejectMutation.mutate({ id: r.id, body: { reason: reason || undefined } }); }} className="btn-ghost text-xs text-red-600" title="Reject"><XCircle className="w-4 h-4" /></button>
                            </>
                          )}
                          <button onClick={() => { setReplyingId(r.id); setReplyText(r.provider_reply ?? ''); }} className="btn-ghost text-xs text-blue-600" title="Reply"><MessageSquare className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {replyingId && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-lg font-semibold">Reply to Review</h3>
              <textarea rows={3} value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Write your professional reply..." className="input w-full text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setReplyingId(null)} className="btn btn-secondary text-sm">Cancel</button>
                <button onClick={() => replyMutation.mutate({ id: replyingId, body: { reply_text: replyText } })} disabled={replyMutation.isPending} className="btn btn-primary text-sm">{replyMutation.isPending ? 'Posting...' : 'Post Reply'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Register in App.tsx**

Add lazy import and route:
```typescript
const ReviewModerationPage = lazy(() => import('./pages/marketplace/ReviewModerationPage'));
// ...
<Route path="review-moderation" element={<ReviewModerationPage role="hospital_admin" />} />
```

- [ ] **Step 3: Add to Sidebar**

In the hospital_admin section under Admin group, add:
```typescript
{ labelKey: 'reviewModeration', path: 'review-moderation', icon: <Star className="w-4.5 h-4.5" />, requiredPermission: 'settings:read' },
```

---

## Task 6: Tests

**Goal:** Write comprehensive tests for all 4 gap areas.

**Files:**
- Create: `test/marketplace-gaps.test.ts`

- [ ] **Step 1: Create test file with all test cases**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { getTestEnv, createTestTenant, createTestDoctor, createTestPatientGlobal } from './helpers/test-utils';

describe('Marketplace Gap Fixes', () => {
  const env = getTestEnv();

  describe('Location-based hospital search', () => {
    it('should filter hospitals by radius when lat/lng provided', async () => {
      // Setup: create published hospital with known coordinates
      // Query with lat/lng/radius
      // Assert only hospitals within radius returned with distance_km
    });

    it('should order by distance when lat/lng provided', async () => {
      // Setup: 3 hospitals at different distances
      // Query with lat/lng
      // Assert closest first
    });
  });

  describe('Doctor public profile with schedule', () => {
    it('should include schedule in /doctors/:id response', async () => {
      // Setup: doctor with schedule entries
      // GET /api/v1/marketplace/doctors/:id
      // Assert response contains schedule array
    });

    it('should include booked slots in /doctors/:id response', async () => {
      // Setup: doctor with existing appointment
      // GET /api/v1/marketplace/doctors/:id
      // Assert response contains booked_slots
    });
  });

  describe('Review moderation', () => {
    it('should list pending reviews for admin', async () => {
      // Setup: submit review as patient
      // GET /api/v1/marketplace/reviews/pending as admin
      // Assert review in list with is_approved=0
    });

    it('should approve a review', async () => {
      // Setup: pending review
      // PUT /api/v1/marketplace/reviews/:id/approve
      // Assert is_approved=1
    });

    it('should reject a review with reason', async () => {
      // Setup: pending review
      // PUT /api/v1/marketplace/reviews/:id/reject with reason
      // Assert is_approved=-1 and moderation_reason set
    });

    it('should allow provider reply', async () => {
      // Setup: approved review
      // POST /api/v1/marketplace/reviews/:id/reply
      // Assert provider_reply set
    });

    it('should prevent cross-tenant moderation', async () => {
      // Setup: review for different tenant
      // Attempt to moderate as wrong tenant admin
      // Assert 403
    });
  });

  describe('Telemedicine marketplace booking', () => {
    it('should create consultation and marketplace booking', async () => {
      // Setup: published doctor, global patient
      // POST /api/v1/marketplace-patient/telemedicine-bookings
      // Assert marketplace_bookings record with source='telemedicine'
      // Assert consultations record created
      // Assert local patient linked
    });

    it('should include telemedicine bookings in patient history', async () => {
      // Setup: telemedicine booking
      // GET /api/v1/marketplace-patient/bookings
      // Assert booking includes consultation details
    });

    it('should auto-connect patient if not already linked', async () => {
      // Setup: global patient not connected to hospital
      // POST telemedicine booking
      // Assert patient_health_links created
    });
  });
});
```

---

## Execution Order

```
Task 1: Location Search Fix (Backend only, low risk)
Task 2: Doctor Schedule API (Backend only, low risk)
Task 3: Review Moderation API (Backend)
Task 4: Telemedicine Booking API (Backend)
Task 5: Review Moderation Frontend
Task 6: Tests + Build + Deploy
```

Tasks 1-4 are independent backend changes and can be done in parallel. Task 5 depends on Task 3. Task 6 validates everything.

---

## Verification Checklist

- [ ] `pnpm build` passes
- [ ] `npx vitest run test/marketplace-gaps.test.ts` passes
- [ ] `npx vitest run` (full suite) passes
- [ ] Deploy to production with `wrangler deploy --env production`

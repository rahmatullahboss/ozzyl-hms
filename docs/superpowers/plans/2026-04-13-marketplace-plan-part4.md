# Hospital Discovery & Doctor Marketplace — Implementation Plan (Part 4 of 4)

> Continues from Part 3. Frontend pages and route mounting.

---

## Task 11: Frontend — Shared Marketplace Components

**Files:**
- Create: `web/src/components/marketplace/StarRating.tsx`
- Create: `web/src/components/marketplace/HospitalCard.tsx`
- Create: `web/src/components/marketplace/DoctorCard.tsx`
- Create: `web/src/components/marketplace/SearchFilters.tsx`

- [ ] **Step 1: Create StarRating component**

Create `web/src/components/marketplace/StarRating.tsx`:

```tsx
interface StarRatingProps {
  rating: number;
  reviewCount?: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function StarRating({ rating, reviewCount, size = 'md' }: StarRatingProps) {
  const sizeClass = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-lg' : 'text-sm';
  const stars = Math.round(rating * 2) / 2; // Round to nearest 0.5

  return (
    <div className={`flex items-center gap-1 ${sizeClass}`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={star <= stars ? 'text-yellow-400' : star - 0.5 <= stars ? 'text-yellow-300' : 'text-gray-300'}
        >
          ★
        </span>
      ))}
      <span className="text-gray-600 ml-1">
        {rating > 0 ? rating.toFixed(1) : '—'}
      </span>
      {reviewCount !== undefined && (
        <span className="text-gray-400">({reviewCount})</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create HospitalCard component**

Create `web/src/components/marketplace/HospitalCard.tsx`:

```tsx
import { Link } from 'react-router';
import StarRating from './StarRating';

interface Hospital {
  id: string;
  name: string;
  tenant_type: string;
  public_description: string | null;
  specialties: string | null;
  public_photos: string | null;
  avg_rating: number;
  review_count: number;
}

export default function HospitalCard({ hospital }: { hospital: Hospital }) {
  const specialties: string[] = hospital.specialties ? JSON.parse(hospital.specialties) : [];

  return (
    <Link
      to={`/marketplace/hospitals/${hospital.id}`}
      className="block bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 bg-blue-50 rounded-lg flex items-center justify-center text-2xl shrink-0">
          {hospital.tenant_type === 'chamber' ? '🩺' : '🏥'}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{hospital.name}</h3>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">
              {hospital.tenant_type}
            </span>
          </div>
          <StarRating rating={hospital.avg_rating} reviewCount={hospital.review_count} size="sm" />
          {specialties.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {specialties.slice(0, 3).map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full capitalize">
                  {s}
                </span>
              ))}
              {specialties.length > 3 && (
                <span className="text-xs text-gray-400">+{specialties.length - 3} more</span>
              )}
            </div>
          )}
        </div>
      </div>
      {hospital.public_description && (
        <p className="text-sm text-gray-500 mt-2 line-clamp-2">{hospital.public_description}</p>
      )}
    </Link>
  );
}
```

- [ ] **Step 3: Create DoctorCard component**

Create `web/src/components/marketplace/DoctorCard.tsx`:

```tsx
import { Link } from 'react-router';
import StarRating from './StarRating';

interface Doctor {
  id: number;
  name: string;
  specialty: string;
  hospital_name: string;
  tenant_type: string;
  consultation_fee: number;
  public_bio: string | null;
  profile_photo_key: string | null;
  avg_rating: number;
  review_count: number;
}

export default function DoctorCard({ doctor }: { doctor: Doctor }) {
  const feeDisplay = doctor.consultation_fee
    ? `৳${(doctor.consultation_fee / 100).toLocaleString()}`
    : 'Fee N/A';

  return (
    <Link
      to={`/marketplace/doctors/${doctor.id}`}
      className="block bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center text-xl shrink-0">
          👨‍⚕️
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{doctor.name}</h3>
          <p className="text-sm text-blue-600 capitalize">{doctor.specialty}</p>
          <p className="text-xs text-gray-500">
            {doctor.tenant_type === 'chamber' ? 'Independent Practice' : doctor.hospital_name}
          </p>
          <StarRating rating={doctor.avg_rating} reviewCount={doctor.review_count} size="sm" />
        </div>
        <div className="text-right shrink-0">
          <span className="text-sm font-semibold text-green-700">{feeDisplay}</span>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Create SearchFilters component**

Create `web/src/components/marketplace/SearchFilters.tsx`:

```tsx
import { useState } from 'react';

interface FilterProps {
  type: 'hospitals' | 'doctors';
  onFilter: (params: Record<string, string>) => void;
}

const SPECIALTIES = [
  'cardiology', 'dermatology', 'ent', 'gastroenterology', 'general medicine',
  'general surgery', 'gynecology', 'neurology', 'oncology', 'ophthalmology',
  'orthopedics', 'pediatrics', 'psychiatry', 'pulmonology', 'urology',
];

const LANGUAGES = ['english', 'bengali', 'hindi', 'arabic', 'urdu'];

export default function SearchFilters({ type, onFilter }: FilterProps) {
  const [specialty, setSpecialty] = useState('');
  const [language, setLanguage] = useState('');
  const [ratingMin, setRatingMin] = useState('');
  const [feeMax, setFeeMax] = useState('');
  const [tenantType, setTenantType] = useState('');

  const applyFilters = () => {
    const params: Record<string, string> = {};
    if (specialty) params.specialty = specialty;
    if (language) params.language = language;
    if (ratingMin) params.rating_min = ratingMin;
    if (feeMax) params.fee_max = String(Number(feeMax) * 100); // Convert taka to paisa
    if (tenantType) params.type = tenantType;
    onFilter(params);
  };

  const clearFilters = () => {
    setSpecialty('');
    setLanguage('');
    setRatingMin('');
    setFeeMax('');
    setTenantType('');
    onFilter({});
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="font-semibold text-gray-900 text-sm">Filters</h3>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Specialty</label>
        <select
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className="w-full rounded-lg border-gray-300 text-sm"
        >
          <option value="">All Specialties</option>
          {SPECIALTIES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
      </div>

      {type === 'doctors' && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border-gray-300 text-sm"
            >
              <option value="">All Languages</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l} className="capitalize">{l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Max Fee (৳)</label>
            <input
              type="number"
              value={feeMax}
              onChange={(e) => setFeeMax(e.target.value)}
              placeholder="e.g. 2000"
              className="w-full rounded-lg border-gray-300 text-sm"
            />
          </div>
        </>
      )}

      {type === 'hospitals' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select
            value={tenantType}
            onChange={(e) => setTenantType(e.target.value)}
            className="w-full rounded-lg border-gray-300 text-sm"
          >
            <option value="">All</option>
            <option value="hospital">Hospital</option>
            <option value="chamber">Doctor Chamber</option>
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">Min Rating</label>
        <select
          value={ratingMin}
          onChange={(e) => setRatingMin(e.target.value)}
          className="w-full rounded-lg border-gray-300 text-sm"
        >
          <option value="">Any</option>
          <option value="4">4+ ★</option>
          <option value="3">3+ ★</option>
          <option value="2">2+ ★</option>
        </select>
      </div>

      <div className="flex gap-2">
        <button
          onClick={applyFilters}
          className="flex-1 bg-blue-600 text-white text-sm rounded-lg py-2 hover:bg-blue-700"
        >
          Apply
        </button>
        <button
          onClick={clearFilters}
          className="px-3 text-gray-500 text-sm rounded-lg py-2 hover:bg-gray-100"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/marketplace/
git commit -m "feat(marketplace): add shared marketplace UI components (StarRating, HospitalCard, DoctorCard, SearchFilters)"
```

---

## Task 12: Frontend — Marketplace Landing Page

**Files:**
- Create: `web/src/pages/MarketplaceLanding.tsx`

- [ ] **Step 1: Create marketplace landing page**

Create `web/src/pages/MarketplaceLanding.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import HospitalCard from '../components/marketplace/HospitalCard';
import DoctorCard from '../components/marketplace/DoctorCard';

const API = import.meta.env.VITE_API_URL || '';

const QUICK_SPECIALTIES = [
  { label: 'Cardiology', icon: '❤️' },
  { label: 'Dermatology', icon: '🧴' },
  { label: 'Pediatrics', icon: '👶' },
  { label: 'Orthopedics', icon: '🦴' },
  { label: 'Neurology', icon: '🧠' },
  { label: 'Gynecology', icon: '🩺' },
  { label: 'ENT', icon: '👂' },
  { label: 'Ophthalmology', icon: '👁️' },
];

export default function MarketplaceLanding() {
  const [searchQuery, setSearchQuery] = useState('');
  const [topHospitals, setTopHospitals] = useState<any[]>([]);
  const [topDoctors, setTopDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchFeatured = async () => {
      try {
        const [hospRes, docRes] = await Promise.all([
          fetch(`${API}/api/v1/marketplace/hospitals?limit=4`),
          fetch(`${API}/api/v1/marketplace/doctors?limit=4`),
        ]);
        if (hospRes.ok) {
          const data = await hospRes.json();
          setTopHospitals(data.hospitals || []);
        }
        if (docRes.ok) {
          const data = await docRes.json();
          setTopDoctors(data.doctors || []);
        }
      } catch {
        // Silently fail — landing page is best-effort
      } finally {
        setLoading(false);
      }
    };
    fetchFeatured();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/marketplace/doctors?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-4 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Find Hospitals & Doctors Near You</h1>
          <p className="text-blue-100 mb-8">Search, connect, and book appointments with trusted healthcare providers</p>

          <form onSubmit={handleSearch} className="flex max-w-xl mx-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search doctors, specialties, hospitals..."
              className="flex-1 px-4 py-3 rounded-l-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-green-500 hover:bg-green-600 rounded-r-xl font-semibold transition-colors"
            >
              Search
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 space-y-12">
        {/* Quick Specialties */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Browse by Specialty</h2>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {QUICK_SPECIALTIES.map((s) => (
              <Link
                key={s.label}
                to={`/marketplace/doctors?specialty=${s.label.toLowerCase()}`}
                className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow transition-all text-center"
              >
                <span className="text-2xl">{s.icon}</span>
                <span className="text-xs text-gray-700">{s.label}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Top Hospitals */}
        {topHospitals.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Top Hospitals</h2>
              <Link to="/marketplace/hospitals" className="text-sm text-blue-600 hover:underline">View all</Link>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {topHospitals.map((h: any) => (
                <HospitalCard key={h.id} hospital={h} />
              ))}
            </div>
          </section>
        )}

        {/* Top Doctors */}
        {topDoctors.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Top Doctors</h2>
              <Link to="/marketplace/doctors" className="text-sm text-blue-600 hover:underline">View all</Link>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {topDoctors.map((d: any) => (
                <DoctorCard key={d.id} doctor={d} />
              ))}
            </div>
          </section>
        )}

        {/* CTA for Doctors */}
        <section className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Are you a doctor?</h2>
          <p className="text-sm text-gray-600 mb-4">Register your chamber and start receiving patients online</p>
          <Link
            to="/doctor/register"
            className="inline-block bg-green-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-green-700 transition-colors"
          >
            Register Your Chamber
          </Link>
        </section>

        {loading && (
          <div className="text-center text-gray-400 py-8">Loading featured providers...</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/MarketplaceLanding.tsx
git commit -m "feat(marketplace): add marketplace landing page with search, specialties, featured providers"
```

---

## Task 13: Frontend — Mount Routes in App.tsx

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add lazy imports for marketplace pages**

At the top of `web/src/App.tsx`, after existing imports, add:

```typescript
import MarketplaceLanding from './pages/MarketplaceLanding';
```

Note: Hospital directory, doctor directory, doctor profile, hospital profile, doctor register, and doctor login pages will be created as follow-up tasks. For now we mount the landing page and add placeholder routes.

- [ ] **Step 2: Add marketplace routes**

In the `<Routes>` block of `App.tsx`, before the catch-all route, add:

```tsx
{/* Marketplace (public) */}
<Route path="/marketplace" element={<MarketplaceLanding />} />
<Route path="/marketplace/hospitals" element={<div className="p-8 text-center text-gray-500">Hospital Directory — Coming Soon</div>} />
<Route path="/marketplace/hospitals/:id" element={<div className="p-8 text-center text-gray-500">Hospital Profile — Coming Soon</div>} />
<Route path="/marketplace/doctors" element={<div className="p-8 text-center text-gray-500">Doctor Directory — Coming Soon</div>} />
<Route path="/marketplace/doctors/:id" element={<div className="p-8 text-center text-gray-500">Doctor Profile — Coming Soon</div>} />
<Route path="/doctor/register" element={<div className="p-8 text-center text-gray-500">Doctor Registration — Coming Soon</div>} />
<Route path="/doctor/login" element={<div className="p-8 text-center text-gray-500">Doctor Login — Coming Soon</div>} />
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms/web && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(marketplace): mount marketplace routes in frontend app"
```

---

## Task 14: Frontend — Remaining Pages (Hospital Directory, Doctor Directory, Profiles)

These are follow-up implementation tasks for the remaining frontend pages. Each page follows the same pattern as MarketplaceLanding but with search, filters, and detail views.

**Pages to build (in order):**

- [ ] **Step 1: HospitalDirectory page** — Search/filter hospitals, grid of HospitalCard components, pagination
- [ ] **Step 2: HospitalProfile page** — Hospital details, published doctors list, reviews section, "Connect" button
- [ ] **Step 3: DoctorDirectory page** — Search/filter doctors, grid of DoctorCard components, pagination
- [ ] **Step 4: DoctorProfile page** — Doctor details, availability calendar, booking flow, reviews section
- [ ] **Step 5: DoctorRegister page** — Multi-step registration form (personal → professional → chamber → schedule)
- [ ] **Step 6: DoctorLogin page** — Email/phone + password login form
- [ ] **Step 7: PatientFindCareTab** — New "Find Care" tab in patient dashboard (embedded marketplace)
- [ ] **Step 8: Chamber sidebar layout** — Update DashboardLayout.tsx with primary/secondary module split for `tenant_type === 'chamber'`

Each page will replace the placeholder routes added in Task 13. These follow the same React component patterns used throughout the project (functional components, Tailwind CSS, fetch API calls, react-router navigation).

- [ ] **Step 9: Commit all remaining pages**

```bash
git add web/src/pages/ web/src/components/
git commit -m "feat(marketplace): add all marketplace frontend pages (directories, profiles, doctor auth, find care tab)"
```

---

## Task 15: Final Verification

- [ ] **Step 1: Run all tests**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts test/marketplace-booking.test.ts test/marketplace-reviews.test.ts test/doctor-auth.test.ts`

Expected: ALL PASS

- [ ] **Step 2: TypeScript check**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Frontend build**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms/web && npm run build`

Expected: Build succeeds.

- [ ] **Step 4: Apply all migrations to production**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx wrangler d1 migrations apply hms-super-admin-production --remote`

Expected: Migrations 0118–0123 applied.

- [ ] **Step 5: Deploy**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx wrangler deploy`

Expected: Worker deployed successfully.

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Tenant/doctor marketplace columns | 2 migrations, 1 test |
| 2 | New tables (bookings, reviews, doctor_auth) | 4 migrations |
| 3 | Zod validation schemas | 1 schema file, extend test |
| 4 | Marketplace helpers | 1 lib file, extend test |
| 5 | Public marketplace routes | 1 route file |
| 6 | Patient marketplace routes | 1 route file, 1 test |
| 7 | Hospital admin marketplace routes | 1 route file |
| 8 | Doctor auth routes | 1 route file, 1 test |
| 9 | Mount all routes in index.ts | Modify 1 file |
| 10 | Integration tests | 1 test file |
| 11 | Shared marketplace components | 4 component files |
| 12 | Marketplace landing page | 1 page file |
| 13 | Mount frontend routes | Modify 1 file |
| 14 | Remaining frontend pages | 8 page/component files |
| 15 | Final verification & deploy | — |

**Totals: 6 migrations, 5 backend files, 1 schema, 1 helper, 12+ frontend files, 4 test files**

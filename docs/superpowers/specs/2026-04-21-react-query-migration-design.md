# React Query Migration — Design Spec

**Date:** 2026-04-21
**Scope:** Foundation infrastructure + 5 key page conversions

## Problem

174 pages use manual `useState + useEffect + axios` for data fetching. This causes:
- No caching — page navigations always re-fetch
- Duplicated loading/error state boilerplate (~6 lines per page)
- No background refetching, deduplication, or optimistic updates
- Manual `authHeaders()` calls in many components despite `axiosSetup.ts` interceptor

## Existing Infrastructure (already built)

| Asset | Status |
|-------|--------|
| `@tanstack/react-query` v5 | Installed in package.json |
| `QueryClientProvider` in `main.tsx` | Configured (staleTime: 5min, retry: 1) |
| `axiosSetup.ts` global interceptor | Adds Bearer token + tenant slug to all axios calls |
| `apiClient.ts` (`api.get/post/put/patch/delete`) | Clean fetch wrapper with auth — used by 12 files |
| 3 files using `useQuery/useMutation` | InsuranceBillingPage, InsuranceClaims, VitalsTrend |

## Design

### 1. Query Key Factory (`web/src/lib/queryKeys.ts`)

Centralized, type-safe query keys following TanStack's `queryOptions` pattern:

```ts
export const queryKeys = {
  doctors: {
    all: ['doctors'] as const,
    dashboard: () => ['doctors', 'dashboard'] as const,
    detail: (id: number) => ['doctors', 'detail', id] as const,
  },
  appointments: {
    all: ['appointments'] as const,
    list: (filters: Record<string, unknown>) => ['appointments', 'list', filters] as const,
    detail: (id: number) => ['appointments', 'detail', id] as const,
  },
  billing: {
    all: ['billing'] as const,
    list: (filters: Record<string, unknown>) => ['billing', 'list', filters] as const,
    dues: () => ['billing', 'dues'] as const,
    kpi: () => ['billing', 'kpi'] as const,
  },
  patients: {
    all: ['patients'] as const,
    list: (filters: Record<string, unknown>) => ['patients', 'list', filters] as const,
    detail: (id: number) => ['patients', 'detail', id] as const,
  },
  laboratory: {
    all: ['laboratory'] as const,
    orders: (filters: Record<string, unknown>) => ['laboratory', 'orders', filters] as const,
    results: (orderId: number) => ['laboratory', 'results', orderId] as const,
  },
};
```

Why a factory, not inline strings: invalidation. `queryClient.invalidateQueries({ queryKey: queryKeys.billing.all })` clears all billing caches. Typo-free, autocomplete-friendly.

### 2. Reusable Query Hooks (`web/src/hooks/useApiQuery.ts`)

Thin wrappers around `useQuery` and `useMutation` that use the existing `api` client from `apiClient.ts`:

```ts
// useApiQuery — for GET requests
function useApiQuery<T>(queryKey, path, options?)
  → calls api.get(path), returns useQuery result

// useApiMutation — for POST/PUT/DELETE
function useApiMutation<T, V>(path, method, options?)
  → calls api[method](path, variables), returns useMutation result
```

These hooks:
- Use `apiClient.ts` (not axios) — auth headers already handled
- Accept standard React Query options (staleTime, enabled, onSuccess, etc.)
- Provide typed responses via generics

### 3. API Client Usage Decision

**Use `apiClient.ts` (fetch-based), not raw axios.**

Rationale:
- `apiClient.ts` already handles auth headers, tenant slug, JSON encoding, and typed errors
- `axiosSetup.ts` interceptor is a global side-effect — works but couples to axios import
- React Query's `queryFn` just needs a function that returns a promise — `api.get` fits perfectly
- Fewer dependencies (no axios import needed in each page)

Pages will migrate from:
```ts
import axios from 'axios';
// manual authHeaders()
axios.get('/api/...', { headers: authHeaders() })
```

To:
```ts
import { useApiQuery } from '../hooks/useApiQuery';
const { data, isLoading } = useApiQuery<DashData>(
  queryKeys.doctors.dashboard(),
  '/api/doctors/dashboard'
);
```

### 4. Pages to Convert

| Page | Why chosen | Complexity |
|------|-----------|------------|
| `DoctorDashboard` | Most-used page, single GET + status mutation | Medium |
| `BillingDashboard` | Pagination, filters, multiple tabs, CRUD | High |
| `PatientList` | Search, pagination, list + detail navigation | Medium |
| `LaboratoryDashboard` | Multiple data sources, status updates | Medium |
| `AppointmentScheduler` | Filters, date-based queries, mutations | High |

### 5. Conversion Pattern

Each page conversion follows the same steps:
1. Replace `import axios` with `import { useApiQuery, useApiMutation }` + query keys
2. Delete `const [loading, setLoading] = useState(true)` and `const [data, setData] = useState(null)`
3. Replace `useEffect(() => { axios.get... })` with `useApiQuery()`
4. Replace manual PUT/POST calls with `useApiMutation()` + `invalidateQueries`
5. Replace `if (loading)` with `if (isLoading)` from query result
6. Remove manual `authHeaders()` calls

### 6. QueryClient Config (no changes needed)

Current config in `main.tsx` is already good:
```ts
staleTime: 5 * 60 * 1000,  // 5 min — appropriate for HMS
retry: 1,                    // don't hammer failed endpoints
```

## Out of Scope

- Skeleton loading UI (separate task)
- Virtualization for long lists (separate task)
- Route-based code splitting (separate task)
- Offline/IndexedDB cache persistence (separate task)
- Converting all 174 pages (incremental after foundation)

## Files Created/Modified

| File | Action |
|------|--------|
| `web/src/lib/queryKeys.ts` | **Create** — query key factory |
| `web/src/hooks/useApiQuery.ts` | **Create** — reusable query/mutation hooks |
| `web/src/pages/DoctorDashboard.tsx` | **Modify** — convert to React Query |
| `web/src/pages/BillingDashboard.tsx` | **Modify** — convert to React Query |
| `web/src/pages/PatientList.tsx` | **Modify** — convert to React Query |
| `web/src/pages/LaboratoryDashboard.tsx` | **Modify** — convert to React Query |
| `web/src/pages/AppointmentScheduler.tsx` | **Modify** — convert to React Query |

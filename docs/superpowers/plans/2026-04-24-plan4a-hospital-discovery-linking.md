# Plan 4A: Hospital Discovery & Linking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Hospital tab — nearby hospital search, hospital profiles, and linking a hospital account

**Architecture:** Hospital data from public API endpoints (no auth required for discovery). Linking requires auth. Cache hospitals in CacheDatabase for offline browsing.

**Tech Stack:** flutter_bloc, geolocator ^13.0.0, cached_network_image, dio

**Depends on:** Plan 1 completed

---

### Task 1: Hospital models

**Files:**
- Create: `packages/ozzyl_core/lib/src/models/hospital_models.dart`
- Modify: `packages/ozzyl_core/lib/ozzyl_core.dart`

- [ ] **Step 1: Write Freezed models**

```dart
// packages/ozzyl_core/lib/src/models/hospital_models.dart
import 'package:freezed_annotation/freezed_annotation.dart';
part 'hospital_models.freezed.dart';
part 'hospital_models.g.dart';

@freezed
sealed class Hospital with _$Hospital {
  const factory Hospital({
    required String id,
    required String name,
    String? address,
    String? city,
    double? latitude,
    double? longitude,
    String? phone,
    String? email,
    String? imageUrl,
    @Default([]) List<String> specialties,
    double? rating,
    int? bedCount,
  }) = _Hospital;
  factory Hospital.fromJson(Map<String, dynamic> json) => _$HospitalFromJson(json);
}

@freezed
sealed class HospitalDetail with _$HospitalDetail {
  const factory HospitalDetail({
    required Hospital hospital,
    @Default([]) List<HospitalDepartment> departments,
    @Default([]) List<HospitalDoctor> doctors,
    String? about,
    String? website,
    @Default([]) List<String> photos,
  }) = _HospitalDetail;
  factory HospitalDetail.fromJson(Map<String, dynamic> json) => _$HospitalDetailFromJson(json);
}

@freezed
sealed class HospitalDepartment with _$HospitalDepartment {
  const factory HospitalDepartment({
    required String name,
    String? description,
    int? doctorCount,
  }) = _HospitalDepartment;
  factory HospitalDepartment.fromJson(Map<String, dynamic> json) => _$HospitalDepartmentFromJson(json);
}

@freezed
sealed class HospitalDoctor with _$HospitalDoctor {
  const factory HospitalDoctor({
    required String id,
    required String name,
    String? specialty,
    String? imageUrl,
    double? rating,
    bool? available,
  }) = _HospitalDoctor;
  factory HospitalDoctor.fromJson(Map<String, dynamic> json) => _$HospitalDoctorFromJson(json);
}
```

- [ ] **Step 2: Run code gen + export + commit**

```bash
cd packages/ozzyl_core && dart run build_runner build --delete-conflicting-outputs
```
Add `export 'src/models/hospital_models.dart';` to barrel.

```bash
git add packages/ozzyl_core/
git commit -m "feat(core): add Freezed hospital, department, doctor models"
```

---

### Task 2: Hospital remote datasource + repository

**Files:**
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/data/datasources/hospital_remote_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/data/datasources/hospital_cache_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/domain/repositories/hospital_repository.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/data/repositories/hospital_repository_impl.dart`

- [ ] **Step 1: Write remote datasource**

```dart
// data/datasources/hospital_remote_datasource.dart
import 'package:ozzyl_core/ozzyl_core.dart';

class HospitalRemoteDatasource {
  final ApiClient _apiClient;
  HospitalRemoteDatasource(this._apiClient);

  Future<List<Hospital>> getNearby({double? lat, double? lng, String? city, int limit = 20}) async {
    final response = await _apiClient.dio.get(
      ApiConstants.publicHospitals,
      queryParameters: {
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
        if (city != null) 'city': city,
        'limit': limit,
      },
    );
    final list = response.data['hospitals'] as List;
    return list.map((j) => Hospital.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<HospitalDetail> getDetail(String hospitalId) async {
    final response = await _apiClient.dio.get('${ApiConstants.publicHospitals}/$hospitalId');
    return HospitalDetail.fromJson(response.data);
  }

  Future<void> linkHospital(String hospitalId) async {
    await _apiClient.dio.post(ApiConstants.linkHospital, data: {'hospitalId': hospitalId});
  }

  Future<void> unlinkHospital(String hospitalId) async {
    await _apiClient.dio.delete('${ApiConstants.linkHospital}/$hospitalId');
  }
}
```

- [ ] **Step 2: Write cache datasource**

```dart
// data/datasources/hospital_cache_datasource.dart
import 'dart:convert';
import 'package:drift/drift.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/database/cache_database.dart';

class HospitalCacheDatasource {
  final CacheDatabase _db;
  HospitalCacheDatasource(this._db);

  Future<List<Hospital>> getCachedHospitals() async {
    final rows = await _db.select(_db.cachedHospitals).get();
    return rows.map((r) => Hospital.fromJson(jsonDecode(r.dataJson))).toList();
  }

  Future<void> cacheHospitals(List<Hospital> hospitals) async {
    await _db.delete(_db.cachedHospitals).go();
    final ttl = DateTime.now().add(AppConstants.cacheTtl);
    for (final h in hospitals) {
      await _db.into(_db.cachedHospitals).insert(CachedHospitalsCompanion.insert(
        remoteId: h.id,
        dataJson: jsonEncode(h.toJson()),
        expiresAt: ttl,
      ));
    }
  }
}
```

- [ ] **Step 3: Write repository**

```dart
// domain/repositories/hospital_repository.dart
import 'package:ozzyl_core/ozzyl_core.dart';

abstract class HospitalRepository {
  Future<List<Hospital>> getNearby({double? lat, double? lng, String? city});
  Future<HospitalDetail> getDetail(String hospitalId);
  Future<void> linkHospital(String hospitalId);
  Future<void> unlinkHospital(String hospitalId);
}
```

```dart
// data/repositories/hospital_repository_impl.dart
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/repositories/hospital_repository.dart';
import '../datasources/hospital_remote_datasource.dart';
import '../datasources/hospital_cache_datasource.dart';

class HospitalRepositoryImpl implements HospitalRepository {
  final HospitalRemoteDatasource _remote;
  final HospitalCacheDatasource _cache;
  final ConnectivityService _connectivity;

  HospitalRepositoryImpl(this._remote, this._cache, this._connectivity);

  @override
  Future<List<Hospital>> getNearby({double? lat, double? lng, String? city}) async {
    if (await _connectivity.isOnline) {
      try {
        final hospitals = await _remote.getNearby(lat: lat, lng: lng, city: city);
        await _cache.cacheHospitals(hospitals);
        return hospitals;
      } catch (_) {
        return _cache.getCachedHospitals();
      }
    }
    return _cache.getCachedHospitals();
  }

  @override
  Future<HospitalDetail> getDetail(String hospitalId) => _remote.getDetail(hospitalId);
  @override
  Future<void> linkHospital(String hospitalId) => _remote.linkHospital(hospitalId);
  @override
  Future<void> unlinkHospital(String hospitalId) => _remote.unlinkHospital(hospitalId);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/ozzyl_health/lib/features/hospital_discovery/
git commit -m "feat(hospital): add remote + cache datasources, repository with offline fallback"
```

---

### Task 3: Hospital BLoC + Discovery UI

**Files:**
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/presentation/bloc/hospital_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/presentation/bloc/hospital_event.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/presentation/bloc/hospital_state.dart`
- Modify: `apps/ozzyl_health/lib/features/hospital_discovery/presentation/pages/hospital_page.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/presentation/pages/hospital_detail_page.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/presentation/widgets/hospital_card.dart`

- [ ] **Step 1: Write BLoC**

Events: loadNearby(lat, lng, city), loadDetail(id), link(id), unlink(id), search(query).
States: initial, loading, loaded(List<Hospital>, List<Hospital> myHospitals), detail(HospitalDetail), error.

- [ ] **Step 2: Write HospitalCard widget**

```dart
// presentation/widgets/hospital_card.dart
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class HospitalCard extends StatelessWidget {
  final Hospital hospital;
  final double? distanceKm;
  final VoidCallback onTap;
  const HospitalCard({super.key, required this.hospital, this.distanceKm, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: hospital.imageUrl != null
                    ? CachedNetworkImage(imageUrl: hospital.imageUrl!, width: 72, height: 72, fit: BoxFit.cover)
                    : Container(width: 72, height: 72, color: AppColors.primary.withOpacity(0.1),
                        child: const Icon(Icons.local_hospital, color: AppColors.primary, size: 32)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(hospital.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                    if (hospital.address != null)
                      Text(hospital.address!, style: Theme.of(context).textTheme.bodyMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 4),
                    Row(children: [
                      if (hospital.rating != null) ...[
                        const Icon(Icons.star, size: 16, color: AppColors.warning),
                        Text(' ${hospital.rating}', style: const TextStyle(fontWeight: FontWeight.w600)),
                        const SizedBox(width: 12),
                      ],
                      if (distanceKm != null) ...[
                        const Icon(Icons.location_on, size: 16, color: AppColors.textSecondary),
                        Text(' ${distanceKm!.toStringAsFixed(1)} km'),
                      ],
                    ]),
                    if (hospital.specialties.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(hospital.specialties.take(3).join(', '),
                          style: TextStyle(fontSize: 12, color: AppColors.primary), maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Replace HospitalPage placeholder**

The updated HospitalPage should have:
- Search bar at top
- "My Hospitals" section (if linked, shows linked hospitals with sub-nav to appointments/prescriptions/labs)
- "Nearby Hospitals" section (list of HospitalCards)
- Location permission request or manual city input
- Pull-to-refresh

- [ ] **Step 4: Write HospitalDetailPage**

Shows hospital profile: about, departments list, doctor list with "Book Appointment" buttons, photos, "Link as My Hospital" button.

- [ ] **Step 5: Add routes + commit**

```dart
GoRoute(path: '/hospital/detail/:id', builder: (context, state) =>
  HospitalDetailPage(hospitalId: state.pathParameters['id']!)),
```

```bash
git add apps/ozzyl_health/lib/features/hospital_discovery/
git commit -m "feat(hospital): add discovery page, hospital cards, detail page, linking"
```

---

### Task 4: Backend endpoints (new)

**Files:**
- Modify: `src/routes/public/hospitalSite.ts` (or create new route)
- Create: `src/routes/tenant/hospitalLink.ts`

- [ ] **Step 1: Add public hospitals endpoint**

```typescript
// GET /api/v1/public/hospitals
// Returns list of hospitals on the platform
// Query params: lat, lng, city, limit
// No auth required
```

- [ ] **Step 2: Add hospital detail endpoint**

```typescript
// GET /api/v1/public/hospitals/:id
// Returns hospital profile with departments, doctors, photos
// No auth required
```

- [ ] **Step 3: Add link/unlink endpoints**

```typescript
// POST /api/v1/patients/link-hospital { hospitalId }
// DELETE /api/v1/patients/link-hospital/:hospitalId
// Requires auth
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/
git commit -m "feat(api): add public hospital discovery + patient linking endpoints"
```

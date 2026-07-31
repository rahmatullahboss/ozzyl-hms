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
  Future<List<Hospital>> getNearby({
    double? lat,
    double? lng,
    String? city,
  }) async {
    if (await _connectivity.isOnline) {
      try {
        final hospitals =
            await _remote.getNearby(lat: lat, lng: lng, city: city);
        await _cache.cacheHospitals(hospitals);
        return hospitals;
      } catch (_) {
        return _cache.getCachedHospitals();
      }
    }
    return _cache.getCachedHospitals();
  }

  @override
  Future<HospitalDetail> getDetail(String hospitalId) =>
      _remote.getDetail(hospitalId);

  @override
  Future<void> linkHospital(String hospitalId) =>
      _remote.linkHospital(hospitalId);

  @override
  Future<void> unlinkHospital(String hospitalId) =>
      _remote.unlinkHospital(hospitalId);
}

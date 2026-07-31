import 'package:ozzyl_core/ozzyl_core.dart';

abstract class HospitalRepository {
  Future<List<Hospital>> getNearby({
    double? lat,
    double? lng,
    String? city,
  });
  Future<HospitalDetail> getDetail(String hospitalId);
  Future<void> linkHospital(String hospitalId);
  Future<void> unlinkHospital(String hospitalId);
}

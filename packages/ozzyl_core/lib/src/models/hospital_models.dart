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
  factory Hospital.fromJson(Map<String, dynamic> json) =>
      _$HospitalFromJson(json);
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
  factory HospitalDetail.fromJson(Map<String, dynamic> json) =>
      _$HospitalDetailFromJson(json);
}

@freezed
sealed class HospitalDepartment with _$HospitalDepartment {
  const factory HospitalDepartment({
    required String name,
    String? description,
    int? doctorCount,
  }) = _HospitalDepartment;
  factory HospitalDepartment.fromJson(Map<String, dynamic> json) =>
      _$HospitalDepartmentFromJson(json);
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
  factory HospitalDoctor.fromJson(Map<String, dynamic> json) =>
      _$HospitalDoctorFromJson(json);
}

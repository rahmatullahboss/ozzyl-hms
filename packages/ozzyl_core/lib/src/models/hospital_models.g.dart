// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'hospital_models.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_Hospital _$HospitalFromJson(Map<String, dynamic> json) => _Hospital(
      id: json['id'] as String,
      name: json['name'] as String,
      address: json['address'] as String?,
      city: json['city'] as String?,
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      imageUrl: json['imageUrl'] as String?,
      specialties: (json['specialties'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [],
      rating: (json['rating'] as num?)?.toDouble(),
      bedCount: (json['bedCount'] as num?)?.toInt(),
    );

Map<String, dynamic> _$HospitalToJson(_Hospital instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'address': instance.address,
      'city': instance.city,
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'phone': instance.phone,
      'email': instance.email,
      'imageUrl': instance.imageUrl,
      'specialties': instance.specialties,
      'rating': instance.rating,
      'bedCount': instance.bedCount,
    };

_HospitalDetail _$HospitalDetailFromJson(Map<String, dynamic> json) =>
    _HospitalDetail(
      hospital:
          Hospital.fromJson(json['hospital'] as Map<String, dynamic>),
      departments: (json['departments'] as List<dynamic>?)
              ?.map((e) =>
                  HospitalDepartment.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      doctors: (json['doctors'] as List<dynamic>?)
              ?.map(
                  (e) => HospitalDoctor.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      about: json['about'] as String?,
      website: json['website'] as String?,
      photos: (json['photos'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [],
    );

Map<String, dynamic> _$HospitalDetailToJson(_HospitalDetail instance) =>
    <String, dynamic>{
      'hospital': instance.hospital,
      'departments': instance.departments,
      'doctors': instance.doctors,
      'about': instance.about,
      'website': instance.website,
      'photos': instance.photos,
    };

_HospitalDepartment _$HospitalDepartmentFromJson(
        Map<String, dynamic> json) =>
    _HospitalDepartment(
      name: json['name'] as String,
      description: json['description'] as String?,
      doctorCount: (json['doctorCount'] as num?)?.toInt(),
    );

Map<String, dynamic> _$HospitalDepartmentToJson(
        _HospitalDepartment instance) =>
    <String, dynamic>{
      'name': instance.name,
      'description': instance.description,
      'doctorCount': instance.doctorCount,
    };

_HospitalDoctor _$HospitalDoctorFromJson(Map<String, dynamic> json) =>
    _HospitalDoctor(
      id: json['id'] as String,
      name: json['name'] as String,
      specialty: json['specialty'] as String?,
      imageUrl: json['imageUrl'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      available: json['available'] as bool?,
    );

Map<String, dynamic> _$HospitalDoctorToJson(_HospitalDoctor instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'specialty': instance.specialty,
      'imageUrl': instance.imageUrl,
      'rating': instance.rating,
      'available': instance.available,
    };

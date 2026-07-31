// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'hospital_models.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$Hospital {
  String get id;
  String get name;
  String? get address;
  String? get city;
  double? get latitude;
  double? get longitude;
  String? get phone;
  String? get email;
  String? get imageUrl;
  List<String> get specialties;
  double? get rating;
  int? get bedCount;

  /// Create a copy of Hospital
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $HospitalCopyWith<Hospital> get copyWith =>
      _$HospitalCopyWithImpl<Hospital>(this as Hospital, _$identity);

  /// Serializes this Hospital to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is Hospital &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.address, address) || other.address == address) &&
            (identical(other.city, city) || other.city == city) &&
            (identical(other.latitude, latitude) ||
                other.latitude == latitude) &&
            (identical(other.longitude, longitude) ||
                other.longitude == longitude) &&
            (identical(other.phone, phone) || other.phone == phone) &&
            (identical(other.email, email) || other.email == email) &&
            (identical(other.imageUrl, imageUrl) ||
                other.imageUrl == imageUrl) &&
            const DeepCollectionEquality()
                .equals(other.specialties, specialties) &&
            (identical(other.rating, rating) || other.rating == rating) &&
            (identical(other.bedCount, bedCount) ||
                other.bedCount == bedCount));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      id,
      name,
      address,
      city,
      latitude,
      longitude,
      phone,
      email,
      imageUrl,
      const DeepCollectionEquality().hash(specialties),
      rating,
      bedCount);

  @override
  String toString() {
    return 'Hospital(id: $id, name: $name, address: $address, city: $city, latitude: $latitude, longitude: $longitude, phone: $phone, email: $email, imageUrl: $imageUrl, specialties: $specialties, rating: $rating, bedCount: $bedCount)';
  }
}

/// @nodoc
abstract mixin class $HospitalCopyWith<$Res> {
  factory $HospitalCopyWith(Hospital value, $Res Function(Hospital) _then) =
      _$HospitalCopyWithImpl;
  @useResult
  $Res call(
      {String id,
      String name,
      String? address,
      String? city,
      double? latitude,
      double? longitude,
      String? phone,
      String? email,
      String? imageUrl,
      List<String> specialties,
      double? rating,
      int? bedCount});
}

/// @nodoc
class _$HospitalCopyWithImpl<$Res> implements $HospitalCopyWith<$Res> {
  _$HospitalCopyWithImpl(this._self, this._then);

  final Hospital _self;
  final $Res Function(Hospital) _then;

  /// Create a copy of Hospital
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? address = freezed,
    Object? city = freezed,
    Object? latitude = freezed,
    Object? longitude = freezed,
    Object? phone = freezed,
    Object? email = freezed,
    Object? imageUrl = freezed,
    Object? specialties = null,
    Object? rating = freezed,
    Object? bedCount = freezed,
  }) {
    return _then(_self.copyWith(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      address: freezed == address
          ? _self.address
          : address // ignore: cast_nullable_to_non_nullable
              as String?,
      city: freezed == city
          ? _self.city
          : city // ignore: cast_nullable_to_non_nullable
              as String?,
      latitude: freezed == latitude
          ? _self.latitude
          : latitude // ignore: cast_nullable_to_non_nullable
              as double?,
      longitude: freezed == longitude
          ? _self.longitude
          : longitude // ignore: cast_nullable_to_non_nullable
              as double?,
      phone: freezed == phone
          ? _self.phone
          : phone // ignore: cast_nullable_to_non_nullable
              as String?,
      email: freezed == email
          ? _self.email
          : email // ignore: cast_nullable_to_non_nullable
              as String?,
      imageUrl: freezed == imageUrl
          ? _self.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      specialties: null == specialties
          ? _self.specialties
          : specialties // ignore: cast_nullable_to_non_nullable
              as List<String>,
      rating: freezed == rating
          ? _self.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      bedCount: freezed == bedCount
          ? _self.bedCount
          : bedCount // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// Adds pattern-matching-related methods to [Hospital].
extension HospitalPatterns on Hospital {
  /// A variant of `map` that fallback to returning `orElse`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>(
    TResult Function(_Hospital value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _Hospital() when $default != null:
        return $default(_that);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// Callbacks receives the raw object, upcasted.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case final Subclass2 value:
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult map<TResult extends Object?>(
    TResult Function(_Hospital value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _Hospital():
        return $default(_that);
    }
  }

  /// A variant of `map` that fallback to returning `null`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>(
    TResult? Function(_Hospital value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _Hospital() when $default != null:
        return $default(_that);
      case _:
        return null;
    }
  }

  /// A variant of `when` that fallback to an `orElse` callback.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>(
    TResult Function(
            String id,
            String name,
            String? address,
            String? city,
            double? latitude,
            double? longitude,
            String? phone,
            String? email,
            String? imageUrl,
            List<String> specialties,
            double? rating,
            int? bedCount)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _Hospital() when $default != null:
        return $default(
            _that.id,
            _that.name,
            _that.address,
            _that.city,
            _that.latitude,
            _that.longitude,
            _that.phone,
            _that.email,
            _that.imageUrl,
            _that.specialties,
            _that.rating,
            _that.bedCount);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// As opposed to `map`, this offers destructuring.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case Subclass2(:final field2):
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult when<TResult extends Object?>(
    TResult Function(
            String id,
            String name,
            String? address,
            String? city,
            double? latitude,
            double? longitude,
            String? phone,
            String? email,
            String? imageUrl,
            List<String> specialties,
            double? rating,
            int? bedCount)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _Hospital():
        return $default(
            _that.id,
            _that.name,
            _that.address,
            _that.city,
            _that.latitude,
            _that.longitude,
            _that.phone,
            _that.email,
            _that.imageUrl,
            _that.specialties,
            _that.rating,
            _that.bedCount);
    }
  }

  /// A variant of `when` that fallback to returning `null`
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>(
    TResult? Function(
            String id,
            String name,
            String? address,
            String? city,
            double? latitude,
            double? longitude,
            String? phone,
            String? email,
            String? imageUrl,
            List<String> specialties,
            double? rating,
            int? bedCount)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _Hospital() when $default != null:
        return $default(
            _that.id,
            _that.name,
            _that.address,
            _that.city,
            _that.latitude,
            _that.longitude,
            _that.phone,
            _that.email,
            _that.imageUrl,
            _that.specialties,
            _that.rating,
            _that.bedCount);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _Hospital implements Hospital {
  const _Hospital(
      {required this.id,
      required this.name,
      this.address,
      this.city,
      this.latitude,
      this.longitude,
      this.phone,
      this.email,
      this.imageUrl,
      final List<String> specialties = const [],
      this.rating,
      this.bedCount})
      : _specialties = specialties;
  factory _Hospital.fromJson(Map<String, dynamic> json) =>
      _$HospitalFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String? address;
  @override
  final String? city;
  @override
  final double? latitude;
  @override
  final double? longitude;
  @override
  final String? phone;
  @override
  final String? email;
  @override
  final String? imageUrl;
  final List<String> _specialties;
  @override
  @JsonKey()
  List<String> get specialties {
    if (_specialties is EqualUnmodifiableListView) return _specialties;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_specialties);
  }

  @override
  final double? rating;
  @override
  final int? bedCount;

  /// Create a copy of Hospital
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$HospitalCopyWith<_Hospital> get copyWith =>
      __$HospitalCopyWithImpl<_Hospital>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$HospitalToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _Hospital &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.address, address) || other.address == address) &&
            (identical(other.city, city) || other.city == city) &&
            (identical(other.latitude, latitude) ||
                other.latitude == latitude) &&
            (identical(other.longitude, longitude) ||
                other.longitude == longitude) &&
            (identical(other.phone, phone) || other.phone == phone) &&
            (identical(other.email, email) || other.email == email) &&
            (identical(other.imageUrl, imageUrl) ||
                other.imageUrl == imageUrl) &&
            const DeepCollectionEquality()
                .equals(other._specialties, _specialties) &&
            (identical(other.rating, rating) || other.rating == rating) &&
            (identical(other.bedCount, bedCount) ||
                other.bedCount == bedCount));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      id,
      name,
      address,
      city,
      latitude,
      longitude,
      phone,
      email,
      imageUrl,
      const DeepCollectionEquality().hash(_specialties),
      rating,
      bedCount);

  @override
  String toString() {
    return 'Hospital(id: $id, name: $name, address: $address, city: $city, latitude: $latitude, longitude: $longitude, phone: $phone, email: $email, imageUrl: $imageUrl, specialties: $specialties, rating: $rating, bedCount: $bedCount)';
  }
}

/// @nodoc
abstract mixin class _$HospitalCopyWith<$Res>
    implements $HospitalCopyWith<$Res> {
  factory _$HospitalCopyWith(
          _Hospital value, $Res Function(_Hospital) _then) =
      __$HospitalCopyWithImpl;
  @override
  @useResult
  $Res call(
      {String id,
      String name,
      String? address,
      String? city,
      double? latitude,
      double? longitude,
      String? phone,
      String? email,
      String? imageUrl,
      List<String> specialties,
      double? rating,
      int? bedCount});
}

/// @nodoc
class __$HospitalCopyWithImpl<$Res> implements _$HospitalCopyWith<$Res> {
  __$HospitalCopyWithImpl(this._self, this._then);

  final _Hospital _self;
  final $Res Function(_Hospital) _then;

  /// Create a copy of Hospital
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? address = freezed,
    Object? city = freezed,
    Object? latitude = freezed,
    Object? longitude = freezed,
    Object? phone = freezed,
    Object? email = freezed,
    Object? imageUrl = freezed,
    Object? specialties = null,
    Object? rating = freezed,
    Object? bedCount = freezed,
  }) {
    return _then(_Hospital(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      address: freezed == address
          ? _self.address
          : address // ignore: cast_nullable_to_non_nullable
              as String?,
      city: freezed == city
          ? _self.city
          : city // ignore: cast_nullable_to_non_nullable
              as String?,
      latitude: freezed == latitude
          ? _self.latitude
          : latitude // ignore: cast_nullable_to_non_nullable
              as double?,
      longitude: freezed == longitude
          ? _self.longitude
          : longitude // ignore: cast_nullable_to_non_nullable
              as double?,
      phone: freezed == phone
          ? _self.phone
          : phone // ignore: cast_nullable_to_non_nullable
              as String?,
      email: freezed == email
          ? _self.email
          : email // ignore: cast_nullable_to_non_nullable
              as String?,
      imageUrl: freezed == imageUrl
          ? _self.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      specialties: null == specialties
          ? _self._specialties
          : specialties // ignore: cast_nullable_to_non_nullable
              as List<String>,
      rating: freezed == rating
          ? _self.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      bedCount: freezed == bedCount
          ? _self.bedCount
          : bedCount // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// @nodoc
mixin _$HospitalDetail {
  Hospital get hospital;
  List<HospitalDepartment> get departments;
  List<HospitalDoctor> get doctors;
  String? get about;
  String? get website;
  List<String> get photos;

  /// Create a copy of HospitalDetail
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $HospitalDetailCopyWith<HospitalDetail> get copyWith =>
      _$HospitalDetailCopyWithImpl<HospitalDetail>(
          this as HospitalDetail, _$identity);

  /// Serializes this HospitalDetail to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is HospitalDetail &&
            (identical(other.hospital, hospital) ||
                other.hospital == hospital) &&
            const DeepCollectionEquality()
                .equals(other.departments, departments) &&
            const DeepCollectionEquality().equals(other.doctors, doctors) &&
            (identical(other.about, about) || other.about == about) &&
            (identical(other.website, website) || other.website == website) &&
            const DeepCollectionEquality().equals(other.photos, photos));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      hospital,
      const DeepCollectionEquality().hash(departments),
      const DeepCollectionEquality().hash(doctors),
      about,
      website,
      const DeepCollectionEquality().hash(photos));

  @override
  String toString() {
    return 'HospitalDetail(hospital: $hospital, departments: $departments, doctors: $doctors, about: $about, website: $website, photos: $photos)';
  }
}

/// @nodoc
abstract mixin class $HospitalDetailCopyWith<$Res> {
  factory $HospitalDetailCopyWith(
          HospitalDetail value, $Res Function(HospitalDetail) _then) =
      _$HospitalDetailCopyWithImpl;
  @useResult
  $Res call(
      {Hospital hospital,
      List<HospitalDepartment> departments,
      List<HospitalDoctor> doctors,
      String? about,
      String? website,
      List<String> photos});

  $HospitalCopyWith<$Res> get hospital;
}

/// @nodoc
class _$HospitalDetailCopyWithImpl<$Res>
    implements $HospitalDetailCopyWith<$Res> {
  _$HospitalDetailCopyWithImpl(this._self, this._then);

  final HospitalDetail _self;
  final $Res Function(HospitalDetail) _then;

  /// Create a copy of HospitalDetail
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? hospital = null,
    Object? departments = null,
    Object? doctors = null,
    Object? about = freezed,
    Object? website = freezed,
    Object? photos = null,
  }) {
    return _then(_self.copyWith(
      hospital: null == hospital
          ? _self.hospital
          : hospital // ignore: cast_nullable_to_non_nullable
              as Hospital,
      departments: null == departments
          ? _self.departments
          : departments // ignore: cast_nullable_to_non_nullable
              as List<HospitalDepartment>,
      doctors: null == doctors
          ? _self.doctors
          : doctors // ignore: cast_nullable_to_non_nullable
              as List<HospitalDoctor>,
      about: freezed == about
          ? _self.about
          : about // ignore: cast_nullable_to_non_nullable
              as String?,
      website: freezed == website
          ? _self.website
          : website // ignore: cast_nullable_to_non_nullable
              as String?,
      photos: null == photos
          ? _self.photos
          : photos // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }

  /// Create a copy of HospitalDetail
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $HospitalCopyWith<$Res> get hospital {
    return $HospitalCopyWith<$Res>(_self.hospital, (value) {
      return _then(_self.copyWith(hospital: value));
    });
  }
}

/// Adds pattern-matching-related methods to [HospitalDetail].
extension HospitalDetailPatterns on HospitalDetail {
  /// A variant of `map` that fallback to returning `orElse`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>(
    TResult Function(_HospitalDetail value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _HospitalDetail() when $default != null:
        return $default(_that);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// Callbacks receives the raw object, upcasted.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case final Subclass2 value:
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult map<TResult extends Object?>(
    TResult Function(_HospitalDetail value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDetail():
        return $default(_that);
    }
  }

  /// A variant of `map` that fallback to returning `null`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>(
    TResult? Function(_HospitalDetail value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDetail() when $default != null:
        return $default(_that);
      case _:
        return null;
    }
  }

  /// A variant of `when` that fallback to an `orElse` callback.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>(
    TResult Function(
            Hospital hospital,
            List<HospitalDepartment> departments,
            List<HospitalDoctor> doctors,
            String? about,
            String? website,
            List<String> photos)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _HospitalDetail() when $default != null:
        return $default(_that.hospital, _that.departments, _that.doctors,
            _that.about, _that.website, _that.photos);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// As opposed to `map`, this offers destructuring.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case Subclass2(:final field2):
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult when<TResult extends Object?>(
    TResult Function(
            Hospital hospital,
            List<HospitalDepartment> departments,
            List<HospitalDoctor> doctors,
            String? about,
            String? website,
            List<String> photos)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDetail():
        return $default(_that.hospital, _that.departments, _that.doctors,
            _that.about, _that.website, _that.photos);
    }
  }

  /// A variant of `when` that fallback to returning `null`
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>(
    TResult? Function(
            Hospital hospital,
            List<HospitalDepartment> departments,
            List<HospitalDoctor> doctors,
            String? about,
            String? website,
            List<String> photos)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDetail() when $default != null:
        return $default(_that.hospital, _that.departments, _that.doctors,
            _that.about, _that.website, _that.photos);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _HospitalDetail implements HospitalDetail {
  const _HospitalDetail(
      {required this.hospital,
      final List<HospitalDepartment> departments = const [],
      final List<HospitalDoctor> doctors = const [],
      this.about,
      this.website,
      final List<String> photos = const []})
      : _departments = departments,
        _doctors = doctors,
        _photos = photos;
  factory _HospitalDetail.fromJson(Map<String, dynamic> json) =>
      _$HospitalDetailFromJson(json);

  @override
  final Hospital hospital;
  final List<HospitalDepartment> _departments;
  @override
  @JsonKey()
  List<HospitalDepartment> get departments {
    if (_departments is EqualUnmodifiableListView) return _departments;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_departments);
  }

  final List<HospitalDoctor> _doctors;
  @override
  @JsonKey()
  List<HospitalDoctor> get doctors {
    if (_doctors is EqualUnmodifiableListView) return _doctors;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_doctors);
  }

  @override
  final String? about;
  @override
  final String? website;
  final List<String> _photos;
  @override
  @JsonKey()
  List<String> get photos {
    if (_photos is EqualUnmodifiableListView) return _photos;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_photos);
  }

  /// Create a copy of HospitalDetail
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$HospitalDetailCopyWith<_HospitalDetail> get copyWith =>
      __$HospitalDetailCopyWithImpl<_HospitalDetail>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$HospitalDetailToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _HospitalDetail &&
            (identical(other.hospital, hospital) ||
                other.hospital == hospital) &&
            const DeepCollectionEquality()
                .equals(other._departments, _departments) &&
            const DeepCollectionEquality().equals(other._doctors, _doctors) &&
            (identical(other.about, about) || other.about == about) &&
            (identical(other.website, website) || other.website == website) &&
            const DeepCollectionEquality().equals(other._photos, _photos));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      hospital,
      const DeepCollectionEquality().hash(_departments),
      const DeepCollectionEquality().hash(_doctors),
      about,
      website,
      const DeepCollectionEquality().hash(_photos));

  @override
  String toString() {
    return 'HospitalDetail(hospital: $hospital, departments: $departments, doctors: $doctors, about: $about, website: $website, photos: $photos)';
  }
}

/// @nodoc
abstract mixin class _$HospitalDetailCopyWith<$Res>
    implements $HospitalDetailCopyWith<$Res> {
  factory _$HospitalDetailCopyWith(
          _HospitalDetail value, $Res Function(_HospitalDetail) _then) =
      __$HospitalDetailCopyWithImpl;
  @override
  @useResult
  $Res call(
      {Hospital hospital,
      List<HospitalDepartment> departments,
      List<HospitalDoctor> doctors,
      String? about,
      String? website,
      List<String> photos});

  @override
  $HospitalCopyWith<$Res> get hospital;
}

/// @nodoc
class __$HospitalDetailCopyWithImpl<$Res>
    implements _$HospitalDetailCopyWith<$Res> {
  __$HospitalDetailCopyWithImpl(this._self, this._then);

  final _HospitalDetail _self;
  final $Res Function(_HospitalDetail) _then;

  /// Create a copy of HospitalDetail
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? hospital = null,
    Object? departments = null,
    Object? doctors = null,
    Object? about = freezed,
    Object? website = freezed,
    Object? photos = null,
  }) {
    return _then(_HospitalDetail(
      hospital: null == hospital
          ? _self.hospital
          : hospital // ignore: cast_nullable_to_non_nullable
              as Hospital,
      departments: null == departments
          ? _self._departments
          : departments // ignore: cast_nullable_to_non_nullable
              as List<HospitalDepartment>,
      doctors: null == doctors
          ? _self._doctors
          : doctors // ignore: cast_nullable_to_non_nullable
              as List<HospitalDoctor>,
      about: freezed == about
          ? _self.about
          : about // ignore: cast_nullable_to_non_nullable
              as String?,
      website: freezed == website
          ? _self.website
          : website // ignore: cast_nullable_to_non_nullable
              as String?,
      photos: null == photos
          ? _self._photos
          : photos // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }

  /// Create a copy of HospitalDetail
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $HospitalCopyWith<$Res> get hospital {
    return $HospitalCopyWith<$Res>(_self.hospital, (value) {
      return _then(_self.copyWith(hospital: value));
    });
  }
}

/// @nodoc
mixin _$HospitalDepartment {
  String get name;
  String? get description;
  int? get doctorCount;

  /// Create a copy of HospitalDepartment
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $HospitalDepartmentCopyWith<HospitalDepartment> get copyWith =>
      _$HospitalDepartmentCopyWithImpl<HospitalDepartment>(
          this as HospitalDepartment, _$identity);

  /// Serializes this HospitalDepartment to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is HospitalDepartment &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.doctorCount, doctorCount) ||
                other.doctorCount == doctorCount));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, name, description, doctorCount);

  @override
  String toString() {
    return 'HospitalDepartment(name: $name, description: $description, doctorCount: $doctorCount)';
  }
}

/// @nodoc
abstract mixin class $HospitalDepartmentCopyWith<$Res> {
  factory $HospitalDepartmentCopyWith(
          HospitalDepartment value, $Res Function(HospitalDepartment) _then) =
      _$HospitalDepartmentCopyWithImpl;
  @useResult
  $Res call({String name, String? description, int? doctorCount});
}

/// @nodoc
class _$HospitalDepartmentCopyWithImpl<$Res>
    implements $HospitalDepartmentCopyWith<$Res> {
  _$HospitalDepartmentCopyWithImpl(this._self, this._then);

  final HospitalDepartment _self;
  final $Res Function(HospitalDepartment) _then;

  /// Create a copy of HospitalDepartment
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? name = null,
    Object? description = freezed,
    Object? doctorCount = freezed,
  }) {
    return _then(_self.copyWith(
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      description: freezed == description
          ? _self.description
          : description // ignore: cast_nullable_to_non_nullable
              as String?,
      doctorCount: freezed == doctorCount
          ? _self.doctorCount
          : doctorCount // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// Adds pattern-matching-related methods to [HospitalDepartment].
extension HospitalDepartmentPatterns on HospitalDepartment {
  /// A variant of `map` that fallback to returning `orElse`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>(
    TResult Function(_HospitalDepartment value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _HospitalDepartment() when $default != null:
        return $default(_that);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// Callbacks receives the raw object, upcasted.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case final Subclass2 value:
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult map<TResult extends Object?>(
    TResult Function(_HospitalDepartment value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDepartment():
        return $default(_that);
    }
  }

  /// A variant of `map` that fallback to returning `null`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>(
    TResult? Function(_HospitalDepartment value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDepartment() when $default != null:
        return $default(_that);
      case _:
        return null;
    }
  }

  /// A variant of `when` that fallback to an `orElse` callback.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>(
    TResult Function(String name, String? description, int? doctorCount)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _HospitalDepartment() when $default != null:
        return $default(_that.name, _that.description, _that.doctorCount);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// As opposed to `map`, this offers destructuring.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case Subclass2(:final field2):
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult when<TResult extends Object?>(
    TResult Function(String name, String? description, int? doctorCount)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDepartment():
        return $default(_that.name, _that.description, _that.doctorCount);
    }
  }

  /// A variant of `when` that fallback to returning `null`
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>(
    TResult? Function(String name, String? description, int? doctorCount)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDepartment() when $default != null:
        return $default(_that.name, _that.description, _that.doctorCount);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _HospitalDepartment implements HospitalDepartment {
  const _HospitalDepartment(
      {required this.name, this.description, this.doctorCount});
  factory _HospitalDepartment.fromJson(Map<String, dynamic> json) =>
      _$HospitalDepartmentFromJson(json);

  @override
  final String name;
  @override
  final String? description;
  @override
  final int? doctorCount;

  /// Create a copy of HospitalDepartment
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$HospitalDepartmentCopyWith<_HospitalDepartment> get copyWith =>
      __$HospitalDepartmentCopyWithImpl<_HospitalDepartment>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$HospitalDepartmentToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _HospitalDepartment &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.doctorCount, doctorCount) ||
                other.doctorCount == doctorCount));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, name, description, doctorCount);

  @override
  String toString() {
    return 'HospitalDepartment(name: $name, description: $description, doctorCount: $doctorCount)';
  }
}

/// @nodoc
abstract mixin class _$HospitalDepartmentCopyWith<$Res>
    implements $HospitalDepartmentCopyWith<$Res> {
  factory _$HospitalDepartmentCopyWith(
          _HospitalDepartment value,
          $Res Function(_HospitalDepartment) _then) =
      __$HospitalDepartmentCopyWithImpl;
  @override
  @useResult
  $Res call({String name, String? description, int? doctorCount});
}

/// @nodoc
class __$HospitalDepartmentCopyWithImpl<$Res>
    implements _$HospitalDepartmentCopyWith<$Res> {
  __$HospitalDepartmentCopyWithImpl(this._self, this._then);

  final _HospitalDepartment _self;
  final $Res Function(_HospitalDepartment) _then;

  /// Create a copy of HospitalDepartment
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? name = null,
    Object? description = freezed,
    Object? doctorCount = freezed,
  }) {
    return _then(_HospitalDepartment(
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      description: freezed == description
          ? _self.description
          : description // ignore: cast_nullable_to_non_nullable
              as String?,
      doctorCount: freezed == doctorCount
          ? _self.doctorCount
          : doctorCount // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// @nodoc
mixin _$HospitalDoctor {
  String get id;
  String get name;
  String? get specialty;
  String? get imageUrl;
  double? get rating;
  bool? get available;

  /// Create a copy of HospitalDoctor
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $HospitalDoctorCopyWith<HospitalDoctor> get copyWith =>
      _$HospitalDoctorCopyWithImpl<HospitalDoctor>(
          this as HospitalDoctor, _$identity);

  /// Serializes this HospitalDoctor to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is HospitalDoctor &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.specialty, specialty) ||
                other.specialty == specialty) &&
            (identical(other.imageUrl, imageUrl) ||
                other.imageUrl == imageUrl) &&
            (identical(other.rating, rating) || other.rating == rating) &&
            (identical(other.available, available) ||
                other.available == available));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, id, name, specialty, imageUrl, rating, available);

  @override
  String toString() {
    return 'HospitalDoctor(id: $id, name: $name, specialty: $specialty, imageUrl: $imageUrl, rating: $rating, available: $available)';
  }
}

/// @nodoc
abstract mixin class $HospitalDoctorCopyWith<$Res> {
  factory $HospitalDoctorCopyWith(
          HospitalDoctor value, $Res Function(HospitalDoctor) _then) =
      _$HospitalDoctorCopyWithImpl;
  @useResult
  $Res call(
      {String id,
      String name,
      String? specialty,
      String? imageUrl,
      double? rating,
      bool? available});
}

/// @nodoc
class _$HospitalDoctorCopyWithImpl<$Res>
    implements $HospitalDoctorCopyWith<$Res> {
  _$HospitalDoctorCopyWithImpl(this._self, this._then);

  final HospitalDoctor _self;
  final $Res Function(HospitalDoctor) _then;

  /// Create a copy of HospitalDoctor
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? specialty = freezed,
    Object? imageUrl = freezed,
    Object? rating = freezed,
    Object? available = freezed,
  }) {
    return _then(_self.copyWith(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      specialty: freezed == specialty
          ? _self.specialty
          : specialty // ignore: cast_nullable_to_non_nullable
              as String?,
      imageUrl: freezed == imageUrl
          ? _self.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      rating: freezed == rating
          ? _self.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      available: freezed == available
          ? _self.available
          : available // ignore: cast_nullable_to_non_nullable
              as bool?,
    ));
  }
}

/// Adds pattern-matching-related methods to [HospitalDoctor].
extension HospitalDoctorPatterns on HospitalDoctor {
  /// A variant of `map` that fallback to returning `orElse`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>(
    TResult Function(_HospitalDoctor value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _HospitalDoctor() when $default != null:
        return $default(_that);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// Callbacks receives the raw object, upcasted.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case final Subclass2 value:
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult map<TResult extends Object?>(
    TResult Function(_HospitalDoctor value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDoctor():
        return $default(_that);
    }
  }

  /// A variant of `map` that fallback to returning `null`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>(
    TResult? Function(_HospitalDoctor value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDoctor() when $default != null:
        return $default(_that);
      case _:
        return null;
    }
  }

  /// A variant of `when` that fallback to an `orElse` callback.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>(
    TResult Function(String id, String name, String? specialty,
            String? imageUrl, double? rating, bool? available)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _HospitalDoctor() when $default != null:
        return $default(_that.id, _that.name, _that.specialty, _that.imageUrl,
            _that.rating, _that.available);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// As opposed to `map`, this offers destructuring.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case Subclass2(:final field2):
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult when<TResult extends Object?>(
    TResult Function(String id, String name, String? specialty,
            String? imageUrl, double? rating, bool? available)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDoctor():
        return $default(_that.id, _that.name, _that.specialty, _that.imageUrl,
            _that.rating, _that.available);
    }
  }

  /// A variant of `when` that fallback to returning `null`
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>(
    TResult? Function(String id, String name, String? specialty,
            String? imageUrl, double? rating, bool? available)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _HospitalDoctor() when $default != null:
        return $default(_that.id, _that.name, _that.specialty, _that.imageUrl,
            _that.rating, _that.available);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _HospitalDoctor implements HospitalDoctor {
  const _HospitalDoctor(
      {required this.id,
      required this.name,
      this.specialty,
      this.imageUrl,
      this.rating,
      this.available});
  factory _HospitalDoctor.fromJson(Map<String, dynamic> json) =>
      _$HospitalDoctorFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String? specialty;
  @override
  final String? imageUrl;
  @override
  final double? rating;
  @override
  final bool? available;

  /// Create a copy of HospitalDoctor
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$HospitalDoctorCopyWith<_HospitalDoctor> get copyWith =>
      __$HospitalDoctorCopyWithImpl<_HospitalDoctor>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$HospitalDoctorToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _HospitalDoctor &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.specialty, specialty) ||
                other.specialty == specialty) &&
            (identical(other.imageUrl, imageUrl) ||
                other.imageUrl == imageUrl) &&
            (identical(other.rating, rating) || other.rating == rating) &&
            (identical(other.available, available) ||
                other.available == available));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, id, name, specialty, imageUrl, rating, available);

  @override
  String toString() {
    return 'HospitalDoctor(id: $id, name: $name, specialty: $specialty, imageUrl: $imageUrl, rating: $rating, available: $available)';
  }
}

/// @nodoc
abstract mixin class _$HospitalDoctorCopyWith<$Res>
    implements $HospitalDoctorCopyWith<$Res> {
  factory _$HospitalDoctorCopyWith(
          _HospitalDoctor value, $Res Function(_HospitalDoctor) _then) =
      __$HospitalDoctorCopyWithImpl;
  @override
  @useResult
  $Res call(
      {String id,
      String name,
      String? specialty,
      String? imageUrl,
      double? rating,
      bool? available});
}

/// @nodoc
class __$HospitalDoctorCopyWithImpl<$Res>
    implements _$HospitalDoctorCopyWith<$Res> {
  __$HospitalDoctorCopyWithImpl(this._self, this._then);

  final _HospitalDoctor _self;
  final $Res Function(_HospitalDoctor) _then;

  /// Create a copy of HospitalDoctor
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? specialty = freezed,
    Object? imageUrl = freezed,
    Object? rating = freezed,
    Object? available = freezed,
  }) {
    return _then(_HospitalDoctor(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      specialty: freezed == specialty
          ? _self.specialty
          : specialty // ignore: cast_nullable_to_non_nullable
              as String?,
      imageUrl: freezed == imageUrl
          ? _self.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      rating: freezed == rating
          ? _self.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      available: freezed == available
          ? _self.available
          : available // ignore: cast_nullable_to_non_nullable
              as bool?,
    ));
  }
}

// dart format on

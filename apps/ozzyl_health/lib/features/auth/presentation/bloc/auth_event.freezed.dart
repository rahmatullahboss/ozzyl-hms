// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'auth_event.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$AuthEvent {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is AuthEvent);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'AuthEvent()';
  }
}

/// @nodoc
class $AuthEventCopyWith<$Res> {
  $AuthEventCopyWith(AuthEvent _, $Res Function(AuthEvent) __);
}

/// Adds pattern-matching-related methods to [AuthEvent].
extension AuthEventPatterns on AuthEvent {
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
  TResult maybeMap<TResult extends Object?>({
    TResult Function(LoginRequested value)? loginRequested,
    TResult Function(RegisterRequested value)? registerRequested,
    TResult Function(MfaSubmitted value)? mfaSubmitted,
    TResult Function(BiometricRequested value)? biometricRequested,
    TResult Function(LogoutRequested value)? logoutRequested,
    TResult Function(CheckAuthStatus value)? checkAuthStatus,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoginRequested() when loginRequested != null:
        return loginRequested(_that);
      case RegisterRequested() when registerRequested != null:
        return registerRequested(_that);
      case MfaSubmitted() when mfaSubmitted != null:
        return mfaSubmitted(_that);
      case BiometricRequested() when biometricRequested != null:
        return biometricRequested(_that);
      case LogoutRequested() when logoutRequested != null:
        return logoutRequested(_that);
      case CheckAuthStatus() when checkAuthStatus != null:
        return checkAuthStatus(_that);
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
  TResult map<TResult extends Object?>({
    required TResult Function(LoginRequested value) loginRequested,
    required TResult Function(RegisterRequested value) registerRequested,
    required TResult Function(MfaSubmitted value) mfaSubmitted,
    required TResult Function(BiometricRequested value) biometricRequested,
    required TResult Function(LogoutRequested value) logoutRequested,
    required TResult Function(CheckAuthStatus value) checkAuthStatus,
  }) {
    final _that = this;
    switch (_that) {
      case LoginRequested():
        return loginRequested(_that);
      case RegisterRequested():
        return registerRequested(_that);
      case MfaSubmitted():
        return mfaSubmitted(_that);
      case BiometricRequested():
        return biometricRequested(_that);
      case LogoutRequested():
        return logoutRequested(_that);
      case CheckAuthStatus():
        return checkAuthStatus(_that);
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
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(LoginRequested value)? loginRequested,
    TResult? Function(RegisterRequested value)? registerRequested,
    TResult? Function(MfaSubmitted value)? mfaSubmitted,
    TResult? Function(BiometricRequested value)? biometricRequested,
    TResult? Function(LogoutRequested value)? logoutRequested,
    TResult? Function(CheckAuthStatus value)? checkAuthStatus,
  }) {
    final _that = this;
    switch (_that) {
      case LoginRequested() when loginRequested != null:
        return loginRequested(_that);
      case RegisterRequested() when registerRequested != null:
        return registerRequested(_that);
      case MfaSubmitted() when mfaSubmitted != null:
        return mfaSubmitted(_that);
      case BiometricRequested() when biometricRequested != null:
        return biometricRequested(_that);
      case LogoutRequested() when logoutRequested != null:
        return logoutRequested(_that);
      case CheckAuthStatus() when checkAuthStatus != null:
        return checkAuthStatus(_that);
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
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String email, String password)? loginRequested,
    TResult Function(String email, String password, String name, String? phone)?
        registerRequested,
    TResult Function(String code, String tempToken)? mfaSubmitted,
    TResult Function()? biometricRequested,
    TResult Function()? logoutRequested,
    TResult Function()? checkAuthStatus,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoginRequested() when loginRequested != null:
        return loginRequested(_that.email, _that.password);
      case RegisterRequested() when registerRequested != null:
        return registerRequested(
            _that.email, _that.password, _that.name, _that.phone);
      case MfaSubmitted() when mfaSubmitted != null:
        return mfaSubmitted(_that.code, _that.tempToken);
      case BiometricRequested() when biometricRequested != null:
        return biometricRequested();
      case LogoutRequested() when logoutRequested != null:
        return logoutRequested();
      case CheckAuthStatus() when checkAuthStatus != null:
        return checkAuthStatus();
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
  TResult when<TResult extends Object?>({
    required TResult Function(String email, String password) loginRequested,
    required TResult Function(
            String email, String password, String name, String? phone)
        registerRequested,
    required TResult Function(String code, String tempToken) mfaSubmitted,
    required TResult Function() biometricRequested,
    required TResult Function() logoutRequested,
    required TResult Function() checkAuthStatus,
  }) {
    final _that = this;
    switch (_that) {
      case LoginRequested():
        return loginRequested(_that.email, _that.password);
      case RegisterRequested():
        return registerRequested(
            _that.email, _that.password, _that.name, _that.phone);
      case MfaSubmitted():
        return mfaSubmitted(_that.code, _that.tempToken);
      case BiometricRequested():
        return biometricRequested();
      case LogoutRequested():
        return logoutRequested();
      case CheckAuthStatus():
        return checkAuthStatus();
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
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String email, String password)? loginRequested,
    TResult? Function(
            String email, String password, String name, String? phone)?
        registerRequested,
    TResult? Function(String code, String tempToken)? mfaSubmitted,
    TResult? Function()? biometricRequested,
    TResult? Function()? logoutRequested,
    TResult? Function()? checkAuthStatus,
  }) {
    final _that = this;
    switch (_that) {
      case LoginRequested() when loginRequested != null:
        return loginRequested(_that.email, _that.password);
      case RegisterRequested() when registerRequested != null:
        return registerRequested(
            _that.email, _that.password, _that.name, _that.phone);
      case MfaSubmitted() when mfaSubmitted != null:
        return mfaSubmitted(_that.code, _that.tempToken);
      case BiometricRequested() when biometricRequested != null:
        return biometricRequested();
      case LogoutRequested() when logoutRequested != null:
        return logoutRequested();
      case CheckAuthStatus() when checkAuthStatus != null:
        return checkAuthStatus();
      case _:
        return null;
    }
  }
}

/// @nodoc

class LoginRequested implements AuthEvent {
  const LoginRequested({required this.email, required this.password});

  final String email;
  final String password;

  /// Create a copy of AuthEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $LoginRequestedCopyWith<LoginRequested> get copyWith =>
      _$LoginRequestedCopyWithImpl<LoginRequested>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is LoginRequested &&
            (identical(other.email, email) || other.email == email) &&
            (identical(other.password, password) ||
                other.password == password));
  }

  @override
  int get hashCode => Object.hash(runtimeType, email, password);

  @override
  String toString() {
    return 'AuthEvent.loginRequested(email: $email, password: $password)';
  }
}

/// @nodoc
abstract mixin class $LoginRequestedCopyWith<$Res>
    implements $AuthEventCopyWith<$Res> {
  factory $LoginRequestedCopyWith(
          LoginRequested value, $Res Function(LoginRequested) _then) =
      _$LoginRequestedCopyWithImpl;
  @useResult
  $Res call({String email, String password});
}

/// @nodoc
class _$LoginRequestedCopyWithImpl<$Res>
    implements $LoginRequestedCopyWith<$Res> {
  _$LoginRequestedCopyWithImpl(this._self, this._then);

  final LoginRequested _self;
  final $Res Function(LoginRequested) _then;

  /// Create a copy of AuthEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? email = null,
    Object? password = null,
  }) {
    return _then(LoginRequested(
      email: null == email
          ? _self.email
          : email // ignore: cast_nullable_to_non_nullable
              as String,
      password: null == password
          ? _self.password
          : password // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class RegisterRequested implements AuthEvent {
  const RegisterRequested(
      {required this.email,
      required this.password,
      required this.name,
      this.phone});

  final String email;
  final String password;
  final String name;
  final String? phone;

  /// Create a copy of AuthEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $RegisterRequestedCopyWith<RegisterRequested> get copyWith =>
      _$RegisterRequestedCopyWithImpl<RegisterRequested>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is RegisterRequested &&
            (identical(other.email, email) || other.email == email) &&
            (identical(other.password, password) ||
                other.password == password) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.phone, phone) || other.phone == phone));
  }

  @override
  int get hashCode => Object.hash(runtimeType, email, password, name, phone);

  @override
  String toString() {
    return 'AuthEvent.registerRequested(email: $email, password: $password, name: $name, phone: $phone)';
  }
}

/// @nodoc
abstract mixin class $RegisterRequestedCopyWith<$Res>
    implements $AuthEventCopyWith<$Res> {
  factory $RegisterRequestedCopyWith(
          RegisterRequested value, $Res Function(RegisterRequested) _then) =
      _$RegisterRequestedCopyWithImpl;
  @useResult
  $Res call({String email, String password, String name, String? phone});
}

/// @nodoc
class _$RegisterRequestedCopyWithImpl<$Res>
    implements $RegisterRequestedCopyWith<$Res> {
  _$RegisterRequestedCopyWithImpl(this._self, this._then);

  final RegisterRequested _self;
  final $Res Function(RegisterRequested) _then;

  /// Create a copy of AuthEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? email = null,
    Object? password = null,
    Object? name = null,
    Object? phone = freezed,
  }) {
    return _then(RegisterRequested(
      email: null == email
          ? _self.email
          : email // ignore: cast_nullable_to_non_nullable
              as String,
      password: null == password
          ? _self.password
          : password // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      phone: freezed == phone
          ? _self.phone
          : phone // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class MfaSubmitted implements AuthEvent {
  const MfaSubmitted({required this.code, required this.tempToken});

  final String code;
  final String tempToken;

  /// Create a copy of AuthEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $MfaSubmittedCopyWith<MfaSubmitted> get copyWith =>
      _$MfaSubmittedCopyWithImpl<MfaSubmitted>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is MfaSubmitted &&
            (identical(other.code, code) || other.code == code) &&
            (identical(other.tempToken, tempToken) ||
                other.tempToken == tempToken));
  }

  @override
  int get hashCode => Object.hash(runtimeType, code, tempToken);

  @override
  String toString() {
    return 'AuthEvent.mfaSubmitted(code: $code, tempToken: $tempToken)';
  }
}

/// @nodoc
abstract mixin class $MfaSubmittedCopyWith<$Res>
    implements $AuthEventCopyWith<$Res> {
  factory $MfaSubmittedCopyWith(
          MfaSubmitted value, $Res Function(MfaSubmitted) _then) =
      _$MfaSubmittedCopyWithImpl;
  @useResult
  $Res call({String code, String tempToken});
}

/// @nodoc
class _$MfaSubmittedCopyWithImpl<$Res> implements $MfaSubmittedCopyWith<$Res> {
  _$MfaSubmittedCopyWithImpl(this._self, this._then);

  final MfaSubmitted _self;
  final $Res Function(MfaSubmitted) _then;

  /// Create a copy of AuthEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? code = null,
    Object? tempToken = null,
  }) {
    return _then(MfaSubmitted(
      code: null == code
          ? _self.code
          : code // ignore: cast_nullable_to_non_nullable
              as String,
      tempToken: null == tempToken
          ? _self.tempToken
          : tempToken // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class BiometricRequested implements AuthEvent {
  const BiometricRequested();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is BiometricRequested);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'AuthEvent.biometricRequested()';
  }
}

/// @nodoc

class LogoutRequested implements AuthEvent {
  const LogoutRequested();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is LogoutRequested);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'AuthEvent.logoutRequested()';
  }
}

/// @nodoc

class CheckAuthStatus implements AuthEvent {
  const CheckAuthStatus();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is CheckAuthStatus);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'AuthEvent.checkAuthStatus()';
  }
}

// dart format on

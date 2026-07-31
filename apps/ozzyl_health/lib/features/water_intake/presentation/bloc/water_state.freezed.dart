// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'water_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$WaterState {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is WaterState);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'WaterState()';
  }
}

/// @nodoc
class $WaterStateCopyWith<$Res> {
  $WaterStateCopyWith(WaterState _, $Res Function(WaterState) __);
}

/// Adds pattern-matching-related methods to [WaterState].
extension WaterStatePatterns on WaterState {
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
    TResult Function(WaterInitial value)? initial,
    TResult Function(WaterLoading value)? loading,
    TResult Function(WaterLoaded value)? loaded,
    TResult Function(WaterError value)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case WaterInitial() when initial != null:
        return initial(_that);
      case WaterLoading() when loading != null:
        return loading(_that);
      case WaterLoaded() when loaded != null:
        return loaded(_that);
      case WaterError() when error != null:
        return error(_that);
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
    required TResult Function(WaterInitial value) initial,
    required TResult Function(WaterLoading value) loading,
    required TResult Function(WaterLoaded value) loaded,
    required TResult Function(WaterError value) error,
  }) {
    final _that = this;
    switch (_that) {
      case WaterInitial():
        return initial(_that);
      case WaterLoading():
        return loading(_that);
      case WaterLoaded():
        return loaded(_that);
      case WaterError():
        return error(_that);
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
    TResult? Function(WaterInitial value)? initial,
    TResult? Function(WaterLoading value)? loading,
    TResult? Function(WaterLoaded value)? loaded,
    TResult? Function(WaterError value)? error,
  }) {
    final _that = this;
    switch (_that) {
      case WaterInitial() when initial != null:
        return initial(_that);
      case WaterLoading() when loading != null:
        return loading(_that);
      case WaterLoaded() when loaded != null:
        return loaded(_that);
      case WaterError() when error != null:
        return error(_that);
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
    TResult Function()? initial,
    TResult Function()? loading,
    TResult Function(List<WaterLogEntity> logs, int totalMl, int goalMl)?
        loaded,
    TResult Function(String message)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case WaterInitial() when initial != null:
        return initial();
      case WaterLoading() when loading != null:
        return loading();
      case WaterLoaded() when loaded != null:
        return loaded(_that.logs, _that.totalMl, _that.goalMl);
      case WaterError() when error != null:
        return error(_that.message);
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
    required TResult Function() initial,
    required TResult Function() loading,
    required TResult Function(
            List<WaterLogEntity> logs, int totalMl, int goalMl)
        loaded,
    required TResult Function(String message) error,
  }) {
    final _that = this;
    switch (_that) {
      case WaterInitial():
        return initial();
      case WaterLoading():
        return loading();
      case WaterLoaded():
        return loaded(_that.logs, _that.totalMl, _that.goalMl);
      case WaterError():
        return error(_that.message);
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
    TResult? Function()? initial,
    TResult? Function()? loading,
    TResult? Function(List<WaterLogEntity> logs, int totalMl, int goalMl)?
        loaded,
    TResult? Function(String message)? error,
  }) {
    final _that = this;
    switch (_that) {
      case WaterInitial() when initial != null:
        return initial();
      case WaterLoading() when loading != null:
        return loading();
      case WaterLoaded() when loaded != null:
        return loaded(_that.logs, _that.totalMl, _that.goalMl);
      case WaterError() when error != null:
        return error(_that.message);
      case _:
        return null;
    }
  }
}

/// @nodoc

class WaterInitial implements WaterState {
  const WaterInitial();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is WaterInitial);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'WaterState.initial()';
  }
}

/// @nodoc

class WaterLoading implements WaterState {
  const WaterLoading();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is WaterLoading);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'WaterState.loading()';
  }
}

/// @nodoc

class WaterLoaded implements WaterState {
  const WaterLoaded(
      {required final List<WaterLogEntity> logs,
      required this.totalMl,
      this.goalMl = 2500})
      : _logs = logs;

  final List<WaterLogEntity> _logs;
  List<WaterLogEntity> get logs {
    if (_logs is EqualUnmodifiableListView) return _logs;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_logs);
  }

  final int totalMl;
  @JsonKey()
  final int goalMl;

  /// Create a copy of WaterState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $WaterLoadedCopyWith<WaterLoaded> get copyWith =>
      _$WaterLoadedCopyWithImpl<WaterLoaded>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is WaterLoaded &&
            const DeepCollectionEquality().equals(other._logs, _logs) &&
            (identical(other.totalMl, totalMl) || other.totalMl == totalMl) &&
            (identical(other.goalMl, goalMl) || other.goalMl == goalMl));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, const DeepCollectionEquality().hash(_logs), totalMl, goalMl);

  @override
  String toString() {
    return 'WaterState.loaded(logs: $logs, totalMl: $totalMl, goalMl: $goalMl)';
  }
}

/// @nodoc
abstract mixin class $WaterLoadedCopyWith<$Res>
    implements $WaterStateCopyWith<$Res> {
  factory $WaterLoadedCopyWith(
          WaterLoaded value, $Res Function(WaterLoaded) _then) =
      _$WaterLoadedCopyWithImpl;
  @useResult
  $Res call({List<WaterLogEntity> logs, int totalMl, int goalMl});
}

/// @nodoc
class _$WaterLoadedCopyWithImpl<$Res> implements $WaterLoadedCopyWith<$Res> {
  _$WaterLoadedCopyWithImpl(this._self, this._then);

  final WaterLoaded _self;
  final $Res Function(WaterLoaded) _then;

  /// Create a copy of WaterState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? logs = null,
    Object? totalMl = null,
    Object? goalMl = null,
  }) {
    return _then(WaterLoaded(
      logs: null == logs
          ? _self._logs
          : logs // ignore: cast_nullable_to_non_nullable
              as List<WaterLogEntity>,
      totalMl: null == totalMl
          ? _self.totalMl
          : totalMl // ignore: cast_nullable_to_non_nullable
              as int,
      goalMl: null == goalMl
          ? _self.goalMl
          : goalMl // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc

class WaterError implements WaterState {
  const WaterError(this.message);

  final String message;

  /// Create a copy of WaterState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $WaterErrorCopyWith<WaterError> get copyWith =>
      _$WaterErrorCopyWithImpl<WaterError>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is WaterError &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @override
  String toString() {
    return 'WaterState.error(message: $message)';
  }
}

/// @nodoc
abstract mixin class $WaterErrorCopyWith<$Res>
    implements $WaterStateCopyWith<$Res> {
  factory $WaterErrorCopyWith(
          WaterError value, $Res Function(WaterError) _then) =
      _$WaterErrorCopyWithImpl;
  @useResult
  $Res call({String message});
}

/// @nodoc
class _$WaterErrorCopyWithImpl<$Res> implements $WaterErrorCopyWith<$Res> {
  _$WaterErrorCopyWithImpl(this._self, this._then);

  final WaterError _self;
  final $Res Function(WaterError) _then;

  /// Create a copy of WaterState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
  }) {
    return _then(WaterError(
      null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

// dart format on

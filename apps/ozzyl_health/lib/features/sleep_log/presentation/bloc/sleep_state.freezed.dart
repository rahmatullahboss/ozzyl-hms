// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'sleep_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$SleepState {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is SleepState);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'SleepState()';
  }
}

/// @nodoc
class $SleepStateCopyWith<$Res> {
  $SleepStateCopyWith(SleepState _, $Res Function(SleepState) __);
}

/// Adds pattern-matching-related methods to [SleepState].
extension SleepStatePatterns on SleepState {
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
    TResult Function(SleepInitial value)? initial,
    TResult Function(SleepLoading value)? loading,
    TResult Function(SleepLoaded value)? loaded,
    TResult Function(SleepError value)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case SleepInitial() when initial != null:
        return initial(_that);
      case SleepLoading() when loading != null:
        return loading(_that);
      case SleepLoaded() when loaded != null:
        return loaded(_that);
      case SleepError() when error != null:
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
    required TResult Function(SleepInitial value) initial,
    required TResult Function(SleepLoading value) loading,
    required TResult Function(SleepLoaded value) loaded,
    required TResult Function(SleepError value) error,
  }) {
    final _that = this;
    switch (_that) {
      case SleepInitial():
        return initial(_that);
      case SleepLoading():
        return loading(_that);
      case SleepLoaded():
        return loaded(_that);
      case SleepError():
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
    TResult? Function(SleepInitial value)? initial,
    TResult? Function(SleepLoading value)? loading,
    TResult? Function(SleepLoaded value)? loaded,
    TResult? Function(SleepError value)? error,
  }) {
    final _that = this;
    switch (_that) {
      case SleepInitial() when initial != null:
        return initial(_that);
      case SleepLoading() when loading != null:
        return loading(_that);
      case SleepLoaded() when loaded != null:
        return loaded(_that);
      case SleepError() when error != null:
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
    TResult Function(List<SleepEntry> entries, double avgHours)? loaded,
    TResult Function(String message)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case SleepInitial() when initial != null:
        return initial();
      case SleepLoading() when loading != null:
        return loading();
      case SleepLoaded() when loaded != null:
        return loaded(_that.entries, _that.avgHours);
      case SleepError() when error != null:
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
    required TResult Function(List<SleepEntry> entries, double avgHours) loaded,
    required TResult Function(String message) error,
  }) {
    final _that = this;
    switch (_that) {
      case SleepInitial():
        return initial();
      case SleepLoading():
        return loading();
      case SleepLoaded():
        return loaded(_that.entries, _that.avgHours);
      case SleepError():
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
    TResult? Function(List<SleepEntry> entries, double avgHours)? loaded,
    TResult? Function(String message)? error,
  }) {
    final _that = this;
    switch (_that) {
      case SleepInitial() when initial != null:
        return initial();
      case SleepLoading() when loading != null:
        return loading();
      case SleepLoaded() when loaded != null:
        return loaded(_that.entries, _that.avgHours);
      case SleepError() when error != null:
        return error(_that.message);
      case _:
        return null;
    }
  }
}

/// @nodoc

class SleepInitial implements SleepState {
  const SleepInitial();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is SleepInitial);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'SleepState.initial()';
  }
}

/// @nodoc

class SleepLoading implements SleepState {
  const SleepLoading();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is SleepLoading);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'SleepState.loading()';
  }
}

/// @nodoc

class SleepLoaded implements SleepState {
  const SleepLoaded(
      {required final List<SleepEntry> entries, required this.avgHours})
      : _entries = entries;

  final List<SleepEntry> _entries;
  List<SleepEntry> get entries {
    if (_entries is EqualUnmodifiableListView) return _entries;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_entries);
  }

  final double avgHours;

  /// Create a copy of SleepState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $SleepLoadedCopyWith<SleepLoaded> get copyWith =>
      _$SleepLoadedCopyWithImpl<SleepLoaded>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is SleepLoaded &&
            const DeepCollectionEquality().equals(other._entries, _entries) &&
            (identical(other.avgHours, avgHours) ||
                other.avgHours == avgHours));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, const DeepCollectionEquality().hash(_entries), avgHours);

  @override
  String toString() {
    return 'SleepState.loaded(entries: $entries, avgHours: $avgHours)';
  }
}

/// @nodoc
abstract mixin class $SleepLoadedCopyWith<$Res>
    implements $SleepStateCopyWith<$Res> {
  factory $SleepLoadedCopyWith(
          SleepLoaded value, $Res Function(SleepLoaded) _then) =
      _$SleepLoadedCopyWithImpl;
  @useResult
  $Res call({List<SleepEntry> entries, double avgHours});
}

/// @nodoc
class _$SleepLoadedCopyWithImpl<$Res> implements $SleepLoadedCopyWith<$Res> {
  _$SleepLoadedCopyWithImpl(this._self, this._then);

  final SleepLoaded _self;
  final $Res Function(SleepLoaded) _then;

  /// Create a copy of SleepState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? entries = null,
    Object? avgHours = null,
  }) {
    return _then(SleepLoaded(
      entries: null == entries
          ? _self._entries
          : entries // ignore: cast_nullable_to_non_nullable
              as List<SleepEntry>,
      avgHours: null == avgHours
          ? _self.avgHours
          : avgHours // ignore: cast_nullable_to_non_nullable
              as double,
    ));
  }
}

/// @nodoc

class SleepError implements SleepState {
  const SleepError(this.message);

  final String message;

  /// Create a copy of SleepState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $SleepErrorCopyWith<SleepError> get copyWith =>
      _$SleepErrorCopyWithImpl<SleepError>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is SleepError &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @override
  String toString() {
    return 'SleepState.error(message: $message)';
  }
}

/// @nodoc
abstract mixin class $SleepErrorCopyWith<$Res>
    implements $SleepStateCopyWith<$Res> {
  factory $SleepErrorCopyWith(
          SleepError value, $Res Function(SleepError) _then) =
      _$SleepErrorCopyWithImpl;
  @useResult
  $Res call({String message});
}

/// @nodoc
class _$SleepErrorCopyWithImpl<$Res> implements $SleepErrorCopyWith<$Res> {
  _$SleepErrorCopyWithImpl(this._self, this._then);

  final SleepError _self;
  final $Res Function(SleepError) _then;

  /// Create a copy of SleepState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
  }) {
    return _then(SleepError(
      null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

// dart format on

// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'exercise_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$ExerciseState {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is ExerciseState);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'ExerciseState()';
  }
}

/// @nodoc
class $ExerciseStateCopyWith<$Res> {
  $ExerciseStateCopyWith(ExerciseState _, $Res Function(ExerciseState) __);
}

/// Adds pattern-matching-related methods to [ExerciseState].
extension ExerciseStatePatterns on ExerciseState {
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
    TResult Function(ExerciseInitial value)? initial,
    TResult Function(ExerciseLoading value)? loading,
    TResult Function(ExerciseLoaded value)? loaded,
    TResult Function(ExerciseError value)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case ExerciseInitial() when initial != null:
        return initial(_that);
      case ExerciseLoading() when loading != null:
        return loading(_that);
      case ExerciseLoaded() when loaded != null:
        return loaded(_that);
      case ExerciseError() when error != null:
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
    required TResult Function(ExerciseInitial value) initial,
    required TResult Function(ExerciseLoading value) loading,
    required TResult Function(ExerciseLoaded value) loaded,
    required TResult Function(ExerciseError value) error,
  }) {
    final _that = this;
    switch (_that) {
      case ExerciseInitial():
        return initial(_that);
      case ExerciseLoading():
        return loading(_that);
      case ExerciseLoaded():
        return loaded(_that);
      case ExerciseError():
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
    TResult? Function(ExerciseInitial value)? initial,
    TResult? Function(ExerciseLoading value)? loading,
    TResult? Function(ExerciseLoaded value)? loaded,
    TResult? Function(ExerciseError value)? error,
  }) {
    final _that = this;
    switch (_that) {
      case ExerciseInitial() when initial != null:
        return initial(_that);
      case ExerciseLoading() when loading != null:
        return loading(_that);
      case ExerciseLoaded() when loaded != null:
        return loaded(_that);
      case ExerciseError() when error != null:
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
    TResult Function(List<ExerciseEntry> entries, int todayMinutes)? loaded,
    TResult Function(String message)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case ExerciseInitial() when initial != null:
        return initial();
      case ExerciseLoading() when loading != null:
        return loading();
      case ExerciseLoaded() when loaded != null:
        return loaded(_that.entries, _that.todayMinutes);
      case ExerciseError() when error != null:
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
    required TResult Function(List<ExerciseEntry> entries, int todayMinutes)
        loaded,
    required TResult Function(String message) error,
  }) {
    final _that = this;
    switch (_that) {
      case ExerciseInitial():
        return initial();
      case ExerciseLoading():
        return loading();
      case ExerciseLoaded():
        return loaded(_that.entries, _that.todayMinutes);
      case ExerciseError():
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
    TResult? Function(List<ExerciseEntry> entries, int todayMinutes)? loaded,
    TResult? Function(String message)? error,
  }) {
    final _that = this;
    switch (_that) {
      case ExerciseInitial() when initial != null:
        return initial();
      case ExerciseLoading() when loading != null:
        return loading();
      case ExerciseLoaded() when loaded != null:
        return loaded(_that.entries, _that.todayMinutes);
      case ExerciseError() when error != null:
        return error(_that.message);
      case _:
        return null;
    }
  }
}

/// @nodoc

class ExerciseInitial implements ExerciseState {
  const ExerciseInitial();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is ExerciseInitial);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'ExerciseState.initial()';
  }
}

/// @nodoc

class ExerciseLoading implements ExerciseState {
  const ExerciseLoading();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is ExerciseLoading);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'ExerciseState.loading()';
  }
}

/// @nodoc

class ExerciseLoaded implements ExerciseState {
  const ExerciseLoaded(
      {required final List<ExerciseEntry> entries, required this.todayMinutes})
      : _entries = entries;

  final List<ExerciseEntry> _entries;
  List<ExerciseEntry> get entries {
    if (_entries is EqualUnmodifiableListView) return _entries;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_entries);
  }

  final int todayMinutes;

  /// Create a copy of ExerciseState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $ExerciseLoadedCopyWith<ExerciseLoaded> get copyWith =>
      _$ExerciseLoadedCopyWithImpl<ExerciseLoaded>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is ExerciseLoaded &&
            const DeepCollectionEquality().equals(other._entries, _entries) &&
            (identical(other.todayMinutes, todayMinutes) ||
                other.todayMinutes == todayMinutes));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, const DeepCollectionEquality().hash(_entries), todayMinutes);

  @override
  String toString() {
    return 'ExerciseState.loaded(entries: $entries, todayMinutes: $todayMinutes)';
  }
}

/// @nodoc
abstract mixin class $ExerciseLoadedCopyWith<$Res>
    implements $ExerciseStateCopyWith<$Res> {
  factory $ExerciseLoadedCopyWith(
          ExerciseLoaded value, $Res Function(ExerciseLoaded) _then) =
      _$ExerciseLoadedCopyWithImpl;
  @useResult
  $Res call({List<ExerciseEntry> entries, int todayMinutes});
}

/// @nodoc
class _$ExerciseLoadedCopyWithImpl<$Res>
    implements $ExerciseLoadedCopyWith<$Res> {
  _$ExerciseLoadedCopyWithImpl(this._self, this._then);

  final ExerciseLoaded _self;
  final $Res Function(ExerciseLoaded) _then;

  /// Create a copy of ExerciseState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? entries = null,
    Object? todayMinutes = null,
  }) {
    return _then(ExerciseLoaded(
      entries: null == entries
          ? _self._entries
          : entries // ignore: cast_nullable_to_non_nullable
              as List<ExerciseEntry>,
      todayMinutes: null == todayMinutes
          ? _self.todayMinutes
          : todayMinutes // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc

class ExerciseError implements ExerciseState {
  const ExerciseError(this.message);

  final String message;

  /// Create a copy of ExerciseState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $ExerciseErrorCopyWith<ExerciseError> get copyWith =>
      _$ExerciseErrorCopyWithImpl<ExerciseError>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is ExerciseError &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @override
  String toString() {
    return 'ExerciseState.error(message: $message)';
  }
}

/// @nodoc
abstract mixin class $ExerciseErrorCopyWith<$Res>
    implements $ExerciseStateCopyWith<$Res> {
  factory $ExerciseErrorCopyWith(
          ExerciseError value, $Res Function(ExerciseError) _then) =
      _$ExerciseErrorCopyWithImpl;
  @useResult
  $Res call({String message});
}

/// @nodoc
class _$ExerciseErrorCopyWithImpl<$Res>
    implements $ExerciseErrorCopyWith<$Res> {
  _$ExerciseErrorCopyWithImpl(this._self, this._then);

  final ExerciseError _self;
  final $Res Function(ExerciseError) _then;

  /// Create a copy of ExerciseState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
  }) {
    return _then(ExerciseError(
      null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

// dart format on

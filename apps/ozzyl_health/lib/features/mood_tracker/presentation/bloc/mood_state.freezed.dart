// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'mood_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$MoodState {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is MoodState);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'MoodState()';
  }
}

/// @nodoc
class $MoodStateCopyWith<$Res> {
  $MoodStateCopyWith(MoodState _, $Res Function(MoodState) __);
}

/// Adds pattern-matching-related methods to [MoodState].
extension MoodStatePatterns on MoodState {
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
    TResult Function(MoodInitial value)? initial,
    TResult Function(MoodLoading value)? loading,
    TResult Function(MoodLoaded value)? loaded,
    TResult Function(MoodError value)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case MoodInitial() when initial != null:
        return initial(_that);
      case MoodLoading() when loading != null:
        return loading(_that);
      case MoodLoaded() when loaded != null:
        return loaded(_that);
      case MoodError() when error != null:
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
    required TResult Function(MoodInitial value) initial,
    required TResult Function(MoodLoading value) loading,
    required TResult Function(MoodLoaded value) loaded,
    required TResult Function(MoodError value) error,
  }) {
    final _that = this;
    switch (_that) {
      case MoodInitial():
        return initial(_that);
      case MoodLoading():
        return loading(_that);
      case MoodLoaded():
        return loaded(_that);
      case MoodError():
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
    TResult? Function(MoodInitial value)? initial,
    TResult? Function(MoodLoading value)? loading,
    TResult? Function(MoodLoaded value)? loaded,
    TResult? Function(MoodError value)? error,
  }) {
    final _that = this;
    switch (_that) {
      case MoodInitial() when initial != null:
        return initial(_that);
      case MoodLoading() when loading != null:
        return loading(_that);
      case MoodLoaded() when loaded != null:
        return loaded(_that);
      case MoodError() when error != null:
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
    TResult Function(List<MoodEntryEntity> entries)? loaded,
    TResult Function(String message)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case MoodInitial() when initial != null:
        return initial();
      case MoodLoading() when loading != null:
        return loading();
      case MoodLoaded() when loaded != null:
        return loaded(_that.entries);
      case MoodError() when error != null:
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
    required TResult Function(List<MoodEntryEntity> entries) loaded,
    required TResult Function(String message) error,
  }) {
    final _that = this;
    switch (_that) {
      case MoodInitial():
        return initial();
      case MoodLoading():
        return loading();
      case MoodLoaded():
        return loaded(_that.entries);
      case MoodError():
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
    TResult? Function(List<MoodEntryEntity> entries)? loaded,
    TResult? Function(String message)? error,
  }) {
    final _that = this;
    switch (_that) {
      case MoodInitial() when initial != null:
        return initial();
      case MoodLoading() when loading != null:
        return loading();
      case MoodLoaded() when loaded != null:
        return loaded(_that.entries);
      case MoodError() when error != null:
        return error(_that.message);
      case _:
        return null;
    }
  }
}

/// @nodoc

class MoodInitial implements MoodState {
  const MoodInitial();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is MoodInitial);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'MoodState.initial()';
  }
}

/// @nodoc

class MoodLoading implements MoodState {
  const MoodLoading();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is MoodLoading);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'MoodState.loading()';
  }
}

/// @nodoc

class MoodLoaded implements MoodState {
  const MoodLoaded(final List<MoodEntryEntity> entries) : _entries = entries;

  final List<MoodEntryEntity> _entries;
  List<MoodEntryEntity> get entries {
    if (_entries is EqualUnmodifiableListView) return _entries;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_entries);
  }

  /// Create a copy of MoodState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $MoodLoadedCopyWith<MoodLoaded> get copyWith =>
      _$MoodLoadedCopyWithImpl<MoodLoaded>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is MoodLoaded &&
            const DeepCollectionEquality().equals(other._entries, _entries));
  }

  @override
  int get hashCode =>
      Object.hash(runtimeType, const DeepCollectionEquality().hash(_entries));

  @override
  String toString() {
    return 'MoodState.loaded(entries: $entries)';
  }
}

/// @nodoc
abstract mixin class $MoodLoadedCopyWith<$Res>
    implements $MoodStateCopyWith<$Res> {
  factory $MoodLoadedCopyWith(
          MoodLoaded value, $Res Function(MoodLoaded) _then) =
      _$MoodLoadedCopyWithImpl;
  @useResult
  $Res call({List<MoodEntryEntity> entries});
}

/// @nodoc
class _$MoodLoadedCopyWithImpl<$Res> implements $MoodLoadedCopyWith<$Res> {
  _$MoodLoadedCopyWithImpl(this._self, this._then);

  final MoodLoaded _self;
  final $Res Function(MoodLoaded) _then;

  /// Create a copy of MoodState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? entries = null,
  }) {
    return _then(MoodLoaded(
      null == entries
          ? _self._entries
          : entries // ignore: cast_nullable_to_non_nullable
              as List<MoodEntryEntity>,
    ));
  }
}

/// @nodoc

class MoodError implements MoodState {
  const MoodError(this.message);

  final String message;

  /// Create a copy of MoodState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $MoodErrorCopyWith<MoodError> get copyWith =>
      _$MoodErrorCopyWithImpl<MoodError>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is MoodError &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @override
  String toString() {
    return 'MoodState.error(message: $message)';
  }
}

/// @nodoc
abstract mixin class $MoodErrorCopyWith<$Res>
    implements $MoodStateCopyWith<$Res> {
  factory $MoodErrorCopyWith(MoodError value, $Res Function(MoodError) _then) =
      _$MoodErrorCopyWithImpl;
  @useResult
  $Res call({String message});
}

/// @nodoc
class _$MoodErrorCopyWithImpl<$Res> implements $MoodErrorCopyWith<$Res> {
  _$MoodErrorCopyWithImpl(this._self, this._then);

  final MoodError _self;
  final $Res Function(MoodError) _then;

  /// Create a copy of MoodState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
  }) {
    return _then(MoodError(
      null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

// dart format on

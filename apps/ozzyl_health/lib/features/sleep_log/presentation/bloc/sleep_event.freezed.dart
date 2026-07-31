// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'sleep_event.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$SleepEvent {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is SleepEvent);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'SleepEvent()';
  }
}

/// @nodoc
class $SleepEventCopyWith<$Res> {
  $SleepEventCopyWith(SleepEvent _, $Res Function(SleepEvent) __);
}

/// Adds pattern-matching-related methods to [SleepEvent].
extension SleepEventPatterns on SleepEvent {
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
    TResult Function(LoadSleep value)? load,
    TResult Function(AddSleep value)? add,
    TResult Function(DeleteSleep value)? delete,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadSleep() when load != null:
        return load(_that);
      case AddSleep() when add != null:
        return add(_that);
      case DeleteSleep() when delete != null:
        return delete(_that);
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
    required TResult Function(LoadSleep value) load,
    required TResult Function(AddSleep value) add,
    required TResult Function(DeleteSleep value) delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadSleep():
        return load(_that);
      case AddSleep():
        return add(_that);
      case DeleteSleep():
        return delete(_that);
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
    TResult? Function(LoadSleep value)? load,
    TResult? Function(AddSleep value)? add,
    TResult? Function(DeleteSleep value)? delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadSleep() when load != null:
        return load(_that);
      case AddSleep() when add != null:
        return add(_that);
      case DeleteSleep() when delete != null:
        return delete(_that);
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
    TResult Function()? load,
    TResult Function(DateTime bedtime, DateTime wakeTime, int? quality)? add,
    TResult Function(int id)? delete,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadSleep() when load != null:
        return load();
      case AddSleep() when add != null:
        return add(_that.bedtime, _that.wakeTime, _that.quality);
      case DeleteSleep() when delete != null:
        return delete(_that.id);
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
    required TResult Function() load,
    required TResult Function(DateTime bedtime, DateTime wakeTime, int? quality)
        add,
    required TResult Function(int id) delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadSleep():
        return load();
      case AddSleep():
        return add(_that.bedtime, _that.wakeTime, _that.quality);
      case DeleteSleep():
        return delete(_that.id);
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
    TResult? Function()? load,
    TResult? Function(DateTime bedtime, DateTime wakeTime, int? quality)? add,
    TResult? Function(int id)? delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadSleep() when load != null:
        return load();
      case AddSleep() when add != null:
        return add(_that.bedtime, _that.wakeTime, _that.quality);
      case DeleteSleep() when delete != null:
        return delete(_that.id);
      case _:
        return null;
    }
  }
}

/// @nodoc

class LoadSleep implements SleepEvent {
  const LoadSleep();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is LoadSleep);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'SleepEvent.load()';
  }
}

/// @nodoc

class AddSleep implements SleepEvent {
  const AddSleep({required this.bedtime, required this.wakeTime, this.quality});

  final DateTime bedtime;
  final DateTime wakeTime;
  final int? quality;

  /// Create a copy of SleepEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $AddSleepCopyWith<AddSleep> get copyWith =>
      _$AddSleepCopyWithImpl<AddSleep>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is AddSleep &&
            (identical(other.bedtime, bedtime) || other.bedtime == bedtime) &&
            (identical(other.wakeTime, wakeTime) ||
                other.wakeTime == wakeTime) &&
            (identical(other.quality, quality) || other.quality == quality));
  }

  @override
  int get hashCode => Object.hash(runtimeType, bedtime, wakeTime, quality);

  @override
  String toString() {
    return 'SleepEvent.add(bedtime: $bedtime, wakeTime: $wakeTime, quality: $quality)';
  }
}

/// @nodoc
abstract mixin class $AddSleepCopyWith<$Res>
    implements $SleepEventCopyWith<$Res> {
  factory $AddSleepCopyWith(AddSleep value, $Res Function(AddSleep) _then) =
      _$AddSleepCopyWithImpl;
  @useResult
  $Res call({DateTime bedtime, DateTime wakeTime, int? quality});
}

/// @nodoc
class _$AddSleepCopyWithImpl<$Res> implements $AddSleepCopyWith<$Res> {
  _$AddSleepCopyWithImpl(this._self, this._then);

  final AddSleep _self;
  final $Res Function(AddSleep) _then;

  /// Create a copy of SleepEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? bedtime = null,
    Object? wakeTime = null,
    Object? quality = freezed,
  }) {
    return _then(AddSleep(
      bedtime: null == bedtime
          ? _self.bedtime
          : bedtime // ignore: cast_nullable_to_non_nullable
              as DateTime,
      wakeTime: null == wakeTime
          ? _self.wakeTime
          : wakeTime // ignore: cast_nullable_to_non_nullable
              as DateTime,
      quality: freezed == quality
          ? _self.quality
          : quality // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// @nodoc

class DeleteSleep implements SleepEvent {
  const DeleteSleep(this.id);

  final int id;

  /// Create a copy of SleepEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $DeleteSleepCopyWith<DeleteSleep> get copyWith =>
      _$DeleteSleepCopyWithImpl<DeleteSleep>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is DeleteSleep &&
            (identical(other.id, id) || other.id == id));
  }

  @override
  int get hashCode => Object.hash(runtimeType, id);

  @override
  String toString() {
    return 'SleepEvent.delete(id: $id)';
  }
}

/// @nodoc
abstract mixin class $DeleteSleepCopyWith<$Res>
    implements $SleepEventCopyWith<$Res> {
  factory $DeleteSleepCopyWith(
          DeleteSleep value, $Res Function(DeleteSleep) _then) =
      _$DeleteSleepCopyWithImpl;
  @useResult
  $Res call({int id});
}

/// @nodoc
class _$DeleteSleepCopyWithImpl<$Res> implements $DeleteSleepCopyWith<$Res> {
  _$DeleteSleepCopyWithImpl(this._self, this._then);

  final DeleteSleep _self;
  final $Res Function(DeleteSleep) _then;

  /// Create a copy of SleepEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
  }) {
    return _then(DeleteSleep(
      null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

// dart format on

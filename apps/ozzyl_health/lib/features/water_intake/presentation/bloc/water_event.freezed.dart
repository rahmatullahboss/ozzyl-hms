// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'water_event.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$WaterEvent {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is WaterEvent);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'WaterEvent()';
  }
}

/// @nodoc
class $WaterEventCopyWith<$Res> {
  $WaterEventCopyWith(WaterEvent _, $Res Function(WaterEvent) __);
}

/// Adds pattern-matching-related methods to [WaterEvent].
extension WaterEventPatterns on WaterEvent {
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
    TResult Function(LoadTodayWater value)? loadToday,
    TResult Function(AddWater value)? addWater,
    TResult Function(DeleteWaterLog value)? deleteLog,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadTodayWater() when loadToday != null:
        return loadToday(_that);
      case AddWater() when addWater != null:
        return addWater(_that);
      case DeleteWaterLog() when deleteLog != null:
        return deleteLog(_that);
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
    required TResult Function(LoadTodayWater value) loadToday,
    required TResult Function(AddWater value) addWater,
    required TResult Function(DeleteWaterLog value) deleteLog,
  }) {
    final _that = this;
    switch (_that) {
      case LoadTodayWater():
        return loadToday(_that);
      case AddWater():
        return addWater(_that);
      case DeleteWaterLog():
        return deleteLog(_that);
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
    TResult? Function(LoadTodayWater value)? loadToday,
    TResult? Function(AddWater value)? addWater,
    TResult? Function(DeleteWaterLog value)? deleteLog,
  }) {
    final _that = this;
    switch (_that) {
      case LoadTodayWater() when loadToday != null:
        return loadToday(_that);
      case AddWater() when addWater != null:
        return addWater(_that);
      case DeleteWaterLog() when deleteLog != null:
        return deleteLog(_that);
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
    TResult Function()? loadToday,
    TResult Function(int amountMl)? addWater,
    TResult Function(int id)? deleteLog,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadTodayWater() when loadToday != null:
        return loadToday();
      case AddWater() when addWater != null:
        return addWater(_that.amountMl);
      case DeleteWaterLog() when deleteLog != null:
        return deleteLog(_that.id);
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
    required TResult Function() loadToday,
    required TResult Function(int amountMl) addWater,
    required TResult Function(int id) deleteLog,
  }) {
    final _that = this;
    switch (_that) {
      case LoadTodayWater():
        return loadToday();
      case AddWater():
        return addWater(_that.amountMl);
      case DeleteWaterLog():
        return deleteLog(_that.id);
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
    TResult? Function()? loadToday,
    TResult? Function(int amountMl)? addWater,
    TResult? Function(int id)? deleteLog,
  }) {
    final _that = this;
    switch (_that) {
      case LoadTodayWater() when loadToday != null:
        return loadToday();
      case AddWater() when addWater != null:
        return addWater(_that.amountMl);
      case DeleteWaterLog() when deleteLog != null:
        return deleteLog(_that.id);
      case _:
        return null;
    }
  }
}

/// @nodoc

class LoadTodayWater implements WaterEvent {
  const LoadTodayWater();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is LoadTodayWater);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'WaterEvent.loadToday()';
  }
}

/// @nodoc

class AddWater implements WaterEvent {
  const AddWater(this.amountMl);

  final int amountMl;

  /// Create a copy of WaterEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $AddWaterCopyWith<AddWater> get copyWith =>
      _$AddWaterCopyWithImpl<AddWater>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is AddWater &&
            (identical(other.amountMl, amountMl) ||
                other.amountMl == amountMl));
  }

  @override
  int get hashCode => Object.hash(runtimeType, amountMl);

  @override
  String toString() {
    return 'WaterEvent.addWater(amountMl: $amountMl)';
  }
}

/// @nodoc
abstract mixin class $AddWaterCopyWith<$Res>
    implements $WaterEventCopyWith<$Res> {
  factory $AddWaterCopyWith(AddWater value, $Res Function(AddWater) _then) =
      _$AddWaterCopyWithImpl;
  @useResult
  $Res call({int amountMl});
}

/// @nodoc
class _$AddWaterCopyWithImpl<$Res> implements $AddWaterCopyWith<$Res> {
  _$AddWaterCopyWithImpl(this._self, this._then);

  final AddWater _self;
  final $Res Function(AddWater) _then;

  /// Create a copy of WaterEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? amountMl = null,
  }) {
    return _then(AddWater(
      null == amountMl
          ? _self.amountMl
          : amountMl // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc

class DeleteWaterLog implements WaterEvent {
  const DeleteWaterLog(this.id);

  final int id;

  /// Create a copy of WaterEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $DeleteWaterLogCopyWith<DeleteWaterLog> get copyWith =>
      _$DeleteWaterLogCopyWithImpl<DeleteWaterLog>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is DeleteWaterLog &&
            (identical(other.id, id) || other.id == id));
  }

  @override
  int get hashCode => Object.hash(runtimeType, id);

  @override
  String toString() {
    return 'WaterEvent.deleteLog(id: $id)';
  }
}

/// @nodoc
abstract mixin class $DeleteWaterLogCopyWith<$Res>
    implements $WaterEventCopyWith<$Res> {
  factory $DeleteWaterLogCopyWith(
          DeleteWaterLog value, $Res Function(DeleteWaterLog) _then) =
      _$DeleteWaterLogCopyWithImpl;
  @useResult
  $Res call({int id});
}

/// @nodoc
class _$DeleteWaterLogCopyWithImpl<$Res>
    implements $DeleteWaterLogCopyWith<$Res> {
  _$DeleteWaterLogCopyWithImpl(this._self, this._then);

  final DeleteWaterLog _self;
  final $Res Function(DeleteWaterLog) _then;

  /// Create a copy of WaterEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
  }) {
    return _then(DeleteWaterLog(
      null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

// dart format on

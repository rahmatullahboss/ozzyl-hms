// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'exercise_event.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$ExerciseEvent {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is ExerciseEvent);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'ExerciseEvent()';
  }
}

/// @nodoc
class $ExerciseEventCopyWith<$Res> {
  $ExerciseEventCopyWith(ExerciseEvent _, $Res Function(ExerciseEvent) __);
}

/// Adds pattern-matching-related methods to [ExerciseEvent].
extension ExerciseEventPatterns on ExerciseEvent {
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
    TResult Function(LoadExercise value)? load,
    TResult Function(AddExercise value)? add,
    TResult Function(DeleteExercise value)? delete,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadExercise() when load != null:
        return load(_that);
      case AddExercise() when add != null:
        return add(_that);
      case DeleteExercise() when delete != null:
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
    required TResult Function(LoadExercise value) load,
    required TResult Function(AddExercise value) add,
    required TResult Function(DeleteExercise value) delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadExercise():
        return load(_that);
      case AddExercise():
        return add(_that);
      case DeleteExercise():
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
    TResult? Function(LoadExercise value)? load,
    TResult? Function(AddExercise value)? add,
    TResult? Function(DeleteExercise value)? delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadExercise() when load != null:
        return load(_that);
      case AddExercise() when add != null:
        return add(_that);
      case DeleteExercise() when delete != null:
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
    TResult Function(String type, int durationMin, int? calories)? add,
    TResult Function(int id)? delete,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadExercise() when load != null:
        return load();
      case AddExercise() when add != null:
        return add(_that.type, _that.durationMin, _that.calories);
      case DeleteExercise() when delete != null:
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
    required TResult Function(String type, int durationMin, int? calories) add,
    required TResult Function(int id) delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadExercise():
        return load();
      case AddExercise():
        return add(_that.type, _that.durationMin, _that.calories);
      case DeleteExercise():
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
    TResult? Function(String type, int durationMin, int? calories)? add,
    TResult? Function(int id)? delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadExercise() when load != null:
        return load();
      case AddExercise() when add != null:
        return add(_that.type, _that.durationMin, _that.calories);
      case DeleteExercise() when delete != null:
        return delete(_that.id);
      case _:
        return null;
    }
  }
}

/// @nodoc

class LoadExercise implements ExerciseEvent {
  const LoadExercise();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is LoadExercise);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'ExerciseEvent.load()';
  }
}

/// @nodoc

class AddExercise implements ExerciseEvent {
  const AddExercise(
      {required this.type, required this.durationMin, this.calories});

  final String type;
  final int durationMin;
  final int? calories;

  /// Create a copy of ExerciseEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $AddExerciseCopyWith<AddExercise> get copyWith =>
      _$AddExerciseCopyWithImpl<AddExercise>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is AddExercise &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.durationMin, durationMin) ||
                other.durationMin == durationMin) &&
            (identical(other.calories, calories) ||
                other.calories == calories));
  }

  @override
  int get hashCode => Object.hash(runtimeType, type, durationMin, calories);

  @override
  String toString() {
    return 'ExerciseEvent.add(type: $type, durationMin: $durationMin, calories: $calories)';
  }
}

/// @nodoc
abstract mixin class $AddExerciseCopyWith<$Res>
    implements $ExerciseEventCopyWith<$Res> {
  factory $AddExerciseCopyWith(
          AddExercise value, $Res Function(AddExercise) _then) =
      _$AddExerciseCopyWithImpl;
  @useResult
  $Res call({String type, int durationMin, int? calories});
}

/// @nodoc
class _$AddExerciseCopyWithImpl<$Res> implements $AddExerciseCopyWith<$Res> {
  _$AddExerciseCopyWithImpl(this._self, this._then);

  final AddExercise _self;
  final $Res Function(AddExercise) _then;

  /// Create a copy of ExerciseEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? type = null,
    Object? durationMin = null,
    Object? calories = freezed,
  }) {
    return _then(AddExercise(
      type: null == type
          ? _self.type
          : type // ignore: cast_nullable_to_non_nullable
              as String,
      durationMin: null == durationMin
          ? _self.durationMin
          : durationMin // ignore: cast_nullable_to_non_nullable
              as int,
      calories: freezed == calories
          ? _self.calories
          : calories // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// @nodoc

class DeleteExercise implements ExerciseEvent {
  const DeleteExercise(this.id);

  final int id;

  /// Create a copy of ExerciseEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $DeleteExerciseCopyWith<DeleteExercise> get copyWith =>
      _$DeleteExerciseCopyWithImpl<DeleteExercise>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is DeleteExercise &&
            (identical(other.id, id) || other.id == id));
  }

  @override
  int get hashCode => Object.hash(runtimeType, id);

  @override
  String toString() {
    return 'ExerciseEvent.delete(id: $id)';
  }
}

/// @nodoc
abstract mixin class $DeleteExerciseCopyWith<$Res>
    implements $ExerciseEventCopyWith<$Res> {
  factory $DeleteExerciseCopyWith(
          DeleteExercise value, $Res Function(DeleteExercise) _then) =
      _$DeleteExerciseCopyWithImpl;
  @useResult
  $Res call({int id});
}

/// @nodoc
class _$DeleteExerciseCopyWithImpl<$Res>
    implements $DeleteExerciseCopyWith<$Res> {
  _$DeleteExerciseCopyWithImpl(this._self, this._then);

  final DeleteExercise _self;
  final $Res Function(DeleteExercise) _then;

  /// Create a copy of ExerciseEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
  }) {
    return _then(DeleteExercise(
      null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

// dart format on

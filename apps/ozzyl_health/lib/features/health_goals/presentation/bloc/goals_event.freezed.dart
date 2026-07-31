// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'goals_event.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$GoalsEvent {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is GoalsEvent);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'GoalsEvent()';
  }
}

/// @nodoc
class $GoalsEventCopyWith<$Res> {
  $GoalsEventCopyWith(GoalsEvent _, $Res Function(GoalsEvent) __);
}

/// Adds pattern-matching-related methods to [GoalsEvent].
extension GoalsEventPatterns on GoalsEvent {
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
    TResult Function(LoadGoals value)? load,
    TResult Function(AddGoal value)? add,
    TResult Function(UpdateGoalProgress value)? updateProgress,
    TResult Function(DeleteGoal value)? delete,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadGoals() when load != null:
        return load(_that);
      case AddGoal() when add != null:
        return add(_that);
      case UpdateGoalProgress() when updateProgress != null:
        return updateProgress(_that);
      case DeleteGoal() when delete != null:
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
    required TResult Function(LoadGoals value) load,
    required TResult Function(AddGoal value) add,
    required TResult Function(UpdateGoalProgress value) updateProgress,
    required TResult Function(DeleteGoal value) delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadGoals():
        return load(_that);
      case AddGoal():
        return add(_that);
      case UpdateGoalProgress():
        return updateProgress(_that);
      case DeleteGoal():
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
    TResult? Function(LoadGoals value)? load,
    TResult? Function(AddGoal value)? add,
    TResult? Function(UpdateGoalProgress value)? updateProgress,
    TResult? Function(DeleteGoal value)? delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadGoals() when load != null:
        return load(_that);
      case AddGoal() when add != null:
        return add(_that);
      case UpdateGoalProgress() when updateProgress != null:
        return updateProgress(_that);
      case DeleteGoal() when delete != null:
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
    TResult Function(
            String title, double target, String unit, DateTime? deadline)?
        add,
    TResult Function(int id, double current)? updateProgress,
    TResult Function(int id)? delete,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadGoals() when load != null:
        return load();
      case AddGoal() when add != null:
        return add(_that.title, _that.target, _that.unit, _that.deadline);
      case UpdateGoalProgress() when updateProgress != null:
        return updateProgress(_that.id, _that.current);
      case DeleteGoal() when delete != null:
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
    required TResult Function(
            String title, double target, String unit, DateTime? deadline)
        add,
    required TResult Function(int id, double current) updateProgress,
    required TResult Function(int id) delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadGoals():
        return load();
      case AddGoal():
        return add(_that.title, _that.target, _that.unit, _that.deadline);
      case UpdateGoalProgress():
        return updateProgress(_that.id, _that.current);
      case DeleteGoal():
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
    TResult? Function(
            String title, double target, String unit, DateTime? deadline)?
        add,
    TResult? Function(int id, double current)? updateProgress,
    TResult? Function(int id)? delete,
  }) {
    final _that = this;
    switch (_that) {
      case LoadGoals() when load != null:
        return load();
      case AddGoal() when add != null:
        return add(_that.title, _that.target, _that.unit, _that.deadline);
      case UpdateGoalProgress() when updateProgress != null:
        return updateProgress(_that.id, _that.current);
      case DeleteGoal() when delete != null:
        return delete(_that.id);
      case _:
        return null;
    }
  }
}

/// @nodoc

class LoadGoals implements GoalsEvent {
  const LoadGoals();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is LoadGoals);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'GoalsEvent.load()';
  }
}

/// @nodoc

class AddGoal implements GoalsEvent {
  const AddGoal(
      {required this.title,
      required this.target,
      required this.unit,
      this.deadline});

  final String title;
  final double target;
  final String unit;
  final DateTime? deadline;

  /// Create a copy of GoalsEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $AddGoalCopyWith<AddGoal> get copyWith =>
      _$AddGoalCopyWithImpl<AddGoal>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is AddGoal &&
            (identical(other.title, title) || other.title == title) &&
            (identical(other.target, target) || other.target == target) &&
            (identical(other.unit, unit) || other.unit == unit) &&
            (identical(other.deadline, deadline) ||
                other.deadline == deadline));
  }

  @override
  int get hashCode => Object.hash(runtimeType, title, target, unit, deadline);

  @override
  String toString() {
    return 'GoalsEvent.add(title: $title, target: $target, unit: $unit, deadline: $deadline)';
  }
}

/// @nodoc
abstract mixin class $AddGoalCopyWith<$Res>
    implements $GoalsEventCopyWith<$Res> {
  factory $AddGoalCopyWith(AddGoal value, $Res Function(AddGoal) _then) =
      _$AddGoalCopyWithImpl;
  @useResult
  $Res call({String title, double target, String unit, DateTime? deadline});
}

/// @nodoc
class _$AddGoalCopyWithImpl<$Res> implements $AddGoalCopyWith<$Res> {
  _$AddGoalCopyWithImpl(this._self, this._then);

  final AddGoal _self;
  final $Res Function(AddGoal) _then;

  /// Create a copy of GoalsEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? title = null,
    Object? target = null,
    Object? unit = null,
    Object? deadline = freezed,
  }) {
    return _then(AddGoal(
      title: null == title
          ? _self.title
          : title // ignore: cast_nullable_to_non_nullable
              as String,
      target: null == target
          ? _self.target
          : target // ignore: cast_nullable_to_non_nullable
              as double,
      unit: null == unit
          ? _self.unit
          : unit // ignore: cast_nullable_to_non_nullable
              as String,
      deadline: freezed == deadline
          ? _self.deadline
          : deadline // ignore: cast_nullable_to_non_nullable
              as DateTime?,
    ));
  }
}

/// @nodoc

class UpdateGoalProgress implements GoalsEvent {
  const UpdateGoalProgress({required this.id, required this.current});

  final int id;
  final double current;

  /// Create a copy of GoalsEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $UpdateGoalProgressCopyWith<UpdateGoalProgress> get copyWith =>
      _$UpdateGoalProgressCopyWithImpl<UpdateGoalProgress>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is UpdateGoalProgress &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.current, current) || other.current == current));
  }

  @override
  int get hashCode => Object.hash(runtimeType, id, current);

  @override
  String toString() {
    return 'GoalsEvent.updateProgress(id: $id, current: $current)';
  }
}

/// @nodoc
abstract mixin class $UpdateGoalProgressCopyWith<$Res>
    implements $GoalsEventCopyWith<$Res> {
  factory $UpdateGoalProgressCopyWith(
          UpdateGoalProgress value, $Res Function(UpdateGoalProgress) _then) =
      _$UpdateGoalProgressCopyWithImpl;
  @useResult
  $Res call({int id, double current});
}

/// @nodoc
class _$UpdateGoalProgressCopyWithImpl<$Res>
    implements $UpdateGoalProgressCopyWith<$Res> {
  _$UpdateGoalProgressCopyWithImpl(this._self, this._then);

  final UpdateGoalProgress _self;
  final $Res Function(UpdateGoalProgress) _then;

  /// Create a copy of GoalsEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
    Object? current = null,
  }) {
    return _then(UpdateGoalProgress(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as int,
      current: null == current
          ? _self.current
          : current // ignore: cast_nullable_to_non_nullable
              as double,
    ));
  }
}

/// @nodoc

class DeleteGoal implements GoalsEvent {
  const DeleteGoal(this.id);

  final int id;

  /// Create a copy of GoalsEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $DeleteGoalCopyWith<DeleteGoal> get copyWith =>
      _$DeleteGoalCopyWithImpl<DeleteGoal>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is DeleteGoal &&
            (identical(other.id, id) || other.id == id));
  }

  @override
  int get hashCode => Object.hash(runtimeType, id);

  @override
  String toString() {
    return 'GoalsEvent.delete(id: $id)';
  }
}

/// @nodoc
abstract mixin class $DeleteGoalCopyWith<$Res>
    implements $GoalsEventCopyWith<$Res> {
  factory $DeleteGoalCopyWith(
          DeleteGoal value, $Res Function(DeleteGoal) _then) =
      _$DeleteGoalCopyWithImpl;
  @useResult
  $Res call({int id});
}

/// @nodoc
class _$DeleteGoalCopyWithImpl<$Res> implements $DeleteGoalCopyWith<$Res> {
  _$DeleteGoalCopyWithImpl(this._self, this._then);

  final DeleteGoal _self;
  final $Res Function(DeleteGoal) _then;

  /// Create a copy of GoalsEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
  }) {
    return _then(DeleteGoal(
      null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

// dart format on

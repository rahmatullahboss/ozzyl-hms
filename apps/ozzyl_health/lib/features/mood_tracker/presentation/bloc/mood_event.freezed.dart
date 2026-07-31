// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'mood_event.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$MoodEvent {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is MoodEvent);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'MoodEvent()';
  }
}

/// @nodoc
class $MoodEventCopyWith<$Res> {
  $MoodEventCopyWith(MoodEvent _, $Res Function(MoodEvent) __);
}

/// Adds pattern-matching-related methods to [MoodEvent].
extension MoodEventPatterns on MoodEvent {
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
    TResult Function(LoadMoodEntries value)? loadEntries,
    TResult Function(AddMoodEntry value)? addEntry,
    TResult Function(DeleteMoodEntry value)? deleteEntry,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadMoodEntries() when loadEntries != null:
        return loadEntries(_that);
      case AddMoodEntry() when addEntry != null:
        return addEntry(_that);
      case DeleteMoodEntry() when deleteEntry != null:
        return deleteEntry(_that);
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
    required TResult Function(LoadMoodEntries value) loadEntries,
    required TResult Function(AddMoodEntry value) addEntry,
    required TResult Function(DeleteMoodEntry value) deleteEntry,
  }) {
    final _that = this;
    switch (_that) {
      case LoadMoodEntries():
        return loadEntries(_that);
      case AddMoodEntry():
        return addEntry(_that);
      case DeleteMoodEntry():
        return deleteEntry(_that);
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
    TResult? Function(LoadMoodEntries value)? loadEntries,
    TResult? Function(AddMoodEntry value)? addEntry,
    TResult? Function(DeleteMoodEntry value)? deleteEntry,
  }) {
    final _that = this;
    switch (_that) {
      case LoadMoodEntries() when loadEntries != null:
        return loadEntries(_that);
      case AddMoodEntry() when addEntry != null:
        return addEntry(_that);
      case DeleteMoodEntry() when deleteEntry != null:
        return deleteEntry(_that);
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
    TResult Function(DateTime? from, DateTime? to)? loadEntries,
    TResult Function(int moodLevel, String? notes, String? tags)? addEntry,
    TResult Function(int id)? deleteEntry,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case LoadMoodEntries() when loadEntries != null:
        return loadEntries(_that.from, _that.to);
      case AddMoodEntry() when addEntry != null:
        return addEntry(_that.moodLevel, _that.notes, _that.tags);
      case DeleteMoodEntry() when deleteEntry != null:
        return deleteEntry(_that.id);
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
    required TResult Function(DateTime? from, DateTime? to) loadEntries,
    required TResult Function(int moodLevel, String? notes, String? tags)
        addEntry,
    required TResult Function(int id) deleteEntry,
  }) {
    final _that = this;
    switch (_that) {
      case LoadMoodEntries():
        return loadEntries(_that.from, _that.to);
      case AddMoodEntry():
        return addEntry(_that.moodLevel, _that.notes, _that.tags);
      case DeleteMoodEntry():
        return deleteEntry(_that.id);
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
    TResult? Function(DateTime? from, DateTime? to)? loadEntries,
    TResult? Function(int moodLevel, String? notes, String? tags)? addEntry,
    TResult? Function(int id)? deleteEntry,
  }) {
    final _that = this;
    switch (_that) {
      case LoadMoodEntries() when loadEntries != null:
        return loadEntries(_that.from, _that.to);
      case AddMoodEntry() when addEntry != null:
        return addEntry(_that.moodLevel, _that.notes, _that.tags);
      case DeleteMoodEntry() when deleteEntry != null:
        return deleteEntry(_that.id);
      case _:
        return null;
    }
  }
}

/// @nodoc

class LoadMoodEntries implements MoodEvent {
  const LoadMoodEntries({this.from, this.to});

  final DateTime? from;
  final DateTime? to;

  /// Create a copy of MoodEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $LoadMoodEntriesCopyWith<LoadMoodEntries> get copyWith =>
      _$LoadMoodEntriesCopyWithImpl<LoadMoodEntries>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is LoadMoodEntries &&
            (identical(other.from, from) || other.from == from) &&
            (identical(other.to, to) || other.to == to));
  }

  @override
  int get hashCode => Object.hash(runtimeType, from, to);

  @override
  String toString() {
    return 'MoodEvent.loadEntries(from: $from, to: $to)';
  }
}

/// @nodoc
abstract mixin class $LoadMoodEntriesCopyWith<$Res>
    implements $MoodEventCopyWith<$Res> {
  factory $LoadMoodEntriesCopyWith(
          LoadMoodEntries value, $Res Function(LoadMoodEntries) _then) =
      _$LoadMoodEntriesCopyWithImpl;
  @useResult
  $Res call({DateTime? from, DateTime? to});
}

/// @nodoc
class _$LoadMoodEntriesCopyWithImpl<$Res>
    implements $LoadMoodEntriesCopyWith<$Res> {
  _$LoadMoodEntriesCopyWithImpl(this._self, this._then);

  final LoadMoodEntries _self;
  final $Res Function(LoadMoodEntries) _then;

  /// Create a copy of MoodEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? from = freezed,
    Object? to = freezed,
  }) {
    return _then(LoadMoodEntries(
      from: freezed == from
          ? _self.from
          : from // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      to: freezed == to
          ? _self.to
          : to // ignore: cast_nullable_to_non_nullable
              as DateTime?,
    ));
  }
}

/// @nodoc

class AddMoodEntry implements MoodEvent {
  const AddMoodEntry({required this.moodLevel, this.notes, this.tags});

  final int moodLevel;
  final String? notes;
  final String? tags;

  /// Create a copy of MoodEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $AddMoodEntryCopyWith<AddMoodEntry> get copyWith =>
      _$AddMoodEntryCopyWithImpl<AddMoodEntry>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is AddMoodEntry &&
            (identical(other.moodLevel, moodLevel) ||
                other.moodLevel == moodLevel) &&
            (identical(other.notes, notes) || other.notes == notes) &&
            (identical(other.tags, tags) || other.tags == tags));
  }

  @override
  int get hashCode => Object.hash(runtimeType, moodLevel, notes, tags);

  @override
  String toString() {
    return 'MoodEvent.addEntry(moodLevel: $moodLevel, notes: $notes, tags: $tags)';
  }
}

/// @nodoc
abstract mixin class $AddMoodEntryCopyWith<$Res>
    implements $MoodEventCopyWith<$Res> {
  factory $AddMoodEntryCopyWith(
          AddMoodEntry value, $Res Function(AddMoodEntry) _then) =
      _$AddMoodEntryCopyWithImpl;
  @useResult
  $Res call({int moodLevel, String? notes, String? tags});
}

/// @nodoc
class _$AddMoodEntryCopyWithImpl<$Res> implements $AddMoodEntryCopyWith<$Res> {
  _$AddMoodEntryCopyWithImpl(this._self, this._then);

  final AddMoodEntry _self;
  final $Res Function(AddMoodEntry) _then;

  /// Create a copy of MoodEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? moodLevel = null,
    Object? notes = freezed,
    Object? tags = freezed,
  }) {
    return _then(AddMoodEntry(
      moodLevel: null == moodLevel
          ? _self.moodLevel
          : moodLevel // ignore: cast_nullable_to_non_nullable
              as int,
      notes: freezed == notes
          ? _self.notes
          : notes // ignore: cast_nullable_to_non_nullable
              as String?,
      tags: freezed == tags
          ? _self.tags
          : tags // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class DeleteMoodEntry implements MoodEvent {
  const DeleteMoodEntry(this.id);

  final int id;

  /// Create a copy of MoodEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $DeleteMoodEntryCopyWith<DeleteMoodEntry> get copyWith =>
      _$DeleteMoodEntryCopyWithImpl<DeleteMoodEntry>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is DeleteMoodEntry &&
            (identical(other.id, id) || other.id == id));
  }

  @override
  int get hashCode => Object.hash(runtimeType, id);

  @override
  String toString() {
    return 'MoodEvent.deleteEntry(id: $id)';
  }
}

/// @nodoc
abstract mixin class $DeleteMoodEntryCopyWith<$Res>
    implements $MoodEventCopyWith<$Res> {
  factory $DeleteMoodEntryCopyWith(
          DeleteMoodEntry value, $Res Function(DeleteMoodEntry) _then) =
      _$DeleteMoodEntryCopyWithImpl;
  @useResult
  $Res call({int id});
}

/// @nodoc
class _$DeleteMoodEntryCopyWithImpl<$Res>
    implements $DeleteMoodEntryCopyWith<$Res> {
  _$DeleteMoodEntryCopyWithImpl(this._self, this._then);

  final DeleteMoodEntry _self;
  final $Res Function(DeleteMoodEntry) _then;

  /// Create a copy of MoodEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
  }) {
    return _then(DeleteMoodEntry(
      null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

// dart format on

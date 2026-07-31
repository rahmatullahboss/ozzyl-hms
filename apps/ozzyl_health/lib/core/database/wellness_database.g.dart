// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wellness_database.dart';

// ignore_for_file: type=lint
class $MoodEntriesTable extends MoodEntries
    with TableInfo<$MoodEntriesTable, MoodEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MoodEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _timestampMeta =
      const VerificationMeta('timestamp');
  @override
  late final GeneratedColumn<DateTime> timestamp = GeneratedColumn<DateTime>(
      'timestamp', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  static const VerificationMeta _moodLevelMeta =
      const VerificationMeta('moodLevel');
  @override
  late final GeneratedColumn<int> moodLevel = GeneratedColumn<int>(
      'mood_level', aliasedName, false,
      check: () => ComparableExpr(moodLevel).isBetweenValues(1, 5),
      type: DriftSqlType.int,
      requiredDuringInsert: true);
  static const VerificationMeta _notesMeta = const VerificationMeta('notes');
  @override
  late final GeneratedColumn<String> notes = GeneratedColumn<String>(
      'notes', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _tagsMeta = const VerificationMeta('tags');
  @override
  late final GeneratedColumn<String> tags = GeneratedColumn<String>(
      'tags', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [id, timestamp, moodLevel, notes, tags];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'mood_entries';
  @override
  VerificationContext validateIntegrity(Insertable<MoodEntry> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('timestamp')) {
      context.handle(_timestampMeta,
          timestamp.isAcceptableOrUnknown(data['timestamp']!, _timestampMeta));
    }
    if (data.containsKey('mood_level')) {
      context.handle(_moodLevelMeta,
          moodLevel.isAcceptableOrUnknown(data['mood_level']!, _moodLevelMeta));
    } else if (isInserting) {
      context.missing(_moodLevelMeta);
    }
    if (data.containsKey('notes')) {
      context.handle(
          _notesMeta, notes.isAcceptableOrUnknown(data['notes']!, _notesMeta));
    }
    if (data.containsKey('tags')) {
      context.handle(
          _tagsMeta, tags.isAcceptableOrUnknown(data['tags']!, _tagsMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  MoodEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MoodEntry(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      timestamp: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}timestamp'])!,
      moodLevel: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}mood_level'])!,
      notes: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}notes']),
      tags: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}tags']),
    );
  }

  @override
  $MoodEntriesTable createAlias(String alias) {
    return $MoodEntriesTable(attachedDatabase, alias);
  }
}

class MoodEntry extends DataClass implements Insertable<MoodEntry> {
  final int id;
  final DateTime timestamp;
  final int moodLevel;
  final String? notes;
  final String? tags;
  const MoodEntry(
      {required this.id,
      required this.timestamp,
      required this.moodLevel,
      this.notes,
      this.tags});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['timestamp'] = Variable<DateTime>(timestamp);
    map['mood_level'] = Variable<int>(moodLevel);
    if (!nullToAbsent || notes != null) {
      map['notes'] = Variable<String>(notes);
    }
    if (!nullToAbsent || tags != null) {
      map['tags'] = Variable<String>(tags);
    }
    return map;
  }

  MoodEntriesCompanion toCompanion(bool nullToAbsent) {
    return MoodEntriesCompanion(
      id: Value(id),
      timestamp: Value(timestamp),
      moodLevel: Value(moodLevel),
      notes:
          notes == null && nullToAbsent ? const Value.absent() : Value(notes),
      tags: tags == null && nullToAbsent ? const Value.absent() : Value(tags),
    );
  }

  factory MoodEntry.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MoodEntry(
      id: serializer.fromJson<int>(json['id']),
      timestamp: serializer.fromJson<DateTime>(json['timestamp']),
      moodLevel: serializer.fromJson<int>(json['moodLevel']),
      notes: serializer.fromJson<String?>(json['notes']),
      tags: serializer.fromJson<String?>(json['tags']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'timestamp': serializer.toJson<DateTime>(timestamp),
      'moodLevel': serializer.toJson<int>(moodLevel),
      'notes': serializer.toJson<String?>(notes),
      'tags': serializer.toJson<String?>(tags),
    };
  }

  MoodEntry copyWith(
          {int? id,
          DateTime? timestamp,
          int? moodLevel,
          Value<String?> notes = const Value.absent(),
          Value<String?> tags = const Value.absent()}) =>
      MoodEntry(
        id: id ?? this.id,
        timestamp: timestamp ?? this.timestamp,
        moodLevel: moodLevel ?? this.moodLevel,
        notes: notes.present ? notes.value : this.notes,
        tags: tags.present ? tags.value : this.tags,
      );
  MoodEntry copyWithCompanion(MoodEntriesCompanion data) {
    return MoodEntry(
      id: data.id.present ? data.id.value : this.id,
      timestamp: data.timestamp.present ? data.timestamp.value : this.timestamp,
      moodLevel: data.moodLevel.present ? data.moodLevel.value : this.moodLevel,
      notes: data.notes.present ? data.notes.value : this.notes,
      tags: data.tags.present ? data.tags.value : this.tags,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MoodEntry(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('moodLevel: $moodLevel, ')
          ..write('notes: $notes, ')
          ..write('tags: $tags')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, timestamp, moodLevel, notes, tags);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MoodEntry &&
          other.id == this.id &&
          other.timestamp == this.timestamp &&
          other.moodLevel == this.moodLevel &&
          other.notes == this.notes &&
          other.tags == this.tags);
}

class MoodEntriesCompanion extends UpdateCompanion<MoodEntry> {
  final Value<int> id;
  final Value<DateTime> timestamp;
  final Value<int> moodLevel;
  final Value<String?> notes;
  final Value<String?> tags;
  const MoodEntriesCompanion({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    this.moodLevel = const Value.absent(),
    this.notes = const Value.absent(),
    this.tags = const Value.absent(),
  });
  MoodEntriesCompanion.insert({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    required int moodLevel,
    this.notes = const Value.absent(),
    this.tags = const Value.absent(),
  }) : moodLevel = Value(moodLevel);
  static Insertable<MoodEntry> custom({
    Expression<int>? id,
    Expression<DateTime>? timestamp,
    Expression<int>? moodLevel,
    Expression<String>? notes,
    Expression<String>? tags,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (timestamp != null) 'timestamp': timestamp,
      if (moodLevel != null) 'mood_level': moodLevel,
      if (notes != null) 'notes': notes,
      if (tags != null) 'tags': tags,
    });
  }

  MoodEntriesCompanion copyWith(
      {Value<int>? id,
      Value<DateTime>? timestamp,
      Value<int>? moodLevel,
      Value<String?>? notes,
      Value<String?>? tags}) {
    return MoodEntriesCompanion(
      id: id ?? this.id,
      timestamp: timestamp ?? this.timestamp,
      moodLevel: moodLevel ?? this.moodLevel,
      notes: notes ?? this.notes,
      tags: tags ?? this.tags,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (timestamp.present) {
      map['timestamp'] = Variable<DateTime>(timestamp.value);
    }
    if (moodLevel.present) {
      map['mood_level'] = Variable<int>(moodLevel.value);
    }
    if (notes.present) {
      map['notes'] = Variable<String>(notes.value);
    }
    if (tags.present) {
      map['tags'] = Variable<String>(tags.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MoodEntriesCompanion(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('moodLevel: $moodLevel, ')
          ..write('notes: $notes, ')
          ..write('tags: $tags')
          ..write(')'))
        .toString();
  }
}

class $WaterLogsTable extends WaterLogs
    with TableInfo<$WaterLogsTable, WaterLog> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $WaterLogsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _timestampMeta =
      const VerificationMeta('timestamp');
  @override
  late final GeneratedColumn<DateTime> timestamp = GeneratedColumn<DateTime>(
      'timestamp', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  static const VerificationMeta _amountMlMeta =
      const VerificationMeta('amountMl');
  @override
  late final GeneratedColumn<int> amountMl = GeneratedColumn<int>(
      'amount_ml', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [id, timestamp, amountMl];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'water_logs';
  @override
  VerificationContext validateIntegrity(Insertable<WaterLog> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('timestamp')) {
      context.handle(_timestampMeta,
          timestamp.isAcceptableOrUnknown(data['timestamp']!, _timestampMeta));
    }
    if (data.containsKey('amount_ml')) {
      context.handle(_amountMlMeta,
          amountMl.isAcceptableOrUnknown(data['amount_ml']!, _amountMlMeta));
    } else if (isInserting) {
      context.missing(_amountMlMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  WaterLog map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return WaterLog(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      timestamp: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}timestamp'])!,
      amountMl: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}amount_ml'])!,
    );
  }

  @override
  $WaterLogsTable createAlias(String alias) {
    return $WaterLogsTable(attachedDatabase, alias);
  }
}

class WaterLog extends DataClass implements Insertable<WaterLog> {
  final int id;
  final DateTime timestamp;
  final int amountMl;
  const WaterLog(
      {required this.id, required this.timestamp, required this.amountMl});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['timestamp'] = Variable<DateTime>(timestamp);
    map['amount_ml'] = Variable<int>(amountMl);
    return map;
  }

  WaterLogsCompanion toCompanion(bool nullToAbsent) {
    return WaterLogsCompanion(
      id: Value(id),
      timestamp: Value(timestamp),
      amountMl: Value(amountMl),
    );
  }

  factory WaterLog.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return WaterLog(
      id: serializer.fromJson<int>(json['id']),
      timestamp: serializer.fromJson<DateTime>(json['timestamp']),
      amountMl: serializer.fromJson<int>(json['amountMl']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'timestamp': serializer.toJson<DateTime>(timestamp),
      'amountMl': serializer.toJson<int>(amountMl),
    };
  }

  WaterLog copyWith({int? id, DateTime? timestamp, int? amountMl}) => WaterLog(
        id: id ?? this.id,
        timestamp: timestamp ?? this.timestamp,
        amountMl: amountMl ?? this.amountMl,
      );
  WaterLog copyWithCompanion(WaterLogsCompanion data) {
    return WaterLog(
      id: data.id.present ? data.id.value : this.id,
      timestamp: data.timestamp.present ? data.timestamp.value : this.timestamp,
      amountMl: data.amountMl.present ? data.amountMl.value : this.amountMl,
    );
  }

  @override
  String toString() {
    return (StringBuffer('WaterLog(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('amountMl: $amountMl')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, timestamp, amountMl);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is WaterLog &&
          other.id == this.id &&
          other.timestamp == this.timestamp &&
          other.amountMl == this.amountMl);
}

class WaterLogsCompanion extends UpdateCompanion<WaterLog> {
  final Value<int> id;
  final Value<DateTime> timestamp;
  final Value<int> amountMl;
  const WaterLogsCompanion({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    this.amountMl = const Value.absent(),
  });
  WaterLogsCompanion.insert({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    required int amountMl,
  }) : amountMl = Value(amountMl);
  static Insertable<WaterLog> custom({
    Expression<int>? id,
    Expression<DateTime>? timestamp,
    Expression<int>? amountMl,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (timestamp != null) 'timestamp': timestamp,
      if (amountMl != null) 'amount_ml': amountMl,
    });
  }

  WaterLogsCompanion copyWith(
      {Value<int>? id, Value<DateTime>? timestamp, Value<int>? amountMl}) {
    return WaterLogsCompanion(
      id: id ?? this.id,
      timestamp: timestamp ?? this.timestamp,
      amountMl: amountMl ?? this.amountMl,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (timestamp.present) {
      map['timestamp'] = Variable<DateTime>(timestamp.value);
    }
    if (amountMl.present) {
      map['amount_ml'] = Variable<int>(amountMl.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('WaterLogsCompanion(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('amountMl: $amountMl')
          ..write(')'))
        .toString();
  }
}

class $SleepLogsTable extends SleepLogs
    with TableInfo<$SleepLogsTable, SleepLog> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SleepLogsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _dateMeta = const VerificationMeta('date');
  @override
  late final GeneratedColumn<DateTime> date = GeneratedColumn<DateTime>(
      'date', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _bedtimeMeta =
      const VerificationMeta('bedtime');
  @override
  late final GeneratedColumn<DateTime> bedtime = GeneratedColumn<DateTime>(
      'bedtime', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _wakeTimeMeta =
      const VerificationMeta('wakeTime');
  @override
  late final GeneratedColumn<DateTime> wakeTime = GeneratedColumn<DateTime>(
      'wake_time', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _qualityMeta =
      const VerificationMeta('quality');
  @override
  late final GeneratedColumn<int> quality = GeneratedColumn<int>(
      'quality', aliasedName, true,
      check: () => ComparableExpr(quality).isBetweenValues(1, 5),
      type: DriftSqlType.int,
      requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [id, date, bedtime, wakeTime, quality];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sleep_logs';
  @override
  VerificationContext validateIntegrity(Insertable<SleepLog> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('date')) {
      context.handle(
          _dateMeta, date.isAcceptableOrUnknown(data['date']!, _dateMeta));
    } else if (isInserting) {
      context.missing(_dateMeta);
    }
    if (data.containsKey('bedtime')) {
      context.handle(_bedtimeMeta,
          bedtime.isAcceptableOrUnknown(data['bedtime']!, _bedtimeMeta));
    } else if (isInserting) {
      context.missing(_bedtimeMeta);
    }
    if (data.containsKey('wake_time')) {
      context.handle(_wakeTimeMeta,
          wakeTime.isAcceptableOrUnknown(data['wake_time']!, _wakeTimeMeta));
    } else if (isInserting) {
      context.missing(_wakeTimeMeta);
    }
    if (data.containsKey('quality')) {
      context.handle(_qualityMeta,
          quality.isAcceptableOrUnknown(data['quality']!, _qualityMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  SleepLog map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SleepLog(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      date: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}date'])!,
      bedtime: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}bedtime'])!,
      wakeTime: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}wake_time'])!,
      quality: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}quality']),
    );
  }

  @override
  $SleepLogsTable createAlias(String alias) {
    return $SleepLogsTable(attachedDatabase, alias);
  }
}

class SleepLog extends DataClass implements Insertable<SleepLog> {
  final int id;
  final DateTime date;
  final DateTime bedtime;
  final DateTime wakeTime;
  final int? quality;
  const SleepLog(
      {required this.id,
      required this.date,
      required this.bedtime,
      required this.wakeTime,
      this.quality});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['date'] = Variable<DateTime>(date);
    map['bedtime'] = Variable<DateTime>(bedtime);
    map['wake_time'] = Variable<DateTime>(wakeTime);
    if (!nullToAbsent || quality != null) {
      map['quality'] = Variable<int>(quality);
    }
    return map;
  }

  SleepLogsCompanion toCompanion(bool nullToAbsent) {
    return SleepLogsCompanion(
      id: Value(id),
      date: Value(date),
      bedtime: Value(bedtime),
      wakeTime: Value(wakeTime),
      quality: quality == null && nullToAbsent
          ? const Value.absent()
          : Value(quality),
    );
  }

  factory SleepLog.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SleepLog(
      id: serializer.fromJson<int>(json['id']),
      date: serializer.fromJson<DateTime>(json['date']),
      bedtime: serializer.fromJson<DateTime>(json['bedtime']),
      wakeTime: serializer.fromJson<DateTime>(json['wakeTime']),
      quality: serializer.fromJson<int?>(json['quality']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'date': serializer.toJson<DateTime>(date),
      'bedtime': serializer.toJson<DateTime>(bedtime),
      'wakeTime': serializer.toJson<DateTime>(wakeTime),
      'quality': serializer.toJson<int?>(quality),
    };
  }

  SleepLog copyWith(
          {int? id,
          DateTime? date,
          DateTime? bedtime,
          DateTime? wakeTime,
          Value<int?> quality = const Value.absent()}) =>
      SleepLog(
        id: id ?? this.id,
        date: date ?? this.date,
        bedtime: bedtime ?? this.bedtime,
        wakeTime: wakeTime ?? this.wakeTime,
        quality: quality.present ? quality.value : this.quality,
      );
  SleepLog copyWithCompanion(SleepLogsCompanion data) {
    return SleepLog(
      id: data.id.present ? data.id.value : this.id,
      date: data.date.present ? data.date.value : this.date,
      bedtime: data.bedtime.present ? data.bedtime.value : this.bedtime,
      wakeTime: data.wakeTime.present ? data.wakeTime.value : this.wakeTime,
      quality: data.quality.present ? data.quality.value : this.quality,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SleepLog(')
          ..write('id: $id, ')
          ..write('date: $date, ')
          ..write('bedtime: $bedtime, ')
          ..write('wakeTime: $wakeTime, ')
          ..write('quality: $quality')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, date, bedtime, wakeTime, quality);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SleepLog &&
          other.id == this.id &&
          other.date == this.date &&
          other.bedtime == this.bedtime &&
          other.wakeTime == this.wakeTime &&
          other.quality == this.quality);
}

class SleepLogsCompanion extends UpdateCompanion<SleepLog> {
  final Value<int> id;
  final Value<DateTime> date;
  final Value<DateTime> bedtime;
  final Value<DateTime> wakeTime;
  final Value<int?> quality;
  const SleepLogsCompanion({
    this.id = const Value.absent(),
    this.date = const Value.absent(),
    this.bedtime = const Value.absent(),
    this.wakeTime = const Value.absent(),
    this.quality = const Value.absent(),
  });
  SleepLogsCompanion.insert({
    this.id = const Value.absent(),
    required DateTime date,
    required DateTime bedtime,
    required DateTime wakeTime,
    this.quality = const Value.absent(),
  })  : date = Value(date),
        bedtime = Value(bedtime),
        wakeTime = Value(wakeTime);
  static Insertable<SleepLog> custom({
    Expression<int>? id,
    Expression<DateTime>? date,
    Expression<DateTime>? bedtime,
    Expression<DateTime>? wakeTime,
    Expression<int>? quality,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (date != null) 'date': date,
      if (bedtime != null) 'bedtime': bedtime,
      if (wakeTime != null) 'wake_time': wakeTime,
      if (quality != null) 'quality': quality,
    });
  }

  SleepLogsCompanion copyWith(
      {Value<int>? id,
      Value<DateTime>? date,
      Value<DateTime>? bedtime,
      Value<DateTime>? wakeTime,
      Value<int?>? quality}) {
    return SleepLogsCompanion(
      id: id ?? this.id,
      date: date ?? this.date,
      bedtime: bedtime ?? this.bedtime,
      wakeTime: wakeTime ?? this.wakeTime,
      quality: quality ?? this.quality,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (date.present) {
      map['date'] = Variable<DateTime>(date.value);
    }
    if (bedtime.present) {
      map['bedtime'] = Variable<DateTime>(bedtime.value);
    }
    if (wakeTime.present) {
      map['wake_time'] = Variable<DateTime>(wakeTime.value);
    }
    if (quality.present) {
      map['quality'] = Variable<int>(quality.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SleepLogsCompanion(')
          ..write('id: $id, ')
          ..write('date: $date, ')
          ..write('bedtime: $bedtime, ')
          ..write('wakeTime: $wakeTime, ')
          ..write('quality: $quality')
          ..write(')'))
        .toString();
  }
}

class $ExerciseLogsTable extends ExerciseLogs
    with TableInfo<$ExerciseLogsTable, ExerciseLog> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ExerciseLogsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _timestampMeta =
      const VerificationMeta('timestamp');
  @override
  late final GeneratedColumn<DateTime> timestamp = GeneratedColumn<DateTime>(
      'timestamp', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
      'type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _durationMinMeta =
      const VerificationMeta('durationMin');
  @override
  late final GeneratedColumn<int> durationMin = GeneratedColumn<int>(
      'duration_min', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _caloriesMeta =
      const VerificationMeta('calories');
  @override
  late final GeneratedColumn<int> calories = GeneratedColumn<int>(
      'calories', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns =>
      [id, timestamp, type, durationMin, calories];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'exercise_logs';
  @override
  VerificationContext validateIntegrity(Insertable<ExerciseLog> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('timestamp')) {
      context.handle(_timestampMeta,
          timestamp.isAcceptableOrUnknown(data['timestamp']!, _timestampMeta));
    }
    if (data.containsKey('type')) {
      context.handle(
          _typeMeta, type.isAcceptableOrUnknown(data['type']!, _typeMeta));
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('duration_min')) {
      context.handle(
          _durationMinMeta,
          durationMin.isAcceptableOrUnknown(
              data['duration_min']!, _durationMinMeta));
    } else if (isInserting) {
      context.missing(_durationMinMeta);
    }
    if (data.containsKey('calories')) {
      context.handle(_caloriesMeta,
          calories.isAcceptableOrUnknown(data['calories']!, _caloriesMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  ExerciseLog map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ExerciseLog(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      timestamp: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}timestamp'])!,
      type: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}type'])!,
      durationMin: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}duration_min'])!,
      calories: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}calories']),
    );
  }

  @override
  $ExerciseLogsTable createAlias(String alias) {
    return $ExerciseLogsTable(attachedDatabase, alias);
  }
}

class ExerciseLog extends DataClass implements Insertable<ExerciseLog> {
  final int id;
  final DateTime timestamp;
  final String type;
  final int durationMin;
  final int? calories;
  const ExerciseLog(
      {required this.id,
      required this.timestamp,
      required this.type,
      required this.durationMin,
      this.calories});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['timestamp'] = Variable<DateTime>(timestamp);
    map['type'] = Variable<String>(type);
    map['duration_min'] = Variable<int>(durationMin);
    if (!nullToAbsent || calories != null) {
      map['calories'] = Variable<int>(calories);
    }
    return map;
  }

  ExerciseLogsCompanion toCompanion(bool nullToAbsent) {
    return ExerciseLogsCompanion(
      id: Value(id),
      timestamp: Value(timestamp),
      type: Value(type),
      durationMin: Value(durationMin),
      calories: calories == null && nullToAbsent
          ? const Value.absent()
          : Value(calories),
    );
  }

  factory ExerciseLog.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ExerciseLog(
      id: serializer.fromJson<int>(json['id']),
      timestamp: serializer.fromJson<DateTime>(json['timestamp']),
      type: serializer.fromJson<String>(json['type']),
      durationMin: serializer.fromJson<int>(json['durationMin']),
      calories: serializer.fromJson<int?>(json['calories']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'timestamp': serializer.toJson<DateTime>(timestamp),
      'type': serializer.toJson<String>(type),
      'durationMin': serializer.toJson<int>(durationMin),
      'calories': serializer.toJson<int?>(calories),
    };
  }

  ExerciseLog copyWith(
          {int? id,
          DateTime? timestamp,
          String? type,
          int? durationMin,
          Value<int?> calories = const Value.absent()}) =>
      ExerciseLog(
        id: id ?? this.id,
        timestamp: timestamp ?? this.timestamp,
        type: type ?? this.type,
        durationMin: durationMin ?? this.durationMin,
        calories: calories.present ? calories.value : this.calories,
      );
  ExerciseLog copyWithCompanion(ExerciseLogsCompanion data) {
    return ExerciseLog(
      id: data.id.present ? data.id.value : this.id,
      timestamp: data.timestamp.present ? data.timestamp.value : this.timestamp,
      type: data.type.present ? data.type.value : this.type,
      durationMin:
          data.durationMin.present ? data.durationMin.value : this.durationMin,
      calories: data.calories.present ? data.calories.value : this.calories,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ExerciseLog(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('type: $type, ')
          ..write('durationMin: $durationMin, ')
          ..write('calories: $calories')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, timestamp, type, durationMin, calories);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ExerciseLog &&
          other.id == this.id &&
          other.timestamp == this.timestamp &&
          other.type == this.type &&
          other.durationMin == this.durationMin &&
          other.calories == this.calories);
}

class ExerciseLogsCompanion extends UpdateCompanion<ExerciseLog> {
  final Value<int> id;
  final Value<DateTime> timestamp;
  final Value<String> type;
  final Value<int> durationMin;
  final Value<int?> calories;
  const ExerciseLogsCompanion({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    this.type = const Value.absent(),
    this.durationMin = const Value.absent(),
    this.calories = const Value.absent(),
  });
  ExerciseLogsCompanion.insert({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    required String type,
    required int durationMin,
    this.calories = const Value.absent(),
  })  : type = Value(type),
        durationMin = Value(durationMin);
  static Insertable<ExerciseLog> custom({
    Expression<int>? id,
    Expression<DateTime>? timestamp,
    Expression<String>? type,
    Expression<int>? durationMin,
    Expression<int>? calories,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (timestamp != null) 'timestamp': timestamp,
      if (type != null) 'type': type,
      if (durationMin != null) 'duration_min': durationMin,
      if (calories != null) 'calories': calories,
    });
  }

  ExerciseLogsCompanion copyWith(
      {Value<int>? id,
      Value<DateTime>? timestamp,
      Value<String>? type,
      Value<int>? durationMin,
      Value<int?>? calories}) {
    return ExerciseLogsCompanion(
      id: id ?? this.id,
      timestamp: timestamp ?? this.timestamp,
      type: type ?? this.type,
      durationMin: durationMin ?? this.durationMin,
      calories: calories ?? this.calories,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (timestamp.present) {
      map['timestamp'] = Variable<DateTime>(timestamp.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (durationMin.present) {
      map['duration_min'] = Variable<int>(durationMin.value);
    }
    if (calories.present) {
      map['calories'] = Variable<int>(calories.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ExerciseLogsCompanion(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('type: $type, ')
          ..write('durationMin: $durationMin, ')
          ..write('calories: $calories')
          ..write(')'))
        .toString();
  }
}

class $HealthGoalsTable extends HealthGoals
    with TableInfo<$HealthGoalsTable, HealthGoal> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $HealthGoalsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
      'title', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _targetMeta = const VerificationMeta('target');
  @override
  late final GeneratedColumn<double> target = GeneratedColumn<double>(
      'target', aliasedName, false,
      type: DriftSqlType.double, requiredDuringInsert: true);
  static const VerificationMeta _currentMeta =
      const VerificationMeta('current');
  @override
  late final GeneratedColumn<double> current = GeneratedColumn<double>(
      'current', aliasedName, false,
      type: DriftSqlType.double,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _unitMeta = const VerificationMeta('unit');
  @override
  late final GeneratedColumn<String> unit = GeneratedColumn<String>(
      'unit', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _deadlineMeta =
      const VerificationMeta('deadline');
  @override
  late final GeneratedColumn<DateTime> deadline = GeneratedColumn<DateTime>(
      'deadline', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _activeMeta = const VerificationMeta('active');
  @override
  late final GeneratedColumn<bool> active = GeneratedColumn<bool>(
      'active', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("active" IN (0, 1))'),
      defaultValue: const Constant(true));
  @override
  List<GeneratedColumn> get $columns =>
      [id, title, target, current, unit, deadline, active];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'health_goals';
  @override
  VerificationContext validateIntegrity(Insertable<HealthGoal> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('title')) {
      context.handle(
          _titleMeta, title.isAcceptableOrUnknown(data['title']!, _titleMeta));
    } else if (isInserting) {
      context.missing(_titleMeta);
    }
    if (data.containsKey('target')) {
      context.handle(_targetMeta,
          target.isAcceptableOrUnknown(data['target']!, _targetMeta));
    } else if (isInserting) {
      context.missing(_targetMeta);
    }
    if (data.containsKey('current')) {
      context.handle(_currentMeta,
          current.isAcceptableOrUnknown(data['current']!, _currentMeta));
    }
    if (data.containsKey('unit')) {
      context.handle(
          _unitMeta, unit.isAcceptableOrUnknown(data['unit']!, _unitMeta));
    } else if (isInserting) {
      context.missing(_unitMeta);
    }
    if (data.containsKey('deadline')) {
      context.handle(_deadlineMeta,
          deadline.isAcceptableOrUnknown(data['deadline']!, _deadlineMeta));
    }
    if (data.containsKey('active')) {
      context.handle(_activeMeta,
          active.isAcceptableOrUnknown(data['active']!, _activeMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  HealthGoal map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return HealthGoal(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      title: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}title'])!,
      target: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}target'])!,
      current: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}current'])!,
      unit: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}unit'])!,
      deadline: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}deadline']),
      active: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}active'])!,
    );
  }

  @override
  $HealthGoalsTable createAlias(String alias) {
    return $HealthGoalsTable(attachedDatabase, alias);
  }
}

class HealthGoal extends DataClass implements Insertable<HealthGoal> {
  final int id;
  final String title;
  final double target;
  final double current;
  final String unit;
  final DateTime? deadline;
  final bool active;
  const HealthGoal(
      {required this.id,
      required this.title,
      required this.target,
      required this.current,
      required this.unit,
      this.deadline,
      required this.active});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['title'] = Variable<String>(title);
    map['target'] = Variable<double>(target);
    map['current'] = Variable<double>(current);
    map['unit'] = Variable<String>(unit);
    if (!nullToAbsent || deadline != null) {
      map['deadline'] = Variable<DateTime>(deadline);
    }
    map['active'] = Variable<bool>(active);
    return map;
  }

  HealthGoalsCompanion toCompanion(bool nullToAbsent) {
    return HealthGoalsCompanion(
      id: Value(id),
      title: Value(title),
      target: Value(target),
      current: Value(current),
      unit: Value(unit),
      deadline: deadline == null && nullToAbsent
          ? const Value.absent()
          : Value(deadline),
      active: Value(active),
    );
  }

  factory HealthGoal.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return HealthGoal(
      id: serializer.fromJson<int>(json['id']),
      title: serializer.fromJson<String>(json['title']),
      target: serializer.fromJson<double>(json['target']),
      current: serializer.fromJson<double>(json['current']),
      unit: serializer.fromJson<String>(json['unit']),
      deadline: serializer.fromJson<DateTime?>(json['deadline']),
      active: serializer.fromJson<bool>(json['active']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'title': serializer.toJson<String>(title),
      'target': serializer.toJson<double>(target),
      'current': serializer.toJson<double>(current),
      'unit': serializer.toJson<String>(unit),
      'deadline': serializer.toJson<DateTime?>(deadline),
      'active': serializer.toJson<bool>(active),
    };
  }

  HealthGoal copyWith(
          {int? id,
          String? title,
          double? target,
          double? current,
          String? unit,
          Value<DateTime?> deadline = const Value.absent(),
          bool? active}) =>
      HealthGoal(
        id: id ?? this.id,
        title: title ?? this.title,
        target: target ?? this.target,
        current: current ?? this.current,
        unit: unit ?? this.unit,
        deadline: deadline.present ? deadline.value : this.deadline,
        active: active ?? this.active,
      );
  HealthGoal copyWithCompanion(HealthGoalsCompanion data) {
    return HealthGoal(
      id: data.id.present ? data.id.value : this.id,
      title: data.title.present ? data.title.value : this.title,
      target: data.target.present ? data.target.value : this.target,
      current: data.current.present ? data.current.value : this.current,
      unit: data.unit.present ? data.unit.value : this.unit,
      deadline: data.deadline.present ? data.deadline.value : this.deadline,
      active: data.active.present ? data.active.value : this.active,
    );
  }

  @override
  String toString() {
    return (StringBuffer('HealthGoal(')
          ..write('id: $id, ')
          ..write('title: $title, ')
          ..write('target: $target, ')
          ..write('current: $current, ')
          ..write('unit: $unit, ')
          ..write('deadline: $deadline, ')
          ..write('active: $active')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, title, target, current, unit, deadline, active);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is HealthGoal &&
          other.id == this.id &&
          other.title == this.title &&
          other.target == this.target &&
          other.current == this.current &&
          other.unit == this.unit &&
          other.deadline == this.deadline &&
          other.active == this.active);
}

class HealthGoalsCompanion extends UpdateCompanion<HealthGoal> {
  final Value<int> id;
  final Value<String> title;
  final Value<double> target;
  final Value<double> current;
  final Value<String> unit;
  final Value<DateTime?> deadline;
  final Value<bool> active;
  const HealthGoalsCompanion({
    this.id = const Value.absent(),
    this.title = const Value.absent(),
    this.target = const Value.absent(),
    this.current = const Value.absent(),
    this.unit = const Value.absent(),
    this.deadline = const Value.absent(),
    this.active = const Value.absent(),
  });
  HealthGoalsCompanion.insert({
    this.id = const Value.absent(),
    required String title,
    required double target,
    this.current = const Value.absent(),
    required String unit,
    this.deadline = const Value.absent(),
    this.active = const Value.absent(),
  })  : title = Value(title),
        target = Value(target),
        unit = Value(unit);
  static Insertable<HealthGoal> custom({
    Expression<int>? id,
    Expression<String>? title,
    Expression<double>? target,
    Expression<double>? current,
    Expression<String>? unit,
    Expression<DateTime>? deadline,
    Expression<bool>? active,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (title != null) 'title': title,
      if (target != null) 'target': target,
      if (current != null) 'current': current,
      if (unit != null) 'unit': unit,
      if (deadline != null) 'deadline': deadline,
      if (active != null) 'active': active,
    });
  }

  HealthGoalsCompanion copyWith(
      {Value<int>? id,
      Value<String>? title,
      Value<double>? target,
      Value<double>? current,
      Value<String>? unit,
      Value<DateTime?>? deadline,
      Value<bool>? active}) {
    return HealthGoalsCompanion(
      id: id ?? this.id,
      title: title ?? this.title,
      target: target ?? this.target,
      current: current ?? this.current,
      unit: unit ?? this.unit,
      deadline: deadline ?? this.deadline,
      active: active ?? this.active,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (target.present) {
      map['target'] = Variable<double>(target.value);
    }
    if (current.present) {
      map['current'] = Variable<double>(current.value);
    }
    if (unit.present) {
      map['unit'] = Variable<String>(unit.value);
    }
    if (deadline.present) {
      map['deadline'] = Variable<DateTime>(deadline.value);
    }
    if (active.present) {
      map['active'] = Variable<bool>(active.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('HealthGoalsCompanion(')
          ..write('id: $id, ')
          ..write('title: $title, ')
          ..write('target: $target, ')
          ..write('current: $current, ')
          ..write('unit: $unit, ')
          ..write('deadline: $deadline, ')
          ..write('active: $active')
          ..write(')'))
        .toString();
  }
}

class $MedicationRemindersTable extends MedicationReminders
    with TableInfo<$MedicationRemindersTable, MedicationReminder> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MedicationRemindersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
      'name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dosageMeta = const VerificationMeta('dosage');
  @override
  late final GeneratedColumn<String> dosage = GeneratedColumn<String>(
      'dosage', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _frequencyMeta =
      const VerificationMeta('frequency');
  @override
  late final GeneratedColumn<String> frequency = GeneratedColumn<String>(
      'frequency', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _timesMeta = const VerificationMeta('times');
  @override
  late final GeneratedColumn<String> times = GeneratedColumn<String>(
      'times', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _activeMeta = const VerificationMeta('active');
  @override
  late final GeneratedColumn<bool> active = GeneratedColumn<bool>(
      'active', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("active" IN (0, 1))'),
      defaultValue: const Constant(true));
  @override
  List<GeneratedColumn> get $columns =>
      [id, name, dosage, frequency, times, active];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'medication_reminders';
  @override
  VerificationContext validateIntegrity(Insertable<MedicationReminder> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('name')) {
      context.handle(
          _nameMeta, name.isAcceptableOrUnknown(data['name']!, _nameMeta));
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('dosage')) {
      context.handle(_dosageMeta,
          dosage.isAcceptableOrUnknown(data['dosage']!, _dosageMeta));
    } else if (isInserting) {
      context.missing(_dosageMeta);
    }
    if (data.containsKey('frequency')) {
      context.handle(_frequencyMeta,
          frequency.isAcceptableOrUnknown(data['frequency']!, _frequencyMeta));
    } else if (isInserting) {
      context.missing(_frequencyMeta);
    }
    if (data.containsKey('times')) {
      context.handle(
          _timesMeta, times.isAcceptableOrUnknown(data['times']!, _timesMeta));
    } else if (isInserting) {
      context.missing(_timesMeta);
    }
    if (data.containsKey('active')) {
      context.handle(_activeMeta,
          active.isAcceptableOrUnknown(data['active']!, _activeMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  MedicationReminder map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MedicationReminder(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      name: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}name'])!,
      dosage: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}dosage'])!,
      frequency: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}frequency'])!,
      times: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}times'])!,
      active: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}active'])!,
    );
  }

  @override
  $MedicationRemindersTable createAlias(String alias) {
    return $MedicationRemindersTable(attachedDatabase, alias);
  }
}

class MedicationReminder extends DataClass
    implements Insertable<MedicationReminder> {
  final int id;
  final String name;
  final String dosage;
  final String frequency;
  final String times;
  final bool active;
  const MedicationReminder(
      {required this.id,
      required this.name,
      required this.dosage,
      required this.frequency,
      required this.times,
      required this.active});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['name'] = Variable<String>(name);
    map['dosage'] = Variable<String>(dosage);
    map['frequency'] = Variable<String>(frequency);
    map['times'] = Variable<String>(times);
    map['active'] = Variable<bool>(active);
    return map;
  }

  MedicationRemindersCompanion toCompanion(bool nullToAbsent) {
    return MedicationRemindersCompanion(
      id: Value(id),
      name: Value(name),
      dosage: Value(dosage),
      frequency: Value(frequency),
      times: Value(times),
      active: Value(active),
    );
  }

  factory MedicationReminder.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MedicationReminder(
      id: serializer.fromJson<int>(json['id']),
      name: serializer.fromJson<String>(json['name']),
      dosage: serializer.fromJson<String>(json['dosage']),
      frequency: serializer.fromJson<String>(json['frequency']),
      times: serializer.fromJson<String>(json['times']),
      active: serializer.fromJson<bool>(json['active']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'name': serializer.toJson<String>(name),
      'dosage': serializer.toJson<String>(dosage),
      'frequency': serializer.toJson<String>(frequency),
      'times': serializer.toJson<String>(times),
      'active': serializer.toJson<bool>(active),
    };
  }

  MedicationReminder copyWith(
          {int? id,
          String? name,
          String? dosage,
          String? frequency,
          String? times,
          bool? active}) =>
      MedicationReminder(
        id: id ?? this.id,
        name: name ?? this.name,
        dosage: dosage ?? this.dosage,
        frequency: frequency ?? this.frequency,
        times: times ?? this.times,
        active: active ?? this.active,
      );
  MedicationReminder copyWithCompanion(MedicationRemindersCompanion data) {
    return MedicationReminder(
      id: data.id.present ? data.id.value : this.id,
      name: data.name.present ? data.name.value : this.name,
      dosage: data.dosage.present ? data.dosage.value : this.dosage,
      frequency: data.frequency.present ? data.frequency.value : this.frequency,
      times: data.times.present ? data.times.value : this.times,
      active: data.active.present ? data.active.value : this.active,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MedicationReminder(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('dosage: $dosage, ')
          ..write('frequency: $frequency, ')
          ..write('times: $times, ')
          ..write('active: $active')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, name, dosage, frequency, times, active);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MedicationReminder &&
          other.id == this.id &&
          other.name == this.name &&
          other.dosage == this.dosage &&
          other.frequency == this.frequency &&
          other.times == this.times &&
          other.active == this.active);
}

class MedicationRemindersCompanion extends UpdateCompanion<MedicationReminder> {
  final Value<int> id;
  final Value<String> name;
  final Value<String> dosage;
  final Value<String> frequency;
  final Value<String> times;
  final Value<bool> active;
  const MedicationRemindersCompanion({
    this.id = const Value.absent(),
    this.name = const Value.absent(),
    this.dosage = const Value.absent(),
    this.frequency = const Value.absent(),
    this.times = const Value.absent(),
    this.active = const Value.absent(),
  });
  MedicationRemindersCompanion.insert({
    this.id = const Value.absent(),
    required String name,
    required String dosage,
    required String frequency,
    required String times,
    this.active = const Value.absent(),
  })  : name = Value(name),
        dosage = Value(dosage),
        frequency = Value(frequency),
        times = Value(times);
  static Insertable<MedicationReminder> custom({
    Expression<int>? id,
    Expression<String>? name,
    Expression<String>? dosage,
    Expression<String>? frequency,
    Expression<String>? times,
    Expression<bool>? active,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (name != null) 'name': name,
      if (dosage != null) 'dosage': dosage,
      if (frequency != null) 'frequency': frequency,
      if (times != null) 'times': times,
      if (active != null) 'active': active,
    });
  }

  MedicationRemindersCompanion copyWith(
      {Value<int>? id,
      Value<String>? name,
      Value<String>? dosage,
      Value<String>? frequency,
      Value<String>? times,
      Value<bool>? active}) {
    return MedicationRemindersCompanion(
      id: id ?? this.id,
      name: name ?? this.name,
      dosage: dosage ?? this.dosage,
      frequency: frequency ?? this.frequency,
      times: times ?? this.times,
      active: active ?? this.active,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (dosage.present) {
      map['dosage'] = Variable<String>(dosage.value);
    }
    if (frequency.present) {
      map['frequency'] = Variable<String>(frequency.value);
    }
    if (times.present) {
      map['times'] = Variable<String>(times.value);
    }
    if (active.present) {
      map['active'] = Variable<bool>(active.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MedicationRemindersCompanion(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('dosage: $dosage, ')
          ..write('frequency: $frequency, ')
          ..write('times: $times, ')
          ..write('active: $active')
          ..write(')'))
        .toString();
  }
}

class $PeriodTrackingTable extends PeriodTracking
    with TableInfo<$PeriodTrackingTable, PeriodTrackingData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PeriodTrackingTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _dateMeta = const VerificationMeta('date');
  @override
  late final GeneratedColumn<DateTime> date = GeneratedColumn<DateTime>(
      'date', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _flowLevelMeta =
      const VerificationMeta('flowLevel');
  @override
  late final GeneratedColumn<int> flowLevel = GeneratedColumn<int>(
      'flow_level', aliasedName, false,
      check: () => ComparableExpr(flowLevel).isBetweenValues(0, 4),
      type: DriftSqlType.int,
      requiredDuringInsert: true);
  static const VerificationMeta _symptomsMeta =
      const VerificationMeta('symptoms');
  @override
  late final GeneratedColumn<String> symptoms = GeneratedColumn<String>(
      'symptoms', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _notesMeta = const VerificationMeta('notes');
  @override
  late final GeneratedColumn<String> notes = GeneratedColumn<String>(
      'notes', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [id, date, flowLevel, symptoms, notes];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'period_tracking';
  @override
  VerificationContext validateIntegrity(Insertable<PeriodTrackingData> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('date')) {
      context.handle(
          _dateMeta, date.isAcceptableOrUnknown(data['date']!, _dateMeta));
    } else if (isInserting) {
      context.missing(_dateMeta);
    }
    if (data.containsKey('flow_level')) {
      context.handle(_flowLevelMeta,
          flowLevel.isAcceptableOrUnknown(data['flow_level']!, _flowLevelMeta));
    } else if (isInserting) {
      context.missing(_flowLevelMeta);
    }
    if (data.containsKey('symptoms')) {
      context.handle(_symptomsMeta,
          symptoms.isAcceptableOrUnknown(data['symptoms']!, _symptomsMeta));
    }
    if (data.containsKey('notes')) {
      context.handle(
          _notesMeta, notes.isAcceptableOrUnknown(data['notes']!, _notesMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PeriodTrackingData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PeriodTrackingData(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      date: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}date'])!,
      flowLevel: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}flow_level'])!,
      symptoms: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}symptoms']),
      notes: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}notes']),
    );
  }

  @override
  $PeriodTrackingTable createAlias(String alias) {
    return $PeriodTrackingTable(attachedDatabase, alias);
  }
}

class PeriodTrackingData extends DataClass
    implements Insertable<PeriodTrackingData> {
  final int id;
  final DateTime date;
  final int flowLevel;
  final String? symptoms;
  final String? notes;
  const PeriodTrackingData(
      {required this.id,
      required this.date,
      required this.flowLevel,
      this.symptoms,
      this.notes});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['date'] = Variable<DateTime>(date);
    map['flow_level'] = Variable<int>(flowLevel);
    if (!nullToAbsent || symptoms != null) {
      map['symptoms'] = Variable<String>(symptoms);
    }
    if (!nullToAbsent || notes != null) {
      map['notes'] = Variable<String>(notes);
    }
    return map;
  }

  PeriodTrackingCompanion toCompanion(bool nullToAbsent) {
    return PeriodTrackingCompanion(
      id: Value(id),
      date: Value(date),
      flowLevel: Value(flowLevel),
      symptoms: symptoms == null && nullToAbsent
          ? const Value.absent()
          : Value(symptoms),
      notes:
          notes == null && nullToAbsent ? const Value.absent() : Value(notes),
    );
  }

  factory PeriodTrackingData.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PeriodTrackingData(
      id: serializer.fromJson<int>(json['id']),
      date: serializer.fromJson<DateTime>(json['date']),
      flowLevel: serializer.fromJson<int>(json['flowLevel']),
      symptoms: serializer.fromJson<String?>(json['symptoms']),
      notes: serializer.fromJson<String?>(json['notes']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'date': serializer.toJson<DateTime>(date),
      'flowLevel': serializer.toJson<int>(flowLevel),
      'symptoms': serializer.toJson<String?>(symptoms),
      'notes': serializer.toJson<String?>(notes),
    };
  }

  PeriodTrackingData copyWith(
          {int? id,
          DateTime? date,
          int? flowLevel,
          Value<String?> symptoms = const Value.absent(),
          Value<String?> notes = const Value.absent()}) =>
      PeriodTrackingData(
        id: id ?? this.id,
        date: date ?? this.date,
        flowLevel: flowLevel ?? this.flowLevel,
        symptoms: symptoms.present ? symptoms.value : this.symptoms,
        notes: notes.present ? notes.value : this.notes,
      );
  PeriodTrackingData copyWithCompanion(PeriodTrackingCompanion data) {
    return PeriodTrackingData(
      id: data.id.present ? data.id.value : this.id,
      date: data.date.present ? data.date.value : this.date,
      flowLevel: data.flowLevel.present ? data.flowLevel.value : this.flowLevel,
      symptoms: data.symptoms.present ? data.symptoms.value : this.symptoms,
      notes: data.notes.present ? data.notes.value : this.notes,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PeriodTrackingData(')
          ..write('id: $id, ')
          ..write('date: $date, ')
          ..write('flowLevel: $flowLevel, ')
          ..write('symptoms: $symptoms, ')
          ..write('notes: $notes')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, date, flowLevel, symptoms, notes);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PeriodTrackingData &&
          other.id == this.id &&
          other.date == this.date &&
          other.flowLevel == this.flowLevel &&
          other.symptoms == this.symptoms &&
          other.notes == this.notes);
}

class PeriodTrackingCompanion extends UpdateCompanion<PeriodTrackingData> {
  final Value<int> id;
  final Value<DateTime> date;
  final Value<int> flowLevel;
  final Value<String?> symptoms;
  final Value<String?> notes;
  const PeriodTrackingCompanion({
    this.id = const Value.absent(),
    this.date = const Value.absent(),
    this.flowLevel = const Value.absent(),
    this.symptoms = const Value.absent(),
    this.notes = const Value.absent(),
  });
  PeriodTrackingCompanion.insert({
    this.id = const Value.absent(),
    required DateTime date,
    required int flowLevel,
    this.symptoms = const Value.absent(),
    this.notes = const Value.absent(),
  })  : date = Value(date),
        flowLevel = Value(flowLevel);
  static Insertable<PeriodTrackingData> custom({
    Expression<int>? id,
    Expression<DateTime>? date,
    Expression<int>? flowLevel,
    Expression<String>? symptoms,
    Expression<String>? notes,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (date != null) 'date': date,
      if (flowLevel != null) 'flow_level': flowLevel,
      if (symptoms != null) 'symptoms': symptoms,
      if (notes != null) 'notes': notes,
    });
  }

  PeriodTrackingCompanion copyWith(
      {Value<int>? id,
      Value<DateTime>? date,
      Value<int>? flowLevel,
      Value<String?>? symptoms,
      Value<String?>? notes}) {
    return PeriodTrackingCompanion(
      id: id ?? this.id,
      date: date ?? this.date,
      flowLevel: flowLevel ?? this.flowLevel,
      symptoms: symptoms ?? this.symptoms,
      notes: notes ?? this.notes,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (date.present) {
      map['date'] = Variable<DateTime>(date.value);
    }
    if (flowLevel.present) {
      map['flow_level'] = Variable<int>(flowLevel.value);
    }
    if (symptoms.present) {
      map['symptoms'] = Variable<String>(symptoms.value);
    }
    if (notes.present) {
      map['notes'] = Variable<String>(notes.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PeriodTrackingCompanion(')
          ..write('id: $id, ')
          ..write('date: $date, ')
          ..write('flowLevel: $flowLevel, ')
          ..write('symptoms: $symptoms, ')
          ..write('notes: $notes')
          ..write(')'))
        .toString();
  }
}

class $JournalEntriesTable extends JournalEntries
    with TableInfo<$JournalEntriesTable, JournalEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $JournalEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _timestampMeta =
      const VerificationMeta('timestamp');
  @override
  late final GeneratedColumn<DateTime> timestamp = GeneratedColumn<DateTime>(
      'timestamp', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  static const VerificationMeta _contentMeta =
      const VerificationMeta('content');
  @override
  late final GeneratedColumn<String> content = GeneratedColumn<String>(
      'content', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _moodTagMeta =
      const VerificationMeta('moodTag');
  @override
  late final GeneratedColumn<String> moodTag = GeneratedColumn<String>(
      'mood_tag', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [id, timestamp, content, moodTag];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'journal_entries';
  @override
  VerificationContext validateIntegrity(Insertable<JournalEntry> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('timestamp')) {
      context.handle(_timestampMeta,
          timestamp.isAcceptableOrUnknown(data['timestamp']!, _timestampMeta));
    }
    if (data.containsKey('content')) {
      context.handle(_contentMeta,
          content.isAcceptableOrUnknown(data['content']!, _contentMeta));
    } else if (isInserting) {
      context.missing(_contentMeta);
    }
    if (data.containsKey('mood_tag')) {
      context.handle(_moodTagMeta,
          moodTag.isAcceptableOrUnknown(data['mood_tag']!, _moodTagMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  JournalEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return JournalEntry(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      timestamp: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}timestamp'])!,
      content: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}content'])!,
      moodTag: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}mood_tag']),
    );
  }

  @override
  $JournalEntriesTable createAlias(String alias) {
    return $JournalEntriesTable(attachedDatabase, alias);
  }
}

class JournalEntry extends DataClass implements Insertable<JournalEntry> {
  final int id;
  final DateTime timestamp;
  final String content;
  final String? moodTag;
  const JournalEntry(
      {required this.id,
      required this.timestamp,
      required this.content,
      this.moodTag});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['timestamp'] = Variable<DateTime>(timestamp);
    map['content'] = Variable<String>(content);
    if (!nullToAbsent || moodTag != null) {
      map['mood_tag'] = Variable<String>(moodTag);
    }
    return map;
  }

  JournalEntriesCompanion toCompanion(bool nullToAbsent) {
    return JournalEntriesCompanion(
      id: Value(id),
      timestamp: Value(timestamp),
      content: Value(content),
      moodTag: moodTag == null && nullToAbsent
          ? const Value.absent()
          : Value(moodTag),
    );
  }

  factory JournalEntry.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return JournalEntry(
      id: serializer.fromJson<int>(json['id']),
      timestamp: serializer.fromJson<DateTime>(json['timestamp']),
      content: serializer.fromJson<String>(json['content']),
      moodTag: serializer.fromJson<String?>(json['moodTag']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'timestamp': serializer.toJson<DateTime>(timestamp),
      'content': serializer.toJson<String>(content),
      'moodTag': serializer.toJson<String?>(moodTag),
    };
  }

  JournalEntry copyWith(
          {int? id,
          DateTime? timestamp,
          String? content,
          Value<String?> moodTag = const Value.absent()}) =>
      JournalEntry(
        id: id ?? this.id,
        timestamp: timestamp ?? this.timestamp,
        content: content ?? this.content,
        moodTag: moodTag.present ? moodTag.value : this.moodTag,
      );
  JournalEntry copyWithCompanion(JournalEntriesCompanion data) {
    return JournalEntry(
      id: data.id.present ? data.id.value : this.id,
      timestamp: data.timestamp.present ? data.timestamp.value : this.timestamp,
      content: data.content.present ? data.content.value : this.content,
      moodTag: data.moodTag.present ? data.moodTag.value : this.moodTag,
    );
  }

  @override
  String toString() {
    return (StringBuffer('JournalEntry(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('content: $content, ')
          ..write('moodTag: $moodTag')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, timestamp, content, moodTag);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is JournalEntry &&
          other.id == this.id &&
          other.timestamp == this.timestamp &&
          other.content == this.content &&
          other.moodTag == this.moodTag);
}

class JournalEntriesCompanion extends UpdateCompanion<JournalEntry> {
  final Value<int> id;
  final Value<DateTime> timestamp;
  final Value<String> content;
  final Value<String?> moodTag;
  const JournalEntriesCompanion({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    this.content = const Value.absent(),
    this.moodTag = const Value.absent(),
  });
  JournalEntriesCompanion.insert({
    this.id = const Value.absent(),
    this.timestamp = const Value.absent(),
    required String content,
    this.moodTag = const Value.absent(),
  }) : content = Value(content);
  static Insertable<JournalEntry> custom({
    Expression<int>? id,
    Expression<DateTime>? timestamp,
    Expression<String>? content,
    Expression<String>? moodTag,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (timestamp != null) 'timestamp': timestamp,
      if (content != null) 'content': content,
      if (moodTag != null) 'mood_tag': moodTag,
    });
  }

  JournalEntriesCompanion copyWith(
      {Value<int>? id,
      Value<DateTime>? timestamp,
      Value<String>? content,
      Value<String?>? moodTag}) {
    return JournalEntriesCompanion(
      id: id ?? this.id,
      timestamp: timestamp ?? this.timestamp,
      content: content ?? this.content,
      moodTag: moodTag ?? this.moodTag,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (timestamp.present) {
      map['timestamp'] = Variable<DateTime>(timestamp.value);
    }
    if (content.present) {
      map['content'] = Variable<String>(content.value);
    }
    if (moodTag.present) {
      map['mood_tag'] = Variable<String>(moodTag.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('JournalEntriesCompanion(')
          ..write('id: $id, ')
          ..write('timestamp: $timestamp, ')
          ..write('content: $content, ')
          ..write('moodTag: $moodTag')
          ..write(')'))
        .toString();
  }
}

class $AssessmentResultsTable extends AssessmentResults
    with TableInfo<$AssessmentResultsTable, AssessmentResult> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $AssessmentResultsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
      'type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _scoreMeta = const VerificationMeta('score');
  @override
  late final GeneratedColumn<int> score = GeneratedColumn<int>(
      'score', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _dateMeta = const VerificationMeta('date');
  @override
  late final GeneratedColumn<DateTime> date = GeneratedColumn<DateTime>(
      'date', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  static const VerificationMeta _answersJsonMeta =
      const VerificationMeta('answersJson');
  @override
  late final GeneratedColumn<String> answersJson = GeneratedColumn<String>(
      'answers_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [id, type, score, date, answersJson];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'assessment_results';
  @override
  VerificationContext validateIntegrity(Insertable<AssessmentResult> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('type')) {
      context.handle(
          _typeMeta, type.isAcceptableOrUnknown(data['type']!, _typeMeta));
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('score')) {
      context.handle(
          _scoreMeta, score.isAcceptableOrUnknown(data['score']!, _scoreMeta));
    } else if (isInserting) {
      context.missing(_scoreMeta);
    }
    if (data.containsKey('date')) {
      context.handle(
          _dateMeta, date.isAcceptableOrUnknown(data['date']!, _dateMeta));
    }
    if (data.containsKey('answers_json')) {
      context.handle(
          _answersJsonMeta,
          answersJson.isAcceptableOrUnknown(
              data['answers_json']!, _answersJsonMeta));
    } else if (isInserting) {
      context.missing(_answersJsonMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  AssessmentResult map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return AssessmentResult(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      type: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}type'])!,
      score: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}score'])!,
      date: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}date'])!,
      answersJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}answers_json'])!,
    );
  }

  @override
  $AssessmentResultsTable createAlias(String alias) {
    return $AssessmentResultsTable(attachedDatabase, alias);
  }
}

class AssessmentResult extends DataClass
    implements Insertable<AssessmentResult> {
  final int id;
  final String type;
  final int score;
  final DateTime date;
  final String answersJson;
  const AssessmentResult(
      {required this.id,
      required this.type,
      required this.score,
      required this.date,
      required this.answersJson});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['type'] = Variable<String>(type);
    map['score'] = Variable<int>(score);
    map['date'] = Variable<DateTime>(date);
    map['answers_json'] = Variable<String>(answersJson);
    return map;
  }

  AssessmentResultsCompanion toCompanion(bool nullToAbsent) {
    return AssessmentResultsCompanion(
      id: Value(id),
      type: Value(type),
      score: Value(score),
      date: Value(date),
      answersJson: Value(answersJson),
    );
  }

  factory AssessmentResult.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return AssessmentResult(
      id: serializer.fromJson<int>(json['id']),
      type: serializer.fromJson<String>(json['type']),
      score: serializer.fromJson<int>(json['score']),
      date: serializer.fromJson<DateTime>(json['date']),
      answersJson: serializer.fromJson<String>(json['answersJson']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'type': serializer.toJson<String>(type),
      'score': serializer.toJson<int>(score),
      'date': serializer.toJson<DateTime>(date),
      'answersJson': serializer.toJson<String>(answersJson),
    };
  }

  AssessmentResult copyWith(
          {int? id,
          String? type,
          int? score,
          DateTime? date,
          String? answersJson}) =>
      AssessmentResult(
        id: id ?? this.id,
        type: type ?? this.type,
        score: score ?? this.score,
        date: date ?? this.date,
        answersJson: answersJson ?? this.answersJson,
      );
  AssessmentResult copyWithCompanion(AssessmentResultsCompanion data) {
    return AssessmentResult(
      id: data.id.present ? data.id.value : this.id,
      type: data.type.present ? data.type.value : this.type,
      score: data.score.present ? data.score.value : this.score,
      date: data.date.present ? data.date.value : this.date,
      answersJson:
          data.answersJson.present ? data.answersJson.value : this.answersJson,
    );
  }

  @override
  String toString() {
    return (StringBuffer('AssessmentResult(')
          ..write('id: $id, ')
          ..write('type: $type, ')
          ..write('score: $score, ')
          ..write('date: $date, ')
          ..write('answersJson: $answersJson')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, type, score, date, answersJson);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AssessmentResult &&
          other.id == this.id &&
          other.type == this.type &&
          other.score == this.score &&
          other.date == this.date &&
          other.answersJson == this.answersJson);
}

class AssessmentResultsCompanion extends UpdateCompanion<AssessmentResult> {
  final Value<int> id;
  final Value<String> type;
  final Value<int> score;
  final Value<DateTime> date;
  final Value<String> answersJson;
  const AssessmentResultsCompanion({
    this.id = const Value.absent(),
    this.type = const Value.absent(),
    this.score = const Value.absent(),
    this.date = const Value.absent(),
    this.answersJson = const Value.absent(),
  });
  AssessmentResultsCompanion.insert({
    this.id = const Value.absent(),
    required String type,
    required int score,
    this.date = const Value.absent(),
    required String answersJson,
  })  : type = Value(type),
        score = Value(score),
        answersJson = Value(answersJson);
  static Insertable<AssessmentResult> custom({
    Expression<int>? id,
    Expression<String>? type,
    Expression<int>? score,
    Expression<DateTime>? date,
    Expression<String>? answersJson,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (type != null) 'type': type,
      if (score != null) 'score': score,
      if (date != null) 'date': date,
      if (answersJson != null) 'answers_json': answersJson,
    });
  }

  AssessmentResultsCompanion copyWith(
      {Value<int>? id,
      Value<String>? type,
      Value<int>? score,
      Value<DateTime>? date,
      Value<String>? answersJson}) {
    return AssessmentResultsCompanion(
      id: id ?? this.id,
      type: type ?? this.type,
      score: score ?? this.score,
      date: date ?? this.date,
      answersJson: answersJson ?? this.answersJson,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (score.present) {
      map['score'] = Variable<int>(score.value);
    }
    if (date.present) {
      map['date'] = Variable<DateTime>(date.value);
    }
    if (answersJson.present) {
      map['answers_json'] = Variable<String>(answersJson.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('AssessmentResultsCompanion(')
          ..write('id: $id, ')
          ..write('type: $type, ')
          ..write('score: $score, ')
          ..write('date: $date, ')
          ..write('answersJson: $answersJson')
          ..write(')'))
        .toString();
  }
}

class $DailyStepsTable extends DailySteps
    with TableInfo<$DailyStepsTable, DailyStep> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DailyStepsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _dateMeta = const VerificationMeta('date');
  @override
  late final GeneratedColumn<DateTime> date = GeneratedColumn<DateTime>(
      'date', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _countMeta = const VerificationMeta('count');
  @override
  late final GeneratedColumn<int> count = GeneratedColumn<int>(
      'count', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _sourceMeta = const VerificationMeta('source');
  @override
  late final GeneratedColumn<String> source = GeneratedColumn<String>(
      'source', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: false,
      defaultValue: const Constant('pedometer'));
  @override
  List<GeneratedColumn> get $columns => [id, date, count, source];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'daily_steps';
  @override
  VerificationContext validateIntegrity(Insertable<DailyStep> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('date')) {
      context.handle(
          _dateMeta, date.isAcceptableOrUnknown(data['date']!, _dateMeta));
    } else if (isInserting) {
      context.missing(_dateMeta);
    }
    if (data.containsKey('count')) {
      context.handle(
          _countMeta, count.isAcceptableOrUnknown(data['count']!, _countMeta));
    } else if (isInserting) {
      context.missing(_countMeta);
    }
    if (data.containsKey('source')) {
      context.handle(_sourceMeta,
          source.isAcceptableOrUnknown(data['source']!, _sourceMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  DailyStep map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DailyStep(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      date: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}date'])!,
      count: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}count'])!,
      source: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}source'])!,
    );
  }

  @override
  $DailyStepsTable createAlias(String alias) {
    return $DailyStepsTable(attachedDatabase, alias);
  }
}

class DailyStep extends DataClass implements Insertable<DailyStep> {
  final int id;
  final DateTime date;
  final int count;
  final String source;
  const DailyStep(
      {required this.id,
      required this.date,
      required this.count,
      required this.source});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['date'] = Variable<DateTime>(date);
    map['count'] = Variable<int>(count);
    map['source'] = Variable<String>(source);
    return map;
  }

  DailyStepsCompanion toCompanion(bool nullToAbsent) {
    return DailyStepsCompanion(
      id: Value(id),
      date: Value(date),
      count: Value(count),
      source: Value(source),
    );
  }

  factory DailyStep.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DailyStep(
      id: serializer.fromJson<int>(json['id']),
      date: serializer.fromJson<DateTime>(json['date']),
      count: serializer.fromJson<int>(json['count']),
      source: serializer.fromJson<String>(json['source']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'date': serializer.toJson<DateTime>(date),
      'count': serializer.toJson<int>(count),
      'source': serializer.toJson<String>(source),
    };
  }

  DailyStep copyWith({int? id, DateTime? date, int? count, String? source}) =>
      DailyStep(
        id: id ?? this.id,
        date: date ?? this.date,
        count: count ?? this.count,
        source: source ?? this.source,
      );
  DailyStep copyWithCompanion(DailyStepsCompanion data) {
    return DailyStep(
      id: data.id.present ? data.id.value : this.id,
      date: data.date.present ? data.date.value : this.date,
      count: data.count.present ? data.count.value : this.count,
      source: data.source.present ? data.source.value : this.source,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DailyStep(')
          ..write('id: $id, ')
          ..write('date: $date, ')
          ..write('count: $count, ')
          ..write('source: $source')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, date, count, source);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DailyStep &&
          other.id == this.id &&
          other.date == this.date &&
          other.count == this.count &&
          other.source == this.source);
}

class DailyStepsCompanion extends UpdateCompanion<DailyStep> {
  final Value<int> id;
  final Value<DateTime> date;
  final Value<int> count;
  final Value<String> source;
  const DailyStepsCompanion({
    this.id = const Value.absent(),
    this.date = const Value.absent(),
    this.count = const Value.absent(),
    this.source = const Value.absent(),
  });
  DailyStepsCompanion.insert({
    this.id = const Value.absent(),
    required DateTime date,
    required int count,
    this.source = const Value.absent(),
  })  : date = Value(date),
        count = Value(count);
  static Insertable<DailyStep> custom({
    Expression<int>? id,
    Expression<DateTime>? date,
    Expression<int>? count,
    Expression<String>? source,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (date != null) 'date': date,
      if (count != null) 'count': count,
      if (source != null) 'source': source,
    });
  }

  DailyStepsCompanion copyWith(
      {Value<int>? id,
      Value<DateTime>? date,
      Value<int>? count,
      Value<String>? source}) {
    return DailyStepsCompanion(
      id: id ?? this.id,
      date: date ?? this.date,
      count: count ?? this.count,
      source: source ?? this.source,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (date.present) {
      map['date'] = Variable<DateTime>(date.value);
    }
    if (count.present) {
      map['count'] = Variable<int>(count.value);
    }
    if (source.present) {
      map['source'] = Variable<String>(source.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DailyStepsCompanion(')
          ..write('id: $id, ')
          ..write('date: $date, ')
          ..write('count: $count, ')
          ..write('source: $source')
          ..write(')'))
        .toString();
  }
}

class $SyncQueueTable extends SyncQueue
    with TableInfo<$SyncQueueTable, SyncQueueData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncQueueTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _targetTableMeta =
      const VerificationMeta('targetTable');
  @override
  late final GeneratedColumn<String> targetTable = GeneratedColumn<String>(
      'target_table', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _rowIdMeta = const VerificationMeta('rowId');
  @override
  late final GeneratedColumn<int> rowId = GeneratedColumn<int>(
      'row_id', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _actionMeta = const VerificationMeta('action');
  @override
  late final GeneratedColumn<String> action = GeneratedColumn<String>(
      'action', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  static const VerificationMeta _syncedAtMeta =
      const VerificationMeta('syncedAt');
  @override
  late final GeneratedColumn<DateTime> syncedAt = GeneratedColumn<DateTime>(
      'synced_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns =>
      [id, targetTable, rowId, action, createdAt, syncedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_queue';
  @override
  VerificationContext validateIntegrity(Insertable<SyncQueueData> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('target_table')) {
      context.handle(
          _targetTableMeta,
          targetTable.isAcceptableOrUnknown(
              data['target_table']!, _targetTableMeta));
    } else if (isInserting) {
      context.missing(_targetTableMeta);
    }
    if (data.containsKey('row_id')) {
      context.handle(
          _rowIdMeta, rowId.isAcceptableOrUnknown(data['row_id']!, _rowIdMeta));
    } else if (isInserting) {
      context.missing(_rowIdMeta);
    }
    if (data.containsKey('action')) {
      context.handle(_actionMeta,
          action.isAcceptableOrUnknown(data['action']!, _actionMeta));
    } else if (isInserting) {
      context.missing(_actionMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    }
    if (data.containsKey('synced_at')) {
      context.handle(_syncedAtMeta,
          syncedAt.isAcceptableOrUnknown(data['synced_at']!, _syncedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  SyncQueueData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncQueueData(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      targetTable: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}target_table'])!,
      rowId: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}row_id'])!,
      action: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}action'])!,
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
      syncedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}synced_at']),
    );
  }

  @override
  $SyncQueueTable createAlias(String alias) {
    return $SyncQueueTable(attachedDatabase, alias);
  }
}

class SyncQueueData extends DataClass implements Insertable<SyncQueueData> {
  final int id;
  final String targetTable;
  final int rowId;
  final String action;
  final DateTime createdAt;
  final DateTime? syncedAt;
  const SyncQueueData(
      {required this.id,
      required this.targetTable,
      required this.rowId,
      required this.action,
      required this.createdAt,
      this.syncedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['target_table'] = Variable<String>(targetTable);
    map['row_id'] = Variable<int>(rowId);
    map['action'] = Variable<String>(action);
    map['created_at'] = Variable<DateTime>(createdAt);
    if (!nullToAbsent || syncedAt != null) {
      map['synced_at'] = Variable<DateTime>(syncedAt);
    }
    return map;
  }

  SyncQueueCompanion toCompanion(bool nullToAbsent) {
    return SyncQueueCompanion(
      id: Value(id),
      targetTable: Value(targetTable),
      rowId: Value(rowId),
      action: Value(action),
      createdAt: Value(createdAt),
      syncedAt: syncedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(syncedAt),
    );
  }

  factory SyncQueueData.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncQueueData(
      id: serializer.fromJson<int>(json['id']),
      targetTable: serializer.fromJson<String>(json['targetTable']),
      rowId: serializer.fromJson<int>(json['rowId']),
      action: serializer.fromJson<String>(json['action']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      syncedAt: serializer.fromJson<DateTime?>(json['syncedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'targetTable': serializer.toJson<String>(targetTable),
      'rowId': serializer.toJson<int>(rowId),
      'action': serializer.toJson<String>(action),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'syncedAt': serializer.toJson<DateTime?>(syncedAt),
    };
  }

  SyncQueueData copyWith(
          {int? id,
          String? targetTable,
          int? rowId,
          String? action,
          DateTime? createdAt,
          Value<DateTime?> syncedAt = const Value.absent()}) =>
      SyncQueueData(
        id: id ?? this.id,
        targetTable: targetTable ?? this.targetTable,
        rowId: rowId ?? this.rowId,
        action: action ?? this.action,
        createdAt: createdAt ?? this.createdAt,
        syncedAt: syncedAt.present ? syncedAt.value : this.syncedAt,
      );
  SyncQueueData copyWithCompanion(SyncQueueCompanion data) {
    return SyncQueueData(
      id: data.id.present ? data.id.value : this.id,
      targetTable:
          data.targetTable.present ? data.targetTable.value : this.targetTable,
      rowId: data.rowId.present ? data.rowId.value : this.rowId,
      action: data.action.present ? data.action.value : this.action,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      syncedAt: data.syncedAt.present ? data.syncedAt.value : this.syncedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncQueueData(')
          ..write('id: $id, ')
          ..write('targetTable: $targetTable, ')
          ..write('rowId: $rowId, ')
          ..write('action: $action, ')
          ..write('createdAt: $createdAt, ')
          ..write('syncedAt: $syncedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, targetTable, rowId, action, createdAt, syncedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncQueueData &&
          other.id == this.id &&
          other.targetTable == this.targetTable &&
          other.rowId == this.rowId &&
          other.action == this.action &&
          other.createdAt == this.createdAt &&
          other.syncedAt == this.syncedAt);
}

class SyncQueueCompanion extends UpdateCompanion<SyncQueueData> {
  final Value<int> id;
  final Value<String> targetTable;
  final Value<int> rowId;
  final Value<String> action;
  final Value<DateTime> createdAt;
  final Value<DateTime?> syncedAt;
  const SyncQueueCompanion({
    this.id = const Value.absent(),
    this.targetTable = const Value.absent(),
    this.rowId = const Value.absent(),
    this.action = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.syncedAt = const Value.absent(),
  });
  SyncQueueCompanion.insert({
    this.id = const Value.absent(),
    required String targetTable,
    required int rowId,
    required String action,
    this.createdAt = const Value.absent(),
    this.syncedAt = const Value.absent(),
  })  : targetTable = Value(targetTable),
        rowId = Value(rowId),
        action = Value(action);
  static Insertable<SyncQueueData> custom({
    Expression<int>? id,
    Expression<String>? targetTable,
    Expression<int>? rowId,
    Expression<String>? action,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? syncedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (targetTable != null) 'target_table': targetTable,
      if (rowId != null) 'row_id': rowId,
      if (action != null) 'action': action,
      if (createdAt != null) 'created_at': createdAt,
      if (syncedAt != null) 'synced_at': syncedAt,
    });
  }

  SyncQueueCompanion copyWith(
      {Value<int>? id,
      Value<String>? targetTable,
      Value<int>? rowId,
      Value<String>? action,
      Value<DateTime>? createdAt,
      Value<DateTime?>? syncedAt}) {
    return SyncQueueCompanion(
      id: id ?? this.id,
      targetTable: targetTable ?? this.targetTable,
      rowId: rowId ?? this.rowId,
      action: action ?? this.action,
      createdAt: createdAt ?? this.createdAt,
      syncedAt: syncedAt ?? this.syncedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (targetTable.present) {
      map['target_table'] = Variable<String>(targetTable.value);
    }
    if (rowId.present) {
      map['row_id'] = Variable<int>(rowId.value);
    }
    if (action.present) {
      map['action'] = Variable<String>(action.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (syncedAt.present) {
      map['synced_at'] = Variable<DateTime>(syncedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncQueueCompanion(')
          ..write('id: $id, ')
          ..write('targetTable: $targetTable, ')
          ..write('rowId: $rowId, ')
          ..write('action: $action, ')
          ..write('createdAt: $createdAt, ')
          ..write('syncedAt: $syncedAt')
          ..write(')'))
        .toString();
  }
}

abstract class _$WellnessDatabase extends GeneratedDatabase {
  _$WellnessDatabase(QueryExecutor e) : super(e);
  $WellnessDatabaseManager get managers => $WellnessDatabaseManager(this);
  late final $MoodEntriesTable moodEntries = $MoodEntriesTable(this);
  late final $WaterLogsTable waterLogs = $WaterLogsTable(this);
  late final $SleepLogsTable sleepLogs = $SleepLogsTable(this);
  late final $ExerciseLogsTable exerciseLogs = $ExerciseLogsTable(this);
  late final $HealthGoalsTable healthGoals = $HealthGoalsTable(this);
  late final $MedicationRemindersTable medicationReminders =
      $MedicationRemindersTable(this);
  late final $PeriodTrackingTable periodTracking = $PeriodTrackingTable(this);
  late final $JournalEntriesTable journalEntries = $JournalEntriesTable(this);
  late final $AssessmentResultsTable assessmentResults =
      $AssessmentResultsTable(this);
  late final $DailyStepsTable dailySteps = $DailyStepsTable(this);
  late final $SyncQueueTable syncQueue = $SyncQueueTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
        moodEntries,
        waterLogs,
        sleepLogs,
        exerciseLogs,
        healthGoals,
        medicationReminders,
        periodTracking,
        journalEntries,
        assessmentResults,
        dailySteps,
        syncQueue
      ];
}

typedef $$MoodEntriesTableCreateCompanionBuilder = MoodEntriesCompanion
    Function({
  Value<int> id,
  Value<DateTime> timestamp,
  required int moodLevel,
  Value<String?> notes,
  Value<String?> tags,
});
typedef $$MoodEntriesTableUpdateCompanionBuilder = MoodEntriesCompanion
    Function({
  Value<int> id,
  Value<DateTime> timestamp,
  Value<int> moodLevel,
  Value<String?> notes,
  Value<String?> tags,
});

class $$MoodEntriesTableFilterComposer
    extends Composer<_$WellnessDatabase, $MoodEntriesTable> {
  $$MoodEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get moodLevel => $composableBuilder(
      column: $table.moodLevel, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get notes => $composableBuilder(
      column: $table.notes, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get tags => $composableBuilder(
      column: $table.tags, builder: (column) => ColumnFilters(column));
}

class $$MoodEntriesTableOrderingComposer
    extends Composer<_$WellnessDatabase, $MoodEntriesTable> {
  $$MoodEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get moodLevel => $composableBuilder(
      column: $table.moodLevel, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get notes => $composableBuilder(
      column: $table.notes, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get tags => $composableBuilder(
      column: $table.tags, builder: (column) => ColumnOrderings(column));
}

class $$MoodEntriesTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $MoodEntriesTable> {
  $$MoodEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get timestamp =>
      $composableBuilder(column: $table.timestamp, builder: (column) => column);

  GeneratedColumn<int> get moodLevel =>
      $composableBuilder(column: $table.moodLevel, builder: (column) => column);

  GeneratedColumn<String> get notes =>
      $composableBuilder(column: $table.notes, builder: (column) => column);

  GeneratedColumn<String> get tags =>
      $composableBuilder(column: $table.tags, builder: (column) => column);
}

class $$MoodEntriesTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $MoodEntriesTable,
    MoodEntry,
    $$MoodEntriesTableFilterComposer,
    $$MoodEntriesTableOrderingComposer,
    $$MoodEntriesTableAnnotationComposer,
    $$MoodEntriesTableCreateCompanionBuilder,
    $$MoodEntriesTableUpdateCompanionBuilder,
    (
      MoodEntry,
      BaseReferences<_$WellnessDatabase, $MoodEntriesTable, MoodEntry>
    ),
    MoodEntry,
    PrefetchHooks Function()> {
  $$MoodEntriesTableTableManager(_$WellnessDatabase db, $MoodEntriesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MoodEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MoodEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MoodEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            Value<int> moodLevel = const Value.absent(),
            Value<String?> notes = const Value.absent(),
            Value<String?> tags = const Value.absent(),
          }) =>
              MoodEntriesCompanion(
            id: id,
            timestamp: timestamp,
            moodLevel: moodLevel,
            notes: notes,
            tags: tags,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            required int moodLevel,
            Value<String?> notes = const Value.absent(),
            Value<String?> tags = const Value.absent(),
          }) =>
              MoodEntriesCompanion.insert(
            id: id,
            timestamp: timestamp,
            moodLevel: moodLevel,
            notes: notes,
            tags: tags,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$MoodEntriesTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $MoodEntriesTable,
    MoodEntry,
    $$MoodEntriesTableFilterComposer,
    $$MoodEntriesTableOrderingComposer,
    $$MoodEntriesTableAnnotationComposer,
    $$MoodEntriesTableCreateCompanionBuilder,
    $$MoodEntriesTableUpdateCompanionBuilder,
    (
      MoodEntry,
      BaseReferences<_$WellnessDatabase, $MoodEntriesTable, MoodEntry>
    ),
    MoodEntry,
    PrefetchHooks Function()>;
typedef $$WaterLogsTableCreateCompanionBuilder = WaterLogsCompanion Function({
  Value<int> id,
  Value<DateTime> timestamp,
  required int amountMl,
});
typedef $$WaterLogsTableUpdateCompanionBuilder = WaterLogsCompanion Function({
  Value<int> id,
  Value<DateTime> timestamp,
  Value<int> amountMl,
});

class $$WaterLogsTableFilterComposer
    extends Composer<_$WellnessDatabase, $WaterLogsTable> {
  $$WaterLogsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get amountMl => $composableBuilder(
      column: $table.amountMl, builder: (column) => ColumnFilters(column));
}

class $$WaterLogsTableOrderingComposer
    extends Composer<_$WellnessDatabase, $WaterLogsTable> {
  $$WaterLogsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get amountMl => $composableBuilder(
      column: $table.amountMl, builder: (column) => ColumnOrderings(column));
}

class $$WaterLogsTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $WaterLogsTable> {
  $$WaterLogsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get timestamp =>
      $composableBuilder(column: $table.timestamp, builder: (column) => column);

  GeneratedColumn<int> get amountMl =>
      $composableBuilder(column: $table.amountMl, builder: (column) => column);
}

class $$WaterLogsTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $WaterLogsTable,
    WaterLog,
    $$WaterLogsTableFilterComposer,
    $$WaterLogsTableOrderingComposer,
    $$WaterLogsTableAnnotationComposer,
    $$WaterLogsTableCreateCompanionBuilder,
    $$WaterLogsTableUpdateCompanionBuilder,
    (WaterLog, BaseReferences<_$WellnessDatabase, $WaterLogsTable, WaterLog>),
    WaterLog,
    PrefetchHooks Function()> {
  $$WaterLogsTableTableManager(_$WellnessDatabase db, $WaterLogsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$WaterLogsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$WaterLogsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$WaterLogsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            Value<int> amountMl = const Value.absent(),
          }) =>
              WaterLogsCompanion(
            id: id,
            timestamp: timestamp,
            amountMl: amountMl,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            required int amountMl,
          }) =>
              WaterLogsCompanion.insert(
            id: id,
            timestamp: timestamp,
            amountMl: amountMl,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$WaterLogsTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $WaterLogsTable,
    WaterLog,
    $$WaterLogsTableFilterComposer,
    $$WaterLogsTableOrderingComposer,
    $$WaterLogsTableAnnotationComposer,
    $$WaterLogsTableCreateCompanionBuilder,
    $$WaterLogsTableUpdateCompanionBuilder,
    (WaterLog, BaseReferences<_$WellnessDatabase, $WaterLogsTable, WaterLog>),
    WaterLog,
    PrefetchHooks Function()>;
typedef $$SleepLogsTableCreateCompanionBuilder = SleepLogsCompanion Function({
  Value<int> id,
  required DateTime date,
  required DateTime bedtime,
  required DateTime wakeTime,
  Value<int?> quality,
});
typedef $$SleepLogsTableUpdateCompanionBuilder = SleepLogsCompanion Function({
  Value<int> id,
  Value<DateTime> date,
  Value<DateTime> bedtime,
  Value<DateTime> wakeTime,
  Value<int?> quality,
});

class $$SleepLogsTableFilterComposer
    extends Composer<_$WellnessDatabase, $SleepLogsTable> {
  $$SleepLogsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get bedtime => $composableBuilder(
      column: $table.bedtime, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get wakeTime => $composableBuilder(
      column: $table.wakeTime, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get quality => $composableBuilder(
      column: $table.quality, builder: (column) => ColumnFilters(column));
}

class $$SleepLogsTableOrderingComposer
    extends Composer<_$WellnessDatabase, $SleepLogsTable> {
  $$SleepLogsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get bedtime => $composableBuilder(
      column: $table.bedtime, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get wakeTime => $composableBuilder(
      column: $table.wakeTime, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get quality => $composableBuilder(
      column: $table.quality, builder: (column) => ColumnOrderings(column));
}

class $$SleepLogsTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $SleepLogsTable> {
  $$SleepLogsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get date =>
      $composableBuilder(column: $table.date, builder: (column) => column);

  GeneratedColumn<DateTime> get bedtime =>
      $composableBuilder(column: $table.bedtime, builder: (column) => column);

  GeneratedColumn<DateTime> get wakeTime =>
      $composableBuilder(column: $table.wakeTime, builder: (column) => column);

  GeneratedColumn<int> get quality =>
      $composableBuilder(column: $table.quality, builder: (column) => column);
}

class $$SleepLogsTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $SleepLogsTable,
    SleepLog,
    $$SleepLogsTableFilterComposer,
    $$SleepLogsTableOrderingComposer,
    $$SleepLogsTableAnnotationComposer,
    $$SleepLogsTableCreateCompanionBuilder,
    $$SleepLogsTableUpdateCompanionBuilder,
    (SleepLog, BaseReferences<_$WellnessDatabase, $SleepLogsTable, SleepLog>),
    SleepLog,
    PrefetchHooks Function()> {
  $$SleepLogsTableTableManager(_$WellnessDatabase db, $SleepLogsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SleepLogsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SleepLogsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SleepLogsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> date = const Value.absent(),
            Value<DateTime> bedtime = const Value.absent(),
            Value<DateTime> wakeTime = const Value.absent(),
            Value<int?> quality = const Value.absent(),
          }) =>
              SleepLogsCompanion(
            id: id,
            date: date,
            bedtime: bedtime,
            wakeTime: wakeTime,
            quality: quality,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required DateTime date,
            required DateTime bedtime,
            required DateTime wakeTime,
            Value<int?> quality = const Value.absent(),
          }) =>
              SleepLogsCompanion.insert(
            id: id,
            date: date,
            bedtime: bedtime,
            wakeTime: wakeTime,
            quality: quality,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$SleepLogsTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $SleepLogsTable,
    SleepLog,
    $$SleepLogsTableFilterComposer,
    $$SleepLogsTableOrderingComposer,
    $$SleepLogsTableAnnotationComposer,
    $$SleepLogsTableCreateCompanionBuilder,
    $$SleepLogsTableUpdateCompanionBuilder,
    (SleepLog, BaseReferences<_$WellnessDatabase, $SleepLogsTable, SleepLog>),
    SleepLog,
    PrefetchHooks Function()>;
typedef $$ExerciseLogsTableCreateCompanionBuilder = ExerciseLogsCompanion
    Function({
  Value<int> id,
  Value<DateTime> timestamp,
  required String type,
  required int durationMin,
  Value<int?> calories,
});
typedef $$ExerciseLogsTableUpdateCompanionBuilder = ExerciseLogsCompanion
    Function({
  Value<int> id,
  Value<DateTime> timestamp,
  Value<String> type,
  Value<int> durationMin,
  Value<int?> calories,
});

class $$ExerciseLogsTableFilterComposer
    extends Composer<_$WellnessDatabase, $ExerciseLogsTable> {
  $$ExerciseLogsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get type => $composableBuilder(
      column: $table.type, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get durationMin => $composableBuilder(
      column: $table.durationMin, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get calories => $composableBuilder(
      column: $table.calories, builder: (column) => ColumnFilters(column));
}

class $$ExerciseLogsTableOrderingComposer
    extends Composer<_$WellnessDatabase, $ExerciseLogsTable> {
  $$ExerciseLogsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get type => $composableBuilder(
      column: $table.type, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get durationMin => $composableBuilder(
      column: $table.durationMin, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get calories => $composableBuilder(
      column: $table.calories, builder: (column) => ColumnOrderings(column));
}

class $$ExerciseLogsTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $ExerciseLogsTable> {
  $$ExerciseLogsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get timestamp =>
      $composableBuilder(column: $table.timestamp, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<int> get durationMin => $composableBuilder(
      column: $table.durationMin, builder: (column) => column);

  GeneratedColumn<int> get calories =>
      $composableBuilder(column: $table.calories, builder: (column) => column);
}

class $$ExerciseLogsTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $ExerciseLogsTable,
    ExerciseLog,
    $$ExerciseLogsTableFilterComposer,
    $$ExerciseLogsTableOrderingComposer,
    $$ExerciseLogsTableAnnotationComposer,
    $$ExerciseLogsTableCreateCompanionBuilder,
    $$ExerciseLogsTableUpdateCompanionBuilder,
    (
      ExerciseLog,
      BaseReferences<_$WellnessDatabase, $ExerciseLogsTable, ExerciseLog>
    ),
    ExerciseLog,
    PrefetchHooks Function()> {
  $$ExerciseLogsTableTableManager(
      _$WellnessDatabase db, $ExerciseLogsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ExerciseLogsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ExerciseLogsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ExerciseLogsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            Value<String> type = const Value.absent(),
            Value<int> durationMin = const Value.absent(),
            Value<int?> calories = const Value.absent(),
          }) =>
              ExerciseLogsCompanion(
            id: id,
            timestamp: timestamp,
            type: type,
            durationMin: durationMin,
            calories: calories,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            required String type,
            required int durationMin,
            Value<int?> calories = const Value.absent(),
          }) =>
              ExerciseLogsCompanion.insert(
            id: id,
            timestamp: timestamp,
            type: type,
            durationMin: durationMin,
            calories: calories,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$ExerciseLogsTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $ExerciseLogsTable,
    ExerciseLog,
    $$ExerciseLogsTableFilterComposer,
    $$ExerciseLogsTableOrderingComposer,
    $$ExerciseLogsTableAnnotationComposer,
    $$ExerciseLogsTableCreateCompanionBuilder,
    $$ExerciseLogsTableUpdateCompanionBuilder,
    (
      ExerciseLog,
      BaseReferences<_$WellnessDatabase, $ExerciseLogsTable, ExerciseLog>
    ),
    ExerciseLog,
    PrefetchHooks Function()>;
typedef $$HealthGoalsTableCreateCompanionBuilder = HealthGoalsCompanion
    Function({
  Value<int> id,
  required String title,
  required double target,
  Value<double> current,
  required String unit,
  Value<DateTime?> deadline,
  Value<bool> active,
});
typedef $$HealthGoalsTableUpdateCompanionBuilder = HealthGoalsCompanion
    Function({
  Value<int> id,
  Value<String> title,
  Value<double> target,
  Value<double> current,
  Value<String> unit,
  Value<DateTime?> deadline,
  Value<bool> active,
});

class $$HealthGoalsTableFilterComposer
    extends Composer<_$WellnessDatabase, $HealthGoalsTable> {
  $$HealthGoalsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get target => $composableBuilder(
      column: $table.target, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get current => $composableBuilder(
      column: $table.current, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get unit => $composableBuilder(
      column: $table.unit, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get deadline => $composableBuilder(
      column: $table.deadline, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get active => $composableBuilder(
      column: $table.active, builder: (column) => ColumnFilters(column));
}

class $$HealthGoalsTableOrderingComposer
    extends Composer<_$WellnessDatabase, $HealthGoalsTable> {
  $$HealthGoalsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get target => $composableBuilder(
      column: $table.target, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get current => $composableBuilder(
      column: $table.current, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get unit => $composableBuilder(
      column: $table.unit, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get deadline => $composableBuilder(
      column: $table.deadline, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get active => $composableBuilder(
      column: $table.active, builder: (column) => ColumnOrderings(column));
}

class $$HealthGoalsTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $HealthGoalsTable> {
  $$HealthGoalsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<double> get target =>
      $composableBuilder(column: $table.target, builder: (column) => column);

  GeneratedColumn<double> get current =>
      $composableBuilder(column: $table.current, builder: (column) => column);

  GeneratedColumn<String> get unit =>
      $composableBuilder(column: $table.unit, builder: (column) => column);

  GeneratedColumn<DateTime> get deadline =>
      $composableBuilder(column: $table.deadline, builder: (column) => column);

  GeneratedColumn<bool> get active =>
      $composableBuilder(column: $table.active, builder: (column) => column);
}

class $$HealthGoalsTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $HealthGoalsTable,
    HealthGoal,
    $$HealthGoalsTableFilterComposer,
    $$HealthGoalsTableOrderingComposer,
    $$HealthGoalsTableAnnotationComposer,
    $$HealthGoalsTableCreateCompanionBuilder,
    $$HealthGoalsTableUpdateCompanionBuilder,
    (
      HealthGoal,
      BaseReferences<_$WellnessDatabase, $HealthGoalsTable, HealthGoal>
    ),
    HealthGoal,
    PrefetchHooks Function()> {
  $$HealthGoalsTableTableManager(_$WellnessDatabase db, $HealthGoalsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$HealthGoalsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$HealthGoalsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$HealthGoalsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> title = const Value.absent(),
            Value<double> target = const Value.absent(),
            Value<double> current = const Value.absent(),
            Value<String> unit = const Value.absent(),
            Value<DateTime?> deadline = const Value.absent(),
            Value<bool> active = const Value.absent(),
          }) =>
              HealthGoalsCompanion(
            id: id,
            title: title,
            target: target,
            current: current,
            unit: unit,
            deadline: deadline,
            active: active,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String title,
            required double target,
            Value<double> current = const Value.absent(),
            required String unit,
            Value<DateTime?> deadline = const Value.absent(),
            Value<bool> active = const Value.absent(),
          }) =>
              HealthGoalsCompanion.insert(
            id: id,
            title: title,
            target: target,
            current: current,
            unit: unit,
            deadline: deadline,
            active: active,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$HealthGoalsTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $HealthGoalsTable,
    HealthGoal,
    $$HealthGoalsTableFilterComposer,
    $$HealthGoalsTableOrderingComposer,
    $$HealthGoalsTableAnnotationComposer,
    $$HealthGoalsTableCreateCompanionBuilder,
    $$HealthGoalsTableUpdateCompanionBuilder,
    (
      HealthGoal,
      BaseReferences<_$WellnessDatabase, $HealthGoalsTable, HealthGoal>
    ),
    HealthGoal,
    PrefetchHooks Function()>;
typedef $$MedicationRemindersTableCreateCompanionBuilder
    = MedicationRemindersCompanion Function({
  Value<int> id,
  required String name,
  required String dosage,
  required String frequency,
  required String times,
  Value<bool> active,
});
typedef $$MedicationRemindersTableUpdateCompanionBuilder
    = MedicationRemindersCompanion Function({
  Value<int> id,
  Value<String> name,
  Value<String> dosage,
  Value<String> frequency,
  Value<String> times,
  Value<bool> active,
});

class $$MedicationRemindersTableFilterComposer
    extends Composer<_$WellnessDatabase, $MedicationRemindersTable> {
  $$MedicationRemindersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dosage => $composableBuilder(
      column: $table.dosage, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get frequency => $composableBuilder(
      column: $table.frequency, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get times => $composableBuilder(
      column: $table.times, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get active => $composableBuilder(
      column: $table.active, builder: (column) => ColumnFilters(column));
}

class $$MedicationRemindersTableOrderingComposer
    extends Composer<_$WellnessDatabase, $MedicationRemindersTable> {
  $$MedicationRemindersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get name => $composableBuilder(
      column: $table.name, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dosage => $composableBuilder(
      column: $table.dosage, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get frequency => $composableBuilder(
      column: $table.frequency, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get times => $composableBuilder(
      column: $table.times, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get active => $composableBuilder(
      column: $table.active, builder: (column) => ColumnOrderings(column));
}

class $$MedicationRemindersTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $MedicationRemindersTable> {
  $$MedicationRemindersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get dosage =>
      $composableBuilder(column: $table.dosage, builder: (column) => column);

  GeneratedColumn<String> get frequency =>
      $composableBuilder(column: $table.frequency, builder: (column) => column);

  GeneratedColumn<String> get times =>
      $composableBuilder(column: $table.times, builder: (column) => column);

  GeneratedColumn<bool> get active =>
      $composableBuilder(column: $table.active, builder: (column) => column);
}

class $$MedicationRemindersTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $MedicationRemindersTable,
    MedicationReminder,
    $$MedicationRemindersTableFilterComposer,
    $$MedicationRemindersTableOrderingComposer,
    $$MedicationRemindersTableAnnotationComposer,
    $$MedicationRemindersTableCreateCompanionBuilder,
    $$MedicationRemindersTableUpdateCompanionBuilder,
    (
      MedicationReminder,
      BaseReferences<_$WellnessDatabase, $MedicationRemindersTable,
          MedicationReminder>
    ),
    MedicationReminder,
    PrefetchHooks Function()> {
  $$MedicationRemindersTableTableManager(
      _$WellnessDatabase db, $MedicationRemindersTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MedicationRemindersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MedicationRemindersTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MedicationRemindersTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> name = const Value.absent(),
            Value<String> dosage = const Value.absent(),
            Value<String> frequency = const Value.absent(),
            Value<String> times = const Value.absent(),
            Value<bool> active = const Value.absent(),
          }) =>
              MedicationRemindersCompanion(
            id: id,
            name: name,
            dosage: dosage,
            frequency: frequency,
            times: times,
            active: active,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String name,
            required String dosage,
            required String frequency,
            required String times,
            Value<bool> active = const Value.absent(),
          }) =>
              MedicationRemindersCompanion.insert(
            id: id,
            name: name,
            dosage: dosage,
            frequency: frequency,
            times: times,
            active: active,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$MedicationRemindersTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $MedicationRemindersTable,
    MedicationReminder,
    $$MedicationRemindersTableFilterComposer,
    $$MedicationRemindersTableOrderingComposer,
    $$MedicationRemindersTableAnnotationComposer,
    $$MedicationRemindersTableCreateCompanionBuilder,
    $$MedicationRemindersTableUpdateCompanionBuilder,
    (
      MedicationReminder,
      BaseReferences<_$WellnessDatabase, $MedicationRemindersTable,
          MedicationReminder>
    ),
    MedicationReminder,
    PrefetchHooks Function()>;
typedef $$PeriodTrackingTableCreateCompanionBuilder = PeriodTrackingCompanion
    Function({
  Value<int> id,
  required DateTime date,
  required int flowLevel,
  Value<String?> symptoms,
  Value<String?> notes,
});
typedef $$PeriodTrackingTableUpdateCompanionBuilder = PeriodTrackingCompanion
    Function({
  Value<int> id,
  Value<DateTime> date,
  Value<int> flowLevel,
  Value<String?> symptoms,
  Value<String?> notes,
});

class $$PeriodTrackingTableFilterComposer
    extends Composer<_$WellnessDatabase, $PeriodTrackingTable> {
  $$PeriodTrackingTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get flowLevel => $composableBuilder(
      column: $table.flowLevel, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get symptoms => $composableBuilder(
      column: $table.symptoms, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get notes => $composableBuilder(
      column: $table.notes, builder: (column) => ColumnFilters(column));
}

class $$PeriodTrackingTableOrderingComposer
    extends Composer<_$WellnessDatabase, $PeriodTrackingTable> {
  $$PeriodTrackingTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get flowLevel => $composableBuilder(
      column: $table.flowLevel, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get symptoms => $composableBuilder(
      column: $table.symptoms, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get notes => $composableBuilder(
      column: $table.notes, builder: (column) => ColumnOrderings(column));
}

class $$PeriodTrackingTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $PeriodTrackingTable> {
  $$PeriodTrackingTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get date =>
      $composableBuilder(column: $table.date, builder: (column) => column);

  GeneratedColumn<int> get flowLevel =>
      $composableBuilder(column: $table.flowLevel, builder: (column) => column);

  GeneratedColumn<String> get symptoms =>
      $composableBuilder(column: $table.symptoms, builder: (column) => column);

  GeneratedColumn<String> get notes =>
      $composableBuilder(column: $table.notes, builder: (column) => column);
}

class $$PeriodTrackingTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $PeriodTrackingTable,
    PeriodTrackingData,
    $$PeriodTrackingTableFilterComposer,
    $$PeriodTrackingTableOrderingComposer,
    $$PeriodTrackingTableAnnotationComposer,
    $$PeriodTrackingTableCreateCompanionBuilder,
    $$PeriodTrackingTableUpdateCompanionBuilder,
    (
      PeriodTrackingData,
      BaseReferences<_$WellnessDatabase, $PeriodTrackingTable,
          PeriodTrackingData>
    ),
    PeriodTrackingData,
    PrefetchHooks Function()> {
  $$PeriodTrackingTableTableManager(
      _$WellnessDatabase db, $PeriodTrackingTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PeriodTrackingTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PeriodTrackingTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PeriodTrackingTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> date = const Value.absent(),
            Value<int> flowLevel = const Value.absent(),
            Value<String?> symptoms = const Value.absent(),
            Value<String?> notes = const Value.absent(),
          }) =>
              PeriodTrackingCompanion(
            id: id,
            date: date,
            flowLevel: flowLevel,
            symptoms: symptoms,
            notes: notes,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required DateTime date,
            required int flowLevel,
            Value<String?> symptoms = const Value.absent(),
            Value<String?> notes = const Value.absent(),
          }) =>
              PeriodTrackingCompanion.insert(
            id: id,
            date: date,
            flowLevel: flowLevel,
            symptoms: symptoms,
            notes: notes,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$PeriodTrackingTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $PeriodTrackingTable,
    PeriodTrackingData,
    $$PeriodTrackingTableFilterComposer,
    $$PeriodTrackingTableOrderingComposer,
    $$PeriodTrackingTableAnnotationComposer,
    $$PeriodTrackingTableCreateCompanionBuilder,
    $$PeriodTrackingTableUpdateCompanionBuilder,
    (
      PeriodTrackingData,
      BaseReferences<_$WellnessDatabase, $PeriodTrackingTable,
          PeriodTrackingData>
    ),
    PeriodTrackingData,
    PrefetchHooks Function()>;
typedef $$JournalEntriesTableCreateCompanionBuilder = JournalEntriesCompanion
    Function({
  Value<int> id,
  Value<DateTime> timestamp,
  required String content,
  Value<String?> moodTag,
});
typedef $$JournalEntriesTableUpdateCompanionBuilder = JournalEntriesCompanion
    Function({
  Value<int> id,
  Value<DateTime> timestamp,
  Value<String> content,
  Value<String?> moodTag,
});

class $$JournalEntriesTableFilterComposer
    extends Composer<_$WellnessDatabase, $JournalEntriesTable> {
  $$JournalEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get content => $composableBuilder(
      column: $table.content, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get moodTag => $composableBuilder(
      column: $table.moodTag, builder: (column) => ColumnFilters(column));
}

class $$JournalEntriesTableOrderingComposer
    extends Composer<_$WellnessDatabase, $JournalEntriesTable> {
  $$JournalEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get timestamp => $composableBuilder(
      column: $table.timestamp, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get content => $composableBuilder(
      column: $table.content, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get moodTag => $composableBuilder(
      column: $table.moodTag, builder: (column) => ColumnOrderings(column));
}

class $$JournalEntriesTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $JournalEntriesTable> {
  $$JournalEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get timestamp =>
      $composableBuilder(column: $table.timestamp, builder: (column) => column);

  GeneratedColumn<String> get content =>
      $composableBuilder(column: $table.content, builder: (column) => column);

  GeneratedColumn<String> get moodTag =>
      $composableBuilder(column: $table.moodTag, builder: (column) => column);
}

class $$JournalEntriesTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $JournalEntriesTable,
    JournalEntry,
    $$JournalEntriesTableFilterComposer,
    $$JournalEntriesTableOrderingComposer,
    $$JournalEntriesTableAnnotationComposer,
    $$JournalEntriesTableCreateCompanionBuilder,
    $$JournalEntriesTableUpdateCompanionBuilder,
    (
      JournalEntry,
      BaseReferences<_$WellnessDatabase, $JournalEntriesTable, JournalEntry>
    ),
    JournalEntry,
    PrefetchHooks Function()> {
  $$JournalEntriesTableTableManager(
      _$WellnessDatabase db, $JournalEntriesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$JournalEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$JournalEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$JournalEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            Value<String> content = const Value.absent(),
            Value<String?> moodTag = const Value.absent(),
          }) =>
              JournalEntriesCompanion(
            id: id,
            timestamp: timestamp,
            content: content,
            moodTag: moodTag,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> timestamp = const Value.absent(),
            required String content,
            Value<String?> moodTag = const Value.absent(),
          }) =>
              JournalEntriesCompanion.insert(
            id: id,
            timestamp: timestamp,
            content: content,
            moodTag: moodTag,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$JournalEntriesTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $JournalEntriesTable,
    JournalEntry,
    $$JournalEntriesTableFilterComposer,
    $$JournalEntriesTableOrderingComposer,
    $$JournalEntriesTableAnnotationComposer,
    $$JournalEntriesTableCreateCompanionBuilder,
    $$JournalEntriesTableUpdateCompanionBuilder,
    (
      JournalEntry,
      BaseReferences<_$WellnessDatabase, $JournalEntriesTable, JournalEntry>
    ),
    JournalEntry,
    PrefetchHooks Function()>;
typedef $$AssessmentResultsTableCreateCompanionBuilder
    = AssessmentResultsCompanion Function({
  Value<int> id,
  required String type,
  required int score,
  Value<DateTime> date,
  required String answersJson,
});
typedef $$AssessmentResultsTableUpdateCompanionBuilder
    = AssessmentResultsCompanion Function({
  Value<int> id,
  Value<String> type,
  Value<int> score,
  Value<DateTime> date,
  Value<String> answersJson,
});

class $$AssessmentResultsTableFilterComposer
    extends Composer<_$WellnessDatabase, $AssessmentResultsTable> {
  $$AssessmentResultsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get type => $composableBuilder(
      column: $table.type, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get score => $composableBuilder(
      column: $table.score, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get answersJson => $composableBuilder(
      column: $table.answersJson, builder: (column) => ColumnFilters(column));
}

class $$AssessmentResultsTableOrderingComposer
    extends Composer<_$WellnessDatabase, $AssessmentResultsTable> {
  $$AssessmentResultsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get type => $composableBuilder(
      column: $table.type, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get score => $composableBuilder(
      column: $table.score, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get answersJson => $composableBuilder(
      column: $table.answersJson, builder: (column) => ColumnOrderings(column));
}

class $$AssessmentResultsTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $AssessmentResultsTable> {
  $$AssessmentResultsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<int> get score =>
      $composableBuilder(column: $table.score, builder: (column) => column);

  GeneratedColumn<DateTime> get date =>
      $composableBuilder(column: $table.date, builder: (column) => column);

  GeneratedColumn<String> get answersJson => $composableBuilder(
      column: $table.answersJson, builder: (column) => column);
}

class $$AssessmentResultsTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $AssessmentResultsTable,
    AssessmentResult,
    $$AssessmentResultsTableFilterComposer,
    $$AssessmentResultsTableOrderingComposer,
    $$AssessmentResultsTableAnnotationComposer,
    $$AssessmentResultsTableCreateCompanionBuilder,
    $$AssessmentResultsTableUpdateCompanionBuilder,
    (
      AssessmentResult,
      BaseReferences<_$WellnessDatabase, $AssessmentResultsTable,
          AssessmentResult>
    ),
    AssessmentResult,
    PrefetchHooks Function()> {
  $$AssessmentResultsTableTableManager(
      _$WellnessDatabase db, $AssessmentResultsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$AssessmentResultsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$AssessmentResultsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$AssessmentResultsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> type = const Value.absent(),
            Value<int> score = const Value.absent(),
            Value<DateTime> date = const Value.absent(),
            Value<String> answersJson = const Value.absent(),
          }) =>
              AssessmentResultsCompanion(
            id: id,
            type: type,
            score: score,
            date: date,
            answersJson: answersJson,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String type,
            required int score,
            Value<DateTime> date = const Value.absent(),
            required String answersJson,
          }) =>
              AssessmentResultsCompanion.insert(
            id: id,
            type: type,
            score: score,
            date: date,
            answersJson: answersJson,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$AssessmentResultsTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $AssessmentResultsTable,
    AssessmentResult,
    $$AssessmentResultsTableFilterComposer,
    $$AssessmentResultsTableOrderingComposer,
    $$AssessmentResultsTableAnnotationComposer,
    $$AssessmentResultsTableCreateCompanionBuilder,
    $$AssessmentResultsTableUpdateCompanionBuilder,
    (
      AssessmentResult,
      BaseReferences<_$WellnessDatabase, $AssessmentResultsTable,
          AssessmentResult>
    ),
    AssessmentResult,
    PrefetchHooks Function()>;
typedef $$DailyStepsTableCreateCompanionBuilder = DailyStepsCompanion Function({
  Value<int> id,
  required DateTime date,
  required int count,
  Value<String> source,
});
typedef $$DailyStepsTableUpdateCompanionBuilder = DailyStepsCompanion Function({
  Value<int> id,
  Value<DateTime> date,
  Value<int> count,
  Value<String> source,
});

class $$DailyStepsTableFilterComposer
    extends Composer<_$WellnessDatabase, $DailyStepsTable> {
  $$DailyStepsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get count => $composableBuilder(
      column: $table.count, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get source => $composableBuilder(
      column: $table.source, builder: (column) => ColumnFilters(column));
}

class $$DailyStepsTableOrderingComposer
    extends Composer<_$WellnessDatabase, $DailyStepsTable> {
  $$DailyStepsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get count => $composableBuilder(
      column: $table.count, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get source => $composableBuilder(
      column: $table.source, builder: (column) => ColumnOrderings(column));
}

class $$DailyStepsTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $DailyStepsTable> {
  $$DailyStepsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get date =>
      $composableBuilder(column: $table.date, builder: (column) => column);

  GeneratedColumn<int> get count =>
      $composableBuilder(column: $table.count, builder: (column) => column);

  GeneratedColumn<String> get source =>
      $composableBuilder(column: $table.source, builder: (column) => column);
}

class $$DailyStepsTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $DailyStepsTable,
    DailyStep,
    $$DailyStepsTableFilterComposer,
    $$DailyStepsTableOrderingComposer,
    $$DailyStepsTableAnnotationComposer,
    $$DailyStepsTableCreateCompanionBuilder,
    $$DailyStepsTableUpdateCompanionBuilder,
    (
      DailyStep,
      BaseReferences<_$WellnessDatabase, $DailyStepsTable, DailyStep>
    ),
    DailyStep,
    PrefetchHooks Function()> {
  $$DailyStepsTableTableManager(_$WellnessDatabase db, $DailyStepsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$DailyStepsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$DailyStepsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$DailyStepsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<DateTime> date = const Value.absent(),
            Value<int> count = const Value.absent(),
            Value<String> source = const Value.absent(),
          }) =>
              DailyStepsCompanion(
            id: id,
            date: date,
            count: count,
            source: source,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required DateTime date,
            required int count,
            Value<String> source = const Value.absent(),
          }) =>
              DailyStepsCompanion.insert(
            id: id,
            date: date,
            count: count,
            source: source,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$DailyStepsTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $DailyStepsTable,
    DailyStep,
    $$DailyStepsTableFilterComposer,
    $$DailyStepsTableOrderingComposer,
    $$DailyStepsTableAnnotationComposer,
    $$DailyStepsTableCreateCompanionBuilder,
    $$DailyStepsTableUpdateCompanionBuilder,
    (
      DailyStep,
      BaseReferences<_$WellnessDatabase, $DailyStepsTable, DailyStep>
    ),
    DailyStep,
    PrefetchHooks Function()>;
typedef $$SyncQueueTableCreateCompanionBuilder = SyncQueueCompanion Function({
  Value<int> id,
  required String targetTable,
  required int rowId,
  required String action,
  Value<DateTime> createdAt,
  Value<DateTime?> syncedAt,
});
typedef $$SyncQueueTableUpdateCompanionBuilder = SyncQueueCompanion Function({
  Value<int> id,
  Value<String> targetTable,
  Value<int> rowId,
  Value<String> action,
  Value<DateTime> createdAt,
  Value<DateTime?> syncedAt,
});

class $$SyncQueueTableFilterComposer
    extends Composer<_$WellnessDatabase, $SyncQueueTable> {
  $$SyncQueueTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get targetTable => $composableBuilder(
      column: $table.targetTable, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get rowId => $composableBuilder(
      column: $table.rowId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get action => $composableBuilder(
      column: $table.action, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get syncedAt => $composableBuilder(
      column: $table.syncedAt, builder: (column) => ColumnFilters(column));
}

class $$SyncQueueTableOrderingComposer
    extends Composer<_$WellnessDatabase, $SyncQueueTable> {
  $$SyncQueueTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get targetTable => $composableBuilder(
      column: $table.targetTable, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get rowId => $composableBuilder(
      column: $table.rowId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get action => $composableBuilder(
      column: $table.action, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get syncedAt => $composableBuilder(
      column: $table.syncedAt, builder: (column) => ColumnOrderings(column));
}

class $$SyncQueueTableAnnotationComposer
    extends Composer<_$WellnessDatabase, $SyncQueueTable> {
  $$SyncQueueTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get targetTable => $composableBuilder(
      column: $table.targetTable, builder: (column) => column);

  GeneratedColumn<int> get rowId =>
      $composableBuilder(column: $table.rowId, builder: (column) => column);

  GeneratedColumn<String> get action =>
      $composableBuilder(column: $table.action, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get syncedAt =>
      $composableBuilder(column: $table.syncedAt, builder: (column) => column);
}

class $$SyncQueueTableTableManager extends RootTableManager<
    _$WellnessDatabase,
    $SyncQueueTable,
    SyncQueueData,
    $$SyncQueueTableFilterComposer,
    $$SyncQueueTableOrderingComposer,
    $$SyncQueueTableAnnotationComposer,
    $$SyncQueueTableCreateCompanionBuilder,
    $$SyncQueueTableUpdateCompanionBuilder,
    (
      SyncQueueData,
      BaseReferences<_$WellnessDatabase, $SyncQueueTable, SyncQueueData>
    ),
    SyncQueueData,
    PrefetchHooks Function()> {
  $$SyncQueueTableTableManager(_$WellnessDatabase db, $SyncQueueTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncQueueTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncQueueTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncQueueTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> targetTable = const Value.absent(),
            Value<int> rowId = const Value.absent(),
            Value<String> action = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<DateTime?> syncedAt = const Value.absent(),
          }) =>
              SyncQueueCompanion(
            id: id,
            targetTable: targetTable,
            rowId: rowId,
            action: action,
            createdAt: createdAt,
            syncedAt: syncedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String targetTable,
            required int rowId,
            required String action,
            Value<DateTime> createdAt = const Value.absent(),
            Value<DateTime?> syncedAt = const Value.absent(),
          }) =>
              SyncQueueCompanion.insert(
            id: id,
            targetTable: targetTable,
            rowId: rowId,
            action: action,
            createdAt: createdAt,
            syncedAt: syncedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$SyncQueueTableProcessedTableManager = ProcessedTableManager<
    _$WellnessDatabase,
    $SyncQueueTable,
    SyncQueueData,
    $$SyncQueueTableFilterComposer,
    $$SyncQueueTableOrderingComposer,
    $$SyncQueueTableAnnotationComposer,
    $$SyncQueueTableCreateCompanionBuilder,
    $$SyncQueueTableUpdateCompanionBuilder,
    (
      SyncQueueData,
      BaseReferences<_$WellnessDatabase, $SyncQueueTable, SyncQueueData>
    ),
    SyncQueueData,
    PrefetchHooks Function()>;

class $WellnessDatabaseManager {
  final _$WellnessDatabase _db;
  $WellnessDatabaseManager(this._db);
  $$MoodEntriesTableTableManager get moodEntries =>
      $$MoodEntriesTableTableManager(_db, _db.moodEntries);
  $$WaterLogsTableTableManager get waterLogs =>
      $$WaterLogsTableTableManager(_db, _db.waterLogs);
  $$SleepLogsTableTableManager get sleepLogs =>
      $$SleepLogsTableTableManager(_db, _db.sleepLogs);
  $$ExerciseLogsTableTableManager get exerciseLogs =>
      $$ExerciseLogsTableTableManager(_db, _db.exerciseLogs);
  $$HealthGoalsTableTableManager get healthGoals =>
      $$HealthGoalsTableTableManager(_db, _db.healthGoals);
  $$MedicationRemindersTableTableManager get medicationReminders =>
      $$MedicationRemindersTableTableManager(_db, _db.medicationReminders);
  $$PeriodTrackingTableTableManager get periodTracking =>
      $$PeriodTrackingTableTableManager(_db, _db.periodTracking);
  $$JournalEntriesTableTableManager get journalEntries =>
      $$JournalEntriesTableTableManager(_db, _db.journalEntries);
  $$AssessmentResultsTableTableManager get assessmentResults =>
      $$AssessmentResultsTableTableManager(_db, _db.assessmentResults);
  $$DailyStepsTableTableManager get dailySteps =>
      $$DailyStepsTableTableManager(_db, _db.dailySteps);
  $$SyncQueueTableTableManager get syncQueue =>
      $$SyncQueueTableTableManager(_db, _db.syncQueue);
}

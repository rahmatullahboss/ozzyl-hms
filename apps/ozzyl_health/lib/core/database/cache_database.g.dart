// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cache_database.dart';

// ignore_for_file: type=lint
class $CachedAppointmentsTable extends CachedAppointments
    with TableInfo<$CachedAppointmentsTable, CachedAppointment> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedAppointmentsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _remoteIdMeta =
      const VerificationMeta('remoteId');
  @override
  late final GeneratedColumn<String> remoteId = GeneratedColumn<String>(
      'remote_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _expiresAtMeta =
      const VerificationMeta('expiresAt');
  @override
  late final GeneratedColumn<DateTime> expiresAt = GeneratedColumn<DateTime>(
      'expires_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns =>
      [id, remoteId, dataJson, expiresAt, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_appointments';
  @override
  VerificationContext validateIntegrity(Insertable<CachedAppointment> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('remote_id')) {
      context.handle(_remoteIdMeta,
          remoteId.isAcceptableOrUnknown(data['remote_id']!, _remoteIdMeta));
    } else if (isInserting) {
      context.missing(_remoteIdMeta);
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('expires_at')) {
      context.handle(_expiresAtMeta,
          expiresAt.isAcceptableOrUnknown(data['expires_at']!, _expiresAtMeta));
    } else if (isInserting) {
      context.missing(_expiresAtMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedAppointment map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedAppointment(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      remoteId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_id'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      expiresAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}expires_at'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedAppointmentsTable createAlias(String alias) {
    return $CachedAppointmentsTable(attachedDatabase, alias);
  }
}

class CachedAppointment extends DataClass
    implements Insertable<CachedAppointment> {
  final int id;
  final String remoteId;
  final String dataJson;
  final DateTime expiresAt;
  final DateTime cachedAt;
  const CachedAppointment(
      {required this.id,
      required this.remoteId,
      required this.dataJson,
      required this.expiresAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['remote_id'] = Variable<String>(remoteId);
    map['data_json'] = Variable<String>(dataJson);
    map['expires_at'] = Variable<DateTime>(expiresAt);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedAppointmentsCompanion toCompanion(bool nullToAbsent) {
    return CachedAppointmentsCompanion(
      id: Value(id),
      remoteId: Value(remoteId),
      dataJson: Value(dataJson),
      expiresAt: Value(expiresAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedAppointment.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedAppointment(
      id: serializer.fromJson<int>(json['id']),
      remoteId: serializer.fromJson<String>(json['remoteId']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      expiresAt: serializer.fromJson<DateTime>(json['expiresAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'remoteId': serializer.toJson<String>(remoteId),
      'dataJson': serializer.toJson<String>(dataJson),
      'expiresAt': serializer.toJson<DateTime>(expiresAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedAppointment copyWith(
          {int? id,
          String? remoteId,
          String? dataJson,
          DateTime? expiresAt,
          DateTime? cachedAt}) =>
      CachedAppointment(
        id: id ?? this.id,
        remoteId: remoteId ?? this.remoteId,
        dataJson: dataJson ?? this.dataJson,
        expiresAt: expiresAt ?? this.expiresAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedAppointment copyWithCompanion(CachedAppointmentsCompanion data) {
    return CachedAppointment(
      id: data.id.present ? data.id.value : this.id,
      remoteId: data.remoteId.present ? data.remoteId.value : this.remoteId,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      expiresAt: data.expiresAt.present ? data.expiresAt.value : this.expiresAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedAppointment(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, remoteId, dataJson, expiresAt, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedAppointment &&
          other.id == this.id &&
          other.remoteId == this.remoteId &&
          other.dataJson == this.dataJson &&
          other.expiresAt == this.expiresAt &&
          other.cachedAt == this.cachedAt);
}

class CachedAppointmentsCompanion extends UpdateCompanion<CachedAppointment> {
  final Value<int> id;
  final Value<String> remoteId;
  final Value<String> dataJson;
  final Value<DateTime> expiresAt;
  final Value<DateTime> cachedAt;
  const CachedAppointmentsCompanion({
    this.id = const Value.absent(),
    this.remoteId = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.expiresAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedAppointmentsCompanion.insert({
    this.id = const Value.absent(),
    required String remoteId,
    required String dataJson,
    required DateTime expiresAt,
    this.cachedAt = const Value.absent(),
  })  : remoteId = Value(remoteId),
        dataJson = Value(dataJson),
        expiresAt = Value(expiresAt);
  static Insertable<CachedAppointment> custom({
    Expression<int>? id,
    Expression<String>? remoteId,
    Expression<String>? dataJson,
    Expression<DateTime>? expiresAt,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (remoteId != null) 'remote_id': remoteId,
      if (dataJson != null) 'data_json': dataJson,
      if (expiresAt != null) 'expires_at': expiresAt,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedAppointmentsCompanion copyWith(
      {Value<int>? id,
      Value<String>? remoteId,
      Value<String>? dataJson,
      Value<DateTime>? expiresAt,
      Value<DateTime>? cachedAt}) {
    return CachedAppointmentsCompanion(
      id: id ?? this.id,
      remoteId: remoteId ?? this.remoteId,
      dataJson: dataJson ?? this.dataJson,
      expiresAt: expiresAt ?? this.expiresAt,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (remoteId.present) {
      map['remote_id'] = Variable<String>(remoteId.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (expiresAt.present) {
      map['expires_at'] = Variable<DateTime>(expiresAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedAppointmentsCompanion(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

class $CachedPrescriptionsTable extends CachedPrescriptions
    with TableInfo<$CachedPrescriptionsTable, CachedPrescription> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedPrescriptionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _remoteIdMeta =
      const VerificationMeta('remoteId');
  @override
  late final GeneratedColumn<String> remoteId = GeneratedColumn<String>(
      'remote_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _expiresAtMeta =
      const VerificationMeta('expiresAt');
  @override
  late final GeneratedColumn<DateTime> expiresAt = GeneratedColumn<DateTime>(
      'expires_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns =>
      [id, remoteId, dataJson, expiresAt, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_prescriptions';
  @override
  VerificationContext validateIntegrity(Insertable<CachedPrescription> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('remote_id')) {
      context.handle(_remoteIdMeta,
          remoteId.isAcceptableOrUnknown(data['remote_id']!, _remoteIdMeta));
    } else if (isInserting) {
      context.missing(_remoteIdMeta);
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('expires_at')) {
      context.handle(_expiresAtMeta,
          expiresAt.isAcceptableOrUnknown(data['expires_at']!, _expiresAtMeta));
    } else if (isInserting) {
      context.missing(_expiresAtMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedPrescription map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedPrescription(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      remoteId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_id'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      expiresAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}expires_at'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedPrescriptionsTable createAlias(String alias) {
    return $CachedPrescriptionsTable(attachedDatabase, alias);
  }
}

class CachedPrescription extends DataClass
    implements Insertable<CachedPrescription> {
  final int id;
  final String remoteId;
  final String dataJson;
  final DateTime expiresAt;
  final DateTime cachedAt;
  const CachedPrescription(
      {required this.id,
      required this.remoteId,
      required this.dataJson,
      required this.expiresAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['remote_id'] = Variable<String>(remoteId);
    map['data_json'] = Variable<String>(dataJson);
    map['expires_at'] = Variable<DateTime>(expiresAt);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedPrescriptionsCompanion toCompanion(bool nullToAbsent) {
    return CachedPrescriptionsCompanion(
      id: Value(id),
      remoteId: Value(remoteId),
      dataJson: Value(dataJson),
      expiresAt: Value(expiresAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedPrescription.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedPrescription(
      id: serializer.fromJson<int>(json['id']),
      remoteId: serializer.fromJson<String>(json['remoteId']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      expiresAt: serializer.fromJson<DateTime>(json['expiresAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'remoteId': serializer.toJson<String>(remoteId),
      'dataJson': serializer.toJson<String>(dataJson),
      'expiresAt': serializer.toJson<DateTime>(expiresAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedPrescription copyWith(
          {int? id,
          String? remoteId,
          String? dataJson,
          DateTime? expiresAt,
          DateTime? cachedAt}) =>
      CachedPrescription(
        id: id ?? this.id,
        remoteId: remoteId ?? this.remoteId,
        dataJson: dataJson ?? this.dataJson,
        expiresAt: expiresAt ?? this.expiresAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedPrescription copyWithCompanion(CachedPrescriptionsCompanion data) {
    return CachedPrescription(
      id: data.id.present ? data.id.value : this.id,
      remoteId: data.remoteId.present ? data.remoteId.value : this.remoteId,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      expiresAt: data.expiresAt.present ? data.expiresAt.value : this.expiresAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedPrescription(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, remoteId, dataJson, expiresAt, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedPrescription &&
          other.id == this.id &&
          other.remoteId == this.remoteId &&
          other.dataJson == this.dataJson &&
          other.expiresAt == this.expiresAt &&
          other.cachedAt == this.cachedAt);
}

class CachedPrescriptionsCompanion extends UpdateCompanion<CachedPrescription> {
  final Value<int> id;
  final Value<String> remoteId;
  final Value<String> dataJson;
  final Value<DateTime> expiresAt;
  final Value<DateTime> cachedAt;
  const CachedPrescriptionsCompanion({
    this.id = const Value.absent(),
    this.remoteId = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.expiresAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedPrescriptionsCompanion.insert({
    this.id = const Value.absent(),
    required String remoteId,
    required String dataJson,
    required DateTime expiresAt,
    this.cachedAt = const Value.absent(),
  })  : remoteId = Value(remoteId),
        dataJson = Value(dataJson),
        expiresAt = Value(expiresAt);
  static Insertable<CachedPrescription> custom({
    Expression<int>? id,
    Expression<String>? remoteId,
    Expression<String>? dataJson,
    Expression<DateTime>? expiresAt,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (remoteId != null) 'remote_id': remoteId,
      if (dataJson != null) 'data_json': dataJson,
      if (expiresAt != null) 'expires_at': expiresAt,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedPrescriptionsCompanion copyWith(
      {Value<int>? id,
      Value<String>? remoteId,
      Value<String>? dataJson,
      Value<DateTime>? expiresAt,
      Value<DateTime>? cachedAt}) {
    return CachedPrescriptionsCompanion(
      id: id ?? this.id,
      remoteId: remoteId ?? this.remoteId,
      dataJson: dataJson ?? this.dataJson,
      expiresAt: expiresAt ?? this.expiresAt,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (remoteId.present) {
      map['remote_id'] = Variable<String>(remoteId.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (expiresAt.present) {
      map['expires_at'] = Variable<DateTime>(expiresAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedPrescriptionsCompanion(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

class $CachedLabResultsTable extends CachedLabResults
    with TableInfo<$CachedLabResultsTable, CachedLabResult> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedLabResultsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _remoteIdMeta =
      const VerificationMeta('remoteId');
  @override
  late final GeneratedColumn<String> remoteId = GeneratedColumn<String>(
      'remote_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _expiresAtMeta =
      const VerificationMeta('expiresAt');
  @override
  late final GeneratedColumn<DateTime> expiresAt = GeneratedColumn<DateTime>(
      'expires_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns =>
      [id, remoteId, dataJson, expiresAt, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_lab_results';
  @override
  VerificationContext validateIntegrity(Insertable<CachedLabResult> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('remote_id')) {
      context.handle(_remoteIdMeta,
          remoteId.isAcceptableOrUnknown(data['remote_id']!, _remoteIdMeta));
    } else if (isInserting) {
      context.missing(_remoteIdMeta);
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('expires_at')) {
      context.handle(_expiresAtMeta,
          expiresAt.isAcceptableOrUnknown(data['expires_at']!, _expiresAtMeta));
    } else if (isInserting) {
      context.missing(_expiresAtMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedLabResult map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedLabResult(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      remoteId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_id'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      expiresAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}expires_at'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedLabResultsTable createAlias(String alias) {
    return $CachedLabResultsTable(attachedDatabase, alias);
  }
}

class CachedLabResult extends DataClass implements Insertable<CachedLabResult> {
  final int id;
  final String remoteId;
  final String dataJson;
  final DateTime expiresAt;
  final DateTime cachedAt;
  const CachedLabResult(
      {required this.id,
      required this.remoteId,
      required this.dataJson,
      required this.expiresAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['remote_id'] = Variable<String>(remoteId);
    map['data_json'] = Variable<String>(dataJson);
    map['expires_at'] = Variable<DateTime>(expiresAt);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedLabResultsCompanion toCompanion(bool nullToAbsent) {
    return CachedLabResultsCompanion(
      id: Value(id),
      remoteId: Value(remoteId),
      dataJson: Value(dataJson),
      expiresAt: Value(expiresAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedLabResult.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedLabResult(
      id: serializer.fromJson<int>(json['id']),
      remoteId: serializer.fromJson<String>(json['remoteId']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      expiresAt: serializer.fromJson<DateTime>(json['expiresAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'remoteId': serializer.toJson<String>(remoteId),
      'dataJson': serializer.toJson<String>(dataJson),
      'expiresAt': serializer.toJson<DateTime>(expiresAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedLabResult copyWith(
          {int? id,
          String? remoteId,
          String? dataJson,
          DateTime? expiresAt,
          DateTime? cachedAt}) =>
      CachedLabResult(
        id: id ?? this.id,
        remoteId: remoteId ?? this.remoteId,
        dataJson: dataJson ?? this.dataJson,
        expiresAt: expiresAt ?? this.expiresAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedLabResult copyWithCompanion(CachedLabResultsCompanion data) {
    return CachedLabResult(
      id: data.id.present ? data.id.value : this.id,
      remoteId: data.remoteId.present ? data.remoteId.value : this.remoteId,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      expiresAt: data.expiresAt.present ? data.expiresAt.value : this.expiresAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedLabResult(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, remoteId, dataJson, expiresAt, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedLabResult &&
          other.id == this.id &&
          other.remoteId == this.remoteId &&
          other.dataJson == this.dataJson &&
          other.expiresAt == this.expiresAt &&
          other.cachedAt == this.cachedAt);
}

class CachedLabResultsCompanion extends UpdateCompanion<CachedLabResult> {
  final Value<int> id;
  final Value<String> remoteId;
  final Value<String> dataJson;
  final Value<DateTime> expiresAt;
  final Value<DateTime> cachedAt;
  const CachedLabResultsCompanion({
    this.id = const Value.absent(),
    this.remoteId = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.expiresAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedLabResultsCompanion.insert({
    this.id = const Value.absent(),
    required String remoteId,
    required String dataJson,
    required DateTime expiresAt,
    this.cachedAt = const Value.absent(),
  })  : remoteId = Value(remoteId),
        dataJson = Value(dataJson),
        expiresAt = Value(expiresAt);
  static Insertable<CachedLabResult> custom({
    Expression<int>? id,
    Expression<String>? remoteId,
    Expression<String>? dataJson,
    Expression<DateTime>? expiresAt,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (remoteId != null) 'remote_id': remoteId,
      if (dataJson != null) 'data_json': dataJson,
      if (expiresAt != null) 'expires_at': expiresAt,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedLabResultsCompanion copyWith(
      {Value<int>? id,
      Value<String>? remoteId,
      Value<String>? dataJson,
      Value<DateTime>? expiresAt,
      Value<DateTime>? cachedAt}) {
    return CachedLabResultsCompanion(
      id: id ?? this.id,
      remoteId: remoteId ?? this.remoteId,
      dataJson: dataJson ?? this.dataJson,
      expiresAt: expiresAt ?? this.expiresAt,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (remoteId.present) {
      map['remote_id'] = Variable<String>(remoteId.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (expiresAt.present) {
      map['expires_at'] = Variable<DateTime>(expiresAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedLabResultsCompanion(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

class $CachedHealthRecordsTable extends CachedHealthRecords
    with TableInfo<$CachedHealthRecordsTable, CachedHealthRecord> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedHealthRecordsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _recordTypeMeta =
      const VerificationMeta('recordType');
  @override
  late final GeneratedColumn<String> recordType = GeneratedColumn<String>(
      'record_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _expiresAtMeta =
      const VerificationMeta('expiresAt');
  @override
  late final GeneratedColumn<DateTime> expiresAt = GeneratedColumn<DateTime>(
      'expires_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns =>
      [id, recordType, dataJson, expiresAt, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_health_records';
  @override
  VerificationContext validateIntegrity(Insertable<CachedHealthRecord> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('record_type')) {
      context.handle(
          _recordTypeMeta,
          recordType.isAcceptableOrUnknown(
              data['record_type']!, _recordTypeMeta));
    } else if (isInserting) {
      context.missing(_recordTypeMeta);
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('expires_at')) {
      context.handle(_expiresAtMeta,
          expiresAt.isAcceptableOrUnknown(data['expires_at']!, _expiresAtMeta));
    } else if (isInserting) {
      context.missing(_expiresAtMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedHealthRecord map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedHealthRecord(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      recordType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}record_type'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      expiresAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}expires_at'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedHealthRecordsTable createAlias(String alias) {
    return $CachedHealthRecordsTable(attachedDatabase, alias);
  }
}

class CachedHealthRecord extends DataClass
    implements Insertable<CachedHealthRecord> {
  final int id;
  final String recordType;
  final String dataJson;
  final DateTime expiresAt;
  final DateTime cachedAt;
  const CachedHealthRecord(
      {required this.id,
      required this.recordType,
      required this.dataJson,
      required this.expiresAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['record_type'] = Variable<String>(recordType);
    map['data_json'] = Variable<String>(dataJson);
    map['expires_at'] = Variable<DateTime>(expiresAt);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedHealthRecordsCompanion toCompanion(bool nullToAbsent) {
    return CachedHealthRecordsCompanion(
      id: Value(id),
      recordType: Value(recordType),
      dataJson: Value(dataJson),
      expiresAt: Value(expiresAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedHealthRecord.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedHealthRecord(
      id: serializer.fromJson<int>(json['id']),
      recordType: serializer.fromJson<String>(json['recordType']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      expiresAt: serializer.fromJson<DateTime>(json['expiresAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'recordType': serializer.toJson<String>(recordType),
      'dataJson': serializer.toJson<String>(dataJson),
      'expiresAt': serializer.toJson<DateTime>(expiresAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedHealthRecord copyWith(
          {int? id,
          String? recordType,
          String? dataJson,
          DateTime? expiresAt,
          DateTime? cachedAt}) =>
      CachedHealthRecord(
        id: id ?? this.id,
        recordType: recordType ?? this.recordType,
        dataJson: dataJson ?? this.dataJson,
        expiresAt: expiresAt ?? this.expiresAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedHealthRecord copyWithCompanion(CachedHealthRecordsCompanion data) {
    return CachedHealthRecord(
      id: data.id.present ? data.id.value : this.id,
      recordType:
          data.recordType.present ? data.recordType.value : this.recordType,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      expiresAt: data.expiresAt.present ? data.expiresAt.value : this.expiresAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedHealthRecord(')
          ..write('id: $id, ')
          ..write('recordType: $recordType, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, recordType, dataJson, expiresAt, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedHealthRecord &&
          other.id == this.id &&
          other.recordType == this.recordType &&
          other.dataJson == this.dataJson &&
          other.expiresAt == this.expiresAt &&
          other.cachedAt == this.cachedAt);
}

class CachedHealthRecordsCompanion extends UpdateCompanion<CachedHealthRecord> {
  final Value<int> id;
  final Value<String> recordType;
  final Value<String> dataJson;
  final Value<DateTime> expiresAt;
  final Value<DateTime> cachedAt;
  const CachedHealthRecordsCompanion({
    this.id = const Value.absent(),
    this.recordType = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.expiresAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedHealthRecordsCompanion.insert({
    this.id = const Value.absent(),
    required String recordType,
    required String dataJson,
    required DateTime expiresAt,
    this.cachedAt = const Value.absent(),
  })  : recordType = Value(recordType),
        dataJson = Value(dataJson),
        expiresAt = Value(expiresAt);
  static Insertable<CachedHealthRecord> custom({
    Expression<int>? id,
    Expression<String>? recordType,
    Expression<String>? dataJson,
    Expression<DateTime>? expiresAt,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (recordType != null) 'record_type': recordType,
      if (dataJson != null) 'data_json': dataJson,
      if (expiresAt != null) 'expires_at': expiresAt,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedHealthRecordsCompanion copyWith(
      {Value<int>? id,
      Value<String>? recordType,
      Value<String>? dataJson,
      Value<DateTime>? expiresAt,
      Value<DateTime>? cachedAt}) {
    return CachedHealthRecordsCompanion(
      id: id ?? this.id,
      recordType: recordType ?? this.recordType,
      dataJson: dataJson ?? this.dataJson,
      expiresAt: expiresAt ?? this.expiresAt,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (recordType.present) {
      map['record_type'] = Variable<String>(recordType.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (expiresAt.present) {
      map['expires_at'] = Variable<DateTime>(expiresAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedHealthRecordsCompanion(')
          ..write('id: $id, ')
          ..write('recordType: $recordType, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

class $CachedDoctorsTable extends CachedDoctors
    with TableInfo<$CachedDoctorsTable, CachedDoctor> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedDoctorsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _remoteIdMeta =
      const VerificationMeta('remoteId');
  @override
  late final GeneratedColumn<String> remoteId = GeneratedColumn<String>(
      'remote_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _expiresAtMeta =
      const VerificationMeta('expiresAt');
  @override
  late final GeneratedColumn<DateTime> expiresAt = GeneratedColumn<DateTime>(
      'expires_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns =>
      [id, remoteId, dataJson, expiresAt, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_doctors';
  @override
  VerificationContext validateIntegrity(Insertable<CachedDoctor> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('remote_id')) {
      context.handle(_remoteIdMeta,
          remoteId.isAcceptableOrUnknown(data['remote_id']!, _remoteIdMeta));
    } else if (isInserting) {
      context.missing(_remoteIdMeta);
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('expires_at')) {
      context.handle(_expiresAtMeta,
          expiresAt.isAcceptableOrUnknown(data['expires_at']!, _expiresAtMeta));
    } else if (isInserting) {
      context.missing(_expiresAtMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedDoctor map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedDoctor(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      remoteId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_id'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      expiresAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}expires_at'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedDoctorsTable createAlias(String alias) {
    return $CachedDoctorsTable(attachedDatabase, alias);
  }
}

class CachedDoctor extends DataClass implements Insertable<CachedDoctor> {
  final int id;
  final String remoteId;
  final String dataJson;
  final DateTime expiresAt;
  final DateTime cachedAt;
  const CachedDoctor(
      {required this.id,
      required this.remoteId,
      required this.dataJson,
      required this.expiresAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['remote_id'] = Variable<String>(remoteId);
    map['data_json'] = Variable<String>(dataJson);
    map['expires_at'] = Variable<DateTime>(expiresAt);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedDoctorsCompanion toCompanion(bool nullToAbsent) {
    return CachedDoctorsCompanion(
      id: Value(id),
      remoteId: Value(remoteId),
      dataJson: Value(dataJson),
      expiresAt: Value(expiresAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedDoctor.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedDoctor(
      id: serializer.fromJson<int>(json['id']),
      remoteId: serializer.fromJson<String>(json['remoteId']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      expiresAt: serializer.fromJson<DateTime>(json['expiresAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'remoteId': serializer.toJson<String>(remoteId),
      'dataJson': serializer.toJson<String>(dataJson),
      'expiresAt': serializer.toJson<DateTime>(expiresAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedDoctor copyWith(
          {int? id,
          String? remoteId,
          String? dataJson,
          DateTime? expiresAt,
          DateTime? cachedAt}) =>
      CachedDoctor(
        id: id ?? this.id,
        remoteId: remoteId ?? this.remoteId,
        dataJson: dataJson ?? this.dataJson,
        expiresAt: expiresAt ?? this.expiresAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedDoctor copyWithCompanion(CachedDoctorsCompanion data) {
    return CachedDoctor(
      id: data.id.present ? data.id.value : this.id,
      remoteId: data.remoteId.present ? data.remoteId.value : this.remoteId,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      expiresAt: data.expiresAt.present ? data.expiresAt.value : this.expiresAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedDoctor(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, remoteId, dataJson, expiresAt, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedDoctor &&
          other.id == this.id &&
          other.remoteId == this.remoteId &&
          other.dataJson == this.dataJson &&
          other.expiresAt == this.expiresAt &&
          other.cachedAt == this.cachedAt);
}

class CachedDoctorsCompanion extends UpdateCompanion<CachedDoctor> {
  final Value<int> id;
  final Value<String> remoteId;
  final Value<String> dataJson;
  final Value<DateTime> expiresAt;
  final Value<DateTime> cachedAt;
  const CachedDoctorsCompanion({
    this.id = const Value.absent(),
    this.remoteId = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.expiresAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedDoctorsCompanion.insert({
    this.id = const Value.absent(),
    required String remoteId,
    required String dataJson,
    required DateTime expiresAt,
    this.cachedAt = const Value.absent(),
  })  : remoteId = Value(remoteId),
        dataJson = Value(dataJson),
        expiresAt = Value(expiresAt);
  static Insertable<CachedDoctor> custom({
    Expression<int>? id,
    Expression<String>? remoteId,
    Expression<String>? dataJson,
    Expression<DateTime>? expiresAt,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (remoteId != null) 'remote_id': remoteId,
      if (dataJson != null) 'data_json': dataJson,
      if (expiresAt != null) 'expires_at': expiresAt,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedDoctorsCompanion copyWith(
      {Value<int>? id,
      Value<String>? remoteId,
      Value<String>? dataJson,
      Value<DateTime>? expiresAt,
      Value<DateTime>? cachedAt}) {
    return CachedDoctorsCompanion(
      id: id ?? this.id,
      remoteId: remoteId ?? this.remoteId,
      dataJson: dataJson ?? this.dataJson,
      expiresAt: expiresAt ?? this.expiresAt,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (remoteId.present) {
      map['remote_id'] = Variable<String>(remoteId.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (expiresAt.present) {
      map['expires_at'] = Variable<DateTime>(expiresAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedDoctorsCompanion(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

class $CachedHospitalsTable extends CachedHospitals
    with TableInfo<$CachedHospitalsTable, CachedHospital> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedHospitalsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _remoteIdMeta =
      const VerificationMeta('remoteId');
  @override
  late final GeneratedColumn<String> remoteId = GeneratedColumn<String>(
      'remote_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _expiresAtMeta =
      const VerificationMeta('expiresAt');
  @override
  late final GeneratedColumn<DateTime> expiresAt = GeneratedColumn<DateTime>(
      'expires_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns =>
      [id, remoteId, dataJson, expiresAt, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_hospitals';
  @override
  VerificationContext validateIntegrity(Insertable<CachedHospital> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('remote_id')) {
      context.handle(_remoteIdMeta,
          remoteId.isAcceptableOrUnknown(data['remote_id']!, _remoteIdMeta));
    } else if (isInserting) {
      context.missing(_remoteIdMeta);
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('expires_at')) {
      context.handle(_expiresAtMeta,
          expiresAt.isAcceptableOrUnknown(data['expires_at']!, _expiresAtMeta));
    } else if (isInserting) {
      context.missing(_expiresAtMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedHospital map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedHospital(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      remoteId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_id'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      expiresAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}expires_at'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedHospitalsTable createAlias(String alias) {
    return $CachedHospitalsTable(attachedDatabase, alias);
  }
}

class CachedHospital extends DataClass implements Insertable<CachedHospital> {
  final int id;
  final String remoteId;
  final String dataJson;
  final DateTime expiresAt;
  final DateTime cachedAt;
  const CachedHospital(
      {required this.id,
      required this.remoteId,
      required this.dataJson,
      required this.expiresAt,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['remote_id'] = Variable<String>(remoteId);
    map['data_json'] = Variable<String>(dataJson);
    map['expires_at'] = Variable<DateTime>(expiresAt);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedHospitalsCompanion toCompanion(bool nullToAbsent) {
    return CachedHospitalsCompanion(
      id: Value(id),
      remoteId: Value(remoteId),
      dataJson: Value(dataJson),
      expiresAt: Value(expiresAt),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedHospital.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedHospital(
      id: serializer.fromJson<int>(json['id']),
      remoteId: serializer.fromJson<String>(json['remoteId']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      expiresAt: serializer.fromJson<DateTime>(json['expiresAt']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'remoteId': serializer.toJson<String>(remoteId),
      'dataJson': serializer.toJson<String>(dataJson),
      'expiresAt': serializer.toJson<DateTime>(expiresAt),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedHospital copyWith(
          {int? id,
          String? remoteId,
          String? dataJson,
          DateTime? expiresAt,
          DateTime? cachedAt}) =>
      CachedHospital(
        id: id ?? this.id,
        remoteId: remoteId ?? this.remoteId,
        dataJson: dataJson ?? this.dataJson,
        expiresAt: expiresAt ?? this.expiresAt,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedHospital copyWithCompanion(CachedHospitalsCompanion data) {
    return CachedHospital(
      id: data.id.present ? data.id.value : this.id,
      remoteId: data.remoteId.present ? data.remoteId.value : this.remoteId,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      expiresAt: data.expiresAt.present ? data.expiresAt.value : this.expiresAt,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedHospital(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, remoteId, dataJson, expiresAt, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedHospital &&
          other.id == this.id &&
          other.remoteId == this.remoteId &&
          other.dataJson == this.dataJson &&
          other.expiresAt == this.expiresAt &&
          other.cachedAt == this.cachedAt);
}

class CachedHospitalsCompanion extends UpdateCompanion<CachedHospital> {
  final Value<int> id;
  final Value<String> remoteId;
  final Value<String> dataJson;
  final Value<DateTime> expiresAt;
  final Value<DateTime> cachedAt;
  const CachedHospitalsCompanion({
    this.id = const Value.absent(),
    this.remoteId = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.expiresAt = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedHospitalsCompanion.insert({
    this.id = const Value.absent(),
    required String remoteId,
    required String dataJson,
    required DateTime expiresAt,
    this.cachedAt = const Value.absent(),
  })  : remoteId = Value(remoteId),
        dataJson = Value(dataJson),
        expiresAt = Value(expiresAt);
  static Insertable<CachedHospital> custom({
    Expression<int>? id,
    Expression<String>? remoteId,
    Expression<String>? dataJson,
    Expression<DateTime>? expiresAt,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (remoteId != null) 'remote_id': remoteId,
      if (dataJson != null) 'data_json': dataJson,
      if (expiresAt != null) 'expires_at': expiresAt,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedHospitalsCompanion copyWith(
      {Value<int>? id,
      Value<String>? remoteId,
      Value<String>? dataJson,
      Value<DateTime>? expiresAt,
      Value<DateTime>? cachedAt}) {
    return CachedHospitalsCompanion(
      id: id ?? this.id,
      remoteId: remoteId ?? this.remoteId,
      dataJson: dataJson ?? this.dataJson,
      expiresAt: expiresAt ?? this.expiresAt,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (remoteId.present) {
      map['remote_id'] = Variable<String>(remoteId.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (expiresAt.present) {
      map['expires_at'] = Variable<DateTime>(expiresAt.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedHospitalsCompanion(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('expiresAt: $expiresAt, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

class $CachedArticlesTable extends CachedArticles
    with TableInfo<$CachedArticlesTable, CachedArticle> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedArticlesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _remoteIdMeta =
      const VerificationMeta('remoteId');
  @override
  late final GeneratedColumn<String> remoteId = GeneratedColumn<String>(
      'remote_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns => [id, remoteId, dataJson, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_articles';
  @override
  VerificationContext validateIntegrity(Insertable<CachedArticle> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('remote_id')) {
      context.handle(_remoteIdMeta,
          remoteId.isAcceptableOrUnknown(data['remote_id']!, _remoteIdMeta));
    } else if (isInserting) {
      context.missing(_remoteIdMeta);
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedArticle map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedArticle(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      remoteId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}remote_id'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedArticlesTable createAlias(String alias) {
    return $CachedArticlesTable(attachedDatabase, alias);
  }
}

class CachedArticle extends DataClass implements Insertable<CachedArticle> {
  final int id;
  final String remoteId;
  final String dataJson;
  final DateTime cachedAt;
  const CachedArticle(
      {required this.id,
      required this.remoteId,
      required this.dataJson,
      required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['remote_id'] = Variable<String>(remoteId);
    map['data_json'] = Variable<String>(dataJson);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedArticlesCompanion toCompanion(bool nullToAbsent) {
    return CachedArticlesCompanion(
      id: Value(id),
      remoteId: Value(remoteId),
      dataJson: Value(dataJson),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedArticle.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedArticle(
      id: serializer.fromJson<int>(json['id']),
      remoteId: serializer.fromJson<String>(json['remoteId']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'remoteId': serializer.toJson<String>(remoteId),
      'dataJson': serializer.toJson<String>(dataJson),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedArticle copyWith(
          {int? id, String? remoteId, String? dataJson, DateTime? cachedAt}) =>
      CachedArticle(
        id: id ?? this.id,
        remoteId: remoteId ?? this.remoteId,
        dataJson: dataJson ?? this.dataJson,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedArticle copyWithCompanion(CachedArticlesCompanion data) {
    return CachedArticle(
      id: data.id.present ? data.id.value : this.id,
      remoteId: data.remoteId.present ? data.remoteId.value : this.remoteId,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedArticle(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, remoteId, dataJson, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedArticle &&
          other.id == this.id &&
          other.remoteId == this.remoteId &&
          other.dataJson == this.dataJson &&
          other.cachedAt == this.cachedAt);
}

class CachedArticlesCompanion extends UpdateCompanion<CachedArticle> {
  final Value<int> id;
  final Value<String> remoteId;
  final Value<String> dataJson;
  final Value<DateTime> cachedAt;
  const CachedArticlesCompanion({
    this.id = const Value.absent(),
    this.remoteId = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedArticlesCompanion.insert({
    this.id = const Value.absent(),
    required String remoteId,
    required String dataJson,
    this.cachedAt = const Value.absent(),
  })  : remoteId = Value(remoteId),
        dataJson = Value(dataJson);
  static Insertable<CachedArticle> custom({
    Expression<int>? id,
    Expression<String>? remoteId,
    Expression<String>? dataJson,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (remoteId != null) 'remote_id': remoteId,
      if (dataJson != null) 'data_json': dataJson,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedArticlesCompanion copyWith(
      {Value<int>? id,
      Value<String>? remoteId,
      Value<String>? dataJson,
      Value<DateTime>? cachedAt}) {
    return CachedArticlesCompanion(
      id: id ?? this.id,
      remoteId: remoteId ?? this.remoteId,
      dataJson: dataJson ?? this.dataJson,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (remoteId.present) {
      map['remote_id'] = Variable<String>(remoteId.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedArticlesCompanion(')
          ..write('id: $id, ')
          ..write('remoteId: $remoteId, ')
          ..write('dataJson: $dataJson, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

class $CachedProfileTable extends CachedProfile
    with TableInfo<$CachedProfileTable, CachedProfileData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedProfileTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _dataJsonMeta =
      const VerificationMeta('dataJson');
  @override
  late final GeneratedColumn<String> dataJson = GeneratedColumn<String>(
      'data_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _cachedAtMeta =
      const VerificationMeta('cachedAt');
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
      'cached_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns => [id, dataJson, cachedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_profile';
  @override
  VerificationContext validateIntegrity(Insertable<CachedProfileData> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('data_json')) {
      context.handle(_dataJsonMeta,
          dataJson.isAcceptableOrUnknown(data['data_json']!, _dataJsonMeta));
    } else if (isInserting) {
      context.missing(_dataJsonMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(_cachedAtMeta,
          cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedProfileData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedProfileData(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      dataJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}data_json'])!,
      cachedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}cached_at'])!,
    );
  }

  @override
  $CachedProfileTable createAlias(String alias) {
    return $CachedProfileTable(attachedDatabase, alias);
  }
}

class CachedProfileData extends DataClass
    implements Insertable<CachedProfileData> {
  final int id;
  final String dataJson;
  final DateTime cachedAt;
  const CachedProfileData(
      {required this.id, required this.dataJson, required this.cachedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['data_json'] = Variable<String>(dataJson);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    return map;
  }

  CachedProfileCompanion toCompanion(bool nullToAbsent) {
    return CachedProfileCompanion(
      id: Value(id),
      dataJson: Value(dataJson),
      cachedAt: Value(cachedAt),
    );
  }

  factory CachedProfileData.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedProfileData(
      id: serializer.fromJson<int>(json['id']),
      dataJson: serializer.fromJson<String>(json['dataJson']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'dataJson': serializer.toJson<String>(dataJson),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
    };
  }

  CachedProfileData copyWith({int? id, String? dataJson, DateTime? cachedAt}) =>
      CachedProfileData(
        id: id ?? this.id,
        dataJson: dataJson ?? this.dataJson,
        cachedAt: cachedAt ?? this.cachedAt,
      );
  CachedProfileData copyWithCompanion(CachedProfileCompanion data) {
    return CachedProfileData(
      id: data.id.present ? data.id.value : this.id,
      dataJson: data.dataJson.present ? data.dataJson.value : this.dataJson,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedProfileData(')
          ..write('id: $id, ')
          ..write('dataJson: $dataJson, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, dataJson, cachedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedProfileData &&
          other.id == this.id &&
          other.dataJson == this.dataJson &&
          other.cachedAt == this.cachedAt);
}

class CachedProfileCompanion extends UpdateCompanion<CachedProfileData> {
  final Value<int> id;
  final Value<String> dataJson;
  final Value<DateTime> cachedAt;
  const CachedProfileCompanion({
    this.id = const Value.absent(),
    this.dataJson = const Value.absent(),
    this.cachedAt = const Value.absent(),
  });
  CachedProfileCompanion.insert({
    this.id = const Value.absent(),
    required String dataJson,
    this.cachedAt = const Value.absent(),
  }) : dataJson = Value(dataJson);
  static Insertable<CachedProfileData> custom({
    Expression<int>? id,
    Expression<String>? dataJson,
    Expression<DateTime>? cachedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (dataJson != null) 'data_json': dataJson,
      if (cachedAt != null) 'cached_at': cachedAt,
    });
  }

  CachedProfileCompanion copyWith(
      {Value<int>? id, Value<String>? dataJson, Value<DateTime>? cachedAt}) {
    return CachedProfileCompanion(
      id: id ?? this.id,
      dataJson: dataJson ?? this.dataJson,
      cachedAt: cachedAt ?? this.cachedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (dataJson.present) {
      map['data_json'] = Variable<String>(dataJson.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedProfileCompanion(')
          ..write('id: $id, ')
          ..write('dataJson: $dataJson, ')
          ..write('cachedAt: $cachedAt')
          ..write(')'))
        .toString();
  }
}

abstract class _$CacheDatabase extends GeneratedDatabase {
  _$CacheDatabase(QueryExecutor e) : super(e);
  $CacheDatabaseManager get managers => $CacheDatabaseManager(this);
  late final $CachedAppointmentsTable cachedAppointments =
      $CachedAppointmentsTable(this);
  late final $CachedPrescriptionsTable cachedPrescriptions =
      $CachedPrescriptionsTable(this);
  late final $CachedLabResultsTable cachedLabResults =
      $CachedLabResultsTable(this);
  late final $CachedHealthRecordsTable cachedHealthRecords =
      $CachedHealthRecordsTable(this);
  late final $CachedDoctorsTable cachedDoctors = $CachedDoctorsTable(this);
  late final $CachedHospitalsTable cachedHospitals =
      $CachedHospitalsTable(this);
  late final $CachedArticlesTable cachedArticles = $CachedArticlesTable(this);
  late final $CachedProfileTable cachedProfile = $CachedProfileTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
        cachedAppointments,
        cachedPrescriptions,
        cachedLabResults,
        cachedHealthRecords,
        cachedDoctors,
        cachedHospitals,
        cachedArticles,
        cachedProfile
      ];
}

typedef $$CachedAppointmentsTableCreateCompanionBuilder
    = CachedAppointmentsCompanion Function({
  Value<int> id,
  required String remoteId,
  required String dataJson,
  required DateTime expiresAt,
  Value<DateTime> cachedAt,
});
typedef $$CachedAppointmentsTableUpdateCompanionBuilder
    = CachedAppointmentsCompanion Function({
  Value<int> id,
  Value<String> remoteId,
  Value<String> dataJson,
  Value<DateTime> expiresAt,
  Value<DateTime> cachedAt,
});

class $$CachedAppointmentsTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedAppointmentsTable> {
  $$CachedAppointmentsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedAppointmentsTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedAppointmentsTable> {
  $$CachedAppointmentsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedAppointmentsTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedAppointmentsTable> {
  $$CachedAppointmentsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get remoteId =>
      $composableBuilder(column: $table.remoteId, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get expiresAt =>
      $composableBuilder(column: $table.expiresAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedAppointmentsTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedAppointmentsTable,
    CachedAppointment,
    $$CachedAppointmentsTableFilterComposer,
    $$CachedAppointmentsTableOrderingComposer,
    $$CachedAppointmentsTableAnnotationComposer,
    $$CachedAppointmentsTableCreateCompanionBuilder,
    $$CachedAppointmentsTableUpdateCompanionBuilder,
    (
      CachedAppointment,
      BaseReferences<_$CacheDatabase, $CachedAppointmentsTable,
          CachedAppointment>
    ),
    CachedAppointment,
    PrefetchHooks Function()> {
  $$CachedAppointmentsTableTableManager(
      _$CacheDatabase db, $CachedAppointmentsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedAppointmentsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedAppointmentsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedAppointmentsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> remoteId = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> expiresAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedAppointmentsCompanion(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String remoteId,
            required String dataJson,
            required DateTime expiresAt,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedAppointmentsCompanion.insert(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedAppointmentsTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedAppointmentsTable,
    CachedAppointment,
    $$CachedAppointmentsTableFilterComposer,
    $$CachedAppointmentsTableOrderingComposer,
    $$CachedAppointmentsTableAnnotationComposer,
    $$CachedAppointmentsTableCreateCompanionBuilder,
    $$CachedAppointmentsTableUpdateCompanionBuilder,
    (
      CachedAppointment,
      BaseReferences<_$CacheDatabase, $CachedAppointmentsTable,
          CachedAppointment>
    ),
    CachedAppointment,
    PrefetchHooks Function()>;
typedef $$CachedPrescriptionsTableCreateCompanionBuilder
    = CachedPrescriptionsCompanion Function({
  Value<int> id,
  required String remoteId,
  required String dataJson,
  required DateTime expiresAt,
  Value<DateTime> cachedAt,
});
typedef $$CachedPrescriptionsTableUpdateCompanionBuilder
    = CachedPrescriptionsCompanion Function({
  Value<int> id,
  Value<String> remoteId,
  Value<String> dataJson,
  Value<DateTime> expiresAt,
  Value<DateTime> cachedAt,
});

class $$CachedPrescriptionsTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedPrescriptionsTable> {
  $$CachedPrescriptionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedPrescriptionsTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedPrescriptionsTable> {
  $$CachedPrescriptionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedPrescriptionsTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedPrescriptionsTable> {
  $$CachedPrescriptionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get remoteId =>
      $composableBuilder(column: $table.remoteId, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get expiresAt =>
      $composableBuilder(column: $table.expiresAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedPrescriptionsTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedPrescriptionsTable,
    CachedPrescription,
    $$CachedPrescriptionsTableFilterComposer,
    $$CachedPrescriptionsTableOrderingComposer,
    $$CachedPrescriptionsTableAnnotationComposer,
    $$CachedPrescriptionsTableCreateCompanionBuilder,
    $$CachedPrescriptionsTableUpdateCompanionBuilder,
    (
      CachedPrescription,
      BaseReferences<_$CacheDatabase, $CachedPrescriptionsTable,
          CachedPrescription>
    ),
    CachedPrescription,
    PrefetchHooks Function()> {
  $$CachedPrescriptionsTableTableManager(
      _$CacheDatabase db, $CachedPrescriptionsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedPrescriptionsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedPrescriptionsTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedPrescriptionsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> remoteId = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> expiresAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedPrescriptionsCompanion(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String remoteId,
            required String dataJson,
            required DateTime expiresAt,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedPrescriptionsCompanion.insert(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedPrescriptionsTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedPrescriptionsTable,
    CachedPrescription,
    $$CachedPrescriptionsTableFilterComposer,
    $$CachedPrescriptionsTableOrderingComposer,
    $$CachedPrescriptionsTableAnnotationComposer,
    $$CachedPrescriptionsTableCreateCompanionBuilder,
    $$CachedPrescriptionsTableUpdateCompanionBuilder,
    (
      CachedPrescription,
      BaseReferences<_$CacheDatabase, $CachedPrescriptionsTable,
          CachedPrescription>
    ),
    CachedPrescription,
    PrefetchHooks Function()>;
typedef $$CachedLabResultsTableCreateCompanionBuilder
    = CachedLabResultsCompanion Function({
  Value<int> id,
  required String remoteId,
  required String dataJson,
  required DateTime expiresAt,
  Value<DateTime> cachedAt,
});
typedef $$CachedLabResultsTableUpdateCompanionBuilder
    = CachedLabResultsCompanion Function({
  Value<int> id,
  Value<String> remoteId,
  Value<String> dataJson,
  Value<DateTime> expiresAt,
  Value<DateTime> cachedAt,
});

class $$CachedLabResultsTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedLabResultsTable> {
  $$CachedLabResultsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedLabResultsTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedLabResultsTable> {
  $$CachedLabResultsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedLabResultsTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedLabResultsTable> {
  $$CachedLabResultsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get remoteId =>
      $composableBuilder(column: $table.remoteId, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get expiresAt =>
      $composableBuilder(column: $table.expiresAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedLabResultsTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedLabResultsTable,
    CachedLabResult,
    $$CachedLabResultsTableFilterComposer,
    $$CachedLabResultsTableOrderingComposer,
    $$CachedLabResultsTableAnnotationComposer,
    $$CachedLabResultsTableCreateCompanionBuilder,
    $$CachedLabResultsTableUpdateCompanionBuilder,
    (
      CachedLabResult,
      BaseReferences<_$CacheDatabase, $CachedLabResultsTable, CachedLabResult>
    ),
    CachedLabResult,
    PrefetchHooks Function()> {
  $$CachedLabResultsTableTableManager(
      _$CacheDatabase db, $CachedLabResultsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedLabResultsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedLabResultsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedLabResultsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> remoteId = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> expiresAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedLabResultsCompanion(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String remoteId,
            required String dataJson,
            required DateTime expiresAt,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedLabResultsCompanion.insert(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedLabResultsTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedLabResultsTable,
    CachedLabResult,
    $$CachedLabResultsTableFilterComposer,
    $$CachedLabResultsTableOrderingComposer,
    $$CachedLabResultsTableAnnotationComposer,
    $$CachedLabResultsTableCreateCompanionBuilder,
    $$CachedLabResultsTableUpdateCompanionBuilder,
    (
      CachedLabResult,
      BaseReferences<_$CacheDatabase, $CachedLabResultsTable, CachedLabResult>
    ),
    CachedLabResult,
    PrefetchHooks Function()>;
typedef $$CachedHealthRecordsTableCreateCompanionBuilder
    = CachedHealthRecordsCompanion Function({
  Value<int> id,
  required String recordType,
  required String dataJson,
  required DateTime expiresAt,
  Value<DateTime> cachedAt,
});
typedef $$CachedHealthRecordsTableUpdateCompanionBuilder
    = CachedHealthRecordsCompanion Function({
  Value<int> id,
  Value<String> recordType,
  Value<String> dataJson,
  Value<DateTime> expiresAt,
  Value<DateTime> cachedAt,
});

class $$CachedHealthRecordsTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedHealthRecordsTable> {
  $$CachedHealthRecordsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get recordType => $composableBuilder(
      column: $table.recordType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedHealthRecordsTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedHealthRecordsTable> {
  $$CachedHealthRecordsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get recordType => $composableBuilder(
      column: $table.recordType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedHealthRecordsTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedHealthRecordsTable> {
  $$CachedHealthRecordsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get recordType => $composableBuilder(
      column: $table.recordType, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get expiresAt =>
      $composableBuilder(column: $table.expiresAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedHealthRecordsTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedHealthRecordsTable,
    CachedHealthRecord,
    $$CachedHealthRecordsTableFilterComposer,
    $$CachedHealthRecordsTableOrderingComposer,
    $$CachedHealthRecordsTableAnnotationComposer,
    $$CachedHealthRecordsTableCreateCompanionBuilder,
    $$CachedHealthRecordsTableUpdateCompanionBuilder,
    (
      CachedHealthRecord,
      BaseReferences<_$CacheDatabase, $CachedHealthRecordsTable,
          CachedHealthRecord>
    ),
    CachedHealthRecord,
    PrefetchHooks Function()> {
  $$CachedHealthRecordsTableTableManager(
      _$CacheDatabase db, $CachedHealthRecordsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedHealthRecordsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedHealthRecordsTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedHealthRecordsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> recordType = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> expiresAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedHealthRecordsCompanion(
            id: id,
            recordType: recordType,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String recordType,
            required String dataJson,
            required DateTime expiresAt,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedHealthRecordsCompanion.insert(
            id: id,
            recordType: recordType,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedHealthRecordsTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedHealthRecordsTable,
    CachedHealthRecord,
    $$CachedHealthRecordsTableFilterComposer,
    $$CachedHealthRecordsTableOrderingComposer,
    $$CachedHealthRecordsTableAnnotationComposer,
    $$CachedHealthRecordsTableCreateCompanionBuilder,
    $$CachedHealthRecordsTableUpdateCompanionBuilder,
    (
      CachedHealthRecord,
      BaseReferences<_$CacheDatabase, $CachedHealthRecordsTable,
          CachedHealthRecord>
    ),
    CachedHealthRecord,
    PrefetchHooks Function()>;
typedef $$CachedDoctorsTableCreateCompanionBuilder = CachedDoctorsCompanion
    Function({
  Value<int> id,
  required String remoteId,
  required String dataJson,
  required DateTime expiresAt,
  Value<DateTime> cachedAt,
});
typedef $$CachedDoctorsTableUpdateCompanionBuilder = CachedDoctorsCompanion
    Function({
  Value<int> id,
  Value<String> remoteId,
  Value<String> dataJson,
  Value<DateTime> expiresAt,
  Value<DateTime> cachedAt,
});

class $$CachedDoctorsTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedDoctorsTable> {
  $$CachedDoctorsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedDoctorsTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedDoctorsTable> {
  $$CachedDoctorsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedDoctorsTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedDoctorsTable> {
  $$CachedDoctorsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get remoteId =>
      $composableBuilder(column: $table.remoteId, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get expiresAt =>
      $composableBuilder(column: $table.expiresAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedDoctorsTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedDoctorsTable,
    CachedDoctor,
    $$CachedDoctorsTableFilterComposer,
    $$CachedDoctorsTableOrderingComposer,
    $$CachedDoctorsTableAnnotationComposer,
    $$CachedDoctorsTableCreateCompanionBuilder,
    $$CachedDoctorsTableUpdateCompanionBuilder,
    (
      CachedDoctor,
      BaseReferences<_$CacheDatabase, $CachedDoctorsTable, CachedDoctor>
    ),
    CachedDoctor,
    PrefetchHooks Function()> {
  $$CachedDoctorsTableTableManager(
      _$CacheDatabase db, $CachedDoctorsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedDoctorsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedDoctorsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedDoctorsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> remoteId = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> expiresAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedDoctorsCompanion(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String remoteId,
            required String dataJson,
            required DateTime expiresAt,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedDoctorsCompanion.insert(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedDoctorsTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedDoctorsTable,
    CachedDoctor,
    $$CachedDoctorsTableFilterComposer,
    $$CachedDoctorsTableOrderingComposer,
    $$CachedDoctorsTableAnnotationComposer,
    $$CachedDoctorsTableCreateCompanionBuilder,
    $$CachedDoctorsTableUpdateCompanionBuilder,
    (
      CachedDoctor,
      BaseReferences<_$CacheDatabase, $CachedDoctorsTable, CachedDoctor>
    ),
    CachedDoctor,
    PrefetchHooks Function()>;
typedef $$CachedHospitalsTableCreateCompanionBuilder = CachedHospitalsCompanion
    Function({
  Value<int> id,
  required String remoteId,
  required String dataJson,
  required DateTime expiresAt,
  Value<DateTime> cachedAt,
});
typedef $$CachedHospitalsTableUpdateCompanionBuilder = CachedHospitalsCompanion
    Function({
  Value<int> id,
  Value<String> remoteId,
  Value<String> dataJson,
  Value<DateTime> expiresAt,
  Value<DateTime> cachedAt,
});

class $$CachedHospitalsTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedHospitalsTable> {
  $$CachedHospitalsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedHospitalsTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedHospitalsTable> {
  $$CachedHospitalsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get expiresAt => $composableBuilder(
      column: $table.expiresAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedHospitalsTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedHospitalsTable> {
  $$CachedHospitalsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get remoteId =>
      $composableBuilder(column: $table.remoteId, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get expiresAt =>
      $composableBuilder(column: $table.expiresAt, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedHospitalsTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedHospitalsTable,
    CachedHospital,
    $$CachedHospitalsTableFilterComposer,
    $$CachedHospitalsTableOrderingComposer,
    $$CachedHospitalsTableAnnotationComposer,
    $$CachedHospitalsTableCreateCompanionBuilder,
    $$CachedHospitalsTableUpdateCompanionBuilder,
    (
      CachedHospital,
      BaseReferences<_$CacheDatabase, $CachedHospitalsTable, CachedHospital>
    ),
    CachedHospital,
    PrefetchHooks Function()> {
  $$CachedHospitalsTableTableManager(
      _$CacheDatabase db, $CachedHospitalsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedHospitalsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedHospitalsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedHospitalsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> remoteId = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> expiresAt = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedHospitalsCompanion(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String remoteId,
            required String dataJson,
            required DateTime expiresAt,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedHospitalsCompanion.insert(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            expiresAt: expiresAt,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedHospitalsTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedHospitalsTable,
    CachedHospital,
    $$CachedHospitalsTableFilterComposer,
    $$CachedHospitalsTableOrderingComposer,
    $$CachedHospitalsTableAnnotationComposer,
    $$CachedHospitalsTableCreateCompanionBuilder,
    $$CachedHospitalsTableUpdateCompanionBuilder,
    (
      CachedHospital,
      BaseReferences<_$CacheDatabase, $CachedHospitalsTable, CachedHospital>
    ),
    CachedHospital,
    PrefetchHooks Function()>;
typedef $$CachedArticlesTableCreateCompanionBuilder = CachedArticlesCompanion
    Function({
  Value<int> id,
  required String remoteId,
  required String dataJson,
  Value<DateTime> cachedAt,
});
typedef $$CachedArticlesTableUpdateCompanionBuilder = CachedArticlesCompanion
    Function({
  Value<int> id,
  Value<String> remoteId,
  Value<String> dataJson,
  Value<DateTime> cachedAt,
});

class $$CachedArticlesTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedArticlesTable> {
  $$CachedArticlesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedArticlesTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedArticlesTable> {
  $$CachedArticlesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get remoteId => $composableBuilder(
      column: $table.remoteId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedArticlesTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedArticlesTable> {
  $$CachedArticlesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get remoteId =>
      $composableBuilder(column: $table.remoteId, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedArticlesTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedArticlesTable,
    CachedArticle,
    $$CachedArticlesTableFilterComposer,
    $$CachedArticlesTableOrderingComposer,
    $$CachedArticlesTableAnnotationComposer,
    $$CachedArticlesTableCreateCompanionBuilder,
    $$CachedArticlesTableUpdateCompanionBuilder,
    (
      CachedArticle,
      BaseReferences<_$CacheDatabase, $CachedArticlesTable, CachedArticle>
    ),
    CachedArticle,
    PrefetchHooks Function()> {
  $$CachedArticlesTableTableManager(
      _$CacheDatabase db, $CachedArticlesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedArticlesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedArticlesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedArticlesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> remoteId = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedArticlesCompanion(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String remoteId,
            required String dataJson,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedArticlesCompanion.insert(
            id: id,
            remoteId: remoteId,
            dataJson: dataJson,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedArticlesTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedArticlesTable,
    CachedArticle,
    $$CachedArticlesTableFilterComposer,
    $$CachedArticlesTableOrderingComposer,
    $$CachedArticlesTableAnnotationComposer,
    $$CachedArticlesTableCreateCompanionBuilder,
    $$CachedArticlesTableUpdateCompanionBuilder,
    (
      CachedArticle,
      BaseReferences<_$CacheDatabase, $CachedArticlesTable, CachedArticle>
    ),
    CachedArticle,
    PrefetchHooks Function()>;
typedef $$CachedProfileTableCreateCompanionBuilder = CachedProfileCompanion
    Function({
  Value<int> id,
  required String dataJson,
  Value<DateTime> cachedAt,
});
typedef $$CachedProfileTableUpdateCompanionBuilder = CachedProfileCompanion
    Function({
  Value<int> id,
  Value<String> dataJson,
  Value<DateTime> cachedAt,
});

class $$CachedProfileTableFilterComposer
    extends Composer<_$CacheDatabase, $CachedProfileTable> {
  $$CachedProfileTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnFilters(column));
}

class $$CachedProfileTableOrderingComposer
    extends Composer<_$CacheDatabase, $CachedProfileTable> {
  $$CachedProfileTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dataJson => $composableBuilder(
      column: $table.dataJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
      column: $table.cachedAt, builder: (column) => ColumnOrderings(column));
}

class $$CachedProfileTableAnnotationComposer
    extends Composer<_$CacheDatabase, $CachedProfileTable> {
  $$CachedProfileTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get dataJson =>
      $composableBuilder(column: $table.dataJson, builder: (column) => column);

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);
}

class $$CachedProfileTableTableManager extends RootTableManager<
    _$CacheDatabase,
    $CachedProfileTable,
    CachedProfileData,
    $$CachedProfileTableFilterComposer,
    $$CachedProfileTableOrderingComposer,
    $$CachedProfileTableAnnotationComposer,
    $$CachedProfileTableCreateCompanionBuilder,
    $$CachedProfileTableUpdateCompanionBuilder,
    (
      CachedProfileData,
      BaseReferences<_$CacheDatabase, $CachedProfileTable, CachedProfileData>
    ),
    CachedProfileData,
    PrefetchHooks Function()> {
  $$CachedProfileTableTableManager(
      _$CacheDatabase db, $CachedProfileTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedProfileTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedProfileTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedProfileTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> dataJson = const Value.absent(),
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedProfileCompanion(
            id: id,
            dataJson: dataJson,
            cachedAt: cachedAt,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String dataJson,
            Value<DateTime> cachedAt = const Value.absent(),
          }) =>
              CachedProfileCompanion.insert(
            id: id,
            dataJson: dataJson,
            cachedAt: cachedAt,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedProfileTableProcessedTableManager = ProcessedTableManager<
    _$CacheDatabase,
    $CachedProfileTable,
    CachedProfileData,
    $$CachedProfileTableFilterComposer,
    $$CachedProfileTableOrderingComposer,
    $$CachedProfileTableAnnotationComposer,
    $$CachedProfileTableCreateCompanionBuilder,
    $$CachedProfileTableUpdateCompanionBuilder,
    (
      CachedProfileData,
      BaseReferences<_$CacheDatabase, $CachedProfileTable, CachedProfileData>
    ),
    CachedProfileData,
    PrefetchHooks Function()>;

class $CacheDatabaseManager {
  final _$CacheDatabase _db;
  $CacheDatabaseManager(this._db);
  $$CachedAppointmentsTableTableManager get cachedAppointments =>
      $$CachedAppointmentsTableTableManager(_db, _db.cachedAppointments);
  $$CachedPrescriptionsTableTableManager get cachedPrescriptions =>
      $$CachedPrescriptionsTableTableManager(_db, _db.cachedPrescriptions);
  $$CachedLabResultsTableTableManager get cachedLabResults =>
      $$CachedLabResultsTableTableManager(_db, _db.cachedLabResults);
  $$CachedHealthRecordsTableTableManager get cachedHealthRecords =>
      $$CachedHealthRecordsTableTableManager(_db, _db.cachedHealthRecords);
  $$CachedDoctorsTableTableManager get cachedDoctors =>
      $$CachedDoctorsTableTableManager(_db, _db.cachedDoctors);
  $$CachedHospitalsTableTableManager get cachedHospitals =>
      $$CachedHospitalsTableTableManager(_db, _db.cachedHospitals);
  $$CachedArticlesTableTableManager get cachedArticles =>
      $$CachedArticlesTableTableManager(_db, _db.cachedArticles);
  $$CachedProfileTableTableManager get cachedProfile =>
      $$CachedProfileTableTableManager(_db, _db.cachedProfile);
}

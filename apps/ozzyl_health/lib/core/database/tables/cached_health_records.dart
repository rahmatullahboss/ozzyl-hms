import 'package:drift/drift.dart';

class CachedHealthRecords extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get recordType => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}

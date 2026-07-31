import 'package:drift/drift.dart';

class CachedLabResults extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get remoteId => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}

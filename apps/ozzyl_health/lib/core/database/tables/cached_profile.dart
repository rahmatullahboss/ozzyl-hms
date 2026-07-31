import 'package:drift/drift.dart';

class CachedProfile extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get dataJson => text()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}

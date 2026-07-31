import 'package:drift/drift.dart';

class JournalEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  TextColumn get content => text()();
  TextColumn get moodTag => text().nullable()();
}

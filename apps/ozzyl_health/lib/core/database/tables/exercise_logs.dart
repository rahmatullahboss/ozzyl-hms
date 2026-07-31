import 'package:drift/drift.dart';

class ExerciseLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  TextColumn get type => text()();
  IntColumn get durationMin => integer()();
  IntColumn get calories => integer().nullable()();
}

import 'package:drift/drift.dart';

class MoodEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  IntColumn get moodLevel => integer()
      .check(const CustomExpression<bool>('mood_level BETWEEN 1 AND 5'))();
  TextColumn get notes => text().nullable()();
  TextColumn get tags => text().nullable()();
}

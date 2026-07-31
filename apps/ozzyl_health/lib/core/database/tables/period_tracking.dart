import 'package:drift/drift.dart';

class PeriodTracking extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get date => dateTime()();
  IntColumn get flowLevel => integer()
      .check(const CustomExpression<bool>('flow_level BETWEEN 0 AND 4'))();
  TextColumn get symptoms => text().nullable()();
  TextColumn get notes => text().nullable()();
}

import 'package:drift/drift.dart';

class SleepLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get date => dateTime()();
  DateTimeColumn get bedtime => dateTime()();
  DateTimeColumn get wakeTime => dateTime()();
  IntColumn get quality => integer()
      .check(const CustomExpression<bool>('quality BETWEEN 1 AND 5'))
      .nullable()();
}

import 'package:drift/drift.dart';

@DataClassName('DailyStep')
class DailySteps extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get date => dateTime()();
  IntColumn get count => integer()();
  TextColumn get source => text().withDefault(const Constant('pedometer'))();
}

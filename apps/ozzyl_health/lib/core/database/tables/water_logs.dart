import 'package:drift/drift.dart';

class WaterLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  IntColumn get amountMl => integer()();
}

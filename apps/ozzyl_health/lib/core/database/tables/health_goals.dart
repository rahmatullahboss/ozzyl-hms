import 'package:drift/drift.dart';

class HealthGoals extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get title => text()();
  RealColumn get target => real()();
  RealColumn get current => real().withDefault(const Constant(0))();
  TextColumn get unit => text()();
  DateTimeColumn get deadline => dateTime().nullable()();
  BoolColumn get active => boolean().withDefault(const Constant(true))();
}

import 'package:drift/drift.dart';

class MedicationReminders extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
  TextColumn get dosage => text()();
  TextColumn get frequency => text()();
  TextColumn get times => text()();
  BoolColumn get active => boolean().withDefault(const Constant(true))();
}

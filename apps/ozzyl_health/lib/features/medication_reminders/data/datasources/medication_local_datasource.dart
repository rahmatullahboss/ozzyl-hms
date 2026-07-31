import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/medication.dart';

class MedicationLocalDatasource {
  final WellnessDatabase _db;
  MedicationLocalDatasource(this._db);

  Future<List<Medication>> getActive() async {
    final query = _db.select(_db.medicationReminders)
      ..where((t) => t.active.equals(true));
    final rows = await query.get();
    return rows
        .map(
          (r) => Medication(
            id: r.id,
            name: r.name,
            dosage: r.dosage,
            frequency: r.frequency,
            times: r.times,
            active: r.active,
          ),
        )
        .toList();
  }

  Future<List<Medication>> getAll() async {
    final rows = await _db.select(_db.medicationReminders).get();
    return rows
        .map(
          (r) => Medication(
            id: r.id,
            name: r.name,
            dosage: r.dosage,
            frequency: r.frequency,
            times: r.times,
            active: r.active,
          ),
        )
        .toList();
  }

  Future<void> add(Medication med) async {
    await _db.into(_db.medicationReminders).insert(
          MedicationRemindersCompanion.insert(
            name: med.name,
            dosage: med.dosage,
            frequency: med.frequency,
            times: med.times,
          ),
        );
  }

  Future<void> toggleActive(int id, bool active) async {
    await (_db.update(_db.medicationReminders)
          ..where((t) => t.id.equals(id)))
        .write(MedicationRemindersCompanion(active: Value(active)));
  }

  Future<void> delete(int id) async {
    await (_db.delete(_db.medicationReminders)
          ..where((t) => t.id.equals(id)))
        .go();
  }
}

import '../entities/medication.dart';

abstract class MedicationRepository {
  Future<List<Medication>> getActive();
  Future<void> add(Medication med);
  Future<void> toggleActive(int id, bool active);
  Future<void> delete(int id);
}

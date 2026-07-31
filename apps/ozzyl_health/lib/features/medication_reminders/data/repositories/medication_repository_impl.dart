import '../../domain/entities/medication.dart';
import '../../domain/repositories/medication_repository.dart';
import '../datasources/medication_local_datasource.dart';

class MedicationRepositoryImpl implements MedicationRepository {
  final MedicationLocalDatasource _local;
  MedicationRepositoryImpl(this._local);

  @override
  Future<List<Medication>> getActive() => _local.getActive();

  @override
  Future<void> add(Medication med) => _local.add(med);

  @override
  Future<void> toggleActive(int id, bool active) =>
      _local.toggleActive(id, active);

  @override
  Future<void> delete(int id) => _local.delete(id);
}

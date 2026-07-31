import '../entities/lab_result.dart';

abstract class LabRepository {
  Future<List<LabResult>> getAll();
  Future<LabResult> getDetail(String id);
}

import '../entities/prescription.dart';

abstract class PrescriptionRepository {
  Future<List<Prescription>> getAll();
  Future<List<Prescription>> getActive();
  Future<void> requestRefill(String id);
}

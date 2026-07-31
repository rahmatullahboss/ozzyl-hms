import '../../domain/entities/medication.dart';

abstract class MedicationState {}

class MedicationInitial extends MedicationState {}

class MedicationLoading extends MedicationState {}

class MedicationLoaded extends MedicationState {
  final List<Medication> medications;
  MedicationLoaded(this.medications);
}

class MedicationError extends MedicationState {
  final String message;
  MedicationError(this.message);
}

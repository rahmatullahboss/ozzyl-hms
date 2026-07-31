import '../../domain/entities/medication.dart';

abstract class MedicationEvent {}

class LoadMedications extends MedicationEvent {}

class AddMedication extends MedicationEvent {
  final Medication medication;
  AddMedication(this.medication);
}

class ToggleMedication extends MedicationEvent {
  final int id;
  final bool active;
  ToggleMedication(this.id, this.active);
}

class DeleteMedication extends MedicationEvent {
  final int id;
  DeleteMedication(this.id);
}

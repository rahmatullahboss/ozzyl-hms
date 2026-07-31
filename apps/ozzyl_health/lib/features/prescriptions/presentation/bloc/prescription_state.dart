import '../../domain/entities/prescription.dart';

abstract class PrescriptionState {}

class PrescriptionInitial extends PrescriptionState {}

class PrescriptionLoading extends PrescriptionState {}

class PrescriptionLoaded extends PrescriptionState {
  final List<Prescription> active;
  final List<Prescription> completed;

  PrescriptionLoaded({
    required this.active,
    required this.completed,
  });
}

class PrescriptionError extends PrescriptionState {
  final String message;
  PrescriptionError(this.message);
}

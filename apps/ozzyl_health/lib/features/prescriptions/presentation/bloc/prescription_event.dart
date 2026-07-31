abstract class PrescriptionEvent {}

class LoadPrescriptions extends PrescriptionEvent {}

class RequestRefill extends PrescriptionEvent {
  final String id;
  RequestRefill(this.id);
}

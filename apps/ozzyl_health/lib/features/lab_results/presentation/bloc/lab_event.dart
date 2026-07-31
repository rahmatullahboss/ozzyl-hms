abstract class LabEvent {}

class LoadLabResults extends LabEvent {}

class LoadLabResultDetail extends LabEvent {
  final String id;
  LoadLabResultDetail(this.id);
}

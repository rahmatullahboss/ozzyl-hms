import '../../domain/entities/lab_result.dart';

abstract class LabState {}

class LabInitial extends LabState {}

class LabLoading extends LabState {}

class LabListLoaded extends LabState {
  final List<LabResult> results;
  LabListLoaded(this.results);
}

class LabDetailLoaded extends LabState {
  final LabResult result;
  LabDetailLoaded(this.result);
}

class LabError extends LabState {
  final String message;
  LabError(this.message);
}

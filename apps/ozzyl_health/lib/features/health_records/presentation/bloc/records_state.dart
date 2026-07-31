import '../../domain/entities/health_record.dart';

abstract class RecordsState {}

class RecordsInitial extends RecordsState {}

class RecordsLoading extends RecordsState {}

class RecordsLoaded extends RecordsState {
  final PatientHealthRecords records;
  RecordsLoaded(this.records);
}

class RecordsError extends RecordsState {
  final String message;
  RecordsError(this.message);
}

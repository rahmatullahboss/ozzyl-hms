import 'package:ozzyl_core/ozzyl_core.dart';

abstract class HospitalState {}

class HospitalInitial extends HospitalState {}

class HospitalLoading extends HospitalState {}

class HospitalListLoaded extends HospitalState {
  final List<Hospital> hospitals;
  final List<Hospital> filtered;
  final String searchQuery;

  HospitalListLoaded({
    required this.hospitals,
    List<Hospital>? filtered,
    this.searchQuery = '',
  }) : filtered = filtered ?? hospitals;
}

class HospitalDetailLoaded extends HospitalState {
  final HospitalDetail detail;
  HospitalDetailLoaded(this.detail);
}

class HospitalError extends HospitalState {
  final String message;
  HospitalError(this.message);
}

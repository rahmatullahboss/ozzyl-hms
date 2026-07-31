import '../../domain/entities/period_entry.dart';

abstract class PeriodState {}

class PeriodInitial extends PeriodState {}

class PeriodLoading extends PeriodState {}

class PeriodLoaded extends PeriodState {
  final List<PeriodEntry> entries;
  final int? daysUntilNext;
  final int avgCycleLength;

  PeriodLoaded({
    required this.entries,
    this.daysUntilNext,
    required this.avgCycleLength,
  });
}

class PeriodError extends PeriodState {
  final String message;
  PeriodError(this.message);
}

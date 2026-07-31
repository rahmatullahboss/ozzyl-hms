import '../../domain/entities/period_entry.dart';

abstract class PeriodEvent {}

class LoadPeriodData extends PeriodEvent {}

class AddPeriodEntry extends PeriodEvent {
  final PeriodEntry entry;
  AddPeriodEntry(this.entry);
}

class DeletePeriodEntry extends PeriodEvent {
  final int id;
  DeletePeriodEntry(this.id);
}

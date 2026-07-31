import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/health_records_repository.dart';
import 'records_event.dart';
import 'records_state.dart';

class RecordsBloc extends Bloc<RecordsEvent, RecordsState> {
  final HealthRecordsRepository _repository;

  RecordsBloc(this._repository) : super(RecordsInitial()) {
    on<LoadHealthRecords>(_onLoadRecords);
  }

  Future<void> _onLoadRecords(
    LoadHealthRecords event,
    Emitter<RecordsState> emit,
  ) async {
    emit(RecordsLoading());
    try {
      final records = await _repository.getRecords();
      emit(RecordsLoaded(records));
    } catch (e) {
      emit(RecordsError(e.toString()));
    }
  }
}

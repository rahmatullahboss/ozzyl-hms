import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/family_repository.dart';
import 'family_event.dart';
import 'family_state.dart';

class FamilyBloc extends Bloc<FamilyEvent, FamilyState> {
  final FamilyRepository _repository;

  FamilyBloc(this._repository) : super(FamilyInitial()) {
    on<LoadFamily>(_onLoad);
    on<AddFamilyMember>(_onAdd);
  }

  Future<void> _onLoad(
    LoadFamily event,
    Emitter<FamilyState> emit,
  ) async {
    emit(FamilyLoading());
    try {
      final members = await _repository.getMembers();
      emit(FamilyLoaded(members));
    } catch (e) {
      emit(FamilyError(e.toString()));
    }
  }

  Future<void> _onAdd(
    AddFamilyMember event,
    Emitter<FamilyState> emit,
  ) async {
    try {
      await _repository.addMember(
        name: event.name,
        relationship: event.relationship,
        email: event.email,
      );
      add(LoadFamily());
    } catch (e) {
      emit(FamilyError(e.toString()));
    }
  }
}

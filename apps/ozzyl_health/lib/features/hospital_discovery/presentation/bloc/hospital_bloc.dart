import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/hospital_repository.dart';
import 'hospital_event.dart';
import 'hospital_state.dart';

class HospitalBloc extends Bloc<HospitalEvent, HospitalState> {
  final HospitalRepository _repository;

  HospitalBloc(this._repository) : super(HospitalInitial()) {
    on<LoadNearbyHospitals>(_onLoadNearby);
    on<LoadHospitalDetail>(_onLoadDetail);
    on<SearchHospitals>(_onSearch);
    on<LinkHospital>(_onLink);
    on<UnlinkHospital>(_onUnlink);
  }

  Future<void> _onLoadNearby(
    LoadNearbyHospitals event,
    Emitter<HospitalState> emit,
  ) async {
    emit(HospitalLoading());
    try {
      final hospitals = await _repository.getNearby(
        lat: event.lat,
        lng: event.lng,
        city: event.city,
      );
      emit(HospitalListLoaded(hospitals: hospitals));
    } catch (e) {
      emit(HospitalError(e.toString()));
    }
  }

  Future<void> _onLoadDetail(
    LoadHospitalDetail event,
    Emitter<HospitalState> emit,
  ) async {
    emit(HospitalLoading());
    try {
      final detail = await _repository.getDetail(event.hospitalId);
      emit(HospitalDetailLoaded(detail));
    } catch (e) {
      emit(HospitalError(e.toString()));
    }
  }

  void _onSearch(SearchHospitals event, Emitter<HospitalState> emit) {
    final current = state;
    if (current is HospitalListLoaded) {
      final query = event.query.toLowerCase();
      if (query.isEmpty) {
        emit(HospitalListLoaded(hospitals: current.hospitals));
        return;
      }
      final filtered = current.hospitals.where((h) {
        return h.name.toLowerCase().contains(query) ||
            (h.city?.toLowerCase().contains(query) ?? false) ||
            h.specialties.any((s) => s.toLowerCase().contains(query));
      }).toList();
      emit(HospitalListLoaded(
        hospitals: current.hospitals,
        filtered: filtered,
        searchQuery: event.query,
      ));
    }
  }

  Future<void> _onLink(
    LinkHospital event,
    Emitter<HospitalState> emit,
  ) async {
    try {
      await _repository.linkHospital(event.hospitalId);
    } catch (_) {}
  }

  Future<void> _onUnlink(
    UnlinkHospital event,
    Emitter<HospitalState> emit,
  ) async {
    try {
      await _repository.unlinkHospital(event.hospitalId);
    } catch (_) {}
  }
}

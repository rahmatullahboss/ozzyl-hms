abstract class HospitalEvent {}

class LoadNearbyHospitals extends HospitalEvent {
  final double? lat;
  final double? lng;
  final String? city;
  LoadNearbyHospitals({this.lat, this.lng, this.city});
}

class LoadHospitalDetail extends HospitalEvent {
  final String hospitalId;
  LoadHospitalDetail(this.hospitalId);
}

class SearchHospitals extends HospitalEvent {
  final String query;
  SearchHospitals(this.query);
}

class LinkHospital extends HospitalEvent {
  final String hospitalId;
  LinkHospital(this.hospitalId);
}

class UnlinkHospital extends HospitalEvent {
  final String hospitalId;
  UnlinkHospital(this.hospitalId);
}

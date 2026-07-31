import '../../domain/entities/family_member.dart';
import '../../domain/repositories/family_repository.dart';
import '../datasources/family_remote_datasource.dart';

class FamilyRepositoryImpl implements FamilyRepository {
  final FamilyRemoteDatasource _remote;

  FamilyRepositoryImpl(this._remote);

  @override
  Future<List<FamilyMember>> getMembers() => _remote.getMembers();

  @override
  Future<FamilyMember> addMember({
    required String name,
    required String relationship,
    String? email,
  }) =>
      _remote.addMember(
        name: name,
        relationship: relationship,
        email: email,
      );
}

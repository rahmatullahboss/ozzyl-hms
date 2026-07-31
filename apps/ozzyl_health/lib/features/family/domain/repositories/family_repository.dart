import '../entities/family_member.dart';

abstract class FamilyRepository {
  Future<List<FamilyMember>> getMembers();
  Future<FamilyMember> addMember({
    required String name,
    required String relationship,
    String? email,
  });
}

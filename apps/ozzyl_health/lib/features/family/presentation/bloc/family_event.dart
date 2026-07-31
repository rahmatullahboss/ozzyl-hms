abstract class FamilyEvent {}

class LoadFamily extends FamilyEvent {}

class AddFamilyMember extends FamilyEvent {
  final String name;
  final String relationship;
  final String? email;

  AddFamilyMember({
    required this.name,
    required this.relationship,
    this.email,
  });
}

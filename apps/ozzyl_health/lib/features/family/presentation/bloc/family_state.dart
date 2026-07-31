import '../../domain/entities/family_member.dart';

abstract class FamilyState {}

class FamilyInitial extends FamilyState {}

class FamilyLoading extends FamilyState {}

class FamilyLoaded extends FamilyState {
  final List<FamilyMember> members;
  FamilyLoaded(this.members);
}

class FamilyError extends FamilyState {
  final String message;
  FamilyError(this.message);
}

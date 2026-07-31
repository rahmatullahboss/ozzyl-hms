class FamilyMember {
  final String id;
  final String name;
  final String relationship;
  final String? email;
  final String? phone;
  final bool? hasAccount;

  const FamilyMember({
    required this.id,
    required this.name,
    required this.relationship,
    this.email,
    this.phone,
    this.hasAccount,
  });

  factory FamilyMember.fromJson(Map<String, dynamic> json) {
    return FamilyMember(
      id: json['id'] as String,
      name: json['name'] as String,
      relationship: json['relationship'] as String,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      hasAccount: json['hasAccount'] as bool?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'relationship': relationship,
      if (email != null) 'email': email,
      if (phone != null) 'phone': phone,
      if (hasAccount != null) 'hasAccount': hasAccount,
    };
  }
}

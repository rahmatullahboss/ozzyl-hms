import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/vault_document.dart';
import '../../domain/services/vault_file_policy.dart';

class DocumentVaultRemoteDatasource {
  final ApiClient _apiClient;

  DocumentVaultRemoteDatasource(this._apiClient);

  Future<List<VaultDocument>> listDocuments() async {
    final response =
        await _apiClient.dio.get('${ApiConstants.patientPhr}/vault');
    final list = response.data['documents'] as List? ?? [];
    return list
        .map((item) => VaultDocument.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<VaultDocument> upload({
    required PlatformFile file,
    required String title,
    required String documentType,
    DateTime? documentDate,
    String? notes,
    void Function(int sent, int total)? onSendProgress,
  }) async {
    final validation = VaultFilePolicy.validate(
      fileName: file.name,
      sizeBytes: file.size,
    );
    if (validation != null) {
      throw ArgumentError(validation);
    }

    final multipartFile = file.bytes != null
        ? MultipartFile.fromBytes(
            file.bytes!,
            filename: file.name,
            contentType:
                DioMediaType.parse(VaultFilePolicy.mimeTypeFor(file.name)),
          )
        : await MultipartFile.fromFile(
            file.path!,
            filename: file.name,
            contentType:
                DioMediaType.parse(VaultFilePolicy.mimeTypeFor(file.name)),
          );

    final formData = FormData.fromMap({
      'file': multipartFile,
      'title': title.trim(),
      'document_type': documentType,
      if (documentDate != null)
        'document_date': documentDate.toIso8601String().split('T').first,
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
    });

    final response = await _apiClient.dio.post(
      '${ApiConstants.patientPhr}/vault/upload',
      data: formData,
      onSendProgress: onSendProgress,
    );
    return VaultDocument.fromJson(
        response.data['document'] as Map<String, dynamic>);
  }
}

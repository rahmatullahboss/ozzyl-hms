class VaultFilePolicy {
  static const int maxBytes = 10 * 1024 * 1024;
  static const Set<String> allowedExtensions = {
    'pdf',
    'jpg',
    'jpeg',
    'png',
    'webp',
  };

  static const Map<String, String> mimeByExtension = {
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
  };

  static String? validate({
    required String fileName,
    required int sizeBytes,
  }) {
    final extension = fileName.split('.').last.toLowerCase();
    if (!allowedExtensions.contains(extension)) {
      return 'Only PDF, JPG, PNG, and WebP files are allowed.';
    }
    if (sizeBytes <= 0) {
      return 'The selected file is empty.';
    }
    if (sizeBytes > maxBytes) {
      return 'File size must be 10MB or smaller.';
    }
    return null;
  }

  static String mimeTypeFor(String fileName) {
    final extension = fileName.split('.').last.toLowerCase();
    return mimeByExtension[extension] ?? 'application/octet-stream';
  }
}

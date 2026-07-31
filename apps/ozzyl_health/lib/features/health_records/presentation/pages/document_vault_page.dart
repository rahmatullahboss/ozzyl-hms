import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/document_vault_remote_datasource.dart';
import '../../domain/entities/vault_document.dart';
import '../../domain/services/vault_file_policy.dart';

class DocumentVaultPage extends StatefulWidget {
  const DocumentVaultPage({super.key});

  @override
  State<DocumentVaultPage> createState() => _DocumentVaultPageState();
}

class _DocumentVaultPageState extends State<DocumentVaultPage> {
  late final DocumentVaultRemoteDatasource _datasource;
  List<VaultDocument> _documents = [];
  bool _loading = true;
  bool _uploading = false;
  double _progress = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _datasource = DocumentVaultRemoteDatasource(sl<ApiClient>());
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final documents = await _datasource.listDocuments();
      if (!mounted) return;
      setState(() => _documents = documents);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Unable to load documents. $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickAndUpload() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: VaultFilePolicy.allowedExtensions.toList(),
      withData: true,
    );
    if (result == null || result.files.isEmpty) return;
    final file = result.files.single;
    final validation = VaultFilePolicy.validate(
      fileName: file.name,
      sizeBytes: file.size,
    );
    if (validation != null) {
      _showMessage(validation);
      return;
    }
    if (!mounted) return;
    final title = await _askTitle(file.name);
    if (title == null || title.trim().isEmpty) return;

    setState(() {
      _uploading = true;
      _progress = 0;
    });
    try {
      final uploaded = await _datasource.upload(
        file: file,
        title: title,
        documentType: _inferDocumentType(file.name),
        onSendProgress: (sent, total) {
          if (mounted && total > 0) {
            setState(() => _progress = sent / total);
          }
        },
      );
      if (!mounted) return;
      setState(() => _documents = [uploaded, ..._documents]);
      _showMessage('Document uploaded to your vault.');
    } catch (e) {
      if (!mounted) return;
      _showMessage('Upload failed. $e');
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _progress = 0;
        });
      }
    }
  }

  Future<String?> _askTitle(String fileName) async {
    final controller = TextEditingController(text: fileName);
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Document title'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Title'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Upload'),
          ),
        ],
      ),
    );
  }

  String _inferDocumentType(String fileName) {
    final lower = fileName.toLowerCase();
    if (lower.contains('prescription') || lower.contains('rx')) {
      return 'prescription';
    }
    if (lower.contains('lab') || lower.contains('report')) {
      return 'lab_report';
    }
    if (lower.contains('discharge')) {
      return 'discharge_summary';
    }
    return 'other';
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openDocument(VaultDocument document) async {
    final url = document.documentUrl;
    if (url == null || url.isEmpty) {
      _showMessage('No file URL is available for this document.');
      return;
    }
    final absolute = url.startsWith('http')
        ? Uri.parse(url)
        : Uri.parse('${ApiConstants.prodBaseUrl}$url');
    final launched =
        await launchUrl(absolute, mode: LaunchMode.externalApplication);
    if (!launched) {
      _showMessage('Could not open the document.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Document Vault'),
        actions: [
          IconButton(
            tooltip: 'Upload document',
            onPressed: _uploading ? null : _pickAndUpload,
            icon: const Icon(Icons.upload_file),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_uploading) ...[
              LinearProgressIndicator(value: _progress == 0 ? null : _progress),
              const SizedBox(height: 12),
            ],
            const Text(
              'Upload PDF or image records up to 10MB. Files are sent to the protected patient vault endpoint and opened through authenticated file routes.',
              style: TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_error != null)
              _EmptyState(icon: Icons.error_outline, text: _error!)
            else if (_documents.isEmpty)
              const _EmptyState(
                icon: Icons.folder_open,
                text: 'No vault documents yet.',
              )
            else
              ..._documents.map(
                (document) => Card(
                  child: ListTile(
                    leading:
                        const Icon(Icons.description, color: AppColors.primary),
                    title: Text(document.title),
                    subtitle: Text([
                      document.documentType.replaceAll('_', ' '),
                      if (document.documentDate != null)
                        DateFormat.yMMMd().format(document.documentDate!),
                      if (document.fileSize != null)
                        '${(document.fileSize! / 1024).toStringAsFixed(0)} KB',
                    ].join(' • ')),
                    trailing: const Icon(Icons.open_in_new),
                    onTap: () => _openDocument(document),
                  ),
                ),
              ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _uploading ? null : _pickAndUpload,
        icon: const Icon(Icons.upload_file),
        label: const Text('Upload'),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String text;

  const _EmptyState({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Icon(icon, size: 56, color: AppColors.textSecondary),
          const SizedBox(height: 12),
          Text(text, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/document_vault_remote_datasource.dart';
import '../../data/datasources/health_records_remote_datasource.dart';

class HealthTimelinePage extends StatefulWidget {
  const HealthTimelinePage({super.key});

  @override
  State<HealthTimelinePage> createState() => _HealthTimelinePageState();
}

class _HealthTimelinePageState extends State<HealthTimelinePage> {
  List<_TimelineEntry> _entries = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final records =
          await HealthRecordsRemoteDatasource(sl<ApiClient>()).getRecords();
      final documents =
          await DocumentVaultRemoteDatasource(sl<ApiClient>()).listDocuments();
      final entries = <_TimelineEntry>[
        ...records.diagnoses.map(
          (item) => _TimelineEntry(
            date: item.date,
            title: item.name,
            type: 'Diagnosis',
            icon: Icons.medical_information,
          ),
        ),
        ...records.immunizations.map(
          (item) => _TimelineEntry(
            date: item.date,
            title: item.name,
            type: 'Vaccine',
            icon: Icons.vaccines,
          ),
        ),
        ...documents.map(
          (item) => _TimelineEntry(
            date: item.documentDate,
            title: item.title,
            type: item.documentType.replaceAll('_', ' '),
            icon: Icons.description,
          ),
        ),
      ]..sort((a, b) {
          final aDate = a.date ?? DateTime.fromMillisecondsSinceEpoch(0);
          final bDate = b.date ?? DateTime.fromMillisecondsSinceEpoch(0);
          return bDate.compareTo(aDate);
        });
      if (!mounted) return;
      setState(() => _entries = entries);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Unable to build timeline. $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Health Timeline')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_error != null)
              Text(_error!, style: const TextStyle(color: AppColors.error))
            else if (_entries.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(child: Text('No timeline events yet.')),
              )
            else
              ..._entries.map(
                (entry) => ListTile(
                  leading: Icon(entry.icon, color: AppColors.primary),
                  title: Text(entry.title),
                  subtitle: Text(entry.type),
                  trailing: Text(
                    entry.date == null
                        ? 'No date'
                        : DateFormat.yMMMd().format(entry.date!),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TimelineEntry {
  final DateTime? date;
  final String title;
  final String type;
  final IconData icon;

  const _TimelineEntry({
    required this.date,
    required this.title,
    required this.type,
    required this.icon,
  });
}

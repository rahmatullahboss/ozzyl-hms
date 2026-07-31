import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../data/datasources/journal_local_datasource.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/database/wellness_database.dart';

class JournalPage extends StatefulWidget {
  const JournalPage({super.key});

  @override
  State<JournalPage> createState() => _JournalPageState();
}

class _JournalPageState extends State<JournalPage> {
  final _controller = TextEditingController();
  late final JournalLocalDatasource _datasource;
  List<JournalEntry> _entries = [];

  @override
  void initState() {
    super.initState();
    _datasource = JournalLocalDatasource(sl<WellnessDatabase>());
    _loadEntries();
  }

  Future<void> _loadEntries() async {
    final entries = await _datasource.getEntries();
    if (mounted) setState(() => _entries = entries);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Stress Journal')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: const InputDecoration(
                      hintText: "What's on your mind?",
                    ),
                    maxLines: 3,
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.send, color: AppColors.primary),
                  onPressed: () async {
                    if (_controller.text.trim().isNotEmpty) {
                      await _datasource.addEntry(
                        _controller.text.trim(),
                        null,
                      );
                      _controller.clear();
                      _loadEntries();
                    }
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: _entries.isEmpty
                ? const Center(
                    child: Text('Start journaling to track your thoughts'),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _entries.length,
                    itemBuilder: (context, i) {
                      final entry = _entries[i];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          title: Text(entry.content),
                          subtitle: Text(
                            '${entry.timestamp.month}/${entry.timestamp.day} at ${entry.timestamp.hour}:${entry.timestamp.minute.toString().padLeft(2, '0')}',
                          ),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline, size: 20),
                            onPressed: () async {
                              await _datasource.deleteEntry(entry.id);
                              _loadEntries();
                            },
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

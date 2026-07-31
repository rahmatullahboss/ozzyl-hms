import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:intl/intl.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/vitals_secure_storage.dart';
import '../../domain/vital_entry.dart';

class VitalsPage extends StatefulWidget {
  const VitalsPage({super.key});

  @override
  State<VitalsPage> createState() => _VitalsPageState();
}

class _VitalsPageState extends State<VitalsPage> {
  late final VitalsSecureStorage _storage;
  final _systolic = TextEditingController();
  final _diastolic = TextEditingController();
  final _pulse = TextEditingController();
  final _glucose = TextEditingController();
  final _weight = TextEditingController();
  final _notes = TextEditingController();
  String _glucoseContext = 'random';
  List<VitalEntry> _entries = [];

  @override
  void initState() {
    super.initState();
    _storage = VitalsSecureStorage(sl<FlutterSecureStorage>());
    _load();
  }

  @override
  void dispose() {
    _systolic.dispose();
    _diastolic.dispose();
    _pulse.dispose();
    _glucose.dispose();
    _weight.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final entries = await _storage.readAll();
    if (!mounted) return;
    setState(() => _entries = entries);
  }

  Future<void> _save() async {
    final entry = VitalEntry(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      timestamp: DateTime.now(),
      systolic: int.tryParse(_systolic.text),
      diastolic: int.tryParse(_diastolic.text),
      pulse: int.tryParse(_pulse.text),
      glucose: double.tryParse(_glucose.text),
      glucoseContext: _glucoseContext,
      weightKg: double.tryParse(_weight.text),
      notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
    );
    if (entry.systolic == null &&
        entry.diastolic == null &&
        entry.glucose == null &&
        entry.weightKg == null) {
      _message('Add at least blood pressure, glucose, or weight.');
      return;
    }
    await _storage.add(entry);
    _systolic.clear();
    _diastolic.clear();
    _pulse.clear();
    _glucose.clear();
    _weight.clear();
    _notes.clear();
    await _load();
    _message('Vitals saved on this device.');
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vitals')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: AppColors.info.withValues(alpha: 0.08),
            child: const Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Vitals are for tracking and discussion with a clinician. This screen does not diagnose or provide emergency advice.',
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _Field(controller: _systolic, label: 'Systolic')),
              const SizedBox(width: 8),
              Expanded(
                  child: _Field(controller: _diastolic, label: 'Diastolic')),
              const SizedBox(width: 8),
              Expanded(child: _Field(controller: _pulse, label: 'Pulse')),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _Field(controller: _glucose, label: 'Glucose')),
              const SizedBox(width: 8),
              DropdownButton<String>(
                value: _glucoseContext,
                items: const [
                  DropdownMenuItem(value: 'fasting', child: Text('Fasting')),
                  DropdownMenuItem(
                      value: 'post_meal', child: Text('Post-meal')),
                  DropdownMenuItem(value: 'random', child: Text('Random')),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _glucoseContext = value);
                },
              ),
            ],
          ),
          const SizedBox(height: 8),
          _Field(controller: _weight, label: 'Weight kg'),
          const SizedBox(height: 8),
          TextField(
            controller: _notes,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Notes'),
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            onPressed: _save,
            icon: const Icon(Icons.save),
            label: const Text('Save vitals'),
          ),
          const Divider(height: 32),
          Text('Recent entries',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_entries.isEmpty)
            const Text('No vitals logged yet.')
          else
            ..._entries.map(
              (entry) => Card(
                child: ListTile(
                  title:
                      Text(DateFormat.yMMMd().add_jm().format(entry.timestamp)),
                  subtitle: Text([
                    if (entry.systolic != null && entry.diastolic != null)
                      'BP ${entry.systolic}/${entry.diastolic}',
                    if (entry.pulse != null) 'Pulse ${entry.pulse}',
                    if (entry.glucose != null)
                      'Glucose ${entry.glucose} (${entry.glucoseContext})',
                    if (entry.weightKg != null) 'Weight ${entry.weightKg} kg',
                    if (entry.notes != null) entry.notes!,
                  ].join(' • ')),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final TextEditingController controller;
  final String label;

  const _Field({required this.controller, required this.label});

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: label),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/symptom_remote_datasource.dart';

class SymptomCheckerPage extends StatefulWidget {
  const SymptomCheckerPage({super.key});

  @override
  State<SymptomCheckerPage> createState() => _SymptomCheckerPageState();
}

class _SymptomCheckerPageState extends State<SymptomCheckerPage> {
  final _selectedSymptoms = <String>{};
  final _contextController = TextEditingController();
  String? _analysis;
  bool _loading = false;

  static const _commonSymptoms = [
    'Headache',
    'Fever',
    'Cough',
    'Sore Throat',
    'Fatigue',
    'Nausea',
    'Dizziness',
    'Body Ache',
    'Shortness of Breath',
    'Chest Pain',
    'Abdominal Pain',
    'Diarrhea',
    'Vomiting',
    'Runny Nose',
    'Joint Pain',
    'Back Pain',
    'Skin Rash',
  ];

  @override
  void dispose() {
    _contextController.dispose();
    super.dispose();
  }

  Future<void> _analyze() async {
    if (_selectedSymptoms.isEmpty) return;
    setState(() {
      _loading = true;
      _analysis = null;
    });
    try {
      final datasource = SymptomRemoteDatasource(sl<ApiClient>());
      final result = await datasource.analyzeSymptoms(
        _selectedSymptoms.toList(),
        additionalContext: _contextController.text.trim().isEmpty
            ? null
            : _contextController.text.trim(),
      );
      setState(() => _analysis = result);
    } catch (_) {
      setState(() => _analysis =
          'Unable to analyze symptoms. Please check your internet connection.');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Symptom Checker')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              color: AppColors.warning.withValues(alpha: 0.1),
              child: const Padding(
                padding: EdgeInsets.all(12),
                child: Text(
                  'This is not a medical diagnosis. For chest pain, severe breathing trouble, stroke symptoms, severe bleeding, fainting, seizure, or self-harm risk, seek emergency care now.',
                  style: TextStyle(fontSize: 13),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Select your symptoms',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _commonSymptoms
                  .map(
                    (s) => FilterChip(
                      label: Text(s),
                      selected: _selectedSymptoms.contains(s),
                      selectedColor: AppColors.primary.withValues(alpha: 0.2),
                      onSelected: (v) => setState(() => v
                          ? _selectedSymptoms.add(s)
                          : _selectedSymptoms.remove(s)),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _contextController,
              decoration: const InputDecoration(
                labelText: 'Additional details (optional)',
                hintText: 'Duration, severity, other info...',
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed:
                  _selectedSymptoms.isNotEmpty && !_loading ? _analyze : null,
              child: _loading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Analyze Symptoms'),
            ),
            if (_analysis != null) ...[
              const SizedBox(height: 24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.medical_information,
                              color: AppColors.primary),
                          const SizedBox(width: 8),
                          Text(
                            'Analysis',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(_analysis!),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

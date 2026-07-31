import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class HeartRiskPage extends StatefulWidget {
  const HeartRiskPage({super.key});

  @override
  State<HeartRiskPage> createState() => _HeartRiskPageState();
}

class _HeartRiskPageState extends State<HeartRiskPage> {
  final _ageController = TextEditingController();
  final _systolicController = TextEditingController();
  final _cholesterolController = TextEditingController();
  bool _isSmoker = false;
  bool _hasDiabetes = false;
  String? _riskLevel;
  int? _riskScore;

  void _calculate() {
    final age = int.tryParse(_ageController.text);
    final systolic = int.tryParse(_systolicController.text);
    final cholesterol = int.tryParse(_cholesterolController.text);
    if (age == null || systolic == null || cholesterol == null) return;

    var score = 0;

    if (age >= 55) {
      score += 3;
    } else if (age >= 45) {
      score += 2;
    } else if (age >= 35) {
      score += 1;
    }

    if (systolic >= 160) {
      score += 3;
    } else if (systolic >= 140) {
      score += 2;
    } else if (systolic >= 120) {
      score += 1;
    }

    if (cholesterol >= 280) {
      score += 3;
    } else if (cholesterol >= 240) {
      score += 2;
    } else if (cholesterol >= 200) {
      score += 1;
    }

    if (_isSmoker) score += 2;
    if (_hasDiabetes) score += 2;

    String level;
    if (score <= 3) {
      level = 'Low Risk';
    } else if (score <= 7) {
      level = 'Moderate Risk';
    } else {
      level = 'High Risk';
    }

    setState(() {
      _riskScore = score;
      _riskLevel = level;
    });
  }

  Color get _riskColor {
    switch (_riskLevel) {
      case 'Low Risk':
        return AppColors.success;
      case 'Moderate Risk':
        return AppColors.warning;
      case 'High Risk':
        return AppColors.error;
      default:
        return AppColors.textSecondary;
    }
  }

  @override
  void dispose() {
    _ageController.dispose();
    _systolicController.dispose();
    _cholesterolController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Heart Risk Score')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          TextField(
            controller: _ageController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Age'),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _systolicController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Systolic BP (mmHg)',
              hintText: 'e.g. 120',
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _cholesterolController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Total Cholesterol (mg/dL)',
              hintText: 'e.g. 200',
            ),
          ),
          const SizedBox(height: 16),
          SwitchListTile(
            title: const Text('Smoker'),
            value: _isSmoker,
            onChanged: (v) => setState(() => _isSmoker = v),
          ),
          SwitchListTile(
            title: const Text('Diabetes'),
            value: _hasDiabetes,
            onChanged: (v) => setState(() => _hasDiabetes = v),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _calculate,
            child: const Text('Calculate Risk'),
          ),
          if (_riskLevel != null) ...[
            const SizedBox(height: 32),
            Center(
              child: Container(
                width: 140,
                height: 140,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _riskColor.withValues(alpha: 0.15),
                  border: Border.all(color: _riskColor, width: 3),
                ),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.favorite, color: _riskColor, size: 32),
                      Text(
                        '$_riskScore',
                        style: Theme.of(context)
                            .textTheme
                            .headlineMedium
                            ?.copyWith(
                              color: _riskColor,
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: Text(
                _riskLevel!,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: _riskColor,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: Text(
                'This is a simplified estimate. Consult your doctor for a comprehensive assessment.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

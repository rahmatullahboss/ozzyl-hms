import 'dart:math';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class BmiCalculatorPage extends StatefulWidget {
  const BmiCalculatorPage({super.key});

  @override
  State<BmiCalculatorPage> createState() => _BmiCalculatorPageState();
}

class _BmiCalculatorPageState extends State<BmiCalculatorPage> {
  final _heightController = TextEditingController();
  final _weightController = TextEditingController();
  double? _bmi;
  String? _category;

  void _calculate() {
    final height = double.tryParse(_heightController.text);
    final weight = double.tryParse(_weightController.text);
    if (height == null || weight == null || height <= 0) return;

    final heightM = height / 100;
    final bmi = weight / pow(heightM, 2);

    String category;
    if (bmi < 18.5) {
      category = 'Underweight';
    } else if (bmi < 25) {
      category = 'Normal';
    } else if (bmi < 30) {
      category = 'Overweight';
    } else {
      category = 'Obese';
    }

    setState(() {
      _bmi = bmi;
      _category = category;
    });
  }

  Color get _categoryColor {
    switch (_category) {
      case 'Underweight':
        return AppColors.info;
      case 'Normal':
        return AppColors.success;
      case 'Overweight':
        return AppColors.warning;
      case 'Obese':
        return AppColors.error;
      default:
        return AppColors.textSecondary;
    }
  }

  @override
  void dispose() {
    _heightController.dispose();
    _weightController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('BMI Calculator')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _heightController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Height (cm)',
                hintText: 'e.g. 170',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _weightController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Weight (kg)',
                hintText: 'e.g. 70',
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _calculate,
              child: const Text('Calculate'),
            ),
            if (_bmi != null) ...[
              const SizedBox(height: 32),
              Center(
                child: Container(
                  width: 140,
                  height: 140,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _categoryColor.withValues(alpha: 0.15),
                    border: Border.all(color: _categoryColor, width: 3),
                  ),
                  child: Center(
                    child: Text(
                      _bmi!.toStringAsFixed(1),
                      style: Theme.of(context)
                          .textTheme
                          .displaySmall
                          ?.copyWith(
                            color: _categoryColor,
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  _category!,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: _categoryColor,
                        fontWeight: FontWeight.w600,
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

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class MeditationPage extends StatefulWidget {
  const MeditationPage({super.key});

  @override
  State<MeditationPage> createState() => _MeditationPageState();
}

class _MeditationPageState extends State<MeditationPage> {
  int _selectedMinutes = 5;
  int _remainingSeconds = 0;
  bool _isRunning = false;
  Timer? _timer;

  static const _durations = [3, 5, 10, 15, 20];

  void _start() {
    setState(() {
      _remainingSeconds = _selectedMinutes * 60;
      _isRunning = true;
    });
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_remainingSeconds <= 0) {
        t.cancel();
        setState(() => _isRunning = false);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Meditation complete!'),
              backgroundColor: AppColors.success,
            ),
          );
        }
      } else {
        setState(() => _remainingSeconds--);
      }
    });
  }

  void _stop() {
    _timer?.cancel();
    setState(() => _isRunning = false);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mins = _remainingSeconds ~/ 60;
    final secs = _remainingSeconds % 60;
    return Scaffold(
      appBar: AppBar(title: const Text('Meditation Timer')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!_isRunning) ...[
              Text(
                'Select Duration',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                children: _durations
                    .map(
                      (d) => ChoiceChip(
                        label: Text('$d min'),
                        selected: _selectedMinutes == d,
                        onSelected: (_) =>
                            setState(() => _selectedMinutes = d),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _start,
                child: const Text('Start'),
              ),
            ] else ...[
              Text(
                '${mins.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}',
                style: Theme.of(context)
                    .textTheme
                    .displayLarge
                    ?.copyWith(fontWeight: FontWeight.w300),
              ),
              const SizedBox(height: 16),
              Text(
                'Focus on your breath',
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 32),
              OutlinedButton(
                onPressed: _stop,
                child: const Text('Stop'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

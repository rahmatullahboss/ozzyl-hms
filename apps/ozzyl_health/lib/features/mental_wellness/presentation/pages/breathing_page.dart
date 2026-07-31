import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class BreathingPage extends StatefulWidget {
  const BreathingPage({super.key});

  @override
  State<BreathingPage> createState() => _BreathingPageState();
}

class _BreathingPageState extends State<BreathingPage>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  bool _isRunning = false;
  String _phase = 'Tap to start';
  int _cycles = 0;

  static const _breatheIn = 4;
  static const _hold = 4;
  static const _breatheOut = 4;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: _breatheIn + _hold + _breatheOut),
    );
  }

  @override
  void dispose() {
    _isRunning = false;
    _controller.dispose();
    super.dispose();
  }

  void _toggleBreathing() {
    if (_isRunning) {
      _controller.stop();
      setState(() {
        _isRunning = false;
        _phase = 'Paused';
      });
    } else {
      _runCycle();
    }
  }

  Future<void> _runCycle() async {
    setState(() => _isRunning = true);
    while (_isRunning && mounted) {
      setState(() => _phase = 'Breathe In');
      _controller.forward(from: 0);
      await Future.delayed(const Duration(seconds: _breatheIn));
      if (!_isRunning || !mounted) break;

      setState(() => _phase = 'Hold');
      await Future.delayed(const Duration(seconds: _hold));
      if (!_isRunning || !mounted) break;

      setState(() => _phase = 'Breathe Out');
      await Future.delayed(const Duration(seconds: _breatheOut));
      if (!_isRunning || !mounted) break;

      setState(() => _cycles++);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Breathing Exercise')),
      body: GestureDetector(
        onTap: _toggleBreathing,
        behavior: HitTestBehavior.opaque,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedBuilder(
                animation: _controller,
                builder: (context, child) {
                  final scale = 1.0 + _controller.value * 0.5;
                  return Transform.scale(
                    scale: scale,
                    child: Container(
                      width: 160,
                      height: 160,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.primary.withValues(alpha: 0.3),
                        border: Border.all(color: AppColors.primary, width: 3),
                      ),
                    ),
                  );
                },
              ),
              const SizedBox(height: 32),
              Text(
                _phase,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 8),
              Text(
                'Cycles: $_cycles',
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 32),
              Text(
                _isRunning ? 'Tap to pause' : 'Tap to start',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'dart:math';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class WellnessRings extends StatelessWidget {
  final double stepsProgress;
  final double waterProgress;
  final double moodProgress;

  const WellnessRings({
    super.key,
    required this.stepsProgress,
    required this.waterProgress,
    required this.moodProgress,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      height: 200,
      child: CustomPaint(
        painter: _RingsPainter(
          stepsProgress: stepsProgress.clamp(0.0, 1.0),
          waterProgress: waterProgress.clamp(0.0, 1.0),
          moodProgress: moodProgress.clamp(0.0, 1.0),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '${((stepsProgress + waterProgress + moodProgress) / 3 * 100).round()}%',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              Text(
                'Wellness',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RingsPainter extends CustomPainter {
  final double stepsProgress;
  final double waterProgress;
  final double moodProgress;

  _RingsPainter({
    required this.stepsProgress,
    required this.waterProgress,
    required this.moodProgress,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    const strokeWidth = 12.0;
    const startAngle = -pi / 2;

    _drawRing(canvas, center, 90, strokeWidth, AppColors.stepsRing, stepsProgress, startAngle);
    _drawRing(canvas, center, 72, strokeWidth, AppColors.waterRing, waterProgress, startAngle);
    _drawRing(canvas, center, 54, strokeWidth, AppColors.moodRing, moodProgress, startAngle);
  }

  void _drawRing(
    Canvas canvas,
    Offset center,
    double radius,
    double strokeWidth,
    Color color,
    double progress,
    double startAngle,
  ) {
    final bgPaint = Paint()
      ..color = color.withValues(alpha: 0.15)
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final fgPaint = Paint()
      ..color = color
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, bgPaint);
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      startAngle,
      2 * pi * progress,
      false,
      fgPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _RingsPainter old) =>
      old.stepsProgress != stepsProgress ||
      old.waterProgress != waterProgress ||
      old.moodProgress != moodProgress;
}

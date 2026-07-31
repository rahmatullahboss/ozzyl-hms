import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class AssessmentResultPage extends StatelessWidget {
  final String assessmentName;
  final int score;
  final int maxScore;
  final String severity;

  const AssessmentResultPage({
    super.key,
    required this.assessmentName,
    required this.score,
    required this.maxScore,
    required this.severity,
  });

  Color get _severityColor {
    switch (severity) {
      case 'Minimal':
        return AppColors.success;
      case 'Mild':
        return AppColors.moodOkay;
      case 'Moderate':
        return AppColors.warning;
      case 'Moderately Severe':
        return AppColors.accent;
      case 'Severe':
        return AppColors.error;
      default:
        return AppColors.info;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('$assessmentName Results')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 160,
              height: 160,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _severityColor.withValues(alpha: 0.15),
                border: Border.all(color: _severityColor, width: 4),
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '$score',
                      style: Theme.of(context).textTheme.displayMedium?.copyWith(
                            color: _severityColor,
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    Text(
                      'of $maxScore',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppColors.textSecondary,
                          ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 32),
            Text(
              severity,
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    color: _severityColor,
                    fontWeight: FontWeight.w600,
                  ),
            ),
            const SizedBox(height: 16),
            Text(
              _getAdvice(),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 48),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => context.pop(),
                child: const Text('Done'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _getAdvice() {
    switch (severity) {
      case 'Minimal':
        return 'Your score suggests minimal symptoms. Keep up your healthy habits!';
      case 'Mild':
        return 'Your score suggests mild symptoms. Consider self-care strategies and monitor your wellbeing.';
      case 'Moderate':
        return 'Your score suggests moderate symptoms. Consider talking to a healthcare professional.';
      case 'Moderately Severe':
        return 'Your score suggests moderately severe symptoms. We recommend consulting a healthcare professional.';
      case 'Severe':
        return 'Your score suggests severe symptoms. Please reach out to a healthcare professional for support.';
      default:
        return 'Review your results and consult with a healthcare provider if needed.';
    }
  }
}

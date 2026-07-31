import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class AssessmentsPage extends StatelessWidget {
  const AssessmentsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Health Assessments')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _AssessmentCard(
            title: 'PHQ-9 Depression Screen',
            description: '9 questions, ~3 min',
            icon: Icons.psychology,
            color: AppColors.info,
            onTap: () => context.push('/wellness/assessments/phq9'),
          ),
          _AssessmentCard(
            title: 'GAD-7 Anxiety Screen',
            description: '7 questions, ~2 min',
            icon: Icons.sentiment_dissatisfied,
            color: AppColors.warning,
            onTap: () => context.push('/wellness/assessments/gad7'),
          ),
          _AssessmentCard(
            title: 'BMI Calculator',
            description: 'Height + weight',
            icon: Icons.monitor_weight,
            color: AppColors.success,
            onTap: () => context.push('/wellness/assessments/bmi'),
          ),
          _AssessmentCard(
            title: 'Heart Risk Score',
            description: 'Age, BP, cholesterol',
            icon: Icons.favorite,
            color: AppColors.error,
            onTap: () => context.push('/wellness/assessments/heart'),
          ),
        ],
      ),
    );
  }
}

class _AssessmentCard extends StatelessWidget {
  final String title;
  final String description;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _AssessmentCard({
    required this.title,
    required this.description,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.1),
          child: Icon(icon, color: color),
        ),
        title: Text(
          title,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(description),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

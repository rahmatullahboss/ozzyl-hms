import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class MentalWellnessPage extends StatelessWidget {
  const MentalWellnessPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mental Wellness')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _FeatureCard(
            title: 'Breathing Exercise',
            description: '4-4-4 box breathing',
            icon: Icons.air,
            color: AppColors.info,
            onTap: () => context.push('/wellness/mental/breathing'),
          ),
          _FeatureCard(
            title: 'Meditation Timer',
            description: 'Guided silence timer',
            icon: Icons.self_improvement,
            color: AppColors.primary,
            onTap: () => context.push('/wellness/mental/meditation'),
          ),
          _FeatureCard(
            title: 'Stress Journal',
            description: 'Write down your thoughts',
            icon: Icons.edit_note,
            color: AppColors.accent,
            onTap: () => context.push('/wellness/mental/journal'),
          ),
        ],
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final String title;
  final String description;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _FeatureCard({
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

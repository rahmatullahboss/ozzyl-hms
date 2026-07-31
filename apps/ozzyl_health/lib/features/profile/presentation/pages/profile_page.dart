import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/theme/theme_controller.dart';
import '../../../auth/presentation/bloc/auth_bloc.dart';
import '../../../auth/presentation/bloc/auth_event.dart';
import '../../../auth/presentation/bloc/auth_state.dart';

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: BlocBuilder<AuthBloc, AuthState>(
        builder: (context, state) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                child: Column(
                  children: [
                    CircleAvatar(
                      radius: 48,
                      backgroundColor: AppColors.primaryLight,
                      child: state is Authenticated
                          ? Text(
                              state.user.name.isNotEmpty
                                  ? state.user.name[0].toUpperCase()
                                  : '?',
                              style: const TextStyle(
                                fontSize: 36,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.person,
                              size: 48, color: Colors.white),
                    ),
                    const SizedBox(height: 12),
                    if (state is Authenticated) ...[
                      Text(
                        state.user.name,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        state.user.email,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ] else
                      const Text('Guest User'),
                  ],
                ),
              ),
              const SizedBox(height: 32),
              _SectionHeader(title: 'Personal'),
              _SettingsTile(
                icon: Icons.person_outline,
                title: 'Personal Information',
                onTap: () => context.go('/profile'),
              ),
              _SettingsTile(
                icon: Icons.emergency_outlined,
                title: 'Emergency Info',
                subtitle: 'SOS contacts, blood type, allergy card',
                onTap: () => context.push('/emergency'),
              ),
              _SettingsTile(
                icon: Icons.local_hospital_outlined,
                title: 'Hospital Connection',
                onTap: () => context.go('/hospital'),
              ),
              _SettingsTile(
                icon: Icons.people_outline,
                title: 'Family Members',
                onTap: () => context.push('/family'),
              ),
              _SettingsTile(
                icon: Icons.privacy_tip_outlined,
                title: 'Privacy & Consent',
                subtitle: 'Legal docs, consent toggles, audit readiness',
                onTap: () => context.push('/privacy'),
              ),
              const SizedBox(height: 16),
              _SectionHeader(title: 'Preferences'),
              _SettingsTile(
                icon: Icons.notifications_outlined,
                title: 'Notifications',
                onTap: () => context.push('/notifications'),
              ),
              _SettingsTile(
                icon: Icons.language_outlined,
                title: 'Language',
                subtitle: 'English',
                onTap: () {},
              ),
              _SettingsTile(
                icon: Icons.dark_mode_outlined,
                title: 'Dark Mode',
                trailing: ValueListenableBuilder<ThemeMode>(
                  valueListenable: themeController,
                  builder: (context, mode, _) {
                    return Switch(
                      value: mode == ThemeMode.dark,
                      onChanged: themeController.setDarkMode,
                    );
                  },
                ),
                onTap: () => themeController.setDarkMode(
                  themeController.value != ThemeMode.dark,
                ),
              ),
              const SizedBox(height: 16),
              _SectionHeader(title: 'About'),
              _SettingsTile(
                icon: Icons.help_outline,
                title: 'Help',
                onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Support is coming soon')),
                ),
              ),
              _SettingsTile(
                icon: Icons.info_outline,
                title: 'About Ozzyl Health',
                subtitle: 'v1.0.0',
                onTap: () => showAboutDialog(
                  context: context,
                  applicationName: 'Ozzyl Health',
                  applicationVersion: '1.0.0',
                ),
              ),
              const SizedBox(height: 24),
              if (state is Authenticated)
                OutlinedButton.icon(
                  onPressed: () {
                    context
                        .read<AuthBloc>()
                        .add(const AuthEvent.logoutRequested());
                    context.go('/login');
                  },
                  icon: const Icon(Icons.logout, color: AppColors.error),
                  label: const Text('Logout',
                      style: TextStyle(color: AppColors.error)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppColors.error),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                )
              else
                ElevatedButton(
                  onPressed: () => context.go('/login'),
                  child: const Text('Login / Create Account'),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: AppColors.textSecondary,
            ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.primary),
      title: Text(title),
      subtitle: subtitle != null ? Text(subtitle!) : null,
      trailing: trailing ?? const Icon(Icons.chevron_right),
      onTap: onTap,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );
  }
}

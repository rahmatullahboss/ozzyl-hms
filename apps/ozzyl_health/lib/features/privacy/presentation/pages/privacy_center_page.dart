import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/consent_preferences_storage.dart';

class PrivacyCenterPage extends StatefulWidget {
  const PrivacyCenterPage({super.key});

  @override
  State<PrivacyCenterPage> createState() => _PrivacyCenterPageState();
}

class _PrivacyCenterPageState extends State<PrivacyCenterPage> {
  static const _currentLegalVersion = '2026.05.01';
  late final ConsentPreferencesStorage _storage;
  ConsentPreferences _preferences = ConsentPreferences.defaults();
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _storage = ConsentPreferencesStorage(sl<FlutterSecureStorage>());
    _load();
  }

  Future<void> _load() async {
    final preferences = await _storage.read();
    if (!mounted) return;
    setState(() {
      _preferences = preferences;
      _loading = false;
    });
  }

  Future<void> _save(ConsentPreferences preferences) async {
    final next = preferences.copyWith(updatedAt: DateTime.now());
    await _storage.save(next);
    if (!mounted) return;
    setState(() => _preferences = next);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy & Consent')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _SectionTitle('Legal'),
                _Tile(
                  icon: Icons.description_outlined,
                  title: 'Terms & Conditions',
                  subtitle: 'Version $_currentLegalVersion',
                  onTap: () => context.push('/privacy/terms'),
                ),
                _Tile(
                  icon: Icons.privacy_tip_outlined,
                  title: 'Privacy Policy',
                  subtitle: 'Health data handling and sharing rules',
                  onTap: () => context.push('/privacy/policy'),
                ),
                _Tile(
                  icon: Icons.medical_information_outlined,
                  title: 'Medical Disclaimer',
                  subtitle: 'Ozzyl Health is not a medical advisor',
                  onTap: () => context.push('/privacy/disclaimer'),
                ),
                CheckboxListTile(
                  value:
                      _preferences.acceptedLegalVersion == _currentLegalVersion,
                  onChanged: (value) => _save(
                    _preferences.copyWith(
                      acceptedLegalVersion:
                          value == true ? _currentLegalVersion : '',
                    ),
                  ),
                  title: const Text('I accept the current legal documents'),
                  subtitle: const Text('Required before production rollout'),
                ),
                const SizedBox(height: 16),
                _SectionTitle('Consent Controls'),
                SwitchListTile(
                  value: _preferences.hospitalAccess,
                  onChanged: (value) =>
                      _save(_preferences.copyWith(hospitalAccess: value)),
                  secondary: const Icon(Icons.local_hospital_outlined),
                  title: const Text('Hospital record access'),
                  subtitle: const Text(
                    'Allow linked hospitals to request your shared health data through server-side consent checks.',
                  ),
                ),
                SwitchListTile(
                  value: _preferences.aiContextAccess,
                  onChanged: (value) =>
                      _save(_preferences.copyWith(aiContextAccess: value)),
                  secondary: const Icon(Icons.smart_toy_outlined),
                  title: const Text('AI context access'),
                  subtitle: const Text(
                    'Allow AI features to use curated health context for summaries and wellness tips.',
                  ),
                ),
                SwitchListTile(
                  value: _preferences.familyProxyAccess,
                  onChanged: (value) =>
                      _save(_preferences.copyWith(familyProxyAccess: value)),
                  secondary: const Icon(Icons.family_restroom_outlined),
                  title: const Text('Family/proxy access'),
                  subtitle: const Text(
                    'Allow family features to manage or view approved profile areas.',
                  ),
                ),
                const SizedBox(height: 16),
                _SectionTitle('Audit & Release'),
                _Tile(
                  icon: Icons.history,
                  title: 'Access audit log',
                  subtitle:
                      'Backend audit feed pending. Current device consent changes are shown above.',
                  onTap: () => showDialog<void>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('Audit log'),
                      content: Text(
                        'Last local consent update: ${_preferences.updatedAt.toLocal()}.\n\nServer-side hospital and record access logs must come from the HMS audit API before production.',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Close'),
                        ),
                      ],
                    ),
                  ),
                ),
                _Tile(
                  icon: Icons.checklist,
                  title: 'Mobile release checklist',
                  subtitle: 'Permissions, security, app store declarations',
                  onTap: () => context.push('/privacy/release-checklist'),
                ),
              ],
            ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: AppColors.primary,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _Tile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.primary),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}

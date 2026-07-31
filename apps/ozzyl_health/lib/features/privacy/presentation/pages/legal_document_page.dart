import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

enum LegalDocumentType {
  terms,
  privacy,
  medicalDisclaimer,
  releaseChecklist,
}

class LegalDocumentPage extends StatelessWidget {
  final LegalDocumentType type;

  const LegalDocumentPage({super.key, required this.type});

  @override
  Widget build(BuildContext context) {
    final content = _contentFor(type);
    return Scaffold(
      appBar: AppBar(title: Text(content.title)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            content.title,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Version ${content.version}',
            style: const TextStyle(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 16),
          ...content.sections.map(
            (section) => Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child:
                  Text(section, style: Theme.of(context).textTheme.bodyLarge),
            ),
          ),
        ],
      ),
    );
  }

  _LegalContent _contentFor(LegalDocumentType type) {
    switch (type) {
      case LegalDocumentType.terms:
        return const _LegalContent(
          title: 'Terms & Conditions',
          version: '2026.05.01',
          sections: [
            'Ozzyl Health is a wellness and personal health record companion. It is not a replacement for licensed medical care.',
            'Users are responsible for keeping account credentials private and for reviewing any information before sharing it with a hospital, doctor, or family member.',
            'Hospital data remains subject to the source hospital and HMS access controls. Mobile screens only show data that the authenticated user is allowed to access.',
          ],
        );
      case LegalDocumentType.privacy:
        return const _LegalContent(
          title: 'Privacy Policy',
          version: '2026.05.01',
          sections: [
            'Health data is treated as sensitive. The app stores credentials and emergency health fragments in platform secure storage.',
            'The app does not intentionally log health details, tokens, request bodies, or response bodies.',
            'Hospital, AI, and family/proxy sharing should be explicit and revocable. Access events must be auditable by the backend source of truth.',
          ],
        );
      case LegalDocumentType.medicalDisclaimer:
        return const _LegalContent(
          title: 'Medical Disclaimer',
          version: '2026.05.01',
          sections: [
            'Ozzyl Health can help organize records, track wellness, and explain general health concepts in plain language.',
            'It does not diagnose disease, prescribe medicine, recommend dosage changes, or replace a licensed clinician.',
            'For chest pain, severe breathing trouble, stroke symptoms, severe bleeding, loss of consciousness, or any emergency, contact local emergency services immediately.',
          ],
        );
      case LegalDocumentType.releaseChecklist:
        return const _LegalContent(
          title: 'Mobile Release Checklist',
          version: '2026.05.01',
          sections: [
            'Permissions: document upload, notifications, location, HealthKit, and Health Connect must each have a clear user-facing purpose before release.',
            'Security: run flutter analyze, flutter test, mobile auth tests, API contract tests, and verify no PHI body logging is enabled.',
            'Store release: verify app icon, signing, privacy declarations, data safety forms, support links, and production-safe smoke accounts.',
          ],
        );
    }
  }
}

class _LegalContent {
  final String title;
  final String version;
  final List<String> sections;

  const _LegalContent({
    required this.title,
    required this.version,
    required this.sections,
  });
}

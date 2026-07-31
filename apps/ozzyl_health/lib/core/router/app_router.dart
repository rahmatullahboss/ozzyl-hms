import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'auth_route_policy.dart';
import 'shell_scaffold.dart';
import '../../features/onboarding/presentation/pages/onboarding_page.dart';
import '../../features/auth/presentation/pages/login_page.dart';
import '../../features/auth/presentation/pages/register_page.dart';
import '../../features/auth/presentation/pages/mfa_page.dart';
import '../../features/wellness_dashboard/presentation/pages/home_page.dart';
import '../../features/wellness_dashboard/presentation/pages/wellness_page.dart';
import '../../features/hospital_discovery/presentation/pages/hospital_page.dart';
import '../../features/health_articles/presentation/pages/articles_page.dart';
import '../../features/profile/presentation/pages/profile_page.dart';
import '../../features/mood_tracker/presentation/pages/mood_tracker_page.dart';
import '../../features/water_intake/presentation/pages/water_intake_page.dart';
import '../../features/sleep_log/presentation/pages/sleep_log_page.dart';
import '../../features/fitness/presentation/pages/exercise_log_page.dart';
import '../../features/health_goals/presentation/pages/health_goals_page.dart';
import '../../features/health_assessments/presentation/pages/assessments_page.dart';
import '../../features/health_assessments/presentation/pages/questionnaire_page.dart';
import '../../features/health_assessments/presentation/pages/assessment_result_page.dart';
import '../../features/health_assessments/presentation/pages/bmi_calculator_page.dart';
import '../../features/health_assessments/presentation/pages/heart_risk_page.dart';
import '../../features/health_assessments/data/questionnaires/phq9.dart';
import '../../features/health_assessments/data/questionnaires/gad7.dart';
import '../../features/health_assessments/data/datasources/assessment_local_datasource.dart';
import '../../features/mental_wellness/presentation/pages/mental_wellness_page.dart';
import '../../features/mental_wellness/presentation/pages/breathing_page.dart';
import '../../features/mental_wellness/presentation/pages/meditation_page.dart';
import '../../features/mental_wellness/presentation/pages/journal_page.dart';
import '../../features/womens_health/presentation/pages/period_tracker_page.dart';
import '../../features/medication_reminders/presentation/pages/medication_page.dart';
import '../../features/symptom_checker/presentation/pages/symptom_checker_page.dart';
import '../../features/emergency/presentation/pages/emergency_page.dart';
import '../../features/hospital_discovery/presentation/pages/hospital_detail_page.dart';
import '../../features/appointments/presentation/pages/appointments_page.dart';
import '../../features/appointments/presentation/pages/book_appointment_page.dart';
import '../../features/lab_results/presentation/pages/lab_results_page.dart';
import '../../features/lab_results/presentation/pages/lab_result_detail_page.dart';
import '../../features/family/presentation/pages/family_page.dart';
import '../../features/notifications/presentation/pages/notifications_page.dart';
import '../../features/prescriptions/presentation/pages/prescriptions_page.dart';
import '../../features/health_records/presentation/pages/health_records_page.dart';
import '../../features/health_records/presentation/pages/document_vault_page.dart';
import '../../features/health_records/presentation/pages/health_timeline_page.dart';
import '../../features/health_articles/presentation/pages/article_detail_page.dart';
import '../../features/privacy/presentation/pages/legal_document_page.dart';
import '../../features/privacy/presentation/pages/privacy_center_page.dart';
import '../../features/vitals/presentation/pages/vitals_page.dart';
import '../di/injection.dart';
import '../database/wellness_database.dart';

final appRouter = GoRouter(
  initialLocation: '/onboarding',
  redirect: (context, state) async {
    final prefs = await SharedPreferences.getInstance();
    final onboardingDone = prefs.getBool('onboarding_complete') ?? false;
    final path = state.uri.path;
    final isAuthenticated =
        sl.isRegistered<TokenStorage>() && await sl<TokenStorage>().hasToken();

    return AuthRoutePolicy.redirectFor(
      path: path,
      onboardingComplete: onboardingDone,
      isAuthenticated: isAuthenticated,
    );
  },
  routes: [
    GoRoute(
      path: '/onboarding',
      builder: (context, state) => const OnboardingPage(),
    ),
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginPage(),
    ),
    GoRoute(
      path: '/register',
      builder: (context, state) => const RegisterPage(),
    ),
    GoRoute(
      path: '/mfa',
      builder: (context, state) => MfaPage(tempToken: state.extra as String),
    ),
    GoRoute(
      path: '/emergency',
      builder: (context, state) => const EmergencyPage(),
    ),
    GoRoute(
      path: '/appointments',
      builder: (context, state) => const AppointmentsPage(),
    ),
    GoRoute(
      path: '/appointments/book',
      builder: (context, state) => const BookAppointmentPage(),
    ),
    GoRoute(
      path: '/lab-results',
      builder: (context, state) => const LabResultsPage(),
    ),
    GoRoute(
      path: '/lab-results/:id',
      builder: (context, state) => LabResultDetailPage(
        resultId: state.pathParameters['id']!,
      ),
    ),
    GoRoute(
      path: '/family',
      builder: (context, state) => const FamilyPage(),
    ),
    GoRoute(
      path: '/notifications',
      builder: (context, state) => const NotificationsPage(),
    ),
    GoRoute(
      path: '/prescriptions',
      builder: (context, state) => const PrescriptionsPage(),
    ),
    GoRoute(
      path: '/health-records',
      builder: (context, state) => const HealthRecordsPage(),
    ),
    GoRoute(
      path: '/health-records/vault',
      builder: (context, state) => const DocumentVaultPage(),
    ),
    GoRoute(
      path: '/health-records/timeline',
      builder: (context, state) => const HealthTimelinePage(),
    ),
    GoRoute(
      path: '/privacy',
      builder: (context, state) => const PrivacyCenterPage(),
    ),
    GoRoute(
      path: '/privacy/terms',
      builder: (context, state) =>
          const LegalDocumentPage(type: LegalDocumentType.terms),
    ),
    GoRoute(
      path: '/privacy/policy',
      builder: (context, state) =>
          const LegalDocumentPage(type: LegalDocumentType.privacy),
    ),
    GoRoute(
      path: '/privacy/disclaimer',
      builder: (context, state) =>
          const LegalDocumentPage(type: LegalDocumentType.medicalDisclaimer),
    ),
    GoRoute(
      path: '/privacy/release-checklist',
      builder: (context, state) =>
          const LegalDocumentPage(type: LegalDocumentType.releaseChecklist),
    ),
    GoRoute(
      path: '/articles/:id',
      builder: (context, state) => ArticleDetailPage(
        articleId: state.pathParameters['id']!,
      ),
    ),
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return ShellScaffold(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomePage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/wellness',
              builder: (context, state) => const WellnessPage(),
              routes: [
                GoRoute(
                  path: 'mood',
                  builder: (context, state) => const MoodTrackerPage(),
                ),
                GoRoute(
                  path: 'water',
                  builder: (context, state) => const WaterIntakePage(),
                ),
                GoRoute(
                  path: 'sleep',
                  builder: (context, state) => const SleepLogPage(),
                ),
                GoRoute(
                  path: 'exercise',
                  builder: (context, state) => const ExerciseLogPage(),
                ),
                GoRoute(
                  path: 'goals',
                  builder: (context, state) => const HealthGoalsPage(),
                ),
                GoRoute(
                  path: 'assessments',
                  builder: (context, state) => const AssessmentsPage(),
                  routes: [
                    GoRoute(
                      path: 'phq9',
                      builder: (context, state) => QuestionnairePage(
                        questionnaire: phq9Questionnaire,
                        onComplete: (score, answers) {
                          final datasource = AssessmentLocalDatasource(
                            sl<WellnessDatabase>(),
                          );
                          datasource.saveResult(
                            type: 'PHQ9',
                            score: score,
                            answers: answers,
                          );
                          Navigator.of(context).pushReplacement(
                            MaterialPageRoute(
                              builder: (_) => AssessmentResultPage(
                                assessmentName: 'PHQ-9',
                                score: score,
                                maxScore: 27,
                                severity: phq9Questionnaire.scoringFn(score),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    GoRoute(
                      path: 'gad7',
                      builder: (context, state) => QuestionnairePage(
                        questionnaire: gad7Questionnaire,
                        onComplete: (score, answers) {
                          final datasource = AssessmentLocalDatasource(
                            sl<WellnessDatabase>(),
                          );
                          datasource.saveResult(
                            type: 'GAD7',
                            score: score,
                            answers: answers,
                          );
                          Navigator.of(context).pushReplacement(
                            MaterialPageRoute(
                              builder: (_) => AssessmentResultPage(
                                assessmentName: 'GAD-7',
                                score: score,
                                maxScore: 21,
                                severity: gad7Questionnaire.scoringFn(score),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    GoRoute(
                      path: 'bmi',
                      builder: (context, state) => const BmiCalculatorPage(),
                    ),
                    GoRoute(
                      path: 'heart',
                      builder: (context, state) => const HeartRiskPage(),
                    ),
                  ],
                ),
                GoRoute(
                  path: 'mental',
                  builder: (context, state) => const MentalWellnessPage(),
                  routes: [
                    GoRoute(
                      path: 'breathing',
                      builder: (context, state) => const BreathingPage(),
                    ),
                    GoRoute(
                      path: 'meditation',
                      builder: (context, state) => const MeditationPage(),
                    ),
                    GoRoute(
                      path: 'journal',
                      builder: (context, state) => const JournalPage(),
                    ),
                  ],
                ),
                GoRoute(
                  path: 'womens',
                  builder: (context, state) => const PeriodTrackerPage(),
                ),
                GoRoute(
                  path: 'medication',
                  builder: (context, state) => const MedicationPage(),
                ),
                GoRoute(
                  path: 'vitals',
                  builder: (context, state) => const VitalsPage(),
                ),
                GoRoute(
                  path: 'symptoms',
                  builder: (context, state) => const SymptomCheckerPage(),
                ),
              ],
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/hospital',
              builder: (context, state) => const HospitalPage(),
              routes: [
                GoRoute(
                  path: 'detail/:id',
                  builder: (context, state) => HospitalDetailPage(
                    hospitalId: state.pathParameters['id']!,
                  ),
                ),
              ],
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/articles',
              builder: (context, state) => const ArticlesPage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const ProfilePage(),
            ),
          ],
        ),
      ],
    ),
  ],
);

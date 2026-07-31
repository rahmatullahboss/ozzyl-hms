# Plan 3A: Health Assessments & Mental Wellness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build standardized health assessments (PHQ-9, GAD-7, BMI, heart risk) and mental wellness tools (breathing, meditation, journal)

**Architecture:** Assessments use a generic questionnaire engine. Mental wellness features are offline-first. PHQ-9/GAD-7 scoring from danphe reference code.

**Tech Stack:** flutter_bloc, drift, fl_chart

**Depends on:** Plan 1 + Plan 2A completed

---

### Task 1: Assessment engine + PHQ-9

**Files:**
- Create: `apps/ozzyl_health/lib/features/health_assessments/domain/entities/assessment.dart`
- Create: `apps/ozzyl_health/lib/features/health_assessments/domain/entities/questionnaire.dart`
- Create: `apps/ozzyl_health/lib/features/health_assessments/domain/repositories/assessment_repository.dart`
- Create: `apps/ozzyl_health/lib/features/health_assessments/data/datasources/assessment_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/health_assessments/data/repositories/assessment_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/health_assessments/data/questionnaires/phq9.dart`
- Create: `apps/ozzyl_health/lib/features/health_assessments/data/questionnaires/gad7.dart`

- [ ] **Step 1: Write domain entities**

```dart
// apps/ozzyl_health/lib/features/health_assessments/domain/entities/assessment.dart
class AssessmentResult {
  final int? id;
  final String type;
  final int score;
  final DateTime date;
  final String answersJson;
  final String severity;

  const AssessmentResult({
    this.id, required this.type, required this.score,
    required this.date, required this.answersJson, required this.severity,
  });
}
```

```dart
// apps/ozzyl_health/lib/features/health_assessments/domain/entities/questionnaire.dart
class Questionnaire {
  final String id;
  final String title;
  final String description;
  final List<Question> questions;
  final String Function(int score) scoringFn;

  const Questionnaire({
    required this.id, required this.title, required this.description,
    required this.questions, required this.scoringFn,
  });
}

class Question {
  final String text;
  final List<AnswerOption> options;
  const Question({required this.text, required this.options});
}

class AnswerOption {
  final String text;
  final int value;
  const AnswerOption({required this.text, required this.value});
}
```

- [ ] **Step 2: Write PHQ-9 questionnaire definition**

```dart
// apps/ozzyl_health/lib/features/health_assessments/data/questionnaires/phq9.dart
import '../../domain/entities/questionnaire.dart';

const _phq9Options = [
  AnswerOption(text: 'Not at all', value: 0),
  AnswerOption(text: 'Several days', value: 1),
  AnswerOption(text: 'More than half the days', value: 2),
  AnswerOption(text: 'Nearly every day', value: 3),
];

final phq9Questionnaire = Questionnaire(
  id: 'PHQ9',
  title: 'PHQ-9 Depression Screen',
  description: 'Over the last 2 weeks, how often have you been bothered by the following?',
  questions: const [
    Question(text: 'Little interest or pleasure in doing things', options: _phq9Options),
    Question(text: 'Feeling down, depressed, or hopeless', options: _phq9Options),
    Question(text: 'Trouble falling or staying asleep, or sleeping too much', options: _phq9Options),
    Question(text: 'Feeling tired or having little energy', options: _phq9Options),
    Question(text: 'Poor appetite or overeating', options: _phq9Options),
    Question(text: 'Feeling bad about yourself — or that you are a failure', options: _phq9Options),
    Question(text: 'Trouble concentrating on things', options: _phq9Options),
    Question(text: 'Moving or speaking so slowly that others noticed, or being fidgety', options: _phq9Options),
    Question(text: 'Thoughts that you would be better off dead, or of hurting yourself', options: _phq9Options),
  ],
  scoringFn: _scorePHQ9,
);

String _scorePHQ9(int score) {
  if (score <= 4) return 'Minimal';
  if (score <= 9) return 'Mild';
  if (score <= 14) return 'Moderate';
  if (score <= 19) return 'Moderately Severe';
  return 'Severe';
}
```

- [ ] **Step 3: Write GAD-7 questionnaire definition**

```dart
// apps/ozzyl_health/lib/features/health_assessments/data/questionnaires/gad7.dart
import '../../domain/entities/questionnaire.dart';

const _gad7Options = [
  AnswerOption(text: 'Not at all', value: 0),
  AnswerOption(text: 'Several days', value: 1),
  AnswerOption(text: 'More than half the days', value: 2),
  AnswerOption(text: 'Nearly every day', value: 3),
];

final gad7Questionnaire = Questionnaire(
  id: 'GAD7',
  title: 'GAD-7 Anxiety Screen',
  description: 'Over the last 2 weeks, how often have you been bothered by the following?',
  questions: const [
    Question(text: 'Feeling nervous, anxious, or on edge', options: _gad7Options),
    Question(text: 'Not being able to stop or control worrying', options: _gad7Options),
    Question(text: 'Worrying too much about different things', options: _gad7Options),
    Question(text: 'Trouble relaxing', options: _gad7Options),
    Question(text: 'Being so restless that it is hard to sit still', options: _gad7Options),
    Question(text: 'Becoming easily annoyed or irritable', options: _gad7Options),
    Question(text: 'Feeling afraid, as if something awful might happen', options: _gad7Options),
  ],
  scoringFn: _scoreGAD7,
);

String _scoreGAD7(int score) {
  if (score <= 4) return 'Minimal';
  if (score <= 9) return 'Mild';
  if (score <= 14) return 'Moderate';
  return 'Severe';
}
```

- [ ] **Step 4: Write data layer**

```dart
// apps/ozzyl_health/lib/features/health_assessments/data/datasources/assessment_local_datasource.dart
import 'dart:convert';
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/assessment.dart';

class AssessmentLocalDatasource {
  final WellnessDatabase _db;
  AssessmentLocalDatasource(this._db);

  Future<List<AssessmentResult>> getResults({String? type, int limit = 10}) async {
    var query = _db.select(_db.assessmentResults)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(limit);
    if (type != null) query = query..where((t) => t.type.equals(type));
    final rows = await query.get();
    return rows.map((r) => AssessmentResult(
      id: r.id, type: r.type, score: r.score, date: r.date,
      answersJson: r.answersJson, severity: _getSeverity(r.type, r.score),
    )).toList();
  }

  Future<void> saveResult({
    required String type, required int score, required List<int> answers,
  }) async {
    await _db.into(_db.assessmentResults).insert(
      AssessmentResultsCompanion.insert(
        type: type, score: score, answersJson: jsonEncode(answers),
      ),
    );
  }

  String _getSeverity(String type, int score) {
    if (type == 'PHQ9') {
      if (score <= 4) return 'Minimal';
      if (score <= 9) return 'Mild';
      if (score <= 14) return 'Moderate';
      if (score <= 19) return 'Moderately Severe';
      return 'Severe';
    }
    if (type == 'GAD7') {
      if (score <= 4) return 'Minimal';
      if (score <= 9) return 'Mild';
      if (score <= 14) return 'Moderate';
      return 'Severe';
    }
    return 'N/A';
  }
}
```

```dart
// apps/ozzyl_health/lib/features/health_assessments/data/repositories/assessment_repository_impl.dart
import '../../domain/entities/assessment.dart';
import '../../domain/repositories/assessment_repository.dart';
import '../datasources/assessment_local_datasource.dart';

class AssessmentRepositoryImpl implements AssessmentRepository {
  final AssessmentLocalDatasource _local;
  AssessmentRepositoryImpl(this._local);

  @override
  Future<List<AssessmentResult>> getResults({String? type, int limit = 10}) =>
      _local.getResults(type: type, limit: limit);
  @override
  Future<void> saveResult({required String type, required int score, required List<int> answers}) =>
      _local.saveResult(type: type, score: score, answers: answers);
}
```

```dart
// apps/ozzyl_health/lib/features/health_assessments/domain/repositories/assessment_repository.dart
import '../entities/assessment.dart';

abstract class AssessmentRepository {
  Future<List<AssessmentResult>> getResults({String? type, int limit = 10});
  Future<void> saveResult({required String type, required int score, required List<int> answers});
}
```

- [ ] **Step 5: Write generic QuestionnaireScreen**

```dart
// Create: apps/ozzyl_health/lib/features/health_assessments/presentation/pages/questionnaire_page.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/questionnaire.dart';

class QuestionnairePage extends StatefulWidget {
  final Questionnaire questionnaire;
  final void Function(int score, List<int> answers) onComplete;

  const QuestionnairePage({super.key, required this.questionnaire, required this.onComplete});

  @override
  State<QuestionnairePage> createState() => _QuestionnairePageState();
}

class _QuestionnairePageState extends State<QuestionnairePage> {
  late List<int?> _answers;
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    _answers = List.filled(widget.questionnaire.questions.length, null);
  }

  @override
  Widget build(BuildContext context) {
    final q = widget.questionnaire;
    final question = q.questions[_currentIndex];
    final isLast = _currentIndex == q.questions.length - 1;
    final allAnswered = !_answers.contains(null);

    return Scaffold(
      appBar: AppBar(
        title: Text(q.title),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(
            value: (_currentIndex + 1) / q.questions.length,
            backgroundColor: AppColors.primary.withOpacity(0.15),
          ),
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Question ${_currentIndex + 1} of ${q.questions.length}',
                style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 16),
            Text(question.text, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 24),
            ...question.options.map((opt) {
              final selected = _answers[_currentIndex] == opt.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OutlinedButton(
                  onPressed: () => setState(() => _answers[_currentIndex] = opt.value),
                  style: OutlinedButton.styleFrom(
                    backgroundColor: selected ? AppColors.primary.withOpacity(0.1) : null,
                    side: BorderSide(color: selected ? AppColors.primary : AppColors.divider, width: selected ? 2 : 1),
                    padding: const EdgeInsets.all(16),
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(opt.text, style: TextStyle(
                      color: selected ? AppColors.primary : AppColors.textPrimary,
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    )),
                  ),
                ),
              );
            }),
            const Spacer(),
            Row(
              children: [
                if (_currentIndex > 0)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => setState(() => _currentIndex--),
                      child: const Text('Back'),
                    ),
                  ),
                if (_currentIndex > 0) const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _answers[_currentIndex] != null
                        ? () {
                            if (isLast && allAnswered) {
                              final score = _answers.whereType<int>().fold<int>(0, (a, b) => a + b);
                              widget.onComplete(score, _answers.cast<int>());
                            } else if (!isLast) {
                              setState(() => _currentIndex++);
                            }
                          }
                        : null,
                    child: Text(isLast ? 'Submit' : 'Next'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 6: Write AssessmentsListPage**

```dart
// Create: apps/ozzyl_health/lib/features/health_assessments/presentation/pages/assessments_page.dart
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
  final String title, description;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  const _AssessmentCard({required this.title, required this.description, required this.icon, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(backgroundColor: color.withOpacity(0.1), child: Icon(icon, color: color)),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(description),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
```

- [ ] **Step 7: Wire assessment routes + commit**

Add to router wellness sub-routes:
```dart
GoRoute(path: 'assessments', builder: (context, state) => const AssessmentsPage(),
  routes: [
    GoRoute(path: 'phq9', builder: (context, state) => /* PHQ-9 QuestionnairePage */),
    GoRoute(path: 'gad7', builder: (context, state) => /* GAD-7 QuestionnairePage */),
    GoRoute(path: 'bmi', builder: (context, state) => /* BMI calculator page */),
    GoRoute(path: 'heart', builder: (context, state) => /* Heart risk page */),
  ],
),
```

```bash
git add apps/ozzyl_health/lib/features/health_assessments/
git commit -m "feat(assessments): add PHQ-9, GAD-7, questionnaire engine, assessment list"
```

---

### Task 2: Mental Wellness (breathing, meditation, journal)

**Files:**
- Create: `apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/mental_wellness_page.dart`
- Create: `apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/breathing_page.dart`
- Create: `apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/meditation_page.dart`
- Create: `apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/journal_page.dart`
- Create: `apps/ozzyl_health/lib/features/mental_wellness/data/datasources/journal_local_datasource.dart`

- [ ] **Step 1: Write BreathingPage**

```dart
// apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/breathing_page.dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class BreathingPage extends StatefulWidget {
  const BreathingPage({super.key});
  @override
  State<BreathingPage> createState() => _BreathingPageState();
}

class _BreathingPageState extends State<BreathingPage> with SingleTickerProviderStateMixin {
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
      duration: Duration(seconds: _breatheIn + _hold + _breatheOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggleBreathing() {
    if (_isRunning) {
      _controller.stop();
      setState(() { _isRunning = false; _phase = 'Paused'; });
    } else {
      _runCycle();
    }
  }

  Future<void> _runCycle() async {
    setState(() => _isRunning = true);
    while (_isRunning) {
      setState(() => _phase = 'Breathe In');
      _controller.forward(from: 0);
      await Future.delayed(Duration(seconds: _breatheIn));
      if (!_isRunning) break;

      setState(() => _phase = 'Hold');
      await Future.delayed(Duration(seconds: _hold));
      if (!_isRunning) break;

      setState(() => _phase = 'Breathe Out');
      await Future.delayed(Duration(seconds: _breatheOut));
      if (!_isRunning) break;

      setState(() => _cycles++);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Breathing Exercise')),
      body: GestureDetector(
        onTap: _toggleBreathing,
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
                      width: 160, height: 160,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.primary.withOpacity(0.3),
                        border: Border.all(color: AppColors.primary, width: 3),
                      ),
                    ),
                  );
                },
              ),
              const SizedBox(height: 32),
              Text(_phase, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Text('Cycles: $_cycles', style: Theme.of(context).textTheme.bodyLarge),
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
```

- [ ] **Step 2: Write MeditationPage (simple timer)**

```dart
// apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/meditation_page.dart
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
    setState(() { _remainingSeconds = _selectedMinutes * 60; _isRunning = true; });
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_remainingSeconds <= 0) {
        t.cancel();
        setState(() => _isRunning = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Meditation complete!'), backgroundColor: AppColors.success),
        );
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
  void dispose() { _timer?.cancel(); super.dispose(); }

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
              Text('Select Duration', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                children: _durations.map((d) => ChoiceChip(
                  label: Text('$d min'),
                  selected: _selectedMinutes == d,
                  onSelected: (_) => setState(() => _selectedMinutes = d),
                )).toList(),
              ),
              const SizedBox(height: 32),
              ElevatedButton(onPressed: _start, child: const Text('Start')),
            ] else ...[
              Text('${mins.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}',
                style: Theme.of(context).textTheme.displayLarge?.copyWith(fontWeight: FontWeight.w300)),
              const SizedBox(height: 16),
              Text('Focus on your breath', style: Theme.of(context).textTheme.bodyLarge),
              const SizedBox(height: 32),
              OutlinedButton(onPressed: _stop, child: const Text('Stop')),
            ],
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Write JournalPage**

```dart
// apps/ozzyl_health/lib/features/mental_wellness/data/datasources/journal_local_datasource.dart
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';

class JournalLocalDatasource {
  final WellnessDatabase _db;
  JournalLocalDatasource(this._db);

  Future<List<JournalEntrie>> getEntries({int limit = 20}) async {
    final query = _db.select(_db.journalEntries)
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)])
      ..limit(limit);
    return query.get();
  }

  Future<void> addEntry(String content, String? moodTag) async {
    await _db.into(_db.journalEntries).insert(
      JournalEntriesCompanion.insert(content: content, moodTag: Value(moodTag)),
    );
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.journalEntries)..where((t) => t.id.equals(id))).go();
  }
}
```

```dart
// apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/journal_page.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../data/datasources/journal_local_datasource.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/database/wellness_database.dart';

class JournalPage extends StatefulWidget {
  const JournalPage({super.key});
  @override
  State<JournalPage> createState() => _JournalPageState();
}

class _JournalPageState extends State<JournalPage> {
  final _controller = TextEditingController();
  late final JournalLocalDatasource _datasource;
  List<JournalEntrie> _entries = [];

  @override
  void initState() {
    super.initState();
    _datasource = JournalLocalDatasource(sl<WellnessDatabase>());
    _loadEntries();
  }

  Future<void> _loadEntries() async {
    final entries = await _datasource.getEntries();
    setState(() => _entries = entries);
  }

  @override
  void dispose() { _controller.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Stress Journal')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: const InputDecoration(hintText: 'What\'s on your mind?'),
                    maxLines: 3,
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.send, color: AppColors.primary),
                  onPressed: () async {
                    if (_controller.text.trim().isNotEmpty) {
                      await _datasource.addEntry(_controller.text.trim(), null);
                      _controller.clear();
                      _loadEntries();
                    }
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: _entries.isEmpty
                ? const Center(child: Text('Start journaling to track your thoughts'))
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _entries.length,
                    itemBuilder: (context, i) {
                      final entry = _entries[i];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          title: Text(entry.content),
                          subtitle: Text('${entry.timestamp.month}/${entry.timestamp.day} at ${entry.timestamp.hour}:${entry.timestamp.minute.toString().padLeft(2, '0')}'),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline, size: 20),
                            onPressed: () async {
                              await _datasource.deleteEntry(entry.id);
                              _loadEntries();
                            },
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Write MentalWellnessPage (hub)**

```dart
// apps/ozzyl_health/lib/features/mental_wellness/presentation/pages/mental_wellness_page.dart
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
            title: 'Breathing Exercise', description: '4-4-4 box breathing',
            icon: Icons.air, color: AppColors.info,
            onTap: () => context.push('/wellness/mental/breathing'),
          ),
          _FeatureCard(
            title: 'Meditation Timer', description: 'Guided silence timer',
            icon: Icons.self_improvement, color: AppColors.primary,
            onTap: () => context.push('/wellness/mental/meditation'),
          ),
          _FeatureCard(
            title: 'Stress Journal', description: 'Write down your thoughts',
            icon: Icons.edit_note, color: AppColors.accent,
            onTap: () => context.push('/wellness/mental/journal'),
          ),
        ],
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final String title, description;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  const _FeatureCard({required this.title, required this.description, required this.icon, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(backgroundColor: color.withOpacity(0.1), child: Icon(icon, color: color)),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(description),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
```

- [ ] **Step 5: Wire routes + commit**

Add to router wellness sub-routes:
```dart
GoRoute(path: 'mental', builder: (context, state) => const MentalWellnessPage(),
  routes: [
    GoRoute(path: 'breathing', builder: (context, state) => const BreathingPage()),
    GoRoute(path: 'meditation', builder: (context, state) => const MeditationPage()),
    GoRoute(path: 'journal', builder: (context, state) => const JournalPage()),
  ],
),
```

```bash
git add apps/ozzyl_health/lib/features/mental_wellness/
git commit -m "feat(mental): add breathing exercise, meditation timer, stress journal"
```

import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/questionnaire.dart';

class QuestionnairePage extends StatefulWidget {
  final Questionnaire questionnaire;
  final void Function(int score, List<int> answers) onComplete;

  const QuestionnairePage({
    super.key,
    required this.questionnaire,
    required this.onComplete,
  });

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
            backgroundColor: AppColors.primary.withValues(alpha: 0.15),
          ),
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Question ${_currentIndex + 1} of ${q.questions.length}',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            Text(
              question.text,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 24),
            ...question.options.map((opt) {
              final selected = _answers[_currentIndex] == opt.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OutlinedButton(
                  onPressed: () =>
                      setState(() => _answers[_currentIndex] = opt.value),
                  style: OutlinedButton.styleFrom(
                    backgroundColor: selected
                        ? AppColors.primary.withValues(alpha: 0.1)
                        : null,
                    side: BorderSide(
                      color: selected ? AppColors.primary : AppColors.divider,
                      width: selected ? 2 : 1,
                    ),
                    padding: const EdgeInsets.all(16),
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      opt.text,
                      style: TextStyle(
                        color: selected
                            ? AppColors.primary
                            : AppColors.textPrimary,
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
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
                              final score = _answers
                                  .whereType<int>()
                                  .fold<int>(0, (a, b) => a + b);
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

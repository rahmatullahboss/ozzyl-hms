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
  description:
      'Over the last 2 weeks, how often have you been bothered by the following?',
  questions: const [
    Question(
      text: 'Little interest or pleasure in doing things',
      options: _phq9Options,
    ),
    Question(
      text: 'Feeling down, depressed, or hopeless',
      options: _phq9Options,
    ),
    Question(
      text: 'Trouble falling or staying asleep, or sleeping too much',
      options: _phq9Options,
    ),
    Question(
      text: 'Feeling tired or having little energy',
      options: _phq9Options,
    ),
    Question(text: 'Poor appetite or overeating', options: _phq9Options),
    Question(
      text: 'Feeling bad about yourself — or that you are a failure',
      options: _phq9Options,
    ),
    Question(
      text: 'Trouble concentrating on things',
      options: _phq9Options,
    ),
    Question(
      text:
          'Moving or speaking so slowly that others noticed, or being fidgety',
      options: _phq9Options,
    ),
    Question(
      text: 'Thoughts that you would be better off dead, or of hurting yourself',
      options: _phq9Options,
    ),
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

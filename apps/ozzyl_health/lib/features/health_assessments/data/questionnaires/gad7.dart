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
  description:
      'Over the last 2 weeks, how often have you been bothered by the following?',
  questions: const [
    Question(
      text: 'Feeling nervous, anxious, or on edge',
      options: _gad7Options,
    ),
    Question(
      text: 'Not being able to stop or control worrying',
      options: _gad7Options,
    ),
    Question(
      text: 'Worrying too much about different things',
      options: _gad7Options,
    ),
    Question(text: 'Trouble relaxing', options: _gad7Options),
    Question(
      text: 'Being so restless that it is hard to sit still',
      options: _gad7Options,
    ),
    Question(
      text: 'Becoming easily annoyed or irritable',
      options: _gad7Options,
    ),
    Question(
      text: 'Feeling afraid, as if something awful might happen',
      options: _gad7Options,
    ),
  ],
  scoringFn: _scoreGAD7,
);

String _scoreGAD7(int score) {
  if (score <= 4) return 'Minimal';
  if (score <= 9) return 'Mild';
  if (score <= 14) return 'Moderate';
  return 'Severe';
}

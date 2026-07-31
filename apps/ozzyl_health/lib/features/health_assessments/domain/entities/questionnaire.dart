class Questionnaire {
  final String id;
  final String title;
  final String description;
  final List<Question> questions;
  final String Function(int score) scoringFn;

  const Questionnaire({
    required this.id,
    required this.title,
    required this.description,
    required this.questions,
    required this.scoringFn,
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

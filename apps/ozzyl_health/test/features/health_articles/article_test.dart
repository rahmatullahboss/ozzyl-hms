import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/features/health_articles/domain/entities/article.dart';

void main() {
  group('Article', () {
    test('creates article with required fields', () {
      final article = Article(
        id: '1',
        title: 'Healthy Eating Tips',
        summary: 'Eat more vegetables',
        content: 'Full article content here',
        category: 'Nutrition',
        publishedAt: DateTime(2024, 4, 15),
      );

      expect(article.id, '1');
      expect(article.title, 'Healthy Eating Tips');
      expect(article.summary, 'Eat more vegetables');
      expect(article.content, 'Full article content here');
      expect(article.category, 'Nutrition');
      expect(article.publishedAt, DateTime(2024, 4, 15));
      expect(article.imageUrl, isNull);
      expect(article.readTimeMin, isNull);
    });

    test('creates article with optional fields', () {
      final article = Article(
        id: '2',
        title: 'Exercise Guide',
        summary: 'Daily exercise benefits',
        content: 'Full content',
        category: 'Fitness',
        imageUrl: 'https://example.com/image.jpg',
        publishedAt: DateTime(2024, 4, 15),
        readTimeMin: 5,
      );

      expect(article.imageUrl, 'https://example.com/image.jpg');
      expect(article.readTimeMin, 5);
    });

    test('JSON serialization roundtrip', () {
      final original = Article(
        id: '3',
        title: 'Sleep Hygiene',
        summary: 'Better sleep tips',
        content: 'Sleep content',
        category: 'Mental Health',
        publishedAt: DateTime(2024, 4, 15, 10, 30),
        readTimeMin: 8,
      );

      final json = original.toJson();
      final restored = Article.fromJson(json);

      expect(restored.id, original.id);
      expect(restored.title, original.title);
      expect(restored.category, original.category);
    });
  });
}

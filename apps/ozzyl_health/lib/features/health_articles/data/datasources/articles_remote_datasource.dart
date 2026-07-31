import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/article.dart';

class ArticlesRemoteDatasource {
  final ApiClient _apiClient;
  ArticlesRemoteDatasource(this._apiClient);

  Future<List<Article>> getArticles({
    String? category,
    int limit = 20,
  }) async {
    try {
      final response = await _apiClient.dio.get(
        ApiConstants.healthArticles,
        queryParameters: {
          if (category != null) 'category': category,
          'limit': limit,
        },
      );
      final data = response.data;
      final list = data is List ? data : data['articles'] as List;
      return list
          .map((j) => Article.fromJson(j as Map<String, dynamic>))
          .toList();
    } catch (_) {
      final articles = _fallbackArticles();
      if (category == null) return articles;
      return articles
          .where((a) => a.category.toLowerCase() == category.toLowerCase())
          .toList();
    }
  }

  Future<Article> getArticleById(String id) async {
    try {
      final response = await _apiClient.dio.get(
        '${ApiConstants.healthArticles}/$id',
      );
      final data = response.data;
      return Article.fromJson(
        (data is Map<String, dynamic> && data['article'] != null
                ? data['article']
                : data) as Map<String, dynamic>,
      );
    } catch (_) {
      return _fallbackArticles().firstWhere(
        (article) => article.id == id,
        orElse: () => _fallbackArticles().first,
      );
    }
  }

  List<Article> _fallbackArticles() {
    final now = DateTime.now();
    return [
      Article(
        id: 'hydration-basics',
        title: 'Small hydration habits that actually stick',
        summary: 'Simple ways to keep water intake consistent through the day.',
        content:
            'Start with one glass after waking, one before each meal, and one after exercise. Consistency matters more than forcing a large amount at once.',
        category: 'Nutrition',
        publishedAt: now.subtract(const Duration(days: 1)),
        readTimeMin: 3,
      ),
      Article(
        id: 'walking-health',
        title: 'Why a 10-minute walk counts',
        summary: 'Short movement breaks can improve energy, mood, and circulation.',
        content:
            'A brief walk after meals can help glucose control and reduce stiffness. Begin with a pace that feels easy, then increase gradually.',
        category: 'Fitness',
        publishedAt: now.subtract(const Duration(days: 2)),
        readTimeMin: 4,
      ),
      Article(
        id: 'breathing-reset',
        title: 'A quick breathing reset for stressful moments',
        summary: 'Use slow, counted breathing to calm your nervous system.',
        content:
            'Try inhaling for four counts, holding for four, exhaling for four, and resting for four. Repeat for two minutes.',
        category: 'Mental Health',
        publishedAt: now.subtract(const Duration(days: 3)),
        readTimeMin: 2,
      ),
      Article(
        id: 'cycle-awareness',
        title: 'Tracking symptoms across your cycle',
        summary: 'Patterns become clearer when mood, sleep, pain, and flow are logged together.',
        content:
            'A few notes each day can help you notice recurring patterns and prepare better questions for your clinician.',
        category: 'Women\'s Health',
        publishedAt: now.subtract(const Duration(days: 4)),
        readTimeMin: 3,
      ),
    ];
  }
}

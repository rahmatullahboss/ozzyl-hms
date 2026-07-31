import '../../domain/entities/article.dart';

abstract class ArticlesState {}

class ArticlesInitial extends ArticlesState {}

class ArticlesLoading extends ArticlesState {}

class ArticlesLoaded extends ArticlesState {
  final List<Article> articles;
  final List<Article> filteredArticles;
  final String? selectedCategory;

  ArticlesLoaded({
    required this.articles,
    List<Article>? filteredArticles,
    this.selectedCategory,
  }) : filteredArticles = filteredArticles ?? articles;
}

class ArticlesError extends ArticlesState {
  final String message;
  ArticlesError(this.message);
}

abstract class ArticlesEvent {}

class LoadArticles extends ArticlesEvent {}

class FilterByCategory extends ArticlesEvent {
  final String? category;
  FilterByCategory(this.category);
}

import 'package:flutter_bloc/flutter_bloc.dart';
import '../../data/datasources/articles_remote_datasource.dart';
import 'articles_event.dart';
import 'articles_state.dart';

class ArticlesBloc extends Bloc<ArticlesEvent, ArticlesState> {
  final ArticlesRemoteDatasource _datasource;

  ArticlesBloc(this._datasource) : super(ArticlesInitial()) {
    on<LoadArticles>(_onLoad);
    on<FilterByCategory>(_onFilter);
  }

  Future<void> _onLoad(
    LoadArticles event,
    Emitter<ArticlesState> emit,
  ) async {
    emit(ArticlesLoading());
    try {
      final articles = await _datasource.getArticles();
      emit(ArticlesLoaded(articles: articles));
    } catch (e) {
      emit(ArticlesError(e.toString()));
    }
  }

  void _onFilter(
    FilterByCategory event,
    Emitter<ArticlesState> emit,
  ) {
    final current = state;
    if (current is ArticlesLoaded) {
      if (event.category == null) {
        emit(ArticlesLoaded(
          articles: current.articles,
          selectedCategory: null,
        ));
      } else {
        final filtered = current.articles
            .where((a) =>
                a.category.toLowerCase() == event.category!.toLowerCase())
            .toList();
        emit(ArticlesLoaded(
          articles: current.articles,
          filteredArticles: filtered,
          selectedCategory: event.category,
        ));
      }
    }
  }
}

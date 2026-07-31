class Article {
  final String id;
  final String title;
  final String summary;
  final String content;
  final String category;
  final String? imageUrl;
  final DateTime publishedAt;
  final int? readTimeMin;

  const Article({
    required this.id,
    required this.title,
    required this.summary,
    required this.content,
    required this.category,
    this.imageUrl,
    required this.publishedAt,
    this.readTimeMin,
  });

  factory Article.fromJson(Map<String, dynamic> json) {
    return Article(
      id: json['id'] as String,
      title: json['title'] as String,
      summary: json['summary'] as String,
      content: json['content'] as String,
      category: json['category'] as String,
      imageUrl: json['imageUrl'] as String?,
      publishedAt: DateTime.parse(json['publishedAt'] as String),
      readTimeMin: json['readTimeMin'] as int?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'summary': summary,
      'content': content,
      'category': category,
      'imageUrl': imageUrl,
      'publishedAt': publishedAt.toIso8601String(),
      'readTimeMin': readTimeMin,
    };
  }
}

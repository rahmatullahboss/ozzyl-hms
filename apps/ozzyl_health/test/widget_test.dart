import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/main.dart';

void main() {
  group('Ozzyl Health App', () {
    testWidgets('app renders without crashing', (WidgetTester tester) async {
      // Build our app and trigger a frame
      await tester.pumpWidget(const OzzylHealthApp());
      await tester.pumpAndSettle();

      // The app should show onboarding or login page
      // Since we can't easily test the full auth flow here,
      // we just verify the app widget tree builds successfully
      expect(find.byType(MaterialApp), findsOneWidget);
    });

    testWidgets('MaterialApp has correct configuration', (WidgetTester tester) async {
      await tester.pumpWidget(const OzzylHealthApp());
      await tester.pumpAndSettle();

      final materialApp = find.byType(MaterialApp);
      expect(materialApp, findsOneWidget);

      final app = tester.widget<MaterialApp>(materialApp);
      expect(app.title, 'Ozzyl Health');
      expect(app.debugShowCheckedModeBanner, isFalse);
    });
  });
}

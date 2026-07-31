import 'package:flutter/material.dart';

abstract final class AppColors {
  // Primary — Teal
  static const Color primary = Color(0xFF00897B);
  static const Color primaryLight = Color(0xFF4DB6AC);
  static const Color primaryDark = Color(0xFF00695C);

  // Accent — Coral
  static const Color accent = Color(0xFFFF6F61);
  static const Color accentLight = Color(0xFFFF8A80);
  static const Color accentDark = Color(0xFFE64A45);

  // Wellness ring colors
  static const Color stepsRing = Color(0xFF26C6DA);
  static const Color waterRing = Color(0xFF42A5F5);
  static const Color moodRing = Color(0xFFFFCA28);

  // Mood levels
  static const Color moodGreat = Color(0xFF66BB6A);
  static const Color moodGood = Color(0xFF9CCC65);
  static const Color moodOkay = Color(0xFFFFCA28);
  static const Color moodLow = Color(0xFFFFA726);
  static const Color moodBad = Color(0xFFEF5350);

  // Neutral
  static const Color background = Color(0xFFFAFAFA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFF212121);
  static const Color textSecondary = Color(0xFF757575);
  static const Color divider = Color(0xFFE0E0E0);

  // Dark mode
  static const Color darkBackground = Color(0xFF121212);
  static const Color darkSurface = Color(0xFF1E1E1E);
  static const Color darkTextPrimary = Color(0xFFE0E0E0);
  static const Color darkTextSecondary = Color(0xFF9E9E9E);

  // Status
  static const Color success = Color(0xFF4CAF50);
  static const Color warning = Color(0xFFFFC107);
  static const Color error = Color(0xFFE53935);
  static const Color info = Color(0xFF2196F3);

  // Gradients
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [primary, Color(0xFF26A69A)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient accentGradient = LinearGradient(
    colors: [accent, Color(0xFFFF8A65)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient warmGradient = LinearGradient(
    colors: [Color(0xFFFF6F61), Color(0xFFFFCA28)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}

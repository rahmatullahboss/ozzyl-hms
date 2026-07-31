/**
 * Daily Insights Engine
 *
 * Generates 1-3 personalized health insights from yesterday's data.
 * Insights are stored in daily_health_score.breakdown_json and
 * surfaced as smart cards on the home screen.
 *
 * Insight types:
 * - sleep_low: slept less than 6h
 * - sleep_great: slept 7-9h
 * - activity_none: no exercise logged
 * - activity_streak: 3+ day exercise streak
 * - mood_low: mood = bad/terrible for 2+ days
 * - hydration_low: < 4 glasses water
 * - score_improving: score up 5+ pts over 3 days
 * - score_declining: score down 5+ pts over 3 days
 * - streak_milestone: streak hit 7, 14, or 30
 */

export interface Insight {
  type: string;
  priority: number; // lower = more important
  title_bn: string;
  title_en: string;
  body_bn: string;
  body_en: string;
  icon: string;
}

interface DayData {
  sleep_hours?: number;
  exercise_minutes?: number;
  mood?: string;
  water_glasses?: number;
  total_score?: number;
}

export function generateInsights(
  today: DayData,
  recentDays: DayData[],
  streaks: Array<{ streak_type: string; current_count: number }>,
): Insight[] {
  const insights: Insight[] = [];

  // Sleep insights
  if (today.sleep_hours != null) {
    if (today.sleep_hours < 6) {
      insights.push({
        type: 'sleep_low',
        priority: 2,
        title_bn: 'ঘুম কম হয়েছে',
        title_en: 'Low Sleep',
        body_bn: `গত রাতে ${today.sleep_hours} ঘণ্টা ঘুমিয়েছেন। ৭-৮ ঘণ্টা ঘুমানোর চেষ্টা করুন।`,
        body_en: `You slept ${today.sleep_hours}h last night. Try to get 7-8 hours.`,
        icon: 'moon',
      });
    } else if (today.sleep_hours >= 7 && today.sleep_hours <= 9) {
      insights.push({
        type: 'sleep_great',
        priority: 8,
        title_bn: 'চমৎকার ঘুম!',
        title_en: 'Great Sleep!',
        body_bn: `${today.sleep_hours} ঘণ্টা ঘুমিয়েছেন — আদর্শ পরিমাণ!`,
        body_en: `${today.sleep_hours}h of sleep — ideal amount!`,
        icon: 'star',
      });
    }
  }

  // Activity insights
  if (today.exercise_minutes != null && today.exercise_minutes === 0) {
    insights.push({
      type: 'activity_none',
      priority: 3,
      title_bn: 'আজ ব্যায়াম হয়নি',
      title_en: 'No Exercise Today',
      body_bn: 'অল্প ১৫ মিনিট হাঁটলেও স্বাস্থ্যের জন্য ভালো।',
      body_en: 'Even a 15-minute walk helps your health.',
      icon: 'activity',
    });
  }

  // Activity streak
  const activityStreak = streaks.find((s) => s.streak_type === 'activity');
  if (activityStreak && activityStreak.current_count >= 3) {
    insights.push({
      type: 'activity_streak',
      priority: 7,
      title_bn: `${activityStreak.current_count} দিনের ব্যায়াম স্ট্রিক!`,
      title_en: `${activityStreak.current_count}-Day Exercise Streak!`,
      body_bn: 'দারুণ চলছে! এগিয়ে যান।',
      body_en: 'Great momentum! Keep it going.',
      icon: 'flame',
    });
  }

  // Mood insights
  if (recentDays.length >= 2) {
    const recentLowMoods = recentDays.filter((d) => d.mood === 'bad' || d.mood === 'terrible' || d.mood === 'low' || d.mood === 'struggling');
    if (recentLowMoods.length >= 2) {
      insights.push({
        type: 'mood_low',
        priority: 1,
        title_bn: 'মন ভালো নেই?',
        title_en: 'Feeling Down?',
        body_bn: 'গত কয়েকদিন মেজাজ খারাপ ছিল। Ozzy-র সাথে কথা বলুন বা একজন বিশ্বস্ত মানুষের সাথে শেয়ার করুন।',
        body_en: 'Your mood has been low recently. Talk to Ozzy or share with someone you trust.',
        icon: 'heart',
      });
    }
  }

  // Hydration insights
  if (today.water_glasses != null && today.water_glasses < 4) {
    insights.push({
      type: 'hydration_low',
      priority: 4,
      title_bn: 'পানি কম পান করেছেন',
      title_en: 'Low Water Intake',
      body_bn: `আজ ${today.water_glasses} গ্লাস পানি পান করেছেন। লক্ষ্য ৮ গ্লাস।`,
      body_en: `${today.water_glasses} glasses today. Target is 8.`,
      icon: 'droplets',
    });
  }

  // Score trend insights
  if (recentDays.length >= 3) {
    const scores = recentDays.filter((d) => d.total_score != null).map((d) => d.total_score!);
    if (scores.length >= 3) {
      const diff = scores[0] - scores[scores.length - 1];
      if (diff >= 5) {
        insights.push({
          type: 'score_improving',
          priority: 6,
          title_bn: 'স্কোর বাড়ছে!',
          title_en: 'Score Improving!',
          body_bn: `গত ${scores.length} দিনে +${diff} পয়েন্ট বেড়েছে।`,
          body_en: `Up ${diff} points over ${scores.length} days.`,
          icon: 'trending-up',
        });
      } else if (diff <= -5) {
        insights.push({
          type: 'score_declining',
          priority: 2,
          title_bn: 'স্কোর কমছে',
          title_en: 'Score Declining',
          body_bn: `গত ${scores.length} দিনে ${diff} পয়েন্ট কমেছে। একটু মনোযোগ দিন।`,
          body_en: `Down ${Math.abs(diff)} points over ${scores.length} days. Pay attention.`,
          icon: 'trending-down',
        });
      }
    }
  }

  // Streak milestones
  for (const s of streaks) {
    if ([7, 14, 30].includes(s.current_count)) {
      insights.push({
        type: 'streak_milestone',
        priority: 5,
        title_bn: `${s.current_count} দিনের মাইলস্টোন!`,
        title_en: `${s.current_count}-Day Milestone!`,
        body_bn: `আপনার ${s.streak_type} স্ট্রিক ${s.current_count} দিনে পৌঁছেছে!`,
        body_en: `Your ${s.streak_type} streak reached ${s.current_count} days!`,
        icon: 'award',
      });
    }
  }

  // Sort by priority and return top 3
  return insights.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

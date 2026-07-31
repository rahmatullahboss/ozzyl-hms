-- Migration: Add health_articles table for Plan 4B
CREATE TABLE IF NOT EXISTS health_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  image_url TEXT,
  published_at TEXT DEFAULT (datetime('now')),
  read_time_min INTEGER,
  is_published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_articles_category ON health_articles(category);
CREATE INDEX IF NOT EXISTS idx_health_articles_published ON health_articles(is_published, published_at);

-- Seed some sample articles
INSERT INTO health_articles (title, summary, content, category, read_time_min) VALUES
('Understanding Diabetes: A Complete Guide', 'Learn about Type 1 and Type 2 diabetes, symptoms, and management strategies.', 'Diabetes is a chronic health condition that affects how your body turns food into energy. There are two main types...', 'Nutrition', 8),
('The Benefits of Daily Exercise', 'Discover how just 30 minutes of daily physical activity can transform your health.', 'Regular physical activity is one of the most important things you can do for your health. Being physically active can improve your brain health...', 'Fitness', 5),
('Managing Stress and Anxiety', 'Practical techniques for reducing stress and improving mental wellbeing.', 'Stress is a normal part of life, but when it becomes chronic, it can have serious effects on your physical and mental health...', 'Mental Health', 6),
('Women''s Health: Nutrition During Pregnancy', 'Essential nutrition tips for a healthy pregnancy journey.', 'Proper nutrition during pregnancy is crucial for both mother and baby. Key nutrients include folic acid, iron, calcium...', 'Women''s Health', 7),
('Heart Health: Prevention Strategies', 'Learn how to keep your heart healthy with simple lifestyle changes.', 'Heart disease is the leading cause of death worldwide, but many cases are preventable through lifestyle changes...', 'Nutrition', 6),
('Sleep Hygiene: Tips for Better Rest', 'Improve your sleep quality with these evidence-based strategies.', 'Good sleep hygiene involves creating habits and an environment that promote consistent, uninterrupted sleep...', 'Fitness', 4);

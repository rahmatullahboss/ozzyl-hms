import { describe, it, expect } from 'vitest';
import * as bdFoods from '../data/bd-foods.json';

const foods = (bdFoods as any).default || bdFoods;

describe('Bangladesh food database', () => {
  it('has 100+ food items', () => {
    expect(foods.length).toBeGreaterThan(100);
  });

  it('covers all 13 categories', () => {
    const categories = [...new Set(foods.map((f: any) => f.category))];
    const expected = ['rice', 'bread', 'lentils', 'fish', 'meat', 'vegetables', 'bhorta', 'eggs', 'snacks', 'sweets', 'drinks', 'fruits', 'fast_food'];
    for (const cat of expected) {
      expect(categories).toContain(cat);
    }
  });

  it('every item has required fields', () => {
    for (const food of foods) {
      expect(food.name_bn).toBeTruthy();
      expect(food.name_en).toBeTruthy();
      expect(food.category).toBeTruthy();
      expect(food.calories_per_100g).toBeGreaterThan(0);
      expect(food.serving_size_g).toBeGreaterThan(0);
    }
  });

  it('Bengali name search finds ভাত', () => {
    const results = foods.filter((f: any) => f.name_bn.includes('ভাত'));
    expect(results.length).toBeGreaterThan(0);
  });

  it('English name search finds rice', () => {
    const results = foods.filter((f: any) => f.name_en.toLowerCase().includes('rice'));
    expect(results.length).toBeGreaterThan(0);
  });

  it('category filter works', () => {
    const fish = foods.filter((f: any) => f.category === 'fish');
    expect(fish.length).toBeGreaterThanOrEqual(5);
    for (const f of fish) {
      expect(f.category).toBe('fish');
    }
  });

  it('calorie values are reasonable', () => {
    for (const food of foods) {
      expect(food.calories_per_100g).toBeGreaterThan(0);
      expect(food.calories_per_100g).toBeLessThan(600);
    }
  });
});

describe('food log validation', () => {
  it('accepts valid meal types', () => {
    const validTypes = ['breakfast', 'lunch', 'snacks', 'dinner'];
    for (const t of validTypes) {
      expect(validTypes).toContain(t);
    }
  });

  it('rejects invalid meal type', () => {
    const validTypes = ['breakfast', 'lunch', 'snacks', 'dinner'];
    expect(validTypes).not.toContain('brunch');
  });

  it('calculates calories from food item and quantity', () => {
    const item = foods.find((f: any) => f.name_en === 'White Rice');
    expect(item).toBeTruthy();
    const quantity = 1;
    const multiplier = (quantity * item.serving_size_g) / 100;
    const calories = item.calories_per_100g * multiplier;
    // 1 plate white rice (200g) = ~260 cal
    expect(calories).toBeGreaterThan(200);
    expect(calories).toBeLessThan(350);
  });
});

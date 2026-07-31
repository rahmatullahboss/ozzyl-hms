/**
 * Food AI Response Parser
 *
 * Extracts and validates food identification results from AI model responses.
 * Used by POST /api/food/identify to parse vision model output.
 */

const VALID_CATEGORIES = [
  'rice', 'bread', 'lentils', 'fish', 'meat', 'vegetables',
  'bhorta', 'eggs', 'snacks', 'sweets', 'drinks', 'fruits', 'fast_food',
] as const;

type FoodCategory = (typeof VALID_CATEGORIES)[number];

export interface AIFoodItem {
  name_bn: string;
  name_en: string;
  category: FoodCategory;
  estimated_calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_description: string;
}

export interface AIFoodResponse {
  items: AIFoodItem[];
  confidence: number;
}

/**
 * Parse and validate AI model response for food identification.
 *
 * Handles:
 * - Raw JSON strings
 * - JSON wrapped in markdown code blocks (```json ... ```)
 * - Malformed/empty responses (returns safe defaults)
 * - Category validation (unknown categories → 'snacks')
 * - Confidence clamping to [0, 1]
 */
export function parseAIFoodResponse(raw: string | null | undefined): AIFoodResponse {
  const empty: AIFoodResponse = { items: [], confidence: 0 };

  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    return empty;
  }

  try {
    // Extract JSON from potential markdown code blocks
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return empty;

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed || typeof parsed !== 'object') return empty;

    // Extract and validate items
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: AIFoodItem[] = rawItems
      .filter((item: any) =>
        item &&
        typeof item.name_bn === 'string' && item.name_bn.trim() &&
        typeof item.name_en === 'string' && item.name_en.trim() &&
        typeof item.estimated_calories === 'number' && item.estimated_calories > 0
      )
      .map((item: any): AIFoodItem => ({
        name_bn: item.name_bn.trim(),
        name_en: item.name_en.trim(),
        category: VALID_CATEGORIES.includes(item.category) ? item.category : 'snacks',
        estimated_calories: Math.min(Math.max(item.estimated_calories, 1), 2000),
        protein_g: Math.max(Number(item.protein_g) || 0, 0),
        carbs_g: Math.max(Number(item.carbs_g) || 0, 0),
        fat_g: Math.max(Number(item.fat_g) || 0, 0),
        serving_description: typeof item.serving_description === 'string'
          ? item.serving_description.trim()
          : '1 serving',
      }));

    // Clamp confidence between 0 and 1
    const confidence = Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1);

    return { items, confidence };
  } catch {
    return empty;
  }
}

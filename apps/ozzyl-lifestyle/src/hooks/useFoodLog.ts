import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

// Re-using the fetchWithCredentials utility from the project
async function fetchWithCredentials(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
  }
  return res.json();
}

export interface FoodItem {
  id: number;
  name_bn: string;
  name_en: string;
  category: string;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_size_g: number;
  serving_description?: string;
}

export interface FoodCategory {
  key: string;
  name_bn: string;
  name_en: string;
}

export interface CameraFoodItem {
  name_bn: string;
  name_en: string;
  estimated_calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_description: string;
  food_item_id?: number | null;
  db_match?: { id: number; name_bn: string; name_en: string } | null;
}

export function useSearchFood(query: string) {
  return useQuery<{ items: FoodItem[] }>({
    queryKey: ['food-search', query],
    queryFn: () => fetchWithCredentials(`/api/food/search?q=${encodeURIComponent(query)}&limit=15`),
    enabled: !!query,
    staleTime: 1000 * 60 * 5, // Cache for 5 mins
  });
}

export function useFoodCategories() {
  return useQuery<{ categories: FoodCategory[] }>({
    queryKey: ['food-categories'],
    queryFn: () => fetchWithCredentials('/api/food/categories'),
    staleTime: Infinity, // Categories rarely change
  });
}

export function useBarcodeLookup() {
  return useMutation({
    mutationFn: (barcode: string) => fetchWithCredentials(`/api/food/barcode/${encodeURIComponent(barcode)}`),
  });
}

export function useIdentifyFood() {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('photo', file);
      return fetchWithCredentials('/api/food/identify', {
        method: 'POST',
        // Note: fetchWithCredentials spreads options and we WANT the browser to set Content-Type for FormData
        body: formData,
      });
    },
  });
}

export function useLogFood() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      fetchWithCredentials('/api/food/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // Invalidate wellness score or dietary logs if there's a related query
      queryClient.invalidateQueries({ queryKey: ['wellness-score'] });
      toast.success('Food logged successfully');
    },
    onError: () => {
      toast.error('Failed to log food');
    },
  });
}

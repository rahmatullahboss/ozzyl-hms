import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FoodDiary from './FoodDiary';

describe('FoodDiary', () => {
  it('renders title and calories left', () => {
    render(<FoodDiary />);
    expect(screen.getByText('Food Diary')).toBeInTheDocument();
    
    // MOCK_MACROS.calories.daily (2000) - current (1450) = 550
    expect(screen.getByText('550')).toBeInTheDocument();
    expect(screen.getByText('Left')).toBeInTheDocument();
  });

  it('renders macroscopic bars and their values', () => {
    render(<FoodDiary />);
    expect(screen.getByText('Protein')).toBeInTheDocument();
    // 85 current / 120
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('/ 120g')).toBeInTheDocument();
    
    expect(screen.getByText('Carbs')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('/ 200g')).toBeInTheDocument();
    
    expect(screen.getByText('Fat')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('/ 65g')).toBeInTheDocument();
  });

  it('renders all meal categories', () => {
    render(<FoodDiary />);
    expect(screen.getByText('Breakfast')).toBeInTheDocument();
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('Dinner')).toBeInTheDocument();
    expect(screen.getByText('Snacks')).toBeInTheDocument();
  });

  it('renders default text when there are no items', () => {
    render(<FoodDiary />);
    // Dinner initially has no items
    expect(screen.getByText('No food logged yet.')).toBeInTheDocument();
  });

  it('renders meal items when present', () => {
    render(<FoodDiary />);
    expect(screen.getByText('Oatmeal with Berries')).toBeInTheDocument();
    expect(screen.getByText('Grilled Chicken Salad')).toBeInTheDocument();
  });
});

import { baseCSS } from './base';
import { getArogyasevaCSS } from './arogyaseva';
import { getMedtrustCSS } from './medtrust';
import { getCarefirstCSS } from './carefirst';
import { getSunriseCSS } from './sunrise';
import { getOceanicCSS } from './oceanic';
import { getHeritageCSS } from './heritage';
import { getMinimalCSS } from './minimal';
import { getNatureCSS } from './nature';

export type ThemeName = 'arogyaseva' | 'medtrust' | 'carefirst' | 'sunrise' | 'oceanic' | 'heritage' | 'minimal' | 'nature';

interface ThemeOverrides {
  primary?: string;
  secondary?: string;
}

const themeMap: Record<ThemeName, (overrides?: ThemeOverrides) => string> = {
  arogyaseva: getArogyasevaCSS,
  medtrust: getMedtrustCSS,
  carefirst: getCarefirstCSS,
  sunrise: getSunriseCSS,
  oceanic: getOceanicCSS,
  heritage: getHeritageCSS,
  minimal: getMinimalCSS,
  nature: getNatureCSS,
};

/**
 * Returns full CSS string for a given theme (base + theme-specific).
 */
export function getFullThemeCSS(
  theme: ThemeName = 'arogyaseva',
  overrides?: ThemeOverrides
): string {
  const themeFn = themeMap[theme] || themeMap.arogyaseva;
  return baseCSS + themeFn(overrides);
}

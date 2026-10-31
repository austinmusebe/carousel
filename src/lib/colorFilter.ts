import type { WallpaperEntry } from '../types';

export interface ColorOption {
  id: string;
  name: string;
  hex: string;
}

export const COLOR_OPTIONS: ColorOption[] = [
  { id: 'red', name: 'Red', hex: '#ef4444' },
  { id: 'orange', name: 'Orange', hex: '#f97316' },
  { id: 'yellow', name: 'Yellow', hex: '#eab308' },
  { id: 'green', name: 'Green', hex: '#22c55e' },
  { id: 'teal', name: 'Teal', hex: '#06b6d4' },
  { id: 'blue', name: 'Blue', hex: '#3b82f6' },
  { id: 'purple', name: 'Purple', hex: '#a855f7' },
  { id: 'pink', name: 'Pink', hex: '#ec4899' },
  { id: 'brown', name: 'Brown', hex: '#854d0e' },
  { id: 'white', name: 'White', hex: '#f8fafc' },
  { id: 'gray', name: 'Gray', hex: '#64748b' },
  { id: 'black', name: 'Black', hex: '#1e293b' },
];

export const COLOR_NEIGHBORS: Record<string, string[]> = {
  red: ['orange', 'pink'],
  orange: ['red', 'yellow', 'brown'],
  yellow: ['orange', 'green'],
  green: ['teal', 'yellow'],
  teal: ['green', 'blue'],
  blue: ['teal', 'purple'],
  purple: ['blue', 'pink'],
  pink: ['purple', 'red'],
  brown: ['orange', 'black'],
  white: ['gray'],
  gray: ['white', 'black'],
  black: ['gray', 'brown'],
};

/**
 * Filter and sort wallpapers according to selected color:
 * Include any wallpaper where:
 * 1) img.primary_color === selectedColor, OR
 * 2) Any color in img.colors has color === selectedColor with percentage >= 0.10 (10%), OR
 * 3) A closely matching neighbor color has percentage within 0.15 of the target or has >= 0.20 percentage.
 *
 * Sort descending by relevance score (target percentage * 1.0 + neighbor percentage * 0.5).
 */
export function filterAndSortWallpapers(
  wallpapers: WallpaperEntry[],
  selectedColor: string | null
): WallpaperEntry[] {
  if (!selectedColor || selectedColor.toLowerCase() === 'all') {
    return wallpapers;
  }

  const target = selectedColor.toLowerCase();
  const neighbors = COLOR_NEIGHBORS[target] || [];

  const matched = wallpapers.filter((img) => {
    const primary = img.primary_color?.toLowerCase();
    // 1) img.primary_color === selectedColor
    if (primary === target) {
      return true;
    }

    const colors = img.colors || [];
    const targetEntry = colors.find((c) => c.color.toLowerCase() === target);
    const targetPct = targetEntry ? targetEntry.percentage : 0;

    // 2) Any color in img.colors has color === selectedColor with percentage >= 0.10 (10%)
    if (targetPct >= 0.10) {
      return true;
    }

    // 3) A closely matching neighbor color has percentage within 0.15 of the target or has >= 0.20 percentage.
    for (const neighbor of neighbors) {
      const neighborEntry = colors.find((c) => c.color.toLowerCase() === neighbor);
      const neighborPct = neighborEntry ? neighborEntry.percentage : 0;
      if (neighborPct >= 0.20) {
        return true;
      }
      if (targetPct > 0 && Math.abs(neighborPct - targetPct) <= 0.15) {
        return true;
      }
    }

    return false;
  });

  return matched.sort((a, b) => {
    const scoreA = computeRelevanceScore(a, target, neighbors);
    const scoreB = computeRelevanceScore(b, target, neighbors);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    const targetPctA = getTargetPercentage(a, target);
    const targetPctB = getTargetPercentage(b, target);
    return targetPctB - targetPctA;
  });
}

function getTargetPercentage(img: WallpaperEntry, target: string): number {
  const entry = img.colors?.find((c) => c.color.toLowerCase() === target);
  if (entry) return entry.percentage;
  if (img.primary_color?.toLowerCase() === target) return 0.35;
  return 0;
}

function computeRelevanceScore(img: WallpaperEntry, target: string, neighbors: string[]): number {
  const targetPct = getTargetPercentage(img, target);
  let neighborScore = 0;
  for (const neighbor of neighbors) {
    const neighborEntry = img.colors?.find((c) => c.color.toLowerCase() === neighbor);
    if (neighborEntry) {
      neighborScore += neighborEntry.percentage * 0.5;
    } else if (img.primary_color?.toLowerCase() === neighbor) {
      neighborScore += 0.25 * 0.5;
    }
  }
  return targetPct * 1.0 + neighborScore;
}

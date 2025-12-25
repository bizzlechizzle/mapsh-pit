/**
 * Token Set Ratio Service
 *
 * Provides word-order independent fuzzy matching for location names.
 * Solves the problem where "Union Station - Lockport" doesn't match
 * "Lockport Union Train Station" using character-based algorithms.
 *
 * Algorithm: Token Set Ratio (from FuzzyWuzzy/TheFuzz library)
 * - Tokenizes both strings into word sets
 * - Finds intersection and remainders
 * - Compares: intersection vs (intersection + remainder1) vs (intersection + remainder2)
 * - Returns MAX score
 *
 * Also includes:
 * - Blocking word detection (North/South, Building A/B)
 * - Generic name detection (House, Church, Factory)
 * - Combined scoring (JW + Token Set)
 */

import { jaroWinklerSimilarity } from './jaro-winkler.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Generic location names that shouldn't match on name alone.
 * These require GPS confirmation (within 25m) to be considered duplicates.
 */
export const GENERIC_NAMES = new Set([
  'house',
  'church',
  'school',
  'factory',
  'industrial',
  'industry',
  'building',
  'farm',
  'barn',
  'mill',
  'warehouse',
  'store',
  'shop',
  'hotel',
  'motel',
  'hospital',
  'office',
  'station',
  'tower',
  'plant',
  'center',
  'site',
  'place',
  'location',
  'point',
  'cars',
  'trains',
  'trucks',
]);

/**
 * Blocking words that indicate DIFFERENT places even with similar names.
 * "North Factory" and "South Factory" are NOT duplicates.
 */
export const BLOCKING_WORDS = {
  /** Direction words - opposite directions = different place */
  directions: new Set(['north', 'south', 'east', 'west', 'upper', 'lower', 'inner', 'outer']),

  /** Temporal words - old vs new = different place */
  temporal: new Set(['old', 'new', 'former', 'current', 'original', 'modern', 'historic']),

  /** Numbered words - 1 vs 2 = different place */
  numbered: new Set(['first', 'second', 'third', 'fourth', 'fifth', '1st', '2nd', '3rd', '4th', '5th']),
};

/**
 * Patterns for building/unit identifiers.
 * "Building A" and "Building B" are different places.
 */
export const IDENTIFIER_PATTERNS = [
  /\bbuilding\s*[a-z0-9]+\b/i,
  /\bunit\s*[a-z0-9]+\b/i,
  /\bwing\s*[a-z0-9]+\b/i,
  /\bward\s*[a-z0-9]+\b/i,
  /\bphase\s*[a-z0-9]+\b/i,
  /\bsection\s*[a-z0-9]+\b/i,
  /\bblock\s*[a-z0-9]+\b/i,
  /\blot\s*[a-z0-9]+\b/i,
];

// ============================================================================
// SUGGESTION FILTERING
// ============================================================================

/**
 * Generic words that alone (or with region) are not useful as suggestions.
 */
export const SUGGESTION_GENERIC_WORDS = new Set([
  'house', 'houses', 'church', 'churches', 'school', 'schools',
  'factory', 'industrial', 'industry', 'building', 'farm', 'farms',
  'barn', 'mill', 'warehouse', 'store', 'shop', 'hotel', 'motel',
  'hospital', 'office', 'station', 'tower', 'plant', 'center',
  'site', 'place', 'location', 'point', 'cars', 'trains', 'trucks',
  'quarry', 'cabin', 'greenhouse', 'theater', 'trails', 'trail',
]);

/**
 * Region/city names that when combined with generic words = placeholder entry.
 */
export const SUGGESTION_REGION_WORDS = new Set([
  'cny', 'wny', 'nny', 'eny', 'pa', 'ny', 'in',
  'fingerlakes', 'buffalo', 'syracuse', 'rochester', 'binghamton',
  'pittsburgh', 'albany', 'sayre', 'elmira', 'waterloo', 'lockport',
  'cortland', 'maine', 'ohio',
]);

// ============================================================================
// TOKENIZATION
// ============================================================================

/**
 * Tokenize a string into lowercase words, removing punctuation.
 * "Union Station - Lockport" → ["union", "station", "lockport"]
 */
export function tokenize(str: string): string[] {
  if (!str) return [];

  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => token.length > 1 || /^\d$/.test(token));
}

/**
 * Sort tokens alphabetically and join.
 * ["union", "station", "lockport"] → "lockport station union"
 */
export function sortedTokenString(tokens: string[]): string {
  return [...tokens].sort().join(' ');
}

// ============================================================================
// TOKEN SET RATIO ALGORITHM
// ============================================================================

/**
 * Calculate Token Sort Ratio.
 * Sorts both token sets alphabetically, then compares.
 *
 * "Union Station" vs "Station Union" → 100% match
 */
export function tokenSortRatio(s1: string, s2: string): number {
  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);

  if (tokens1.length === 0 && tokens2.length === 0) return 1;
  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const sorted1 = sortedTokenString(tokens1);
  const sorted2 = sortedTokenString(tokens2);

  return jaroWinklerSimilarity(sorted1, sorted2);
}

/**
 * Calculate Token Set Ratio (main algorithm).
 *
 * Steps:
 * 1. Tokenize both strings
 * 2. Find intersection (shared words)
 * 3. Find remainders (unique to each)
 * 4. Build three comparison strings:
 *    - intersection only
 *    - intersection + remainder1
 *    - intersection + remainder2
 * 5. Return MAX of all pairwise Jaro-Winkler comparisons
 *
 * Example: "Union Station - Lockport" vs "Lockport Union Train Station"
 * - tokens1: [union, station, lockport]
 * - tokens2: [lockport, union, train, station]
 * - intersection: [lockport, station, union]
 * - remainder1: []
 * - remainder2: [train]
 * - Comparisons yield very high match
 *
 * @returns Score from 0-1 (multiply by 100 for percentage)
 */
export function tokenSetRatio(s1: string, s2: string): number {
  const tokens1 = new Set(tokenize(s1));
  const tokens2 = new Set(tokenize(s2));

  if (tokens1.size === 0 && tokens2.size === 0) return 1;
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  // Find intersection and remainders
  const intersection = new Set<string>();
  const remainder1 = new Set<string>();
  const remainder2 = new Set<string>();

  for (const token of tokens1) {
    if (tokens2.has(token)) {
      intersection.add(token);
    } else {
      remainder1.add(token);
    }
  }

  for (const token of tokens2) {
    if (!tokens1.has(token)) {
      remainder2.add(token);
    }
  }

  // Build comparison strings
  const intersectionSorted = sortedTokenString([...intersection]);
  const combined1 = sortedTokenString([...intersection, ...remainder1]);
  const combined2 = sortedTokenString([...intersection, ...remainder2]);

  // If intersection is empty, fall back to token sort ratio
  if (intersection.size === 0) {
    return tokenSortRatio(s1, s2);
  }

  // Calculate all pairwise similarities
  const scores: number[] = [];

  if (intersectionSorted && combined1) {
    scores.push(jaroWinklerSimilarity(intersectionSorted, combined1));
  }

  if (intersectionSorted && combined2) {
    scores.push(jaroWinklerSimilarity(intersectionSorted, combined2));
  }

  if (combined1 && combined2) {
    scores.push(jaroWinklerSimilarity(combined1, combined2));
  }

  if (intersectionSorted === combined1 && combined1 === combined2) {
    return 1;
  }

  return Math.max(...scores, 0);
}

/**
 * Calculate partial token ratio.
 * Useful when one name is a substring of another.
 */
export function partialTokenRatio(s1: string, s2: string): number {
  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const shorter = tokens1.length <= tokens2.length ? tokens1 : tokens2;
  const longer = tokens1.length > tokens2.length ? tokens1 : tokens2;

  let totalScore = 0;
  for (const shortToken of shorter) {
    let bestMatch = 0;
    for (const longToken of longer) {
      const score = jaroWinklerSimilarity(shortToken, longToken);
      bestMatch = Math.max(bestMatch, score);
    }
    totalScore += bestMatch;
  }

  return totalScore / shorter.length;
}

// ============================================================================
// BLOCKING WORD DETECTION
// ============================================================================

/**
 * Extract blocking words from a name.
 * Returns object with categorized blocking words found.
 */
export function extractBlockingWords(name: string): {
  directions: Set<string>;
  temporal: Set<string>;
  numbered: Set<string>;
  identifiers: string[];
} {
  const tokens = tokenize(name);

  const result = {
    directions: new Set<string>(),
    temporal: new Set<string>(),
    numbered: new Set<string>(),
    identifiers: [] as string[],
  };

  for (const token of tokens) {
    if (BLOCKING_WORDS.directions.has(token)) {
      result.directions.add(token);
    }
    if (BLOCKING_WORDS.temporal.has(token)) {
      result.temporal.add(token);
    }
    if (BLOCKING_WORDS.numbered.has(token)) {
      result.numbered.add(token);
    }
  }

  // Check for identifier patterns (Building A, Unit 1, etc.)
  for (const pattern of IDENTIFIER_PATTERNS) {
    const match = name.toLowerCase().match(pattern);
    if (match) {
      result.identifiers.push(match[0]);
    }
  }

  return result;
}

/**
 * Check if two names have blocking word conflicts.
 * Returns true if names should NOT be considered duplicates.
 */
export function checkBlockingConflict(name1: string, name2: string): {
  hasConflict: boolean;
  conflictType: string | null;
  details: string | null;
} {
  const blocking1 = extractBlockingWords(name1);
  const blocking2 = extractBlockingWords(name2);

  // Check direction conflicts (North vs South)
  for (const dir1 of blocking1.directions) {
    for (const dir2 of blocking2.directions) {
      if (dir1 !== dir2) {
        return {
          hasConflict: true,
          conflictType: 'direction',
          details: `${dir1} vs ${dir2}`,
        };
      }
    }
  }

  // Check temporal conflicts (Old vs New)
  for (const temp1 of blocking1.temporal) {
    for (const temp2 of blocking2.temporal) {
      if (temp1 !== temp2) {
        return {
          hasConflict: true,
          conflictType: 'temporal',
          details: `${temp1} vs ${temp2}`,
        };
      }
    }
  }

  // Check numbered conflicts (First vs Second)
  for (const num1 of blocking1.numbered) {
    for (const num2 of blocking2.numbered) {
      if (num1 !== num2) {
        return {
          hasConflict: true,
          conflictType: 'numbered',
          details: `${num1} vs ${num2}`,
        };
      }
    }
  }

  // Check identifier conflicts (Building A vs Building B)
  for (const id1 of blocking1.identifiers) {
    for (const id2 of blocking2.identifiers) {
      if (id1 !== id2) {
        return {
          hasConflict: true,
          conflictType: 'identifier',
          details: `${id1} vs ${id2}`,
        };
      }
    }
  }

  return {
    hasConflict: false,
    conflictType: null,
    details: null,
  };
}

// ============================================================================
// GENERIC NAME DETECTION
// ============================================================================

/**
 * Check if a name is generic and requires GPS confirmation.
 */
export function isGenericName(name: string): boolean {
  if (!name) return true;

  const tokens = tokenize(name);

  // If name has only one token and it's generic
  if (tokens.length === 1 && GENERIC_NAMES.has(tokens[0])) {
    return true;
  }

  // If name is just generic + region (e.g., "House - CNY")
  if (tokens.length === 2) {
    const hasGeneric = tokens.some(t => SUGGESTION_GENERIC_WORDS.has(t));
    const hasRegion = tokens.some(t => SUGGESTION_REGION_WORDS.has(t));
    if (hasGeneric && hasRegion) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a name is too generic to be useful as a suggestion.
 */
export function isSuggestionFiltered(name: string): boolean {
  if (!name) return true;

  const tokens = tokenize(name);
  if (tokens.length === 0) return true;

  // Single generic word
  if (tokens.length === 1 && SUGGESTION_GENERIC_WORDS.has(tokens[0])) {
    return true;
  }

  // Generic + region combination
  if (tokens.length <= 3) {
    const genericCount = tokens.filter(t => SUGGESTION_GENERIC_WORDS.has(t)).length;
    const regionCount = tokens.filter(t => SUGGESTION_REGION_WORDS.has(t)).length;
    if (genericCount + regionCount >= tokens.length) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// COMBINED SCORING
// ============================================================================

/**
 * Multi-signal match scoring.
 * Combines GPS proximity, name similarity, and state matching.
 *
 * Weights:
 * - GPS proximity: 40 points
 * - Name similarity: 35 points
 * - State/county match: 25 points
 */
export function calculateMultiSignalMatch(params: {
  gpsDistanceMeters: number | null;
  nameSimilarity: number;
  stateMatch: boolean;
  gpsThreshold?: number;
}): {
  score: number;
  components: {
    gps: number;
    name: number;
    state: number;
  };
  confidence: 'high' | 'medium' | 'low';
} {
  const { gpsDistanceMeters, nameSimilarity, stateMatch, gpsThreshold = 50 } = params;

  // GPS component (40 points max)
  let gpsScore = 0;
  if (gpsDistanceMeters !== null) {
    if (gpsDistanceMeters <= gpsThreshold) {
      // Full points for exact GPS match
      gpsScore = 40 * (1 - (gpsDistanceMeters / gpsThreshold));
    }
  }

  // Name component (35 points max)
  const nameScore = nameSimilarity * 35;

  // State component (25 points max)
  const stateScore = stateMatch ? 25 : 0;

  const totalScore = gpsScore + nameScore + stateScore;

  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low';
  if (totalScore >= 80) {
    confidence = 'high';
  } else if (totalScore >= 60) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    score: Math.round(totalScore * 100) / 100,
    components: {
      gps: Math.round(gpsScore * 100) / 100,
      name: Math.round(nameScore * 100) / 100,
      state: stateScore,
    },
    confidence,
  };
}

/**
 * Combined fuzzy match using both Jaro-Winkler and Token Set Ratio.
 * Returns the higher of the two scores.
 */
export function combinedFuzzyMatch(s1: string, s2: string): {
  jaroWinkler: number;
  tokenSetRatio: number;
  combined: number;
} {
  const jw = jaroWinklerSimilarity(s1, s2);
  const tsr = tokenSetRatio(s1, s2);

  return {
    jaroWinkler: jw,
    tokenSetRatio: tsr,
    combined: Math.max(jw, tsr),
  };
}

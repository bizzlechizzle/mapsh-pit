import { describe, it, expect } from 'vitest';
import {
  jaroWinklerSimilarity,
  isMatch,
  findBestMatches,
  normalizeName,
  normalizedSimilarity,
  calculateWordOverlap,
  getAdjustedThreshold,
  isSmartMatch,
  getMatchDetails,
  getAliasDictionaryStats,
} from '../src/jaro-winkler.js';

describe('jaroWinklerSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinklerSimilarity('hello', 'hello')).toBe(1.0);
    expect(jaroWinklerSimilarity('Bethlehem Steel', 'Bethlehem Steel')).toBe(1.0);
  });

  it('returns 1.0 for case-insensitive match', () => {
    expect(jaroWinklerSimilarity('HELLO', 'hello')).toBe(1.0);
  });

  it('returns 0 for completely different strings', () => {
    expect(jaroWinklerSimilarity('abc', 'xyz')).toBe(0);
  });

  it('returns high score for similar strings', () => {
    const score = jaroWinklerSimilarity('Bethlehem Steel', 'Bethlehem Steels');
    expect(score).toBeGreaterThan(0.95);
  });

  it('gives prefix boost (Winkler modification)', () => {
    // Two pairs with same Jaro score but different prefix
    const withPrefix = jaroWinklerSimilarity('prefix123', 'prefix456');
    const noPrefix = jaroWinklerSimilarity('123prefix', '456prefix');
    expect(withPrefix).toBeGreaterThan(noPrefix);
  });

  it('handles empty strings', () => {
    expect(jaroWinklerSimilarity('', '')).toBe(1.0);
    expect(jaroWinklerSimilarity('hello', '')).toBe(0);
    expect(jaroWinklerSimilarity('', 'hello')).toBe(0);
  });

  it('handles null/undefined gracefully', () => {
    expect(jaroWinklerSimilarity(null as unknown as string, 'hello')).toBe(0);
    expect(jaroWinklerSimilarity('hello', undefined as unknown as string)).toBe(0);
  });
});

describe('isMatch', () => {
  it('matches above threshold', () => {
    expect(isMatch('Bethlehem Steel', 'Bethlehem Steels', 0.9)).toBe(true);
  });

  it('does not match below threshold', () => {
    expect(isMatch('Factory', 'Hospital', 0.9)).toBe(false);
  });
});

describe('findBestMatches', () => {
  it('finds matching candidates', () => {
    const candidates = ['Union Station', 'Central Station', 'Union Depot', 'City Hall'];
    const matches = findBestMatches('Union Sta', candidates, 0.7);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].candidate).toBe('Union Station');
  });

  it('respects limit parameter', () => {
    const candidates = ['A1', 'A2', 'A3', 'A4', 'A5'];
    const matches = findBestMatches('A', candidates, 0.5, 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('returns empty for no matches', () => {
    const candidates = ['xyz', 'abc'];
    const matches = findBestMatches('hello', candidates, 0.9);
    expect(matches.length).toBe(0);
  });
});

describe('normalizeName', () => {
  it('strips leading articles', () => {
    expect(normalizeName('The Factory')).toBe('factory');
    expect(normalizeName('A Church')).toBe('church');
    expect(normalizeName('An Old Mill')).toBe('old mill');
  });

  it('expands period abbreviations', () => {
    expect(normalizeName('St. Marys Hospital')).toBe('saint marys hospital');
    expect(normalizeName('Mt. Vernon')).toBe('mount vernon');
  });

  it('expands single-word abbreviations', () => {
    expect(normalizeName('chevy plant')).toBe('chevrolet plant');
    expect(normalizeName('PRR Station')).toBe('pennsylvania railroad station');
    expect(normalizeName('GE Factory')).toBe('general electric factory');
  });

  it('expands multi-word abbreviations', () => {
    expect(normalizeName('TB Hospital')).toBe('tuberculosis sanatorium');
    expect(normalizeName('power house')).toBe('powerhouse');
  });

  it('handles railroad abbreviations', () => {
    expect(normalizeName('NYC Terminal')).toBe('new york central terminal');
    expect(normalizeName('B&O Depot')).toBe('baltimore ohio depot');
  });

  it('handles compass directions', () => {
    expect(normalizeName('N Factory')).toBe('north factory');
    expect(normalizeName('SW Mill')).toBe('southwest mill');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeName('old   factory')).toBe('old factory');
  });

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName(null as unknown as string)).toBe('');
  });
});

describe('calculateWordOverlap', () => {
  it('finds exact word matches', () => {
    const result = calculateWordOverlap('union station lockport', 'lockport union train');
    expect(result.exactMatches).toContain('union');
    expect(result.exactMatches).toContain('lockport');
    expect(result.exactMatches.length).toBe(2);
  });

  it('calculates correct overlap ratio', () => {
    // union, station, lockport vs lockport, union, train
    // shared: union, lockport (2)
    // unique: union, station, lockport, train (4)
    // ratio: 2/4 = 0.5
    const result = calculateWordOverlap('union station lockport', 'lockport union train');
    expect(result.overlapRatio).toBe(0.5);
  });

  it('recommends boost for significant overlap', () => {
    const result = calculateWordOverlap('chevrolet biscayne', 'chevy biscayne plant');
    // After normalization: "chevrolet biscayne" vs "chevrolet biscayne plant"
    expect(result.shouldBoost).toBe(true);
  });

  it('handles empty strings', () => {
    const result = calculateWordOverlap('', 'hello');
    expect(result.exactMatches.length).toBe(0);
    expect(result.shouldBoost).toBe(false);
  });
});

describe('getAdjustedThreshold', () => {
  it('lowers threshold for word overlap', () => {
    const base = 0.85;
    const adjusted = getAdjustedThreshold('Chevy Biscayne', 'Chevrolet Biscayne', base);
    expect(adjusted).toBeLessThan(base);
    expect(adjusted).toBe(0.75); // 0.85 - 0.10
  });

  it('keeps base threshold without overlap', () => {
    const base = 0.85;
    const adjusted = getAdjustedThreshold('Factory', 'Hospital', base);
    expect(adjusted).toBe(base);
  });

  it('respects minimum threshold', () => {
    const adjusted = getAdjustedThreshold('chevy biscayne', 'chevrolet biscayne', 0.75);
    expect(adjusted).toBeGreaterThanOrEqual(0.70);
  });
});

describe('isSmartMatch', () => {
  it('matches with word overlap boost', () => {
    // "Chevy Biscayne" and "Chevrolet Biscayne" have:
    // - Normalized similarity: ~0.86
    // - Without boost: would fail at 0.85 threshold
    // - With boost: passes at 0.75 threshold
    expect(isSmartMatch('Chevy Biscayne', 'Chevrolet Biscayne', 0.85)).toBe(true);
  });

  it('matches identical names', () => {
    expect(isSmartMatch('Bethlehem Steel', 'Bethlehem Steel')).toBe(true);
  });

  it('does not match different names', () => {
    expect(isSmartMatch('Factory', 'Hospital')).toBe(false);
  });
});

describe('getMatchDetails', () => {
  it('returns complete match information', () => {
    const details = getMatchDetails('Chevy Plant', 'Chevrolet Factory');

    expect(details.name1Original).toBe('Chevy Plant');
    expect(details.name2Original).toBe('Chevrolet Factory');
    expect(details.name1Normalized).toBe('chevrolet plant');
    expect(details.name2Normalized).toBe('chevrolet factory');
    expect(details.rawSimilarity).toBeLessThan(details.normalizedSimilarity);
    expect(details.wordOverlap).toBeDefined();
    expect(typeof details.isMatch).toBe('boolean');
  });
});

describe('getAliasDictionaryStats', () => {
  it('returns non-zero counts', () => {
    const stats = getAliasDictionaryStats();
    expect(stats.multiWord).toBeGreaterThan(50);
    expect(stats.singleWord).toBeGreaterThan(100);
    expect(stats.total).toBeGreaterThan(200);
  });
});

describe('real-world matching cases', () => {
  it('normalization alone cannot handle word reordering', () => {
    // Word reordering requires Token Set Ratio (in token-set-ratio.ts)
    // Jaro-Winkler is character-position based, so reordering hurts the score
    const name1 = 'Union Station - Lockport';
    const name2 = 'Lockport Union Train Station';

    // Direct JW won't be very high due to different character positions
    const directScore = jaroWinklerSimilarity(name1, name2);
    expect(directScore).toBeLessThan(0.75);

    // Normalized JW still can't handle reordering - that's what Token Set Ratio is for
    const normalizedScore = normalizedSimilarity(name1, name2);
    expect(normalizedScore).toBeLessThan(0.85);

    // isSmartMatch uses normalized JW, not token set ratio
    // For reordering, use combinedFuzzyMatch from token-set-ratio.ts
    expect(isSmartMatch(name1, name2, 0.85)).toBe(false);
  });

  it('expands and matches railroad abbreviations', () => {
    const name1 = 'PRR Freight Depot';
    const name2 = 'Pennsylvania Railroad Depot';

    expect(isSmartMatch(name1, name2)).toBe(true);
  });

  it('expands and matches automotive brands', () => {
    expect(isSmartMatch('Chevy Plant', 'Chevrolet Factory')).toBe(true);
    expect(isSmartMatch('Olds Dealership', 'Oldsmobile Dealer')).toBe(true);
  });

  it('expands and matches corporate abbreviations', () => {
    expect(isSmartMatch('GE Building', 'General Electric Building')).toBe(true);
    expect(isSmartMatch('RCA Factory', 'Radio Corporation America Factory')).toBe(true);
  });
});

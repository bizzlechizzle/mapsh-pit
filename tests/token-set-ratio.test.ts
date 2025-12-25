import { describe, it, expect } from 'vitest';
import {
  tokenize,
  sortedTokenString,
  tokenSortRatio,
  tokenSetRatio,
  partialTokenRatio,
  extractBlockingWords,
  checkBlockingConflict,
  isGenericName,
  isSuggestionFiltered,
  calculateMultiSignalMatch,
  combinedFuzzyMatch,
} from '../src/token-set-ratio.js';

describe('tokenize', () => {
  it('converts to lowercase and splits on whitespace', () => {
    expect(tokenize('Union Station')).toEqual(['union', 'station']);
  });

  it('removes punctuation', () => {
    expect(tokenize('Union Station - Lockport')).toEqual(['union', 'station', 'lockport']);
    expect(tokenize("St. Mary's Church")).toEqual(['st', 'mary', 'church']);
  });

  it('removes single characters except digits', () => {
    // Single letter 'A' is removed, single digit '2' is kept
    expect(tokenize('Building A Level 2')).toEqual(['building', 'level', '2']);
  });

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null as unknown as string)).toEqual([]);
  });
});

describe('sortedTokenString', () => {
  it('sorts alphabetically and joins', () => {
    expect(sortedTokenString(['union', 'station', 'lockport'])).toBe('lockport station union');
  });

  it('handles empty array', () => {
    expect(sortedTokenString([])).toBe('');
  });
});

describe('tokenSortRatio', () => {
  it('returns 1.0 for reordered words', () => {
    const score = tokenSortRatio('Union Station', 'Station Union');
    expect(score).toBe(1.0);
  });

  it('returns high score for similar token sets', () => {
    const score = tokenSortRatio('Union Station Lockport', 'Lockport Union Station');
    expect(score).toBe(1.0);
  });
});

describe('tokenSetRatio', () => {
  it('handles word-reordered names (key algorithm test)', () => {
    const score = tokenSetRatio('Union Station - Lockport', 'Lockport Union Train Station');
    // Should be very high because intersection [lockport, station, union] is large
    expect(score).toBeGreaterThan(0.90);
  });

  it('returns 1.0 for identical strings', () => {
    expect(tokenSetRatio('Hello World', 'Hello World')).toBe(1.0);
  });

  it('returns 0 for completely different strings', () => {
    expect(tokenSetRatio('abc def', 'xyz uvw')).toBeLessThan(0.5);
  });

  it('handles empty strings', () => {
    expect(tokenSetRatio('', '')).toBe(1);
    expect(tokenSetRatio('hello', '')).toBe(0);
  });
});

describe('partialTokenRatio', () => {
  it('handles substring relationships', () => {
    const score = partialTokenRatio('Factory', 'Old Factory Building');
    expect(score).toBeGreaterThan(0.8);
  });

  it('returns 0 for no match', () => {
    const score = partialTokenRatio('xyz', 'abc def');
    expect(score).toBeLessThan(0.5);
  });
});

describe('extractBlockingWords', () => {
  it('extracts direction words', () => {
    const result = extractBlockingWords('North Factory');
    expect(result.directions.has('north')).toBe(true);
  });

  it('extracts temporal words', () => {
    const result = extractBlockingWords('Old Mill');
    expect(result.temporal.has('old')).toBe(true);
  });

  it('extracts numbered words', () => {
    const result = extractBlockingWords('First National Bank');
    expect(result.numbered.has('first')).toBe(true);
  });

  it('extracts identifiers', () => {
    const result = extractBlockingWords('Building A');
    expect(result.identifiers.length).toBeGreaterThan(0);
  });
});

describe('checkBlockingConflict', () => {
  it('detects direction conflicts', () => {
    const result = checkBlockingConflict('North Factory', 'South Factory');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('direction');
  });

  it('detects temporal conflicts', () => {
    const result = checkBlockingConflict('Old Mill', 'New Mill');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('temporal');
  });

  it('detects numbered conflicts', () => {
    const result = checkBlockingConflict('First Street Station', 'Second Street Station');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('numbered');
  });

  it('detects identifier conflicts', () => {
    const result = checkBlockingConflict('Building A', 'Building B');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('identifier');
  });

  it('returns no conflict for similar names', () => {
    const result = checkBlockingConflict('Union Station', 'Union Depot');
    expect(result.hasConflict).toBe(false);
  });

  it('allows same blocking word', () => {
    const result = checkBlockingConflict('North Factory', 'North Mill');
    expect(result.hasConflict).toBe(false);
  });
});

describe('isGenericName', () => {
  it('identifies single generic words', () => {
    expect(isGenericName('House')).toBe(true);
    expect(isGenericName('Church')).toBe(true);
    expect(isGenericName('Factory')).toBe(true);
  });

  it('identifies generic + region combinations', () => {
    expect(isGenericName('House - CNY')).toBe(true);
    expect(isGenericName('Factory Buffalo')).toBe(true);
  });

  it('does not flag specific names', () => {
    expect(isGenericName('Bethlehem Steel Factory')).toBe(false);
    expect(isGenericName('St Marys Church')).toBe(false);
  });
});

describe('isSuggestionFiltered', () => {
  it('filters single generic words', () => {
    expect(isSuggestionFiltered('House')).toBe(true);
    expect(isSuggestionFiltered('Factory')).toBe(true);
  });

  it('filters generic + region combos', () => {
    expect(isSuggestionFiltered('House CNY')).toBe(true);
    expect(isSuggestionFiltered('Industrial Syracuse')).toBe(true);
  });

  it('allows specific names', () => {
    expect(isSuggestionFiltered('Bethlehem Steel')).toBe(false);
    expect(isSuggestionFiltered('Union Station Rochester')).toBe(false);
  });

  it('filters empty names', () => {
    expect(isSuggestionFiltered('')).toBe(true);
    expect(isSuggestionFiltered(null as unknown as string)).toBe(true);
  });
});

describe('calculateMultiSignalMatch', () => {
  it('gives high score for GPS + name + state match', () => {
    const result = calculateMultiSignalMatch({
      gpsDistanceMeters: 10,
      nameSimilarity: 0.95,
      stateMatch: true,
    });

    expect(result.score).toBeGreaterThan(90);
    expect(result.confidence).toBe('high');
  });

  it('gives medium score for partial matches', () => {
    const result = calculateMultiSignalMatch({
      gpsDistanceMeters: 30,
      nameSimilarity: 0.80,
      stateMatch: true,
    });

    expect(result.score).toBeGreaterThan(60);
    expect(result.confidence).toBe('medium');
  });

  it('gives low score for weak matches', () => {
    const result = calculateMultiSignalMatch({
      gpsDistanceMeters: 100, // over threshold
      nameSimilarity: 0.60,
      stateMatch: false,
    });

    expect(result.score).toBeLessThan(30);
    expect(result.confidence).toBe('low');
  });

  it('handles null GPS', () => {
    const result = calculateMultiSignalMatch({
      gpsDistanceMeters: null,
      nameSimilarity: 0.95,
      stateMatch: true,
    });

    expect(result.components.gps).toBe(0);
    expect(result.components.name).toBeGreaterThan(30);
  });

  it('respects custom GPS threshold', () => {
    const result = calculateMultiSignalMatch({
      gpsDistanceMeters: 80,
      nameSimilarity: 0.90,
      stateMatch: true,
      gpsThreshold: 100,
    });

    expect(result.components.gps).toBeGreaterThan(0);
  });
});

describe('combinedFuzzyMatch', () => {
  it('returns both scores and combined max', () => {
    const result = combinedFuzzyMatch('Union Station', 'Station Union');

    expect(result.jaroWinkler).toBeDefined();
    expect(result.tokenSetRatio).toBeDefined();
    expect(result.combined).toBe(Math.max(result.jaroWinkler, result.tokenSetRatio));
  });

  it('token set ratio beats JW for reordered names', () => {
    const result = combinedFuzzyMatch('Union Station Lockport', 'Lockport Union Train Station');

    expect(result.tokenSetRatio).toBeGreaterThan(result.jaroWinkler);
    expect(result.combined).toBe(result.tokenSetRatio);
  });
});

describe('real-world blocking tests', () => {
  it('blocks North vs South factory', () => {
    const result = checkBlockingConflict('North Side Factory', 'South Side Factory');
    expect(result.hasConflict).toBe(true);
    expect(result.details).toContain('north');
    expect(result.details).toContain('south');
  });

  it('blocks Building A vs Building B', () => {
    const result = checkBlockingConflict('Hospital Building A', 'Hospital Building B');
    expect(result.hasConflict).toBe(true);
  });

  it('blocks Old Mill vs New Mill', () => {
    const result = checkBlockingConflict('Old Paper Mill', 'New Paper Mill');
    expect(result.hasConflict).toBe(true);
  });

  it('allows Upper Mill and Upper Factory (same direction)', () => {
    const result = checkBlockingConflict('Upper Mill', 'Upper Factory');
    expect(result.hasConflict).toBe(false);
  });
});

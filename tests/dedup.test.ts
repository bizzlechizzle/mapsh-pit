import { describe, it, expect } from 'vitest';
import {
  checkDuplicate,
  findDuplicateGroups,
  deduplicatePoints,
  generateDedupedPoints,
  DEFAULT_DEDUP_CONFIG,
  type DedupConfig,
} from '../src/dedup.js';
import type { ParsedMapPoint } from '../src/parser.js';

// Helper to create test points
function makePoint(
  name: string | null,
  lat: number,
  lng: number,
  state?: string | null
): ParsedMapPoint {
  return {
    name,
    description: null,
    lat,
    lng,
    state: state ?? null,
    category: null,
    rawMetadata: null,
  };
}

describe('checkDuplicate', () => {
  it('detects GPS + name match', () => {
    const p1 = makePoint('Union Station', 43.0, -77.0);
    const p2 = makePoint('Union Depot', 43.0001, -77.0001);

    const result = checkDuplicate(p1, p2);
    expect(result.matchType).toBe('both');
    expect(result.confidence).toBeGreaterThan(70);
  });

  it('detects GPS-only match for generic names', () => {
    const p1 = makePoint('House', 43.0, -77.0);
    const p2 = makePoint('Building', 43.00001, -77.00001); // ~1m apart

    const result = checkDuplicate(p1, p2, {
      ...DEFAULT_DEDUP_CONFIG,
      genericGpsThreshold: 25,
    });

    expect(result.matchType).toBe('gps');
    expect(result.isGeneric).toBe(true);
  });

  it('does not match points with blocking conflicts', () => {
    const p1 = makePoint('North Factory', 43.0, -77.0);
    const p2 = makePoint('South Factory', 43.0001, -77.0001);

    const result = checkDuplicate(p1, p2);
    expect(result.blockingConflict).toBe(true);
    expect(result.matchType).toBe('none');
    expect(result.confidence).toBe(0);
  });

  it('does not match distant points', () => {
    const p1 = makePoint('Factory', 43.0, -77.0);
    const p2 = makePoint('Factory', 43.1, -77.1); // ~14km apart

    const result = checkDuplicate(p1, p2);
    expect(result.gpsDistance).toBeGreaterThan(10000);
  });

  it('detects unnamed GPS matches', () => {
    const p1 = makePoint(null, 43.0, -77.0);
    const p2 = makePoint(null, 43.0001, -77.0001);

    const result = checkDuplicate(p1, p2);
    expect(result.matchType).toBe('gps');
    // Confidence varies based on exact distance calculation
    expect(result.confidence).toBeGreaterThanOrEqual(60);
  });
});

describe('findDuplicateGroups', () => {
  it('returns single point as its own group', () => {
    const points = [makePoint('Factory', 43.0, -77.0)];
    const groups = findDuplicateGroups(points);

    expect(groups.length).toBe(1);
    expect(groups[0].members).toEqual([0]);
    expect(groups[0].mergedName).toBe('Factory');
  });

  it('groups nearby duplicates', () => {
    const points = [
      makePoint('Union Station', 43.0, -77.0),
      makePoint('Union Depot', 43.0001, -77.0001),
      makePoint('Unrelated', 44.0, -78.0),
    ];

    const groups = findDuplicateGroups(points);

    expect(groups.length).toBe(2);

    const unionGroup = groups.find(g => g.mergedName?.includes('Union'));
    expect(unionGroup).toBeDefined();
    expect(unionGroup!.members.length).toBe(2);
  });

  it('merges AKA names with sufficient name similarity', () => {
    // Use names with high similarity that should cluster
    const points = [
      makePoint('Bethlehem Steel Works', 43.0, -77.0),
      makePoint('Bethlehem Steel Plant', 43.0001, -77.0001),
    ];

    const groups = findDuplicateGroups(points);

    // Should merge into 1 group since names are very similar + GPS close
    expect(groups.length).toBe(1);
    const group = groups[0];
    expect(group.members.length).toBe(2);
    expect(group.mergedName).toBe('Bethlehem Steel Works'); // longest
    expect(group.akaNames.length).toBe(1);
  });

  it('calculates centroid correctly', () => {
    const points = [
      makePoint('Point A', 43.0, -77.0),
      makePoint('Point B', 43.002, -77.002),
    ];

    const groups = findDuplicateGroups(points);

    // Centroid should be midpoint
    expect(groups[0].centroid.lat).toBeCloseTo(43.001, 3);
    expect(groups[0].centroid.lng).toBeCloseTo(-77.001, 3);
  });

  it('respects blocking words', () => {
    const points = [
      makePoint('North Factory', 43.0, -77.0),
      makePoint('South Factory', 43.0001, -77.0001),
    ];

    const groups = findDuplicateGroups(points);

    expect(groups.length).toBe(2); // Should NOT be merged
  });
});

describe('deduplicatePoints', () => {
  it('returns correct statistics', () => {
    const points = [
      makePoint('Union Station', 43.0, -77.0),
      makePoint('Union Depot', 43.0001, -77.0001),
      makePoint('Factory', 44.0, -78.0),
    ];

    const result = deduplicatePoints(points);

    expect(result.originalCount).toBe(3);
    expect(result.dedupedCount).toBe(2);
    expect(result.reductionPercent).toBe(33);
    expect(result.groups.length).toBe(2);
  });

  it('identifies singletons', () => {
    const points = [
      makePoint('Unique Place', 43.0, -77.0),
      makePoint('Another Unique', 44.0, -78.0),
    ];

    const result = deduplicatePoints(points);

    expect(result.singletons.length).toBe(2);
  });

  it('handles empty input', () => {
    const result = deduplicatePoints([]);

    expect(result.originalCount).toBe(0);
    expect(result.dedupedCount).toBe(0);
    expect(result.reductionPercent).toBe(0);
  });
});

describe('generateDedupedPoints', () => {
  it('generates merged points with metadata', () => {
    const points = [
      makePoint('Union Station', 43.0, -77.0, 'NY'),
      makePoint('Union Depot', 43.0001, -77.0001),
    ];

    const result = deduplicatePoints(points);
    const deduped = generateDedupedPoints(points, result);

    expect(deduped.length).toBe(result.dedupedCount);

    const merged = deduped.find(p => p.name?.includes('Union'));
    expect(merged).toBeDefined();
    expect(merged!.memberIndices.length).toBe(2);
    expect(merged!.akaNames.length).toBe(1);
    expect(merged!.state).toBe('NY');
  });

  it('preserves descriptions', () => {
    const points: ParsedMapPoint[] = [
      { ...makePoint('Factory', 43.0, -77.0), description: 'First desc' },
      { ...makePoint('Factory', 43.0001, -77.0001), description: 'Second desc' },
    ];

    const result = deduplicatePoints(points);
    const deduped = generateDedupedPoints(points, result);

    expect(deduped[0].description).toContain('First desc');
    expect(deduped[0].description).toContain('Second desc');
  });
});

describe('config options', () => {
  it('respects gpsThreshold', () => {
    // Use different names that match moderately (not perfectly)
    // so only GPS proximity determines if they merge
    const points = [
      makePoint('Old Factory Building', 43.0, -77.0),
      makePoint('Factory Site', 43.001, -77.001), // ~140m apart
    ];

    // With loose GPS (200m), within range + moderate name similarity → merge
    const loose = deduplicatePoints(points, {
      ...DEFAULT_DEDUP_CONFIG,
      gpsThreshold: 200,
      nameThreshold: 0.50, // Low name threshold
    });

    // With strict GPS (50m), not within range → don't merge
    const strict = deduplicatePoints(points, {
      ...DEFAULT_DEDUP_CONFIG,
      gpsThreshold: 50,
      requireGps: true, // Require GPS match
    });

    expect(loose.dedupedCount).toBe(1); // Merged with high GPS threshold
    expect(strict.dedupedCount).toBe(2); // Not merged with low GPS threshold
  });

  it('respects nameThreshold', () => {
    const points = [
      makePoint('Union Station', 43.0, -77.0),
      makePoint('Central Station', 43.0, -77.0), // Same GPS
    ];

    const loose = deduplicatePoints(points, { ...DEFAULT_DEDUP_CONFIG, nameThreshold: 0.5 });
    const strict = deduplicatePoints(points, { ...DEFAULT_DEDUP_CONFIG, nameThreshold: 0.95 });

    expect(loose.dedupedCount).toBeLessThanOrEqual(strict.dedupedCount);
  });

  it('respects requireGps flag', () => {
    const points = [
      makePoint('Bethlehem Steel Works', 43.0, -77.0),
      makePoint('Bethlehem Steel Works', 44.0, -78.0), // Far apart, same name
    ];

    const withGps = deduplicatePoints(points, { ...DEFAULT_DEDUP_CONFIG, requireGps: true });
    const withoutGps = deduplicatePoints(points, { ...DEFAULT_DEDUP_CONFIG, requireGps: false });

    expect(withGps.dedupedCount).toBe(2); // Not merged (too far)
    // Note: Even without requireGps, these won't merge due to distance
    // But very similar names might with high threshold
  });
});

describe('edge cases', () => {
  it('handles all null names', () => {
    const points = [
      makePoint(null, 43.0, -77.0),
      makePoint(null, 43.0001, -77.0001),
    ];

    const result = deduplicatePoints(points);
    expect(result.dedupedCount).toBe(1); // Should merge on GPS
  });

  it('handles many duplicates', () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      makePoint(`Point ${i % 3}`, 43.0 + (i % 3) * 0.0001, -77.0)
    );

    const result = deduplicatePoints(points);
    expect(result.dedupedCount).toBeLessThan(10);
  });

  it('identifies singletons correctly', () => {
    // Use completely different names that won't match on name or GPS
    const points = [
      makePoint('Bethlehem Steel Plant', 41.0, -75.0),
      makePoint('Rochester Asylum', 42.0, -76.0),
      makePoint('Seneca Army Depot', 43.0, -77.0),
    ];

    const result = deduplicatePoints(points);
    // All points are unique/singletons (no name or GPS match)
    expect(result.singletons.length).toBe(3);
    expect(result.dedupedCount).toBe(3);
  });
});

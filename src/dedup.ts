/**
 * Deduplication Module
 *
 * Implements Union-Find clustering for GPS-based deduplication
 * with fuzzy name matching support.
 */

import { haversineDistance, isWithinRadius, getBoundingBox } from './geo-utils.js';
import {
  jaroWinklerSimilarity,
  normalizedSimilarity,
  normalizeName,
  isSmartMatch,
  DEFAULT_CONFIG,
} from './jaro-winkler.js';
import {
  tokenSetRatio,
  checkBlockingConflict,
  isGenericName,
  calculateMultiSignalMatch,
} from './token-set-ratio.js';
import type { ParsedMapPoint } from './parser.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface DedupConfig {
  /** GPS distance threshold for same-location (meters) */
  gpsThreshold: number;

  /** Name similarity threshold (0-1) */
  nameThreshold: number;

  /** GPS threshold for generic names (meters) */
  genericGpsThreshold: number;

  /** Whether to require GPS match for duplicates */
  requireGps: boolean;

  /** Whether to use smart matching with word-overlap boost */
  useSmartMatch: boolean;

  /** Maximum cluster size before splitting (prevents runaway chains) */
  maxClusterSize: number;

  /** Maximum diameter of a cluster in meters (prevents geographically dispersed clusters) */
  maxClusterDiameter: number;

  /** Minimum confidence to merge (0-100) */
  minConfidence: number;
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  gpsThreshold: 50,
  nameThreshold: DEFAULT_CONFIG.NAME_SIMILARITY_THRESHOLD,
  genericGpsThreshold: 25,
  requireGps: false,
  useSmartMatch: true,
  maxClusterSize: 20,
  maxClusterDiameter: 500,
  minConfidence: 60,
};

// ============================================================================
// UNION-FIND DATA STRUCTURE
// ============================================================================

/**
 * Union-Find (Disjoint Set Union) for clustering
 */
class UnionFind {
  private parent: number[];
  private rank: number[];
  private size: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
    this.size = new Array(n).fill(1);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // Path compression
    }
    return this.parent[x];
  }

  union(x: number, y: number): boolean {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) return false;

    // Union by rank
    if (this.rank[rootX] < this.rank[rootY]) {
      this.parent[rootX] = rootY;
      this.size[rootY] += this.size[rootX];
    } else if (this.rank[rootX] > this.rank[rootY]) {
      this.parent[rootY] = rootX;
      this.size[rootX] += this.size[rootY];
    } else {
      this.parent[rootY] = rootX;
      this.size[rootX] += this.size[rootY];
      this.rank[rootX]++;
    }

    return true;
  }

  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }

  getClusterSize(x: number): number {
    return this.size[this.find(x)];
  }

  getClusters(): Map<number, number[]> {
    const clusters = new Map<number, number[]>();

    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!clusters.has(root)) {
        clusters.set(root, []);
      }
      clusters.get(root)!.push(i);
    }

    return clusters;
  }
}

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

export interface MatchResult {
  index1: number;
  index2: number;
  gpsDistance: number | null;
  nameSimilarity: number;
  tokenSetRatio: number;
  blockingConflict: boolean;
  isGeneric: boolean;
  matchType: 'gps' | 'name' | 'both' | 'none';
  confidence: number;
}

/**
 * Check if two points should be considered duplicates
 */
export function checkDuplicate(
  point1: ParsedMapPoint,
  point2: ParsedMapPoint,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): MatchResult {
  // Calculate GPS distance
  const gpsDistance = haversineDistance(point1.lat, point1.lng, point2.lat, point2.lng);
  const gpsMatch = gpsDistance <= config.gpsThreshold;

  // Calculate name similarity
  const name1 = point1.name || '';
  const name2 = point2.name || '';

  let nameSimilarity = 0;
  let tsr = 0;

  if (name1 && name2) {
    if (config.useSmartMatch) {
      nameSimilarity = normalizedSimilarity(name1, name2);
    } else {
      nameSimilarity = jaroWinklerSimilarity(name1, name2);
    }
    tsr = tokenSetRatio(name1, name2);
  }

  const combinedNameScore = Math.max(nameSimilarity, tsr);
  const nameMatch = combinedNameScore >= config.nameThreshold;

  // Check for blocking conflicts
  const blocking = checkBlockingConflict(name1, name2);

  // Check if either name is generic
  const isGeneric = isGenericName(name1) || isGenericName(name2);

  // Determine match type and confidence
  let matchType: 'gps' | 'name' | 'both' | 'none' = 'none';
  let confidence = 0;

  if (blocking.hasConflict) {
    // Blocking conflict prevents matching
    matchType = 'none';
    confidence = 0;
  } else if (gpsMatch && nameMatch) {
    matchType = 'both';
    confidence = 95;
  } else if (gpsMatch && isGeneric && gpsDistance <= config.genericGpsThreshold) {
    // Generic names can match on GPS alone if very close
    matchType = 'gps';
    confidence = 70;
  } else if (gpsMatch && !name1 && !name2) {
    // Both unnamed, GPS close
    matchType = 'gps';
    confidence = 60;
  } else if (nameMatch && !config.requireGps) {
    // Strong name match without GPS
    if (combinedNameScore >= 0.95) {
      matchType = 'name';
      confidence = 80;
    } else if (combinedNameScore >= 0.90) {
      matchType = 'name';
      confidence = 65;
    }
  } else if (gpsMatch && combinedNameScore >= 0.70) {
    // GPS match with moderate name similarity
    matchType = 'both';
    confidence = 75;
  }

  return {
    index1: 0, // Will be set by caller
    index2: 0, // Will be set by caller
    gpsDistance,
    nameSimilarity,
    tokenSetRatio: tsr,
    blockingConflict: blocking.hasConflict,
    isGeneric,
    matchType,
    confidence,
  };
}

// ============================================================================
// CLUSTERING
// ============================================================================

export interface DuplicateGroup {
  /** Representative point index */
  representative: number;

  /** All member point indices */
  members: number[];

  /** Merged name (primary name or longest) */
  mergedName: string | null;

  /** All alternate names */
  akaNames: string[];

  /** Centroid coordinates */
  centroid: { lat: number; lng: number };

  /** Match confidence (0-100) */
  confidence: number;
}

/**
 * Calculate maximum distance between any two points in a set
 */
function calculateClusterDiameter(points: ParsedMapPoint[], indices: number[]): number {
  if (indices.length <= 1) return 0;

  let maxDistance = 0;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const p1 = points[indices[i]];
      const p2 = points[indices[j]];
      const dist = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      if (dist > maxDistance) {
        maxDistance = dist;
      }
    }
  }
  return maxDistance;
}

/**
 * Find duplicate groups using Union-Find clustering with safeguards
 */
export function findDuplicateGroups(
  points: ParsedMapPoint[],
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): DuplicateGroup[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{
      representative: 0,
      members: [0],
      mergedName: points[0].name,
      akaNames: [],
      centroid: { lat: points[0].lat, lng: points[0].lng },
      confidence: 100,
    }];
  }

  const uf = new UnionFind(n);
  const matches: MatchResult[] = [];

  // Track cluster membership for safeguard checks
  const clusterMembers = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) {
    clusterMembers.set(i, new Set([i]));
  }

  // Collect all potential matches first, sorted by confidence (highest first)
  const potentialMatches: MatchResult[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const result = checkDuplicate(points[i], points[j], config);
      result.index1 = i;
      result.index2 = j;

      if (result.matchType !== 'none' && result.confidence >= config.minConfidence) {
        potentialMatches.push(result);
      }
    }
  }

  // Sort by confidence descending - merge highest confidence pairs first
  potentialMatches.sort((a, b) => b.confidence - a.confidence);

  // Process matches with safeguards
  for (const match of potentialMatches) {
    const root1 = uf.find(match.index1);
    const root2 = uf.find(match.index2);

    // Skip if already in same cluster
    if (root1 === root2) continue;

    const cluster1 = clusterMembers.get(root1)!;
    const cluster2 = clusterMembers.get(root2)!;

    // Safeguard 1: Check combined size
    const combinedSize = cluster1.size + cluster2.size;
    if (combinedSize > config.maxClusterSize) {
      continue; // Skip this merge - would exceed max size
    }

    // Safeguard 2: Check combined diameter
    const combinedIndices = [...cluster1, ...cluster2];
    const diameter = calculateClusterDiameter(points, combinedIndices);
    if (diameter > config.maxClusterDiameter) {
      continue; // Skip this merge - would exceed max diameter
    }

    // Safe to merge
    uf.union(match.index1, match.index2);
    matches.push(match);

    // Update cluster membership tracking
    const newRoot = uf.find(match.index1);
    const mergedCluster = new Set([...cluster1, ...cluster2]);
    clusterMembers.set(newRoot, mergedCluster);

    // Clean up old roots if they changed
    if (newRoot !== root1) clusterMembers.delete(root1);
    if (newRoot !== root2) clusterMembers.delete(root2);
  }

  // Build groups from clusters
  const clusters = uf.getClusters();
  const groups: DuplicateGroup[] = [];

  for (const [root, members] of clusters) {
    // Collect all names
    const names: string[] = [];
    let sumLat = 0;
    let sumLng = 0;

    for (const idx of members) {
      const point = points[idx];
      if (point.name) {
        names.push(point.name);
      }
      sumLat += point.lat;
      sumLng += point.lng;
    }

    // Deduplicate names (case-insensitive)
    const uniqueNames = new Map<string, string>();
    for (const name of names) {
      const normalized = name.toLowerCase().trim();
      if (!uniqueNames.has(normalized) || name.length > uniqueNames.get(normalized)!.length) {
        uniqueNames.set(normalized, name);
      }
    }

    // Select primary name (longest)
    const sortedNames = [...uniqueNames.values()].sort((a, b) => b.length - a.length);
    const primaryName = sortedNames[0] || null;
    const akaNames = sortedNames.slice(1);

    // Calculate average confidence for this group
    const groupMatches = matches.filter(
      m => members.includes(m.index1) && members.includes(m.index2)
    );
    const avgConfidence = groupMatches.length > 0
      ? groupMatches.reduce((sum, m) => sum + m.confidence, 0) / groupMatches.length
      : 100;

    groups.push({
      representative: root,
      members,
      mergedName: primaryName,
      akaNames,
      centroid: {
        lat: sumLat / members.length,
        lng: sumLng / members.length,
      },
      confidence: Math.round(avgConfidence),
    });
  }

  return groups;
}

// ============================================================================
// DEDUPLICATION RESULT
// ============================================================================

export interface DedupResult {
  /** Original point count */
  originalCount: number;

  /** Deduplicated point count */
  dedupedCount: number;

  /** Duplicate groups found */
  groups: DuplicateGroup[];

  /** Points that had no duplicates */
  singletons: number[];

  /** Reduction percentage */
  reductionPercent: number;
}

/**
 * Deduplicate a list of points
 */
export function deduplicatePoints(
  points: ParsedMapPoint[],
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): DedupResult {
  const originalCount = points.length;
  const groups = findDuplicateGroups(points, config);

  const singletons = groups
    .filter(g => g.members.length === 1)
    .map(g => g.representative);

  const dedupedCount = groups.length;
  const reductionPercent = originalCount > 0
    ? Math.round((1 - dedupedCount / originalCount) * 100)
    : 0;

  return {
    originalCount,
    dedupedCount,
    groups,
    singletons,
    reductionPercent,
  };
}

// ============================================================================
// OUTPUT GENERATION
// ============================================================================

export interface DedupedPoint extends ParsedMapPoint {
  /** Original point indices in this group */
  memberIndices: number[];

  /** Alternate names */
  akaNames: string[];

  /** Match confidence */
  confidence: number;

  /** Number of duplicates merged */
  duplicateCount: number;
}

/**
 * Generate deduplicated points with merged metadata
 */
export function generateDedupedPoints(
  points: ParsedMapPoint[],
  result: DedupResult
): DedupedPoint[] {
  const dedupedPoints: DedupedPoint[] = [];

  for (const group of result.groups) {
    const repPoint = points[group.representative];

    // Merge descriptions from all members
    const descriptions: string[] = [];
    const allMetadata: Record<string, unknown> = {};
    let bestCategory: string | null = null;
    let bestState: string | null = null;

    for (const idx of group.members) {
      const point = points[idx];
      if (point.description) {
        descriptions.push(point.description);
      }
      if (point.rawMetadata) {
        Object.assign(allMetadata, point.rawMetadata);
      }
      if (!bestCategory && point.category) {
        bestCategory = point.category;
      }
      if (!bestState && point.state) {
        bestState = point.state;
      }
    }

    // Dedupe descriptions
    const uniqueDescs = [...new Set(descriptions)];
    const mergedDesc = uniqueDescs.length > 0
      ? uniqueDescs.join(' | ')
      : null;

    dedupedPoints.push({
      name: group.mergedName,
      description: mergedDesc,
      lat: group.centroid.lat,
      lng: group.centroid.lng,
      state: bestState,
      category: bestCategory,
      rawMetadata: Object.keys(allMetadata).length > 0 ? allMetadata : null,
      memberIndices: group.members,
      akaNames: group.akaNames,
      confidence: group.confidence,
      duplicateCount: group.members.length - 1,
    });
  }

  return dedupedPoints;
}

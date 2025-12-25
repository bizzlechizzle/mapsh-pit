/**
 * Parser Tests
 *
 * Tests for KML, GPX, GeoJSON, and CSV parsing functionality.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  parseMapFile,
  parseMapFiles,
  mergeParseResults,
  getFileType,
  getSupportedExtensions,
} from '../src/parser.js';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ============================================================================
// FILE TYPE DETECTION
// ============================================================================

describe('getFileType', () => {
  it('detects KML files', () => {
    expect(getFileType('test.kml')).toBe('kml');
    expect(getFileType('path/to/file.KML')).toBe('kml');
  });

  it('detects KMZ files', () => {
    expect(getFileType('archive.kmz')).toBe('kmz');
  });

  it('detects GPX files', () => {
    expect(getFileType('track.gpx')).toBe('gpx');
  });

  it('detects GeoJSON files', () => {
    expect(getFileType('data.geojson')).toBe('geojson');
    expect(getFileType('data.json')).toBe('geojson');
  });

  it('detects CSV files', () => {
    expect(getFileType('points.csv')).toBe('csv');
  });

  it('returns unknown for unsupported types', () => {
    expect(getFileType('file.txt')).toBe('unknown');
    expect(getFileType('file.xml')).toBe('unknown');
    expect(getFileType('noextension')).toBe('unknown');
  });
});

describe('getSupportedExtensions', () => {
  it('returns all supported extensions', () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain('.kml');
    expect(exts).toContain('.kmz');
    expect(exts).toContain('.gpx');
    expect(exts).toContain('.geojson');
    expect(exts).toContain('.json');
    expect(exts).toContain('.csv');
  });
});

// ============================================================================
// KML PARSING
// ============================================================================

describe('KML parsing', () => {
  it('parses KML file with points', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.kml'));

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('kml');
    expect(result.points.length).toBeGreaterThanOrEqual(3);

    // Check first point (Old Mill)
    const oldMill = result.points.find(p => p.name === 'Old Mill');
    expect(oldMill).toBeDefined();
    expect(oldMill!.lat).toBeCloseTo(37.7749, 4);
    expect(oldMill!.lng).toBeCloseTo(-122.4194, 4);
    expect(oldMill!.description).toBe('Historic water mill from 1850');
    // Category comes from styleUrl (#historic) when present, else folder name
    expect(oldMill!.category).toBe('historic');
  });

  it('extracts ExtendedData metadata', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.kml'));
    const oldMill = result.points.find(p => p.name === 'Old Mill');

    expect(oldMill!.rawMetadata).toBeDefined();
    expect(oldMill!.rawMetadata!.year).toBe('1850');
    expect(oldMill!.rawMetadata!.status).toBe('abandoned');
  });

  it('parses LineString using first point', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.kml'));
    const line = result.points.find(p => p.name === 'Line Feature');

    expect(line).toBeDefined();
    expect(line!.lat).toBeCloseTo(37.0, 4);
    expect(line!.lng).toBeCloseTo(-122.0, 4);
    expect(line!.category).toBe('line');
  });

  it('parses Polygon using centroid', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.kml'));
    const area = result.points.find(p => p.name === 'Area Feature');

    expect(area).toBeDefined();
    // Centroid of polygon - includes closing point so avg shifts slightly
    expect(area!.lat).toBeCloseTo(38.04, 1);
    expect(area!.lng).toBeCloseTo(-122.04, 1);
    expect(area!.category).toBe('polygon');
  });

  it('uses folder name as category when no styleUrl', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.kml'));
    const peak = result.points.find(p => p.name === 'Mountain Peak');

    expect(peak).toBeDefined();
    expect(peak!.category).toBe('Natural');
  });
});

// ============================================================================
// GPX PARSING
// ============================================================================

describe('GPX parsing', () => {
  it('parses GPX file with waypoints', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.gpx'));

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('gpx');
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  it('extracts waypoint metadata', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.gpx'));
    const nyc = result.points.find(p => p.name === 'New York City');

    expect(nyc).toBeDefined();
    expect(nyc!.lat).toBeCloseTo(40.7128, 4);
    expect(nyc!.lng).toBeCloseTo(-74.0060, 4);
    expect(nyc!.description).toBe('The Big Apple');
    expect(nyc!.category).toBe('city');
    expect(nyc!.rawMetadata).toBeDefined();
    expect(nyc!.rawMetadata!.elevation).toBe(10);
    expect(nyc!.rawMetadata!.time).toBe('2024-01-15T12:00:00Z');
    expect(nyc!.rawMetadata!.symbol).toBe('City');
  });

  it('parses tracks using first point', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.gpx'));
    const track = result.points.find(p => p.name === 'Test Track');

    expect(track).toBeDefined();
    expect(track!.lat).toBeCloseTo(39.9526, 4);
    expect(track!.lng).toBeCloseTo(-75.1652, 4);
    expect(track!.category).toBe('track');
    expect(track!.rawMetadata!.pointCount).toBe(3);
  });

  it('parses routes using first point', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.gpx'));
    const route = result.points.find(p => p.name === 'Test Route');

    expect(route).toBeDefined();
    expect(route!.lat).toBeCloseTo(42.3601, 4);
    expect(route!.lng).toBeCloseTo(-71.0589, 4);
    expect(route!.category).toBe('route');
  });
});

// ============================================================================
// GEOJSON PARSING
// ============================================================================

describe('GeoJSON parsing', () => {
  it('parses GeoJSON FeatureCollection', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.geojson'));

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('geojson');
    expect(result.points.length).toBe(5);
  });

  it('extracts Point features', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.geojson'));
    const esb = result.points.find(p => p.name === 'Empire State Building');

    expect(esb).toBeDefined();
    expect(esb!.lat).toBeCloseTo(40.7484, 4);
    expect(esb!.lng).toBeCloseTo(-73.9857, 4);
    expect(esb!.description).toBe('Iconic skyscraper');
    expect(esb!.state).toBe('NY');
    expect(esb!.category).toBe('landmark');
  });

  it('handles alternate property names (title/desc/Name/State)', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.geojson'));
    const hollywood = result.points.find(p => p.name === 'Hollywood Sign');

    expect(hollywood).toBeDefined();
    expect(hollywood!.description).toBe('Famous landmark');
    expect(hollywood!.state).toBe('CA');
  });

  it('parses MultiPoint using first coordinate', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.geojson'));
    const multi = result.points.find(p => p.name === 'SF MultiPoint');

    expect(multi).toBeDefined();
    expect(multi!.lat).toBeCloseTo(37.7749, 4);
    expect(multi!.lng).toBeCloseTo(-122.4194, 4);
  });

  it('parses LineString using first coordinate', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.geojson'));
    const line = result.points.find(p => p.name === 'DC Line');

    expect(line).toBeDefined();
    expect(line!.lat).toBeCloseTo(38.8977, 4);
    expect(line!.lng).toBeCloseTo(-77.0365, 4);
  });

  it('parses Polygon using centroid', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.geojson'));
    const box = result.points.find(p => p.name === 'Colorado Box');

    expect(box).toBeDefined();
    // Centroid includes closing point so avg shifts slightly
    expect(box!.lat).toBeCloseTo(39.4, 0);
    expect(box!.lng).toBeCloseTo(-104.4, 0);
  });

  it('parses single Feature (not FeatureCollection)', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'single-feature.geojson'));

    expect(result.success).toBe(true);
    expect(result.points.length).toBe(1);
    expect(result.points[0].name).toBe('Miami');
    expect(result.points[0].lat).toBeCloseTo(25.7617, 4);
  });

  it('handles empty FeatureCollection', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'empty.geojson'));

    expect(result.success).toBe(true);
    expect(result.points.length).toBe(0);
  });
});

// ============================================================================
// CSV PARSING
// ============================================================================

describe('CSV parsing', () => {
  it('parses comma-delimited CSV', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.csv'));

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('csv');
    expect(result.points.length).toBe(4);
  });

  it('extracts name, description, state from CSV', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.csv'));
    const liberty = result.points.find(p => p.name === 'Statue of Liberty');

    expect(liberty).toBeDefined();
    expect(liberty!.lat).toBeCloseTo(40.6892, 4);
    expect(liberty!.lng).toBeCloseTo(-74.0445, 4);
    expect(liberty!.description).toBe('Liberty Enlightening the World');
    expect(liberty!.state).toBe('NY');
    expect(liberty!.category).toBe('csv');
  });

  it('stores extra columns in rawMetadata', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'sample.csv'));
    const liberty = result.points.find(p => p.name === 'Statue of Liberty');

    expect(liberty!.rawMetadata).toBeDefined();
    expect(liberty!.rawMetadata!.category).toBe('landmark');
  });

  it('detects tab delimiter', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'tabs.csv'));

    expect(result.success).toBe(true);
    expect(result.points.length).toBe(2);

    const tokyo = result.points.find(p => p.name === 'Tab Test 1');
    expect(tokyo).toBeDefined();
    expect(tokyo!.lat).toBeCloseTo(35.6762, 4);
    expect(tokyo!.lng).toBeCloseTo(139.6503, 4);
  });

  it('detects semicolon delimiter', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'semicolon.csv'));

    expect(result.success).toBe(true);
    expect(result.points.length).toBe(2);

    const paris = result.points.find(p => p.name === 'Semi Test 1');
    expect(paris).toBeDefined();
    expect(paris!.lat).toBeCloseTo(48.8566, 4);
    expect(paris!.lng).toBeCloseTo(2.3522, 4);
  });

  it('recognizes alternate column names (latitude/longitude/lon)', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'tabs.csv'));
    // tabs.csv uses 'latitude' and 'longitude' columns
    expect(result.success).toBe(true);
    expect(result.points.length).toBe(2);
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

describe('error handling', () => {
  it('returns error for unsupported file type', async () => {
    const result = await parseMapFile('/fake/path/file.txt');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported file type');
  });

  it('returns error for non-existent file', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'does-not-exist.kml'));

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles malformed XML gracefully', async () => {
    const result = await parseMapFile(path.join(FIXTURES_DIR, 'invalid.kml'));

    // Parser may succeed with 0 points or fail - either is acceptable
    if (result.success) {
      expect(result.points.length).toBe(0);
    } else {
      expect(result.error).toBeDefined();
    }
  });
});

// ============================================================================
// BATCH PARSING
// ============================================================================

describe('parseMapFiles', () => {
  it('parses multiple files concurrently', async () => {
    const files = [
      path.join(FIXTURES_DIR, 'sample.kml'),
      path.join(FIXTURES_DIR, 'sample.gpx'),
      path.join(FIXTURES_DIR, 'sample.geojson'),
    ];

    const results = await parseMapFiles(files);

    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('handles mixed success and failure', async () => {
    const files = [
      path.join(FIXTURES_DIR, 'sample.kml'),
      path.join(FIXTURES_DIR, 'does-not-exist.kml'),
    ];

    const results = await parseMapFiles(files);

    expect(results.length).toBe(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });
});

describe('mergeParseResults', () => {
  it('merges points from multiple results', async () => {
    const files = [
      path.join(FIXTURES_DIR, 'sample.csv'),
      path.join(FIXTURES_DIR, 'sample.geojson'),
    ];

    const results = await parseMapFiles(files);
    const merged = mergeParseResults(results);

    expect(merged.successCount).toBe(2);
    expect(merged.errorCount).toBe(0);
    expect(merged.points.length).toBe(4 + 5); // 4 CSV + 5 GeoJSON
    expect(merged.errors.length).toBe(0);
  });

  it('tracks errors properly', async () => {
    const files = [
      path.join(FIXTURES_DIR, 'sample.csv'),
      path.join(FIXTURES_DIR, 'does-not-exist.gpx'),
    ];

    const results = await parseMapFiles(files);
    const merged = mergeParseResults(results);

    expect(merged.successCount).toBe(1);
    expect(merged.errorCount).toBe(1);
    expect(merged.errors.length).toBe(1);
    expect(merged.errors[0].file).toBe('does-not-exist.gpx');
  });
});

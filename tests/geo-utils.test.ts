import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  isWithinRadius,
  getBoundingBox,
  calculateCentroid,
  isValidCoordinate,
} from '../src/geo-utils.js';

describe('haversineDistance', () => {
  it('calculates zero distance for same point', () => {
    const distance = haversineDistance(43.0, -77.0, 43.0, -77.0);
    expect(distance).toBe(0);
  });

  it('calculates known distance between New York and Los Angeles', () => {
    // NYC: 40.7128, -74.0060
    // LA: 34.0522, -118.2437
    // Known distance: ~3944 km
    const distance = haversineDistance(40.7128, -74.0060, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(3900000); // meters
    expect(distance).toBeLessThan(4000000);
  });

  it('calculates short distance accurately', () => {
    // Two points ~100 meters apart
    // Using 1 degree lat ≈ 111km, 0.001 degree ≈ 111m
    const distance = haversineDistance(43.0, -77.0, 43.001, -77.0);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });

  it('handles antipodal points', () => {
    // North pole to south pole
    const distance = haversineDistance(90, 0, -90, 0);
    // Should be approximately half Earth's circumference
    expect(distance).toBeGreaterThan(20000000);
  });
});

describe('isWithinRadius', () => {
  it('returns true for points within radius', () => {
    expect(isWithinRadius(43.0, -77.0, 43.0, -77.0, 50)).toBe(true);
    expect(isWithinRadius(43.0, -77.0, 43.0001, -77.0, 50)).toBe(true);
  });

  it('returns false for points outside radius', () => {
    expect(isWithinRadius(43.0, -77.0, 43.01, -77.0, 50)).toBe(false);
  });

  it('handles edge case at exact radius', () => {
    // 50m radius, find point exactly 50m away
    const distance = haversineDistance(43.0, -77.0, 43.00045, -77.0);
    expect(isWithinRadius(43.0, -77.0, 43.00045, -77.0, distance)).toBe(true);
  });
});

describe('getBoundingBox', () => {
  it('creates symmetric bounding box at equator', () => {
    const box = getBoundingBox(0, 0, 1000);
    expect(box.minLat).toBeCloseTo(-0.00898, 4);
    expect(box.maxLat).toBeCloseTo(0.00898, 4);
    // At equator, lat and lng deltas should be equal
    const latDelta = box.maxLat - box.minLat;
    const lngDelta = box.maxLng - box.minLng;
    expect(latDelta).toBeCloseTo(lngDelta, 3);
  });

  it('expands longitude delta at high latitudes', () => {
    // At 60 degrees north, longitude degrees cover less distance
    const boxEquator = getBoundingBox(0, 0, 1000);
    const boxNorth = getBoundingBox(60, 0, 1000);

    const lngDeltaEquator = boxEquator.maxLng - boxEquator.minLng;
    const lngDeltaNorth = boxNorth.maxLng - boxNorth.minLng;

    expect(lngDeltaNorth).toBeGreaterThan(lngDeltaEquator);
  });

  it('creates valid bounding box', () => {
    const box = getBoundingBox(43.0, -77.0, 5000);
    expect(box.minLat).toBeLessThan(43.0);
    expect(box.maxLat).toBeGreaterThan(43.0);
    expect(box.minLng).toBeLessThan(-77.0);
    expect(box.maxLng).toBeGreaterThan(-77.0);
  });
});

describe('calculateCentroid', () => {
  it('returns single point for single coordinate', () => {
    const centroid = calculateCentroid([[43.0, -77.0]]);
    expect(centroid[0]).toBe(43.0);
    expect(centroid[1]).toBe(-77.0);
  });

  it('calculates midpoint for two points', () => {
    const centroid = calculateCentroid([
      [42.0, -76.0],
      [44.0, -78.0],
    ]);
    expect(centroid[0]).toBe(43.0);
    expect(centroid[1]).toBe(-77.0);
  });

  it('throws for empty array', () => {
    expect(() => calculateCentroid([])).toThrow('Cannot calculate centroid of empty array');
  });
});

describe('isValidCoordinate', () => {
  it('accepts valid coordinates', () => {
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(43.0, -77.0)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('rejects invalid latitudes', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
  });

  it('rejects invalid longitudes', () => {
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isValidCoordinate(NaN, 0)).toBe(false);
    expect(isValidCoordinate(0, NaN)).toBe(false);
  });
});

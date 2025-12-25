/**
 * Geographic Utility Functions
 *
 * Provides Haversine distance calculation for GPS proximity checks.
 * Used by dedup module for duplicate detection.
 */

/**
 * Calculate distance between two GPS coordinates in meters.
 * Uses the Haversine formula for great-circle distance on a sphere.
 *
 * @param lat1 - Latitude of first point (decimal degrees)
 * @param lng1 - Longitude of first point (decimal degrees)
 * @param lat2 - Latitude of second point (decimal degrees)
 * @param lng2 - Longitude of second point (decimal degrees)
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters

  const toRad = (deg: number): number => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Check if two GPS coordinates are within a given radius.
 *
 * @param lat1 - Latitude of first point
 * @param lng1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lng2 - Longitude of second point
 * @param radiusMeters - Maximum distance in meters
 * @returns True if points are within radius
 */
export function isWithinRadius(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radiusMeters: number
): boolean {
  return haversineDistance(lat1, lng1, lat2, lng2) <= radiusMeters;
}

/**
 * Calculate approximate bounding box for a given radius around a point.
 * Used for pre-filtering database queries before exact distance calculation.
 *
 * Note: This is an approximation. At higher latitudes, longitude degrees
 * cover less distance, so we use a conservative estimate.
 *
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param radiusMeters - Radius in meters
 * @returns Bounding box { minLat, maxLat, minLng, maxLng }
 */
export function getBoundingBox(
  lat: number,
  lng: number,
  radiusMeters: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  // 1 degree latitude ≈ 111,320 meters
  const latDelta = radiusMeters / 111320;

  // 1 degree longitude varies by latitude: ≈ 111,320 * cos(lat) meters
  // Use a conservative estimate (smaller cos value = larger delta)
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/**
 * Calculate centroid from array of coordinates.
 *
 * @param coords - Array of [lat, lng] pairs
 * @returns Centroid [lat, lng]
 */
export function calculateCentroid(coords: [number, number][]): [number, number] {
  if (coords.length === 0) {
    throw new Error('Cannot calculate centroid of empty array');
  }

  let sumLat = 0;
  let sumLng = 0;

  for (const [lat, lng] of coords) {
    sumLat += lat;
    sumLng += lng;
  }

  return [sumLat / coords.length, sumLng / coords.length];
}

/**
 * Validate GPS coordinates.
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns True if valid
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// ============================================================================
// US STATE LOOKUP (Bounding Box Approximation)
// ============================================================================

interface StateBounds {
  name: string;
  abbr: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Approximate bounding boxes for US states.
 * For overlapping regions, smaller/more specific states are listed first.
 */
const US_STATE_BOUNDS: StateBounds[] = [
  // New England (small, specific)
  { name: 'Rhode Island', abbr: 'RI', minLat: 41.1, maxLat: 42.02, minLng: -71.9, maxLng: -71.1 },
  { name: 'Connecticut', abbr: 'CT', minLat: 40.95, maxLat: 42.05, minLng: -73.73, maxLng: -71.78 },
  { name: 'Massachusetts', abbr: 'MA', minLat: 41.2, maxLat: 42.9, minLng: -73.5, maxLng: -69.9 },
  { name: 'New Hampshire', abbr: 'NH', minLat: 42.7, maxLat: 45.3, minLng: -72.6, maxLng: -70.6 },
  { name: 'Vermont', abbr: 'VT', minLat: 42.7, maxLat: 45.02, minLng: -73.45, maxLng: -71.5 },
  { name: 'Maine', abbr: 'ME', minLat: 43.0, maxLat: 47.46, minLng: -71.1, maxLng: -66.9 },

  // Mid-Atlantic
  { name: 'Delaware', abbr: 'DE', minLat: 38.45, maxLat: 39.84, minLng: -75.79, maxLng: -74.98 },
  { name: 'New Jersey', abbr: 'NJ', minLat: 38.9, maxLat: 41.36, minLng: -75.57, maxLng: -73.9 },
  { name: 'Maryland', abbr: 'MD', minLat: 37.9, maxLat: 39.72, minLng: -79.49, maxLng: -75.05 },
  { name: 'District of Columbia', abbr: 'DC', minLat: 38.8, maxLat: 39.0, minLng: -77.12, maxLng: -76.91 },
  { name: 'Pennsylvania', abbr: 'PA', minLat: 39.72, maxLat: 42.27, minLng: -80.52, maxLng: -74.69 },
  { name: 'New York', abbr: 'NY', minLat: 40.5, maxLat: 45.02, minLng: -79.76, maxLng: -71.86 },

  // Southeast
  { name: 'West Virginia', abbr: 'WV', minLat: 37.2, maxLat: 40.64, minLng: -82.64, maxLng: -77.72 },
  { name: 'Virginia', abbr: 'VA', minLat: 36.54, maxLat: 39.47, minLng: -83.68, maxLng: -75.24 },
  { name: 'North Carolina', abbr: 'NC', minLat: 33.84, maxLat: 36.59, minLng: -84.32, maxLng: -75.46 },
  { name: 'South Carolina', abbr: 'SC', minLat: 32.03, maxLat: 35.22, minLng: -83.35, maxLng: -78.54 },
  { name: 'Georgia', abbr: 'GA', minLat: 30.36, maxLat: 35.0, minLng: -85.61, maxLng: -80.84 },
  { name: 'Florida', abbr: 'FL', minLat: 24.4, maxLat: 31.0, minLng: -87.63, maxLng: -80.03 },
  { name: 'Alabama', abbr: 'AL', minLat: 30.22, maxLat: 35.01, minLng: -88.47, maxLng: -84.89 },
  { name: 'Mississippi', abbr: 'MS', minLat: 30.17, maxLat: 35.0, minLng: -91.66, maxLng: -88.1 },
  { name: 'Louisiana', abbr: 'LA', minLat: 28.93, maxLat: 33.02, minLng: -94.04, maxLng: -88.82 },
  { name: 'Tennessee', abbr: 'TN', minLat: 34.98, maxLat: 36.68, minLng: -90.31, maxLng: -81.65 },
  { name: 'Kentucky', abbr: 'KY', minLat: 36.5, maxLat: 39.15, minLng: -89.57, maxLng: -81.96 },

  // Midwest
  { name: 'Ohio', abbr: 'OH', minLat: 38.4, maxLat: 42.0, minLng: -84.82, maxLng: -80.52 },
  { name: 'Indiana', abbr: 'IN', minLat: 37.77, maxLat: 41.76, minLng: -88.1, maxLng: -84.78 },
  { name: 'Michigan', abbr: 'MI', minLat: 41.7, maxLat: 48.3, minLng: -90.42, maxLng: -82.42 },
  { name: 'Illinois', abbr: 'IL', minLat: 36.97, maxLat: 42.51, minLng: -91.51, maxLng: -87.02 },
  { name: 'Wisconsin', abbr: 'WI', minLat: 42.49, maxLat: 47.08, minLng: -92.89, maxLng: -86.25 },
  { name: 'Minnesota', abbr: 'MN', minLat: 43.5, maxLat: 49.38, minLng: -97.24, maxLng: -89.49 },
  { name: 'Iowa', abbr: 'IA', minLat: 40.38, maxLat: 43.5, minLng: -96.64, maxLng: -90.14 },
  { name: 'Missouri', abbr: 'MO', minLat: 35.99, maxLat: 40.61, minLng: -95.77, maxLng: -89.1 },
  { name: 'Arkansas', abbr: 'AR', minLat: 33.0, maxLat: 36.5, minLng: -94.62, maxLng: -89.64 },

  // Great Plains
  { name: 'North Dakota', abbr: 'ND', minLat: 45.94, maxLat: 49.0, minLng: -104.05, maxLng: -96.55 },
  { name: 'South Dakota', abbr: 'SD', minLat: 42.48, maxLat: 45.95, minLng: -104.06, maxLng: -96.44 },
  { name: 'Nebraska', abbr: 'NE', minLat: 40.0, maxLat: 43.0, minLng: -104.05, maxLng: -95.31 },
  { name: 'Kansas', abbr: 'KS', minLat: 36.99, maxLat: 40.0, minLng: -102.05, maxLng: -94.59 },
  { name: 'Oklahoma', abbr: 'OK', minLat: 33.62, maxLat: 37.0, minLng: -103.0, maxLng: -94.43 },
  { name: 'Texas', abbr: 'TX', minLat: 25.84, maxLat: 36.5, minLng: -106.65, maxLng: -93.51 },

  // Mountain West
  { name: 'Montana', abbr: 'MT', minLat: 44.36, maxLat: 49.0, minLng: -116.05, maxLng: -104.04 },
  { name: 'Wyoming', abbr: 'WY', minLat: 40.99, maxLat: 45.01, minLng: -111.06, maxLng: -104.05 },
  { name: 'Colorado', abbr: 'CO', minLat: 36.99, maxLat: 41.0, minLng: -109.06, maxLng: -102.04 },
  { name: 'New Mexico', abbr: 'NM', minLat: 31.33, maxLat: 37.0, minLng: -109.05, maxLng: -103.0 },
  { name: 'Idaho', abbr: 'ID', minLat: 41.99, maxLat: 49.0, minLng: -117.24, maxLng: -111.04 },
  { name: 'Utah', abbr: 'UT', minLat: 36.99, maxLat: 42.0, minLng: -114.05, maxLng: -109.04 },
  { name: 'Arizona', abbr: 'AZ', minLat: 31.33, maxLat: 37.0, minLng: -114.82, maxLng: -109.04 },
  { name: 'Nevada', abbr: 'NV', minLat: 35.0, maxLat: 42.0, minLng: -120.0, maxLng: -114.04 },

  // Pacific West
  { name: 'Washington', abbr: 'WA', minLat: 45.54, maxLat: 49.0, minLng: -124.85, maxLng: -116.92 },
  { name: 'Oregon', abbr: 'OR', minLat: 41.99, maxLat: 46.3, minLng: -124.57, maxLng: -116.46 },
  { name: 'California', abbr: 'CA', minLat: 32.53, maxLat: 42.01, minLng: -124.42, maxLng: -114.13 },

  // Non-contiguous
  { name: 'Alaska', abbr: 'AK', minLat: 51.2, maxLat: 71.5, minLng: -179.15, maxLng: -129.98 },
  { name: 'Hawaii', abbr: 'HI', minLat: 18.91, maxLat: 22.24, minLng: -160.25, maxLng: -154.8 },
];

/**
 * Look up US state from GPS coordinates using bounding box approximation.
 * Returns null for coordinates outside the US.
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns State abbreviation (e.g., 'NY') or null
 */
export function getUSStateFromCoords(lat: number, lng: number): string | null {
  for (const state of US_STATE_BOUNDS) {
    if (
      lat >= state.minLat &&
      lat <= state.maxLat &&
      lng >= state.minLng &&
      lng <= state.maxLng
    ) {
      return state.abbr;
    }
  }
  return null;
}

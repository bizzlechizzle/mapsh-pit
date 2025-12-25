/**
 * Map Parser Module
 *
 * Parses various map file formats (KML, KMZ, GPX, GeoJSON, CSV)
 * and extracts points with coordinates and metadata.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import * as unzipper from 'unzipper';
import { isValidCoordinate, getUSStateFromCoords } from './geo-utils.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ParsedMapPoint {
  name: string | null;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  rawMetadata: Record<string, unknown> | null;
}

export interface ParsedMapResult {
  success: boolean;
  points: ParsedMapPoint[];
  fileType: string;
  fileName: string;
  error?: string;
}

export type SupportedFormat = 'kml' | 'kmz' | 'gpx' | 'geojson' | 'csv' | 'unknown';

// ============================================================================
// FILE TYPE DETECTION
// ============================================================================

/**
 * Detect file type from extension
 */
export function getFileType(filePath: string): SupportedFormat {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.kml': return 'kml';
    case '.kmz': return 'kmz';
    case '.gpx': return 'gpx';
    case '.geojson':
    case '.json': return 'geojson';
    case '.csv': return 'csv';
    default: return 'unknown';
  }
}

/**
 * Get list of supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return ['.kml', '.kmz', '.gpx', '.geojson', '.json', '.csv'];
}

// ============================================================================
// KML PARSING
// ============================================================================

/**
 * Extract category from KML styleUrl or folder
 */
function getKMLCategory(placemark: Element): string | null {
  const styleUrl = placemark.getElementsByTagName('styleUrl')[0];
  if (styleUrl?.textContent) {
    const style = styleUrl.textContent.replace('#', '');
    if (style) return style;
  }

  let parent = placemark.parentNode;
  while (parent) {
    if (parent.nodeName === 'Folder') {
      const folderName = (parent as Element).getElementsByTagName('name')[0];
      if (folderName?.textContent) {
        return folderName.textContent.trim();
      }
    }
    parent = parent.parentNode;
  }

  return null;
}

/**
 * Extract extended data from KML placemark
 */
function extractKMLMetadata(placemark: Element): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  const extendedData = placemark.getElementsByTagName('ExtendedData')[0];
  if (extendedData) {
    // SimpleData elements
    const simpleData = extendedData.getElementsByTagName('SimpleData');
    for (let i = 0; i < simpleData.length; i++) {
      const el = simpleData[i];
      const name = el.getAttribute('name');
      if (name && el.textContent) {
        metadata[name] = el.textContent.trim();
      }
    }

    // Data elements
    const dataElements = extendedData.getElementsByTagName('Data');
    for (let i = 0; i < dataElements.length; i++) {
      const el = dataElements[i];
      const name = el.getAttribute('name');
      const value = el.getElementsByTagName('value')[0];
      if (name && value?.textContent) {
        metadata[name] = value.textContent.trim();
      }
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Parse KML content and extract placemarks
 */
function parseKML(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  const placemarks = doc.getElementsByTagName('Placemark');

  for (let i = 0; i < placemarks.length; i++) {
    const placemark = placemarks[i];

    const nameEl = placemark.getElementsByTagName('name')[0];
    const name = nameEl?.textContent?.trim() || null;

    const descEl = placemark.getElementsByTagName('description')[0];
    const description = descEl?.textContent?.trim() || null;

    // Try Point coordinates first
    const pointEl = placemark.getElementsByTagName('Point')[0];
    if (pointEl) {
      const coordsEl = pointEl.getElementsByTagName('coordinates')[0];
      if (coordsEl?.textContent) {
        const coords = coordsEl.textContent.trim().split(',');
        if (coords.length >= 2) {
          const lng = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          if (isValidCoordinate(lat, lng)) {
            points.push({
              name,
              description,
              lat,
              lng,
              state: getUSStateFromCoords(lat, lng),
              category: getKMLCategory(placemark),
              rawMetadata: extractKMLMetadata(placemark)
            });
          }
        }
      }
    }

    // LineString (use first point)
    const lineString = placemark.getElementsByTagName('LineString')[0];
    if (lineString && !pointEl) {
      const coordsEl = lineString.getElementsByTagName('coordinates')[0];
      if (coordsEl?.textContent) {
        const firstCoord = coordsEl.textContent.trim().split(/\s+/)[0];
        const coords = firstCoord.split(',');
        if (coords.length >= 2) {
          const lng = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          if (isValidCoordinate(lat, lng)) {
            points.push({
              name,
              description,
              lat,
              lng,
              state: getUSStateFromCoords(lat, lng),
              category: getKMLCategory(placemark) || 'line',
              rawMetadata: extractKMLMetadata(placemark)
            });
          }
        }
      }
    }

    // Polygon (use centroid)
    const polygon = placemark.getElementsByTagName('Polygon')[0];
    if (polygon && !pointEl && !lineString) {
      const outerBoundary = polygon.getElementsByTagName('outerBoundaryIs')[0];
      if (outerBoundary) {
        const linearRing = outerBoundary.getElementsByTagName('LinearRing')[0];
        if (linearRing) {
          const coordsEl = linearRing.getElementsByTagName('coordinates')[0];
          if (coordsEl?.textContent) {
            const coordPairs = coordsEl.textContent.trim().split(/\s+/);
            let sumLat = 0, sumLng = 0, count = 0;
            for (const pair of coordPairs) {
              const coords = pair.split(',');
              if (coords.length >= 2) {
                const lng = parseFloat(coords[0]);
                const lat = parseFloat(coords[1]);
                if (isValidCoordinate(lat, lng)) {
                  sumLat += lat;
                  sumLng += lng;
                  count++;
                }
              }
            }
            if (count > 0) {
              const centroidLat = sumLat / count;
              const centroidLng = sumLng / count;
              points.push({
                name,
                description,
                lat: centroidLat,
                lng: centroidLng,
                state: getUSStateFromCoords(centroidLat, centroidLng),
                category: getKMLCategory(placemark) || 'polygon',
                rawMetadata: extractKMLMetadata(placemark)
              });
            }
          }
        }
      }
    }
  }

  return points;
}

// ============================================================================
// GPX PARSING
// ============================================================================

/**
 * Extract metadata from GPX waypoint
 */
function extractGPXMetadata(wpt: Element): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  const eleEl = wpt.getElementsByTagName('ele')[0];
  if (eleEl?.textContent) {
    metadata.elevation = parseFloat(eleEl.textContent);
  }

  const timeEl = wpt.getElementsByTagName('time')[0];
  if (timeEl?.textContent) {
    metadata.time = timeEl.textContent.trim();
  }

  const linkEl = wpt.getElementsByTagName('link')[0];
  if (linkEl) {
    const href = linkEl.getAttribute('href');
    if (href) metadata.link = href;
  }

  const symEl = wpt.getElementsByTagName('sym')[0];
  if (symEl?.textContent) {
    metadata.symbol = symEl.textContent.trim();
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Parse GPX content
 */
function parseGPX(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  // Waypoints
  const waypoints = doc.getElementsByTagName('wpt');
  for (let i = 0; i < waypoints.length; i++) {
    const wpt = waypoints[i];
    const lat = parseFloat(wpt.getAttribute('lat') || '');
    const lng = parseFloat(wpt.getAttribute('lon') || '');

    if (isValidCoordinate(lat, lng)) {
      const nameEl = wpt.getElementsByTagName('name')[0];
      const descEl = wpt.getElementsByTagName('desc')[0];
      const typeEl = wpt.getElementsByTagName('type')[0];

      points.push({
        name: nameEl?.textContent?.trim() || null,
        description: descEl?.textContent?.trim() || null,
        lat,
        lng,
        state: getUSStateFromCoords(lat, lng),
        category: typeEl?.textContent?.trim() || 'waypoint',
        rawMetadata: extractGPXMetadata(wpt)
      });
    }
  }

  // Tracks (use first point as representative)
  const tracks = doc.getElementsByTagName('trk');
  for (let i = 0; i < tracks.length; i++) {
    const trk = tracks[i];
    const trkNameEl = trk.getElementsByTagName('name')[0];
    const trkName = trkNameEl?.textContent?.trim() || `Track ${i + 1}`;

    const segments = trk.getElementsByTagName('trkseg');
    for (let j = 0; j < segments.length; j++) {
      const trkpts = segments[j].getElementsByTagName('trkpt');
      if (trkpts.length > 0) {
        const firstPt = trkpts[0];
        const lat = parseFloat(firstPt.getAttribute('lat') || '');
        const lng = parseFloat(firstPt.getAttribute('lon') || '');

        if (isValidCoordinate(lat, lng)) {
          points.push({
            name: trkName,
            description: `Track with ${trkpts.length} points`,
            lat,
            lng,
            state: getUSStateFromCoords(lat, lng),
            category: 'track',
            rawMetadata: { pointCount: trkpts.length }
          });
        }
      }
    }
  }

  // Routes
  const routes = doc.getElementsByTagName('rte');
  for (let i = 0; i < routes.length; i++) {
    const rte = routes[i];
    const rteNameEl = rte.getElementsByTagName('name')[0];
    const rteName = rteNameEl?.textContent?.trim() || `Route ${i + 1}`;

    const rtepts = rte.getElementsByTagName('rtept');
    if (rtepts.length > 0) {
      const firstPt = rtepts[0];
      const lat = parseFloat(firstPt.getAttribute('lat') || '');
      const lng = parseFloat(firstPt.getAttribute('lon') || '');

      if (isValidCoordinate(lat, lng)) {
        points.push({
          name: rteName,
          description: `Route with ${rtepts.length} points`,
          lat,
          lng,
          state: getUSStateFromCoords(lat, lng),
          category: 'route',
          rawMetadata: { pointCount: rtepts.length }
        });
      }
    }
  }

  return points;
}

// ============================================================================
// GEOJSON PARSING
// ============================================================================

/**
 * Parse GeoJSON content
 */
function parseGeoJSON(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];

  let data;
  try {
    data = JSON.parse(content);
  } catch {
    return points;
  }

  const features = data.type === 'FeatureCollection' ? data.features : [data];

  for (const feature of features) {
    if (!feature.geometry) continue;

    const props = feature.properties || {};
    const name = props.name || props.title || props.Name || props.Title || null;
    const description = props.description || props.desc || props.Description || null;

    const { type, coordinates } = feature.geometry;

    let lat: number | null = null;
    let lng: number | null = null;

    switch (type) {
      case 'Point':
        lng = coordinates[0];
        lat = coordinates[1];
        break;

      case 'MultiPoint':
        if (coordinates.length > 0) {
          lng = coordinates[0][0];
          lat = coordinates[0][1];
        }
        break;

      case 'LineString':
        if (coordinates.length > 0) {
          lng = coordinates[0][0];
          lat = coordinates[0][1];
        }
        break;

      case 'Polygon':
        // Calculate centroid
        if (coordinates.length > 0 && coordinates[0].length > 0) {
          let sumLat = 0, sumLng = 0;
          const ring = coordinates[0];
          for (const coord of ring) {
            sumLng += coord[0];
            sumLat += coord[1];
          }
          lng = sumLng / ring.length;
          lat = sumLat / ring.length;
        }
        break;
    }

    if (lat !== null && lng !== null && isValidCoordinate(lat, lng)) {
      points.push({
        name,
        description,
        lat,
        lng,
        state: props.state || props.State || getUSStateFromCoords(lat, lng),
        category: props.category || props.type || type,
        rawMetadata: Object.keys(props).length > 0 ? props : null
      });
    }
  }

  return points;
}

// ============================================================================
// CSV PARSING
// ============================================================================

/**
 * Detect CSV delimiter
 */
function detectDelimiter(firstLine: string): string {
  const delimiters = [',', '\t', ';', '|'];
  let maxCount = 0;
  let detected = ',';

  for (const delim of delimiters) {
    const count = (firstLine.match(new RegExp(delim.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'), 'g')) || []).length;
    if (count > maxCount) {
      maxCount = count;
      detected = delim;
    }
  }

  return detected;
}

/**
 * Find column indices for lat/lng
 */
function findCoordinateColumns(headers: string[]): { latCol: number; lngCol: number } | null {
  const latPatterns = ['lat', 'latitude', 'y', 'lat_dd'];
  const lngPatterns = ['lng', 'lon', 'longitude', 'long', 'x', 'lon_dd', 'lng_dd'];

  let latCol = -1;
  let lngCol = -1;

  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (let i = 0; i < lowerHeaders.length; i++) {
    const header = lowerHeaders[i];

    if (latPatterns.includes(header)) {
      latCol = i;
    }
    if (lngPatterns.includes(header)) {
      lngCol = i;
    }
  }

  if (latCol === -1 || lngCol === -1) {
    return null;
  }

  return { latCol, lngCol };
}

/**
 * Parse CSV content
 */
function parseCSV(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];
  const lines = content.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) return points;

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));

  const coords = findCoordinateColumns(headers);
  if (!coords) return points;

  const { latCol, lngCol } = coords;

  // Find name column
  const namePatterns = ['name', 'title', 'label', 'placename', 'place'];
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  const nameCol = lowerHeaders.findIndex(h => namePatterns.includes(h));

  // Find description column
  const descPatterns = ['description', 'desc', 'notes', 'comment', 'comments'];
  const descCol = lowerHeaders.findIndex(h => descPatterns.includes(h));

  // Find state column
  const statePatterns = ['state', 'region', 'province'];
  const stateCol = lowerHeaders.findIndex(h => statePatterns.includes(h));

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));

    const lat = parseFloat(values[latCol]);
    const lng = parseFloat(values[lngCol]);

    if (isValidCoordinate(lat, lng)) {
      const metadata: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        if (j !== latCol && j !== lngCol && values[j]) {
          metadata[headers[j]] = values[j];
        }
      }

      const csvState = stateCol >= 0 ? values[stateCol] || null : null;
      points.push({
        name: nameCol >= 0 ? values[nameCol] || null : null,
        description: descCol >= 0 ? values[descCol] || null : null,
        lat,
        lng,
        state: csvState || getUSStateFromCoords(lat, lng),
        category: 'csv',
        rawMetadata: Object.keys(metadata).length > 0 ? metadata : null
      });
    }
  }

  return points;
}

// ============================================================================
// KMZ PARSING
// ============================================================================

/**
 * Parse KMZ file (ZIP containing KML)
 */
async function parseKMZ(filePath: string): Promise<ParsedMapPoint[]> {
  const directory = await unzipper.Open.file(filePath);
  const kmlFile = directory.files.find(f => f.path.endsWith('.kml'));

  if (!kmlFile) {
    throw new Error('No KML file found in KMZ archive');
  }

  const content = await kmlFile.buffer();
  return parseKML(content.toString('utf-8'));
}

// ============================================================================
// MAIN PARSE FUNCTION
// ============================================================================

/**
 * Parse a map file and extract points
 */
export async function parseMapFile(filePath: string): Promise<ParsedMapResult> {
  const fileType = getFileType(filePath);
  const fileName = path.basename(filePath);

  if (fileType === 'unknown') {
    return {
      success: false,
      points: [],
      fileType,
      fileName,
      error: `Unsupported file type: ${path.extname(filePath)}`
    };
  }

  try {
    let points: ParsedMapPoint[];

    if (fileType === 'kmz') {
      points = await parseKMZ(filePath);
    } else {
      const content = await fsPromises.readFile(filePath, 'utf-8');

      switch (fileType) {
        case 'kml':
          points = parseKML(content);
          break;
        case 'gpx':
          points = parseGPX(content);
          break;
        case 'geojson':
          points = parseGeoJSON(content);
          break;
        case 'csv':
          points = parseCSV(content);
          break;
        default:
          points = [];
      }
    }

    return {
      success: true,
      points,
      fileType,
      fileName
    };
  } catch (error) {
    return {
      success: false,
      points: [],
      fileType,
      fileName,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Parse multiple map files
 */
export async function parseMapFiles(filePaths: string[]): Promise<ParsedMapResult[]> {
  const results = await Promise.all(filePaths.map(parseMapFile));
  return results;
}

/**
 * Merge all points from multiple parse results
 */
export function mergeParseResults(results: ParsedMapResult[]): {
  points: ParsedMapPoint[];
  successCount: number;
  errorCount: number;
  errors: Array<{ file: string; error: string }>;
} {
  const allPoints: ParsedMapPoint[] = [];
  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (const result of results) {
    if (result.success) {
      allPoints.push(...result.points);
      successCount++;
    } else {
      errorCount++;
      errors.push({ file: result.fileName, error: result.error || 'Unknown error' });
    }
  }

  return {
    points: allPoints,
    successCount,
    errorCount,
    errors
  };
}

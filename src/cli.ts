#!/usr/bin/env node
/**
 * mapcombine CLI
 *
 * GPS waypoint parsing, fuzzy matching, and deduplication tool.
 *
 * Commands:
 *   parse   - Parse map files and output points
 *   dedup   - Find and merge duplicate points
 *   match   - Find matches between two point sets
 *   merge   - Merge multiple map files into one
 *   stats   - Show statistics about points
 *   compare - Compare two names and show match details
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';

import {
  parseMapFile,
  parseMapFiles,
  mergeParseResults,
  getSupportedExtensions,
  type ParsedMapPoint,
  type ParsedMapResult,
} from './parser.js';

import {
  deduplicatePoints,
  generateDedupedPoints,
  DEFAULT_DEDUP_CONFIG,
  type DedupConfig,
} from './dedup.js';

import {
  getMatchDetails,
  normalizedSimilarity,
  getAliasDictionaryStats,
  normalizeName,
} from './jaro-winkler.js';

import {
  tokenSetRatio,
  checkBlockingConflict,
  isGenericName,
  combinedFuzzyMatch,
} from './token-set-ratio.js';

import { haversineDistance } from './geo-utils.js';

// ============================================================================
// VERSION
// ============================================================================

const VERSION = '0.1.0';

// ============================================================================
// OUTPUT FORMATTERS
// ============================================================================

type OutputFormat = 'json' | 'geojson' | 'csv' | 'table' | 'kml' | 'gpx';

function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatOutput(
  points: ParsedMapPoint[],
  format: OutputFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(points, null, 2);

    case 'geojson':
      return JSON.stringify({
        type: 'FeatureCollection',
        features: points.map(p => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [p.lng, p.lat],
          },
          properties: {
            name: p.name,
            description: p.description,
            state: p.state,
            category: p.category,
            ...p.rawMetadata,
          },
        })),
      }, null, 2);

    case 'csv': {
      const headers = ['name', 'lat', 'lng', 'state', 'category', 'description'];
      const rows = points.map(p => [
        escapeCSV(p.name || ''),
        p.lat.toString(),
        p.lng.toString(),
        escapeCSV(p.state || ''),
        escapeCSV(p.category || ''),
        escapeCSV(p.description || ''),
      ].join(','));
      return [headers.join(','), ...rows].join('\n');
    }

    case 'table': {
      const maxNameLen = Math.min(40, Math.max(...points.map(p => (p.name || '').length), 4));
      const header = `${'Name'.padEnd(maxNameLen)} | ${'Lat'.padEnd(12)} | ${'Lng'.padEnd(12)} | State`;
      const separator = '-'.repeat(header.length);
      const rows = points.map(p => {
        const name = (p.name || '').slice(0, maxNameLen).padEnd(maxNameLen);
        const lat = p.lat.toFixed(6).padEnd(12);
        const lng = p.lng.toFixed(6).padEnd(12);
        const state = p.state || '';
        return `${name} | ${lat} | ${lng} | ${state}`;
      });
      return [header, separator, ...rows].join('\n');
    }

    case 'kml': {
      const placemarks = points.map(p => {
        const name = p.name ? `<name>${escapeXML(p.name)}</name>` : '';
        const desc = p.description ? `<description>${escapeXML(p.description)}</description>` : '';
        const style = p.category ? `<styleUrl>#${escapeXML(p.category)}</styleUrl>` : '';
        return `    <Placemark>
      ${name}
      ${desc}
      ${style}
      <Point>
        <coordinates>${p.lng},${p.lat},0</coordinates>
      </Point>
    </Placemark>`;
      }).join('\n');

      return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Exported Points</name>
${placemarks}
  </Document>
</kml>`;
    }

    case 'gpx': {
      const waypoints = points.map(p => {
        const name = p.name ? `<name>${escapeXML(p.name)}</name>` : '';
        const desc = p.description ? `<desc>${escapeXML(p.description)}</desc>` : '';
        const type = p.category ? `<type>${escapeXML(p.category)}</type>` : '';
        return `  <wpt lat="${p.lat}" lon="${p.lng}">
    ${name}
    ${desc}
    ${type}
  </wpt>`;
      }).join('\n');

      return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="mapcombine" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Exported Points</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
${waypoints}
</gpx>`;
    }

    default:
      return JSON.stringify(points, null, 2);
  }
}

function escapeCSV(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================================================
// PARSE COMMAND
// ============================================================================

function createParseCommand(): Command {
  return new Command('parse')
    .description('Parse map files and extract points')
    .argument('<files...>', 'Map files to parse (KML, KMZ, GPX, GeoJSON, CSV)')
    .option('-o, --output <file>', 'Output file (defaults to stdout)')
    .option('-f, --format <format>', 'Output format: json, geojson, kml, gpx, csv, table', 'json')
    .option('-q, --quiet', 'Suppress progress output')
    .action(async (files: string[], options) => {
      const spinner = options.quiet ? null : ora('Parsing files...').start();

      try {
        const results = await parseMapFiles(files.map(f => path.resolve(f)));
        const merged = mergeParseResults(results);

        if (spinner) {
          if (merged.errorCount > 0) {
            spinner.warn(`Parsed ${merged.successCount} files, ${merged.errorCount} failed`);
            for (const err of merged.errors) {
              console.error(`  Error in ${err.file}: ${err.error}`);
            }
          } else {
            spinner.succeed(`Parsed ${merged.successCount} files, ${merged.points.length} points`);
          }
        }

        const output = formatOutput(merged.points, options.format as OutputFormat);

        if (options.output) {
          fs.writeFileSync(options.output, output);
          if (!options.quiet) {
            console.log(`Output written to ${options.output}`);
          }
        } else {
          console.log(output);
        }
      } catch (error) {
        if (spinner) spinner.fail('Parse failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

// ============================================================================
// DEDUP COMMAND
// ============================================================================

function createDedupCommand(): Command {
  return new Command('dedup')
    .description('Find and merge duplicate points')
    .argument('<files...>', 'Map files to deduplicate')
    .option('-o, --output <file>', 'Output file (defaults to stdout)')
    .option('-f, --format <format>', 'Output format: json, geojson, kml, gpx, csv, table', 'json')
    .option('-g, --gps-threshold <meters>', 'GPS distance threshold', '50')
    .option('-n, --name-threshold <score>', 'Name similarity threshold (0-1)', '0.85')
    .option('--require-gps', 'Require GPS match for duplicates')
    .option('--no-smart-match', 'Disable word-overlap boost')
    .option('--max-cluster-size <count>', 'Maximum points per cluster (prevents chain explosion)', '20')
    .option('--max-diameter <meters>', 'Maximum cluster diameter in meters', '500')
    .option('--min-confidence <score>', 'Minimum confidence to merge (0-100)', '60')
    .option('--dry-run', 'Preview what would be merged without outputting deduplicated data')
    .option('-v, --verbose', 'Show detailed match information')
    .option('-q, --quiet', 'Suppress progress output')
    .action(async (files: string[], options) => {
      const spinner = options.quiet ? null : ora('Parsing files...').start();

      try {
        const results = await parseMapFiles(files.map(f => path.resolve(f)));
        const merged = mergeParseResults(results);

        if (merged.points.length === 0) {
          if (spinner) spinner.fail('No points found');
          process.exit(1);
        }

        if (spinner) spinner.text = `Deduplicating ${merged.points.length} points...`;

        const config: DedupConfig = {
          gpsThreshold: parseFloat(options.gpsThreshold),
          nameThreshold: parseFloat(options.nameThreshold),
          genericGpsThreshold: 25,
          requireGps: options.requireGps || false,
          useSmartMatch: options.smartMatch !== false,
          maxClusterSize: parseInt(options.maxClusterSize, 10),
          maxClusterDiameter: parseFloat(options.maxDiameter),
          minConfidence: parseInt(options.minConfidence, 10),
        };

        const result = deduplicatePoints(merged.points, config);
        const dedupedPoints = generateDedupedPoints(merged.points, result);

        if (spinner) {
          spinner.succeed(
            `Deduplicated: ${result.originalCount} → ${result.dedupedCount} points (${result.reductionPercent}% reduction)`
          );
        }

        // Dry-run mode: show what would be merged
        if (options.dryRun) {
          const multiGroups = result.groups.filter(g => g.members.length > 1);
          console.log(`\n=== Dry Run Report ===\n`);
          console.log(`Total points: ${result.originalCount}`);
          console.log(`Would reduce to: ${result.dedupedCount}`);
          console.log(`Duplicate groups found: ${multiGroups.length}`);
          console.log(`Singletons (no duplicates): ${result.singletons.length}`);

          if (multiGroups.length > 0) {
            console.log(`\n=== Duplicate Groups (${multiGroups.length}) ===`);
            for (const group of multiGroups) {
              console.log(`\n  [${group.members.length} points, ${group.confidence}% confidence]`);
              console.log(`    Primary: ${group.mergedName || '(unnamed)'}`);
              if (group.akaNames.length > 0) {
                console.log(`    AKA: ${group.akaNames.slice(0, 5).join(', ')}${group.akaNames.length > 5 ? ` (+${group.akaNames.length - 5} more)` : ''}`);
              }
              console.log(`    Centroid: ${group.centroid.lat.toFixed(6)}, ${group.centroid.lng.toFixed(6)}`);

              // Show member details in verbose mode
              if (options.verbose) {
                console.log(`    Members:`);
                for (const idx of group.members.slice(0, 10)) {
                  const p = merged.points[idx];
                  console.log(`      - "${p.name || '(unnamed)'}" @ ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`);
                }
                if (group.members.length > 10) {
                  console.log(`      ... and ${group.members.length - 10} more`);
                }
              }
            }
          }
          console.log('');
          return; // Don't output data in dry-run mode
        }

        if (options.verbose && !options.dryRun) {
          console.log('\nDuplicate Groups:');
          for (const group of result.groups) {
            if (group.members.length > 1) {
              console.log(`\n  Group (${group.members.length} points, ${group.confidence}% confidence):`);
              console.log(`    Primary: ${group.mergedName}`);
              if (group.akaNames.length > 0) {
                console.log(`    AKA: ${group.akaNames.join(', ')}`);
              }
              console.log(`    Centroid: ${group.centroid.lat.toFixed(6)}, ${group.centroid.lng.toFixed(6)}`);
            }
          }
        }

        // Convert to ParsedMapPoint for output
        const outputPoints: ParsedMapPoint[] = dedupedPoints.map(p => ({
          name: p.name,
          description: p.description,
          lat: p.lat,
          lng: p.lng,
          state: p.state,
          category: p.category,
          rawMetadata: {
            ...p.rawMetadata,
            akaNames: p.akaNames.length > 0 ? p.akaNames : undefined,
            duplicateCount: p.duplicateCount > 0 ? p.duplicateCount : undefined,
            confidence: p.confidence,
          },
        }));

        const output = formatOutput(outputPoints, options.format as OutputFormat);

        if (options.output) {
          fs.writeFileSync(options.output, output);
          if (!options.quiet) {
            console.log(`Output written to ${options.output}`);
          }
        } else if (!options.verbose) {
          console.log(output);
        }
      } catch (error) {
        if (spinner) spinner.fail('Dedup failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

// ============================================================================
// COMPARE COMMAND
// ============================================================================

function createCompareCommand(): Command {
  return new Command('compare')
    .description('Compare two names and show match details')
    .argument('<name1>', 'First name')
    .argument('<name2>', 'Second name')
    .option('-t, --threshold <score>', 'Similarity threshold', '0.85')
    .action((name1: string, name2: string, options) => {
      const threshold = parseFloat(options.threshold);
      const details = getMatchDetails(name1, name2, threshold);
      const combined = combinedFuzzyMatch(name1, name2);
      const blocking = checkBlockingConflict(name1, name2);

      console.log('\n=== Name Comparison ===\n');
      console.log(`Original 1:   "${details.name1Original}"`);
      console.log(`Original 2:   "${details.name2Original}"`);
      console.log(`Normalized 1: "${details.name1Normalized}"`);
      console.log(`Normalized 2: "${details.name2Normalized}"`);

      console.log('\n=== Similarity Scores ===\n');
      console.log(`Raw Jaro-Winkler:        ${(details.rawSimilarity * 100).toFixed(1)}%`);
      console.log(`Normalized Jaro-Winkler: ${(details.normalizedSimilarity * 100).toFixed(1)}%`);
      console.log(`Token Set Ratio:         ${(combined.tokenSetRatio * 100).toFixed(1)}%`);
      console.log(`Combined (max):          ${(combined.combined * 100).toFixed(1)}%`);

      console.log('\n=== Word Overlap ===\n');
      console.log(`Exact word matches: ${details.wordOverlap.exactMatches.join(', ') || '(none)'}`);
      console.log(`Overlap ratio:      ${(details.wordOverlap.overlapRatio * 100).toFixed(1)}%`);
      console.log(`Should boost:       ${details.wordOverlap.shouldBoost ? 'Yes' : 'No'}`);

      console.log('\n=== Thresholds ===\n');
      console.log(`Base threshold:     ${(threshold * 100).toFixed(0)}%`);
      console.log(`Adjusted threshold: ${(details.adjustedThreshold * 100).toFixed(0)}%`);

      console.log('\n=== Blocking Analysis ===\n');
      console.log(`Blocking conflict:  ${blocking.hasConflict ? 'YES' : 'No'}`);
      if (blocking.hasConflict) {
        console.log(`Conflict type:      ${blocking.conflictType}`);
        console.log(`Details:            ${blocking.details}`);
      }

      console.log('\n=== Result ===\n');
      const isMatch = details.isMatch && !blocking.hasConflict;
      console.log(`Match: ${isMatch ? 'YES' : 'NO'}`);
      if (!isMatch) {
        if (blocking.hasConflict) {
          console.log(`Reason: Blocking conflict (${blocking.conflictType})`);
        } else {
          console.log(`Reason: Similarity ${(details.normalizedSimilarity * 100).toFixed(1)}% < threshold ${(details.adjustedThreshold * 100).toFixed(0)}%`);
        }
      }

      console.log('');
    });
}

// ============================================================================
// STATS COMMAND
// ============================================================================

function createStatsCommand(): Command {
  return new Command('stats')
    .description('Show statistics about map files')
    .argument('<files...>', 'Map files to analyze')
    .option('--alias-stats', 'Show alias dictionary statistics')
    .action(async (files: string[], options) => {
      const spinner = ora('Analyzing files...').start();

      try {
        const results = await parseMapFiles(files.map(f => path.resolve(f)));
        const merged = mergeParseResults(results);

        spinner.succeed('Analysis complete');

        console.log('\n=== File Statistics ===\n');
        console.log(`Files processed: ${results.length}`);
        console.log(`Files succeeded: ${merged.successCount}`);
        console.log(`Files failed:    ${merged.errorCount}`);

        if (merged.errors.length > 0) {
          console.log('\nErrors:');
          for (const err of merged.errors) {
            console.log(`  ${err.file}: ${err.error}`);
          }
        }

        console.log('\n=== Point Statistics ===\n');
        console.log(`Total points:    ${merged.points.length}`);

        // Count by file type
        const byType = new Map<string, number>();
        for (const result of results) {
          if (result.success) {
            const count = byType.get(result.fileType) || 0;
            byType.set(result.fileType, count + result.points.length);
          }
        }
        console.log('\nPoints by format:');
        for (const [type, count] of byType) {
          console.log(`  ${type.toUpperCase()}: ${count}`);
        }

        // Count by category
        const byCategory = new Map<string, number>();
        for (const point of merged.points) {
          const cat = point.category || '(uncategorized)';
          byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
        }
        if (byCategory.size > 0 && byCategory.size <= 20) {
          console.log('\nPoints by category:');
          const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
          for (const [cat, count] of sorted.slice(0, 10)) {
            console.log(`  ${cat}: ${count}`);
          }
          if (sorted.length > 10) {
            console.log(`  ... and ${sorted.length - 10} more categories`);
          }
        }

        // Name statistics
        const withName = merged.points.filter(p => p.name).length;
        const withDesc = merged.points.filter(p => p.description).length;
        const withState = merged.points.filter(p => p.state).length;
        const generic = merged.points.filter(p => isGenericName(p.name || '')).length;

        console.log('\nMetadata coverage:');
        console.log(`  With name:        ${withName} (${((withName / merged.points.length) * 100).toFixed(1)}%)`);
        console.log(`  With description: ${withDesc} (${((withDesc / merged.points.length) * 100).toFixed(1)}%)`);
        console.log(`  With state:       ${withState} (${((withState / merged.points.length) * 100).toFixed(1)}%)`);
        console.log(`  Generic names:    ${generic} (${((generic / merged.points.length) * 100).toFixed(1)}%)`);

        if (options.aliasStats) {
          const aliasStats = getAliasDictionaryStats();
          console.log('\n=== Alias Dictionary ===\n');
          console.log(`Multi-word aliases:      ${aliasStats.multiWord}`);
          console.log(`Single-word aliases:     ${aliasStats.singleWord}`);
          console.log(`Period abbreviations:    ${aliasStats.periodAbbreviations}`);
          console.log(`Total expansions:        ${aliasStats.total}`);
        }

        console.log('');
      } catch (error) {
        spinner.fail('Analysis failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

// ============================================================================
// MERGE COMMAND
// ============================================================================

function createMergeCommand(): Command {
  return new Command('merge')
    .description('Merge multiple map files into one (without deduplication)')
    .argument('<files...>', 'Map files to merge')
    .option('-o, --output <file>', 'Output file (required)')
    .option('-f, --format <format>', 'Output format: json, geojson, kml, gpx, csv', 'geojson')
    .option('-q, --quiet', 'Suppress progress output')
    .action(async (files: string[], options) => {
      if (!options.output) {
        console.error('Error: --output is required for merge command');
        process.exit(1);
      }

      const spinner = options.quiet ? null : ora('Merging files...').start();

      try {
        const results = await parseMapFiles(files.map(f => path.resolve(f)));
        const merged = mergeParseResults(results);

        if (spinner) {
          spinner.succeed(`Merged ${merged.successCount} files, ${merged.points.length} points`);
        }

        const output = formatOutput(merged.points, options.format as OutputFormat);
        fs.writeFileSync(options.output, output);

        if (!options.quiet) {
          console.log(`Output written to ${options.output}`);
        }
      } catch (error) {
        if (spinner) spinner.fail('Merge failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

// ============================================================================
// MATCH COMMAND
// ============================================================================

function createMatchCommand(): Command {
  return new Command('match')
    .description('Find matches between reference and target point sets')
    .argument('<reference>', 'Reference map file')
    .argument('<target>', 'Target map file to match against reference')
    .option('-g, --gps-threshold <meters>', 'GPS distance threshold', '50')
    .option('-n, --name-threshold <score>', 'Name similarity threshold', '0.85')
    .option('--require-both', 'Require both GPS and name match (stricter)')
    .option('--min-confidence <score>', 'Minimum confidence to report (0-100)', '50')
    .option('-o, --output <file>', 'Output matched pairs to file')
    .option('-f, --format <format>', 'Output format: json, csv', 'json')
    .action(async (refFile: string, targetFile: string, options) => {
      const spinner = ora('Loading files...').start();

      try {
        const [refResult, targetResult] = await Promise.all([
          parseMapFile(path.resolve(refFile)),
          parseMapFile(path.resolve(targetFile)),
        ]);

        if (!refResult.success) {
          spinner.fail(`Failed to parse reference: ${refResult.error}`);
          process.exit(1);
        }
        if (!targetResult.success) {
          spinner.fail(`Failed to parse target: ${targetResult.error}`);
          process.exit(1);
        }

        spinner.text = `Matching ${targetResult.points.length} targets against ${refResult.points.length} references...`;

        const gpsThreshold = parseFloat(options.gpsThreshold);
        const nameThreshold = parseFloat(options.nameThreshold);
        const minConfidence = parseInt(options.minConfidence, 10);
        const requireBoth = options.requireBoth || false;

        interface MatchPair {
          targetIndex: number;
          targetName: string;
          refIndex: number;
          refName: string;
          gpsDistance: number;
          nameSimilarity: number;
          tokenSetRatio: number;
          matchType: string;
          confidence: number;
          blocked: boolean;
        }

        const matches: MatchPair[] = [];
        const unmatched: number[] = [];

        for (let ti = 0; ti < targetResult.points.length; ti++) {
          const target = targetResult.points[ti];
          let bestMatch: MatchPair | null = null;
          let bestScore = 0;

          for (let ri = 0; ri < refResult.points.length; ri++) {
            const ref = refResult.points[ri];
            const gps = haversineDistance(target.lat, target.lng, ref.lat, ref.lng);
            const targetName = target.name || '';
            const refName = ref.name || '';

            // Use same matching logic as dedup
            const nameSim = normalizedSimilarity(targetName, refName);
            const tsr = tokenSetRatio(targetName, refName);
            const combinedNameScore = Math.max(nameSim, tsr);

            // Check for blocking conflicts (North/South, East/West, etc.)
            const blocking = checkBlockingConflict(targetName, refName);

            // Check if names are generic
            const targetGeneric = isGenericName(targetName);
            const refGeneric = isGenericName(refName);
            const bothGeneric = targetGeneric && refGeneric;

            const gpsMatch = gps <= gpsThreshold;
            const nameMatch = combinedNameScore >= nameThreshold;

            let score = 0;
            let matchType = 'none';
            let confidence = 0;

            // Skip if blocking conflict
            if (blocking.hasConflict) {
              continue;
            }

            // Require both mode
            if (requireBoth) {
              if (gpsMatch && nameMatch) {
                score = combinedNameScore * 50 + (1 - gps / gpsThreshold) * 50;
                matchType = 'both';
                confidence = 95;
              }
            } else {
              // Standard matching with confidence scoring
              if (gpsMatch && nameMatch) {
                score = combinedNameScore * 50 + (1 - gps / gpsThreshold) * 50;
                matchType = 'both';
                confidence = 95;
              } else if (gpsMatch && combinedNameScore >= 0.70) {
                // GPS match with moderate name similarity
                score = combinedNameScore * 40 + (1 - gps / gpsThreshold) * 30;
                matchType = 'both';
                confidence = 75;
              } else if (gpsMatch && bothGeneric && gps <= 25) {
                // Both generic names, very close GPS
                score = (1 - gps / 25) * 30;
                matchType = 'gps';
                confidence = 60;
              } else if (nameMatch && combinedNameScore >= 0.95) {
                // Very strong name match without GPS
                score = combinedNameScore * 45;
                matchType = 'name';
                confidence = 80;
              } else if (nameMatch && !targetGeneric && !refGeneric) {
                // Good name match, not generic names
                score = combinedNameScore * 35;
                matchType = 'name';
                confidence = 65;
              }
            }

            // Apply minimum confidence filter
            if (confidence < minConfidence) {
              continue;
            }

            if (score > bestScore) {
              bestScore = score;
              bestMatch = {
                targetIndex: ti,
                targetName,
                refIndex: ri,
                refName,
                gpsDistance: Math.round(gps * 10) / 10,
                nameSimilarity: Math.round(nameSim * 100) / 100,
                tokenSetRatio: Math.round(tsr * 100) / 100,
                matchType,
                confidence,
                blocked: false,
              };
            }
          }

          if (bestMatch && bestScore > 0) {
            matches.push(bestMatch);
          } else {
            unmatched.push(ti);
          }
        }

        spinner.succeed(`Found ${matches.length} matches, ${unmatched.length} unmatched`);

        const result = {
          summary: {
            referencePoints: refResult.points.length,
            targetPoints: targetResult.points.length,
            matched: matches.length,
            unmatched: unmatched.length,
            matchRate: `${((matches.length / targetResult.points.length) * 100).toFixed(1)}%`,
          },
          matches,
          unmatchedIndices: unmatched,
        };

        if (options.output) {
          const output = options.format === 'csv'
            ? [
                'targetIndex,targetName,refIndex,refName,gpsDistance,nameSimilarity,matchType',
                ...matches.map(m =>
                  `${m.targetIndex},"${m.targetName}",${m.refIndex},"${m.refName}",${m.gpsDistance},${m.nameSimilarity},${m.matchType}`
                ),
              ].join('\n')
            : JSON.stringify(result, null, 2);

          fs.writeFileSync(options.output, output);
          console.log(`Output written to ${options.output}`);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (error) {
        spinner.fail('Match failed');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

// ============================================================================
// MAIN PROGRAM
// ============================================================================

const program = new Command()
  .name('mapcombine')
  .description('GPS waypoint parsing, fuzzy matching, and deduplication')
  .version(VERSION);

program.addCommand(createParseCommand());
program.addCommand(createDedupCommand());
program.addCommand(createCompareCommand());
program.addCommand(createStatsCommand());
program.addCommand(createMergeCommand());
program.addCommand(createMatchCommand());

// Show help if no command
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);

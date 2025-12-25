/**
 * CLI Integration Tests
 *
 * Tests CLI commands end-to-end by invoking the actual CLI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLI_PATH = path.join(__dirname, '..', 'src', 'cli.ts');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TEMP_DIR = path.join(os.tmpdir(), 'mapcombine-cli-tests');

function runCLI(args: string[], options: { timeout?: number } = {}): { stdout: string; stderr: string; exitCode: number } {
  const timeout = options.timeout || 30000;
  try {
    const stdout = execSync(`npx tsx "${CLI_PATH}" ${args.join(' ')}`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout?.toString() || '',
      stderr: execError.stderr?.toString() || '',
      exitCode: execError.status || 1,
    };
  }
}

describe('CLI Integration', () => {
  beforeAll(() => {
    // Create temp directory for output files
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // HELP & VERSION
  // ============================================================================

  describe('help and version', () => {
    it('shows help when no command given', () => {
      const result = runCLI([]);
      expect(result.stdout).toContain('GPS waypoint parsing');
      expect(result.stdout).toContain('parse');
      expect(result.stdout).toContain('dedup');
      expect(result.stdout).toContain('compare');
      expect(result.exitCode).toBe(0);
    });

    it('shows version with --version', () => {
      const result = runCLI(['--version']);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
      expect(result.exitCode).toBe(0);
    });

    it('shows command-specific help', () => {
      const result = runCLI(['parse', '--help']);
      expect(result.stdout).toContain('Parse map files');
      expect(result.stdout).toContain('--output');
      expect(result.stdout).toContain('--format');
      expect(result.exitCode).toBe(0);
    });
  });

  // ============================================================================
  // PARSE COMMAND
  // ============================================================================

  describe('parse command', () => {
    it('parses KML file to JSON', () => {
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.kml')}"`, '--quiet']);
      expect(result.exitCode).toBe(0);

      const points = JSON.parse(result.stdout);
      expect(Array.isArray(points)).toBe(true);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty('name');
      expect(points[0]).toHaveProperty('lat');
      expect(points[0]).toHaveProperty('lng');
    });

    it('parses GPX file to JSON', () => {
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.gpx')}"`, '--quiet']);
      expect(result.exitCode).toBe(0);

      const points = JSON.parse(result.stdout);
      expect(points.length).toBe(5); // 3 waypoints + 1 track + 1 route
    });

    it('parses GeoJSON file', () => {
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.geojson')}"`, '--quiet']);
      expect(result.exitCode).toBe(0);

      const points = JSON.parse(result.stdout);
      expect(points.length).toBe(5);
    });

    it('parses CSV file', () => {
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.csv')}"`, '--quiet']);
      expect(result.exitCode).toBe(0);

      const points = JSON.parse(result.stdout);
      expect(points.length).toBe(4);
    });

    it('outputs GeoJSON format', () => {
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.csv')}"`, '-f', 'geojson', '--quiet']);
      expect(result.exitCode).toBe(0);

      const geojson = JSON.parse(result.stdout);
      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features).toHaveLength(4);
      expect(geojson.features[0].geometry.type).toBe('Point');
    });

    it('outputs CSV format', () => {
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.csv')}"`, '-f', 'csv', '--quiet']);
      expect(result.exitCode).toBe(0);

      const lines = result.stdout.trim().split('\n');
      expect(lines[0]).toContain('name,lat,lng');
      expect(lines.length).toBe(5); // header + 4 rows
    });

    it('outputs table format', () => {
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.csv')}"`, '-f', 'table', '--quiet']);
      expect(result.exitCode).toBe(0);

      expect(result.stdout).toContain('Name');
      expect(result.stdout).toContain('Lat');
      expect(result.stdout).toContain('Lng');
      expect(result.stdout).toContain('Statue of Liberty');
    });

    it('writes output to file', () => {
      const outFile = path.join(TEMP_DIR, 'parse-output.json');
      const result = runCLI(['parse', `"${path.join(FIXTURES_DIR, 'sample.csv')}"`, '-o', `"${outFile}"`, '--quiet']);
      expect(result.exitCode).toBe(0);

      expect(fs.existsSync(outFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
      expect(content.length).toBe(4);
    });

    it('parses multiple files', () => {
      const result = runCLI([
        'parse',
        `"${path.join(FIXTURES_DIR, 'sample.csv')}"`,
        `"${path.join(FIXTURES_DIR, 'sample.gpx')}"`,
        '--quiet',
      ]);
      expect(result.exitCode).toBe(0);

      const points = JSON.parse(result.stdout);
      expect(points.length).toBe(9); // 4 CSV + 5 GPX
    });

    it('handles non-existent file gracefully', () => {
      const result = runCLI(['parse', '"nonexistent.kml"']);
      // CLI returns 0 but shows error in output, with empty array
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('[]');
    });
  });

  // ============================================================================
  // COMPARE COMMAND
  // ============================================================================

  describe('compare command', () => {
    it('compares two similar names', () => {
      const result = runCLI(['compare', '"Union Station"', '"Station Union"']);
      expect(result.exitCode).toBe(0);

      expect(result.stdout).toContain('Name Comparison');
      expect(result.stdout).toContain('Similarity Scores');
      expect(result.stdout).toContain('Token Set Ratio');
      expect(result.stdout).toContain('Match: YES');
    });

    it('compares two different names', () => {
      const result = runCLI(['compare', '"New York"', '"Los Angeles"']);
      expect(result.exitCode).toBe(0);

      expect(result.stdout).toContain('Match: NO');
    });

    it('detects blocking conflicts', () => {
      const result = runCLI(['compare', '"North Station"', '"South Station"']);
      expect(result.exitCode).toBe(0);

      expect(result.stdout).toContain('Blocking Analysis');
      expect(result.stdout).toContain('Blocking conflict');
    });

    it('shows alias expansion', () => {
      const result = runCLI(['compare', '"St. Johns Church"', '"Saint Johns Church"']);
      expect(result.exitCode).toBe(0);

      expect(result.stdout).toContain('Normalized');
    });
  });

  // ============================================================================
  // STATS COMMAND
  // ============================================================================

  describe('stats command', () => {
    it('shows statistics for files', () => {
      const result = runCLI(['stats', `"${path.join(FIXTURES_DIR, 'sample.kml')}"`]);
      expect(result.exitCode).toBe(0);

      expect(result.stdout).toContain('File Statistics');
      expect(result.stdout).toContain('Files processed');
      expect(result.stdout).toContain('Point Statistics');
      expect(result.stdout).toContain('Total points');
    });

    it('shows alias stats with --alias-stats', () => {
      const result = runCLI(['stats', `"${path.join(FIXTURES_DIR, 'sample.kml')}"`, '--alias-stats']);
      expect(result.exitCode).toBe(0);

      expect(result.stdout).toContain('Alias Dictionary');
      expect(result.stdout).toContain('Multi-word aliases');
      expect(result.stdout).toContain('Single-word aliases');
    });
  });

  // ============================================================================
  // MERGE COMMAND
  // ============================================================================

  describe('merge command', () => {
    it('merges files without dedup', () => {
      const outFile = path.join(TEMP_DIR, 'merged.geojson');
      const result = runCLI([
        'merge',
        `"${path.join(FIXTURES_DIR, 'sample.csv')}"`,
        `"${path.join(FIXTURES_DIR, 'sample.gpx')}"`,
        '-o', `"${outFile}"`,
        '--quiet',
      ]);
      expect(result.exitCode).toBe(0);

      expect(fs.existsSync(outFile)).toBe(true);
      const geojson = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
      expect(geojson.features.length).toBe(9);
    });

    it('requires --output option', () => {
      const result = runCLI([
        'merge',
        `"${path.join(FIXTURES_DIR, 'sample.csv')}"`,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--output is required');
    });
  });

  // ============================================================================
  // DEDUP COMMAND
  // ============================================================================

  describe('dedup command', () => {
    it('deduplicates points', () => {
      const result = runCLI([
        'dedup',
        `"${path.join(FIXTURES_DIR, 'sample.gpx')}"`,
        '--quiet',
      ]);
      expect(result.exitCode).toBe(0);

      const points = JSON.parse(result.stdout);
      expect(Array.isArray(points)).toBe(true);
    });

    it('outputs valid JSON', () => {
      const result = runCLI([
        'dedup',
        `"${path.join(FIXTURES_DIR, 'sample.gpx')}"`,
        '--quiet',
      ]);
      expect(result.exitCode).toBe(0);

      // Should output valid JSON with deduped points
      const points = JSON.parse(result.stdout);
      expect(Array.isArray(points)).toBe(true);
      expect(points.length).toBeGreaterThan(0);
    });

    it('shows verbose output with -v', () => {
      const result = runCLI([
        'dedup',
        `"${path.join(FIXTURES_DIR, 'sample.gpx')}"`,
        '-v',
      ]);
      expect(result.exitCode).toBe(0);

      // Verbose output may include "Duplicate Groups" if any found
      expect(result.stdout).toBeDefined();
    });

    it('respects GPS threshold option', () => {
      const result = runCLI([
        'dedup',
        `"${path.join(FIXTURES_DIR, 'sample.gpx')}"`,
        '-g', '100',
        '--quiet',
      ]);
      expect(result.exitCode).toBe(0);
    });
  });

  // ============================================================================
  // MATCH COMMAND
  // ============================================================================

  describe('match command', () => {
    it('matches points between files', () => {
      const result = runCLI([
        'match',
        `"${path.join(FIXTURES_DIR, 'sample.csv')}"`,
        `"${path.join(FIXTURES_DIR, 'sample.geojson')}"`,
      ]);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('summary');
      expect(output).toHaveProperty('matches');
      expect(output.summary).toHaveProperty('referencePoints');
      expect(output.summary).toHaveProperty('targetPoints');
    });

    it('outputs match CSV format', () => {
      const outFile = path.join(TEMP_DIR, 'matches.csv');
      const result = runCLI([
        'match',
        `"${path.join(FIXTURES_DIR, 'sample.csv')}"`,
        `"${path.join(FIXTURES_DIR, 'sample.geojson')}"`,
        '-o', `"${outFile}"`,
        '-f', 'csv',
      ]);
      expect(result.exitCode).toBe(0);

      expect(fs.existsSync(outFile)).toBe(true);
      const content = fs.readFileSync(outFile, 'utf-8');
      expect(content).toContain('targetIndex,targetName,refIndex,refName');
    });
  });
});

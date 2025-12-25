# mapsh-pit Developer Guide

GPS waypoint parsing, fuzzy matching, and deduplication CLI tool.

## Project Structure

```
mapsh-pit/
├── src/
│   ├── cli.ts              # CLI entry point + commands
│   ├── parser.ts           # KML, KMZ, GPX, GeoJSON, CSV parsing
│   ├── dedup.ts            # Union-Find clustering with safeguards
│   ├── jaro-winkler.ts     # String similarity + 280 alias expansions
│   ├── token-set-ratio.ts  # Word-order independent matching
│   ├── geo-utils.ts        # Haversine distance, US state lookup
│   ├── auto-sync.ts        # repo-depot auto-sync on startup
│   └── index.ts            # Public API exports
├── tests/
│   ├── cli.test.ts         # CLI integration tests (27 tests)
│   ├── parser.test.ts      # Parser unit tests (37 tests)
│   ├── dedup.test.ts       # Deduplication tests (21 tests)
│   ├── jaro-winkler.test.ts # Similarity tests (36 tests)
│   ├── token-set-ratio.test.ts # Token matching (42 tests)
│   ├── geo-utils.test.ts   # Geo utilities (17 tests)
│   └── fixtures/           # Test data files
├── scripts/
│   └── sync-depot.sh       # Manual repo-depot sync
├── bin/
│   └── mapsh-pit.js        # CLI entry shim
├── CLAUDE.md               # Universal standards (synced from repo-depot)
├── techguide.md            # This file - project-specific docs
├── .depot-version          # Tracks synced repo-depot version
└── dist/                   # Compiled TypeScript output
```

## Commands

```bash
# Build
pnpm build

# Run tests (watch mode)
pnpm test

# Run tests once (CI)
pnpm test:run

# Dev mode (tsx, no build)
pnpm dev parse file.kml

# Production mode
node dist/cli.js parse file.kml

# Sync from repo-depot
pnpm sync
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `parse <files...>` | Parse map files, output points |
| `dedup <files...>` | Find and merge duplicates |
| `compare <n1> <n2>` | Compare two location names |
| `stats <files...>` | Show file/point statistics |
| `merge <files...>` | Combine files without dedup |
| `match <ref> <target>` | Match target against reference |

## Key Algorithms

### 1. Token Set Ratio
Word-order independent matching. Handles:
- "Union Station - Lockport" ↔ "Lockport Union Train Station"

### 2. Jaro-Winkler + Alias Expansion
280+ abbreviation expansions:
- PRR → Pennsylvania Railroad
- GE → General Electric
- St. → Saint

### 3. Union-Find Clustering
GPS-based deduplication with safeguards:
- Max cluster size (default: 20)
- Max diameter (default: 500m)
- Min confidence (default: 60%)

### 4. Blocking Word Detection
Prevents false matches:
- North ↔ South (directions)
- Old ↔ New (temporal)
- Building A ↔ Building B (identifiers)

### 5. Generic Name Handling
Stricter GPS threshold (25m) for:
- House, Church, Factory, School, etc.

## Export Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| json | `.json` | Raw point array |
| geojson | `.geojson` | GeoJSON FeatureCollection |
| kml | `.kml` | Google Earth format |
| gpx | `.gpx` | GPS Exchange format |
| csv | `.csv` | Comma-separated |
| table | stdout | Human-readable |

## Gotchas

1. **KMZ files** - ZIP archives containing KML, uses `unzipper`
2. **CSV delimiter** - Auto-detected (comma, tab, semicolon, pipe)
3. **LineString/Polygon** - Uses first point or centroid
4. **Generic names** - Require stricter GPS threshold
5. **Blocking words** - Prevent matching even with high similarity

## Testing

180 tests covering:
- Haversine distance calculations
- Jaro-Winkler similarity scores
- Token Set Ratio algorithm
- Blocking conflict detection
- Deduplication clustering
- All parsers (KML, GPX, GeoJSON, CSV)
- CLI integration tests

Run tests:
```bash
pnpm test:run
```

## repo-depot Integration

Auto-syncs on CLI startup:
- Checks once per hour (rate-limited)
- Syncs CLAUDE.md + skills from repo-depot
- Cache: `~/.cache/repo-depot/`

Manual sync:
```bash
./scripts/sync-depot.sh
./scripts/sync-depot.sh --check
./scripts/sync-depot.sh --force
```

## Public API

```typescript
import {
  // Parsing
  parseMapFile,
  parseMapFiles,
  mergeParseResults,

  // Deduplication
  deduplicatePoints,
  generateDedupedPoints,
  checkDuplicate,

  // String similarity
  jaroWinklerSimilarity,
  normalizedSimilarity,
  normalizeName,
  isSmartMatch,
  tokenSetRatio,
  checkBlockingConflict,
  isGenericName,

  // Geo utilities
  haversineDistance,
  isWithinRadius,
  getBoundingBox,
  getUSStateFromCoords,

  // Auto-sync
  autoSync,
  autoSyncWithMessage,
} from 'mapsh-pit';
```

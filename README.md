# mapsh-pit

GPS waypoint parsing, fuzzy matching, and deduplication CLI tool.

Designed for urban exploration and abandoned location research where location data comes from multiple sources with inconsistent naming.

## Features

- **Multi-format parsing**: KML, KMZ, GPX, GeoJSON, CSV
- **Fuzzy name matching**: Token Set Ratio + Jaro-Winkler with 280+ alias expansions
- **Smart deduplication**: Union-Find clustering with GPS proximity and name similarity
- **Blocking word detection**: Prevents false matches (North Factory ≠ South Factory)
- **Generic name handling**: Requires GPS verification for "House", "Church", "Factory"
- **Multi-signal scoring**: Combines GPS (40%) + Name (35%) + State (25%)

## Installation

```bash
npm install -g mapsh-pit
# or
pnpm add -g mapsh-pit
```

## Quick Start

```bash
# Parse a KML file
mapsh-pit parse saved-places.kml -o points.json

# Deduplicate multiple map files
mapsh-pit dedup *.kml *.gpx -o deduped.geojson -f geojson

# Compare two location names
mapsh-pit compare "PRR Station" "Pennsylvania Railroad Depot"
```

## Commands

### `parse` - Parse Map Files

Extract points from map files and output in various formats.

```bash
mapsh-pit parse <files...> [options]

Options:
  -o, --output <file>    Output file (defaults to stdout)
  -f, --format <format>  Output format: json, geojson, csv, table (default: json)
  -q, --quiet            Suppress progress output
```

**Examples:**

```bash
# Parse single file
mapsh-pit parse places.kml

# Parse multiple files, output as GeoJSON
mapsh-pit parse *.kml *.gpx -f geojson -o combined.geojson

# Parse and view as table
mapsh-pit parse places.gpx -f table
```

### `dedup` - Deduplicate Points

Find and merge duplicate points based on GPS proximity and name similarity.

```bash
mapsh-pit dedup <files...> [options]

Options:
  -o, --output <file>           Output file (defaults to stdout)
  -f, --format <format>         Output format: json, geojson, kml, gpx, csv, table (default: json)
  -g, --gps-threshold <m>       GPS distance threshold in meters (default: 50)
  -n, --name-threshold <0-1>    Name similarity threshold (default: 0.85)
  --require-gps                 Require GPS match for duplicates
  --no-smart-match              Disable word-overlap boost
  --max-cluster-size <count>    Max points per cluster (default: 20)
  --max-diameter <meters>       Max cluster diameter (default: 500)
  --min-confidence <0-100>      Min confidence to merge (default: 60)
  --dry-run                     Preview what would be merged
  -v, --verbose                 Show detailed match information
  -q, --quiet                   Suppress progress output
```

**Examples:**

```bash
# Basic deduplication
mapsh-pit dedup maps/*.kml -o deduped.json

# Strict GPS matching (25m)
mapsh-pit dedup *.kml -g 25 -o strict.geojson

# Require GPS match, verbose output
mapsh-pit dedup *.kml --require-gps -v

# Output as GeoJSON for mapping
mapsh-pit dedup *.kml -f geojson -o locations.geojson
```

### `compare` - Compare Two Names

Analyze similarity between two location names with detailed breakdown.

```bash
mapsh-pit compare <name1> <name2> [options]

Options:
  -t, --threshold <0-1>  Similarity threshold (default: 0.85)
```

**Examples:**

```bash
# Compare abbreviated names
mapsh-pit compare "PRR Station" "Pennsylvania Railroad Depot"

# Compare reordered names
mapsh-pit compare "Union Station - Lockport" "Lockport Union Train Station"

# Check blocking conflict
mapsh-pit compare "North Factory" "South Factory"
```

**Sample Output:**

```
=== Name Comparison ===

Original 1:   "PRR Station"
Original 2:   "Pennsylvania Railroad Depot"
Normalized 1: "pennsylvania railroad station"
Normalized 2: "pennsylvania railroad depot"

=== Similarity Scores ===

Raw Jaro-Winkler:        45.2%
Normalized Jaro-Winkler: 89.7%
Token Set Ratio:         92.3%
Combined (max):          92.3%

=== Word Overlap ===

Exact word matches: pennsylvania, railroad
Overlap ratio:      50.0%
Should boost:       Yes

=== Result ===

Match: YES
```

### `match` - Match Against Reference

Find matches between a target file and a reference file.

```bash
mapsh-pit match <reference> <target> [options]

Options:
  -g, --gps-threshold <m>     GPS distance threshold (default: 50)
  -n, --name-threshold <0-1>  Name similarity threshold (default: 0.85)
  -o, --output <file>         Output matched pairs to file
  -f, --format <format>       Output format: json, csv (default: json)
```

**Example:**

```bash
# Match new discoveries against existing database
mapsh-pit match database.geojson new-finds.gpx -o matches.json
```

### `merge` - Merge Files

Combine multiple map files without deduplication.

```bash
mapsh-pit merge <files...> [options]

Options:
  -o, --output <file>   Output file (required)
  -f, --format <format> Output format: json, geojson, csv (default: geojson)
  -q, --quiet           Suppress progress output
```

**Example:**

```bash
mapsh-pit merge *.kml *.gpx -o all-points.geojson
```

### `stats` - Show Statistics

Analyze map files and show statistics.

```bash
mapsh-pit stats <files...> [options]

Options:
  --alias-stats  Show alias dictionary statistics
```

**Example:**

```bash
mapsh-pit stats *.kml --alias-stats
```

**Sample Output:**

```
=== File Statistics ===

Files processed: 5
Files succeeded: 5
Files failed:    0

=== Point Statistics ===

Total points:    342

Points by format:
  KML: 280
  GPX: 62

Metadata coverage:
  With name:        340 (99.4%)
  With description: 156 (45.6%)
  With state:       89 (26.0%)
  Generic names:    23 (6.7%)

=== Alias Dictionary ===

Multi-word aliases:      98
Single-word aliases:     167
Period abbreviations:    15
Total expansions:        280
```

## Supported Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| KML | `.kml` | Full Placemark support, ExtendedData extraction |
| KMZ | `.kmz` | Automatically extracts KML from ZIP |
| GPX | `.gpx` | Waypoints, tracks (first point), routes |
| GeoJSON | `.geojson`, `.json` | Point, MultiPoint, LineString, Polygon |
| CSV | `.csv` | Auto-detects lat/lng columns |

## Algorithm Deep Dive

### Token Set Ratio

Word-order independent matching that handles name variations:

```
"Union Station - Lockport" vs "Lockport Union Train Station"

1. Tokenize: [union, station, lockport] vs [lockport, union, train, station]
2. Intersection: [lockport, station, union]
3. Remainders: [] vs [train]
4. Compare sorted strings → 95%+ match
```

### Alias Expansion

280+ expansions normalize abbreviations:

| Abbreviation | Expansion |
|--------------|-----------|
| PRR | Pennsylvania Railroad |
| GE | General Electric |
| Chevy | Chevrolet |
| TB Hospital | Tuberculosis Sanatorium |
| St. | Saint |

### Blocking Words

Prevents false matches when direction/temporal/numbered words differ:

- `North Factory` ≠ `South Factory`
- `Old Mill` ≠ `New Mill`
- `Building A` ≠ `Building B`
- `First National Bank` ≠ `Second National Bank`

### Word-Overlap Boost

When names share exact words, the similarity threshold is lowered by 10%:

```
"Chevy Biscayne" vs "Chevrolet Biscayne"
- Normalized similarity: 86%
- Standard threshold: 85% → NO MATCH
- With word overlap (share "biscayne"): 75% threshold → MATCH
```

## Programmatic API

```typescript
import {
  parseMapFile,
  deduplicatePoints,
  jaroWinklerSimilarity,
  tokenSetRatio,
  normalizeName,
  isSmartMatch,
  haversineDistance,
} from 'mapsh-pit';

// Parse files
const result = await parseMapFile('places.kml');
console.log(`Parsed ${result.points.length} points`);

// Deduplicate
const deduped = deduplicatePoints(result.points);
console.log(`Reduced from ${deduped.originalCount} to ${deduped.dedupedCount}`);

// Compare names
const score = jaroWinklerSimilarity('Union Station', 'Union Depot');
console.log(`Similarity: ${(score * 100).toFixed(1)}%`);

// Token Set Ratio for reordered names
const tsr = tokenSetRatio('Union Station Lockport', 'Lockport Union Train');
console.log(`Token Set Ratio: ${(tsr * 100).toFixed(1)}%`);

// Smart match with word-overlap boost
if (isSmartMatch('Chevy Plant', 'Chevrolet Factory')) {
  console.log('These are the same location!');
}

// Calculate distance
const meters = haversineDistance(43.0, -77.0, 43.001, -77.001);
console.log(`Distance: ${meters.toFixed(0)} meters`);
```

## Configuration

Default thresholds:

| Setting | Default | Description |
|---------|---------|-------------|
| GPS threshold | 50m | Max distance for GPS match |
| Name threshold | 0.85 | Min similarity for name match |
| Generic GPS threshold | 25m | Stricter GPS for generic names |
| Word-overlap boost | 0.10 | Threshold reduction for word overlap |

## Auto-Sync from repo-depot

mapsh-pit automatically syncs development standards from [repo-depot](https://github.com/bizzlechizzle/repo-depot) on every CLI run:

- **CLAUDE.md** - Universal development standards
- **Skills** - Claude Code skills (9 skills)
- **Version tracking** - `.depot-version` file

Sync is rate-limited to once per hour. Force manual sync:

```bash
./scripts/sync-depot.sh          # Sync now
./scripts/sync-depot.sh --check  # Check version
./scripts/sync-depot.sh --force  # Force re-sync
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run tests once (CI mode)
pnpm test:run

# Dev mode (no build required)
pnpm dev parse test.kml

# Sync from repo-depot
pnpm sync
```

## Project Structure

```
mapsh-pit/
├── src/
│   ├── cli.ts              # CLI commands
│   ├── parser.ts           # KML, KMZ, GPX, GeoJSON, CSV parsing
│   ├── dedup.ts            # Union-Find clustering
│   ├── jaro-winkler.ts     # String similarity (280+ aliases)
│   ├── token-set-ratio.ts  # Word-order independent matching
│   ├── geo-utils.ts        # Haversine, US state lookup
│   ├── auto-sync.ts        # repo-depot auto-sync
│   └── index.ts            # Public API exports
├── tests/                  # 180 tests
├── scripts/
│   └── sync-depot.sh       # Manual sync script
├── CLAUDE.md               # Universal standards (from repo-depot)
├── techguide.md            # Project-specific guide
└── .depot-version          # Synced repo-depot version
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Make changes and add tests
4. Run `pnpm test:run` to verify
5. Commit with conventional commits
6. Push and open a PR

## Links

- [GitHub Repository](https://github.com/bizzlechizzle/mapsh-pit)
- [Issues](https://github.com/bizzlechizzle/mapsh-pit/issues)
- [repo-depot](https://github.com/bizzlechizzle/repo-depot) - Development standards

## License

MIT - see [LICENSE](LICENSE)

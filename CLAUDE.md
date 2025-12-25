# mapsh-pit

GPS waypoint parsing, fuzzy matching, and deduplication CLI tool.

## Structure

```
mapsh-pit/
├── src/
│   ├── cli.ts           # CLI commands (parse, dedup, compare, stats, merge, match)
│   ├── parser.ts        # KML, KMZ, GPX, GeoJSON, CSV parsing
│   ├── dedup.ts         # Union-Find clustering with safeguards
│   ├── jaro-winkler.ts  # String similarity with 280+ alias expansions
│   ├── token-set-ratio.ts # Word-order independent matching
│   ├── geo-utils.ts     # Haversine distance, US state lookup
│   └── index.ts         # Public API exports
├── tests/
│   ├── cli.test.ts      # CLI integration tests
│   ├── parser.test.ts   # Parser unit tests
│   ├── dedup.test.ts    # Deduplication tests
│   ├── jaro-winkler.test.ts
│   ├── token-set-ratio.test.ts
│   ├── geo-utils.test.ts
│   └── fixtures/        # Test data files
├── bin/
│   └── mapsh-pit.js     # CLI entry point
└── dist/                # Compiled output
```

## Commands

```bash
# Build
pnpm build

# Run tests
pnpm test

# Dev mode (tsx)
pnpm dev parse file.kml

# After build
node dist/cli.js parse file.kml
```

## CLI Usage

```bash
# Parse map files
mapsh-pit parse file.kml file.gpx -o output.json
mapsh-pit parse *.kmz -f kml -o combined.kml

# Deduplicate with safeguards
mapsh-pit dedup *.kml -o deduped.geojson -f geojson
mapsh-pit dedup *.kml --max-cluster-size 10 --max-diameter 200
mapsh-pit dedup *.kml --dry-run  # Preview mode

# Compare two names
mapsh-pit compare "Union Station" "Station Union"

# Show statistics
mapsh-pit stats *.kml --alias-stats

# Merge without dedup
mapsh-pit merge *.kml -o merged.geojson

# Match against reference
mapsh-pit match reference.kml target.gpx --min-confidence 70
```

## Key Algorithms

1. **Token Set Ratio** - Word-order independent matching
2. **Jaro-Winkler with Normalization** - Character-level with alias expansion
3. **Union-Find Clustering** - GPS-based deduplication with safeguards
4. **Blocking Word Detection** - Prevents North/South false matches
5. **US State Lookup** - Auto-detects state from GPS coordinates

## Dedup Safeguards

Prevents over-clustering:
- `--max-cluster-size <n>` - Max points per cluster (default: 20)
- `--max-diameter <meters>` - Max geographic spread (default: 500m)
- `--min-confidence <0-100>` - Min match confidence (default: 60)
- `--dry-run` - Preview mode

## Export Formats

- `json` - Raw point array
- `geojson` - GeoJSON FeatureCollection
- `kml` - Google Earth KML
- `gpx` - GPS Exchange Format
- `csv` - Comma-separated values
- `table` - Human-readable table

## Testing

All tests use Vitest. Run with `pnpm test`.

Coverage areas:
- Haversine distance calculations
- Jaro-Winkler similarity scores
- Token Set Ratio algorithm
- Blocking conflict detection
- Deduplication clustering
- Parser (KML, GPX, GeoJSON, CSV)
- CLI integration tests

## Gotchas

- KMZ files are ZIP archives containing KML - uses unzipper
- CSV delimiter is auto-detected (comma, tab, semicolon, pipe)
- LineString/Polygon features use first point or centroid
- Generic names (House, Church) require stricter GPS (25m)

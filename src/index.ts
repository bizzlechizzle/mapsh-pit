/**
 * mapcombine - GPS waypoint parsing, fuzzy matching, and deduplication
 *
 * @packageDocumentation
 */

// ============================================================================
// GEO UTILITIES
// ============================================================================

export {
  haversineDistance,
  isWithinRadius,
  getBoundingBox,
  calculateCentroid,
  isValidCoordinate,
} from './geo-utils.js';

// ============================================================================
// JARO-WINKLER STRING SIMILARITY
// ============================================================================

export {
  DEFAULT_CONFIG,
  jaroWinklerSimilarity,
  isMatch,
  findBestMatches,
  normalizeName,
  calculateWordOverlap,
  getAdjustedThreshold,
  normalizedSimilarity,
  isSmartMatch,
  getMatchDetails,
  getAliasDictionaryStats,
} from './jaro-winkler.js';

// ============================================================================
// TOKEN SET RATIO
// ============================================================================

export {
  GENERIC_NAMES,
  BLOCKING_WORDS,
  IDENTIFIER_PATTERNS,
  SUGGESTION_GENERIC_WORDS,
  SUGGESTION_REGION_WORDS,
  tokenize,
  sortedTokenString,
  tokenSortRatio,
  tokenSetRatio,
  partialTokenRatio,
  extractBlockingWords,
  checkBlockingConflict,
  isGenericName,
  isSuggestionFiltered,
  calculateMultiSignalMatch,
  combinedFuzzyMatch,
} from './token-set-ratio.js';

// ============================================================================
// PARSER
// ============================================================================

export {
  type ParsedMapPoint,
  type ParsedMapResult,
  type SupportedFormat,
  getFileType,
  getSupportedExtensions,
  parseMapFile,
  parseMapFiles,
  mergeParseResults,
} from './parser.js';

// ============================================================================
// DEDUPLICATION
// ============================================================================

export {
  type DedupConfig,
  DEFAULT_DEDUP_CONFIG,
  type MatchResult,
  type DuplicateGroup,
  type DedupResult,
  type DedupedPoint,
  checkDuplicate,
  findDuplicateGroups,
  deduplicatePoints,
  generateDedupedPoints,
} from './dedup.js';

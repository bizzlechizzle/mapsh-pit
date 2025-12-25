/**
 * Jaro-Winkler String Similarity Service
 *
 * Implements the Jaro-Winkler distance algorithm for fuzzy string matching.
 * Used for matching user-entered location names against reference map points.
 *
 * Algorithm:
 * 1. Jaro similarity considers matching characters and transpositions
 * 2. Winkler modification boosts score for strings with common prefixes
 * 3. Word-overlap boost lowers threshold when names share exact words
 *
 * Features:
 * - Comprehensive alias dictionary (~280 expansions)
 * - Word-overlap boost for smarter matching
 * - Handles abandoned location naming patterns
 */

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_CONFIG = {
  NAME_SIMILARITY_THRESHOLD: 0.85,
  WORD_OVERLAP_BOOST: 0.10,
  MIN_BOOSTED_THRESHOLD: 0.70,
};

// =============================================================================
// COMPREHENSIVE ALIAS DICTIONARY
// Organized by category for maintainability
// =============================================================================

/**
 * Multi-word aliases that must be processed first (longer patterns)
 * Format: [pattern, replacement]
 */
const MULTI_WORD_ALIASES: [string, string][] = [
  // Medical/Care - multi-word
  ['tb hospital', 'tuberculosis sanatorium'],
  ['tb san', 'tuberculosis sanatorium'],
  ['insane asylum', 'mental hospital'],
  ['lunatic asylum', 'mental hospital'],
  ['state hospital', 'state psychiatric hospital'],
  ['poor house', 'poorhouse'],
  ['alms house', 'almshouse'],
  ['childrens home', 'childrens home'],
  // Educational - multi-word
  ['high school', 'high school'],
  ['jr high', 'junior high school'],
  ['middle school', 'middle school'],
  ['vocational school', 'vocational school'],
  ['elementary school', 'elementary school'],
  // Commercial - multi-word
  ['post office', 'post office'],
  ['court house', 'courthouse'],
  ['opera house', 'opera house'],
  ['fair grounds', 'fairgrounds'],
  ['race track', 'racetrack'],
  ['stock yards', 'stockyards'],
  // Corporate - multi-word
  ['general electric', 'general electric'],
  ['general motors', 'general motors'],
  ['radio corporation america', 'radio corporation america'],
  ['international business machines', 'international business machines'],
  ['american telephone telegraph', 'american telephone telegraph'],
  ['bell telephone', 'bell telephone'],
  ['western electric', 'western electric'],
  ['union carbide', 'union carbide'],
  ['bethlehem steel', 'bethlehem steel'],
  ['us steel', 'united states steel'],
  ['united states steel', 'united states steel'],
  ['eastman kodak', 'eastman kodak'],
  ['dow chemical', 'dow chemical'],
  ['goodyear tire', 'goodyear tire'],
  ['firestone tire', 'firestone tire'],
  ['goodrich tire', 'goodrich tire'],
  ['champion spark plug', 'champion spark plug'],
  ['ac spark plug', 'ac spark plug'],
  ['delco electronics', 'delco electronics'],
  ['fisher body', 'fisher body'],
  // Railroad - multi-word
  ['pennsylvania railroad', 'pennsylvania railroad'],
  ['new york central', 'new york central'],
  ['baltimore ohio', 'baltimore ohio'],
  ['erie railroad', 'erie railroad'],
  ['delaware lackawanna', 'delaware lackawanna'],
  ['lehigh valley', 'lehigh valley'],
  ['reading railroad', 'reading railroad'],
  ['southern railway', 'southern railway'],
  ['northern pacific', 'northern pacific'],
  ['southern pacific', 'southern pacific'],
  ['union pacific', 'union pacific'],
  ['santa fe', 'santa fe'],
  ['burlington railroad', 'burlington railroad'],
  ['milwaukee road', 'milwaukee road'],
  ['great northern', 'great northern'],
  ['canadian pacific', 'canadian pacific'],
  ['canadian national', 'canadian national'],
  // Automotive - multi-word
  ['ford motor', 'ford motor'],
  ['general motors truck', 'general motors truck'],
  ['american motors', 'american motors'],
  ['hudson motor', 'hudson motor'],
  ['nash motors', 'nash motors'],
  ['kaiser motors', 'kaiser motors'],
  ['willys overland', 'willys overland'],
  // Military - multi-word
  ['air force base', 'air force base'],
  ['naval air station', 'naval air station'],
  ['army base', 'army base'],
  ['national guard armory', 'national guard armory'],
  // Utilities - multi-word
  ['power plant', 'power plant'],
  ['power house', 'powerhouse'],
  ['generating station', 'generating station'],
  ['pumping station', 'pumping station'],
  ['water works', 'waterworks'],
  ['sewage treatment plant', 'sewage treatment plant'],
  ['gas works', 'gasworks'],
  // Other
  ['grain elevator', 'grain elevator'],
  ['freight depot', 'freight depot'],
  ['packing plant', 'packing plant'],
  ['canning factory', 'canning factory'],
  ['textile mill', 'textile mill'],
  ['cotton mill', 'cotton mill'],
  ['woolen mill', 'woolen mill'],
  ['paper mill', 'paper mill'],
  ['lumber mill', 'lumber mill'],
  ['iron foundry', 'iron foundry'],
  ['coal mine', 'coal mine'],
  ['coal breaker', 'coal breaker'],
  ['mine tipple', 'mine tipple'],
  ['mine shaft', 'mine shaft'],
  ['stone quarry', 'stone quarry'],
  ['gravel pit', 'gravel pit'],
  ['dairy farm', 'dairy farm'],
  ['grange hall', 'grange hall'],
  ['swimming pool', 'swimming pool'],
  ['county jail', 'county jail'],
  ['state prison', 'state prison'],
  ['medical center', 'medical center'],
  ['nursing home', 'nursing home'],
  ['orphan asylum', 'orphan asylum'],
];

/**
 * Single-word aliases - processed after multi-word
 * Format: abbreviation -> expansion
 */
const SINGLE_WORD_ALIASES: Record<string, string> = {
  // Building Types - Educational
  'elem': 'elementary',
  'hs': 'high school',
  'highschool': 'high school',
  'jhs': 'junior high',
  'ms': 'middle school',
  'univ': 'university',
  'coll': 'college',
  'acad': 'academy',
  'inst': 'institute',
  'sem': 'seminary',
  'voc': 'vocational',
  'tech': 'technical',

  // Building Types - Medical/Care
  'hosp': 'hospital',
  'san': 'sanatorium',
  'sanat': 'sanatorium',
  'psych': 'psychiatric',
  'infirm': 'infirmary',
  'med': 'medical',
  'ctr': 'center',
  'cntr': 'center',
  'rehab': 'rehabilitation',
  'nrsg': 'nursing',
  'poorhouse': 'poorhouse',
  'almshouse': 'almshouse',
  'orphanage': 'orphan asylum',

  // Building Types - Industrial
  'mfg': 'manufacturing',
  'fac': 'factory',
  'fact': 'factory',
  'plt': 'plant',
  'plnt': 'plant',
  'wks': 'works',
  'wrks': 'works',
  'fdry': 'foundry',
  'foundry': 'foundry',
  'mill': 'mill',
  'furn': 'furnace',
  'smelt': 'smelter',
  'ref': 'refinery',
  'refin': 'refinery',
  'distill': 'distillery',
  'brew': 'brewery',
  'packing': 'packing',
  'cannery': 'canning factory',
  'textile': 'textile',
  'cotton': 'cotton',
  'woolen': 'woolen',
  'paper': 'paper',
  'lumber': 'lumber',
  'saw': 'sawmill',
  'sawmill': 'sawmill',
  'grain': 'grain',
  'elev': 'elevator',
  'warehouse': 'warehouse',
  'whse': 'warehouse',
  'depot': 'depot',

  // Building Types - Mining
  'mine': 'mine',
  'colliery': 'coal mine',
  'shaft': 'shaft',
  'breaker': 'breaker',
  'tipple': 'tipple',
  'quarry': 'quarry',
  'pit': 'pit',

  // Building Types - Power/Utilities
  'pwr': 'power',
  'power': 'power',
  'powerhouse': 'powerhouse',
  'gen': 'generating',
  'elec': 'electric',
  'hydro': 'hydroelectric',
  'sub': 'substation',
  'substa': 'substation',
  'pump': 'pumping',
  'wtr': 'water',
  'wwtp': 'sewage treatment',
  'sewage': 'sewage',
  'gas': 'gas',

  // Building Types - Religious
  'ch': 'church',
  'chur': 'church',
  'cath': 'catholic',
  'meth': 'methodist',
  'presb': 'presbyterian',
  'bapt': 'baptist',
  'luth': 'lutheran',
  'episc': 'episcopal',
  'cong': 'congregational',
  'syn': 'synagogue',
  'cem': 'cemetery',
  'cemy': 'cemetery',
  'mem': 'memorial',
  'chap': 'chapel',
  'par': 'parish',

  // Building Types - Commercial/Civic
  'dept': 'department',
  'store': 'store',
  'htl': 'hotel',
  'hotel': 'hotel',
  'inn': 'inn',
  'thtr': 'theater',
  'theater': 'theater',
  'theatre': 'theater',
  'opera': 'opera',
  'hall': 'hall',
  'aud': 'auditorium',
  'lib': 'library',
  'museum': 'museum',
  'mus': 'museum',
  'ct': 'court',
  'crt': 'court',
  'courthouse': 'courthouse',
  'jail': 'jail',
  'prison': 'prison',
  'pen': 'penitentiary',
  'armory': 'armory',
  'po': 'post office',
  'stn': 'station',
  'sta': 'station',
  'term': 'terminal',

  // Building Types - Recreation
  'pk': 'park',
  'park': 'park',
  'pool': 'pool',
  'stadium': 'stadium',
  'arena': 'arena',
  'fairgrounds': 'fairgrounds',
  'race': 'race',
  'racetrack': 'racetrack',
  'casino': 'casino',
  'resort': 'resort',
  'camp': 'camp',
  'lodge': 'lodge',

  // Building Types - Agricultural
  'barn': 'barn',
  'silo': 'silo',
  'dairy': 'dairy',
  'farm': 'farm',
  'ranch': 'ranch',
  'grange': 'grange',
  'creamery': 'creamery',
  'stockyard': 'stockyards',
  'stockyards': 'stockyards',
  'slaughter': 'slaughterhouse',
  'slaughterhouse': 'slaughterhouse',

  // Building Types - Military
  'afb': 'air force base',
  'nas': 'naval air station',
  'army': 'army',
  'ft': 'fort',
  'fort': 'fort',
  'arsenal': 'arsenal',
  'barracks': 'barracks',

  // Automotive Brands
  'chevy': 'chevrolet',
  'chev': 'chevrolet',
  'chevrolet': 'chevrolet',
  'cad': 'cadillac',
  'caddy': 'cadillac',
  'cadillac': 'cadillac',
  'olds': 'oldsmobile',
  'oldsmobile': 'oldsmobile',
  'pont': 'pontiac',
  'pontiac': 'pontiac',
  'buick': 'buick',
  'gmc': 'general motors truck',
  'ford': 'ford',
  'merc': 'mercury',
  'mercury': 'mercury',
  'linc': 'lincoln',
  'lincoln': 'lincoln',
  'chrys': 'chrysler',
  'chrysler': 'chrysler',
  'plym': 'plymouth',
  'plymouth': 'plymouth',
  'dodge': 'dodge',
  'jeep': 'jeep',
  'amc': 'american motors',
  'stude': 'studebaker',
  'studebaker': 'studebaker',
  'pack': 'packard',
  'packard': 'packard',
  'hudson': 'hudson',
  'nash': 'nash',
  'kaiser': 'kaiser',
  'willys': 'willys',

  // Corporate/Manufacturing Brands
  'ge': 'general electric',
  'gm': 'general motors',
  'rca': 'radio corporation america',
  'ibm': 'international business machines',
  'att': 'american telephone telegraph',
  'at&t': 'american telephone telegraph',
  'bell': 'bell telephone',
  'westinghouse': 'westinghouse',
  'kodak': 'eastman kodak',
  'dupont': 'dupont',
  'dow': 'dow chemical',
  'bethlehem': 'bethlehem steel',
  'alcoa': 'aluminum company america',
  'goodyear': 'goodyear',
  'firestone': 'firestone',
  'bfg': 'goodrich',
  'champion': 'champion',
  'delco': 'delco',
  'fisher': 'fisher',

  // Railroad Abbreviations
  'rr': 'railroad',
  'ry': 'railway',
  'rwy': 'railway',
  'rrd': 'railroad',
  'penn': 'pennsylvania railroad',
  'prr': 'pennsylvania railroad',
  'nyc': 'new york central',
  'b&o': 'baltimore ohio',
  'bando': 'baltimore ohio',
  'erie': 'erie',
  'lackawanna': 'lackawanna',
  'lehigh': 'lehigh',
  'reading': 'reading',
  'sou': 'southern',
  'southern': 'southern',
  'np': 'northern pacific',
  'sp': 'southern pacific',
  'up': 'union pacific',
  'sf': 'santa fe',
  'atsf': 'santa fe',
  'cb&q': 'burlington',
  'burlington': 'burlington',
  'milw': 'milwaukee',
  'gn': 'great northern',
  'cpr': 'canadian pacific',
  'cnr': 'canadian national',

  // Compass/Direction
  'n': 'north',
  'no': 'north',
  's': 'south',
  'so': 'south',
  'e': 'east',
  'w': 'west',
  'ne': 'northeast',
  'nw': 'northwest',
  'se': 'southeast',
  'sw': 'southwest',

  // Common Abbreviations
  'bros': 'brothers',
  'corp': 'corporation',
  'inc': 'incorporated',
  'co': 'company',
  'ltd': 'limited',
  'assn': 'association',
  'assoc': 'association',
  'bldg': 'building',
  'hq': 'headquarters',
  'div': 'division',
  'natl': 'national',
  "nat'l": 'national',
  'intl': 'international',
  "int'l": 'international',
  'amer': 'american',
  'am': 'american',

  // Geographic/Place
  'mt': 'mount',
  'mtn': 'mountain',
  'lk': 'lake',
  'riv': 'river',
  'rvr': 'river',
  'ck': 'creek',
  'crk': 'creek',
  'spg': 'springs',
  'spgs': 'springs',
  'fls': 'falls',
  'falls': 'falls',
  'hts': 'heights',
  'jct': 'junction',
  'junc': 'junction',
  'xing': 'crossing',
  'pt': 'point',
  'hbr': 'harbor',
  'cty': 'county',
  'twp': 'township',
  'boro': 'borough',
  'vlg': 'village',

  // Street Types
  'ave': 'avenue',
  'blvd': 'boulevard',
  'rd': 'road',
  'dr': 'drive',
  'ln': 'lane',
  'pl': 'place',
  'cir': 'circle',
  'hwy': 'highway',
  'pkwy': 'parkway',
  'tpke': 'turnpike',
};

/**
 * Abbreviations that require a period
 */
const PERIOD_ABBREVIATIONS: [RegExp, string][] = [
  [/\bst\.\s*/gi, 'saint '],
  [/\bmt\.\s*/gi, 'mount '],
  [/\bhosp\.\s*/gi, 'hospital '],
  [/\bmfg\.\s*/gi, 'manufacturing '],
  [/\bco\.\s*/gi, 'company '],
  [/\bcorp\.\s*/gi, 'corporation '],
  [/\binc\.\s*/gi, 'incorporated '],
  [/\bave\.\s*/gi, 'avenue '],
  [/\bblvd\.\s*/gi, 'boulevard '],
  [/\brd\.\s*/gi, 'road '],
  [/\bbros\.\s*/gi, 'brothers '],
  [/\bdept\.\s*/gi, 'department '],
  [/\bdr\.\s*/gi, 'doctor '],
  [/\bjr\.\s*/gi, 'junior '],
  [/\bsr\.\s*/gi, 'senior '],
];

// =============================================================================
// CORE JARO-WINKLER FUNCTIONS
// =============================================================================

/**
 * Calculate Jaro similarity between two strings
 * Returns a value between 0 (no match) and 1 (exact match)
 */
function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  if (matchWindow < 0) return 0.0;

  const s1Matches: boolean[] = new Array(s1.length).fill(false);
  const s2Matches: boolean[] = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (
    matches / s1.length +
    matches / s2.length +
    (matches - transpositions / 2) / matches
  ) / 3;

  return jaro;
}

/**
 * Calculate common prefix length (max 4 characters)
 */
function commonPrefixLength(s1: string, s2: string): number {
  const maxPrefix = 4;
  let prefix = 0;

  for (let i = 0; i < Math.min(s1.length, s2.length, maxPrefix); i++) {
    if (s1[i] === s2[i]) {
      prefix++;
    } else {
      break;
    }
  }

  return prefix;
}

/**
 * Calculate Jaro-Winkler similarity between two strings
 *
 * @param s1 - First string
 * @param s2 - Second string
 * @param scalingFactor - Prefix scaling factor (default 0.1, max 0.25)
 * @returns Similarity score between 0 and 1
 */
export function jaroWinklerSimilarity(
  s1: string,
  s2: string,
  scalingFactor: number = 0.1
): number {
  const str1 = (s1 || '').toLowerCase().trim();
  const str2 = (s2 || '').toLowerCase().trim();

  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;

  const p = Math.min(Math.max(scalingFactor, 0), 0.25);
  const jaro = jaroSimilarity(str1, str2);
  const prefix = commonPrefixLength(str1, str2);
  const winkler = jaro + (prefix * p * (1 - jaro));

  return winkler;
}

/**
 * Check if two strings are similar above a threshold
 */
export function isMatch(
  s1: string,
  s2: string,
  threshold: number = DEFAULT_CONFIG.NAME_SIMILARITY_THRESHOLD
): boolean {
  return jaroWinklerSimilarity(s1, s2) >= threshold;
}

/**
 * Find best matches from a list of candidates
 */
export function findBestMatches(
  query: string,
  candidates: string[],
  threshold: number = DEFAULT_CONFIG.NAME_SIMILARITY_THRESHOLD,
  limit: number = 3
): Array<{ candidate: string; score: number; index: number }> {
  if (!query || !candidates || candidates.length === 0) {
    return [];
  }

  const matches: Array<{ candidate: string; score: number; index: number }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;

    const score = jaroWinklerSimilarity(query, candidate);
    if (score >= threshold) {
      matches.push({ candidate, score, index: i });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// =============================================================================
// NAME NORMALIZATION
// =============================================================================

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize a name for comparison
 *
 * Processing order:
 * 1. Lowercase and trim
 * 2. Strip leading articles (The, A, An)
 * 3. Expand period abbreviations (St. → saint)
 * 4. Expand multi-word aliases (tb hospital → tuberculosis sanatorium)
 * 5. Expand single-word aliases (chevy → chevrolet)
 * 6. Collapse multiple spaces
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  let normalized = name.toLowerCase().trim();

  // Strip leading articles
  normalized = normalized.replace(/^(the|a|an)\s+/i, '');

  // Expand period abbreviations first
  for (const [pattern, replacement] of PERIOD_ABBREVIATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Expand multi-word aliases (longer patterns first)
  const sortedMultiWord = [...MULTI_WORD_ALIASES].sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [pattern, replacement] of sortedMultiWord) {
    const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');
    normalized = normalized.replace(regex, replacement);
  }

  // Expand single-word aliases
  const words = normalized.split(/\s+/);
  const expandedWords = words.map(word => {
    const cleanWord = word.replace(/[.,;:!?]$/, '');
    const suffix = word.slice(cleanWord.length);
    const expansion = SINGLE_WORD_ALIASES[cleanWord];
    return expansion ? expansion + suffix : word;
  });
  normalized = expandedWords.join(' ');

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// =============================================================================
// WORD-OVERLAP BOOST
// =============================================================================

/**
 * Calculate word overlap between two normalized names
 */
export function calculateWordOverlap(name1: string, name2: string): {
  exactMatches: string[];
  overlapRatio: number;
  totalUniqueWords: number;
  shouldBoost: boolean;
} {
  if (!name1 || !name2) {
    return { exactMatches: [], overlapRatio: 0, totalUniqueWords: 0, shouldBoost: false };
  }

  const words1 = new Set(name1.split(/\s+/).filter(w => w.length >= 2));
  const words2 = new Set(name2.split(/\s+/).filter(w => w.length >= 2));

  const exactMatches: string[] = [];
  for (const word of words1) {
    if (words2.has(word)) {
      exactMatches.push(word);
    }
  }

  const allWords = new Set([...words1, ...words2]);
  const totalUniqueWords = allWords.size;
  const overlapRatio = totalUniqueWords > 0
    ? exactMatches.length / totalUniqueWords
    : 0;

  const shouldBoost = exactMatches.length >= 1 && overlapRatio >= 0.25;

  return {
    exactMatches,
    overlapRatio,
    totalUniqueWords,
    shouldBoost,
  };
}

/**
 * Get the adjusted threshold based on word overlap
 */
export function getAdjustedThreshold(
  name1: string,
  name2: string,
  baseThreshold: number = DEFAULT_CONFIG.NAME_SIMILARITY_THRESHOLD
): number {
  const normalized1 = normalizeName(name1);
  const normalized2 = normalizeName(name2);

  const overlap = calculateWordOverlap(normalized1, normalized2);

  if (overlap.shouldBoost) {
    return Math.max(
      baseThreshold - DEFAULT_CONFIG.WORD_OVERLAP_BOOST,
      DEFAULT_CONFIG.MIN_BOOSTED_THRESHOLD
    );
  }

  return baseThreshold;
}

// =============================================================================
// ENHANCED SIMILARITY FUNCTIONS
// =============================================================================

/**
 * Compare two names with normalization applied
 */
export function normalizedSimilarity(name1: string, name2: string): number {
  return jaroWinklerSimilarity(normalizeName(name1), normalizeName(name2));
}

/**
 * Check if two names match using smart matching with word-overlap boost
 */
export function isSmartMatch(
  name1: string,
  name2: string,
  baseThreshold: number = DEFAULT_CONFIG.NAME_SIMILARITY_THRESHOLD
): boolean {
  const similarity = normalizedSimilarity(name1, name2);
  const adjustedThreshold = getAdjustedThreshold(name1, name2, baseThreshold);

  return similarity >= adjustedThreshold;
}

/**
 * Get detailed match information for debugging/UI
 */
export function getMatchDetails(
  name1: string,
  name2: string,
  baseThreshold: number = DEFAULT_CONFIG.NAME_SIMILARITY_THRESHOLD
): {
  name1Original: string;
  name2Original: string;
  name1Normalized: string;
  name2Normalized: string;
  rawSimilarity: number;
  normalizedSimilarity: number;
  wordOverlap: ReturnType<typeof calculateWordOverlap>;
  baseThreshold: number;
  adjustedThreshold: number;
  isMatch: boolean;
} {
  const normalized1 = normalizeName(name1);
  const normalized2 = normalizeName(name2);
  const rawSim = jaroWinklerSimilarity(name1, name2);
  const normSim = jaroWinklerSimilarity(normalized1, normalized2);
  const overlap = calculateWordOverlap(normalized1, normalized2);
  const adjustedThreshold = overlap.shouldBoost
    ? Math.max(baseThreshold - DEFAULT_CONFIG.WORD_OVERLAP_BOOST, DEFAULT_CONFIG.MIN_BOOSTED_THRESHOLD)
    : baseThreshold;

  return {
    name1Original: name1,
    name2Original: name2,
    name1Normalized: normalized1,
    name2Normalized: normalized2,
    rawSimilarity: rawSim,
    normalizedSimilarity: normSim,
    wordOverlap: overlap,
    baseThreshold,
    adjustedThreshold,
    isMatch: normSim >= adjustedThreshold,
  };
}

/**
 * Get the alias dictionary size (for stats)
 */
export function getAliasDictionaryStats(): {
  multiWord: number;
  singleWord: number;
  periodAbbreviations: number;
  total: number;
} {
  return {
    multiWord: MULTI_WORD_ALIASES.length,
    singleWord: Object.keys(SINGLE_WORD_ALIASES).length,
    periodAbbreviations: PERIOD_ABBREVIATIONS.length,
    total: MULTI_WORD_ALIASES.length + Object.keys(SINGLE_WORD_ALIASES).length + PERIOD_ABBREVIATIONS.length,
  };
}

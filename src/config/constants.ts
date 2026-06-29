/** MVP tuning constants from the design doc. */

export const PPR_ALPHA = 0.15;
export const PPR_MAX_ITERATIONS = 100;
export const PPR_TOLERANCE = 1e-6;

export const REQUEST_INTERVAL_MS = 2500;
export const REQUEST_JITTER_MS = 500;
export const MAX_FETCH_RETRIES = 3;

export const EXPANSION_BUDGET = 20;
export const MIN_FRONTIER_EXPECTED_INFO = 1e-5;

export const GLOBAL_MEDIAN_WORD_COUNT = 2500;
export const PRECISION_EPS = 1e-9;
export const TAG_FLUX_EPS = 1e-12;
export const TAG_PRIOR_FALLBACK_LOG = 0;
export const FRONTIER_EPSILON = 0.05;
export const TOP_RESULTS = 25;

export const MIN_SEEDS = 1;
export const MAX_SEEDS = 5;
export const MAX_NEGATIVE_SEEDS = 10;
export const NEGATIVE_SEED_WEIGHT = 1;

export const DB_NAME = 'ao3-search';
export const DB_VERSION = 5;

export const GRAPH_EXPORT_VERSION = 1;

/** AO3 official stats dump tag types that are not semantic work tags. */
export const STATS_SYSTEM_TAG_TYPES = new Set([
  'Rating',
  'Category',
  'ArchiveWarning',
  'Media',
]);

export const AO3_ORIGIN = 'https://archiveofourown.org';

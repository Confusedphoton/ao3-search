/** MVP tuning constants from the design doc. */

export const PPR_ALPHA = 0.15;
export const PPR_MAX_ITERATIONS = 100;
export const PPR_TOLERANCE = 1e-6;

export const REQUEST_INTERVAL_MS = 2500;
export const REQUEST_JITTER_MS = 500;
export const MAX_FETCH_RETRIES = 3;

export const EXPANSION_BUDGET = 20;
export const MIN_FRONTIER_EXPECTED_INFO = 1e-5;
/** Early-stop threshold for topological fragility acquisition. */
export const MIN_FRONTIER_FRAGILITY = 1e-8;
/** Stop when β₀/β₁ are unchanged for this many expansions and topology is trivial. */
export const TOPOLOGY_STABLE_ITERS = 2;
/** Max superlevel thresholds sampled for neighborhood extraction. */
export const TOPOLOGY_MAX_LEVELS = 32;
/** Hard cap on hypotheses in the refinement poset. */
export const TOPOLOGY_MAX_HYPOTHESES = 256;
/** Max boundary-alternate variants per superlevel component. */
export const TOPOLOGY_MAX_BOUNDARY_ALTS = 3;
/** Mild fragility boost for nodes incident to H₁-supporting hypotheses. */
export const TOPOLOGY_H1_FRAGILITY_BOOST = 1.25;

export const GLOBAL_MEDIAN_WORD_COUNT = 2500;
export const PRECISION_EPS = 1e-9;
export const TAG_FLUX_EPS = 1e-12;
export const TAG_PRIOR_FALLBACK_LOG = 0;
export const FRONTIER_EPSILON = 0.05;
/** When continuing search, explore more randomly to escape local ranking minima. */
export const CONTINUE_FRONTIER_EPSILON = 0.5;
export const TOP_RESULTS = 25;

export const MIN_SEEDS = 1;
export const MAX_SEEDS = 20;
export const MAX_NEGATIVE_SEEDS = 20;
/** Multiplier for negative-seed relevance when forming contrast score r⁺ − λ r⁻. */
export const NEGATIVE_RELEVANCE_LAMBDA = 3;

export const DB_NAME = 'ao3-search';
export const DB_VERSION = 6;

export const GRAPH_EXPORT_VERSION = 2;

/** Re-check complete tag/author hubs older than this for work-count growth. */
export const EXPLORATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** AO3 official stats dump tag types that are not semantic work tags. */
export const STATS_SYSTEM_TAG_TYPES = new Set([
  'Rating',
  'Category',
  'ArchiveWarning',
  'Media',
]);

export const AO3_ORIGIN = 'https://archiveofourown.org';

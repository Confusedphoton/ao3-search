import {
  syntheticGraph,
  type SyntheticAuthorInput,
  type SyntheticGraph,
  type SyntheticTagInput,
  type SyntheticWorkInput,
} from '../../tests/fixtures/syntheticGraph';
import {
  createObservedGraph,
  DEFAULT_MEASUREMENT_NOISE_SIGMA,
} from './measurementNoise';

export interface CorpusConfig {
  /** Number of thematic communities. */
  communities: number;
  /** Works per community. */
  worksPerCommunity: number;
  /** Local tags exclusive to each community. */
  localTagsPerCommunity: number;
  /** Shared bridge tags connecting all communities. */
  bridgeTags: number;
  /** Authors per community (each author links a subset of local works). */
  authorsPerCommunity: number;
  /** Extra cross-community works attached only to bridge tags. */
  bridgeWorks: number;
  /** RNG seed for reproducible corpora. */
  seed: number;
  /**
   * When true (default), `graph` is a noisy measurement of `latentGraph`.
   * Disable for noiseless oracle recovery experiments.
   */
  perturbMeasurement?: boolean;
  /** Log-normal σ for measurement noise when perturbation is on. */
  measurementNoiseSigma?: number;
}

export const DEFAULT_CORPUS_CONFIG: CorpusConfig = {
  communities: 6,
  worksPerCommunity: 40,
  localTagsPerCommunity: 8,
  bridgeTags: 4,
  authorsPerCommunity: 5,
  bridgeWorks: 20,
  seed: 42,
};

/**
 * Named corpus sizes for the fog-of-war search eval.
 * Approximate work counts: small ~260, medium ~1.2k, large ~4k, xlarge ~12k, xxlarge ~35k.
 */
export const CORPUS_SIZE_PRESETS = {
  small: DEFAULT_CORPUS_CONFIG,
  medium: {
    communities: 12,
    worksPerCommunity: 90,
    localTagsPerCommunity: 10,
    bridgeTags: 6,
    authorsPerCommunity: 8,
    bridgeWorks: 40,
    seed: 42,
  },
  large: {
    communities: 20,
    worksPerCommunity: 180,
    localTagsPerCommunity: 12,
    bridgeTags: 8,
    authorsPerCommunity: 10,
    bridgeWorks: 80,
    seed: 42,
  },
  xlarge: {
    communities: 30,
    worksPerCommunity: 380,
    localTagsPerCommunity: 14,
    bridgeTags: 10,
    authorsPerCommunity: 12,
    bridgeWorks: 150,
    seed: 42,
  },
  xxlarge: {
    communities: 48,
    worksPerCommunity: 700,
    localTagsPerCommunity: 16,
    bridgeTags: 14,
    authorsPerCommunity: 14,
    bridgeWorks: 300,
    seed: 42,
  },
} as const satisfies Record<string, CorpusConfig>;

export type CorpusSizePreset = keyof typeof CORPUS_SIZE_PRESETS;

/** Expected minimum work counts used by eval smoke checks. */
export const CORPUS_SIZE_MIN_WORKS: Record<CorpusSizePreset, number> = {
  small: 100,
  medium: 1_000,
  large: 3_000,
  xlarge: 10_000,
  xxlarge: 30_000,
};

export interface EvalCorpus {
  /**
   * Observed graph used for fog-of-war search.
   * Equals `latentGraph` when measurement perturbation is off.
   */
  graph: SyntheticGraph;
  /** Clean latent graph used for NDCG ground-truth relevance. */
  latentGraph: SyntheticGraph;
  config: CorpusConfig;
  /** Whether `graph` carries measurement noise relative to `latentGraph`. */
  measurementPerturbed: boolean;
  measurementNoiseSigma: number;
  /** Work keys suitable as evaluation seeds (one per community + a few bridge works). */
  targetSeedKeys: string[];
  /** All work keys in the corpus. */
  workKeys: string[];
  communityOfWork: Map<string, number>;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickUnique(rng: () => number, items: string[], count: number): string[] {
  const pool = [...items];
  const chosen: string[] = [];
  while (chosen.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen;
}

function wordCountFor(rng: () => number): number {
  return Math.round(800 + rng() * 7200);
}

/**
 * Build a closed, fully-explored synthetic AO3-like graph with community structure.
 * Tag/author frequencies equal true degrees so fog-of-war frontiers leak mass correctly.
 * By default also builds a measurement-noisy observed copy for search.
 */
export function buildEvalCorpus(config: Partial<CorpusConfig> = {}): EvalCorpus {
  const perturbMeasurement = config.perturbMeasurement ?? true;
  const measurementNoiseSigma =
    config.measurementNoiseSigma ?? DEFAULT_MEASUREMENT_NOISE_SIGMA;
  const cfg: CorpusConfig = {
    ...DEFAULT_CORPUS_CONFIG,
    ...config,
    perturbMeasurement,
    measurementNoiseSigma,
  };
  const rng = mulberry32(cfg.seed);

  const bridgeTagKeys = Array.from({ length: cfg.bridgeTags }, (_, i) => `bridge-tag-${i}`);
  const works: SyntheticWorkInput[] = [];
  const tags: SyntheticTagInput[] = [];
  const authors: SyntheticAuthorInput[] = [];
  const workKeys: string[] = [];
  const communityOfWork = new Map<string, number>();
  const targetSeedKeys: string[] = [];
  const tagDegree = new Map<string, number>();
  const authorDegree = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const key of bridgeTagKeys) {
    tags.push({ key, explored: true });
  }

  for (let community = 0; community < cfg.communities; community++) {
    const localTagKeys = Array.from(
      { length: cfg.localTagsPerCommunity },
      (_, i) => `c${community}-tag-${i}`,
    );
    for (const key of localTagKeys) {
      tags.push({ key, explored: true });
    }

    const authorKeys = Array.from(
      { length: cfg.authorsPerCommunity },
      (_, i) => `c${community}-author-${i}`,
    );
    for (const key of authorKeys) {
      authors.push({ key, explored: true });
    }

    const communityWorkKeys: string[] = [];
    for (let workIndex = 0; workIndex < cfg.worksPerCommunity; workIndex++) {
      const key = `c${community}-work-${workIndex}`;
      communityWorkKeys.push(key);
      workKeys.push(key);
      communityOfWork.set(key, community);

      const localTags = pickUnique(
        rng,
        localTagKeys,
        2 + Math.floor(rng() * Math.min(3, localTagKeys.length)),
      );
      const bridges =
        rng() < 0.35
          ? pickUnique(rng, bridgeTagKeys, 1 + Math.floor(rng() * Math.min(2, bridgeTagKeys.length)))
          : [];
      const workTags = [...localTags, ...bridges];
      const workAuthors = pickUnique(rng, authorKeys, 1 + (rng() < 0.2 ? 1 : 0));

      for (const tag of workTags) bump(tagDegree, tag);
      for (const author of workAuthors) bump(authorDegree, author);

      works.push({
        key,
        tags: workTags,
        authors: workAuthors,
        wordCount: wordCountFor(rng),
        explored: true,
      });
    }

    targetSeedKeys.push(communityWorkKeys[0]);
  }

  for (let bridgeIndex = 0; bridgeIndex < cfg.bridgeWorks; bridgeIndex++) {
    const key = `bridge-work-${bridgeIndex}`;
    workKeys.push(key);
    communityOfWork.set(key, -1);
    const workTags = pickUnique(
      rng,
      bridgeTagKeys,
      1 + Math.floor(rng() * Math.min(3, bridgeTagKeys.length)),
    );
    for (const tag of workTags) bump(tagDegree, tag);
    works.push({
      key,
      tags: workTags,
      wordCount: wordCountFor(rng),
      explored: true,
    });
    if (bridgeIndex < Math.min(3, cfg.bridgeWorks)) {
      targetSeedKeys.push(key);
    }
  }

  for (const tag of tags) {
    const degree = tagDegree.get(tag.key) ?? 1;
    tag.estimatedFreq = degree;
    tag.calibratedFreq = degree;
  }
  for (const author of authors) {
    const degree = authorDegree.get(author.key) ?? 1;
    author.estimatedFreq = degree;
  }

  const builder = syntheticGraph();
  for (const tag of tags) builder.tag(tag);
  for (const author of authors) builder.author(author);
  for (const work of works) builder.work(work);

  const latentGraph = builder.build();
  const graph = perturbMeasurement
    ? createObservedGraph(latentGraph, {
        sigma: measurementNoiseSigma,
        // Offset from layout seed so layout RNG state and noise stay independent.
        seed: (cfg.seed + 0x9e3779b9) >>> 0,
      })
    : latentGraph;

  return {
    graph,
    latentGraph,
    config: cfg,
    measurementPerturbed: perturbMeasurement,
    measurementNoiseSigma,
    targetSeedKeys,
    workKeys,
    communityOfWork,
  };
}

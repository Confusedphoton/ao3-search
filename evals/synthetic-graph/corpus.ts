import {
  syntheticGraph,
  type SyntheticAuthorInput,
  type SyntheticGraph,
  type SyntheticTagInput,
  type SyntheticWorkInput,
} from '../../tests/fixtures/syntheticGraph';

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

export interface EvalCorpus {
  graph: SyntheticGraph;
  config: CorpusConfig;
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
 * Tag/author frequencies equal true degrees so open depth-balls leak mass at the frontier.
 */
export function buildEvalCorpus(config: Partial<CorpusConfig> = {}): EvalCorpus {
  const cfg: CorpusConfig = { ...DEFAULT_CORPUS_CONFIG, ...config };
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

  return {
    graph: builder.build(),
    config: cfg,
    targetSeedKeys,
    workKeys,
    communityOfWork,
  };
}

import { describe, expect, it } from 'vitest';
import {
  buildEvalCorpus,
  CORPUS_SIZE_MIN_WORKS,
  CORPUS_SIZE_PRESETS,
  type CorpusSizePreset,
} from './corpus';

const SIZES = Object.keys(CORPUS_SIZE_PRESETS) as CorpusSizePreset[];

describe('eval corpus size presets', () => {
  it.each(SIZES)('builds a %s corpus above the expected work floor', (size) => {
    const corpus = buildEvalCorpus(CORPUS_SIZE_PRESETS[size]);
    expect(corpus.workKeys.length).toBeGreaterThan(CORPUS_SIZE_MIN_WORKS[size]);
    expect(corpus.targetSeedKeys.length).toBeGreaterThan(0);
    expect(corpus.graph.nodeCount).toBeGreaterThan(corpus.workKeys.length);
    expect(corpus.config).toMatchObject(CORPUS_SIZE_PRESETS[size]);
    expect(corpus.measurementPerturbed).toBe(true);
    expect(corpus.latentGraph.nodeCount).toBe(corpus.graph.nodeCount);
  });
});

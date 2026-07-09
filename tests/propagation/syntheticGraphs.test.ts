import { describe, expect, it } from 'vitest';
import { runQueryPropagation, runRelevancePropagation } from '@/src/propagation';
import {
  authorBridgeGraph,
  cycleGraph,
  disconnectedPairGraph,
  lineGraph,
  syntheticGraph,
  tagBridgeGraph,
  tagStarGraph,
  vectorL1Norm,
} from '../fixtures/syntheticGraph';

describe('synthetic graph fixtures', () => {
  it('builds semantic graphs with stable node indices', () => {
    const graph = tagStarGraph(['100', '200', '300'], 'shared');

    expect(graph.work('100')).not.toBe(graph.work('200'));
    expect(graph.tag('shared')).toBeGreaterThanOrEqual(0);
    expect(graph.workIndices).toHaveLength(3);
    expect(graph.tagIndices).toHaveLength(1);
  });

  it('builds raw line graphs for low-level propagation tests', () => {
    const graph = lineGraph(3);

    expect(graph.nodeCount).toBe(3);
    expect(graph.offsets).toEqual([0, 1, 3, 4]);
    expect(graph.neighbors).toEqual([1, 0, 2, 1]);
  });
});

describe('synthetic graph relevance propagation', () => {
  it('concentrates mass near the seed on a line graph', () => {
    const graph = lineGraph(3);
    const result = runRelevancePropagation(
      graph.relevanceInput({ seedIndices: [0] }),
    );

    expect(vectorL1Norm(result.relevance)).toBeCloseTo(1, 6);
    expect(result.relevance[0]).toBeGreaterThan(result.relevance[2]);
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('keeps disconnected components isolated from the seed', () => {
    const graph = disconnectedPairGraph();
    const result = runRelevancePropagation(
      graph.relevanceInput({ positive: { works: ['100'] } }),
    );

    expect(result.relevance[graph.work('200')]).toBeCloseTo(0, 6);
    expect(result.relevance[graph.work('100')]).toBeGreaterThan(0);
    expect(result.relevance[graph.tag('tag-b')]).toBeCloseTo(0, 6);
  });

  it('spreads relevance to sibling works through a shared tag', () => {
    const graph = tagStarGraph(['seed', 'sibling', 'peer'], 'hub');
    const result = runRelevancePropagation(
      graph.relevanceInput({ positive: { works: ['seed'] } }),
    );

    const seed = graph.work('seed');
    const sibling = graph.work('sibling');
    const peer = graph.work('peer');
    const hub = graph.tag('hub');

    expect(result.relevance[seed]).toBeGreaterThan(result.relevance[sibling]);
    expect(result.relevance[sibling]).toBeGreaterThan(0);
    expect(result.relevance[peer]).toBeCloseTo(result.relevance[sibling], 6);
    expect(result.relevance[hub]).toBeGreaterThan(0);
  });

  it('routes relevance across a bridge tag between two works', () => {
    const graph = tagBridgeGraph('left', 'right', 'bridge');
    const result = runRelevancePropagation(
      graph.relevanceInput({ positive: { works: ['left'] } }),
    );

    expect(result.relevance[graph.work('left')]).toBeGreaterThan(
      result.relevance[graph.work('right')],
    );
    expect(result.relevance[graph.work('right')]).toBeGreaterThan(0);
    expect(result.relevance[graph.tag('bridge')]).toBeGreaterThan(0);
  });

  it('propagates from a tag seed to connected works', () => {
    const graph = tagStarGraph(['a', 'b'], 'seed-tag');
    const result = runRelevancePropagation(
      graph.relevanceInput({ positive: { tags: ['seed-tag'] } }),
    );

    expect(result.relevance[graph.tag('seed-tag')]).toBeGreaterThan(0);
    expect(result.relevance[graph.work('a')]).toBeGreaterThan(0);
    expect(result.relevance[graph.work('b')]).toBeGreaterThan(0);
  });

  it('reaches a co-authored work through an author hub', () => {
    const graph = authorBridgeGraph('seed', 'other');
    const result = runRelevancePropagation(
      graph.relevanceInput({ positive: { works: ['seed'] } }),
    );

    expect(result.relevance[graph.work('seed')]).toBeGreaterThan(
      result.relevance[graph.work('other')],
    );
    expect(result.relevance[graph.work('other')]).toBeGreaterThan(0);
    expect(result.relevance[graph.author('writer')]).toBeGreaterThan(0);
  });

  it('down-ranks nodes near a negative seed via dual PPR contrast', () => {
    const graph = lineGraph(3);
    const positiveOnly = runRelevancePropagation(
      graph.relevanceInput({ seedIndices: [0] }),
    );
    const contrasted = runRelevancePropagation(
      graph.relevanceInput({
        seedIndices: [0],
        negativeSeedIndices: [2],
        negativeLambda: 3,
      }),
    );

    expect(contrasted.relevance[2]).toBeLessThan(positiveOnly.relevance[2]);
    expect(contrasted.negativeRelevance![2]).toBeGreaterThan(
      contrasted.negativeRelevance![0],
    );
  });

  it('down-ranks works connected to a negatively seeded shared tag', () => {
    const graph = tagStarGraph(['keep', 'avoid'], 'shared');
    const positiveOnly = runRelevancePropagation(
      graph.relevanceInput({ positive: { works: ['keep'] } }),
    );
    const contrasted = runRelevancePropagation(
      graph.relevanceInput({
        positive: { works: ['keep'] },
        negative: { tags: ['shared'] },
        negativeLambda: 3,
      }),
    );

    expect(contrasted.relevance[graph.work('avoid')]).toBeLessThan(
      positiveOnly.relevance[graph.work('avoid')],
    );
    expect(contrasted.relevance[graph.work('keep')]).toBeGreaterThan(
      contrasted.relevance[graph.work('avoid')],
    );
    expect(contrasted.negativeRelevance![graph.tag('shared')]).toBeGreaterThan(0);
  });

  it('prefers theme-only works over works that also carry a negative tag', () => {
    const graph = syntheticGraph()
      .tag({ key: 'theme' })
      .tag({ key: 'avoid-me' })
      .work({ key: 'seed', tags: ['theme'], wordCount: 3000, explored: true })
      .work({ key: 'clean', tags: ['theme'], wordCount: 3000 })
      .work({ key: 'tainted', tags: ['theme', 'avoid-me'], wordCount: 3000 })
      .build();

    const result = runRelevancePropagation(
      graph.relevanceInput({
        positive: { works: ['seed'] },
        negative: { tags: ['avoid-me'] },
        negativeLambda: 3,
      }),
    );

    expect(result.relevance[graph.work('clean')]).toBeGreaterThan(
      result.relevance[graph.work('tainted')],
    );
  });

  it('distributes mass around a directed cycle', () => {
    const graph = cycleGraph(4);
    const result = runRelevancePropagation(
      graph.relevanceInput({ seedIndices: [0] }),
    );

    expect(vectorL1Norm(result.relevance)).toBeCloseTo(1, 6);
    expect(result.relevance[0]).toBeGreaterThan(result.relevance[2]);
    expect(result.relevance[1]).toBeGreaterThan(0);
  });

  it('changes relevance when frontier row-out fractions are reduced', () => {
    const graph = lineGraph(2);
    const closed = runRelevancePropagation(
      graph.relevanceInput({ seedIndices: [0], rowOutFractions: [1, 1] }),
    );
    const open = runRelevancePropagation(
      graph.relevanceInput({ seedIndices: [0], rowOutFractions: [1, 0.1] }),
    );

    expect([...open.relevance]).not.toEqual([...closed.relevance]);
  });
});

describe('synthetic graph query propagation', () => {
  it('returns normalized relevance and authority on a tag-star graph', () => {
    const graph = syntheticGraph()
      .tag({ key: 'genre', estimatedFreq: 2 })
      .work({ key: 'seed', tags: ['genre'], wordCount: 5000, explored: true })
      .work({ key: 'match', tags: ['genre'], wordCount: 2500 })
      .work({ key: 'other', tags: ['genre'] })
      .build();

    const result = runQueryPropagation(
      graph.queryInput({ positive: { works: ['seed'] } }),
    );

    expect(vectorL1Norm(result.relevance)).toBeCloseTo(1, 4);
    expect(vectorL1Norm(result.authority)).toBeCloseTo(1, 4);
    expect(result.precision.every((value) => value > 0)).toBe(true);
    expect(result.expectedInfo[graph.work('seed')]).toBeGreaterThan(0);
    expect(result.iterations.relevance).toBeGreaterThan(0);
    expect(result.iterations.authority).toBeGreaterThan(0);
  });

  it('ranks the longer seeded work above an unseeded neighbor', () => {
    const graph = syntheticGraph()
      .tag({ key: 'bridge' })
      .work({ key: 'seed', tags: ['bridge'], wordCount: 5000, explored: true })
      .work({ key: 'candidate', tags: ['bridge'], wordCount: 1000 })
      .build();

    const result = runQueryPropagation(
      graph.queryInput({ positive: { works: ['seed'] } }),
    );

    const ranking = graph.rankedWorkKeys(result.relevance);
    expect(ranking[0]).toBe('seed');
    expect(ranking).toContain('candidate');
    expect(result.relevance[graph.work('candidate')]).toBeGreaterThan(0);
  });

  it('assigns higher authority to the longer work via priors', () => {
    const graph = syntheticGraph()
      .work({ key: 'long', wordCount: 5000, explored: true })
      .work({ key: 'short', wordCount: 1000 })
      .build();

    const result = runQueryPropagation(
      graph.queryInput({ positive: { works: ['long'] } }),
    );

    expect(result.authority[graph.work('long')]).toBeGreaterThan(
      result.authority[graph.work('short')],
    );
  });

  it('down-ranks tainted works under dual PPR contrast', () => {
    const graph = syntheticGraph()
      .tag({ key: 'theme' })
      .tag({ key: 'mcd' })
      .work({ key: 'seed', tags: ['theme'], wordCount: 4000, explored: true })
      .work({ key: 'clean', tags: ['theme'], wordCount: 3000 })
      .work({ key: 'tainted', tags: ['theme', 'mcd'], wordCount: 3000 })
      .build();

    const result = runQueryPropagation(
      graph.queryInput({
        positive: { works: ['seed'] },
        negative: { tags: ['mcd'] },
        negativeLambda: 3,
      }),
    );

    expect(result.relevance[graph.work('clean')]).toBeGreaterThan(
      result.relevance[graph.work('tainted')],
    );
    expect(result.negativeRelevance).not.toBeNull();
    expect(result.negativeRelevance![graph.tag('mcd')]).toBeGreaterThan(0);
  });
});

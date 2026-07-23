import { describe, expect, it } from 'vitest';
import { NodeKind } from '@/src/graph/types';
import { buildEvalCorpus } from './corpus';
import {
  createObservedGraph,
  resolveMeasurementPerturb,
  restoreParentWeightsAndOrder,
  takePerturbArg,
} from './measurementNoise';
import { induceVisibleSubgraph } from './subgraph';

describe('measurementNoise', () => {
  it('defaults perturbation on and parses EVAL_PERTURB', () => {
    expect(resolveMeasurementPerturb({})).toBe(true);
    expect(resolveMeasurementPerturb({ EVAL_PERTURB: '0' })).toBe(false);
    expect(resolveMeasurementPerturb({ EVAL_PERTURB: 'false' })).toBe(false);
    expect(resolveMeasurementPerturb({ EVAL_PERTURB: '1' })).toBe(true);
    expect(() => resolveMeasurementPerturb({ EVAL_PERTURB: 'maybe' })).toThrow(
      /Invalid EVAL_PERTURB/,
    );
  });

  it('parses --perturb / --no-perturb from argv', () => {
    expect(takePerturbArg(['--no-perturb', '-t', 'small'])).toEqual({
      perturb: false,
      rest: ['-t', 'small'],
    });
    expect(takePerturbArg(['--perturb', '-t', 'small'])).toEqual({
      perturb: true,
      rest: ['-t', 'small'],
    });
  });

  it('leaves topology intact while changing freqs, weights, and neighbor order', () => {
    const corpus = buildEvalCorpus({
      communities: 2,
      worksPerCommunity: 8,
      localTagsPerCommunity: 3,
      bridgeTags: 2,
      authorsPerCommunity: 2,
      bridgeWorks: 2,
      seed: 17,
      perturbMeasurement: false,
    });
    const latent = corpus.latentGraph.csr!;
    const observed = createObservedGraph(corpus.latentGraph, { seed: 99, sigma: 0.5 }).csr!;

    expect(observed.nodeCount).toBe(latent.nodeCount);
    expect(observed.offsets).toEqual(latent.offsets);

    const latentPairs = new Set<string>();
    const observedPairs = new Set<string>();
    for (let node = 0; node < latent.nodeCount; node++) {
      for (let edge = latent.offsets[node]!; edge < latent.offsets[node + 1]!; edge++) {
        latentPairs.add(`${node}->${latent.neighbors[edge]}`);
      }
      for (let edge = observed.offsets[node]!; edge < observed.offsets[node + 1]!; edge++) {
        observedPairs.add(`${node}->${observed.neighbors[edge]}`);
      }
    }
    expect(observedPairs).toEqual(latentPairs);

    let freqChanged = false;
    let weightChanged = false;
    let orderChanged = false;
    for (let i = 0; i < latent.nodeCount; i++) {
      if (latent.nodeByIndex[i]!.estimatedFreq !== observed.nodeByIndex[i]!.estimatedFreq) {
        freqChanged = true;
      }
      const begin = latent.offsets[i]!;
      const end = latent.offsets[i + 1]!;
      for (let edge = begin; edge < end; edge++) {
        if (latent.edgeWeights[edge] !== observed.edgeWeights[edge]) weightChanged = true;
        if (latent.neighbors[edge] !== observed.neighbors[edge]) orderChanged = true;
      }
    }
    expect(freqChanged).toBe(true);
    expect(weightChanged).toBe(true);
    expect(orderChanged).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const corpus = buildEvalCorpus({
      communities: 1,
      worksPerCommunity: 6,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 1,
      seed: 3,
      perturbMeasurement: false,
    });
    const a = createObservedGraph(corpus.latentGraph, { seed: 42, sigma: 0.35 }).csr!;
    const b = createObservedGraph(corpus.latentGraph, { seed: 42, sigma: 0.35 }).csr!;
    expect([...a.edgeWeights]).toEqual([...b.edgeWeights]);
    expect([...a.neighbors]).toEqual([...b.neighbors]);
  });

  it('preserves parent weights and order across induceVisibleSubgraph', () => {
    const corpus = buildEvalCorpus({
      communities: 1,
      worksPerCommunity: 5,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 0,
      seed: 8,
      perturbMeasurement: true,
      measurementNoiseSigma: 0.5,
    });
    const parent = corpus.graph.csr!;
    const seedIndex = corpus.graph.work(corpus.targetSeedKeys[0]!);
    const visible = new Set<number>([seedIndex]);
    const begin = parent.offsets[seedIndex]!;
    const end = parent.offsets[seedIndex + 1]!;
    for (let edge = begin; edge < end; edge++) visible.add(parent.neighbors[edge]!);

    const induced = induceVisibleSubgraph(corpus.graph, visible, new Set([seedIndex]));
    const child = induced.csr!;
    const childSeed = induced.work(corpus.targetSeedKeys[0]!);

    const parentKeys = [];
    for (let edge = begin; edge < end; edge++) {
      const neighbor = parent.nodeByIndex[parent.neighbors[edge]!]!;
      parentKeys.push(`${neighbor.kind}:${neighbor.key}`);
    }

    const childBegin = child.offsets[childSeed]!;
    const childEnd = child.offsets[childSeed + 1]!;
    const childKeys = [];
    for (let edge = childBegin; edge < childEnd; edge++) {
      const neighbor = child.nodeByIndex[child.neighbors[edge]!]!;
      childKeys.push(`${neighbor.kind}:${neighbor.key}`);
    }
    expect(childKeys).toEqual(parentKeys);

    // Spot-check a tag hub row weight survives rebuild.
    const tagIndex = [...visible].find((index) => parent.nodeByIndex[index]!.kind === NodeKind.Tag);
    expect(tagIndex).toBeDefined();
    const tagKey = parent.nodeByIndex[tagIndex!]!.key;
    const childTag = induced.tag(tagKey);
    const parentTagBegin = parent.offsets[tagIndex!]!;
    const parentWeightByKey = new Map<string, number>();
    for (let edge = parentTagBegin; edge < parent.offsets[tagIndex! + 1]!; edge++) {
      const neighbor = parent.nodeByIndex[parent.neighbors[edge]!]!;
      parentWeightByKey.set(`${neighbor.kind}:${neighbor.key}`, parent.edgeWeights[edge]!);
    }
    for (let edge = child.offsets[childTag]!; edge < child.offsets[childTag + 1]!; edge++) {
      const neighbor = child.nodeByIndex[child.neighbors[edge]!]!;
      const key = `${neighbor.kind}:${neighbor.key}`;
      expect(child.edgeWeights[edge]).toBe(parentWeightByKey.get(key));
    }
  });

  it('restoreParentWeightsAndOrder is a no-op when rows already match', () => {
    const corpus = buildEvalCorpus({
      communities: 1,
      worksPerCommunity: 4,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 0,
      seed: 2,
      perturbMeasurement: false,
    });
    const csr = corpus.graph.csr!;
    const before = [...csr.edgeWeights];
    restoreParentWeightsAndOrder(csr, csr);
    expect([...csr.edgeWeights]).toEqual(before);
  });
});

describe('buildEvalCorpus measurement perturbation', () => {
  it('shares identity when perturbation is off', () => {
    const corpus = buildEvalCorpus({
      communities: 1,
      worksPerCommunity: 4,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 0,
      seed: 1,
      perturbMeasurement: false,
    });
    expect(corpus.measurementPerturbed).toBe(false);
    expect(corpus.graph).toBe(corpus.latentGraph);
  });

  it('uses a distinct observed graph when perturbation is on', () => {
    const corpus = buildEvalCorpus({
      communities: 1,
      worksPerCommunity: 4,
      localTagsPerCommunity: 2,
      bridgeTags: 1,
      authorsPerCommunity: 1,
      bridgeWorks: 0,
      seed: 1,
      perturbMeasurement: true,
    });
    expect(corpus.measurementPerturbed).toBe(true);
    expect(corpus.graph).not.toBe(corpus.latentGraph);
    expect(corpus.graph.nodeCount).toBe(corpus.latentGraph.nodeCount);
  });
});

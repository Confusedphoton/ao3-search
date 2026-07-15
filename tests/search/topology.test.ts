import { describe, expect, it } from 'vitest';
import { buildCSR } from '@/src/graph/csr';
import { isExpandable } from '@/src/graph/exploration';
import { NodeKind, type GraphSnapshot } from '@/src/graph/types';
import {
  buildConductanceField,
  nodePotential,
  thresholdSchedule,
} from '@/src/search/topology/conductance';
import {
  extractNeighborhoods,
  hypothesisBoundaryNodes,
  isStrictSubset,
  superlevelComponents,
} from '@/src/search/topology/neighborhoods';
import { buildHypothesisPoset } from '@/src/search/topology/poset';
import {
  computeHasseHomology,
  TopologyStabilityTracker,
} from '@/src/search/topology/orderComplex';
import {
  boundaryExposure,
  potentialInfluence,
  computeFragilityAll,
} from '@/src/search/topology/fragility';
import { TopologicalExpansionPolicy } from '@/src/search/topology/TopologicalExpansionPolicy';
import { createExpansionPolicy, selectNextPlan } from '@/src/search/expansionPolicy';
import type { Hypothesis } from '@/src/search/topology/neighborhoods';

function lineSnapshot(): GraphSnapshot {
  // work1 — tag — work2 — author — work3
  return {
    nodes: [
      {
        id: 1,
        kind: NodeKind.Work,
        key: '1',
        wordCount: null,
        estimatedFreq: 1,
        calibratedFreq: null,
        explored: true,
      },
      {
        id: 2,
        kind: NodeKind.Tag,
        key: 't',
        wordCount: null,
        estimatedFreq: 10,
        calibratedFreq: null,
        explored: false,
      },
      {
        id: 3,
        kind: NodeKind.Work,
        key: '2',
        wordCount: null,
        estimatedFreq: 1,
        calibratedFreq: null,
        explored: false,
      },
      {
        id: 4,
        kind: NodeKind.Author,
        key: 'a',
        wordCount: null,
        estimatedFreq: 5,
        calibratedFreq: null,
        explored: false,
      },
      {
        id: 5,
        kind: NodeKind.Work,
        key: '3',
        wordCount: null,
        estimatedFreq: 1,
        calibratedFreq: null,
        explored: false,
      },
    ],
    edges: [
      { workNodeId: 1, tagNodeId: 2 },
      { workNodeId: 3, tagNodeId: 2 },
    ],
    authorEdges: [
      { workNodeId: 3, authorNodeId: 4 },
      { workNodeId: 5, authorNodeId: 4 },
    ],
  };
}

describe('conductance field', () => {
  it('computes φ = √(R A) and C(u,v) = φ(u)φ(v)', () => {
    expect(nodePotential(4, 9)).toBe(6);
    expect(nodePotential(-1, 9)).toBe(0);

    const csr = buildCSR(lineSnapshot());
    const relevance = new Float64Array(csr.nodeCount).fill(1);
    const authority = new Float64Array(csr.nodeCount).fill(4);
    const field = buildConductanceField(csr, relevance, authority);

    for (let i = 0; i < csr.nodeCount; i++) {
      expect(field.phi[i]).toBe(2);
    }
    for (let e = 0; e < field.edgeConductance.length; e++) {
      expect(field.edgeConductance[e]).toBe(4);
    }
  });

  it('builds a high-to-low threshold schedule including max φ', () => {
    const phi = new Float64Array([0, 0.1, 0.5, 1]);
    const schedule = thresholdSchedule(phi, 3);
    expect(schedule[0]).toBe(1);
    expect(schedule.length).toBe(3);
    expect(schedule[schedule.length - 1]).toBeLessThanOrEqual(schedule[0]!);
  });

  it('samples critical-value quantiles for a skewed potential field', () => {
    const phi = new Float64Array([1, 0.1, 0.01, 0.001, 0.0001]);
    expect(thresholdSchedule(phi, 3)).toEqual([1, 0.01, 0.0001]);
  });
});

describe('superlevel neighborhoods and poset', () => {
  it('nests components as λ decreases', () => {
    const csr = buildCSR(lineSnapshot());
    const relevance = new Float64Array([1, 0.8, 0.6, 0.2, 0.1]);
    const authority = new Float64Array([1, 0.8, 0.6, 0.2, 0.1]);
    // Remap to CSR index order (sorted by node id).
    const rel = new Float64Array(csr.nodeCount);
    const auth = new Float64Array(csr.nodeCount);
    for (let i = 0; i < csr.nodeCount; i++) {
      const id = csr.nodeIds[i]!;
      const src = id - 1;
      rel[i] = relevance[src]!;
      auth[i] = authority[src]!;
    }
    const field = buildConductanceField(csr, rel, auth);
    const high = superlevelComponents(csr, field, 0.7);
    const low = superlevelComponents(csr, field, 0.05);
    expect(high.length).toBeGreaterThanOrEqual(1);
    expect(low.some((c) => c.length >= high[0]!.length)).toBe(true);
  });

  it('uses candidate openness for boundary alternatives', () => {
    const csr = buildCSR(lineSnapshot());
    const workIndex = csr.indexByNodeId.get(1)!;
    const tagIndex = csr.indexByNodeId.get(2)!;
    const relevance = new Float64Array(csr.nodeCount).fill(1);
    const authority = new Float64Array(csr.nodeCount).fill(1);
    relevance[workIndex] = 4;
    authority[workIndex] = 4;
    const rowOut = new Float64Array(csr.nodeCount).fill(1);
    rowOut[workIndex] = 0.2;

    const extraction = extractNeighborhoods(csr, relevance, authority, {
      maxLevels: 2,
      rowOutFractions: rowOut,
    });
    const closedAttachmentKey = [workIndex, tagIndex].sort((a, b) => a - b).join(',');
    expect(
      extraction.hypotheses.some(
        (hypothesis) =>
          hypothesis.kind === 'boundary-alt' && hypothesis.key === closedAttachmentKey,
      ),
    ).toBe(false);

    rowOut[workIndex] = 1;
    rowOut[tagIndex] = 0.2;
    const openCandidateExtraction = extractNeighborhoods(csr, relevance, authority, {
      maxLevels: 2,
      rowOutFractions: rowOut,
    });
    expect(
      openCandidateExtraction.hypotheses.some(
        (hypothesis) =>
          hypothesis.kind === 'boundary-alt' && hypothesis.key === closedAttachmentKey,
      ),
    ).toBe(true);
  });

  it('builds covering relations under inclusion', () => {
    const hypotheses: Hypothesis[] = [
      { id: 0, nodes: [0], key: '0', birth: 1, death: 1, kind: 'superlevel', mass: 1 },
      { id: 1, nodes: [0, 1], key: '0,1', birth: 0.5, death: 0.5, kind: 'superlevel', mass: 2 },
      { id: 2, nodes: [0, 1, 2], key: '0,1,2', birth: 0.1, death: 0.1, kind: 'superlevel', mass: 3 },
    ];
    expect(isStrictSubset([0], [0, 1])).toBe(true);
    const poset = buildHypothesisPoset(hypotheses);
    expect(poset.covers).toEqual([
      { lower: 0, upper: 1 },
      { lower: 1, upper: 2 },
    ]);
    expect(poset.height).toBe(2);
  });

  it('detects Hasse H₁ on a diamond of boundary-alts', () => {
    // Diamond: A ⊂ B, A ⊂ C, B ⊂ D, C ⊂ D → cycle in undirected Hasse.
    const hypotheses: Hypothesis[] = [
      { id: 0, nodes: [0], key: '0', birth: 1, death: 1, kind: 'superlevel', mass: 1 },
      { id: 1, nodes: [0, 1], key: '0,1', birth: 0.5, death: 0.5, kind: 'boundary-alt', mass: 2 },
      { id: 2, nodes: [0, 2], key: '0,2', birth: 0.5, death: 0.5, kind: 'boundary-alt', mass: 2 },
      { id: 3, nodes: [0, 1, 2], key: '0,1,2', birth: 0.1, death: 0.1, kind: 'superlevel', mass: 3 },
    ];
    const poset = buildHypothesisPoset(hypotheses);
    const topo = computeHasseHomology(poset);
    expect(topo.beta0).toBe(1);
    expect(topo.beta1).toBe(1);
    expect(topo.edgeCount).toBe(4);
  });
});

describe('fragility proxy', () => {
  it('gives zero exposure when rowOutFraction is 1', () => {
    const csr = buildCSR(lineSnapshot());
    const relevance = new Float64Array(csr.nodeCount).fill(1);
    const authority = new Float64Array(csr.nodeCount).fill(1);
    const field = buildConductanceField(csr, relevance, authority);
    const rowOut = new Float64Array(csr.nodeCount).fill(1);
    const exposure = boundaryExposure(csr, field, 0, new Set([1, 2]), rowOut);
    expect(exposure).toBe(0);
  });

  it('ranks open high-potential boundary nodes above closed interior', () => {
    const csr = buildCSR(lineSnapshot());
    const workExplored = csr.indexByNodeId.get(1)!;
    const tagIndex = csr.indexByNodeId.get(2)!;
    const rel = new Float64Array(csr.nodeCount).fill(1);
    const auth = new Float64Array(csr.nodeCount).fill(1);
    rel[workExplored] = 4;
    auth[workExplored] = 4;
    const rowOut = new Float64Array(csr.nodeCount).fill(1);
    rowOut[tagIndex] = 0.2;

    const extraction = extractNeighborhoods(csr, rel, auth, { rowOutFractions: rowOut });
    const poset = buildHypothesisPoset(extraction.hypotheses);
    const topology = computeHasseHomology(poset);

    const fragility = computeFragilityAll({
      csr,
      field: extraction.field,
      hypotheses: extraction.hypotheses,
      poset,
      topology,
      rowOutFractions: rowOut,
    });

    expect(potentialInfluence(extraction.field, tagIndex)).toBeGreaterThan(0);
    expect(fragility[tagIndex]!).toBeGreaterThan(0);
    expect(fragility[tagIndex]!).toBeGreaterThan(fragility[workExplored]!);
  });

  it('keeps a non-empty boundary when a full-vertex hypothesis is present', () => {
    const csr = buildCSR(lineSnapshot());
    const rel = new Float64Array([4, 2, 1, 1, 0.5]);
    const auth = new Float64Array([4, 2, 1, 1, 0.5]);
    const rowOut = new Float64Array(csr.nodeCount).fill(0.5);
    const extraction = extractNeighborhoods(csr, rel, auth, { rowOutFractions: rowOut });
    expect(extraction.hypotheses.some((h) => h.nodes.length === csr.nodeCount)).toBe(true);

    const boundary = hypothesisBoundaryNodes(csr, extraction.hypotheses);
    expect(boundary.size).toBeGreaterThan(0);

    const poset = buildHypothesisPoset(extraction.hypotheses);
    const topology = computeHasseHomology(poset);
    const fragility = computeFragilityAll({
      csr,
      field: extraction.field,
      hypotheses: extraction.hypotheses,
      poset,
      topology,
      rowOutFractions: rowOut,
    });
    expect([...fragility].some((v) => v > 0)).toBe(true);
  });
});

describe('TopologicalExpansionPolicy', () => {
  it('ranks by fragility and always yields a plan when expandable', () => {
    const csr = buildCSR(lineSnapshot());
    const relevance = new Float64Array(csr.nodeCount).fill(0.5);
    const authority = new Float64Array(csr.nodeCount).fill(0.5);
    const precision = new Float64Array(csr.nodeCount).fill(1);
    const rowOut = new Float64Array(csr.nodeCount).fill(1);
    for (let i = 0; i < csr.nodeCount; i++) {
      const node = csr.nodeByIndex[i]!;
      if (!node.explored) rowOut[i] = 0.3;
    }

    const policy = new TopologicalExpansionPolicy();
    const frontier = policy.buildFrontier({
      csr,
      relevance,
      authority,
      precision,
      rowOutFractions: rowOut,
    });
    expect(frontier.length).toBeGreaterThan(0);
    expect(frontier[0]!.score).toBeGreaterThanOrEqual(frontier[frontier.length - 1]!.score ?? 0);

    const originalRandom = Math.random;
    Math.random = () => 0.99; // force greedy
    const plan = selectNextPlan(csr, frontier);
    Math.random = originalRandom;
    expect(plan).not.toBeNull();
  });

  it('still ranks every expandable node when all fragility scores are zero', () => {
    const csr = buildCSR(lineSnapshot());
    const relevance = new Float64Array(csr.nodeCount).fill(0.5);
    const authority = new Float64Array(csr.nodeCount).fill(0.5);
    const precision = new Float64Array(csr.nodeCount).fill(1);
    const preferredIndex = csr.indexByNodeId.get(3)!;
    relevance[preferredIndex] = 2;
    authority[preferredIndex] = 3;
    precision[preferredIndex] = 0.5;
    // Fully closed rows ⇒ zero boundary exposure / fragility.
    const rowOut = new Float64Array(csr.nodeCount).fill(1);

    const policy = new TopologicalExpansionPolicy();
    const frontier = policy.buildFrontier({
      csr,
      relevance,
      authority,
      precision,
      rowOutFractions: rowOut,
    });
    const expandable = csr.nodeByIndex.filter((n) => isExpandable(n)).length;
    expect(frontier.length).toBe(expandable);
    expect(frontier.every((n) => (n.score ?? 0) === 0)).toBe(true);
    expect(frontier[0]!.index).toBe(preferredIndex);
    expect(frontier[0]!.expectedInfo).toBeGreaterThan(frontier[1]!.expectedInfo);
    expect(selectNextPlan(csr, frontier)).not.toBeNull();
  });

  it('createExpansionPolicy switches implementations', () => {
    expect(createExpansionPolicy('expected-info').minAcquisitionScore).toBeGreaterThan(0);
    expect(createExpansionPolicy('topological')).toBeInstanceOf(TopologicalExpansionPolicy);
  });
});

describe('TopologyStabilityTracker', () => {
  it('signals stop after repeated trivial topology', () => {
    const tracker = new TopologyStabilityTracker(2);
    const trivial = { beta0: 1, beta1: 0, vertexCount: 3, edgeCount: 2 };
    expect(tracker.update(trivial)).toBe(false);
    expect(tracker.update(trivial)).toBe(true);
  });

  it('resets when topology becomes non-trivial', () => {
    const tracker = new TopologyStabilityTracker(2);
    const trivial = { beta0: 1, beta1: 0, vertexCount: 3, edgeCount: 2 };
    const cyclic = { beta0: 1, beta1: 1, vertexCount: 4, edgeCount: 4 };
    expect(tracker.update(trivial)).toBe(false);
    expect(tracker.update(cyclic)).toBe(false);
    expect(tracker.update(trivial)).toBe(false);
    expect(tracker.update(trivial)).toBe(true);
  });
});

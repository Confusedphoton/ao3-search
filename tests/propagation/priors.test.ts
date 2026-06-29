import { describe, expect, it } from 'vitest';
import {
  buildPriorLog,
  buildTeleportFromPriorLog,
  computeAuthorPriorLog,
  computeWorkPriorLog,
  workPriorLog,
} from '@/src/propagation/priors';
import { NodeKind } from '@/src/graph/types';

describe('workPriorLog', () => {
  it('returns zero when word count is unknown', () => {
    expect(workPriorLog(null)).toBe(0);
  });

  it('returns ln(words / median)', () => {
    expect(workPriorLog(2500)).toBeCloseTo(0, 6);
    expect(workPriorLog(5000)).toBeCloseTo(Math.log(2), 6);
  });
});

describe('buildPriorLog', () => {
  const graph = {
    nodeCount: 4,
    workIndices: [0],
    tagIndices: [2],
    authorIndices: [1],
    authorWorkIndexEdges: [{ workIndex: 0, authorIndex: 1 }],
    nodeByIndex: [
      { kind: NodeKind.Work, wordCount: 5000 },
      { kind: NodeKind.Author, wordCount: null },
      { kind: NodeKind.Tag, wordCount: null },
      { kind: NodeKind.Work, wordCount: null },
    ],
  };

  it('aggregates author prior from authored works', () => {
    const workLog = computeWorkPriorLog(graph);
    const authorLog = computeAuthorPriorLog(graph, workLog);
    expect(workLog[0]).toBeCloseTo(Math.log(2), 6);
    expect(authorLog[1]).toBeCloseTo(Math.log(1 + Math.exp(workLog[0])), 6);
  });

  it('builds teleport as normalized exp prior', () => {
    const priorLog = buildPriorLog(graph);
    const teleport = buildTeleportFromPriorLog(priorLog);
    const sum = [...teleport].reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(teleport[0]).toBeGreaterThan(teleport[2]);
  });
});

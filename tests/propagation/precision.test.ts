import { describe, expect, it } from 'vitest';
import {
  computePrecision,
  precisionPriorFromLog,
} from '@/src/propagation/precision';
import { buildPropagationGraphFromArrays } from '@/src/propagation/queryGraph';

describe('precision', () => {
  it('builds tau0 from prior log', () => {
    const priorLog = new Float64Array([0, Math.log(2)]);
    const tau0 = precisionPriorFromLog(priorLog);
    expect(tau0[0]).toBeCloseTo(1 + Math.log(2), 6);
    expect(tau0[1]).toBeGreaterThan(tau0[0]);
  });

  it('adds authority-weighted neighbor evidence in one pass', () => {
    const offsets = [0, 1, 2];
    const neighbors = [1, 0];
    const edgeWeights = [1, 1];
    const graph = buildPropagationGraphFromArrays(offsets, neighbors, edgeWeights);
    const priorLog = new Float64Array([0, 0]);
    const authority = new Float64Array([0.8, 0.2]);

    const precision = computePrecision(graph, priorLog, authority);
    expect(precision[1]).toBeGreaterThan(precisionPriorFromLog(priorLog)[1]);
  });
});

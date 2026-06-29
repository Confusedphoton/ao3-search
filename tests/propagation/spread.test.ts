import { describe, expect, it } from 'vitest';
import { spreadMass } from '@/src/propagation/spread';
import { buildPropagationGraphFromArrays } from '@/src/propagation/queryGraph';

describe('spreadMass', () => {
  it('weights incoming mass by receiver authority', () => {
    const offsets = [0, 1, 2];
    const neighbors = [1, 0];
    const edgeWeights = [1, 1];
    const graph = buildPropagationGraphFromArrays(offsets, neighbors, edgeWeights);
    const state = new Float64Array([1, 0]);
    const receiverWeights = new Float64Array([1, 2]);
    const buffer = new Float64Array(2);

    spreadMass(graph, state, buffer, { receiverWeights });
    expect(buffer[1]).toBe(2);
  });
});

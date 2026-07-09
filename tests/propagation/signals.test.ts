import { describe, expect, it } from 'vitest';
import {
  buildRelevanceTeleport,
  contrastRelevance,
  createRelevanceSignal,
  createSeedContext,
  RELEVANCE_SIGNAL_ID,
} from '@/src/propagation/signals/relevance';

describe('relevance signal', () => {
  it('builds teleport from positive seeds only', () => {
    const context = createSeedContext(4, [0, 2], [3]);
    const teleport = buildRelevanceTeleport(context);

    expect(teleport[0]).toBe(0.5);
    expect(teleport[2]).toBe(0.5);
    expect(teleport[3]).toBe(0);
    expect(teleport[1]).toBe(0);
  });

  it('contrasts positive and negative relevance with lambda', () => {
    const positive = Float64Array.from([0.6, 0.3, 0.1]);
    const negative = Float64Array.from([0.1, 0.2, 0.7]);
    const score = contrastRelevance(positive, negative, 2);

    expect(score[0]).toBeCloseTo(0.4);
    expect(score[1]).toBeCloseTo(-0.1);
    expect(score[2]).toBeCloseTo(-1.3);
  });

  it('creates a signal instance with relevance id', () => {
    const signal = createRelevanceSignal(createSeedContext(3, [1]));
    expect(signal.id).toBe(RELEVANCE_SIGNAL_ID);
    expect(signal.state.length).toBe(3);
    expect(signal.teleport[1]).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildRelevanceTeleport,
  createRelevanceSignal,
  createSeedContext,
  RELEVANCE_SIGNAL_ID,
} from '@/src/propagation/signals/relevance';
import { NEGATIVE_SEED_WEIGHT } from '@/src/config/constants';

describe('relevance signal', () => {
  it('builds teleport from positive and negative seeds', () => {
    const context = createSeedContext(4, [0, 2], [3], NEGATIVE_SEED_WEIGHT);
    const teleport = buildRelevanceTeleport(context);

    expect(teleport[0]).toBe(0.5);
    expect(teleport[2]).toBe(0.5);
    expect(teleport[3]).toBe(-NEGATIVE_SEED_WEIGHT);
    expect(teleport[1]).toBe(0);
  });

  it('creates a signal instance with relevance id', () => {
    const signal = createRelevanceSignal(createSeedContext(3, [1]));
    expect(signal.id).toBe(RELEVANCE_SIGNAL_ID);
    expect(signal.state.length).toBe(3);
    expect(signal.teleport[1]).toBe(1);
  });
});

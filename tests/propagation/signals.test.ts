import { describe, expect, it } from 'vitest';
import {
  buildConfidenceTeleport,
  createConfidenceSignal,
} from '@/src/propagation/signals/confidence';
import {
  buildRankTeleport,
  createRankSeedContext,
  createRankSignal,
} from '@/src/propagation/signals/rank';
import { NEGATIVE_SEED_WEIGHT } from '@/src/config/constants';

describe('rank signal', () => {
  it('builds teleport from positive and negative seeds', () => {
    const context = createRankSeedContext(4, [0, 2], [3], NEGATIVE_SEED_WEIGHT);
    const teleport = buildRankTeleport(context);

    expect(teleport[0]).toBe(0.5);
    expect(teleport[2]).toBe(0.5);
    expect(teleport[3]).toBe(-NEGATIVE_SEED_WEIGHT);
    expect(teleport[1]).toBe(0);
  });

  it('creates a signal instance with relevance id', () => {
    const signal = createRankSignal(createRankSeedContext(3, [1]));
    expect(signal.id).toBe('relevance');
    expect(signal.state.length).toBe(3);
    expect(signal.teleport[1]).toBe(1);
  });
});

describe('confidence signal', () => {
  it('uses zero teleport stub', () => {
    const context = createRankSeedContext(4, [0, 2], [3]);
    const teleport = buildConfidenceTeleport(context);

    expect(teleport.every((v) => v === 0)).toBe(true);
  });

  it('creates a signal instance with confidence id', () => {
    const signal = createConfidenceSignal(createRankSeedContext(3, [1]));
    expect(signal.id).toBe('confidence');
    expect(signal.teleport.every((v) => v === 0)).toBe(true);
  });
});

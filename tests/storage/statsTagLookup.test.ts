import { describe, expect, it } from 'vitest';
import { resolveCanonicalStatsTag } from '@/src/storage/statsTagLookup';

describe('resolveCanonicalStatsTag', () => {
  it('returns the start tag when there is no merger', async () => {
    const tag = {
      tagId: 1,
      name: 'Fluff',
      type: 'Freeform',
      canonical: true,
      cachedCount: 10,
      mergerId: null,
    };
    const result = await resolveCanonicalStatsTag(tag, async () => null);
    expect(result).toEqual(tag);
  });

  it('stops on merger cycles', async () => {
    const lookup = async (tagId: number) => {
      if (tagId === 2) {
        return {
          tagId: 2,
          name: 'B',
          type: 'Freeform',
          canonical: false,
          cachedCount: 1,
          mergerId: 1,
        };
      }
      return null;
    };

    const start = {
      tagId: 1,
      name: 'A',
      type: 'Freeform',
      canonical: false,
      cachedCount: 1,
      mergerId: 2,
    };
    const result = await resolveCanonicalStatsTag(start, lookup);
    expect(result.tagId).toBe(2);
  });
});

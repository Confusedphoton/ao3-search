import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type CategoryPermeabilityFilter } from '@/src/config/settings';
import { NodeKind, type WorkMetadata } from '@/src/graph/types';
import {
  buildNodePermeabilities,
  categoryPermeability,
  workPermeability,
} from '@/src/propagation/permeability';
import { buildTransitionWeights } from '@/src/propagation/queryGraph';
import { emptyWorkMetadata } from '@/src/ao3/workMeta';

function filter(
  overrides: Partial<CategoryPermeabilityFilter>,
): CategoryPermeabilityFilter {
  return {
    mode: 'blacklist',
    permeability: 0,
    values: [],
    ...overrides,
  };
}

const meta: WorkMetadata = {
  language: 'English',
  rating: 'Explicit',
  archiveWarnings: ['Major Character Death', 'Graphic Depictions Of Violence'],
  completionStatus: 'Complete',
  fandoms: ['Harry Potter', 'Marvel'],
  categories: ['M/M', 'Gen'],
};

describe('categoryPermeability', () => {
  it('returns 1 when selection is empty or meta is missing', () => {
    expect(categoryPermeability(meta, 'rating', filter({ values: [] }))).toBe(1);
    expect(categoryPermeability(undefined, 'rating', filter({ values: ['Explicit'] }))).toBe(1);
    expect(
      categoryPermeability(emptyWorkMetadata(), 'rating', filter({ values: ['Explicit'] })),
    ).toBe(1);
  });

  it('blacklist penalizes when any multi-value matches', () => {
    expect(
      categoryPermeability(
        meta,
        'archiveWarnings',
        filter({ mode: 'blacklist', permeability: 0.2, values: ['Major Character Death'] }),
      ),
    ).toBe(0.2);
    expect(
      categoryPermeability(
        meta,
        'archiveWarnings',
        filter({ mode: 'blacklist', permeability: 0.2, values: ['Underage'] }),
      ),
    ).toBe(1);
  });

  it('whitelist allows only when all multi-values are selected', () => {
    expect(
      categoryPermeability(
        meta,
        'categories',
        filter({ mode: 'whitelist', permeability: 0.1, values: ['M/M', 'Gen'] }),
      ),
    ).toBe(1);
    expect(
      categoryPermeability(
        meta,
        'categories',
        filter({ mode: 'whitelist', permeability: 0.1, values: ['M/M'] }),
      ),
    ).toBe(0.1);
  });

  it('handles single-value whitelist and blacklist', () => {
    expect(
      categoryPermeability(
        meta,
        'rating',
        filter({ mode: 'blacklist', permeability: 0, values: ['Explicit'] }),
      ),
    ).toBe(0);
    expect(
      categoryPermeability(
        meta,
        'rating',
        filter({ mode: 'whitelist', permeability: 0.5, values: ['Mature'] }),
      ),
    ).toBe(0.5);
    expect(
      categoryPermeability(
        meta,
        'rating',
        filter({ mode: 'whitelist', permeability: 0.5, values: ['Explicit'] }),
      ),
    ).toBe(1);
  });
});

describe('workPermeability', () => {
  it('multiplies category permeabilities', () => {
    const filters = structuredClone(DEFAULT_SETTINGS.permeability);
    filters.rating = filter({ mode: 'blacklist', permeability: 0.5, values: ['Explicit'] });
    filters.fandoms = filter({ mode: 'blacklist', permeability: 0.2, values: ['Marvel'] });
    expect(workPermeability(meta, filters)).toBeCloseTo(0.1, 6);
  });

  it('returns 1 for missing meta', () => {
    expect(workPermeability(undefined, DEFAULT_SETTINGS.permeability)).toBe(1);
  });
});

describe('buildNodePermeabilities', () => {
  it('sets non-work nodes to 1', () => {
    const filters = structuredClone(DEFAULT_SETTINGS.permeability);
    filters.rating = filter({ mode: 'blacklist', permeability: 0, values: ['Explicit'] });
    const mus = buildNodePermeabilities(
      [
        { kind: NodeKind.Work, meta },
        { kind: NodeKind.Tag, meta: undefined },
        { kind: NodeKind.Author, meta: undefined },
      ],
      filters,
    );
    expect(mus[0]).toBe(0);
    expect(mus[1]).toBe(1);
    expect(mus[2]).toBe(1);
  });
});

describe('buildTransitionWeights permeability', () => {
  it('scales edges by μᵢ · μⱼ after row normalization', () => {
    const offsets = [0, 1, 2];
    const neighbors = [1, 0];
    const edgeWeights = [2, 8];
    const rowOutFractions = new Float64Array([1, 1]);
    const nodePermeabilities = new Float64Array([0.5, 0.2]);

    const transition = buildTransitionWeights(
      offsets,
      neighbors,
      edgeWeights,
      rowOutFractions,
      [],
      nodePermeabilities,
    );

    // Without μ: both edges normalize to 1. With μ: 1 * 0.5 * 0.2 = 0.1
    expect(transition[0]).toBeCloseTo(0.1, 6);
    expect(transition[1]).toBeCloseTo(0.1, 6);
  });
});

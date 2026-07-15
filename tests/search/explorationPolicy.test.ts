import { describe, expect, it } from 'vitest';
import { resolveListingExploration, isExpandable, isExplorationStale } from '@/src/graph/exploration';
import { NodeKind } from '@/src/graph/types';
import { EXPLORATION_STALE_MS } from '@/src/config/constants';
import { worksSearchUrl } from '@/src/ao3/workSearch';
import { parseListingPagination } from '@/src/ao3/parsePagination';
import { parseTagPageFromHtml } from '@/src/ao3/parseTag';
import { DefaultExpansionPolicy, selectNextPlan } from '@/src/search/expansionPolicy';
import { buildCSR } from '@/src/graph/csr';
import { normalizeExplorationFields } from '@/src/graph/exploration';

describe('resolveListingExploration', () => {
  it('marks complete when there is no next page', () => {
    const result = resolveListingExploration({
      previousStatus: 'unexplored',
      previousCalibratedFreq: null,
      previousPagesFetched: 0,
      workCount: 18,
      nextPage: null,
      pageFetched: 1,
      now: 1000,
    });
    expect(result).toMatchObject({
      explorationStatus: 'complete',
      listingNextPage: null,
      listingPagesFetched: 1,
      calibratedFreq: 18,
      demoted: false,
      exploredAt: 1000,
    });
  });

  it('marks partial when a next page exists', () => {
    const result = resolveListingExploration({
      previousStatus: 'unexplored',
      previousCalibratedFreq: null,
      previousPagesFetched: 0,
      workCount: 100,
      nextPage: 2,
      pageFetched: 1,
      now: 1000,
    });
    expect(result.explorationStatus).toBe('partial');
    expect(result.listingNextPage).toBe(2);
  });

  it('demotes complete to partial when workCount grows', () => {
    const result = resolveListingExploration({
      previousStatus: 'complete',
      previousCalibratedFreq: 40,
      previousPagesFetched: 2,
      workCount: 55,
      nextPage: null,
      pageFetched: 1,
      now: 2000,
    });
    expect(result.explorationStatus).toBe('partial');
    expect(result.listingNextPage).toBe(1);
    expect(result.calibratedFreq).toBe(55);
    expect(result.demoted).toBe(true);
  });

  it('does not demote when workCount is unchanged', () => {
    const result = resolveListingExploration({
      previousStatus: 'complete',
      previousCalibratedFreq: 40,
      previousPagesFetched: 2,
      workCount: 40,
      nextPage: null,
      pageFetched: 1,
      now: 2000,
    });
    expect(result.explorationStatus).toBe('complete');
    expect(result.demoted).toBe(false);
  });
});

describe('isExpandable', () => {
  it('includes stale complete tag hubs', () => {
    const node = normalizeExplorationFields({
      id: 1,
      kind: NodeKind.Tag,
      key: 'fluff',
      estimatedFreq: 1,
      explorationStatus: 'complete',
      exploredAt: Date.now() - EXPLORATION_STALE_MS - 1,
      explored: true,
    });
    expect(isExpandable(node)).toBe(true);
    expect(isExplorationStale(node)).toBe(true);
  });

  it('excludes fresh complete works', () => {
    const node = normalizeExplorationFields({
      id: 1,
      kind: NodeKind.Work,
      key: '1',
      estimatedFreq: 1,
      explorationStatus: 'complete',
      exploredAt: Date.now(),
      explored: true,
    });
    expect(isExpandable(node)).toBe(false);
  });
});

describe('worksSearchUrl', () => {
  it('builds work_search query parameters', () => {
    const url = worksSearchUrl({
      query: 'fluff',
      complete: true,
      fandomNames: ['Harry Potter'],
      ratingIds: 13,
      page: 2,
      freeformNames: ['Hurt/Comfort'],
    });
    expect(url).toContain('https://archiveofourown.org/works/search?');
    expect(url).toContain('page=2');
    expect(url).toContain('work_search%5Bquery%5D=fluff');
    expect(url).toContain('work_search%5Bcomplete%5D=T');
    expect(url).toContain('work_search%5Brating_ids%5D=13');
    expect(url).toContain('Harry');
  });
});

describe('parseListingPagination', () => {
  it('reads next page from pagination markup', () => {
    const html = `
      <ol class="pagination">
        <li class="current">2</li>
        <li class="next"><a href="/tags/Fluff/works?page=3">Next</a></li>
      </ol>
    `;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(parseListingPagination(doc, 'https://archiveofourown.org/tags/Fluff/works?page=2')).toEqual({
      page: 2,
      nextPage: 3,
    });
  });

  it('returns null nextPage when exhausted', () => {
    const html = `<ol class="pagination"><li class="current">3</li></ol>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(parseListingPagination(doc, 'https://archiveofourown.org/tags/Fluff/works?page=3')).toEqual({
      page: 3,
      nextPage: null,
    });
  });
});

describe('DefaultExpansionPolicy', () => {
  it('emits page 2 for a partial tag hub', () => {
    const csr = buildCSR({
      nodes: [
        normalizeExplorationFields({
          id: 1,
          kind: NodeKind.Tag,
          key: 'fluff',
          estimatedFreq: 1,
          explorationStatus: 'partial',
          listingNextPage: 2,
          listingPagesFetched: 1,
          explored: false,
        }),
      ],
      edges: [],
      authorEdges: [],
    });
    const policy = new DefaultExpansionPolicy();
    const frontier = policy.buildFrontier({
      csr,
      relevance: new Float64Array([1]),
      authority: new Float64Array([1]),
      precision: new Float64Array([1]),
    });
    expect(selectNextPlan(csr, frontier)).toEqual({
      type: 'tagListing',
      tagName: 'fluff',
      page: 2,
      marksNodeId: 1,
    });
  });

  it('emits page 1 for a stale complete tag hub', () => {
    const csr = buildCSR({
      nodes: [
        normalizeExplorationFields({
          id: 1,
          kind: NodeKind.Tag,
          key: 'fluff',
          estimatedFreq: 1,
          explorationStatus: 'complete',
          exploredAt: Date.now() - EXPLORATION_STALE_MS - 10,
          listingNextPage: null,
          listingPagesFetched: 3,
          explored: true,
        }),
      ],
      edges: [],
      authorEdges: [],
    });
    const policy = new DefaultExpansionPolicy();
    const frontier = policy.buildFrontier({
      csr,
      relevance: new Float64Array([1]),
      authority: new Float64Array([1]),
      precision: new Float64Array([1]),
    });
    expect(selectNextPlan(csr, frontier)).toEqual({
      type: 'tagListing',
      tagName: 'fluff',
      page: 1,
      marksNodeId: 1,
    });
  });

  it('selectNextPlan returns null only for an empty frontier', () => {
    expect(selectNextPlan(buildCSR({ nodes: [], edges: [], authorEdges: [] }), [])).toBeNull();
  });
});

describe('parseTagPage pagination', () => {
  it('includes page metadata on tag pages', () => {
    const html = `
      <h2 class="heading">Fluff - 40 Works</h2>
      <ol class="pagination"><li class="current">1</li><li class="next"><a href="?page=2">Next</a></li></ol>
      <ol class="work index group"></ol>
    `;
    const parsed = parseTagPageFromHtml(html, 'https://archiveofourown.org/tags/Fluff/works');
    expect(parsed).toMatchObject({ page: 1, nextPage: 2, workCount: 40 });
  });
});

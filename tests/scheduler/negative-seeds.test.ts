import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeTagPage, getWorkNode } from '@/src/storage/db';
import { RequestScheduler } from '@/src/scheduler/scheduler';

const workHtml = `
<html><body>
  <h2 class="title heading">Fetched Work</h2>
  <dl class="work meta group">
    <dd class="words">1,000 Words</dd>
    <dd class="tags"><a class="tag" href="/tags/Example%20Tag">Example Tag</a></dd>
  </dl>
</body></html>`;

describe('RequestScheduler.ensureNegativeSeeds', () => {
  const scheduler = new RequestScheduler();

  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(workHtml, { status: 200 })),
    );

    await mergeTagPage({
      tagName: 'Example Tag',
      workCount: 1,
      works: [
        {
          workId: '100',
          title: 'Listed Work',
          tags: ['Example Tag'],
          authors: [],
          wordCount: 1000,
        },
      ],
      explored: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fully explores listing works that are not yet explored', async () => {
    const before = await getWorkNode('100');
    expect(before?.explored).toBe(false);

    await scheduler.ensureNegativeSeeds([
      {
        kind: 'work',
        workId: '100',
        title: 'Listed Work',
        url: 'https://archiveofourown.org/works/100',
      },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      'https://archiveofourown.org/works/100',
      expect.objectContaining({ headers: { Accept: 'text/html' } }),
    );
    const after = await getWorkNode('100');
    expect(after?.explored).toBe(true);
  });

  it('fetches works that are not yet in the graph', async () => {
    await scheduler.ensureNegativeSeeds([
      {
        kind: 'work',
        workId: '200',
        title: 'Fetched Work',
        url: 'https://archiveofourown.org/works/200',
      },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      'https://archiveofourown.org/works/200',
      expect.objectContaining({ headers: { Accept: 'text/html' } }),
    );
    const node = await getWorkNode('200');
    expect(node?.explored).toBe(true);
  });

  it('skips works that are already explored', async () => {
    await scheduler.ensureNegativeSeeds([
      {
        kind: 'work',
        workId: '200',
        title: 'Fetched Work',
        url: 'https://archiveofourown.org/works/200',
      },
    ]);
    vi.mocked(fetch).mockClear();

    await scheduler.ensureNegativeSeeds([
      {
        kind: 'work',
        workId: '200',
        title: 'Fetched Work',
        url: 'https://archiveofourown.org/works/200',
      },
    ]);

    expect(fetch).not.toHaveBeenCalled();
  });
});

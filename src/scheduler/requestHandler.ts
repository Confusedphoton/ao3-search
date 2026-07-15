import type { NegativeSeed, PositiveSeed } from '../messaging/types';
import { REQUEST_INTERVAL_MS, REQUEST_JITTER_MS, MAX_FETCH_RETRIES } from '../config/constants';
import {
  authorWorksUrl,
  parseAuthorPageFromHtml,
  parseSearchPageFromHtml,
  parseTagPageFromHtml,
  parseWorkPageFromHtml,
  tagWorksUrl,
  workUrl,
  worksSearchUrl,
} from '../ao3';
import type { Ao3WorkSearchParams } from '../ao3/workSearch';
import { isFullyExplored } from '../graph/exploration';
import { NodeKind, type GraphNode } from '../graph/types';
import {
  getAuthorNode,
  getTagNode,
  getWorkNode,
  markNodeExplored,
  mergeAuthorPage,
  mergeSearchPage,
  mergeTagPage,
  mergeWorkPage,
} from '../storage/db';
import { resolveGraphTagName } from '../storage/tagCanonical';
import type { FetchOutcome, FetchPlan } from './types';

export class RateLimiter {
  private lastRequestAt = 0;

  async wait(): Promise<void> {
    const jitter = Math.floor(Math.random() * REQUEST_JITTER_MS);
    const interval = REQUEST_INTERVAL_MS + jitter;
    const elapsed = Date.now() - this.lastRequestAt;
    const delay = Math.max(0, interval - elapsed);
    if (delay > 0) await sleep(delay);
    this.lastRequestAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rate-limited AO3 fetch + merge. Policy decides what to fetch. */
export class RequestHandler {
  private limiter = new RateLimiter();

  async execute(plan: FetchPlan): Promise<FetchOutcome> {
    switch (plan.type) {
      case 'work':
        return this.executeWork(plan.workId, plan.marksNodeId);
      case 'tagListing':
        return this.executeTagListing(plan.tagName, plan.page, plan.marksNodeId);
      case 'authorListing':
        return this.executeAuthorListing(plan.authorKey, plan.page, plan.marksNodeId);
      case 'worksSearch':
        return this.executeWorksSearch(plan.params, plan.marksNodeId);
    }
  }

  async ensurePositiveSeeds(seeds: PositiveSeed[]): Promise<void> {
    for (const seed of seeds) {
      if (seed.kind === 'work') {
        await this.ensureWorkSeed(seed.workId);
        continue;
      }
      if (seed.kind === 'tag') {
        await this.ensureTagSeed(seed.tagName);
        continue;
      }
      await this.ensureAuthorSeed(seed.authorKey);
    }
  }

  async ensureNegativeSeeds(negativeSeeds: NegativeSeed[]): Promise<void> {
    for (const seed of negativeSeeds) {
      if (seed.kind === 'work') {
        await this.ensureWorkSeed(seed.workId);
        continue;
      }
      if (seed.kind === 'tag') {
        await this.ensureTagSeed(seed.tagName);
        continue;
      }
      await this.ensureAuthorSeed(seed.authorKey);
    }
  }

  /** @deprecated Prefer execute(); kept for tests that fetch a work by id. */
  async fetchWork(workId: string): Promise<void> {
    const existing = await getWorkNode(workId);
    await this.execute({
      type: 'work',
      workId,
      marksNodeId: existing?.id ?? -1,
    });
  }

  /**
   * @deprecated Prefer ExpansionPolicy + execute().
   * Kept for tests that expand a snapshot node directly.
   */
  async expandNode(node: GraphNode): Promise<void> {
    if (node.kind === NodeKind.Work) {
      if (isFullyExplored(node)) return;
      await this.execute({ type: 'work', workId: node.key, marksNodeId: node.id });
      return;
    }
    if (node.kind === NodeKind.Author) {
      await this.execute({
        type: 'authorListing',
        authorKey: node.key,
        page: node.listingNextPage ?? 1,
        marksNodeId: node.id,
      });
      return;
    }
    await this.execute({
      type: 'tagListing',
      tagName: node.key,
      page: node.listingNextPage ?? 1,
      marksNodeId: node.id,
    });
  }

  private async ensureWorkSeed(workId: string): Promise<void> {
    const existing = await getWorkNode(workId);
    if (existing && isFullyExplored(existing)) return;
    await this.execute({
      type: 'work',
      workId,
      marksNodeId: existing?.id ?? -1,
    });
  }

  private async ensureTagSeed(tagName: string): Promise<void> {
    const canonicalName = await resolveGraphTagName(tagName);
    const existing = await getTagNode(canonicalName);
    if (existing && isFullyExplored(existing)) return;
    await this.execute({
      type: 'tagListing',
      tagName: canonicalName,
      page: existing?.listingNextPage ?? 1,
      marksNodeId: existing?.id ?? -1,
    });
  }

  private async ensureAuthorSeed(authorKey: string): Promise<void> {
    const existing = await getAuthorNode(authorKey);
    if (existing && isFullyExplored(existing)) return;
    await this.execute({
      type: 'authorListing',
      authorKey,
      page: existing?.listingNextPage ?? 1,
      marksNodeId: existing?.id ?? -1,
    });
  }

  private async executeWork(workId: string, marksNodeId: number): Promise<FetchOutcome> {
    const url = workUrl(workId);
    const html = await this.fetchWithRetry(url);
    const parsed = parseWorkPageFromHtml(html, url);
    if (!parsed) throw new Error(`Failed to parse work page ${workId}`);
    const node = await mergeWorkPage({
      workId: parsed.workId,
      title: parsed.title,
      tags: parsed.tags,
      authors: parsed.authors,
      wordCount: parsed.wordCount,
      meta: parsed.meta,
      explorationStatus: 'complete',
    });
    return {
      requestCount: 1,
      marksNodeId: marksNodeId >= 0 ? marksNodeId : node.id,
      explorationStatus: 'complete',
      listingNextPage: null,
      listingPagesFetched: 0,
      workCount: null,
    };
  }

  private async executeTagListing(
    tagName: string,
    page: number,
    marksNodeId: number,
  ): Promise<FetchOutcome> {
    const url = tagWorksUrl(tagName, page);
    const html = await this.fetchWithRetry(url);
    const parsed = parseTagPageFromHtml(html, url);
    if (!parsed) throw new Error(`Failed to parse tag page ${tagName}`);
    const node = await mergeTagPage({
      tagName: parsed.tagName,
      workCount: parsed.workCount,
      works: parsed.works,
      page: parsed.page,
      nextPage: parsed.nextPage,
    });
    return {
      requestCount: 1,
      marksNodeId: marksNodeId >= 0 ? marksNodeId : node.id,
      explorationStatus: node.explorationStatus,
      listingNextPage: node.listingNextPage,
      listingPagesFetched: node.listingPagesFetched,
      workCount: parsed.workCount,
    };
  }

  private async executeAuthorListing(
    authorKey: string,
    page: number,
    marksNodeId: number,
  ): Promise<FetchOutcome> {
    const url = authorWorksUrl(authorKey, page);
    const html = await this.fetchWithRetry(url);
    const parsed = parseAuthorPageFromHtml(html, url);
    if (!parsed) throw new Error(`Failed to parse author page ${authorKey}`);
    const node = await mergeAuthorPage({
      authorKey: parsed.authorKey,
      displayName: parsed.displayName,
      workCount: parsed.workCount,
      works: parsed.works,
      page: parsed.page,
      nextPage: parsed.nextPage,
    });
    return {
      requestCount: 1,
      marksNodeId: marksNodeId >= 0 ? marksNodeId : node.id,
      explorationStatus: node.explorationStatus,
      listingNextPage: node.listingNextPage,
      listingPagesFetched: node.listingPagesFetched,
      workCount: parsed.workCount,
    };
  }

  private async executeWorksSearch(
    params: Ao3WorkSearchParams,
    marksNodeId?: number,
  ): Promise<FetchOutcome> {
    const url = worksSearchUrl(params);
    const html = await this.fetchWithRetry(url);
    const parsed = parseSearchPageFromHtml(html, url);
    if (!parsed) throw new Error(`Failed to parse search page ${url}`);

    const hubId = marksNodeId != null && marksNodeId >= 0 ? marksNodeId : undefined;
    await mergeSearchPage({
      works: parsed.works,
      marksNodeId: hubId,
      workCount: parsed.workCount,
      page: parsed.page,
      nextPage: parsed.nextPage,
    });

    const explorationStatus =
      parsed.nextPage != null ? 'partial' : hubId != null ? 'complete' : 'unexplored';

    return {
      requestCount: 1,
      marksNodeId: hubId,
      explorationStatus,
      listingNextPage: parsed.nextPage,
      listingPagesFetched: parsed.page,
      workCount: parsed.workCount,
    };
  }

  private async fetchWithRetry(url: string): Promise<string> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
      await this.limiter.wait();
      try {
        const response = await fetch(url, {
          credentials: 'omit',
          headers: { Accept: 'text/html' },
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`HTTP ${response.status} for ${url}`);
          await sleep(REQUEST_INTERVAL_MS * (attempt + 2));
          continue;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return await response.text();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(REQUEST_INTERVAL_MS * (attempt + 1));
      }
    }
    throw lastError ?? new Error(`Failed to fetch ${url}`);
  }
}

/** Back-compat alias used by existing imports. */
export class RequestScheduler extends RequestHandler {}

export async function resolveNode(nodeId: number, snapshotNodes: GraphNode[]): Promise<GraphNode | null> {
  return snapshotNodes.find((n) => n.id === nodeId) ?? null;
}

export { getAuthorNode, getWorkNode, getTagNode, markNodeExplored };

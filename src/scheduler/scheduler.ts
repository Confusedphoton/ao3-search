import type { NegativeSeed } from '../messaging/types';
import { REQUEST_INTERVAL_MS, REQUEST_JITTER_MS, MAX_FETCH_RETRIES } from '../config/constants';
import { parseTagPageFromHtml, parseWorkPageFromHtml, tagWorksUrl, workUrl } from '../ao3';
import type { GraphNode } from '../graph/types';
import { NodeKind } from '../graph/types';
import { getTagNode, getWorkNode, markNodeExplored, mergeTagPage, mergeWorkPage } from '../storage/db';

export interface FetchResult {
  html: string;
  url: string;
}

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

export class RequestScheduler {
  private limiter = new RateLimiter();

  async fetchWork(workId: string): Promise<void> {
    const url = workUrl(workId);
    const html = await this.fetchWithRetry(url);
    const parsed = parseWorkPageFromHtml(html, url);
    if (!parsed) throw new Error(`Failed to parse work page ${workId}`);
    await mergeWorkPage({
      workId: parsed.workId,
      title: parsed.title,
      tags: parsed.tags,
      explored: true,
    });
  }

  async expandNode(node: GraphNode): Promise<void> {
    if (node.explored) return;

    if (node.kind === NodeKind.Work) {
      await this.fetchWork(node.key);
      return;
    }

    const url = tagWorksUrl(node.key);
    const html = await this.fetchWithRetry(url);
    const parsed = parseTagPageFromHtml(html, url);
    if (!parsed) throw new Error(`Failed to parse tag page ${node.key}`);
    await mergeTagPage({
      tagName: parsed.tagName,
      workCount: parsed.workCount,
      workIds: parsed.workIds,
      explored: true,
    });
  }

  async ensureSeedWorks(workIds: string[]): Promise<void> {
    for (const workId of workIds) {
      const existing = await getWorkNode(workId);
      if (existing?.explored) continue;
      await this.fetchWork(workId);
    }
  }

  async ensureNegativeSeeds(negativeSeeds: NegativeSeed[]): Promise<void> {
    for (const seed of negativeSeeds) {
      if (seed.kind === 'work') {
        const existing = await getWorkNode(seed.workId);
        if (existing?.explored) continue;
        await this.fetchWork(seed.workId);
        continue;
      }

      const existing = await getTagNode(seed.tagName);
      if (existing?.explored) continue;

      const url = tagWorksUrl(seed.tagName);
      const html = await this.fetchWithRetry(url);
      const parsed = parseTagPageFromHtml(html, url);
      if (!parsed) throw new Error(`Failed to parse tag page ${seed.tagName}`);
      await mergeTagPage({
        tagName: parsed.tagName,
        workCount: parsed.workCount,
        workIds: parsed.workIds,
        explored: true,
      });
    }
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

export async function resolveNode(nodeId: number, snapshotNodes: GraphNode[]): Promise<GraphNode | null> {
  return snapshotNodes.find((n) => n.id === nodeId) ?? null;
}

export { getWorkNode, getTagNode, markNodeExplored };

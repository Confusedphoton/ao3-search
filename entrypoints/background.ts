import type { PageData } from '@/src/ao3/types';
import { tagWorksUrl } from '@/src/ao3/types';
import type { ExtensionMessage, NegativeSeed, SeedWork, SearchProgressPayload } from '@/src/messaging/types';
import { MAX_NEGATIVE_SEEDS, MAX_SEEDS } from '@/src/config/constants';
import { mergeTagPage, mergeWorkPage } from '@/src/storage/db';
import { broadcast, onMessage } from '@/src/messaging/protocol';
import { SearchOrchestrator } from '@/src/search/orchestrator';

const seeds: SeedWork[] = [];
const negativeSeeds: NegativeSeed[] = [];
let searching = false;
let orchestrator: SearchOrchestrator | null = null;

async function persistSeeds(): Promise<void> {
  await browser.storage.local.set({ seeds, negativeSeeds });
}

async function loadSeeds(): Promise<void> {
  const stored = await browser.storage.local.get(['seeds', 'negativeSeeds']);
  if (Array.isArray(stored.seeds)) {
    seeds.splice(0, seeds.length, ...(stored.seeds as SeedWork[]));
  }
  if (Array.isArray(stored.negativeSeeds)) {
    negativeSeeds.splice(0, negativeSeeds.length, ...(stored.negativeSeeds as NegativeSeed[]));
  }
}

function stateUpdate(
  searchingNow: boolean,
  progress: SearchProgressPayload | null = null,
): ExtensionMessage {
  return {
    type: 'StateUpdate',
    seeds: [...seeds],
    negativeSeeds: [...negativeSeeds],
    searching: searchingNow,
    progress,
  };
}

async function ingestPageData(payload: PageData): Promise<void> {
  if (searching) return;
  if (payload.kind === 'work') {
    await mergeWorkPage({
      workId: payload.workId,
      title: payload.title,
      tags: payload.tags,
      explored: true,
    });
  } else {
    await mergeTagPage({
      tagName: payload.tagName,
      workCount: payload.workCount,
      workIds: payload.workIds,
      explored: true,
    });
  }
}

function isPositiveWorkSeed(workId: string): boolean {
  return seeds.some((s) => s.workId === workId);
}

function isNegativeWorkSeed(workId: string): boolean {
  return negativeSeeds.some((s) => s.kind === 'work' && s.workId === workId);
}

function isNegativeTagSeed(tagName: string): boolean {
  return negativeSeeds.some((s) => s.kind === 'tag' && s.tagName === tagName);
}

async function addSeedFromTab(sender: Browser.runtime.MessageSender): Promise<ExtensionMessage> {
  const tabId = sender.tab?.id;
  if (!tabId) return stateUpdate(searching);

  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const url = location.href;
      const match = url.match(/\/works\/(\d+)/);
      const title =
        document.querySelector('h2.title.heading')?.textContent?.trim() ?? document.title;
      return { url, workId: match?.[1] ?? null, title };
    },
  });

  const info = results[0]?.result as { url: string; workId: string | null; title: string } | undefined;
  if (!info?.workId) return stateUpdate(searching);

  if (isPositiveWorkSeed(info.workId) || isNegativeWorkSeed(info.workId)) {
    return stateUpdate(searching);
  }

  if (seeds.length >= MAX_SEEDS) {
    return stateUpdate(searching);
  }

  seeds.push({
    workId: info.workId,
    title: info.title || `Work ${info.workId}`,
    url: info.url,
  });
  await persistSeeds();
  return stateUpdate(searching);
}

async function addNegativeWorkFromTab(sender: Browser.runtime.MessageSender): Promise<ExtensionMessage> {
  const tabId = sender.tab?.id;
  if (!tabId) return stateUpdate(searching);

  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const url = location.href;
      const match = url.match(/\/works\/(\d+)/);
      const title =
        document.querySelector('h2.title.heading')?.textContent?.trim() ?? document.title;
      return { url, workId: match?.[1] ?? null, title };
    },
  });

  const info = results[0]?.result as { url: string; workId: string | null; title: string } | undefined;
  if (!info?.workId) return stateUpdate(searching);

  if (isPositiveWorkSeed(info.workId) || isNegativeWorkSeed(info.workId)) {
    return stateUpdate(searching);
  }

  if (negativeSeeds.length >= MAX_NEGATIVE_SEEDS) {
    return stateUpdate(searching);
  }

  negativeSeeds.push({
    kind: 'work',
    workId: info.workId,
    title: info.title || `Work ${info.workId}`,
    url: info.url,
  });
  await persistSeeds();
  return stateUpdate(searching);
}

async function addNegativeTagFromTab(sender: Browser.runtime.MessageSender): Promise<ExtensionMessage> {
  const tabId = sender.tab?.id;
  if (!tabId) return stateUpdate(searching);

  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const url = location.href;
      const match = url.match(/\/tags\/([^/]+)\/works/);
      const tagName = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
      return { url, tagName };
    },
  });

  const info = results[0]?.result as { url: string; tagName: string | null } | undefined;
  if (!info?.tagName) return stateUpdate(searching);

  if (isNegativeTagSeed(info.tagName)) {
    return stateUpdate(searching);
  }

  if (negativeSeeds.length >= MAX_NEGATIVE_SEEDS) {
    return stateUpdate(searching);
  }

  negativeSeeds.push({
    kind: 'tag',
    tagName: info.tagName,
    url: info.url,
  });
  await persistSeeds();
  return stateUpdate(searching);
}

async function addNegativeTag(tagName: string): Promise<ExtensionMessage> {
  const trimmed = tagName.trim();
  if (!trimmed || isNegativeTagSeed(trimmed)) {
    return stateUpdate(searching);
  }

  if (negativeSeeds.length >= MAX_NEGATIVE_SEEDS) {
    return stateUpdate(searching);
  }

  negativeSeeds.push({
    kind: 'tag',
    tagName: trimmed,
    url: tagWorksUrl(trimmed),
  });
  await persistSeeds();
  return stateUpdate(searching);
}

onMessage(async (message, sender) => {
  switch (message.type) {
    case 'GetState':
      return stateUpdate(searching);

    case 'PageDataIngested':
      await ingestPageData(message.payload);
      return;

    case 'AddSeedFromTab':
      return addSeedFromTab(sender);

    case 'AddNegativeWorkFromTab':
      return addNegativeWorkFromTab(sender);

    case 'AddNegativeTagFromTab':
      return addNegativeTagFromTab(sender);

    case 'AddNegativeTag':
      return addNegativeTag(message.tagName);

    case 'RemoveSeed': {
      const index = seeds.findIndex((s) => s.workId === message.workId);
      if (index >= 0) seeds.splice(index, 1);
      await persistSeeds();
      return stateUpdate(searching);
    }

    case 'RemoveNegativeSeed': {
      const index = negativeSeeds.findIndex((s) =>
        s.kind === message.kind && (s.kind === 'work' ? s.workId === message.key : s.tagName === message.key),
      );
      if (index >= 0) negativeSeeds.splice(index, 1);
      await persistSeeds();
      return stateUpdate(searching);
    }

    case 'CancelSearch':
      orchestrator?.cancel();
      searching = false;
      await broadcast(stateUpdate(false));
      return stateUpdate(false);

    case 'StartSearch': {
      if (searching || seeds.length === 0) return stateUpdate(searching);
      searching = true;
      orchestrator = new SearchOrchestrator();
      void runSearch(orchestrator);
      return stateUpdate(true);
    }

    default:
      return undefined;
  }
});

async function runSearch(search: SearchOrchestrator): Promise<void> {
  let lastRequestsUsed = 0;
  try {
    const { results, requestsUsed } = await search.run(seeds, negativeSeeds, async (payload) => {
      lastRequestsUsed = payload.requestsUsed;
      await broadcast({ type: 'SearchProgress', payload });
      await broadcast(stateUpdate(true, payload));
    });
    await broadcast({
      type: 'SearchResults',
      payload: { results, requestsUsed },
    });
  } catch (err) {
    console.error('[ao3-search] search failed', err);
    await broadcast({
      type: 'SearchProgress',
      payload: {
        phase: 'error',
        requestsUsed: lastRequestsUsed,
        expansionBudget: 0,
        frontierSize: 0,
        message: err instanceof Error ? err.message : String(err),
      },
    });
  } finally {
    searching = false;
    orchestrator = null;
    await broadcast(stateUpdate(false));
  }
}

export default defineBackground(async () => {
  await loadSeeds();
  console.log('[ao3-search] background ready');
});

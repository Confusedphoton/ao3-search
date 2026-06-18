import type { PageData } from '@/src/ao3/types';
import type { ExtensionMessage, SeedWork, SearchProgressPayload } from '@/src/messaging/types';
import { MAX_SEEDS } from '@/src/config/constants';
import { mergeTagPage, mergeWorkPage } from '@/src/storage/db';
import { broadcast, onMessage } from '@/src/messaging/protocol';
import { SearchOrchestrator } from '@/src/search/orchestrator';

const seeds: SeedWork[] = [];
let searching = false;
let orchestrator: SearchOrchestrator | null = null;

async function persistSeeds(): Promise<void> {
  await browser.storage.local.set({ seeds });
}

async function loadSeeds(): Promise<void> {
  const stored = await browser.storage.local.get('seeds');
  if (Array.isArray(stored.seeds)) {
    seeds.splice(0, seeds.length, ...(stored.seeds as SeedWork[]));
  }
}

function stateUpdate(
  searchingNow: boolean,
  progress: SearchProgressPayload | null = null,
): ExtensionMessage {
  return {
    type: 'StateUpdate',
    seeds: [...seeds],
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

  if (seeds.some((s) => s.workId === info.workId)) {
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

onMessage(async (message, sender) => {
  switch (message.type) {
    case 'GetState':
      return stateUpdate(searching);

    case 'PageDataIngested':
      await ingestPageData(message.payload);
      return;

    case 'AddSeedFromTab':
      return addSeedFromTab(sender);

    case 'RemoveSeed': {
      const index = seeds.findIndex((s) => s.workId === message.workId);
      if (index >= 0) seeds.splice(index, 1);
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
    const { results, requestsUsed } = await search.run(seeds, async (payload) => {
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

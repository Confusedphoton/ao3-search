import type { PageData } from '@/src/ao3/types';
import {
  authorWorksUrl,
  decodeAo3TagParam,
  parseAuthorKeyFromUrl,
  tagWorksUrl,
} from '@/src/ao3/types';
import type {
  ExtensionMessage,
  GraphTagMatch,
  NegativeSeed,
  PositiveSeed,
  SearchProgressPayload,
  SearchResultItem,
  SuppressedWork,
} from '@/src/messaging/types';
import { EXPANSION_BUDGET } from '@/src/config/constants';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  SETTINGS_STORAGE_KEY,
  settingsFromStorageChange,
  type TunableSettings,
} from '@/src/config/settings';
import { mergeAuthorPage, mergeSearchPage, mergeTagPage, mergeWorkPage, searchTagNodes } from '@/src/storage/db';
import { exportGraph, getGraphStats, importGraph, parseGraphExport } from '@/src/storage/graphIo';
import { resolveGraphTagName } from '@/src/storage/tagCanonical';
import { broadcast, onMessage } from '@/src/messaging/protocol';
import { registerStatsImportPort } from '@/src/messaging/statsImportPort';
import { SearchOrchestrator } from '@/src/search/orchestrator';

const seeds: PositiveSeed[] = [];
const negativeSeeds: NegativeSeed[] = [];
const suppressedWorks: SuppressedWork[] = [];
let searching = false;
let orchestrator: SearchOrchestrator | null = null;
let lastResults: SearchResultItem[] = [];
let lastProgress: SearchProgressPayload | null = null;
let ready: Promise<void> | null = null;
let settings: TunableSettings = { ...DEFAULT_SETTINGS };

function suppressedWorkIds(): string[] {
  return suppressedWorks.map((work) => work.workId);
}

function filterSuppressedResults(results: SearchResultItem[]): SearchResultItem[] {
  const limit = settings.topResults;
  if (suppressedWorks.length === 0) return results.slice(0, limit);
  const hidden = new Set(suppressedWorkIds());
  return results.filter((item) => !hidden.has(item.workId)).slice(0, limit);
}

function visibleResults(): SearchResultItem[] {
  return filterSuppressedResults(lastResults);
}

function visibleProgress(
  progress: SearchProgressPayload | null,
): SearchProgressPayload | null {
  if (!progress?.previewResults) return progress;
  return { ...progress, previewResults: filterSuppressedResults(progress.previewResults) };
}

async function persistUiState(): Promise<void> {
  await browser.storage.local.set({
    seeds,
    negativeSeeds,
    suppressedWorks,
    lastResults,
    lastProgress,
  });
}

async function loadPersistedState(): Promise<void> {
  settings = await loadSettings();
  const stored = await browser.storage.local.get([
    'seeds',
    'negativeSeeds',
    'suppressedWorks',
    'lastResults',
    'lastProgress',
  ]);
  if (Array.isArray(stored.seeds)) {
    const normalized = stored.seeds
      .map((seed) => normalizeStoredSeed(seed))
      .filter((seed): seed is PositiveSeed => seed !== null);
    seeds.splice(0, seeds.length, ...normalized);
  }
  if (Array.isArray(stored.negativeSeeds)) {
    const normalized = stored.negativeSeeds
      .map((seed) => normalizeStoredNegativeSeed(seed))
      .filter((seed): seed is NegativeSeed => seed !== null);
    negativeSeeds.splice(0, negativeSeeds.length, ...normalized);
  }
  if (Array.isArray(stored.suppressedWorks)) {
    const normalized = stored.suppressedWorks
      .map((work) => normalizeStoredSuppressedWork(work))
      .filter((work): work is SuppressedWork => work !== null);
    suppressedWorks.splice(0, suppressedWorks.length, ...normalized);
  }
  if (Array.isArray(stored.lastResults)) {
    lastResults = stored.lastResults as SearchResultItem[];
  }
  if (stored.lastProgress && typeof stored.lastProgress === 'object') {
    lastProgress = normalizeStoredProgress(stored.lastProgress as SearchProgressPayload);
  }
}

function normalizeStoredProgress(progress: SearchProgressPayload): SearchProgressPayload {
  if (progress.expansionBudget > 0) return progress;
  return { ...progress, expansionBudget: EXPANSION_BUDGET };
}

function ensureReady(): Promise<void> {
  if (!ready) ready = loadPersistedState();
  return ready;
}

function normalizeStoredSeed(raw: unknown): PositiveSeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.kind === 'tag' && typeof record.tagName === 'string') {
    return {
      kind: 'tag',
      tagName: record.tagName,
      url: typeof record.url === 'string' ? record.url : tagWorksUrl(record.tagName),
    };
  }
  if (record.kind === 'author' && typeof record.authorKey === 'string') {
    return {
      kind: 'author',
      authorKey: record.authorKey,
      displayName:
        typeof record.displayName === 'string' ? record.displayName : record.authorKey,
      url: typeof record.url === 'string' ? record.url : authorWorksUrl(record.authorKey),
    };
  }
  if (typeof record.workId === 'string') {
    return {
      kind: 'work',
      workId: record.workId,
      title: typeof record.title === 'string' ? record.title : `Work ${record.workId}`,
      url: typeof record.url === 'string' ? record.url : `https://archiveofourown.org/works/${record.workId}`,
    };
  }
  return null;
}

function normalizeStoredNegativeSeed(raw: unknown): NegativeSeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.kind === 'tag' && typeof record.tagName === 'string') {
    return {
      kind: 'tag',
      tagName: record.tagName,
      url: typeof record.url === 'string' ? record.url : tagWorksUrl(record.tagName),
    };
  }
  if (record.kind === 'author' && typeof record.authorKey === 'string') {
    return {
      kind: 'author',
      authorKey: record.authorKey,
      displayName:
        typeof record.displayName === 'string' ? record.displayName : record.authorKey,
      url: typeof record.url === 'string' ? record.url : authorWorksUrl(record.authorKey),
    };
  }
  if (typeof record.workId === 'string') {
    return {
      kind: 'work',
      workId: record.workId,
      title: typeof record.title === 'string' ? record.title : `Work ${record.workId}`,
      url: typeof record.url === 'string' ? record.url : `https://archiveofourown.org/works/${record.workId}`,
    };
  }
  return null;
}

function normalizeStoredSuppressedWork(raw: unknown): SuppressedWork | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.workId !== 'string') return null;
  return {
    workId: record.workId,
    title: typeof record.title === 'string' ? record.title : `Work ${record.workId}`,
    url:
      typeof record.url === 'string'
        ? record.url
        : `https://archiveofourown.org/works/${record.workId}`,
  };
}

function authorDisplayNameFromTitle(authorKey: string, title: string): string {
  return title.replace(/\s*-\s*Works.*$/i, '').replace(/^Works by\s+/i, '').trim() || authorKey;
}

function stateUpdate(
  searchingNow: boolean,
  progress: SearchProgressPayload | null = null,
): ExtensionMessage {
  const rawProgress = progress ?? (searchingNow ? null : lastProgress);
  const effectiveProgress = rawProgress ? normalizeStoredProgress(rawProgress) : null;
  return {
    type: 'StateUpdate',
    seeds: [...seeds],
    negativeSeeds: [...negativeSeeds],
    suppressedWorks: [...suppressedWorks],
    searching: searchingNow,
    progress: visibleProgress(effectiveProgress),
    results: visibleResults(),
  };
}

async function publishState(progress: SearchProgressPayload | null = null): Promise<void> {
  await broadcast(stateUpdate(searching, progress));
}

async function getActiveTabId(sender: Browser.runtime.MessageSender): Promise<number | undefined> {
  if (sender.tab?.id != null) return sender.tab.id;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function readTabPageInfo(tabId: number): Promise<{
  url: string;
  workId: string | null;
  tagName: string | null;
  authorKey: string | null;
  title: string;
}> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const url = location.href;
      const workMatch = url.match(/\/works\/(\d+)/);
      const tagMatch = url.match(/\/tags\/([^/]+)\/works/);
      // Return the raw path segment; background decodes AO3 *s*/*a*/… tokens.
      const tagParam = tagMatch?.[1] ?? null;
      const title =
        document.querySelector('h2.title.heading')?.textContent?.trim() ??
        document.querySelector('h2.heading')?.textContent?.trim() ??
        document.title;
      return { url, workId: workMatch?.[1] ?? null, tagParam, title };
    },
  });

  const raw =
    (results[0]?.result as {
      url: string;
      workId: string | null;
      tagParam: string | null;
      title: string;
    } | undefined) ?? { url: '', workId: null, tagParam: null, title: '' };

  return {
    url: raw.url,
    workId: raw.workId,
    tagName: raw.tagParam ? decodeAo3TagParam(raw.tagParam) : null,
    title: raw.title,
    authorKey: parseAuthorKeyFromUrl(raw.url),
  };
}

async function publishGraphStats(): Promise<void> {
  await broadcast({ type: 'GraphStats', stats: await getGraphStats() });
}

async function ingestPageData(payload: PageData): Promise<void> {
  if (searching) return;
  if (payload.kind === 'work') {
    await mergeWorkPage({
      workId: payload.workId,
      title: payload.title,
      tags: payload.tags,
      authors: payload.authors,
      wordCount: payload.wordCount,
      meta: payload.meta,
      explored: true,
    });
  } else if (payload.kind === 'tag') {
    await mergeTagPage({
      tagName: payload.tagName,
      workCount: payload.workCount,
      works: payload.works,
      explored: true,
    });
  } else if (payload.kind === 'search') {
    await mergeSearchPage({ works: payload.works });
  } else {
    await mergeAuthorPage({
      authorKey: payload.authorKey,
      displayName: payload.displayName,
      workCount: payload.workCount,
      works: payload.works,
      explored: true,
    });
  }
  await publishGraphStats();
}

function isPositiveWorkSeed(workId: string): boolean {
  return seeds.some((s) => s.kind === 'work' && s.workId === workId);
}

function isPositiveTagSeed(tagName: string): boolean {
  return seeds.some((s) => s.kind === 'tag' && s.tagName === tagName);
}

function isNegativeWorkSeed(workId: string): boolean {
  return negativeSeeds.some((s) => s.kind === 'work' && s.workId === workId);
}

function isNegativeTagSeed(tagName: string): boolean {
  return negativeSeeds.some((s) => s.kind === 'tag' && s.tagName === tagName);
}

function isPositiveAuthorSeed(authorKey: string): boolean {
  return seeds.some((s) => s.kind === 'author' && s.authorKey === authorKey);
}

function isNegativeAuthorSeed(authorKey: string): boolean {
  return negativeSeeds.some((s) => s.kind === 'author' && s.authorKey === authorKey);
}

function positiveSeedKey(seed: PositiveSeed): string {
  if (seed.kind === 'work') return seed.workId;
  if (seed.kind === 'tag') return seed.tagName;
  return seed.authorKey;
}

function negativeSeedKey(seed: NegativeSeed): string {
  if (seed.kind === 'work') return seed.workId;
  if (seed.kind === 'tag') return seed.tagName;
  return seed.authorKey;
}

async function addSeedFromTab(sender: Browser.runtime.MessageSender): Promise<ExtensionMessage> {
  const tabId = await getActiveTabId(sender);
  if (!tabId) return stateUpdate(searching);

  const info = await readTabPageInfo(tabId);
  if (info.workId) {
    if (isPositiveWorkSeed(info.workId) || isNegativeWorkSeed(info.workId)) {
      return stateUpdate(searching);
    }
    if (seeds.length >= settings.maxSeeds) return stateUpdate(searching);

    seeds.push({
      kind: 'work',
      workId: info.workId,
      title: info.title || `Work ${info.workId}`,
      url: info.url,
    });
    await persistUiState();
    await publishState();
    return stateUpdate(searching);
  }

  if (info.tagName) {
    const tagName = await resolveGraphTagName(info.tagName);
    if (isPositiveTagSeed(tagName) || isNegativeTagSeed(tagName)) {
      return stateUpdate(searching);
    }
    if (seeds.length >= settings.maxSeeds) return stateUpdate(searching);

    seeds.push({
      kind: 'tag',
      tagName,
      url: info.url,
    });
    await persistUiState();
    await publishState();
    return stateUpdate(searching);
  }

  if (info.authorKey) {
    if (isPositiveAuthorSeed(info.authorKey) || isNegativeAuthorSeed(info.authorKey)) {
      return stateUpdate(searching);
    }
    if (seeds.length >= settings.maxSeeds) return stateUpdate(searching);

    seeds.push({
      kind: 'author',
      authorKey: info.authorKey,
      displayName: authorDisplayNameFromTitle(info.authorKey, info.title),
      url: authorWorksUrl(info.authorKey),
    });
    await persistUiState();
    await publishState();
  }

  return stateUpdate(searching);
}

async function addSeedTag(tagName: string): Promise<ExtensionMessage> {
  const trimmed = (await resolveGraphTagName(tagName)).trim();
  if (!trimmed || isPositiveTagSeed(trimmed) || isNegativeTagSeed(trimmed)) {
    return stateUpdate(searching);
  }
  if (seeds.length >= settings.maxSeeds) return stateUpdate(searching);

  seeds.push({
    kind: 'tag',
    tagName: trimmed,
    url: tagWorksUrl(trimmed),
  });
  await persistUiState();
  await publishState();
  return stateUpdate(searching);
}

async function addNegativeWorkFromTab(sender: Browser.runtime.MessageSender): Promise<ExtensionMessage> {
  const tabId = await getActiveTabId(sender);
  if (!tabId) return stateUpdate(searching);

  const info = await readTabPageInfo(tabId);

  if (info.workId) {
    if (isPositiveWorkSeed(info.workId) || isNegativeWorkSeed(info.workId)) {
      return stateUpdate(searching);
    }
    if (negativeSeeds.length >= settings.maxNegativeSeeds) return stateUpdate(searching);

    negativeSeeds.push({
      kind: 'work',
      workId: info.workId,
      title: info.title || `Work ${info.workId}`,
      url: info.url,
    });
    await persistUiState();
    await publishState();
    return stateUpdate(searching);
  }

  if (info.tagName) {
    const tagName = await resolveGraphTagName(info.tagName);
    if (isPositiveTagSeed(tagName) || isNegativeTagSeed(tagName)) {
      return stateUpdate(searching);
    }
    if (negativeSeeds.length >= settings.maxNegativeSeeds) return stateUpdate(searching);

    negativeSeeds.push({
      kind: 'tag',
      tagName,
      url: info.url,
    });
    await persistUiState();
    await publishState();
    return stateUpdate(searching);
  }

  if (info.authorKey) {
    if (isPositiveAuthorSeed(info.authorKey) || isNegativeAuthorSeed(info.authorKey)) {
      return stateUpdate(searching);
    }
    if (negativeSeeds.length >= settings.maxNegativeSeeds) return stateUpdate(searching);

    negativeSeeds.push({
      kind: 'author',
      authorKey: info.authorKey,
      displayName: authorDisplayNameFromTitle(info.authorKey, info.title),
      url: authorWorksUrl(info.authorKey),
    });
    await persistUiState();
    await publishState();
  }

  return stateUpdate(searching);
}

async function addNegativeTagFromTab(sender: Browser.runtime.MessageSender): Promise<ExtensionMessage> {
  const tabId = await getActiveTabId(sender);
  if (!tabId) return stateUpdate(searching);

  const info = await readTabPageInfo(tabId);
  if (!info.tagName) return stateUpdate(searching);

  const tagName = await resolveGraphTagName(info.tagName);
  if (isPositiveTagSeed(tagName) || isNegativeTagSeed(tagName)) {
    return stateUpdate(searching);
  }

  if (negativeSeeds.length >= settings.maxNegativeSeeds) {
    return stateUpdate(searching);
  }

  negativeSeeds.push({
    kind: 'tag',
    tagName,
    url: info.url,
  });
  await persistUiState();
  await publishState();
  return stateUpdate(searching);
}

async function addNegativeTag(tagName: string): Promise<ExtensionMessage> {
  const trimmed = (await resolveGraphTagName(tagName)).trim();
  if (!trimmed || isNegativeTagSeed(trimmed) || isPositiveTagSeed(trimmed)) {
    return stateUpdate(searching);
  }

  if (negativeSeeds.length >= settings.maxNegativeSeeds) {
    return stateUpdate(searching);
  }

  negativeSeeds.push({
    kind: 'tag',
    tagName: trimmed,
    url: tagWorksUrl(trimmed),
  });
  await persistUiState();
  await publishState();
  return stateUpdate(searching);
}

async function toggleSuppressWorkFromTab(
  sender: Browser.runtime.MessageSender,
): Promise<ExtensionMessage> {
  const tabId = await getActiveTabId(sender);
  if (!tabId) return stateUpdate(searching);

  const info = await readTabPageInfo(tabId);
  if (!info.workId) return stateUpdate(searching);

  const existing = suppressedWorks.findIndex((work) => work.workId === info.workId);
  if (existing >= 0) {
    suppressedWorks.splice(existing, 1);
  } else {
    suppressedWorks.push({
      workId: info.workId,
      title: info.title || `Work ${info.workId}`,
      url: info.url,
    });
  }
  await persistUiState();
  await publishState();
  return stateUpdate(searching);
}

async function unsuppressWork(workId: string): Promise<ExtensionMessage> {
  const index = suppressedWorks.findIndex((work) => work.workId === workId);
  if (index >= 0) suppressedWorks.splice(index, 1);
  await persistUiState();
  await publishState();
  return stateUpdate(searching);
}

async function searchGraphTags(query: string): Promise<ExtensionMessage> {
  const nodes = await searchTagNodes(query, 10);
  const tags: GraphTagMatch[] = nodes.map((node) => ({
    tagName: node.key,
    workCount: node.calibratedFreq,
  }));
  return { type: 'GraphTagResults', tags };
}

onMessage(async (message, sender) => {
  await ensureReady();

  switch (message.type) {
    case 'GetState':
      return stateUpdate(searching);

    case 'PageDataIngested':
      await ingestPageData(message.payload);
      return;

    case 'AddSeedFromTab':
      return addSeedFromTab(sender);

    case 'AddSeedTag':
      return addSeedTag(message.tagName);

    case 'SearchGraphTags':
      return searchGraphTags(message.query);

    case 'GetGraphStats':
      return { type: 'GraphStats', stats: await getGraphStats() };

    case 'ExportGraph':
      if (searching) {
        return {
          type: 'GraphImportResult',
          success: false,
          message: 'Cannot export while a search is running.',
          stats: null,
        };
      }
      return { type: 'GraphExported', export: await exportGraph() };

    case 'ImportGraph':
      if (searching) {
        return {
          type: 'GraphImportResult',
          success: false,
          message: 'Cannot import while a search is running.',
          stats: null,
        };
      }
      {
        const parsed = parseGraphExport(message.export);
        if (!parsed) {
          return {
            type: 'GraphImportResult',
            success: false,
            message: 'Invalid graph file.',
            stats: null,
          };
        }
        const stats = await importGraph(parsed, message.mode);
        return {
          type: 'GraphImportResult',
          success: true,
          message:
            message.mode === 'overwrite'
              ? `Replaced graph with ${stats.nodeCount.toLocaleString()} nodes.`
              : `Merged graph — now ${stats.nodeCount.toLocaleString()} nodes.`,
          stats,
        };
      }

    case 'AddNegativeWorkFromTab':
      return addNegativeWorkFromTab(sender);

    case 'AddNegativeTagFromTab':
      return addNegativeTagFromTab(sender);

    case 'AddNegativeTag':
      return addNegativeTag(message.tagName);

    case 'RemoveSeed': {
      const index = seeds.findIndex(
        (s) => s.kind === message.kind && positiveSeedKey(s) === message.key,
      );
      if (index >= 0) seeds.splice(index, 1);
      await persistUiState();
      await publishState();
      return stateUpdate(searching);
    }

    case 'RemoveNegativeSeed': {
      const index = negativeSeeds.findIndex(
        (s) => s.kind === message.kind && negativeSeedKey(s) === message.key,
      );
      if (index >= 0) negativeSeeds.splice(index, 1);
      await persistUiState();
      await publishState();
      return stateUpdate(searching);
    }

    case 'ToggleSuppressWorkFromTab':
      return toggleSuppressWorkFromTab(sender);

    case 'UnsuppressWork':
      return unsuppressWork(message.workId);

    case 'CancelSearch':
      orchestrator?.cancel();
      searching = false;
      await publishState();
      return stateUpdate(false);

    case 'StartSearch': {
      if (searching || seeds.length === 0) return stateUpdate(searching);
      searching = true;
      lastResults = [];
      lastProgress = null;
      orchestrator = new SearchOrchestrator();
      void runSearch(orchestrator, 'start');
      await persistUiState();
      await publishState();
      return stateUpdate(true);
    }

    case 'ContinueSearch': {
      if (searching || seeds.length === 0 || lastResults.length === 0) return stateUpdate(searching);
      const initialRequestsUsed = lastProgress?.requestsUsed ?? 0;
      searching = true;
      orchestrator = new SearchOrchestrator();
      void runSearch(orchestrator, 'continue', initialRequestsUsed);
      await persistUiState();
      await publishState();
      return stateUpdate(true);
    }

    default:
      return undefined;
  }
});

async function runSearch(
  search: SearchOrchestrator,
  mode: 'start' | 'continue',
  initialRequestsUsed = 0,
): Promise<void> {
  let lastRequestsUsed = initialRequestsUsed;

  async function onSearchProgress(payload: SearchProgressPayload): Promise<void> {
    lastRequestsUsed = payload.requestsUsed;
    lastProgress = payload;
    if (payload.previewResults) {
      lastResults = payload.previewResults;
    }
    await persistUiState();
    const visiblePayload = visibleProgress(payload) ?? payload;
    await broadcast({ type: 'SearchProgress', payload: visiblePayload });
    await broadcast(stateUpdate(true, payload));
  }

  try {
    const run =
      mode === 'continue'
        ? search.continueRun(
            seeds,
            negativeSeeds,
            suppressedWorkIds(),
            initialRequestsUsed,
            onSearchProgress,
          )
        : search.run(seeds, negativeSeeds, suppressedWorkIds(), onSearchProgress);

    const { results, requestsUsed } = await run;
    lastResults = results;
    const displayed = visibleResults();
    if (!lastProgress || lastProgress.phase !== 'done') {
      lastProgress = {
        phase: 'done',
        requestsUsed,
        expansionBudget: requestsUsed,
        frontierSize: 0,
        message: `Found ${displayed.length} works`,
        previewResults: results,
      };
    }
    await persistUiState();
    await broadcast({
      type: 'SearchResults',
      payload: {
        results: displayed,
        requestsUsed,
        expansionBudget: lastProgress.expansionBudget,
        frontierSize: lastProgress.frontierSize,
      },
    });
  } catch (err) {
    console.error('[ao3-search] search failed', err);
    lastProgress = {
      phase: 'error',
      requestsUsed: lastRequestsUsed,
      expansionBudget: lastProgress?.expansionBudget ?? EXPANSION_BUDGET,
      frontierSize: 0,
      message: err instanceof Error ? err.message : String(err),
    };
    await persistUiState();
    await broadcast({ type: 'SearchProgress', payload: lastProgress });
  } finally {
    searching = false;
    orchestrator = null;
    await publishState();
    await publishGraphStats();
  }
}

export default defineBackground(() => {
  ready = loadPersistedState();
  registerStatsImportPort(() => searching);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(SETTINGS_STORAGE_KEY in changes)) return;
    const next = settingsFromStorageChange(changes[SETTINGS_STORAGE_KEY]);
    if (!next) return;
    settings = next;
    void publishState();
  });
  void ready.then(() => console.log('[ao3-search] background ready'));
});

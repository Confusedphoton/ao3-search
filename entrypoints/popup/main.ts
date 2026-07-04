import './style.css';
import type {
  ExtensionMessage,
  GraphTagMatch,
  NegativeSeed,
  PositiveSeed,
  SearchProgressPayload,
  SearchResultItem,
} from '@/src/messaging/types';
import type { GraphExport, GraphStats } from '@/src/graph/types';
import { NodeKind } from '@/src/graph/types';
import { isExtensionMessage } from '@/src/messaging/types';
import { sendMessage } from '@/src/messaging/protocol';
import { authorWorksUrl, tagWorksUrl } from '@/src/ao3/types';
import { EXPANSION_BUDGET, MAX_NEGATIVE_SEEDS, MAX_SEEDS, MIN_SEEDS } from '@/src/config/constants';
import { parseGraphExport } from '@/src/storage/graphIo';

const app = document.querySelector<HTMLDivElement>('#app')!;

let seeds: PositiveSeed[] = [];
let negativeSeeds: NegativeSeed[] = [];
let searching = false;
let progress: SearchProgressPayload | null = null;
let results: SearchResultItem[] = [];
let tagSuggestions: GraphTagMatch[] = [];
let tagSearchQuery = '';
let tagSuggestionTarget: 'seed' | 'negative' = 'seed';
let statusHint = '';
let tagSearchTimer: ReturnType<typeof setTimeout> | null = null;
let graphStats: GraphStats | null = null;
let graphMessage = '';
let pendingImport: GraphExport | null = null;
let pendingImportFileName = '';

function positiveSeedLabel(seed: PositiveSeed): string {
  if (seed.kind === 'work') return seed.title;
  if (seed.kind === 'tag') return seed.tagName;
  return seed.displayName;
}

function positiveSeedKey(seed: PositiveSeed): string {
  if (seed.kind === 'work') return seed.workId;
  if (seed.kind === 'tag') return seed.tagName;
  return seed.authorKey;
}

function negativeSeedLabel(seed: NegativeSeed): string {
  if (seed.kind === 'work') return seed.title;
  if (seed.kind === 'tag') return seed.tagName;
  return seed.displayName;
}

function negativeSeedKey(seed: NegativeSeed): string {
  if (seed.kind === 'work') return seed.workId;
  if (seed.kind === 'tag') return seed.tagName;
  return seed.authorKey;
}

function renderTagSuggestionsFor(target: 'seed' | 'negative'): string {
  if (tagSuggestionTarget !== target || tagSuggestions.length === 0) return '';
  return `
    <ul id="tag-suggestions" class="tag-suggestions" role="listbox">
      ${tagSuggestions
        .map(
          (tag) => `
        <li role="presentation">
          <button type="button" class="tag-suggestion" data-tag-name="${escapeAttr(tag.tagName)}" role="option">
            <span>${escapeHtml(tag.tagName)}</span>
            ${tag.workCount != null ? `<span class="tag-meta">${tag.workCount.toLocaleString()} works</span>` : ''}
          </button>
        </li>`,
        )
        .join('')}
    </ul>`;
}

function formatSearchStatus(progress: SearchProgressPayload): string {
  const parts = [progress.message ?? progress.phase, `requests ${progress.requestsUsed}/${progress.expansionBudget}`];
  if (progress.frontierSize > 0) {
    parts.push(`${progress.frontierSize} to explore`);
  }
  return parts.join(' · ');
}

function formatGraphStats(stats: GraphStats): string {
  return `${stats.workCount.toLocaleString()} works · ${stats.tagCount.toLocaleString()} tags · ${stats.authorCount.toLocaleString()} authors`;
}

function renderImportPrompt(): string {
  if (!pendingImport) return '';
  return `
    <div class="import-prompt" role="dialog" aria-labelledby="import-prompt-title">
      <p id="import-prompt-title" class="import-prompt-title">Import <strong>${escapeHtml(pendingImportFileName)}</strong>?</p>
      <p class="hint">Choose how to apply this graph file.</p>
      <div class="import-actions">
        <button id="import-merge" type="button" ${searching ? 'disabled' : ''}>Merge</button>
        <button id="import-overwrite" type="button" class="danger" ${searching ? 'disabled' : ''}>Replace</button>
        <button id="import-cancel" type="button">Cancel</button>
      </div>
    </div>`;
}

function render(): void {
  const activeId = document.activeElement?.id;
  const selectionStart =
    document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionStart : null;
  const selectionEnd =
    document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionEnd : null;

  app.innerHTML = `
    <header>
      <h1>AO3 Semantic Search</h1>
      <p class="subtitle">Graph-based discovery via Personalized PageRank</p>
    </header>

    <section>
      <div class="section-header">
        <h2>Query seeds (${seeds.length}/${MAX_SEEDS})</h2>
        <button id="add-seed" type="button" ${searching ? 'disabled' : ''}>Add current tab</button>
      </div>
      <p class="hint">Works, tags, or authors that define what you want.</p>
      <div class="tag-search">
        <form id="add-seed-tag-form" class="tag-form">
          <input
            id="seed-tag-input"
            type="text"
            placeholder="Search tags in your graph…"
            value="${escapeAttr(tagSuggestionTarget === 'seed' ? tagSearchQuery : '')}"
            autocomplete="off"
            ${searching ? 'disabled' : ''}
          />
          <button type="submit" ${searching ? 'disabled' : ''}>Add tag</button>
        </form>
        ${renderTagSuggestionsFor('seed')}
      </div>
      <ul id="seed-list">
        ${
          seeds.length === 0
            ? `<li class="empty">Add ${MIN_SEEDS}–${MAX_SEEDS} works, tags, or authors.</li>`
            : seeds
                .map(
                  (seed) => `
            <li>
              <span class="seed-label">${escapeHtml(positiveSeedLabel(seed))}</span>
              <span class="seed-kind">${seed.kind}</span>
              <button data-remove-seed-kind="${seed.kind}" data-remove-seed-key="${escapeAttr(positiveSeedKey(seed))}" type="button" ${searching ? 'disabled' : ''}>Remove</button>
            </li>`,
                )
                .join('')
        }
      </ul>
    </section>

    <section class="negative-section">
      <div class="section-header">
        <h2>Avoid (${negativeSeeds.length}/${MAX_NEGATIVE_SEEDS})</h2>
        <button id="add-negative-work" type="button" ${searching ? 'disabled' : ''}>Add current tab</button>
      </div>
      <p class="hint">Works, tags, or authors to penalize — e.g. Major Character Death.</p>
      <div class="tag-search">
        <form id="add-negative-tag-form" class="tag-form">
          <input
            id="negative-tag-input"
            type="text"
            placeholder="Search tags to avoid…"
            value="${escapeAttr(tagSuggestionTarget === 'negative' ? tagSearchQuery : '')}"
            autocomplete="off"
            ${searching ? 'disabled' : ''}
          />
          <button type="submit" ${searching ? 'disabled' : ''}>Add tag</button>
        </form>
        ${renderTagSuggestionsFor('negative')}
      </div>
      <ul id="negative-seed-list">
        ${
          negativeSeeds.length === 0
            ? '<li class="empty">Optional negative seeds.</li>'
            : negativeSeeds
                .map(
                  (seed) => `
            <li>
              <span class="negative-label">${escapeHtml(negativeSeedLabel(seed))}</span>
              <span class="negative-kind">${seed.kind}</span>
              <button data-remove-negative-kind="${seed.kind}" data-remove-negative-key="${escapeAttr(negativeSeedKey(seed))}" type="button" ${searching ? 'disabled' : ''}>Remove</button>
            </li>`,
                )
                .join('')
        }
      </ul>
    </section>

    <section>
      <div class="section-header">
        <h2>Search</h2>
        <div class="actions">
          ${
            searching
              ? '<button id="cancel-search" type="button">Cancel</button>'
              : `<button id="start-search" type="button" ${seeds.length < MIN_SEEDS ? 'disabled' : ''}>Start search</button>`
          }
        </div>
      </div>
      ${
        progress
          ? `<p class="status">${escapeHtml(formatSearchStatus(progress))}</p>`
          : `<p class="status">${statusHint || 'Ready.'}</p>`
      }
    </section>

    <section>
      <div class="section-header">
        <h2>Results${searching ? ' <span class="live-badge">live</span>' : ''}</h2>
      </div>
      <ol id="results">
        ${
          results.length === 0
            ? `<li class="empty">${searching ? 'Building initial ranking…' : 'Start a search to see results.'}</li>`
            : results
                .map(
                  (item, i) => `
            <li>
              <span class="rank">${i + 1}.</span>
              <a href="${item.url}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
              <span class="score">${item.relevance.toExponential(2)}</span>
            </li>`,
                )
                .join('')
        }
      </ol>
    </section>

    <section class="graph-section">
      <div class="section-header">
        <h2>Your graph</h2>
        <div class="actions">
          <button id="export-graph" type="button" ${searching ? 'disabled' : ''}>Export</button>
          <button id="import-graph" type="button" ${searching ? 'disabled' : ''}>Import</button>
        </div>
      </div>
      <p class="hint">
        ${
          graphStats
            ? formatGraphStats(graphStats)
            : 'Works, tags, and authors collected while browsing AO3.'
        }
      </p>
      ${graphMessage ? `<p class="status graph-status">${escapeHtml(graphMessage)}</p>` : ''}
      <p class="hint">Large graph files may take a few seconds to load.</p>
      <p class="hint">
        <button id="open-settings" type="button" class="link-button">Open settings</button>
        to import AO3 stats metadata.
      </p>
      <input id="import-graph-input" type="file" accept="application/json,.json" hidden />
      ${renderImportPrompt()}
    </section>
  `;

  bindEvents();

  if (activeId) {
    const el = document.getElementById(activeId);
    if (el instanceof HTMLInputElement) {
      el.focus();
      if (selectionStart != null && selectionEnd != null) {
        el.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }
}

function clearTagSuggestions(): void {
  tagSearchQuery = '';
  tagSuggestions = [];
}

function scheduleTagSearch(value: string, target: 'seed' | 'negative'): void {
  tagSuggestionTarget = target;
  tagSearchQuery = value;
  if (tagSearchTimer) clearTimeout(tagSearchTimer);
  if (value.trim().length < 1) {
    tagSuggestions = [];
    render();
    return;
  }
  tagSearchTimer = setTimeout(() => {
    void sendMessage({ type: 'SearchGraphTags', query: value.trim() }).then((response) => {
      if (response?.type === 'GraphTagResults' && tagSuggestionTarget === target) {
        tagSuggestions = response.tags;
        render();
      }
    });
  }, 150);
}

async function addTagFromSuggestion(tagName: string): Promise<void> {
  if (tagSuggestionTarget === 'negative') {
    await dispatch({ type: 'AddNegativeTag', tagName });
  } else {
    await dispatch({ type: 'AddSeedTag', tagName });
  }
  clearTagSuggestions();
  render();
}

function bindEvents(): void {
  document.querySelector('#add-seed')?.addEventListener('click', () => {
    void dispatch({ type: 'AddSeedFromTab' }).then((beforeCount) => {
      if (seeds.length === beforeCount) {
        statusHint = 'Open an AO3 work, tag, or author page, then try again.';
        render();
      }
    });
  });

  document.querySelector('#add-negative-work')?.addEventListener('click', () => {
    void dispatch({ type: 'AddNegativeWorkFromTab' }).then((beforeCount) => {
      if (negativeSeeds.length === beforeCount) {
        statusHint = 'Open an AO3 work, tag, or author page to add a negative seed.';
        render();
      }
    });
  });

  document.querySelector('#add-seed-tag-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>('#seed-tag-input');
    const tagName = input?.value.trim();
    if (!tagName) return;
    void dispatch({ type: 'AddSeedTag', tagName }).then(() => {
      clearTagSuggestions();
      if (input) input.value = '';
    });
  });

  document.querySelector('#seed-tag-input')?.addEventListener('input', (event) => {
    scheduleTagSearch((event.target as HTMLInputElement).value, 'seed');
  });

  document.querySelector('#seed-tag-input')?.addEventListener('focus', () => {
    tagSuggestionTarget = 'seed';
  });

  document.querySelectorAll('.tag-suggestion').forEach((el) => {
    el.addEventListener('click', () => {
      const tagName = el.getAttribute('data-tag-name');
      if (!tagName) return;
      void addTagFromSuggestion(tagName);
    });
  });

  document.querySelector('#add-negative-tag-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>('#negative-tag-input');
    const tagName = input?.value.trim();
    if (!tagName) return;
    void dispatch({ type: 'AddNegativeTag', tagName }).then(() => {
      clearTagSuggestions();
      if (input) input.value = '';
    });
  });

  document.querySelector('#negative-tag-input')?.addEventListener('input', (event) => {
    scheduleTagSearch((event.target as HTMLInputElement).value, 'negative');
  });

  document.querySelector('#negative-tag-input')?.addEventListener('focus', () => {
    tagSuggestionTarget = 'negative';
  });

  document.querySelector('#start-search')?.addEventListener('click', () => {
    statusHint = '';
    results = [];
    progress = null;
    render();
    void dispatch({ type: 'StartSearch' });
  });

  document.querySelector('#cancel-search')?.addEventListener('click', () => {
    void dispatch({ type: 'CancelSearch' });
  });

  document.querySelectorAll('[data-remove-seed-kind]').forEach((el) => {
    el.addEventListener('click', () => {
      const kind = el.getAttribute('data-remove-seed-kind');
      const key = el.getAttribute('data-remove-seed-key');
      if ((kind === 'work' || kind === 'tag' || kind === 'author') && key) {
        void dispatch({ type: 'RemoveSeed', kind, key });
      }
    });
  });

  document.querySelectorAll('[data-remove-negative-kind]').forEach((el) => {
    el.addEventListener('click', () => {
      const kind = el.getAttribute('data-remove-negative-kind');
      const key = el.getAttribute('data-remove-negative-key');
      if ((kind === 'work' || kind === 'tag' || kind === 'author') && key) {
        void dispatch({ type: 'RemoveNegativeSeed', kind, key });
      }
    });
  });

  document.querySelector('#export-graph')?.addEventListener('click', () => {
    void exportCurrentGraph();
  });

  document.querySelector('#import-graph')?.addEventListener('click', () => {
    document.querySelector<HTMLInputElement>('#import-graph-input')?.click();
  });

  document.querySelector('#open-settings')?.addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
  });

  document.querySelector('#import-graph-input')?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void loadImportFile(file);
  });

  document.querySelector('#import-merge')?.addEventListener('click', () => {
    void confirmImport('merge');
  });

  document.querySelector('#import-overwrite')?.addEventListener('click', () => {
    void confirmImport('overwrite');
  });

  document.querySelector('#import-cancel')?.addEventListener('click', () => {
    pendingImport = null;
    pendingImportFileName = '';
    render();
  });
}

async function refreshGraphStats(): Promise<void> {
  const response = await sendMessage({ type: 'GetGraphStats' });
  if (response?.type === 'GraphStats') {
    graphStats = response.stats;
  }
}

async function exportCurrentGraph(): Promise<void> {
  graphMessage = '';
  const response = await sendMessage({ type: 'ExportGraph' });
  if (response?.type === 'GraphExported') {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(response.export, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ao3-search-graph-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    graphMessage = `Exported ${response.export.nodes.length.toLocaleString()} nodes.`;
    graphStats = {
      nodeCount: response.export.nodes.length,
      workCount: response.export.nodes.filter((node) => node.kind === NodeKind.Work).length,
      tagCount: response.export.nodes.filter((node) => node.kind === NodeKind.Tag).length,
      authorCount: response.export.nodes.filter((node) => node.kind === NodeKind.Author).length,
      edgeCount: response.export.edges.length,
      authorEdgeCount: response.export.authorEdges.length,
    };
    render();
    return;
  }
  if (response?.type === 'GraphImportResult' && !response.success) {
    graphMessage = response.message;
    render();
  }
}

async function loadImportFile(file: File): Promise<void> {
  graphMessage = '';
  try {
    const text = await file.text();
    const parsedJson = JSON.parse(text) as unknown;
    const exportData = parseGraphExport(parsedJson);
    if (!exportData) {
      graphMessage = 'Invalid graph file.';
      pendingImport = null;
      pendingImportFileName = '';
      render();
      return;
    }
    pendingImport = exportData;
    pendingImportFileName = file.name;
    render();
  } catch {
    graphMessage = 'Could not read graph file.';
    pendingImport = null;
    pendingImportFileName = '';
    render();
  }
}

async function confirmImport(mode: 'merge' | 'overwrite'): Promise<void> {
  if (!pendingImport) return;
  const exportData = pendingImport;
  pendingImport = null;
  pendingImportFileName = '';
  graphMessage = mode === 'overwrite' ? 'Replacing graph…' : 'Merging graph…';
  render();

  const response = await sendMessage({ type: 'ImportGraph', export: exportData, mode });
  if (response?.type === 'GraphImportResult') {
    graphMessage = response.message;
    if (response.stats) graphStats = response.stats;
    render();
  }
}

async function dispatch(message: ExtensionMessage): Promise<number> {
  const beforeCount =
    message.type === 'AddSeedFromTab' || message.type === 'AddSeedTag'
      ? seeds.length
      : message.type === 'AddNegativeWorkFromTab' ||
          message.type === 'AddNegativeTagFromTab' ||
          message.type === 'AddNegativeTag'
        ? negativeSeeds.length
        : 0;

  const response = await sendMessage(message);
  if (response && isExtensionMessage(response)) applyState(response);
  return beforeCount;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replaceAll("'", '&#39;');
}

function applyPreviewResults(previewResults: SearchResultItem[] | undefined): void {
  if (previewResults) results = previewResults;
}

function applyState(message: ExtensionMessage): void {
  if (message.type === 'StateUpdate') {
    seeds = message.seeds;
    negativeSeeds = message.negativeSeeds;
    searching = message.searching;
    progress =
      message.progress && message.progress.expansionBudget === 0
        ? { ...message.progress, expansionBudget: EXPANSION_BUDGET }
        : message.progress;
    results = message.results;
    if (!message.results.length) {
      applyPreviewResults(message.progress?.previewResults);
    }
    if (message.progress?.message) statusHint = '';
    render();
  } else if (message.type === 'SearchProgress') {
    progress = message.payload;
    applyPreviewResults(message.payload.previewResults);
    render();
  } else if (message.type === 'SearchResults') {
    results = message.payload.results;
    progress = {
      phase: 'done',
      requestsUsed: message.payload.requestsUsed,
      expansionBudget: EXPANSION_BUDGET,
      frontierSize: 0,
      message: `Found ${results.length} works`,
    };
    render();
  } else if (message.type === 'GraphTagResults') {
    tagSuggestions = message.tags;
    render();
  } else if (message.type === 'GraphStats') {
    graphStats = message.stats;
    render();
  } else if (message.type === 'GraphImportResult') {
    graphMessage = message.message;
    if (message.stats) graphStats = message.stats;
    render();
  }
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

async function loadInitialState(): Promise<void> {
  try {
    const response = await sendMessage({ type: 'GetState' });
    if (response?.type === 'StateUpdate') {
      applyState(response);
      await refreshGraphStats();
      render();
      return;
    }
  } catch {
    // Fall back to storage if the background worker is still waking up.
  }

  const stored = await browser.storage.local.get([
    'seeds',
    'negativeSeeds',
    'lastResults',
    'lastProgress',
  ]);

  if (Array.isArray(stored.seeds)) {
    seeds = stored.seeds
      .map((seed) => normalizeStoredSeed(seed))
      .filter((seed): seed is PositiveSeed => seed !== null);
  }
  if (Array.isArray(stored.negativeSeeds)) {
    negativeSeeds = stored.negativeSeeds
      .map((seed) => normalizeStoredNegativeSeed(seed))
      .filter((seed): seed is NegativeSeed => seed !== null);
  }
  if (Array.isArray(stored.lastResults)) {
    results = stored.lastResults as SearchResultItem[];
  }
  if (stored.lastProgress && typeof stored.lastProgress === 'object') {
    const storedProgress = stored.lastProgress as SearchProgressPayload;
    progress =
      storedProgress.expansionBudget > 0
        ? storedProgress
        : { ...storedProgress, expansionBudget: EXPANSION_BUDGET };
  }

  await refreshGraphStats();
  render();
}

browser.runtime.onMessage.addListener((message) => {
  if (isExtensionMessage(message)) applyState(message);
});

app.innerHTML = '<p class="status loading">Loading…</p>';
void loadInitialState();

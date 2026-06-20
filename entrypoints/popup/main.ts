import './style.css';
import type {
  ExtensionMessage,
  GraphTagMatch,
  NegativeSeed,
  PositiveSeed,
  SearchProgressPayload,
  SearchResultItem,
} from '@/src/messaging/types';
import { isExtensionMessage } from '@/src/messaging/types';
import { sendMessage } from '@/src/messaging/protocol';
import { authorWorksUrl, tagWorksUrl } from '@/src/ao3/types';
import { MAX_NEGATIVE_SEEDS, MAX_SEEDS, MIN_SEEDS } from '@/src/config/constants';

const app = document.querySelector<HTMLDivElement>('#app')!;

let seeds: PositiveSeed[] = [];
let negativeSeeds: NegativeSeed[] = [];
let searching = false;
let progress: SearchProgressPayload | null = null;
let results: SearchResultItem[] = [];
let tagSuggestions: GraphTagMatch[] = [];
let tagSearchQuery = '';
let statusHint = '';
let tagSearchTimer: ReturnType<typeof setTimeout> | null = null;

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

function renderTagSuggestions(): string {
  if (tagSuggestions.length === 0) return '';
  return `
    <ul id="tag-suggestions" class="tag-suggestions">
      ${tagSuggestions
        .map(
          (tag) => `
        <li>
          <button type="button" class="tag-suggestion" data-tag-name="${escapeAttr(tag.tagName)}">
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
            value="${escapeAttr(tagSearchQuery)}"
            autocomplete="off"
            ${searching ? 'disabled' : ''}
          />
          <button type="submit" ${searching ? 'disabled' : ''}>Add tag</button>
        </form>
        ${renderTagSuggestions()}
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
      <form id="add-negative-tag-form" class="tag-form">
        <input
          id="negative-tag-input"
          type="text"
          placeholder="Tag to avoid"
          ${searching ? 'disabled' : ''}
        />
        <button type="submit" ${searching ? 'disabled' : ''}>Add tag</button>
      </form>
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
              <span class="score">${item.authority.toExponential(2)}</span>
            </li>`,
                )
                .join('')
        }
      </ol>
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
      tagSearchQuery = '';
      tagSuggestions = [];
      if (input) input.value = '';
    });
  });

  document.querySelector('#seed-tag-input')?.addEventListener('input', (event) => {
    const value = (event.target as HTMLInputElement).value;
    tagSearchQuery = value;
    if (tagSearchTimer) clearTimeout(tagSearchTimer);
    if (value.trim().length < 2) {
      tagSuggestions = [];
      render();
      return;
    }
    tagSearchTimer = setTimeout(() => {
      void sendMessage({ type: 'SearchGraphTags', query: value.trim() }).then((response) => {
        if (response?.type === 'GraphTagResults') {
          tagSuggestions = response.tags;
          render();
        }
      });
    }, 150);
  });

  document.querySelectorAll('.tag-suggestion').forEach((el) => {
    el.addEventListener('click', () => {
      const tagName = el.getAttribute('data-tag-name');
      if (!tagName) return;
      void dispatch({ type: 'AddSeedTag', tagName }).then(() => {
        tagSearchQuery = '';
        tagSuggestions = [];
      });
    });
  });

  document.querySelector('#add-negative-tag-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>('#negative-tag-input');
    const tagName = input?.value.trim();
    if (!tagName) return;
    void dispatch({ type: 'AddNegativeTag', tagName }).then(() => {
      if (input) input.value = '';
    });
  });

  document.querySelector('#start-search')?.addEventListener('click', () => {
    statusHint = '';
    results = [];
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
    progress = message.progress;
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
      expansionBudget: 0,
      frontierSize: 0,
      message: `Found ${results.length} works`,
    };
    render();
  } else if (message.type === 'GraphTagResults') {
    tagSuggestions = message.tags;
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
    progress = stored.lastProgress as SearchProgressPayload;
  }

  render();
}

browser.runtime.onMessage.addListener((message) => {
  if (isExtensionMessage(message)) applyState(message);
});

app.innerHTML = '<p class="status loading">Loading…</p>';
void loadInitialState();

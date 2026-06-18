import './style.css';
import type {
  ExtensionMessage,
  NegativeSeed,
  SearchProgressPayload,
  SearchResultItem,
  SeedWork,
} from '@/src/messaging/types';
import { isExtensionMessage } from '@/src/messaging/types';
import { sendMessage } from '@/src/messaging/protocol';
import { MAX_NEGATIVE_SEEDS, MAX_SEEDS, MIN_SEEDS } from '@/src/config/constants';

const app = document.querySelector<HTMLDivElement>('#app')!;

let seeds: SeedWork[] = [];
let negativeSeeds: NegativeSeed[] = [];
let searching = false;
let progress: SearchProgressPayload | null = null;
let results: SearchResultItem[] = [];

function negativeSeedLabel(seed: NegativeSeed): string {
  return seed.kind === 'work' ? seed.title : seed.tagName;
}

function negativeSeedKey(seed: NegativeSeed): string {
  return seed.kind === 'work' ? seed.workId : seed.tagName;
}

function render(): void {
  app.innerHTML = `
    <header>
      <h1>AO3 Semantic Search</h1>
      <p class="subtitle">Graph-based discovery via Personalized PageRank</p>
    </header>

    <section>
      <div class="section-header">
        <h2>Seeds (${seeds.length}/${MAX_SEEDS})</h2>
        <button id="add-seed" type="button" ${searching ? 'disabled' : ''}>Add current tab</button>
      </div>
      <ul id="seed-list">
        ${
          seeds.length === 0
            ? `<li class="empty">Add ${MIN_SEEDS}–${MAX_SEEDS} works you already like.</li>`
            : seeds
                .map(
                  (seed) => `
            <li>
              <span>${escapeHtml(seed.title)}</span>
              <button data-remove-seed="${seed.workId}" type="button" ${searching ? 'disabled' : ''}>Remove</button>
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
      <p class="hint">Works or tags to penalize — e.g. Major Character Death.</p>
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
              <button data-remove-negative-kind="${seed.kind}" data-remove-negative-key="${escapeHtml(negativeSeedKey(seed))}" type="button" ${searching ? 'disabled' : ''}>Remove</button>
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
          ? `<p class="status">${escapeHtml(progress.message ?? progress.phase)} · requests ${progress.requestsUsed}/${progress.expansionBudget} · frontier ${progress.frontierSize}</p>`
          : '<p class="status">Ready.</p>'
      }
    </section>

    <section>
      <h2>Results</h2>
      <ol id="results">
        ${
          results.length === 0
            ? '<li class="empty">Results appear after a search completes.</li>'
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

  document.querySelector('#add-seed')?.addEventListener('click', () => {
    void sendMessage({ type: 'AddSeedFromTab' });
  });

  document.querySelector('#add-negative-work')?.addEventListener('click', () => {
    void sendMessage({ type: 'AddNegativeWorkFromTab' });
  });

  document.querySelector('#add-negative-tag-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>('#negative-tag-input');
    const tagName = input?.value.trim();
    if (!tagName) return;
    void sendMessage({ type: 'AddNegativeTag', tagName }).then(() => {
      if (input) input.value = '';
    });
  });

  document.querySelector('#start-search')?.addEventListener('click', () => {
    void sendMessage({ type: 'StartSearch' });
  });

  document.querySelector('#cancel-search')?.addEventListener('click', () => {
    void sendMessage({ type: 'CancelSearch' });
  });

  document.querySelectorAll('[data-remove-seed]').forEach((el) => {
    el.addEventListener('click', () => {
      const workId = el.getAttribute('data-remove-seed');
      if (workId) void sendMessage({ type: 'RemoveSeed', workId });
    });
  });

  document.querySelectorAll('[data-remove-negative-kind]').forEach((el) => {
    el.addEventListener('click', () => {
      const kind = el.getAttribute('data-remove-negative-kind');
      const key = el.getAttribute('data-remove-negative-key');
      if (kind === 'work' || kind === 'tag') {
        if (key) void sendMessage({ type: 'RemoveNegativeSeed', kind, key });
      }
    });
  });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function applyState(message: ExtensionMessage): void {
  if (message.type === 'StateUpdate') {
    seeds = message.seeds;
    negativeSeeds = message.negativeSeeds;
    searching = message.searching;
    progress = message.progress;
    render();
  } else if (message.type === 'SearchProgress') {
    progress = message.payload;
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
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (isExtensionMessage(message)) applyState(message);
});

void sendMessage({ type: 'GetState' }).then((response) => {
  if (response && isExtensionMessage(response)) applyState(response);
});

render();

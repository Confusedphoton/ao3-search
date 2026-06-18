import './style.css';
import type {
  ExtensionMessage,
  SearchProgressPayload,
  SearchResultItem,
  SeedWork,
} from '@/src/messaging/types';
import { isExtensionMessage } from '@/src/messaging/types';
import { sendMessage } from '@/src/messaging/protocol';
import { MAX_SEEDS, MIN_SEEDS } from '@/src/config/constants';

const app = document.querySelector<HTMLDivElement>('#app')!;

let seeds: SeedWork[] = [];
let searching = false;
let progress: SearchProgressPayload | null = null;
let results: SearchResultItem[] = [];

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
              <button data-remove="${seed.workId}" type="button" ${searching ? 'disabled' : ''}>Remove</button>
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

  document.querySelector('#start-search')?.addEventListener('click', () => {
    void sendMessage({ type: 'StartSearch' });
  });

  document.querySelector('#cancel-search')?.addEventListener('click', () => {
    void sendMessage({ type: 'CancelSearch' });
  });

  document.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', () => {
      const workId = el.getAttribute('data-remove');
      if (workId) void sendMessage({ type: 'RemoveSeed', workId });
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

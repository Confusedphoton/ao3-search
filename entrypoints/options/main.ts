import './style.css';
import { isStatsTagsFileName } from '@/src/ao3/statsDump';
import type { GraphExport, GraphStats } from '@/src/graph/types';
import {
  AO3_ARCHIVE_WARNINGS,
  AO3_CATEGORIES,
  AO3_COMPLETION_STATUSES,
  AO3_RATINGS,
  PERMEABILITY_CATEGORY_KEYS,
  type PermeabilityCategoryKey,
} from '@/src/config/ao3Meta';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  resetSettings,
  saveSettings,
  SETTINGS_BOUNDS,
  SETTINGS_STORAGE_KEY,
  settingsFromStorageChange,
  type CategoryPermeabilityFilter,
  type FilterMode,
  type PermeabilityFilters,
  type ThemePreference,
  type TunableSettings,
  type ExpansionPolicyKind,
} from '@/src/config/settings';
import { applyTheme } from '@/src/ui/theme';
import { isExtensionMessage, type SuppressedWork } from '@/src/messaging/types';
import { runStatsImportLocal } from '@/src/storage/statsImportRunner';
import { sendMessage } from '@/src/messaging/protocol';
import { parseGraphExport } from '@/src/storage/graphIo';

const tagsInput = document.querySelector<HTMLInputElement>('#stats-tags-file')!;
const clearCheckbox = document.querySelector<HTMLInputElement>('#stats-clear-existing')!;
const importButton = document.querySelector<HTMLButtonElement>('#import-stats')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#stats-status')!;
const graphStatsEl = document.querySelector<HTMLParagraphElement>('#graph-stats')!;
const exportGraphButton = document.querySelector<HTMLButtonElement>('#export-graph')!;
const importGraphButton = document.querySelector<HTMLButtonElement>('#import-graph')!;
const importGraphInput = document.querySelector<HTMLInputElement>('#import-graph-input')!;
const importPromptEl = document.querySelector<HTMLDivElement>('#import-prompt')!;
const graphIoStatusEl = document.querySelector<HTMLParagraphElement>('#graph-io-status')!;

const settingsForm = document.querySelector<HTMLFormElement>('#settings-form')!;
const topResultsInput = document.querySelector<HTMLInputElement>('#setting-top-results')!;
const maxSeedsInput = document.querySelector<HTMLInputElement>('#setting-max-seeds')!;
const maxNegativeSeedsInput = document.querySelector<HTMLInputElement>(
  '#setting-max-negative-seeds',
)!;
const negativeLambdaInput = document.querySelector<HTMLInputElement>('#setting-negative-lambda')!;
const expansionPolicySelect = document.querySelector<HTMLSelectElement>(
  '#setting-expansion-policy',
)!;
const aStarThinkRow = document.querySelector<HTMLDivElement>('#astar-think-row')!;
const aStarMaxThinkInput = document.querySelector<HTMLInputElement>('#setting-astar-max-think')!;
const restoreDefaultsButton = document.querySelector<HTMLButtonElement>('#restore-defaults')!;
const settingsStatusEl = document.querySelector<HTMLParagraphElement>('#settings-status')!;
const suppressedListEl = document.querySelector<HTMLUListElement>('#suppressed-list')!;
const suppressedEmptyEl = document.querySelector<HTMLParagraphElement>('#suppressed-empty')!;
const suppressedStatusEl = document.querySelector<HTMLParagraphElement>('#suppressed-status')!;

const permeabilityRoot = document.querySelector<HTMLDivElement>('#permeability-filters')!;
const savePermeabilityButton = document.querySelector<HTMLButtonElement>('#save-permeability')!;
const permeabilityStatusEl = document.querySelector<HTMLParagraphElement>('#permeability-status')!;
const themeToggle = document.querySelector<HTMLDivElement>('.theme-toggle')!;
const themeStatusEl = document.querySelector<HTMLParagraphElement>('#theme-status')!;

let tagsFile: File | null = null;
let importing = false;
let suppressedWorks: SuppressedWork[] = [];
let permeabilityState: PermeabilityFilters = structuredClone(DEFAULT_SETTINGS.permeability);
let themeState: ThemePreference = DEFAULT_SETTINGS.theme;
let pendingImport: GraphExport | null = null;
let pendingImportFileName = '';

const CATEGORY_LABELS: Record<PermeabilityCategoryKey, string> = {
  archiveWarnings: 'Archive warnings',
  categories: 'Categories',
  completionStatus: 'Completion status',
  fandoms: 'Fandoms',
  language: 'Language',
  rating: 'Rating',
};

const EXHAUSTIVE_OPTIONS: Partial<Record<PermeabilityCategoryKey, readonly string[]>> = {
  rating: AO3_RATINGS,
  archiveWarnings: AO3_ARCHIVE_WARNINGS,
  completionStatus: AO3_COMPLETION_STATUSES,
  categories: AO3_CATEGORIES,
};

function formatGraphStats(stats: GraphStats): string {
  return `${stats.workCount.toLocaleString()} works · ${stats.tagCount.toLocaleString()} tags · ${stats.authorCount.toLocaleString()} authors`;
}

function setStatus(message: string, isError = false): void {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function setGraphIoStatus(message: string, isError = false): void {
  if (!message) {
    graphIoStatusEl.hidden = true;
    graphIoStatusEl.textContent = '';
    graphIoStatusEl.classList.remove('error');
    return;
  }
  graphIoStatusEl.hidden = false;
  graphIoStatusEl.textContent = message;
  graphIoStatusEl.classList.toggle('error', isError);
}

function setSettingsStatus(message: string, isError = false): void {
  settingsStatusEl.hidden = false;
  settingsStatusEl.textContent = message;
  settingsStatusEl.classList.toggle('error', isError);
}

function setPermeabilityStatus(message: string, isError = false): void {
  permeabilityStatusEl.hidden = false;
  permeabilityStatusEl.textContent = message;
  permeabilityStatusEl.classList.toggle('error', isError);
}

function setThemeStatus(message: string): void {
  themeStatusEl.hidden = false;
  themeStatusEl.textContent = message;
}

function renderThemeToggle(): void {
  themeToggle.querySelectorAll<HTMLButtonElement>('[data-theme-value]').forEach((button) => {
    const value = button.getAttribute('data-theme-value');
    button.classList.toggle('active', value === themeState);
  });
}

function applyThemePreference(theme: ThemePreference): void {
  themeState = theme;
  applyTheme(theme);
  renderThemeToggle();
}

function updateImportButton(): void {
  importButton.disabled = importing || tagsFile == null;
  importButton.textContent = importing ? 'Importing…' : 'Import stats';
}

function applyInputBounds(): void {
  topResultsInput.min = String(SETTINGS_BOUNDS.topResults.min);
  topResultsInput.max = String(SETTINGS_BOUNDS.topResults.max);
  maxSeedsInput.min = String(SETTINGS_BOUNDS.maxSeeds.min);
  maxSeedsInput.max = String(SETTINGS_BOUNDS.maxSeeds.max);
  maxNegativeSeedsInput.min = String(SETTINGS_BOUNDS.maxNegativeSeeds.min);
  maxNegativeSeedsInput.max = String(SETTINGS_BOUNDS.maxNegativeSeeds.max);
  negativeLambdaInput.min = String(SETTINGS_BOUNDS.negativeRelevanceLambda.min);
  negativeLambdaInput.max = String(SETTINGS_BOUNDS.negativeRelevanceLambda.max);
  aStarMaxThinkInput.min = String(SETTINGS_BOUNDS.queryAStarMaxThinkMs.min / 1000);
  aStarMaxThinkInput.max = String(SETTINGS_BOUNDS.queryAStarMaxThinkMs.max / 1000);
}

function updateAStarThinkVisibility(): void {
  const show = expansionPolicySelect.value === 'topo-query';
  aStarThinkRow.hidden = !show;
  aStarMaxThinkInput.required = show;
  aStarMaxThinkInput.disabled = !show;
}

function fillSettingsForm(settings: TunableSettings): void {
  topResultsInput.value = String(settings.topResults);
  maxSeedsInput.value = String(settings.maxSeeds);
  maxNegativeSeedsInput.value = String(settings.maxNegativeSeeds);
  negativeLambdaInput.value = String(settings.negativeRelevanceLambda);
  expansionPolicySelect.value = settings.expansionPolicy;
  aStarMaxThinkInput.value = String(settings.queryAStarMaxThinkMs / 1000);
  permeabilityState = structuredClone(settings.permeability);
  applyThemePreference(settings.theme);
  updateAStarThinkVisibility();
  renderPermeabilityFilters();
}

function readSettingsForm(): TunableSettings {
  return normalizeSettings({
    topResults: topResultsInput.valueAsNumber,
    maxSeeds: maxSeedsInput.valueAsNumber,
    maxNegativeSeeds: maxNegativeSeedsInput.valueAsNumber,
    negativeRelevanceLambda: negativeLambdaInput.valueAsNumber,
    expansionPolicy: expansionPolicySelect.value as ExpansionPolicyKind,
    queryAStarMaxThinkMs: aStarMaxThinkInput.valueAsNumber * 1000,
    theme: themeState,
    permeability: permeabilityState,
  });
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

function setSuppressedStatus(message: string): void {
  suppressedStatusEl.hidden = false;
  suppressedStatusEl.textContent = message;
}

function renderSuppressedWorks(): void {
  if (suppressedWorks.length === 0) {
    suppressedEmptyEl.hidden = false;
    suppressedListEl.innerHTML = '';
    return;
  }
  suppressedEmptyEl.hidden = true;
  suppressedListEl.innerHTML = suppressedWorks
    .map(
      (work) => `
    <li>
      <a href="${escapeAttr(work.url)}" target="_blank" rel="noopener" class="suppressed-label">${escapeHtml(work.title)}</a>
      <button type="button" data-unsuppress-work="${escapeAttr(work.workId)}">Show again</button>
    </li>`,
    )
    .join('');

  suppressedListEl.querySelectorAll('[data-unsuppress-work]').forEach((el) => {
    el.addEventListener('click', () => {
      const workId = el.getAttribute('data-unsuppress-work');
      if (!workId) return;
      void sendMessage({ type: 'UnsuppressWork', workId }).then((response) => {
        if (response?.type === 'StateUpdate') {
          suppressedWorks = response.suppressedWorks ?? [];
          renderSuppressedWorks();
          setSuppressedStatus('Work shown in results again.');
        }
      });
    });
  });
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

async function loadSuppressedWorks(): Promise<void> {
  try {
    const response = await sendMessage({ type: 'GetState' });
    if (response?.type === 'StateUpdate') {
      suppressedWorks = response.suppressedWorks ?? [];
      renderSuppressedWorks();
      return;
    }
  } catch {
    // Fall back to storage if the background worker is still waking up.
  }

  const stored = await browser.storage.local.get('suppressedWorks');
  if (Array.isArray(stored.suppressedWorks)) {
    suppressedWorks = stored.suppressedWorks
      .map((work) => normalizeStoredSuppressedWork(work))
      .filter((work): work is SuppressedWork => work !== null);
  }
  renderSuppressedWorks();
}

async function refreshGraphStats(): Promise<void> {
  const response = await sendMessage({ type: 'GetGraphStats' });
  if (response?.type === 'GraphStats') {
    graphStatsEl.textContent = `Current graph: ${formatGraphStats(response.stats)}`;
  }
}

function renderImportPrompt(): void {
  if (!pendingImport) {
    importPromptEl.innerHTML = '';
    return;
  }
  importPromptEl.innerHTML = `
    <div class="import-prompt" role="dialog" aria-labelledby="import-prompt-title">
      <p id="import-prompt-title" class="import-prompt-title">Import <strong>${escapeHtml(pendingImportFileName)}</strong>?</p>
      <p class="hint">Choose how to apply this graph file.</p>
      <div class="import-actions">
        <button id="import-merge" type="button">Merge</button>
        <button id="import-overwrite" type="button" class="danger">Replace</button>
        <button id="import-cancel" type="button" class="secondary">Cancel</button>
      </div>
    </div>`;

  importPromptEl.querySelector('#import-merge')?.addEventListener('click', () => {
    void confirmImport('merge');
  });
  importPromptEl.querySelector('#import-overwrite')?.addEventListener('click', () => {
    void confirmImport('overwrite');
  });
  importPromptEl.querySelector('#import-cancel')?.addEventListener('click', () => {
    pendingImport = null;
    pendingImportFileName = '';
    renderImportPrompt();
  });
}

async function exportCurrentGraph(): Promise<void> {
  setGraphIoStatus('');
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
    setGraphIoStatus(`Exported ${response.export.nodes.length.toLocaleString()} nodes.`);
    await refreshGraphStats();
    return;
  }
  if (response?.type === 'GraphImportResult' && !response.success) {
    setGraphIoStatus(response.message, true);
  }
}

async function loadImportFile(file: File): Promise<void> {
  setGraphIoStatus('');
  try {
    const text = await file.text();
    const parsedJson = JSON.parse(text) as unknown;
    const exportData = parseGraphExport(parsedJson);
    if (!exportData) {
      setGraphIoStatus('Invalid graph file.', true);
      pendingImport = null;
      pendingImportFileName = '';
      renderImportPrompt();
      return;
    }
    pendingImport = exportData;
    pendingImportFileName = file.name;
    renderImportPrompt();
  } catch {
    setGraphIoStatus('Could not read graph file.', true);
    pendingImport = null;
    pendingImportFileName = '';
    renderImportPrompt();
  }
}

async function confirmImport(mode: 'merge' | 'overwrite'): Promise<void> {
  if (!pendingImport) return;
  const exportData = pendingImport;
  pendingImport = null;
  pendingImportFileName = '';
  renderImportPrompt();
  setGraphIoStatus(mode === 'overwrite' ? 'Replacing graph…' : 'Merging graph…');

  const response = await sendMessage({ type: 'ImportGraph', export: exportData, mode });
  if (response?.type === 'GraphImportResult') {
    setGraphIoStatus(response.message, !response.success);
    if (response.stats) {
      graphStatsEl.textContent = `Current graph: ${formatGraphStats(response.stats)}`;
    }
  }
}

function renderCheckboxList(category: PermeabilityCategoryKey, filter: CategoryPermeabilityFilter): string {
  const options = EXHAUSTIVE_OPTIONS[category] ?? [];
  const selected = new Set(filter.values);
  return `
    <div class="filter-checkboxes" data-category="${category}">
      ${options
        .map(
          (option) => `
        <label class="checkbox-row compact">
          <input type="checkbox" data-filter-value="${escapeAttr(option)}" ${selected.has(option) ? 'checked' : ''} />
          ${escapeHtml(option)}
        </label>`,
        )
        .join('')}
    </div>`;
}

/** Exclusive Complete / Incomplete control; empty selection still disables the filter. */
function renderCompletionToggle(filter: CategoryPermeabilityFilter): string {
  const selected =
    filter.values.includes('Complete') && !filter.values.includes('Incomplete')
      ? 'Complete'
      : filter.values.includes('Incomplete') && !filter.values.includes('Complete')
        ? 'Incomplete'
        : null;
  return `
    <div class="filter-binary-toggle" data-category="completionStatus" role="group" aria-label="Completion status">
      ${AO3_COMPLETION_STATUSES.map(
        (option) => `
      <button
        type="button"
        class="mode-btn ${selected === option ? 'active' : ''}"
        data-completion-value="${option}"
      >${option}</button>`,
      ).join('')}
    </div>
    <p class="field-hint">Select Complete or Incomplete. Clear by clicking the active option again.</p>`;
}

function renderChipList(category: PermeabilityCategoryKey, filter: CategoryPermeabilityFilter): string {
  const chips =
    filter.values.length === 0
      ? `<p class="filter-chips-empty">No values selected.</p>`
      : `<div class="filter-chips" role="list">
          ${filter.values
            .map(
              (value) => `
            <button type="button" class="filter-chip" data-remove-value="${escapeAttr(value)}" title="Remove">
              ${escapeHtml(value)} ×
            </button>`,
            )
            .join('')}
        </div>`;

  return `
    <div class="filter-chip-editor" data-category="${category}">
      ${chips}
      <div class="chip-add-row">
        <input type="text" class="chip-input" data-chip-input="${category}" placeholder="Add value…" />
        <button type="button" class="secondary" data-add-chip="${category}">Add</button>
      </div>
    </div>`;
}

function renderFilterValues(category: PermeabilityCategoryKey, filter: CategoryPermeabilityFilter): string {
  if (category === 'completionStatus') return renderCompletionToggle(filter);
  if (EXHAUSTIVE_OPTIONS[category] != null) return renderCheckboxList(category, filter);
  return renderChipList(category, filter);
}

function renderPermeabilityFilters(): void {
  permeabilityRoot.innerHTML = PERMEABILITY_CATEGORY_KEYS.map((category) => {
    const filter = permeabilityState[category];
    return `
      <article class="filter-card" data-filter-category="${category}">
        <header class="filter-card-header">
          <h3>${CATEGORY_LABELS[category]}</h3>
          <div class="mode-toggle" role="group" aria-label="${CATEGORY_LABELS[category]} mode">
            <button type="button" class="mode-btn ${filter.mode === 'blacklist' ? 'active' : ''}" data-mode="blacklist" data-category="${category}">Blacklist</button>
            <button type="button" class="mode-btn ${filter.mode === 'whitelist' ? 'active' : ''}" data-mode="whitelist" data-category="${category}">Whitelist</button>
          </div>
        </header>
        <div class="field-row">
          <label for="perm-${category}">Blocked permeability</label>
          <div class="slider-row">
            <input id="perm-${category}" type="range" min="0" max="1" step="0.01" value="${filter.permeability}" data-permeability-slider="${category}" />
            <output data-permeability-value="${category}">${filter.permeability.toFixed(2)}</output>
          </div>
          <p class="field-hint">Applied to blocked values (0 = hard block, 1 = no penalty).</p>
        </div>
        ${renderFilterValues(category, filter)}
      </article>`;
  }).join('');

  bindPermeabilityControls();
}

function bindPermeabilityControls(): void {
  permeabilityRoot.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const category = button.getAttribute('data-category') as PermeabilityCategoryKey | null;
      const mode = button.getAttribute('data-mode') as FilterMode | null;
      if (!category || !mode) return;
      permeabilityState[category] = { ...permeabilityState[category], mode };
      renderPermeabilityFilters();
    });
  });

  permeabilityRoot.querySelectorAll<HTMLInputElement>('[data-permeability-slider]').forEach((slider) => {
    slider.addEventListener('input', () => {
      const category = slider.getAttribute('data-permeability-slider') as PermeabilityCategoryKey | null;
      if (!category) return;
      const value = Number(slider.value);
      permeabilityState[category] = {
        ...permeabilityState[category],
        permeability: Number.isFinite(value) ? value : 0,
      };
      const output = permeabilityRoot.querySelector(`[data-permeability-value="${category}"]`);
      if (output) output.textContent = permeabilityState[category].permeability.toFixed(2);
    });
  });

  permeabilityRoot.querySelectorAll<HTMLInputElement>('[data-filter-value]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const list = checkbox.closest<HTMLElement>('[data-category]');
      const category = list?.getAttribute('data-category') as PermeabilityCategoryKey | null;
      if (!list || !category) return;
      const values = [...list.querySelectorAll<HTMLInputElement>('[data-filter-value]:checked')].map(
        (el) => el.getAttribute('data-filter-value') ?? '',
      ).filter(Boolean);
      permeabilityState[category] = { ...permeabilityState[category], values };
    });
  });

  permeabilityRoot.querySelectorAll<HTMLButtonElement>('[data-completion-value]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.getAttribute('data-completion-value');
      if (!value) return;
      const current = permeabilityState.completionStatus.values;
      const alreadySelected = current.length === 1 && current[0] === value;
      permeabilityState.completionStatus = {
        ...permeabilityState.completionStatus,
        values: alreadySelected ? [] : [value],
      };
      renderPermeabilityFilters();
    });
  });

  permeabilityRoot.querySelectorAll<HTMLButtonElement>('[data-remove-value]').forEach((button) => {
    button.addEventListener('click', () => {
      const editor = button.closest<HTMLElement>('[data-category]');
      const category = editor?.getAttribute('data-category') as PermeabilityCategoryKey | null;
      const value = button.getAttribute('data-remove-value');
      if (!category || value == null) return;
      permeabilityState[category] = {
        ...permeabilityState[category],
        values: permeabilityState[category].values.filter((v) => v !== value),
      };
      renderPermeabilityFilters();
    });
  });

  permeabilityRoot.querySelectorAll<HTMLButtonElement>('[data-add-chip]').forEach((button) => {
    button.addEventListener('click', () => {
      const category = button.getAttribute('data-add-chip') as PermeabilityCategoryKey | null;
      if (!category) return;
      const input = permeabilityRoot.querySelector<HTMLInputElement>(`[data-chip-input="${category}"]`);
      const raw = input?.value.trim() ?? '';
      if (!raw) return;
      if (!permeabilityState[category].values.includes(raw)) {
        permeabilityState[category] = {
          ...permeabilityState[category],
          values: [...permeabilityState[category].values, raw],
        };
      }
      renderPermeabilityFilters();
    });
  });

  permeabilityRoot.querySelectorAll<HTMLInputElement>('[data-chip-input]').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const category = input.getAttribute('data-chip-input') as PermeabilityCategoryKey | null;
      if (!category) return;
      const addButton = permeabilityRoot.querySelector<HTMLButtonElement>(`[data-add-chip="${category}"]`);
      addButton?.click();
    });
  });
}

async function initSettings(): Promise<void> {
  applyInputBounds();
  const settings = await loadSettings();
  fillSettingsForm(settings);
}

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const saved = await saveSettings(readSettingsForm());
    fillSettingsForm(saved);
    setSettingsStatus('Settings saved.');
  })();
});

expansionPolicySelect.addEventListener('change', () => {
  updateAStarThinkVisibility();
});

savePermeabilityButton.addEventListener('click', () => {
  void (async () => {
    const saved = await saveSettings(readSettingsForm());
    fillSettingsForm(saved);
    setPermeabilityStatus('Permeability filters saved.');
  })();
});

themeToggle.querySelectorAll<HTMLButtonElement>('[data-theme-value]').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.getAttribute('data-theme-value') as ThemePreference | null;
    if (!value || value === themeState) return;
    void (async () => {
      applyThemePreference(value);
      const saved = await saveSettings(readSettingsForm());
      fillSettingsForm(saved);
      setThemeStatus(
        value === 'system'
          ? 'Theme set to System (follows OS preference).'
          : `Theme set to ${value === 'light' ? 'Light' : 'Dark'}.`,
      );
    })();
  });
});

restoreDefaultsButton.addEventListener('click', () => {
  void (async () => {
    const restored = await resetSettings();
    fillSettingsForm(restored);
    setSettingsStatus(
      `Restored defaults (top results ${DEFAULT_SETTINGS.topResults}, max seeds ${DEFAULT_SETTINGS.maxSeeds}, max negative seeds ${DEFAULT_SETTINGS.maxNegativeSeeds}, λ ${DEFAULT_SETTINGS.negativeRelevanceLambda}, A* think ${DEFAULT_SETTINGS.queryAStarMaxThinkMs / 1000}s).`,
    );
    setPermeabilityStatus('Permeability filters restored to defaults (no active filters).');
    setThemeStatus('Theme restored to System.');
  })();
});

tagsInput.addEventListener('change', () => {
  const file = tagsInput.files?.[0] ?? null;
  if (file && !isStatsTagsFileName(file.name)) {
    tagsFile = null;
    setStatus('Expected a tags-YYYYMMDD.csv file.', true);
    updateImportButton();
    return;
  }
  tagsFile = file;
  statusEl.hidden = true;
  updateImportButton();
});

importButton.addEventListener('click', () => {
  void importStats();
});

exportGraphButton.addEventListener('click', () => {
  void exportCurrentGraph();
});

importGraphButton.addEventListener('click', () => {
  importGraphInput.click();
});

importGraphInput.addEventListener('change', () => {
  const file = importGraphInput.files?.[0];
  importGraphInput.value = '';
  if (!file) return;
  void loadImportFile(file);
});

async function importStats(): Promise<void> {
  if (!tagsFile || importing) return;

  importing = true;
  updateImportButton();
  setStatus('Starting stats import…');

  const result = await runStatsImportLocal({
    tagsFile,
    clearExisting: clearCheckbox.checked,
    onProgress: (message) => setStatus(message),
  });

  importing = false;
  updateImportButton();
  setStatus(result.message, !result.success);

  if (result.success) {
    tagsFile = null;
    tagsInput.value = '';
    updateImportButton();
    await refreshGraphStats();
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (!isExtensionMessage(message) || message.type !== 'StateUpdate') return;
  suppressedWorks = message.suppressedWorks ?? [];
  renderSuppressedWorks();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(SETTINGS_STORAGE_KEY in changes)) return;
  const next = settingsFromStorageChange(changes[SETTINGS_STORAGE_KEY]);
  if (!next) return;
  fillSettingsForm(next);
});

void initSettings();
void loadSuppressedWorks();
void refreshGraphStats();

import './style.css';
import { isStatsTagsFileName } from '@/src/ao3/statsDump';
import type { GraphStats } from '@/src/graph/types';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  resetSettings,
  saveSettings,
  SETTINGS_BOUNDS,
  type TunableSettings,
} from '@/src/config/settings';
import { runStatsImportLocal } from '@/src/storage/statsImportRunner';
import { sendMessage } from '@/src/messaging/protocol';

const tagsInput = document.querySelector<HTMLInputElement>('#stats-tags-file')!;
const clearCheckbox = document.querySelector<HTMLInputElement>('#stats-clear-existing')!;
const importButton = document.querySelector<HTMLButtonElement>('#import-stats')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#stats-status')!;
const graphStatsEl = document.querySelector<HTMLParagraphElement>('#graph-stats')!;

const settingsForm = document.querySelector<HTMLFormElement>('#settings-form')!;
const topResultsInput = document.querySelector<HTMLInputElement>('#setting-top-results')!;
const maxSeedsInput = document.querySelector<HTMLInputElement>('#setting-max-seeds')!;
const maxNegativeSeedsInput = document.querySelector<HTMLInputElement>(
  '#setting-max-negative-seeds',
)!;
const negativeLambdaInput = document.querySelector<HTMLInputElement>('#setting-negative-lambda')!;
const restoreDefaultsButton = document.querySelector<HTMLButtonElement>('#restore-defaults')!;
const settingsStatusEl = document.querySelector<HTMLParagraphElement>('#settings-status')!;

let tagsFile: File | null = null;
let importing = false;

function formatGraphStats(stats: GraphStats): string {
  return `${stats.workCount.toLocaleString()} works · ${stats.tagCount.toLocaleString()} tags · ${stats.authorCount.toLocaleString()} authors`;
}

function setStatus(message: string, isError = false): void {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function setSettingsStatus(message: string, isError = false): void {
  settingsStatusEl.hidden = false;
  settingsStatusEl.textContent = message;
  settingsStatusEl.classList.toggle('error', isError);
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
}

function fillSettingsForm(settings: TunableSettings): void {
  topResultsInput.value = String(settings.topResults);
  maxSeedsInput.value = String(settings.maxSeeds);
  maxNegativeSeedsInput.value = String(settings.maxNegativeSeeds);
  negativeLambdaInput.value = String(settings.negativeRelevanceLambda);
}

function readSettingsForm(): TunableSettings {
  return normalizeSettings({
    topResults: topResultsInput.valueAsNumber,
    maxSeeds: maxSeedsInput.valueAsNumber,
    maxNegativeSeeds: maxNegativeSeedsInput.valueAsNumber,
    negativeRelevanceLambda: negativeLambdaInput.valueAsNumber,
  });
}

async function refreshGraphStats(): Promise<void> {
  const response = await sendMessage({ type: 'GetGraphStats' });
  if (response?.type === 'GraphStats') {
    graphStatsEl.textContent = `Current graph: ${formatGraphStats(response.stats)}`;
  }
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

restoreDefaultsButton.addEventListener('click', () => {
  void (async () => {
    const restored = await resetSettings();
    fillSettingsForm(restored);
    setSettingsStatus(
      `Restored defaults (top results ${DEFAULT_SETTINGS.topResults}, max seeds ${DEFAULT_SETTINGS.maxSeeds}, max negative seeds ${DEFAULT_SETTINGS.maxNegativeSeeds}, λ ${DEFAULT_SETTINGS.negativeRelevanceLambda}).`,
    );
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

void initSettings();
void refreshGraphStats();

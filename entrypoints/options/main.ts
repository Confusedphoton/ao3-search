import './style.css';
import { isStatsTagsFileName } from '@/src/ao3/statsDump';
import type { GraphStats } from '@/src/graph/types';
import { isSearchTraceEnabled, setSearchTraceEnabled } from '@/src/config/debug';
import { runStatsImportLocal } from '@/src/storage/statsImportRunner';
import { sendMessage } from '@/src/messaging/protocol';

const tagsInput = document.querySelector<HTMLInputElement>('#stats-tags-file')!;
const clearCheckbox = document.querySelector<HTMLInputElement>('#stats-clear-existing')!;
const importButton = document.querySelector<HTMLButtonElement>('#import-stats')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#stats-status')!;
const graphStatsEl = document.querySelector<HTMLParagraphElement>('#graph-stats')!;
const debugTraceCheckbox = document.querySelector<HTMLInputElement>('#debug-search-trace')!;
const traceInfoEl = document.querySelector<HTMLParagraphElement>('#trace-info')!;
const downloadTraceButton = document.querySelector<HTMLButtonElement>('#download-search-trace')!;

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

function updateImportButton(): void {
  importButton.disabled = importing || tagsFile == null;
  importButton.textContent = importing ? 'Importing…' : 'Import stats';
}

async function refreshGraphStats(): Promise<void> {
  const response = await sendMessage({ type: 'GetGraphStats' });
  if (response?.type === 'GraphStats') {
    graphStatsEl.textContent = `Current graph: ${formatGraphStats(response.stats)}`;
  }
}

async function refreshTraceInfo(): Promise<void> {
  const response = await sendMessage({ type: 'GetSearchTrace' });
  if (response?.type === 'SearchTraceInfo' && response.info.available) {
    traceInfoEl.textContent = `Last trace: ${response.info.stepCount} steps, ${response.info.nodeCount?.toLocaleString()} nodes (${response.info.searchId})`;
    downloadTraceButton.disabled = false;
  } else {
    traceInfoEl.textContent = 'No search trace captured yet. Run a search with tracing enabled.';
    downloadTraceButton.disabled = true;
  }
}

async function loadDebugSettings(): Promise<void> {
  debugTraceCheckbox.checked = await isSearchTraceEnabled();
}

debugTraceCheckbox.addEventListener('change', () => {
  void setSearchTraceEnabled(debugTraceCheckbox.checked);
});

downloadTraceButton.addEventListener('click', () => {
  void downloadSearchTrace();
});

async function downloadSearchTrace(): Promise<void> {
  const response = await sendMessage({ type: 'ExportSearchTrace' });
  if (response?.type !== 'SearchTraceExported' || !response.trace) {
    traceInfoEl.textContent = 'No search trace available to download.';
    downloadTraceButton.disabled = true;
    return;
  }

  const blob = new Blob([JSON.stringify(response.trace, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `search-trace-${response.trace.searchId}.json`;
  link.click();
  URL.revokeObjectURL(url);
  traceInfoEl.textContent = `Downloaded trace ${response.trace.searchId} (${response.trace.steps.length} steps).`;
}

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

void refreshGraphStats();
void loadDebugSettings();
void refreshTraceInfo();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshTraceInfo();
});

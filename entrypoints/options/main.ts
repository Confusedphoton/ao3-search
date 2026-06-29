import './style.css';
import { isStatsTagsFileName } from '@/src/ao3/statsDump';
import type { GraphStats } from '@/src/graph/types';
import { runStatsImportLocal } from '@/src/storage/statsImportRunner';
import { sendMessage } from '@/src/messaging/protocol';

const tagsInput = document.querySelector<HTMLInputElement>('#stats-tags-file')!;
const clearCheckbox = document.querySelector<HTMLInputElement>('#stats-clear-existing')!;
const importButton = document.querySelector<HTMLButtonElement>('#import-stats')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#stats-status')!;
const graphStatsEl = document.querySelector<HTMLParagraphElement>('#graph-stats')!;

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

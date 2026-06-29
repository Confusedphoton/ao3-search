import { streamTextFileLines } from '../ao3/streamTextFile';
import type { StatsImportProgress } from '../graph/types';
import { sendMessage } from '../messaging/protocol';
import { StatsTagsImporter, resetStatsMetadata } from './statsImport';

export interface RunStatsImportOptions {
  tagsFile: File;
  clearExisting: boolean;
  onProgress?: (message: string) => void;
}

export interface RunStatsImportResult {
  success: boolean;
  message: string;
}

function reportProgress(
  onProgress: RunStatsImportOptions['onProgress'],
  payload: StatsImportProgress,
): void {
  onProgress?.(payload.message ?? 'Importing stats…');
}

export async function runStatsImportLocal(
  options: RunStatsImportOptions,
): Promise<RunStatsImportResult> {
  const { tagsFile, clearExisting, onProgress } = options;

  const state = await sendMessage({ type: 'GetState' });
  if (state?.type === 'StateUpdate' && state.searching) {
    return { success: false, message: 'Cannot import stats while a search is running.' };
  }

  try {
    if (clearExisting) {
      await resetStatsMetadata();
    }

    const tagsImporter = await StatsTagsImporter.create({
      onProgress: (payload) => reportProgress(onProgress, payload),
    });

    await streamTextFileLines(tagsFile, async (line) => {
      await tagsImporter.processLines([line]);
    });
    const tagsResult = await tagsImporter.finish();

    return {
      success: true,
      message: `Imported ${tagsResult.tagsStored.toLocaleString()} global tags; calibrated ${tagsResult.tagsCalibrated.toLocaleString()} graph tags; merged ${tagsResult.tagsMerged.toLocaleString()} synonym tags.`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

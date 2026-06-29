import type { StatsImportProgress, StatsImportResult } from '../graph/types';
import { StatsTagsImporter, resetStatsMetadata } from '../storage/statsImport';

export type StatsImportPortRequest =
  | { type: 'StatsImportStart'; clearExisting: boolean }
  | { type: 'StatsImportChunk'; data: string; final: boolean };

export type StatsImportPortResponse =
  | { type: 'StatsImportReady' }
  | { type: 'StatsImportProgress'; payload: StatsImportProgress }
  | { type: 'StatsImportComplete'; success: boolean; message: string; result: StatsImportResult | null };

const PORT_NAME = 'ao3-stats-import';

export function registerStatsImportPort(searching: () => boolean): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    let tagsImporter: StatsTagsImporter | null = null;
    let tagsBuffer = '';
    let messageChain: Promise<void> = Promise.resolve();

    const send = (message: StatsImportPortResponse): void => {
      port.postMessage(message);
    };

    const fail = (message: string): void => {
      send({ type: 'StatsImportComplete', success: false, message, result: null });
      port.disconnect();
    };

    const splitChunk = (buffer: string, data: string, final: boolean): { lines: string[]; remainder: string } => {
      const combined = buffer + data;
      const parts = combined.split('\n');
      const remainder = final ? '' : parts.pop() ?? '';
      return { lines: parts, remainder };
    };

    const enqueue = (task: () => Promise<void>): void => {
      messageChain = messageChain.then(task).catch((err) => {
        fail(err instanceof Error ? err.message : String(err));
      });
    };

    port.onMessage.addListener((message: StatsImportPortRequest) => {
      enqueue(async () => {
        if (searching()) {
          fail('Cannot import stats while a search is running.');
          return;
        }

        if (message.type === 'StatsImportStart') {
          tagsBuffer = '';
          tagsImporter = await StatsTagsImporter.create({
            onProgress: (payload) => send({ type: 'StatsImportProgress', payload }),
          });
          if (message.clearExisting) {
            await resetStatsMetadata();
          }
          send({ type: 'StatsImportReady' });
          return;
        }

        if (message.type === 'StatsImportChunk') {
          if (!tagsImporter) {
            fail('Stats import was not started.');
            return;
          }

          const { lines, remainder } = splitChunk(tagsBuffer, message.data, message.final);
          tagsBuffer = remainder;
          await tagsImporter.processLines(lines);
          if (message.final) {
            if (tagsBuffer) {
              await tagsImporter.processLines([tagsBuffer.replace(/\r$/, '')]);
              tagsBuffer = '';
            }
            const tagsResult = await tagsImporter.finish();
            send({
              type: 'StatsImportComplete',
              success: true,
              message: `Imported ${tagsResult.tagsStored.toLocaleString()} global tags; calibrated ${tagsResult.tagsCalibrated.toLocaleString()} graph tags; merged ${tagsResult.tagsMerged.toLocaleString()} synonym tags.`,
              result: tagsResult,
            });
            port.disconnect();
          }
        }
      });
    });
  });
}

export { PORT_NAME as STATS_IMPORT_PORT_NAME };

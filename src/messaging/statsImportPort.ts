import type { StatsImportProgress, StatsImportResult } from '../graph/types';
import {
  StatsTagsImporter,
  StatsWorksImporter,
  resetStatsMetadata,
} from '../storage/statsImport';

export type StatsImportPortRequest =
  | { type: 'StatsImportStart'; clearExisting: boolean; importWorks: boolean }
  | { type: 'StatsImportChunk'; kind: 'tags' | 'works'; data: string; final: boolean };

export type StatsImportPortResponse =
  | { type: 'StatsImportReady' }
  | { type: 'StatsImportProgress'; payload: StatsImportProgress }
  | { type: 'StatsImportComplete'; success: boolean; message: string; result: StatsImportResult | null };

const PORT_NAME = 'ao3-stats-import';

export function registerStatsImportPort(searching: () => boolean): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    let tagsImporter: StatsTagsImporter | null = null;
    let worksImporter: StatsWorksImporter | null = null;
    let tagsBuffer = '';
    let worksBuffer = '';
    let tagsResult: StatsImportResult | null = null;
    let importWorks = false;
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

    const ensureWorksImporter = async (): Promise<StatsWorksImporter> => {
      if (!worksImporter) {
        worksImporter = await StatsWorksImporter.create({
          onProgress: (payload) => send({ type: 'StatsImportProgress', payload }),
        });
      }
      return worksImporter;
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
          importWorks = message.importWorks;
          tagsBuffer = '';
          worksBuffer = '';
          tagsResult = null;
          worksImporter = null;
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

          if (message.kind === 'tags') {
            const { lines, remainder } = splitChunk(tagsBuffer, message.data, message.final);
            tagsBuffer = remainder;
            await tagsImporter.processLines(lines);
            if (message.final) {
              if (tagsBuffer) {
                await tagsImporter.processLines([tagsBuffer.replace(/\r$/, '')]);
                tagsBuffer = '';
              }
              tagsResult = await tagsImporter.finish();
              if (!importWorks) {
                send({
                  type: 'StatsImportComplete',
                  success: true,
                  message: `Imported ${tagsResult.tagsStored.toLocaleString()} global tags; calibrated ${tagsResult.tagsCalibrated.toLocaleString()} graph tags; merged ${tagsResult.tagsMerged.toLocaleString()} synonym tags.`,
                  result: tagsResult,
                });
                port.disconnect();
              }
            }
            return;
          }

          const works = await ensureWorksImporter();
          const { lines, remainder } = splitChunk(worksBuffer, message.data, message.final);
          worksBuffer = remainder;
          await works.processLines(lines);
          if (message.final) {
            if (worksBuffer) {
              await works.processLines([worksBuffer.replace(/\r$/, '')]);
              worksBuffer = '';
            }
            const worksResult = await works.finish();
            const combined: StatsImportResult = {
              tagsStored: tagsResult?.tagsStored ?? 0,
              tagsCalibrated: tagsResult?.tagsCalibrated ?? 0,
              tagsMerged: tagsResult?.tagsMerged ?? 0,
              worksMatched: worksResult.worksMatched,
              edgesAdded: worksResult.edgesAdded,
            };
            send({
              type: 'StatsImportComplete',
              success: true,
              message: `Calibrated ${combined.tagsCalibrated.toLocaleString()} graph tags; merged ${combined.tagsMerged.toLocaleString()} synonym tags; matched ${combined.worksMatched.toLocaleString()} works; added ${combined.edgesAdded.toLocaleString()} edges.`,
              result: combined,
            });
            port.disconnect();
          }
        }
      });
    });
  });
}

export { PORT_NAME as STATS_IMPORT_PORT_NAME };

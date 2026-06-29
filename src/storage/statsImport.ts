import { parseStatsTagRow } from '../ao3/statsDump';
import type { StatsImportProgress, StatsImportResult, StatsTagRecord } from '../graph/types';
import {
  calibrateGraphTagNodesBatch,
  clearStatsMetadata,
  getGraphTagNameToNodeId,
  putStatsTagsBatch,
} from './db';
import { applyStatsTagMergesToGraph } from './tagCanonical';

const STATS_TAG_BATCH_SIZE = 5_000;
const STATS_PROGRESS_INTERVAL = 25_000;
const STATS_YIELD_INTERVAL = 50_000;

export interface StatsTagsImportOptions {
  onProgress?: (progress: StatsImportProgress) => void;
  storeGlobal?: boolean;
  applyToGraph?: boolean;
}

export class StatsTagsImporter {
  private readonly storeGlobal: boolean;
  private readonly applyToGraph: boolean;
  private readonly onProgress?: (progress: StatsImportProgress) => void;
  private readonly graphTags: Map<string, number>;
  private readonly graphTagNames: Set<string>;
  private batch: StatsTagRecord[] = [];
  private calibration = new Map<number, number>();
  private rowsProcessed = 0;
  private tagsStored = 0;
  private tagsCalibrated = 0;
  private headerSkipped = false;

  private constructor(
    graphTags: Map<string, number>,
    options: StatsTagsImportOptions,
  ) {
    this.graphTags = graphTags;
    this.graphTagNames = new Set(graphTags.keys());
    this.storeGlobal = options.storeGlobal ?? true;
    this.applyToGraph = options.applyToGraph ?? true;
    this.onProgress = options.onProgress;
  }

  static async create(options: StatsTagsImportOptions = {}): Promise<StatsTagsImporter> {
    const applyToGraph = options.applyToGraph ?? true;
    const graphTags = applyToGraph ? await getGraphTagNameToNodeId() : new Map<string, number>();
    return new StatsTagsImporter(graphTags, options);
  }

  async processLines(lines: string[]): Promise<void> {
    let startIndex = 0;
    if (!this.headerSkipped && lines.length > 0) {
      this.headerSkipped = true;
      startIndex = 1;
    }

    for (let i = startIndex; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;

      this.rowsProcessed += 1;
      const row = parseStatsTagRow(line);
      if (!row || !row.name) continue;

      if (this.storeGlobal) {
        this.batch.push({
          tagId: row.tagId,
          name: row.name,
          type: row.type,
          canonical: row.canonical,
          cachedCount: row.cachedCount,
          mergerId: row.mergerId,
        });
        if (this.batch.length >= STATS_TAG_BATCH_SIZE) {
          await this.flushBatch();
        }
      }

      if (this.applyToGraph) {
        const nodeId = this.graphTags.get(row.name);
        if (nodeId != null) {
          const previous = this.calibration.get(nodeId);
          if (previous == null || row.cachedCount > previous) {
            this.calibration.set(nodeId, row.cachedCount);
          }
        }
      }

      if (this.rowsProcessed % STATS_YIELD_INTERVAL === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }

      if (this.rowsProcessed % STATS_PROGRESS_INTERVAL === 0) {
        this.onProgress?.({
          phase: 'tags',
          rowsProcessed: this.rowsProcessed,
          tagsStored: this.tagsStored,
          tagsCalibrated: this.calibration.size,
          tagsMerged: 0,
          worksMatched: 0,
          edgesAdded: 0,
          message: `Processed ${this.rowsProcessed.toLocaleString()} tag rows…`,
        });
      }
    }
  }

  async finish(): Promise<StatsImportResult> {
    await this.flushBatch();
    if (this.applyToGraph) {
      await calibrateGraphTagNodesBatch(this.calibration);
      this.tagsCalibrated = this.calibration.size;
    }
    const tagsMerged = this.applyToGraph ? await applyStatsTagMergesToGraph() : 0;
    const result: StatsImportResult = {
      tagsStored: this.tagsStored,
      tagsCalibrated: this.tagsCalibrated,
      tagsMerged,
      worksMatched: 0,
      edgesAdded: 0,
    };
    this.onProgress?.({
      phase: 'done',
      rowsProcessed: this.rowsProcessed,
      ...result,
      message: `Imported ${this.tagsStored.toLocaleString()} global tags; calibrated ${this.tagsCalibrated.toLocaleString()} graph tags; merged ${tagsMerged.toLocaleString()} synonym tags.`,
    });
    return result;
  }

  private async flushBatch(): Promise<void> {
    if (!this.storeGlobal || this.batch.length === 0) return;
    await putStatsTagsBatch(this.batch, { indexNames: this.graphTagNames });
    this.tagsStored += this.batch.length;
    this.batch = [];
  }
}

export async function importStatsTagsLines(
  lines: Iterable<string>,
  options: StatsTagsImportOptions = {},
): Promise<StatsImportResult> {
  const importer = await StatsTagsImporter.create(options);
  await importer.processLines([...lines]);
  return importer.finish();
}

export async function resetStatsMetadata(): Promise<void> {
  await clearStatsMetadata();
}

export { parseStatsTagRow } from '../ao3/statsDump';

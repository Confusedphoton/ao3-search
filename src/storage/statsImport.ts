import { isContentStatsTagType, parseStatsTagRow, parseStatsWorkRow } from '../ao3/statsDump';
import type { StatsImportProgress, StatsImportResult, StatsTagRecord } from '../graph/types';
import {
  addEdge,
  calibrateGraphTagNode,
  clearStatsMetadata,
  countStatsTags,
  ensureTagNodeFromStats,
  getGraphTagNameToNodeId,
  getGraphWorkKeyToNodeId,
  getStatsTag,
  putStatsTagsBatch,
} from './db';
import { applyStatsTagMergesToGraph, resolveStatsTagForGraph } from './tagCanonical';

const STATS_TAG_BATCH_SIZE = 1000;
const STATS_PROGRESS_INTERVAL = 25_000;

export interface StatsTagsImportOptions {
  onProgress?: (progress: StatsImportProgress) => void;
  storeGlobal?: boolean;
  applyToGraph?: boolean;
}

export interface StatsWorksImportOptions {
  onProgress?: (progress: StatsImportProgress) => void;
  requireGlobalTags?: boolean;
}

export class StatsTagsImporter {
  private readonly storeGlobal: boolean;
  private readonly applyToGraph: boolean;
  private readonly onProgress?: (progress: StatsImportProgress) => void;
  private readonly graphTags: Map<string, number>;
  private batch: StatsTagRecord[] = [];
  private rowsProcessed = 0;
  private tagsStored = 0;
  private tagsCalibrated = 0;
  private headerSkipped = false;

  private constructor(
    graphTags: Map<string, number>,
    options: StatsTagsImportOptions,
  ) {
    this.graphTags = graphTags;
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
          await calibrateGraphTagNode(nodeId, row.cachedCount);
          this.tagsCalibrated += 1;
        }
      }

      if (this.rowsProcessed % STATS_PROGRESS_INTERVAL === 0) {
        this.onProgress?.({
          phase: 'tags',
          rowsProcessed: this.rowsProcessed,
          tagsStored: this.tagsStored,
          tagsCalibrated: this.tagsCalibrated,
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
    await putStatsTagsBatch(this.batch);
    this.tagsStored += this.batch.length;
    this.batch = [];
  }
}

export class StatsWorksImporter {
  private readonly onProgress?: (progress: StatsImportProgress) => void;
  private readonly workKeys: Map<string, number>;
  private rowsProcessed = 0;
  private worksMatched = 0;
  private edgesAdded = 0;
  private headerSkipped = false;

  private constructor(workKeys: Map<string, number>, options: StatsWorksImportOptions) {
    this.workKeys = workKeys;
    this.onProgress = options.onProgress;
  }

  static async create(options: StatsWorksImportOptions = {}): Promise<StatsWorksImporter> {
    if ((options.requireGlobalTags ?? true) && (await countStatsTags()) === 0) {
      throw new Error('Import the tags CSV before importing works.');
    }
    const workKeys = await getGraphWorkKeyToNodeId();
    return new StatsWorksImporter(workKeys, options);
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
      const row = parseStatsWorkRow(line, this.rowsProcessed);
      if (!row) continue;

      const workNodeId = this.workKeys.get(String(row.rowId));
      if (workNodeId == null) continue;

      this.worksMatched += 1;
      const seenTagIds = new Set<number>();

      for (const tagId of row.tagIds) {
        if (seenTagIds.has(tagId)) continue;
        seenTagIds.add(tagId);

        const statsTag = await getStatsTag(tagId);
        if (!statsTag || !isContentStatsTagType(statsTag.type)) continue;

        const canonical = await resolveStatsTagForGraph(statsTag);
        if (!canonical.name) continue;

        const tagNode = await ensureTagNodeFromStats(canonical);
        await addEdge(workNodeId, tagNode.id);
        this.edgesAdded += 1;
      }

      if (this.rowsProcessed % STATS_PROGRESS_INTERVAL === 0) {
        this.onProgress?.({
          phase: 'works',
          rowsProcessed: this.rowsProcessed,
          tagsStored: 0,
          tagsCalibrated: 0,
          worksMatched: this.worksMatched,
          edgesAdded: this.edgesAdded,
          message: `Processed ${this.rowsProcessed.toLocaleString()} work rows…`,
        });
      }
    }
  }

  async finish(): Promise<StatsImportResult> {
    const result: StatsImportResult = {
      tagsStored: 0,
      tagsCalibrated: 0,
      tagsMerged: 0,
      worksMatched: this.worksMatched,
      edgesAdded: this.edgesAdded,
    };
    this.onProgress?.({
      phase: 'done',
      rowsProcessed: this.rowsProcessed,
      ...result,
      message:
        this.worksMatched === 0
          ? `Processed ${this.rowsProcessed.toLocaleString()} work rows; no graph works matched dump row IDs.`
          : `Matched ${this.worksMatched.toLocaleString()} works and added ${this.edgesAdded.toLocaleString()} tag edges.`,
    });
    return result;
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

export async function importStatsWorksLines(
  lines: Iterable<string>,
  options: StatsWorksImportOptions = {},
): Promise<StatsImportResult> {
  const importer = await StatsWorksImporter.create(options);
  await importer.processLines([...lines]);
  return importer.finish();
}

export async function resetStatsMetadata(): Promise<void> {
  await clearStatsMetadata();
}

export { parseStatsTagRow, parseStatsWorkRow } from '../ao3/statsDump';

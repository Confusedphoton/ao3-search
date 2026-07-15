import { DB_NAME, DB_VERSION } from '../config/constants';
import { mergeWorkMetadata, normalizeWorkMetadata } from '../ao3/workMeta';
import {
  defaultExplorationFields,
  mergeExplorationStatus,
  resolveListingExploration,
} from '../graph/exploration';
import type {
  AuthorMergeInput,
  AuthorWorkEdge,
  ExplorationUpdateInput,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  ListedWorkInput,
  SearchMergeInput,
  StatsTagRecord,
  TagMergeInput,
  WorkMergeInput,
} from '../graph/types';
import { NodeKind } from '../graph/types';
import { fuzzyTagMatch } from '../search/fuzzyTagMatch';
import { resolveCanonicalStatsTag } from './statsTagLookup';

interface MetaRecord {
  key: string;
  value: number;
}

interface StatsTagNameIndex {
  name: string;
  tagId: number;
}

interface KeyIndexRecord {
  compoundKey: string;
  nodeId: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function compoundKey(kind: NodeKind, key: string): string {
  return `${kind}:${key}`;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('nodes')) {
        db.createObjectStore('nodes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('keyIndex')) {
        db.createObjectStore('keyIndex', { keyPath: 'compoundKey' });
      }
      if (!db.objectStoreNames.contains('edges')) {
        const store = db.createObjectStore('edges', {
          keyPath: ['workNodeId', 'tagNodeId'],
        });
        store.createIndex('byWork', 'workNodeId', { unique: false });
        store.createIndex('byTag', 'tagNodeId', { unique: false });
      }

      if (oldVersion < 2 && !db.objectStoreNames.contains('authorEdges')) {
        const store = db.createObjectStore('authorEdges', {
          keyPath: ['workNodeId', 'authorNodeId'],
        });
        store.createIndex('byWork', 'workNodeId', { unique: false });
        store.createIndex('byAuthor', 'authorNodeId', { unique: false });
      }

      if (oldVersion < 3 && !db.objectStoreNames.contains('statsTags')) {
        db.createObjectStore('statsTags', { keyPath: 'tagId' });
      }

      if (oldVersion < 4 && !db.objectStoreNames.contains('statsTagNames')) {
        db.createObjectStore('statsTagNames', { keyPath: 'name' });
      }

      // v6: WorkMetadata lives on GraphNode.meta (no new object store).
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeNames, mode);
        fn(transaction).then(resolve).catch(reject);
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}

async function getMeta(key: string, defaultValue: number): Promise<number> {
  return tx('meta', 'readonly', async (transaction) => {
    const store = transaction.objectStore('meta');
    return new Promise((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => {
        const record = req.result as MetaRecord | undefined;
        resolve(record?.value ?? defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  });
}

async function setMeta(key: string, value: number): Promise<void> {
  await tx('meta', 'readwrite', async (transaction) => {
    transaction.objectStore('meta').put({ key, value } satisfies MetaRecord);
  });
}

async function allocateNodeIds(count: number): Promise<number> {
  const start = await getMeta('nextNodeId', 0);
  await setMeta('nextNodeId', start + count);
  return start;
}

function normalizeGraphNode(node: GraphNode): GraphNode {
  const meta =
    node.kind === NodeKind.Work ? normalizeWorkMetadata(node.meta) : undefined;

  // Migrate legacy boolean-only nodes from IndexedDB.
  const explorationStatus =
    node.explorationStatus ??
    (node.explored ? ('complete' as const) : ('unexplored' as const));
  const explored = explorationStatus === 'complete';

  return {
    ...node,
    wordCount: node.wordCount ?? null,
    explorationStatus,
    exploredAt: node.exploredAt ?? null,
    listingNextPage: node.listingNextPage ?? null,
    listingPagesFetched: node.listingPagesFetched ?? 0,
    explored,
    ...(meta ? { meta } : { meta: undefined }),
  };
}

async function getNodeByKey(kind: NodeKind, key: string): Promise<GraphNode | null> {
  return tx(['keyIndex', 'nodes'], 'readonly', async (transaction) => {
    const indexStore = transaction.objectStore('keyIndex');
    const compound = compoundKey(kind, key);
    const indexRecord = await idbGet<KeyIndexRecord>(indexStore, compound);
    if (!indexRecord) return null;
    const nodeStore = transaction.objectStore('nodes');
    const node = await idbGet<GraphNode>(nodeStore, indexRecord.nodeId);
    return node ? normalizeGraphNode(node) : null;
  });
}

function isPlaceholderWorkTitle(workId: string, title: string | undefined): boolean {
  return !title || title === `Work ${workId}`;
}

function mergeWorkTitle(
  workId: string,
  existing: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!next || isPlaceholderWorkTitle(workId, next)) return existing ?? next;
  if (isPlaceholderWorkTitle(workId, existing)) return next;
  return existing ?? next;
}

async function upsertNode(
  kind: NodeKind,
  key: string,
  patch: Partial<Omit<GraphNode, 'id' | 'kind' | 'key'>>,
): Promise<GraphNode> {
  const resolvedKey = kind === NodeKind.Tag ? await resolveGraphTagName(key) : key;
  const existing = await getNodeByKey(kind, resolvedKey);
  if (existing) {
    const title =
      kind === NodeKind.Work
        ? mergeWorkTitle(key, existing.title, patch.title)
        : patch.title ?? existing.title;
    const meta =
      kind === NodeKind.Work
        ? mergeWorkMetadata(existing.meta, patch.meta)
        : undefined;

    const explorationStatus = patch.explorationStatus ?? existing.explorationStatus;
    const explored = explorationStatus === 'complete';

    const updated: GraphNode = {
      ...existing,
      ...patch,
      title,
      kind,
      key: resolvedKey,
      explorationStatus,
      exploredAt: patch.exploredAt !== undefined ? patch.exploredAt : existing.exploredAt,
      listingNextPage:
        patch.listingNextPage !== undefined ? patch.listingNextPage : existing.listingNextPage,
      listingPagesFetched:
        patch.listingPagesFetched !== undefined
          ? patch.listingPagesFetched
          : existing.listingPagesFetched,
      explored,
      ...(kind === NodeKind.Work ? { meta } : { meta: undefined }),
    };
    await tx(['nodes'], 'readwrite', async (transaction) => {
      transaction.objectStore('nodes').put(updated);
    });
    return updated;
  }

  const defaults = defaultExplorationFields('unexplored');
  const explorationStatus = patch.explorationStatus ?? defaults.explorationStatus;
  const meta =
    kind === NodeKind.Work ? normalizeWorkMetadata(patch.meta) ?? patch.meta : undefined;
  const node: GraphNode = {
    id: await allocateNodeIds(1),
    kind,
    key: resolvedKey,
    title: patch.title,
    wordCount: patch.wordCount ?? null,
    estimatedFreq: patch.estimatedFreq ?? 1,
    calibratedFreq: patch.calibratedFreq ?? null,
    explorationStatus,
    exploredAt: patch.exploredAt ?? null,
    listingNextPage: patch.listingNextPage ?? null,
    listingPagesFetched: patch.listingPagesFetched ?? 0,
    explored: explorationStatus === 'complete',
    ...(meta ? { meta } : {}),
  };

  await tx(['nodes', 'keyIndex'], 'readwrite', async (transaction) => {
    transaction.objectStore('nodes').put(node);
    transaction.objectStore('keyIndex').put({
      compoundKey: compoundKey(kind, resolvedKey),
      nodeId: node.id,
    } satisfies KeyIndexRecord);
  });

  return node;
}

export async function addEdge(workNodeId: number, tagNodeId: number): Promise<void> {
  await tx('edges', 'readwrite', async (transaction) => {
    transaction.objectStore('edges').put({ workNodeId, tagNodeId } satisfies GraphEdge);
  });
}

async function addAuthorEdge(workNodeId: number, authorNodeId: number): Promise<void> {
  await tx('authorEdges', 'readwrite', async (transaction) => {
    transaction.objectStore('authorEdges').put({ workNodeId, authorNodeId } satisfies AuthorWorkEdge);
  });
}

function idbGet<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function mergeWorkPage(input: WorkMergeInput): Promise<GraphNode> {
  const now = Date.now();
  const explorationStatus =
    input.explorationStatus ??
    (input.explored === false ? 'unexplored' : 'complete');
  const workNode = await upsertNode(NodeKind.Work, input.workId, {
    title: input.title,
    wordCount: input.wordCount ?? null,
    explorationStatus,
    exploredAt: input.exploredAt ?? (explorationStatus === 'complete' ? now : null),
    listingNextPage: null,
    listingPagesFetched: 0,
    explored: explorationStatus === 'complete',
    meta: input.meta,
  });

  for (const tagName of input.tags) {
    const tagNode = await upsertNode(NodeKind.Tag, tagName, {
      estimatedFreq: 1,
    });
    await addEdge(workNode.id, tagNode.id);
    await incrementTagEstimate(tagNode.id);
  }

  for (const author of input.authors) {
    const authorNode = await upsertNode(NodeKind.Author, author.key, {
      title: author.displayName,
      estimatedFreq: 1,
    });
    await addAuthorEdge(workNode.id, authorNode.id);
    await incrementAuthorEstimate(authorNode.id);
  }

  return workNode;
}

async function incrementTagEstimate(tagNodeId: number): Promise<void> {
  await tx('nodes', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('nodes');
    const node = await idbGet<GraphNode>(store, tagNodeId);
    if (!node) return;
    node.estimatedFreq += 1;
    store.put(node);
  });
}

async function incrementAuthorEstimate(authorNodeId: number): Promise<void> {
  await tx('nodes', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('nodes');
    const node = await idbGet<GraphNode>(store, authorNodeId);
    if (!node) return;
    node.estimatedFreq += 1;
    store.put(node);
  });
}

async function applyListingHubExploration(
  node: GraphNode,
  input: {
    workCount: number | null;
    page?: number;
    nextPage?: number | null;
    explorationStatus?: GraphNode['explorationStatus'];
    exploredAt?: number | null;
    explored?: boolean;
  },
): Promise<GraphNode> {
  // Explicit status from caller (tests / legacy) bypasses pagination resolution.
  if (input.explorationStatus != null || (input.explored != null && input.page == null)) {
    const status =
      input.explorationStatus ??
      (input.explored === false ? 'unexplored' : 'complete');
    return upsertNode(node.kind, node.key, {
      calibratedFreq: input.workCount ?? node.calibratedFreq,
      explorationStatus: status,
      exploredAt: input.exploredAt ?? (status === 'unexplored' ? node.exploredAt : Date.now()),
      listingNextPage: status === 'partial' ? (input.nextPage ?? node.listingNextPage ?? 1) : null,
      listingPagesFetched:
        status === 'unexplored' ? node.listingPagesFetched : Math.max(node.listingPagesFetched, 1),
      explored: status === 'complete',
    });
  }

  const resolved = resolveListingExploration({
    previousStatus: node.explorationStatus,
    previousCalibratedFreq: node.calibratedFreq,
    previousPagesFetched: node.listingPagesFetched,
    workCount: input.workCount,
    nextPage: input.nextPage ?? null,
    pageFetched: input.page ?? 1,
  });

  return upsertNode(node.kind, node.key, {
    calibratedFreq: resolved.calibratedFreq,
    explorationStatus: resolved.explorationStatus,
    exploredAt: resolved.exploredAt,
    listingNextPage: resolved.listingNextPage,
    listingPagesFetched: resolved.listingPagesFetched,
    explored: resolved.explorationStatus === 'complete',
  });
}

export async function mergeTagPage(input: TagMergeInput): Promise<GraphNode> {
  let tagNode = await upsertNode(NodeKind.Tag, input.tagName, {});
  tagNode = await applyListingHubExploration(tagNode, input);

  for (const work of input.works) {
    await mergeListedWork(work, { kind: 'tag', tagNodeId: tagNode.id });
  }

  return tagNode;
}

export async function mergeAuthorPage(input: AuthorMergeInput): Promise<GraphNode> {
  let authorNode = await upsertNode(NodeKind.Author, input.authorKey, {
    title: input.displayName,
  });
  authorNode = await applyListingHubExploration(authorNode, {
    ...input,
    workCount: input.workCount,
  });

  for (const work of input.works) {
    await mergeListedWork(work, { kind: 'author', authorNodeId: authorNode.id });
    await incrementAuthorEstimate(authorNode.id);
  }

  return authorNode;
}

export async function mergeSearchPage(input: SearchMergeInput): Promise<void> {
  for (const work of input.works) {
    await mergeDiscoveredWork(work);
  }

  if (input.marksNodeId == null) return;

  await applyExplorationFromListing(input.marksNodeId, {
    workCount: input.workCount ?? null,
    page: input.page ?? 1,
    nextPage: input.nextPage ?? null,
  });
}

export async function applyExplorationUpdate(input: ExplorationUpdateInput): Promise<void> {
  await tx('nodes', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('nodes');
    const node = await idbGet<GraphNode>(store, input.nodeId);
    if (!node) return;
    const normalized = normalizeGraphNode(node);
    store.put({
      ...normalized,
      explorationStatus: input.explorationStatus,
      exploredAt: input.exploredAt,
      listingNextPage: input.listingNextPage,
      listingPagesFetched: input.listingPagesFetched,
      calibratedFreq:
        input.calibratedFreq !== undefined ? input.calibratedFreq : normalized.calibratedFreq,
      explored: input.explorationStatus === 'complete',
    });
  });
}

async function applyExplorationFromListing(
  nodeId: number,
  input: { workCount: number | null; page: number; nextPage: number | null },
): Promise<void> {
  const existing = await tx('nodes', 'readonly', async (transaction) => {
    const node = await idbGet<GraphNode>(transaction.objectStore('nodes'), nodeId);
    return node ? normalizeGraphNode(node) : null;
  });
  if (!existing) return;

  const resolved = resolveListingExploration({
    previousStatus: existing.explorationStatus,
    previousCalibratedFreq: existing.calibratedFreq,
    previousPagesFetched: existing.listingPagesFetched,
    workCount: input.workCount,
    nextPage: input.nextPage,
    pageFetched: input.page,
  });

  await applyExplorationUpdate({
    nodeId,
    explorationStatus: resolved.explorationStatus,
    exploredAt: resolved.exploredAt,
    listingNextPage: resolved.listingNextPage,
    listingPagesFetched: resolved.listingPagesFetched,
    calibratedFreq: resolved.calibratedFreq,
  });
}

/** Merge a work discovered from a listing blurb (partial data, not explored). */
async function mergeDiscoveredWork(work: ListedWorkInput): Promise<GraphNode> {
  const existing = await getWorkNode(work.workId);
  // Never downgrade a fully explored work via blurb merge.
  if (existing?.explorationStatus === 'complete') {
    return upsertNode(NodeKind.Work, work.workId, {
      title: work.title,
      ...(work.wordCount != null ? { wordCount: work.wordCount } : {}),
      ...(work.meta ? { meta: work.meta } : {}),
    });
  }

  const workNode = await upsertNode(NodeKind.Work, work.workId, {
    title: work.title,
    ...(work.wordCount != null ? { wordCount: work.wordCount } : {}),
    explorationStatus: existing?.explorationStatus ?? 'unexplored',
    exploredAt: existing?.exploredAt ?? null,
    listingNextPage: existing?.listingNextPage ?? null,
    listingPagesFetched: existing?.listingPagesFetched ?? 0,
    explored: false,
    ...(work.meta ? { meta: work.meta } : {}),
  });

  for (const tagName of work.tags ?? []) {
    const tagNode = await upsertNode(NodeKind.Tag, tagName, {
      estimatedFreq: 1,
    });
    await addEdge(workNode.id, tagNode.id);
  }

  for (const author of work.authors ?? []) {
    const authorNode = await upsertNode(NodeKind.Author, author.key, {
      title: author.displayName,
      estimatedFreq: 1,
    });
    await addAuthorEdge(workNode.id, authorNode.id);
  }

  return workNode;
}

/** Merge a work discovered from a tag or author listing blurb (partial data, not explored). */
async function mergeListedWork(
  work: ListedWorkInput,
  hub:
    | { kind: 'tag'; tagNodeId: number }
    | { kind: 'author'; authorNodeId: number },
): Promise<GraphNode> {
  const workNode = await mergeDiscoveredWork(work);

  if (hub.kind === 'tag') {
    await addEdge(workNode.id, hub.tagNodeId);
  } else {
    await addAuthorEdge(workNode.id, hub.authorNodeId);
  }

  return workNode;
}

export async function markNodeExplored(nodeId: number): Promise<void> {
  await applyExplorationUpdate({
    nodeId,
    explorationStatus: 'complete',
    exploredAt: Date.now(),
    listingNextPage: null,
    listingPagesFetched: 1,
  });
}

export async function getWorkNode(workId: string): Promise<GraphNode | null> {
  return getNodeByKey(NodeKind.Work, workId);
}

export async function getTagNode(tagName: string): Promise<GraphNode | null> {
  return getNodeByKey(NodeKind.Tag, tagName);
}

export async function getAuthorNode(authorKey: string): Promise<GraphNode | null> {
  return getNodeByKey(NodeKind.Author, authorKey);
}

export async function searchTagNodes(query: string, limit = 10): Promise<GraphNode[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  return tx('nodes', 'readonly', async (transaction) => {
    const nodes = await idbGetAll<GraphNode>(transaction.objectStore('nodes'));
    return nodes
      .filter((node) => node.kind === NodeKind.Tag)
      .map((node) => {
        const score = fuzzyTagMatch(normalized, node.key);
        return score == null ? null : { node, score };
      })
      .filter((item): item is { node: GraphNode; score: number } => item !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const freqA = a.node.calibratedFreq ?? a.node.estimatedFreq;
        const freqB = b.node.calibratedFreq ?? b.node.estimatedFreq;
        if (freqB !== freqA) return freqB - freqA;
        return a.node.key.localeCompare(b.node.key);
      })
      .slice(0, limit)
      .map((item) => item.node);
  });
}

export async function loadGraphSnapshot(): Promise<GraphSnapshot> {
  return tx(['nodes', 'edges', 'authorEdges'], 'readonly', async (transaction) => {
    const nodes = (await idbGetAll<GraphNode>(transaction.objectStore('nodes'))).map(normalizeGraphNode);
    const edges = await idbGetAll<GraphEdge>(transaction.objectStore('edges'));
    const authorEdges = await idbGetAll<AuthorWorkEdge>(transaction.objectStore('authorEdges'));
    return { nodes, edges, authorEdges };
  });
}

export async function getNextNodeId(): Promise<number> {
  return getMeta('nextNodeId', 0);
}

async function putGraphNode(node: GraphNode): Promise<void> {
  await tx('nodes', 'readwrite', async (transaction) => {
    transaction.objectStore('nodes').put(node);
  });
}

async function putKeyIndexRecord(kind: NodeKind, key: string, nodeId: number): Promise<void> {
  await tx('keyIndex', 'readwrite', async (transaction) => {
    transaction.objectStore('keyIndex').put({
      compoundKey: compoundKey(kind, key),
      nodeId,
    } satisfies KeyIndexRecord);
  });
}

async function putGraphEdge(workNodeId: number, tagNodeId: number): Promise<void> {
  await addEdge(workNodeId, tagNodeId);
}

async function putGraphAuthorEdge(workNodeId: number, authorNodeId: number): Promise<void> {
  await addAuthorEdge(workNodeId, authorNodeId);
}

function mergeImportedNodeFields(existing: GraphNode, imported: GraphNode): GraphNode {
  const title =
    existing.kind === NodeKind.Work
      ? mergeWorkTitle(existing.key, existing.title, imported.title)
      : imported.title ?? existing.title;

  const calibratedFreq =
    existing.calibratedFreq == null
      ? imported.calibratedFreq
      : imported.calibratedFreq == null
        ? existing.calibratedFreq
        : Math.max(existing.calibratedFreq, imported.calibratedFreq);

  const meta =
    existing.kind === NodeKind.Work
      ? mergeWorkMetadata(existing.meta, imported.meta)
      : undefined;

  const a = normalizeGraphNode(existing);
  const b = normalizeGraphNode(imported);
  const explorationStatus = mergeExplorationStatus(a.explorationStatus, b.explorationStatus);

  return {
    ...a,
    title,
    wordCount: imported.wordCount ?? existing.wordCount ?? null,
    estimatedFreq: Math.max(existing.estimatedFreq, imported.estimatedFreq),
    calibratedFreq,
    explorationStatus,
    exploredAt: Math.max(a.exploredAt ?? 0, b.exploredAt ?? 0) || null,
    listingNextPage:
      explorationStatus === 'partial'
        ? (b.listingNextPage ?? a.listingNextPage)
        : explorationStatus === 'complete'
          ? null
          : a.listingNextPage,
    listingPagesFetched: Math.max(a.listingPagesFetched, b.listingPagesFetched),
    explored: explorationStatus === 'complete',
    ...(existing.kind === NodeKind.Work ? { meta } : {}),
  };
}

export async function importGraphOverwrite(data: GraphSnapshot & { nextNodeId: number }): Promise<void> {
  await clearGraph();
  await tx(['meta', 'nodes', 'keyIndex', 'edges', 'authorEdges'], 'readwrite', async (transaction) => {
    transaction.objectStore('meta').put({ key: 'nextNodeId', value: data.nextNodeId } satisfies MetaRecord);

    for (const node of data.nodes) {
      transaction.objectStore('nodes').put(node);
      transaction.objectStore('keyIndex').put({
        compoundKey: compoundKey(node.kind, node.key),
        nodeId: node.id,
      } satisfies KeyIndexRecord);
    }
    for (const edge of data.edges) {
      transaction.objectStore('edges').put(edge);
    }
    for (const edge of data.authorEdges) {
      transaction.objectStore('authorEdges').put(edge);
    }
  });
}

export async function importGraphMerge(data: GraphSnapshot): Promise<void> {
  const idMap = new Map<number, number>();

  for (const imported of data.nodes) {
    const existing = await getNodeByKey(imported.kind, imported.key);
    if (existing) {
      const merged = mergeImportedNodeFields(existing, imported);
      await putGraphNode(merged);
      idMap.set(imported.id, existing.id);
      continue;
    }

    const id = await allocateNodeIds(1);
    const node: GraphNode = { ...imported, id };
    await putGraphNode(node);
    await putKeyIndexRecord(node.kind, node.key, node.id);
    idMap.set(imported.id, id);
  }

  for (const edge of data.edges) {
    const workNodeId = idMap.get(edge.workNodeId);
    const tagNodeId = idMap.get(edge.tagNodeId);
    if (workNodeId == null || tagNodeId == null) continue;
    await putGraphEdge(workNodeId, tagNodeId);
  }

  for (const edge of data.authorEdges) {
    const workNodeId = idMap.get(edge.workNodeId);
    const authorNodeId = idMap.get(edge.authorNodeId);
    if (workNodeId == null || authorNodeId == null) continue;
    await putGraphAuthorEdge(workNodeId, authorNodeId);
  }

  const currentNext = await getNextNodeId();
  const importedMax = data.nodes.reduce((max, node) => Math.max(max, node.id), -1);
  if (importedMax + 1 > currentNext) {
    await setMeta('nextNodeId', importedMax + 1);
  }
}

export async function clearGraph(): Promise<void> {
  await tx(['meta', 'nodes', 'keyIndex', 'edges', 'authorEdges'], 'readwrite', async (transaction) => {
    transaction.objectStore('meta').clear();
    transaction.objectStore('nodes').clear();
    transaction.objectStore('keyIndex').clear();
    transaction.objectStore('edges').clear();
    transaction.objectStore('authorEdges').clear();
  });
}

export async function clearStatsMetadata(): Promise<void> {
  await tx(['statsTags', 'statsTagNames'], 'readwrite', async (transaction) => {
    transaction.objectStore('statsTags').clear();
    transaction.objectStore('statsTagNames').clear();
  });
}

export async function getGraphTagNameToNodeId(): Promise<Map<string, number>> {
  return tx('nodes', 'readonly', async (transaction) => {
    const map = new Map<string, number>();
    const store = transaction.objectStore('nodes');
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const node = cursor.value as GraphNode;
        if (node.kind === NodeKind.Tag) {
          map.set(node.key, node.id);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return map;
  });
}

export async function getGraphWorkKeyToNodeId(): Promise<Map<string, number>> {
  return tx('nodes', 'readonly', async (transaction) => {
    const map = new Map<string, number>();
    const store = transaction.objectStore('nodes');
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const node = cursor.value as GraphNode;
        if (node.kind === NodeKind.Work) {
          map.set(node.key, node.id);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return map;
  });
}

export async function putStatsTagsBatch(
  records: StatsTagRecord[],
  options?: { indexNames?: Set<string> },
): Promise<void> {
  if (records.length === 0) return;
  const indexAllNames = options?.indexNames == null;
  await tx(['statsTags', 'statsTagNames'], 'readwrite', async (transaction) => {
    const tagStore = transaction.objectStore('statsTags');
    const nameStore = transaction.objectStore('statsTagNames');
    for (const record of records) {
      tagStore.put(record);
      if (
        record.name &&
        (indexAllNames || options?.indexNames?.has(record.name))
      ) {
        nameStore.put({ name: record.name, tagId: record.tagId } satisfies StatsTagNameIndex);
      }
    }
  });
}

export async function getStatsTag(tagId: number): Promise<StatsTagRecord | null> {
  return tx('statsTags', 'readonly', async (transaction) => {
    return idbGet<StatsTagRecord>(transaction.objectStore('statsTags'), tagId);
  });
}

export async function getStatsTagByName(name: string): Promise<StatsTagRecord | null> {
  return tx(['statsTagNames', 'statsTags'], 'readonly', async (transaction) => {
    const indexRecord = await idbGet<StatsTagNameIndex>(transaction.objectStore('statsTagNames'), name);
    if (!indexRecord) return null;
    return idbGet<StatsTagRecord>(transaction.objectStore('statsTags'), indexRecord.tagId);
  });
}

export async function getAllGraphTagNodes(): Promise<GraphNode[]> {
  return tx('nodes', 'readonly', async (transaction) => {
    const tags: GraphNode[] = [];
    const store = transaction.objectStore('nodes');
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const node = cursor.value as GraphNode;
        if (node.kind === NodeKind.Tag) {
          tags.push(node);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return tags;
  });
}

async function resolveGraphTagName(tagName: string): Promise<string> {
  const trimmed = tagName.trim();
  if (!trimmed) return tagName;

  const statsTag = await getStatsTagByName(trimmed);
  if (!statsTag) return trimmed;

  const canonical = await resolveCanonicalStatsTag(statsTag, getStatsTag);
  return canonical.name || trimmed;
}

function mergeTagNodeFields(target: GraphNode, source: GraphNode): GraphNode {
  const a = normalizeGraphNode(target);
  const b = normalizeGraphNode(source);
  const calibratedFreq =
    a.calibratedFreq == null
      ? b.calibratedFreq
      : b.calibratedFreq == null
        ? a.calibratedFreq
        : Math.max(a.calibratedFreq, b.calibratedFreq);

  const explorationStatus = mergeExplorationStatus(a.explorationStatus, b.explorationStatus);

  return {
    ...a,
    estimatedFreq: Math.max(a.estimatedFreq, b.estimatedFreq),
    calibratedFreq,
    explorationStatus,
    exploredAt: Math.max(a.exploredAt ?? 0, b.exploredAt ?? 0) || null,
    listingNextPage:
      explorationStatus === 'partial'
        ? (b.listingNextPage ?? a.listingNextPage)
        : explorationStatus === 'complete'
          ? null
          : a.listingNextPage,
    listingPagesFetched: Math.max(a.listingPagesFetched, b.listingPagesFetched),
    explored: explorationStatus === 'complete',
  };
}

export async function mergeTagGraphNodes(sourceId: number, targetId: number): Promise<void> {
  if (sourceId === targetId) return;

  await tx(['nodes', 'keyIndex', 'edges'], 'readwrite', async (transaction) => {
    const nodeStore = transaction.objectStore('nodes');
    const keyStore = transaction.objectStore('keyIndex');
    const edgeStore = transaction.objectStore('edges');

    const source = await idbGet<GraphNode>(nodeStore, sourceId);
    const target = await idbGet<GraphNode>(nodeStore, targetId);
    if (!source || source.kind !== NodeKind.Tag || !target || target.kind !== NodeKind.Tag) return;

    nodeStore.put(mergeTagNodeFields(target, source));

    const byTag = edgeStore.index('byTag');
    const sourceEdges = await new Promise<GraphEdge[]>((resolve, reject) => {
      const req = byTag.getAll(sourceId);
      req.onsuccess = () => resolve((req.result as GraphEdge[]) ?? []);
      req.onerror = () => reject(req.error);
    });

    for (const edge of sourceEdges) {
      edgeStore.delete([edge.workNodeId, edge.tagNodeId]);
      edgeStore.put({ workNodeId: edge.workNodeId, tagNodeId: targetId });
    }

    keyStore.delete(compoundKey(NodeKind.Tag, source.key));
    nodeStore.delete(sourceId);
  });
}

export async function renameTagGraphNode(nodeId: number, canonicalName: string): Promise<GraphNode> {
  const node = await tx('nodes', 'readonly', async (transaction) => {
    return idbGet<GraphNode>(transaction.objectStore('nodes'), nodeId);
  });
  if (!node || node.kind !== NodeKind.Tag) {
    throw new Error(`Tag node ${nodeId} not found`);
  }
  if (node.key === canonicalName) return node;

  const existingCanonical = await getNodeByKey(NodeKind.Tag, canonicalName);
  if (existingCanonical) {
    await mergeTagGraphNodes(nodeId, existingCanonical.id);
    const merged = await getNodeByKey(NodeKind.Tag, canonicalName);
    if (!merged) throw new Error(`Canonical tag node missing after merge: ${canonicalName}`);
    return merged;
  }

  const updated: GraphNode = { ...node, key: canonicalName };
  await tx(['nodes', 'keyIndex'], 'readwrite', async (transaction) => {
    transaction.objectStore('nodes').put(updated);
    transaction.objectStore('keyIndex').delete(compoundKey(NodeKind.Tag, node.key));
    transaction.objectStore('keyIndex').put({
      compoundKey: compoundKey(NodeKind.Tag, canonicalName),
      nodeId,
    } satisfies KeyIndexRecord);
  });
  return updated;
}

export async function canonicalizeGraphTagNode(
  nodeId: number,
  canonicalName: string,
  cachedCount: number,
): Promise<GraphNode> {
  const canonicalNode = await renameTagGraphNode(nodeId, canonicalName);
  const calibratedFreq =
    canonicalNode.calibratedFreq == null
      ? cachedCount
      : Math.max(canonicalNode.calibratedFreq, cachedCount);
  const updated = { ...canonicalNode, calibratedFreq };
  await putGraphNode(updated);
  return updated;
}

export async function countStatsTags(): Promise<number> {
  return tx('statsTags', 'readonly', async (transaction) => {
    return new Promise((resolve, reject) => {
      const req = transaction.objectStore('statsTags').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function calibrateGraphTagNode(nodeId: number, cachedCount: number): Promise<void> {
  await calibrateGraphTagNodesBatch(new Map([[nodeId, cachedCount]]));
}

export async function calibrateGraphTagNodesBatch(updates: Map<number, number>): Promise<void> {
  if (updates.size === 0) return;
  await tx('nodes', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('nodes');
    for (const [nodeId, cachedCount] of updates) {
      const node = await idbGet<GraphNode>(store, nodeId);
      if (!node || node.kind !== NodeKind.Tag) continue;
      const calibratedFreq =
        node.calibratedFreq == null ? cachedCount : Math.max(node.calibratedFreq, cachedCount);
      store.put({ ...node, calibratedFreq });
    }
  });
}

export async function ensureTagNodeFromStats(tag: StatsTagRecord): Promise<GraphNode> {
  const canonical = await resolveCanonicalStatsTag(tag, getStatsTag);
  const tagName = canonical.name || tag.name;
  if (!tagName) {
    throw new Error(`Stats tag ${tag.tagId} has no resolvable name`);
  }

  const existing = await getNodeByKey(NodeKind.Tag, tagName);
  if (existing) {
    const calibratedFreq =
      existing.calibratedFreq == null
        ? canonical.cachedCount
        : Math.max(existing.calibratedFreq, canonical.cachedCount);
    const updated = { ...existing, calibratedFreq };
    await putGraphNode(updated);
    return updated;
  }

  return upsertNode(NodeKind.Tag, tagName, {
    estimatedFreq: 1,
    calibratedFreq: canonical.cachedCount,
    ...defaultExplorationFields('unexplored'),
  });
}

/** Test helper — reset module-level DB handle after deleting database. */
export function resetDbForTests(): void {
  dbPromise = null;
}

/** Test helper — close open connection before deleting the database. */
export async function closeDbForTests(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

export { compoundKey, getNodeByKey };

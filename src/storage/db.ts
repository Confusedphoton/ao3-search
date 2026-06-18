import { DB_NAME, DB_VERSION } from '../config/constants';
import type {
  AuthorMergeInput,
  AuthorWorkEdge,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  TagMergeInput,
  WorkMergeInput,
} from '../graph/types';
import { NodeKind } from '../graph/types';

interface MetaRecord {
  key: string;
  value: number;
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

async function getNodeByKey(kind: NodeKind, key: string): Promise<GraphNode | null> {
  return tx(['keyIndex', 'nodes'], 'readonly', async (transaction) => {
    const indexStore = transaction.objectStore('keyIndex');
    const compound = compoundKey(kind, key);
    const indexRecord = await idbGet<KeyIndexRecord>(indexStore, compound);
    if (!indexRecord) return null;
    const nodeStore = transaction.objectStore('nodes');
    return idbGet<GraphNode>(nodeStore, indexRecord.nodeId);
  });
}

async function upsertNode(
  kind: NodeKind,
  key: string,
  patch: Partial<Omit<GraphNode, 'id' | 'kind' | 'key'>>,
): Promise<GraphNode> {
  const existing = await getNodeByKey(kind, key);
  if (existing) {
    const updated: GraphNode = { ...existing, ...patch, kind, key };
    await tx(['nodes'], 'readwrite', async (transaction) => {
      transaction.objectStore('nodes').put(updated);
    });
    return updated;
  }

  const id = await allocateNodeIds(1);
  const node: GraphNode = {
    id,
    kind,
    key,
    title: patch.title,
    estimatedFreq: patch.estimatedFreq ?? 1,
    calibratedFreq: patch.calibratedFreq ?? null,
    explored: patch.explored ?? false,
  };

  await tx(['nodes', 'keyIndex'], 'readwrite', async (transaction) => {
    transaction.objectStore('nodes').put(node);
    transaction.objectStore('keyIndex').put({
      compoundKey: compoundKey(kind, key),
      nodeId: id,
    } satisfies KeyIndexRecord);
  });

  return node;
}

async function addEdge(workNodeId: number, tagNodeId: number): Promise<void> {
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
  const workNode = await upsertNode(NodeKind.Work, input.workId, {
    title: input.title,
    explored: input.explored ?? true,
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

export async function mergeTagPage(input: TagMergeInput): Promise<GraphNode> {
  const tagNode = await upsertNode(NodeKind.Tag, input.tagName, {
    calibratedFreq: input.workCount,
    explored: input.explored ?? true,
  });

  for (const workId of input.workIds) {
    const workNode = await upsertNode(NodeKind.Work, workId, {
      title: `Work ${workId}`,
      explored: false,
    });
    await addEdge(workNode.id, tagNode.id);
  }

  return tagNode;
}

export async function mergeAuthorPage(input: AuthorMergeInput): Promise<GraphNode> {
  const authorNode = await upsertNode(NodeKind.Author, input.authorKey, {
    title: input.displayName,
    calibratedFreq: input.workCount,
    explored: input.explored ?? true,
  });

  for (const workId of input.workIds) {
    const workNode = await upsertNode(NodeKind.Work, workId, {
      title: `Work ${workId}`,
      explored: false,
    });
    await addAuthorEdge(workNode.id, authorNode.id);
    await incrementAuthorEstimate(authorNode.id);
  }

  return authorNode;
}

export async function markNodeExplored(nodeId: number): Promise<void> {
  await tx('nodes', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('nodes');
    const node = await idbGet<GraphNode>(store, nodeId);
    if (!node) return;
    node.explored = true;
    store.put(node);
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

export async function loadGraphSnapshot(): Promise<GraphSnapshot> {
  return tx(['nodes', 'edges', 'authorEdges'], 'readonly', async (transaction) => {
    const nodes = await idbGetAll<GraphNode>(transaction.objectStore('nodes'));
    const edges = await idbGetAll<GraphEdge>(transaction.objectStore('edges'));
    const authorEdges = await idbGetAll<AuthorWorkEdge>(transaction.objectStore('authorEdges'));
    return { nodes, edges, authorEdges };
  });
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

/** Test helper — reset module-level DB handle after deleting database. */
export function resetDbForTests(): void {
  dbPromise = null;
}

export { compoundKey, getNodeByKey };
